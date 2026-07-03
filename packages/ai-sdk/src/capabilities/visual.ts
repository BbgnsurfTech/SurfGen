import type { MediaRef, Resolution } from '@surfgen/core';

/** Avatar animation: reference identity + driving audio → talking video. */
export interface AvatarInput {
  /** Identity source: registered avatar id or a reference image/video. */
  readonly avatarRef: { readonly avatarId: string } | { readonly image: MediaRef };
  readonly drivingAudio: MediaRef;
  readonly resolution: Resolution;
  readonly emotion?: string;
  readonly gesturePrompt?: string;
  /** Keep eye contact with camera (feature-gated per provider). */
  readonly eyeContact?: boolean;
  readonly background?:
    | { readonly type: 'transparent' }
    | { readonly type: 'color'; readonly hex: string }
    | { readonly type: 'image'; readonly image: MediaRef }
    | { readonly type: 'video'; readonly video: MediaRef };
}

export interface AvatarOutput {
  readonly video: MediaRef;
  readonly hasAlpha: boolean;
}

/** Lip synchronization: existing face video + new audio → re-synced video. */
export interface LipSyncInput {
  readonly video: MediaRef;
  readonly audio: MediaRef;
  /** Restrict sync to a face bounding box when multiple faces exist. */
  readonly faceRegion?: { x: number; y: number; width: number; height: number };
}

export interface LipSyncOutput {
  readonly video: MediaRef;
}

/** Text/image-to-video generation */
export interface VideoGenerationInput {
  readonly prompt: string;
  readonly negativePrompt?: string;
  readonly referenceImage?: MediaRef;
  readonly durationMs: number;
  readonly resolution: Resolution;
  readonly seed?: number;
}

export interface VideoGenerationOutput {
  readonly video: MediaRef;
}

/** Image generation */
export interface ImageGenerationInput {
  readonly prompt: string;
  readonly negativePrompt?: string;
  readonly width: number;
  readonly height: number;
  readonly seed?: number;
  readonly count?: number;
}

export interface ImageGenerationOutput {
  readonly images: readonly MediaRef[];
}

/** Face swap */
export interface FaceSwapInput {
  readonly sourceFace: MediaRef;
  readonly target: MediaRef; // image or video
  readonly consentToken: string; // required — same policy as voice cloning
}

export interface FaceSwapOutput {
  readonly result: MediaRef;
}

/** Static portrait → animated face (talking photo pre-step). */
export interface FaceAnimationInput {
  readonly image: MediaRef;
  readonly drivingAudio?: MediaRef;
  readonly motionPrompt?: string;
}

export interface FaceAnimationOutput {
  readonly video: MediaRef;
}

/** Background removal / replacement matte */
export interface BackgroundRemovalInput {
  readonly media: MediaRef; // image or video
  readonly output: 'alpha' | 'mask' | 'greenscreen';
}

export interface BackgroundRemovalOutput {
  readonly result: MediaRef;
}

/** Motion generation (gesture/body motion from prompt) */
export interface MotionGenerationInput {
  readonly prompt: string;
  readonly durationMs: number;
  readonly skeleton?: 'smpl' | 'mixamo' | 'custom';
}

export interface MotionGenerationOutput {
  /** Motion data file (BVH/FBX/JSON) consumed by the avatar stage. */
  readonly motion: MediaRef;
}
