import { describe, expect, test } from 'vitest';
import { LanguageTag } from '../src/value-objects/language.js';
import { aspectRatioOf, createResolution, RESOLUTIONS } from '../src/value-objects/media.js';
import { isErr, unwrap } from '../src/result.js';
import { NotFoundError, ProviderError, QuotaExceededError, isDomainError } from '../src/errors.js';

describe('LanguageTag', () => {
  test('normalizes case and separators', () => {
    expect(unwrap(LanguageTag.create('EN')).value).toBe('en');
    expect(unwrap(LanguageTag.create('pt_br')).value).toBe('pt-BR');
    expect(unwrap(LanguageTag.create(' fr-CA ')).value).toBe('fr-CA');
  });

  test('rejects malformed tags', () => {
    for (const bad of ['', 'e', 'english', 'en-USA', '12', 'en-1']) {
      expect(isErr(LanguageTag.create(bad)), `expected reject: ${bad}`).toBe(true);
    }
  });

  test('primary subtag and matching', () => {
    const ptBR = unwrap(LanguageTag.create('pt-BR'));
    const ptPT = unwrap(LanguageTag.create('pt-PT'));
    const en = unwrap(LanguageTag.create('en'));
    expect(ptBR.primary).toBe('pt');
    expect(ptBR.matchesPrimary(ptPT)).toBe(true);
    expect(ptBR.matchesPrimary(en)).toBe(false);
    expect(ptBR.equals(ptPT)).toBe(false);
  });
});

describe('Resolution', () => {
  test('accepts standard presets', () => {
    for (const preset of Object.values(RESOLUTIONS)) {
      expect(unwrap(createResolution(preset.width, preset.height))).toEqual(preset);
    }
  });

  test('rejects odd, zero, negative, and fractional dimensions', () => {
    expect(isErr(createResolution(1921, 1080))).toBe(true); // odd
    expect(isErr(createResolution(0, 1080))).toBe(true);
    expect(isErr(createResolution(-1920, 1080))).toBe(true);
    expect(isErr(createResolution(1920.5, 1080))).toBe(true);
  });

  test('aspect ratio detection', () => {
    expect(aspectRatioOf(RESOLUTIONS.fullHd)).toBe('16:9');
    expect(aspectRatioOf(RESOLUTIONS.verticalFullHd)).toBe('9:16');
    expect(aspectRatioOf(RESOLUTIONS.square)).toBe('1:1');
    expect(aspectRatioOf({ width: 1080, height: 1350 })).toBe('4:5');
    expect(aspectRatioOf({ width: 100, height: 37 })).toBeNull();
  });
});

describe('DomainError', () => {
  test('carries stable codes and structured details', () => {
    const e = new NotFoundError('Video', 'vid_123');
    expect(e.code).toBe('NOT_FOUND');
    expect(e.details).toEqual({ resource: 'Video', id: 'vid_123' });
    expect(isDomainError(e)).toBe(true);
    expect(isDomainError(new Error('plain'))).toBe(false);
  });

  test('provider errors are retryable by default', () => {
    expect(new ProviderError('tts-piper', 'timeout').retryable).toBe(true);
  });

  test('quota errors expose limit and usage', () => {
    const e = new QuotaExceededError('render.minutes', 100, 120);
    expect(e.details).toMatchObject({ quota: 'render.minutes', limit: 100, used: 120 });
    expect(e.retryable).toBe(false);
  });
});
