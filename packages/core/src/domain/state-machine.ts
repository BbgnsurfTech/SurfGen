import { InvalidStateTransitionError } from '../errors.js';
import type { Result } from '../result.js';
import { err, ok } from '../result.js';

/**
 * Generic finite state machine over a transition table. Legal transitions are
 * data, so every domain lifecycle (Video, Job, WorkflowRun) shares one tested
 * implementation and one exhaustive test style.
 */
export type TransitionTable<S extends string> = Readonly<Record<S, readonly S[]>>;

export function canTransition<S extends string>(
  table: TransitionTable<S>,
  from: S,
  to: S,
): boolean {
  return (table[from] ?? []).includes(to);
}

export function transition<S extends string>(
  entity: string,
  table: TransitionTable<S>,
  from: S,
  to: S,
): Result<S, InvalidStateTransitionError> {
  if (!canTransition(table, from, to)) {
    return err(new InvalidStateTransitionError(entity, from, to));
  }
  return ok(to);
}

export function terminalStates<S extends string>(table: TransitionTable<S>): S[] {
  return (Object.keys(table) as S[]).filter((state) => table[state].length === 0);
}
