import { nanoid } from 'nanoid';
import { z } from 'zod';
import { ValidationError, type ClockPort, type EventEnvelope, type Result, err, ok } from '@surfgen/core';

export interface CreateEnvelopeInput<T> {
  readonly name: string;
  readonly payload: T;
  readonly organizationId?: string;
  readonly correlationId?: string;
  readonly id?: string;
  readonly occurredAt?: string;
}

export function createEnvelope<T>(
  input: CreateEnvelopeInput<T>,
  clock?: ClockPort,
): EventEnvelope<T> {
  return {
    id: input.id ?? `evt_${nanoid(21)}`,
    name: input.name,
    occurredAt: input.occurredAt ?? (clock?.now() ?? new Date()).toISOString(),
    ...(input.organizationId !== undefined && { organizationId: input.organizationId }),
    ...(input.correlationId !== undefined && { correlationId: input.correlationId }),
    payload: input.payload,
    version: 1,
  };
}

export const EnvelopeSchema = z.object({
  id: z.string().min(1),
  name: z.string().regex(/^[a-z0-9_]+(\.[a-z0-9_]+)+$/, 'event names are dot-separated'),
  occurredAt: z.string().datetime({ offset: true }).or(z.string().datetime()),
  organizationId: z.string().optional(),
  correlationId: z.string().optional(),
  payload: z.unknown(),
  version: z.literal(1),
});

/** Wire-boundary validation: consumers never trust raw bytes. */
export function parseEnvelope(raw: unknown): Result<EventEnvelope, ValidationError> {
  const parsed = EnvelopeSchema.safeParse(raw);
  if (!parsed.success) {
    return err(
      new ValidationError('Invalid event envelope', {
        details: {
          issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      }),
    );
  }
  return ok(parsed.data as EventEnvelope);
}
