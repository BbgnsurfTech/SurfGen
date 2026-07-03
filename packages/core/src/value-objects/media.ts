import { ValidationError } from '../errors.js';
import type { Result } from '../result.js';
import { err, ok } from '../result.js';

export type VideoContainer = 'mp4' | 'webm' | 'mov';
export type VideoCodec = 'h264' | 'h265' | 'vp9' | 'av1' | 'prores';
export type AudioFormat = 'wav' | 'mp3' | 'aac' | 'opus' | 'flac' | 'pcm';
export type ImageFormat = 'png' | 'jpeg' | 'webp' | 'avif';

export interface Resolution {
  readonly width: number;
  readonly height: number;
}

export const RESOLUTIONS = {
  sd: { width: 854, height: 480 },
  hd: { width: 1280, height: 720 },
  fullHd: { width: 1920, height: 1080 },
  uhd4k: { width: 3840, height: 2160 },
  verticalHd: { width: 720, height: 1280 },
  verticalFullHd: { width: 1080, height: 1920 },
  square: { width: 1080, height: 1080 },
} as const satisfies Record<string, Resolution>;

export type AspectRatio = '16:9' | '9:16' | '1:1' | '4:5';

const ASPECT_TOLERANCE = 0.01;

const ASPECT_VALUES: Record<AspectRatio, number> = {
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '1:1': 1,
  '4:5': 4 / 5,
};

export function aspectRatioOf(resolution: Resolution): AspectRatio | null {
  const ratio = resolution.width / resolution.height;
  for (const [name, value] of Object.entries(ASPECT_VALUES) as [AspectRatio, number][]) {
    if (Math.abs(ratio - value) < ASPECT_TOLERANCE) return name;
  }
  return null;
}

export function createResolution(width: number, height: number): Result<Resolution, ValidationError> {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return err(
      new ValidationError(`Invalid resolution: ${width}x${height}`, { details: { width, height } }),
    );
  }
  // Encoders require even dimensions for 4:2:0 chroma subsampling.
  if (width % 2 !== 0 || height % 2 !== 0) {
    return err(
      new ValidationError(`Resolution dimensions must be even: ${width}x${height}`, {
        details: { width, height },
      }),
    );
  }
  return ok({ width, height });
}

/** Frames per second — constrained to values the render pipeline supports. */
export const SUPPORTED_FRAME_RATES = [24, 25, 30, 50, 60] as const;
export type FrameRate = (typeof SUPPORTED_FRAME_RATES)[number];

export interface MediaRef {
  /** Storage key (not a URL) — resolve through StoragePort for access. */
  readonly storageKey: string;
  readonly contentType: string;
  readonly sizeBytes?: number;
  readonly durationMs?: number;
}
