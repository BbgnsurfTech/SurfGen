import { PrismaClient, Prisma } from '@prisma/client';

export { PrismaClient, Prisma };
export type * from '@prisma/client';

export interface CreateClientOptions {
  readonly databaseUrl?: string;
  readonly logQueries?: boolean;
}

/** Create a configured Prisma client. Services own their client lifecycle. */
export function createPrismaClient(options: CreateClientOptions = {}): PrismaClient {
  return new PrismaClient({
    ...(options.databaseUrl && {
      datasources: { db: { url: options.databaseUrl } },
    }),
    log: options.logQueries ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });
}

/**
 * Soft-delete guard: extend queries on soft-deletable models to exclude
 * deleted rows unless explicitly requested.
 */
export const SOFT_DELETABLE_MODELS = [
  'User',
  'Organization',
  'Team',
  'Project',
  'Video',
  'Asset',
  'Template',
  'Avatar',
  'Voice',
  'Workflow',
] as const;

export function withSoftDelete(client: PrismaClient): PrismaClient {
  return client.$extends({
    query: {
      $allModels: {
        async findMany({ model, args, query }) {
          if ((SOFT_DELETABLE_MODELS as readonly string[]).includes(model)) {
            args.where = { deletedAt: null, ...args.where };
          }
          return query(args);
        },
        async findFirst({ model, args, query }) {
          if ((SOFT_DELETABLE_MODELS as readonly string[]).includes(model)) {
            args.where = { deletedAt: null, ...args.where };
          }
          return query(args);
        },
      },
    },
  }) as unknown as PrismaClient;
}
export * from "./outbox-store.js";
