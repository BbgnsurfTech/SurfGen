import type { EventEnvelope, EventPublisherPort, EventSubscriberPort } from '@surfgen/core';

/**
 * AMQP topic matching semantics: '.' separates words, '*' matches exactly one
 * word, '#' matches zero or more words.
 */
export function matchTopic(pattern: string, routingKey: string): boolean {
  const patternWords = pattern.split('.');
  const keyWords = routingKey.split('.');

  // Dynamic programming over pattern/key positions to honor '#' backtracking.
  const memo = new Map<string, boolean>();
  const match = (p: number, k: number): boolean => {
    const cacheKey = `${p}:${k}`;
    const cached = memo.get(cacheKey);
    if (cached !== undefined) return cached;

    let result: boolean;
    if (p === patternWords.length) {
      result = k === keyWords.length;
    } else if (patternWords[p] === '#') {
      // '#' consumes zero words (advance pattern) or one word (advance key).
      result = match(p + 1, k) || (k < keyWords.length && match(p, k + 1));
    } else if (k === keyWords.length) {
      result = false;
    } else {
      result = (patternWords[p] === '*' || patternWords[p] === keyWords[k]) && match(p + 1, k + 1);
    }
    memo.set(cacheKey, result);
    return result;
  };
  return match(0, 0);
}

interface Subscription {
  readonly patterns: readonly string[];
  readonly handler: (event: EventEnvelope) => Promise<void>;
}

/** In-process bus for tests and single-node development. */
export class InMemoryEventBus implements EventPublisherPort, EventSubscriberPort {
  private readonly subscriptions = new Set<Subscription>();
  /** Events whose handler rejected — the in-memory analog of a DLQ. */
  readonly deadLetters: { event: EventEnvelope; error: unknown }[] = [];

  async publish<T>(event: EventEnvelope<T>): Promise<void> {
    const deliveries: Promise<void>[] = [];
    for (const subscription of this.subscriptions) {
      if (subscription.patterns.some((pattern) => matchTopic(pattern, event.name))) {
        deliveries.push(
          subscription.handler(event as EventEnvelope).catch((error) => {
            this.deadLetters.push({ event: event as EventEnvelope, error });
          }),
        );
      }
    }
    await Promise.all(deliveries);
  }

  async publishMany(events: readonly EventEnvelope[]): Promise<void> {
    for (const event of events) await this.publish(event);
  }

  async subscribe(
    patterns: readonly string[],
    handler: (event: EventEnvelope) => Promise<void>,
  ): Promise<{ unsubscribe: () => Promise<void> }> {
    const subscription: Subscription = { patterns, handler };
    this.subscriptions.add(subscription);
    return {
      unsubscribe: async () => {
        this.subscriptions.delete(subscription);
      },
    };
  }
}
