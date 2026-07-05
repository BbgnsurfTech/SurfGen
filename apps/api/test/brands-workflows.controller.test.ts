import { describe, expect, test, vi } from 'vitest';
import { NotFoundError } from '@surfgen/core';
import { BrandsWorkflowsController } from '../src/workspace/brands-workflows.controller';

const ORG_ID = 'org_1';
const BRAND_KIT_ID = 'kit_1';
const WORKFLOW_ID = 'wf_1';

function makeController() {
  const prisma = {
    brandKit: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async (): Promise<{ id: string; organizationId: string } | null> => null),
      update: vi.fn(async () => ({ id: BRAND_KIT_ID })),
    },
    workflow: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async (): Promise<{ id: string; organizationId: string } | null> => null),
      update: vi.fn(async () => ({ id: WORKFLOW_ID })),
    },
    workflowRun: {
      create: vi.fn(async () => ({ id: 'run_1' })),
    },
  };
  const controller = new BrandsWorkflowsController(prisma as never);
  return { controller, prisma };
}

describe('BrandsWorkflowsController — soft-delete filtering', () => {
  test('listBrandKits excludes soft-deleted brand kits', async () => {
    const { controller, prisma } = makeController();
    await controller.listBrandKits(ORG_ID);
    expect(prisma.brandKit.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ deletedAt: null }) }),
    );
  });

  test('updateBrandKit 404s on an already-deleted brand kit', async () => {
    const { controller, prisma } = makeController();
    await expect(
      controller.updateBrandKit(ORG_ID, BRAND_KIT_ID, {}),
    ).rejects.toThrow(NotFoundError);
    expect(prisma.brandKit.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ deletedAt: null }) }),
    );
  });

  test('deleteBrandKit 404s instead of no-op-ing on an already-deleted brand kit', async () => {
    const { controller, prisma } = makeController();
    await expect(controller.deleteBrandKit(ORG_ID, BRAND_KIT_ID)).rejects.toThrow(NotFoundError);
    expect(prisma.brandKit.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ deletedAt: null }) }),
    );
  });

  test('listWorkflows excludes soft-deleted workflows', async () => {
    const { controller, prisma } = makeController();
    await controller.listWorkflows(ORG_ID);
    expect(prisma.workflow.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ deletedAt: null }) }),
    );
  });

  test('queueRun refuses to queue a run against a soft-deleted workflow', async () => {
    const { controller, prisma } = makeController();
    await expect(controller.queueRun(ORG_ID, WORKFLOW_ID)).rejects.toThrow(NotFoundError);
    expect(prisma.workflow.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ deletedAt: null }) }),
    );
    expect(prisma.workflowRun.create).not.toHaveBeenCalled();
  });

  test('updateWorkflow 404s on an already-deleted workflow', async () => {
    const { controller, prisma } = makeController();
    await expect(controller.updateWorkflow(ORG_ID, WORKFLOW_ID, {})).rejects.toThrow(NotFoundError);
    expect(prisma.workflow.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ deletedAt: null }) }),
    );
  });
});
