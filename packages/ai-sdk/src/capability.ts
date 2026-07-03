/**
 * The closed set of AI capabilities SurfGen orchestrates. Every provider
 * implements exactly one capability; application code requests capabilities,
 * never concrete providers.
 */
export const CAPABILITIES = [
  'llm',
  'tts',
  'asr',
  'voice_clone',
  'translation',
  'embeddings',
  'avatar',
  'talking_photo',
  'lipsync',
  'video_generation',
  'image_generation',
  'face_swap',
  'face_animation',
  'background_removal',
  'motion_generation',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export const isCapability = (value: string): value is Capability =>
  (CAPABILITIES as readonly string[]).includes(value);

/**
 * Self-description a provider publishes after initialize(). The registry uses
 * it for routing (formats, languages, limits); the UI uses it for display.
 */
export interface CapabilityDescriptor {
  readonly capability: Capability;
  /** Human-readable display name of the underlying model/service. */
  readonly displayName: string;
  /** Deployment class — used for data-residency routing policies. */
  readonly deployment: 'cloud' | 'local' | 'self_hosted';
  readonly streaming: boolean;
  /** BCP-47 tags; empty array = language-agnostic. */
  readonly languages: readonly string[];
  /** Input/output media formats where applicable. */
  readonly inputFormats: readonly string[];
  readonly outputFormats: readonly string[];
  /** Approximate relative cost per unit (provider-declared, for routing). */
  readonly costHint?: { unit: string; amount: number; currency: string };
  /** Arbitrary provider-specific feature flags (e.g. { emotions: true }). */
  readonly features: Readonly<Record<string, boolean | number | string>>;
}
