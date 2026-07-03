import type { PipelineDefinition } from '@surfgen/core';

export interface VideoPipelineOptions {
  /** Skip translation when target language equals source. */
  readonly translate: boolean;
  /** Generate the script with an LLM when no script was provided. */
  readonly generateScript: boolean;
}

/**
 * The built-in avatar video pipeline. Declarative — the orchestrator executes
 * this exactly like a user-built workflow definition.
 *
 *   script → (translate) → tts → avatar → subtitles → render → thumbnail → finalize
 */
export function defaultVideoPipeline(options: VideoPipelineOptions): PipelineDefinition {
  return {
    id: 'video.default',
    version: 1,
    stages: [
      {
        name: 'script',
        capability: options.generateScript ? 'llm' : null,
        queue: 'cpu.default',
        dependsOn: [],
        maxAttempts: 3,
        optional: false,
      },
      ...(options.translate
        ? [
            {
              name: 'translate',
              capability: 'translation',
              queue: 'cpu.default',
              dependsOn: ['script'],
              maxAttempts: 3,
              optional: true,
            } as const,
          ]
        : []),
      {
        name: 'tts',
        capability: 'tts',
        queue: 'gpu.default',
        dependsOn: [options.translate ? 'translate' : 'script'],
        maxAttempts: 3,
        optional: false,
      },
      {
        name: 'avatar',
        capability: 'avatar',
        queue: 'gpu.default',
        dependsOn: ['tts'],
        maxAttempts: 3,
        optional: false,
      },
      {
        name: 'subtitles',
        capability: null,
        queue: 'cpu.default',
        dependsOn: ['tts'],
        maxAttempts: 3,
        optional: true,
      },
      {
        name: 'render',
        capability: null, // ffmpeg — pure compute
        queue: 'cpu.media',
        dependsOn: ['avatar', 'subtitles'],
        maxAttempts: 2,
        optional: false,
      },
      {
        name: 'thumbnail',
        capability: null,
        queue: 'cpu.media',
        dependsOn: ['render'],
        maxAttempts: 3,
        optional: true,
      },
      {
        name: 'finalize',
        capability: null,
        queue: 'cpu.default',
        dependsOn: ['render', 'thumbnail'],
        maxAttempts: 5,
        optional: false,
      },
    ],
  };
}

/** Weights for overall progress reporting (must cover every possible stage). */
export const STAGE_PROGRESS_WEIGHTS: Record<string, number> = {
  script: 5,
  translate: 5,
  tts: 15,
  avatar: 35,
  subtitles: 5,
  render: 25,
  thumbnail: 3,
  finalize: 7,
};
