import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { buildSrt } from '../src/stages/handlers.js';
import { isFfmpegAvailable, probeDurationMs, runFfmpeg } from '../src/ffmpeg.js';

describe('buildSrt', () => {
  test('uses word timings when available', () => {
    const srt = buildSrt('ignored', [
      { word: 'Hello', startMs: 0, endMs: 400 },
      { word: 'world', startMs: 400, endMs: 900 },
    ]);
    expect(srt).toContain('1\n00:00:00,000 --> 00:00:00,900\nHello world');
  });

  test('falls back to evenly-paced captions from text', () => {
    const words = Array.from({ length: 20 }, (_, i) => `w${i}`).join(' ');
    const srt = buildSrt(words, []);
    const blocks = srt.trim().split('\n\n');
    expect(blocks).toHaveLength(3); // 20 words / 8 per caption
    expect(blocks[0]).toContain('w0 w1 w2 w3 w4 w5 w6 w7');
    expect(srt).toMatch(/\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}/);
  });

  test('empty input produces empty srt', () => {
    expect(buildSrt('', [])).toBe('');
  });
});

const ffmpegPresent = await isFfmpegAvailable();

describe.skipIf(!ffmpegPresent)('ffmpeg integration (requires ffmpeg on PATH)', () => {
  const workDir = mkdtempSync(join(tmpdir(), 'surfgen-ffmpeg-'));
  afterAll(() => rmSync(workDir, { recursive: true, force: true }));

  test('renders a color clip and probes its duration', async () => {
    const outPath = join(workDir, 'clip.mp4');
    await runFfmpeg([
      '-y',
      '-f', 'lavfi',
      '-i', 'color=c=0x10101c:s=320x180:r=30',
      '-t', '2',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      outPath,
    ]);
    const durationMs = await probeDurationMs(outPath);
    expect(durationMs).toBeGreaterThanOrEqual(1900);
    expect(durationMs).toBeLessThanOrEqual(2200);
  }, 60_000);

  test('extracts a thumbnail frame', async () => {
    const videoPath = join(workDir, 'clip.mp4');
    const thumbPath = join(workDir, 'thumb.jpg');
    await runFfmpeg(['-y', '-i', videoPath, '-vf', 'thumbnail,scale=160:-2', '-frames:v', '1', thumbPath]);
    const { readFileSync } = await import('node:fs');
    const bytes = readFileSync(thumbPath);
    // Valid JPEG: SOI marker at start, EOI at end.
    expect(bytes.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect(bytes.subarray(-2)).toEqual(Buffer.from([0xff, 0xd9]));
  }, 60_000);
});

describe.runIf(!ffmpegPresent)('ffmpeg missing', () => {
  test('integration render tests were skipped (install ffmpeg to enable)', () => {
    expect(ffmpegPresent).toBe(false);
  });
});
