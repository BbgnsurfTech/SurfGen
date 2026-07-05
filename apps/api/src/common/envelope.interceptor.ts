import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { Injectable, StreamableFile } from '@nestjs/common';
import type { Observable } from 'rxjs';
import { map } from 'rxjs';

interface Envelope {
  success: true;
  data: unknown;
  error: null;
  meta?: unknown;
}

/**
 * Wraps every successful response in the API envelope. Handlers can return
 * { data, meta } to attach pagination metadata, or a bare value.
 * StreamableFile responses (e.g. MediaController) pass through untouched —
 * the platform adapter streams them directly and they aren't JSON.
 */
@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<Envelope | StreamableFile> {
    return next.handle().pipe(
      map((value) => {
        if (value instanceof StreamableFile) return value;
        if (value && typeof value === 'object' && 'data' in value && 'meta' in value) {
          const { data, meta } = value as { data: unknown; meta: unknown };
          return { success: true as const, data, error: null, meta };
        }
        return { success: true as const, data: value ?? null, error: null };
      }),
    );
  }
}
