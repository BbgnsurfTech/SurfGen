import { describe, expect, test } from 'vitest';
import { LOCAL_RUNTIME_PROBES, detectLocalRuntimes } from '../src/discovery.js';

describe('detectLocalRuntimes', () => {
  test('returns only runtimes whose probe responds ok', async () => {
    // Arrange
    const fetchStub = async (url: string) => ({ ok: url.includes(':11434') || url.includes(':8188') });

    // Act
    const detected = await detectLocalRuntimes(fetchStub);

    // Assert
    expect(detected.map((runtime) => runtime.id).sort()).toEqual(['comfyui', 'ollama']);
  });

  test('treats network errors as absent, not failures', async () => {
    const fetchStub = async () => {
      throw new Error('ECONNREFUSED');
    };

    await expect(detectLocalRuntimes(fetchStub)).resolves.toEqual([]);
  });

  test('treats non-ok responses as absent', async () => {
    const fetchStub = async () => ({ ok: false });

    await expect(detectLocalRuntimes(fetchStub)).resolves.toEqual([]);
  });

  test('probe list covers the well-known local runtimes', () => {
    expect(LOCAL_RUNTIME_PROBES.map((probe) => probe.id)).toEqual([
      'ollama',
      'lmstudio',
      'vllm',
      'comfyui',
      'a1111',
    ]);
    for (const probe of LOCAL_RUNTIME_PROBES) {
      expect(probe.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);
    }
  });
});
