import { MockProvider } from '@surfgen/ai-sdk';
import { providerConformanceSuite } from '../src/conformance.js';

/** The conformance suite must pass against the reference MockProvider. */
providerConformanceSuite(
  'mock-tts',
  () =>
    new MockProvider<{ text: string }, { audio: string }>({
      id: 'tts-mock',
      capability: 'tts',
      progressSteps: 2,
      produce: (input) => ({ audio: `pcm:${input.text}` }),
    }),
  { sampleInput: { text: 'hello world' } },
);
