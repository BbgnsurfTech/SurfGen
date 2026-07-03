import { z } from 'zod';

/** Keep in sync with CAPABILITIES in @surfgen/ai-sdk (config stays dependency-light). */
export const KNOWN_CAPABILITIES = [
  'llm',
  'tts',
  'asr',
  'voice_clone',
  'translation',
  'embeddings',
  'avatar',
  'talking_photo',
  'lipsync',
  'video_generation',
  'image_generation',
  'face_swap',
  'face_animation',
  'background_removal',
  'motion_generation',
] as const;

const capabilityKey = z.enum(KNOWN_CAPABILITIES);

/** Secrets are references, never literals: env:NAME, vault:path, file:/path */
const secretRef = z
  .string()
  .regex(/^(env|vault|file):.+$/, 'secret values must be references (env:NAME, vault:path, file:path)');

// ---------------------------------------------------------------------------
// ai.yaml — capability → provider chain routing
// ---------------------------------------------------------------------------
export const AiConfigSchema = z.object({
  capabilities: z.record(
    capabilityKey,
    z.object({
      chain: z
        .array(
          z.object({
            provider: z.string().min(1),
            priority: z.number().int().min(0).default(100),
            enabled: z.boolean().default(true),
          }),
        )
        .min(1),
    }),
  ),
  routing: z
    .object({
      preferDeployment: z.enum(['cloud', 'local', 'self_hosted']).optional(),
    })
    .optional(),
});
export type AiConfig = z.infer<typeof AiConfigSchema>;

// ---------------------------------------------------------------------------
// providers.json — provider instance definitions
// ---------------------------------------------------------------------------
export const ProviderDefinitionSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/, 'kebab-case id required'),
  capability: capabilityKey,
  kind: z.enum(['http', 'cli', 'python', 'docker', 'grpc', 'onnx']),
  enabled: z.boolean().default(true),
  priority: z.number().int().min(0).default(100),
  options: z.record(z.string(), z.unknown()).default({}),
  secrets: z.record(z.string(), secretRef).optional(),
});

export const ProvidersConfigSchema = z
  .object({ providers: z.array(ProviderDefinitionSchema) })
  .refine(
    (cfg) => new Set(cfg.providers.map((p) => p.id)).size === cfg.providers.length,
    'provider ids must be unique',
  );
export type ProvidersConfig = z.infer<typeof ProvidersConfigSchema>;
export type ProviderDefinition = z.infer<typeof ProviderDefinitionSchema>;

// ---------------------------------------------------------------------------
// models.yaml — model catalog (cloud + discovered local)
// ---------------------------------------------------------------------------
export const ModelsConfigSchema = z.object({
  models: z
    .array(
      z.object({
        id: z.string().min(1),
        provider: z.string().min(1),
        capability: capabilityKey,
        contextWindow: z.number().int().positive().optional(),
        parameters: z.record(z.string(), z.unknown()).optional(),
        localPath: z.string().optional(),
        autoDiscover: z.boolean().default(false),
      }),
    )
    .default([]),
});
export type ModelsConfig = z.infer<typeof ModelsConfigSchema>;

// ---------------------------------------------------------------------------
// storage.yaml
// ---------------------------------------------------------------------------
export const StorageConfigSchema = z
  .object({
    driver: z.enum(['s3', 'local']),
    s3: z
      .object({
        endpoint: z.string().url().optional(),
        region: z.string().default('us-east-1'),
        bucket: z.string().min(1),
        accessKeyRef: secretRef,
        secretKeyRef: secretRef,
        forcePathStyle: z.boolean().default(false),
      })
      .optional(),
    local: z.object({ rootDir: z.string().min(1) }).optional(),
    signedUrlTtlSeconds: z.number().int().positive().default(900),
    cdn: z.object({ baseUrl: z.string().url() }).optional(),
  })
  .refine((cfg) => cfg.driver !== 's3' || cfg.s3 !== undefined, 's3 driver requires s3 block')
  .refine(
    (cfg) => cfg.driver !== 'local' || cfg.local !== undefined,
    'local driver requires local block',
  );
export type StorageConfig = z.infer<typeof StorageConfigSchema>;

// ---------------------------------------------------------------------------
// video.yaml
// ---------------------------------------------------------------------------
export const VideoConfigSchema = z.object({
  defaults: z.object({
    resolution: z.object({
      width: z.number().int().positive().multipleOf(2),
      height: z.number().int().positive().multipleOf(2),
    }),
    frameRate: z.union([
      z.literal(24),
      z.literal(25),
      z.literal(30),
      z.literal(50),
      z.literal(60),
    ]),
    container: z.enum(['mp4', 'webm', 'mov']),
    codec: z.enum(['h264', 'h265', 'vp9', 'av1']),
    quality: z.number().int().min(0).max(63),
  }),
  limits: z.object({
    maxDurationSeconds: z.number().int().positive(),
    maxConcurrentRendersPerOrg: z.number().int().positive(),
  }),
  watermark: z
    .object({ enabled: z.boolean(), imagePath: z.string().optional() })
    .optional(),
});
export type VideoConfig = z.infer<typeof VideoConfigSchema>;

export interface ConfigBundle {
  ai: AiConfig;
  providers: ProvidersConfig;
  models: ModelsConfig;
  storage: StorageConfig;
  video: VideoConfig;
}
