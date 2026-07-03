import type { AssetId, OrganizationId, ProjectId, VideoId } from '../ids.js';
import type { FrameRate, MediaRef, Resolution } from '../value-objects/media.js';
import type { TransitionTable } from './state-machine.js';

export type VideoStatus =
  | 'draft'
  | 'queued'
  | 'generating'
  | 'rendering'
  | 'post_processing'
  | 'ready'
  | 'failed'
  | 'cancelled'
  | 'archived';

export const VIDEO_TRANSITIONS: TransitionTable<VideoStatus> = {
  draft: ['queued', 'archived'],
  queued: ['generating', 'cancelled'],
  generating: ['rendering', 'failed', 'cancelled'],
  rendering: ['post_processing', 'failed', 'cancelled'],
  post_processing: ['ready', 'failed', 'cancelled'],
  ready: ['archived', 'queued'], // re-render is allowed from ready
  failed: ['queued', 'archived'], // retry from failed
  cancelled: ['queued', 'archived'],
  archived: [],
};

export interface VideoRenderSettings {
  readonly resolution: Resolution;
  readonly frameRate: FrameRate;
  readonly container: 'mp4' | 'webm' | 'mov';
  readonly codec: 'h264' | 'h265' | 'vp9' | 'av1';
  /** Constant rate factor / quality target, encoder-specific range. */
  readonly quality: number;
}

export interface VideoOutput {
  readonly media: MediaRef;
  readonly thumbnail?: MediaRef;
  readonly captions?: MediaRef;
  readonly durationMs: number;
}

export interface VideoSummary {
  readonly id: VideoId;
  readonly organizationId: OrganizationId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly status: VideoStatus;
  readonly language: string;
  readonly settings: VideoRenderSettings;
  readonly output?: VideoOutput;
  readonly sourceAssetIds: readonly AssetId[];
}
