import { z } from 'zod';

export const ProgressUpdateSchema = z.object({
  percent: z.number().min(0).max(100),
  message: z.string().max(2000).optional(),
  /** Opaque resume checkpoint persisted with the job. */
  checkpoint: z.record(z.string(), z.unknown()).optional(),
});

export type ProgressUpdate = z.infer<typeof ProgressUpdateSchema>;

export const clampPercent = (value: number): number =>
  Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
