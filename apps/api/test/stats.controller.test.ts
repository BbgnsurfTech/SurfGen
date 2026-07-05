import { describe, expect, test, vi } from 'vitest';
import { StatsController } from '../src/workspace/stats.controller';

const ORG_ID = 'org_1';

function makeController() {
  const prisma = {
    video: { count: vi.fn(async () => 0) },
    job: { count: vi.fn(async () => 0) },
    workflow: { count: vi.fn(async () => 0) },
    pipelineRun: { findMany: vi.fn(async () => []) },
  };
  const controller = new StatsController(prisma as never);
  return { controller, prisma };
}

describe('StatsController — soft-delete filtering', () => {
  test('workflowsActive excludes soft-deleted workflows from the count', async () => {
    const { controller, prisma } = makeController();
    await controller.get(ORG_ID);
    expect(prisma.workflow.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ deletedAt: null }) }),
    );
  });
});
