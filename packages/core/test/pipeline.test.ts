import { describe, expect, test } from 'vitest';
import {
  readyStages,
  validatePipeline,
  type PipelineDefinition,
  type StageDefinition,
} from '../src/domain/pipeline.js';

const stage = (
  name: string,
  dependsOn: string[] = [],
  overrides: Partial<StageDefinition> = {},
): StageDefinition => ({
  name,
  capability: null,
  queue: 'cpu.default',
  dependsOn,
  maxAttempts: 3,
  optional: false,
  ...overrides,
});

const pipeline = (stages: StageDefinition[]): PipelineDefinition => ({
  id: 'test',
  version: 1,
  stages,
});

describe('validatePipeline', () => {
  test('accepts a valid DAG and returns topological order', () => {
    const def = pipeline([
      stage('tts', ['script']),
      stage('script'),
      stage('render', ['tts', 'subtitles']),
      stage('subtitles', ['tts']),
    ]);
    const result = validatePipeline(def);
    expect(result.valid).toBe(true);
    expect(result.order.indexOf('script')).toBeLessThan(result.order.indexOf('tts'));
    expect(result.order.indexOf('tts')).toBeLessThan(result.order.indexOf('subtitles'));
    expect(result.order.indexOf('subtitles')).toBeLessThan(result.order.indexOf('render'));
  });

  test('rejects duplicate stage names', () => {
    const result = validatePipeline(pipeline([stage('tts'), stage('tts')]));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Duplicate stage names');
  });

  test('rejects unknown dependencies', () => {
    const result = validatePipeline(pipeline([stage('render', ['ghost'])]));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/unknown 'ghost'/);
  });

  test('rejects self-dependency', () => {
    const result = validatePipeline(pipeline([stage('loop', ['loop'])]));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('depends on itself'))).toBe(true);
  });

  test('rejects cycles', () => {
    const result = validatePipeline(
      pipeline([stage('a', ['b']), stage('b', ['c']), stage('c', ['a'])]),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Pipeline contains a cycle');
  });
});

describe('readyStages', () => {
  const def = pipeline([
    stage('script'),
    stage('tts', ['script']),
    stage('subtitles', ['tts']),
    stage('render', ['tts', 'subtitles']),
  ]);

  test('entry stages are ready when nothing has run', () => {
    const ready = readyStages(def, new Set(), new Set());
    expect(ready.map((s) => s.name)).toEqual(['script']);
  });

  test('stages become ready as dependencies complete', () => {
    const ready = readyStages(def, new Set(['script', 'tts']), new Set());
    expect(ready.map((s) => s.name)).toEqual(['subtitles']);
  });

  test('render requires both tts and subtitles', () => {
    const ready = readyStages(def, new Set(['script', 'tts', 'subtitles']), new Set());
    expect(ready.map((s) => s.name)).toEqual(['render']);
  });

  test('already-started stages are excluded', () => {
    const ready = readyStages(def, new Set(['script']), new Set(['tts']));
    expect(ready).toEqual([]);
  });
});
