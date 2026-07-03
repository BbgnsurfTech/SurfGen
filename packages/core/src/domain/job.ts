import type { JobId, PipelineRunId, OrganizationId } from '../ids.js';
import type { TransitionTable } from './state-machine.js';

export type JobStatus =
  | 'queued'
  | 'active'
  | 'progress'
  | 'retrying'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * Job lifecycle. 'progress' is a sub-state of active work that allows
 * checkpoint persistence without leaving the active family; terminal states
 * have no outgoing transitions.
 */
export const JOB_TRANSITIONS: TransitionTable<JobStatus> = {
  queued: ['active', 'cancelled'],
  active: ['progress', 'completed', 'failed', 'retrying', 'cancelled'],
  progress: ['progress', 'completed', 'failed', 'retrying', 'cancelled'],
  retrying: ['queued', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
};

export interface JobProgress {
  /** 0..100 within the current stage. */
  readonly percent: number;
  readonly message?: string;
  /** Opaque resume checkpoint persisted by the stage processor. */
  readonly checkpoint?: Record<string, unknown>;
}

export interface JobDescriptor {
  readonly id: JobId;
  readonly organizationId: OrganizationId;
  readonly pipelineRunId: PipelineRunId;
  readonly stage: string;
  readonly queue: JobQueueName;
  readonly status: JobStatus;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly priority: JobPriority;
  readonly progress?: JobProgress;
  readonly error?: { code: string; message: string; retryable: boolean };
}

export type JobPriority = 'low' | 'normal' | 'high' | 'realtime';

export const JOB_PRIORITY_WEIGHT: Record<JobPriority, number> = {
  realtime: 1,
  high: 2,
  normal: 5,
  low: 10,
};

/** Queues are split by resource class so GPU work never starves CPU work. */
export type JobQueueName =
  | 'cpu.default'
  | 'cpu.media'
  | 'gpu.default'
  | 'gpu.heavy'
  | 'io.webhooks'
  | 'io.analytics';
