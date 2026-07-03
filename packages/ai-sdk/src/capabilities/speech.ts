import type { MediaRef } from '@surfgen/core';

/** Text-to-speech */
export interface TTSInput {
  readonly text: string;
  /** SSML input when the provider supports it (descriptor.features.ssml). */
  readonly ssml?: boolean;
  readonly voiceId: string;
  readonly language?: string;
  readonly speed?: number; // 0.5..2.0, 1 = normal
  readonly pitch?: number; // semitones, 0 = normal
  readonly emotion?: string; // provider-specific style token
  readonly outputFormat?: 'wav' | 'mp3' | 'opus' | 'pcm';
}

export interface TTSOutput {
  readonly audio: MediaRef;
  /** Word-level timestamps when available — feeds subtitle + lipsync stages. */
  readonly wordTimings?: readonly WordTiming[];
}

export interface WordTiming {
  readonly word: string;
  readonly startMs: number;
  readonly endMs: number;
}

/** Automatic speech recognition (Whisper et al.) */
export interface ASRInput {
  readonly audio: MediaRef;
  readonly language?: string; // hint; auto-detect when omitted
  readonly wordTimestamps?: boolean;
}

export interface ASROutput {
  readonly text: string;
  readonly language: string;
  readonly segments: readonly {
    readonly text: string;
    readonly startMs: number;
    readonly endMs: number;
    readonly words?: readonly WordTiming[];
  }[];
}

/** Voice cloning */
export interface VoiceCloneInput {
  readonly name: string;
  /** Reference audio samples, ≥30s combined recommended. */
  readonly samples: readonly MediaRef[];
  readonly language?: string;
  readonly consentToken: string; // explicit consent artifact — required, never optional
}

export interface VoiceCloneOutput {
  /** Provider-scoped voice id usable in TTSInput.voiceId. */
  readonly voiceId: string;
  readonly previewAudio?: MediaRef;
}
