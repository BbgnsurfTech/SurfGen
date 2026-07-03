import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { collectFinalOutput } from '@surfgen/ai-sdk';
import { PiperTTSProvider } from '../src/index.js';

/**
 * Piper is exercised through a shim executable that mimics its CLI contract
 * (reads text on stdin, honors --output_file), so the provider's process
 * handling is tested without requiring the real binary.
 */
const shimDir = mkdtempSync(join(tmpdir(), 'piper-shim-'));
const shimPath = join(shimDir, 'piper-shim.mjs');
writeFileSync(
  shimPath,
  `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
const outIndex = process.argv.indexOf('--output_file');
const outputFile = process.argv[outIndex + 1];
let text = '';
process.stdin.on('data', (chunk) => (text += chunk));
process.stdin.on('end', () => {
  // 44-byte fake WAV header + text payload
  writeFileSync(outputFile, Buffer.concat([Buffer.alloc(44, 1), Buffer.from(JSON.parse(text))]));
  process.exit(0);
});
`,
);
chmodSync(shimPath, 0o755);
afterAll(() => rmSync(shimDir, { recursive: true, force: true }));

async function makeProvider() {
  const provider = new PiperTTSProvider();
  await provider.initialize({
    id: 'tts-piper',
    capability: 'tts',
    enabled: true,
    priority: 10,
    options: { command: shimPath, modelPath: '/models/en_US-amy-medium.onnx' },
  });
  return provider;
}

describe('PiperTTSProvider', () => {
  test('synthesizes via CLI and returns wav bytes', async () => {
    const provider = await makeProvider();
    const usage: Array<[string, number]> = [];
    const output = await collectFinalOutput(
      provider.generate(
        { text: 'hello from piper', voiceId: 'amy' },
        { recordUsage: (m, q) => usage.push([m, q]) },
      ),
    );
    expect(output.audio.contentType).toBe('audio/wav');
    expect(output.audio.sizeBytes).toBeGreaterThan(44);
    expect(usage).toEqual([['tts.characters', 'hello from piper'.length]]);
  });

  test('declares itself local and free', async () => {
    const provider = await makeProvider();
    const descriptor = provider.capabilities();
    expect(descriptor.deployment).toBe('local');
    expect(descriptor.costHint?.amount).toBe(0);
    expect(descriptor.features.offline).toBe(true);
  });
});
