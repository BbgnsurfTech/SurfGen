import { MockProvider, type ProviderRegistry } from '@surfgen/ai-sdk';
import { definePlugin } from '@surfgen/plugin-sdk';
import manifest from '../plugin.manifest.json' with { type: 'json' };

/**
 * Mock providers for every core capability at priority 100 — the guaranteed
 * fallback chain that makes a zero-credential checkout fully functional.
 * Outputs are deterministic and clearly labeled as mock artifacts.
 */
const MOCK_PRIORITY = 100;

function registerMocks(registry: ProviderRegistry): void {
  registry.register(
    new MockProvider<{ messages: { content: string }[] }, { text: string; finishReason: string }>({
      id: 'llm-mock',
      capability: 'llm',
      produce: (input) => ({
        text: `[mock-llm] ${input.messages.at(-1)?.content ?? ''}`.slice(0, 4000),
        finishReason: 'stop',
      }),
    }),
    { priority: MOCK_PRIORITY },
  );

  registry.register(
    new MockProvider<{ text: string; voiceId: string }, { audio: { storageKey: string; contentType: string } }>({
      id: 'tts-mock',
      capability: 'tts',
      progressSteps: 2,
      produce: (input) => ({
        audio: {
          storageKey: `mock/tts/${input.voiceId}/${Buffer.from(input.text).length}.wav`,
          contentType: 'audio/wav',
        },
      }),
    }),
    { priority: MOCK_PRIORITY },
  );

  registry.register(
    new MockProvider<{ audio: unknown }, { text: string; language: string; segments: [] }>({
      id: 'asr-mock',
      capability: 'asr',
      produce: () => ({ text: '[mock transcription]', language: 'en', segments: [] }),
    }),
    { priority: MOCK_PRIORITY },
  );

  registry.register(
    new MockProvider<{ text: string; targetLanguage: string }, { text: string }>({
      id: 'translation-mock',
      capability: 'translation',
      produce: (input) => ({ text: `[${input.targetLanguage}] ${input.text}` }),
    }),
    { priority: MOCK_PRIORITY },
  );

  registry.register(
    new MockProvider<unknown, { video: { storageKey: string; contentType: string }; hasAlpha: boolean }>({
      id: 'avatar-mock',
      capability: 'avatar',
      progressSteps: 4,
      produce: () => ({
        video: { storageKey: 'mock/avatar/talking-head.mp4', contentType: 'video/mp4' },
        hasAlpha: false,
      }),
    }),
    { priority: MOCK_PRIORITY },
  );

  registry.register(
    new MockProvider<unknown, { video: { storageKey: string; contentType: string } }>({
      id: 'lipsync-mock',
      capability: 'lipsync',
      progressSteps: 3,
      produce: () => ({
        video: { storageKey: 'mock/lipsync/synced.mp4', contentType: 'video/mp4' },
      }),
    }),
    { priority: MOCK_PRIORITY },
  );

  registry.register(
    new MockProvider<{ prompt: string }, { images: { storageKey: string; contentType: string }[] }>({
      id: 'image-mock',
      capability: 'image_generation',
      produce: () => ({
        images: [{ storageKey: 'mock/image/generated.png', contentType: 'image/png' }],
      }),
    }),
    { priority: MOCK_PRIORITY },
  );
}

export default definePlugin({
  manifest,
  register: async (registry) => registerMocks(registry),
});
