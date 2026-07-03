/**
 * Domain error hierarchy. Every error carries a stable machine-readable `code`
 * that adapters map to transport-level errors (HTTP status, GraphQL extensions,
 * job failure classes) without string-matching messages.
 */
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'QUOTA_EXCEEDED'
  | 'RATE_LIMITED'
  | 'PROVIDER_ERROR'
  | 'PROVIDER_UNAVAILABLE'
  | 'PIPELINE_ERROR'
  | 'INVALID_STATE_TRANSITION'
  | 'CONFIGURATION_ERROR'
  | 'STORAGE_ERROR'
  | 'INTERNAL_ERROR';

export interface DomainErrorOptions {
  readonly cause?: unknown;
  readonly details?: Record<string, unknown>;
  /** Whether retrying the same operation may succeed (drives job retry policy). */
  readonly retryable?: boolean;
}

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown>;
  readonly retryable: boolean;

  constructor(code: ErrorCode, message: string, options: DomainErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.code = code;
    this.details = options.details ?? {};
    this.retryable = options.retryable ?? false;
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, options?: DomainErrorOptions) {
    super('VALIDATION_ERROR', message, options);
  }
}

export class NotFoundError extends DomainError {
  constructor(resource: string, id: string, options?: DomainErrorOptions) {
    super('NOT_FOUND', `${resource} not found: ${id}`, {
      ...options,
      details: { resource, id, ...options?.details },
    });
  }
}

export class ConflictError extends DomainError {
  constructor(message: string, options?: DomainErrorOptions) {
    super('CONFLICT', message, options);
  }
}

export class UnauthorizedError extends DomainError {
  constructor(message = 'Authentication required', options?: DomainErrorOptions) {
    super('UNAUTHORIZED', message, options);
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = 'Insufficient permissions', options?: DomainErrorOptions) {
    super('FORBIDDEN', message, options);
  }
}

export class QuotaExceededError extends DomainError {
  constructor(quota: string, limit: number, used: number, options?: DomainErrorOptions) {
    super('QUOTA_EXCEEDED', `Quota exceeded for ${quota}: ${used}/${limit}`, {
      ...options,
      details: { quota, limit, used, ...options?.details },
    });
  }
}

export class ProviderError extends DomainError {
  constructor(providerId: string, message: string, options?: DomainErrorOptions) {
    super('PROVIDER_ERROR', `[${providerId}] ${message}`, {
      retryable: true,
      ...options,
      details: { providerId, ...options?.details },
    });
  }
}

export class ProviderUnavailableError extends DomainError {
  constructor(capability: string, options?: DomainErrorOptions) {
    super('PROVIDER_UNAVAILABLE', `No healthy provider available for capability: ${capability}`, {
      retryable: true,
      ...options,
      details: { capability, ...options?.details },
    });
  }
}

export class PipelineError extends DomainError {
  constructor(stage: string, message: string, options?: DomainErrorOptions) {
    super('PIPELINE_ERROR', `Pipeline stage '${stage}' failed: ${message}`, {
      ...options,
      details: { stage, ...options?.details },
    });
  }
}

export class InvalidStateTransitionError extends DomainError {
  constructor(entity: string, from: string, to: string, options?: DomainErrorOptions) {
    super('INVALID_STATE_TRANSITION', `${entity}: illegal transition ${from} → ${to}`, {
      ...options,
      details: { entity, from, to, ...options?.details },
    });
  }
}

export class ConfigurationError extends DomainError {
  constructor(message: string, options?: DomainErrorOptions) {
    super('CONFIGURATION_ERROR', message, options);
  }
}

export class StorageError extends DomainError {
  constructor(message: string, options?: DomainErrorOptions) {
    super('STORAGE_ERROR', message, { retryable: true, ...options });
  }
}

export const isDomainError = (e: unknown): e is DomainError => e instanceof DomainError;
