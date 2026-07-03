/**
 * Domain event catalog. Names follow `<aggregate>.<past-tense-action>` and are
 * the routing keys on the `surfgen.events` topic exchange. Payloads are the
 * minimal facts consumers need — never full aggregates.
 */
export interface EventEnvelope<T = unknown> {
  /** Unique event id (idempotency key for consumers). */
  readonly id: string;
  readonly name: DomainEventName | (string & {});
  readonly occurredAt: string; // ISO-8601
  readonly organizationId?: string;
  /** Correlation across a pipeline run / user request. */
  readonly correlationId?: string;
  readonly payload: T;
  readonly version: 1;
}

export type DomainEventName =
  | 'video.created'
  | 'video.queued'
  | 'video.generation_started'
  | 'video.stage_completed'
  | 'video.progress'
  | 'video.ready'
  | 'video.failed'
  | 'video.cancelled'
  | 'pipeline.run_started'
  | 'pipeline.stage_started'
  | 'pipeline.stage_completed'
  | 'pipeline.stage_failed'
  | 'pipeline.run_completed'
  | 'pipeline.run_failed'
  | 'pipeline.run_cancelled'
  | 'avatar.created'
  | 'avatar.version_published'
  | 'voice.created'
  | 'voice.clone_completed'
  | 'workflow.run_started'
  | 'workflow.run_completed'
  | 'workflow.run_failed'
  | 'provider.registered'
  | 'provider.health_changed'
  | 'plugin.installed'
  | 'plugin.enabled'
  | 'plugin.disabled'
  | 'org.member_added'
  | 'org.member_removed'
  | 'billing.usage_recorded'
  | 'billing.quota_exceeded'
  | 'webhook.delivery_failed'
  | 'config.changed';

export interface VideoProgressPayload {
  videoId: string;
  runId: string;
  stage: string;
  /** 0..100 across the whole pipeline (weighted by stage). */
  overallPercent: number;
  stagePercent: number;
  message?: string;
}

export interface StageCompletedPayload {
  runId: string;
  stage: string;
  durationMs: number;
  artifactKeys: string[];
}

export interface ProviderHealthChangedPayload {
  providerId: string;
  capability: string;
  healthy: boolean;
  latencyMs?: number;
  reason?: string;
}

export interface UsageRecordedPayload {
  organizationId: string;
  metric: string; // e.g. 'render.seconds', 'tts.characters', 'llm.tokens'
  quantity: number;
  providerId?: string;
  runId?: string;
}
