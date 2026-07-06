import { z } from 'zod';

/** Shared cursor-pagination query for org-scoped list endpoints. */
export const ListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListQuery = z.infer<typeof ListQuerySchema>;

/**
 * Trims the sentinel row fetched via `take: limit + 1` and derives the next
 * cursor — pair with `...cursorArgs(query)` on the findMany call.
 */
export function pageResult<T extends { id: string }>(rows: T[], limit: number) {
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, -1) : rows;
  return { data: page, meta: { cursor: hasMore ? (page.at(-1)?.id ?? null) : null } };
}

/** Prisma findMany args for a cursor-paginated page. */
export function cursorArgs(query: ListQuery) {
  return {
    take: query.limit + 1,
    ...(query.cursor && { cursor: { id: query.cursor }, skip: 1 }),
  };
}
