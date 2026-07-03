import type { AiConfig, ModelsConfig, ProvidersConfig, StorageConfig, VideoConfig } from './schemas.js';

/**
 * Zero-credential defaults: a fresh checkout works end-to-end using only
 * local providers (mock/piper/ollama/ffmpeg). Cloud providers are opt-in.
 */
export const DEFAULT_AI_CONFIG: AiConfig = {
  capabilities: {
    llm: { chain: [{ provider: 'llm-ollama', priority: 10, enabled: true }, { provider: 'llm-mock', priority: 100, enabled: true }] },
    tts: { chain: [{ provider: 'tts-piper', priority: 10, enabled: true }, { provider: 'tts-mock', priority: 100, enabled: true }] },
    asr: { chain: [{ provider: 'asr-whisper', priority: 10, enabled: true }, { provider: 'asr-mock', priority: 100, enabled: true }] },
    translation: { chain: [{ provider: 'translation-mock', priority: 100, enabled: true }] },
    avatar: { chain: [{ provider: 'avatar-mock', priority: 100, enabled: true }] },
    lipsync: { chain: [{ provider: 'lipsync-mock', priority: 100, enabled: true }] },
  },
  routing: { preferDeployment: 'local' },
};

export const DEFAULT_PROVIDERS_CONFIG: ProvidersConfig = { providers: [] };

export const DEFAULT_MODELS_CONFIG: ModelsConfig = { models: [] };

export const DEFAULT_STORAGE_CONFIG: StorageConfig = {
  driver: 'local',
  local: { rootDir: './storage/local' },
  signedUrlTtlSeconds: 900,
};

export const DEFAULT_VIDEO_CONFIG: VideoConfig = {
  defaults: {
    resolution: { width: 1920, height: 1080 },
    frameRate: 30,
    container: 'mp4',
    codec: 'h264',
    quality: 23,
  },
  limits: {
    maxDurationSeconds: 1800,
    maxConcurrentRendersPerOrg: 10,
  },
};
