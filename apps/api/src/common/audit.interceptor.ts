import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs';
import { PrismaService } from './prisma.service';
import type { AuthenticatedPrincipal } from '../auth/guards';

const AUDITED_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * Writes an audit row for every state-changing request. Fire-and-forget:
 * audit failures are logged by Prisma but never fail the request.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context
      .switchToHttp()
      .getRequest<FastifyRequest & { principal?: AuthenticatedPrincipal }>();

    if (!AUDITED_METHODS.has(request.method)) return next.handle();

    const params = request.params as Record<string, string>;
    return next.handle().pipe(
      tap(() => {
        void this.prisma.auditLog
          .create({
            data: {
              organizationId: params.orgId ?? null,
              userId: request.principal?.userId ?? null,
              action: `${request.method} ${request.routeOptions?.url ?? request.url}`,
              resource: request.url.split('?')[0] ?? request.url,
              resourceId: params.videoId ?? params.projectId ?? params.orgId ?? null,
              context: { ip: request.ip, userAgent: request.headers['user-agent'] ?? null },
            },
          })
          .catch(() => {});
      }),
    );
  }
}
