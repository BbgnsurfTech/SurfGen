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

type WhereArgs = { where?: Record<string, unknown> };

/**
 * Merge the deletedAt guard as an AND term so caller predicates can never
 * clobber it. A caller that explicitly filters on deletedAt (e.g. an admin
 * "show deleted" view) opts out by naming the field itself.
 */
function guardWhere(args: WhereArgs): void {
  const where = args.where ?? {};
  if ('deletedAt' in where) return; // explicit caller intent wins
  args.where = { AND: [{ deletedAt: null }, where] };
}

const GUARDED_OPERATIONS = [
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
] as const;

/**
 * Soft-delete guard covering reads AND writes: soft-deleted rows are invisible
 * to queries and immune to updates/deletes unless the caller explicitly
 * filters on deletedAt. Relies on Prisma's extended-where-unique (GA ≥5.0)
 * for the unique-input operations.
 */
export function withSoftDelete(client: PrismaClient): PrismaClient {
  const handlers = Object.fromEntries(
    GUARDED_OPERATIONS.map((operation) => [
      operation,
      async ({
        model,
        args,
        query,
      }: {
        model: string;
        args: WhereArgs;
        query: (args: WhereArgs) => Promise<unknown>;
      }) => {
        if ((SOFT_DELETABLE_MODELS as readonly string[]).includes(model)) {
          guardWhere(args);
        }
        return query(args);
      },
    ]),
  );
  return client.$extends({ query: { $allModels: handlers } }) as unknown as PrismaClient;
}
export * from './outbox-store.js';
