import type { PipelineRunId, VideoId } from '../ids.js';
import type { JobPriority, JobQueueName } from './job.js';

/**
 * Pipeline stages are declarative: the built-in video pipeline and user-built
 * workflows share this definition format, executed by one orchestrator.
 */
export type StageName =
  | 'script'
  | 'prompt_enhance'
  | 'translate'
  | 'tts'
  | 'avatar_animate'
  | 'lipsync'
  | 'motion'
  | 'subtitles'
  | 'render'
  | 'compress'
  | 'thumbnail'
  | 'store'
  | 'cdn_publish'
  | 'webhook'
  | 'analytics';

export interface StageDefinition {
  readonly name: StageName | (string & {});
  /** Capability the stage consumes, resolved through the ProviderRegistry (null = pure compute). */
  readonly capability: string | null;
  readonly queue: JobQueueName;
  /** Stage names this stage depends on; empty = pipeline entry point. */
  readonly dependsOn: readonly string[];
  readonly maxAttempts: number;
  /** Skip instead of fail the pipeline when the stage is optional (e.g. translate). */
  readonly optional: boolean;
  /** Static stage configuration merged with runtime input. */
  readonly config?: Record<string, unknown>;
}

export interface PipelineDefinition {
  readonly id: string;
  readonly version: number;
  readonly stages: readonly StageDefinition[];
}

export interface PipelineRunContext {
  readonly runId: PipelineRunId;
  readonly videoId?: VideoId;
  readonly priority: JobPriority;
  /** Artifact keys produced by completed stages, keyed by stage name. */
  readonly artifacts: Readonly<Record<string, unknown>>;
}

/**
 * Validate a pipeline definition as a DAG: unique names, known dependencies,
 * no cycles. Returns a topological order usable for scheduling.
 */
export function validatePipeline(definition: PipelineDefinition): {
  valid: boolean;
  order: string[];
  errors: string[];
} {
  const errors: string[] = [];
  const names = definition.stages.map((s) => s.name);
  const nameSet = new Set(names);

  if (nameSet.size !== names.length) {
    errors.push('Duplicate stage names');
  }
  for (const stage of definition.stages) {
    for (const dep of stage.dependsOn) {
      if (!nameSet.has(dep)) errors.push(`Stage '${stage.name}' depends on unknown '${dep}'`);
      if (dep === stage.name) errors.push(`Stage '${stage.name}' depends on itself`);
    }
  }
  if (errors.length > 0) return { valid: false, order: [], errors };

  // Kahn's algorithm for topological sort + cycle detection.
  const inDegree = new Map<string, number>(names.map((n) => [n, 0]));
  const dependents = new Map<string, string[]>(names.map((n) => [n, []]));
  for (const stage of definition.stages) {
    inDegree.set(stage.name, stage.dependsOn.length);
    for (const dep of stage.dependsOn) {
      dependents.get(dep)?.push(stage.name);
    }
  }

  const queue = names.filter((n) => inDegree.get(n) === 0);
  const order: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    order.push(current);
    for (const next of dependents.get(current) ?? []) {
      const remaining = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }

  if (order.length !== names.length) {
    return { valid: false, order: [], errors: ['Pipeline contains a cycle'] };
  }
  return { valid: true, order, errors: [] };
}

/** Stages whose dependencies are all satisfied and are not yet started. */
export function readyStages(
  definition: PipelineDefinition,
  completed: ReadonlySet<string>,
  startedOrSkipped: ReadonlySet<string>,
): StageDefinition[] {
  return definition.stages.filter(
    (stage) =>
      !completed.has(stage.name) &&
      !startedOrSkipped.has(stage.name) &&
      stage.dependsOn.every((dep) => completed.has(dep)),
  );
}
