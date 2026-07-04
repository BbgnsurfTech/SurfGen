import type { CanActivate, ExecutionContext } from '@nestjs/common';
import {
  Injectable,
  SetMetadata,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { ForbiddenError, UnauthorizedError } from '@surfgen/core';
import { PrismaService } from '../common/prisma.service';
import { AuthService } from './auth.service';

export interface AuthenticatedPrincipal {
  userId: string;
  email?: string;
  superAdmin: boolean;
  /** Set when authenticated via API key (org-scoped credentials). */
  apiKeyOrganizationId?: string;
  scopes?: string[];
}

type RequestWithAuth = FastifyRequest & { principal?: AuthenticatedPrincipal };

export const PUBLIC_KEY = 'surfgen:public';
export const Public = () => SetMetadata(PUBLIC_KEY, true);

export const ORG_ROLES_KEY = 'surfgen:orgRoles';
/** Minimum org role required; resolved against the :orgId route param. */
export const RequireOrgRole = (...roles: string[]) => SetMetadata(ORG_ROLES_KEY, roles);

export const SUPER_ADMIN_KEY = 'surfgen:superAdmin';
/**
 * Deployment-level routes (cross-org data, plugin/provider state). Only JWT
 * principals with isSuperAdmin pass — API keys are org-scoped and never do.
 */
export const RequireSuperAdmin = () => SetMetadata(SUPER_ADMIN_KEY, true);

export const Principal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedPrincipal | undefined =>
    context.switchToHttp().getRequest<RequestWithAuth>().principal,
);

const ROLE_RANK: Record<string, number> = { viewer: 0, editor: 1, admin: 2, owner: 3 };

/**
 * Unified authentication guard: Bearer JWT or X-Api-Key. Attaches
 * request.principal. Routes marked @Public() skip authentication.
 * When @RequireOrgRole(...) is present, membership for :orgId is enforced.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    request.principal = await this.authenticate(request);

    const requiresSuperAdmin = this.reflector.getAllAndOverride<boolean>(SUPER_ADMIN_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (requiresSuperAdmin && !request.principal.superAdmin) {
      throw new ForbiddenError('Requires super-admin access');
    }

    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ORG_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (requiredRoles && requiredRoles.length > 0) {
      await this.enforceOrgRole(request, requiredRoles);
    }
    return true;
  }

  private async authenticate(request: RequestWithAuth): Promise<AuthenticatedPrincipal> {
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const payload = await this.authService.verifyAccessToken(authHeader.slice(7));
      return { userId: payload.sub, email: payload.email, superAdmin: payload.superAdmin };
    }

    const apiKey = request.headers['x-api-key'];
    if (typeof apiKey === 'string' && apiKey.length > 0) {
      const resolved = await this.authService.verifyApiKey(apiKey);
      return {
        userId: resolved.userId,
        superAdmin: false,
        apiKeyOrganizationId: resolved.organizationId,
        scopes: resolved.scopes,
      };
    }

    throw new UnauthorizedError('Provide a Bearer token or X-Api-Key header');
  }

  private async enforceOrgRole(request: RequestWithAuth, requiredRoles: string[]): Promise<void> {
    const principal = request.principal as AuthenticatedPrincipal;
    const orgId = (request.params as Record<string, string>).orgId;
    if (!orgId) throw new ForbiddenError('Route is missing organization scope');
    if (principal.superAdmin) return;

    // API keys are bound to one organization regardless of membership.
    if (principal.apiKeyOrganizationId && principal.apiKeyOrganizationId !== orgId) {
      throw new ForbiddenError('API key is not valid for this organization');
    }

    const membership = await this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId: principal.userId, organizationId: orgId } },
    });
    if (!membership) throw new ForbiddenError('Not a member of this organization');

    const minimumRequired = Math.min(...requiredRoles.map((role) => ROLE_RANK[role] ?? 3));
    if ((ROLE_RANK[membership.role] ?? -1) < minimumRequired) {
      throw new ForbiddenError(`Requires role: ${requiredRoles.join(' or ')}`);
    }
  }
}
