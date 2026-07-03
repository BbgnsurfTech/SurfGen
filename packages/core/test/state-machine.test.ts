import { describe, expect, test } from 'vitest';
import {
  canTransition,
  terminalStates,
  transition,
} from '../src/domain/state-machine.js';
import { JOB_TRANSITIONS, type JobStatus } from '../src/domain/job.js';
import { VIDEO_TRANSITIONS, type VideoStatus } from '../src/domain/video.js';
import { isErr, isOk } from '../src/result.js';
import { InvalidStateTransitionError } from '../src/errors.js';

describe('generic state machine', () => {
  test('transition returns ok for legal moves', () => {
    const r = transition('Job', JOB_TRANSITIONS, 'queued', 'active');
    expect(isOk(r) && r.value).toBe('active');
  });

  test('transition returns InvalidStateTransitionError for illegal moves', () => {
    const r = transition('Job', JOB_TRANSITIONS, 'completed', 'active');
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error).toBeInstanceOf(InvalidStateTransitionError);
      expect(r.error.details).toMatchObject({ entity: 'Job', from: 'completed', to: 'active' });
    }
  });
});

describe('job lifecycle', () => {
  test('terminal states have no exits', () => {
    expect(new Set(terminalStates(JOB_TRANSITIONS))).toEqual(
      new Set<JobStatus>(['completed', 'failed', 'cancelled']),
    );
  });

  test('happy path: queued → active → progress → completed', () => {
    expect(canTransition(JOB_TRANSITIONS, 'queued', 'active')).toBe(true);
    expect(canTransition(JOB_TRANSITIONS, 'active', 'progress')).toBe(true);
    expect(canTransition(JOB_TRANSITIONS, 'progress', 'progress')).toBe(true);
    expect(canTransition(JOB_TRANSITIONS, 'progress', 'completed')).toBe(true);
  });

  test('retry path: active → retrying → queued', () => {
    expect(canTransition(JOB_TRANSITIONS, 'active', 'retrying')).toBe(true);
    expect(canTransition(JOB_TRANSITIONS, 'retrying', 'queued')).toBe(true);
  });

  test('cancellation is reachable from every non-terminal state', () => {
    const nonTerminal: JobStatus[] = ['queued', 'active', 'progress', 'retrying'];
    for (const from of nonTerminal) {
      expect(canTransition(JOB_TRANSITIONS, from, 'cancelled')).toBe(true);
    }
  });

  test('completed jobs cannot be restarted', () => {
    expect(canTransition(JOB_TRANSITIONS, 'completed', 'queued')).toBe(false);
    expect(canTransition(JOB_TRANSITIONS, 'failed', 'active')).toBe(false);
  });
});

describe('video lifecycle', () => {
  test('full generation path reaches ready', () => {
    const path: VideoStatus[] = [
      'draft',
      'queued',
      'generating',
      'rendering',
      'post_processing',
      'ready',
    ];
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(VIDEO_TRANSITIONS, path[i]!, path[i + 1]!)).toBe(true);
    }
  });

  test('failed and ready videos can be re-queued (retry / re-render)', () => {
    expect(canTransition(VIDEO_TRANSITIONS, 'failed', 'queued')).toBe(true);
    expect(canTransition(VIDEO_TRANSITIONS, 'ready', 'queued')).toBe(true);
  });

  test('archived is the only terminal state', () => {
    expect(terminalStates(VIDEO_TRANSITIONS)).toEqual(['archived']);
  });

  test('drafts cannot jump straight to rendering', () => {
    expect(canTransition(VIDEO_TRANSITIONS, 'draft', 'rendering')).toBe(false);
    expect(canTransition(VIDEO_TRANSITIONS, 'draft', 'ready')).toBe(false);
  });
});
