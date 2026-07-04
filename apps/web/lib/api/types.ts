/** Shapes returned by apps/api (Prisma models serialized to JSON). */

export type VideoStatus =
  | 'draft'
  | 'queued'
  | 'generating'
  | 'rendering'
  | 'post_processing'
  | 'ready'
  | 'failed'
  | 'cancelled';

export interface Org {
  id: string;
  name: string;
  role: string;
}

export interface Project {
  id: string;
  name: string;
}

export interface Video {
  id: string;
  title: string;
  status: VideoStatus;
  language: string;
  createdAt: string;
  updatedAt: string;
  output: { durationMs?: number } | null;
}

export interface Clip {
  id: string;
  startMs: number;
  endMs: number;
  properties: { label?: string } & Record<string, unknown>;
}

export interface Track {
  id: string;
  kind: 'video' | 'audio' | 'caption' | 'overlay';
  clips: Clip[];
}

export interface Scene {
  id: string;
  order: number;
  durationMs: number | null;
  content: { name?: string; script?: string } & Record<string, unknown>;
  tracks: Track[];
}

export interface VideoDetail extends Video {
  scenes: Scene[];
}

export interface Avatar {
  id: string;
  name: string;
  kind: 'photo' | 'video' | 'three_d' | 'animated_character';
  providerId: string | null;
  createdAt: string;
}

export interface Voice {
  id: string;
  name: string;
  language: string;
  providerId: string;
  externalId: string;
  isCloned: boolean;
}

export interface BrandKit {
  id: string;
  name: string;
  sourceUrl: string | null;
  colors: { primary: string; secondary: string; ink: string; surface: string };
  fonts: { display: string; body: string };
}

export interface WorkflowNode {
  id: string;
  kind: string;
  label: string;
  x: number;
  y: number;
}

export interface Workflow {
  id: string;
  name: string;
  isEnabled: boolean;
  version: number;
  definition: { nodes?: WorkflowNode[]; edges?: Array<{ from: string; to: string }> };
}

export interface Provider {
  id: string;
  capability: string;
  kind: string;
  enabled: boolean;
  priority: number;
  requiresSecrets: string[];
  chainPosition: number | null;
}

export interface Plugin {
  id: string;
  name: string;
  version: string;
  description: string;
  enabled: boolean;
  manifest: { capabilities?: string[]; permissions?: string[] };
}

export interface Monitor {
  queues: Array<{ name: string; active: number; waiting: number }>;
  jobs: Array<{
    id: string;
    stage: string;
    queue: string;
    progress: { percent?: number } | null;
    videoTitle: string;
    startedAt: string | null;
  }>;
}

export interface Stats {
  videosTotal: number;
  videosReady: number;
  jobsInFlight: number;
  workflowsActive: number;
  avgRenderMinutes: number | null;
}

export interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  createdAt: string;
}

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  enabled: boolean;
}

export interface GatewaySettings {
  gateway: 'paystack';
  enabled: boolean;
  publicKey: string | null;
  secretKeyMasked: string | null;
  currency: string;
}

export interface BillingPlan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  amountCents: number;
  currency: string;
  interval: 'monthly' | 'annually';
  paystackPlanCode?: string | null;
  features: string[];
  active?: boolean;
  sortOrder?: number;
}

export interface PublicPlans {
  gateway: { enabled: boolean; currency: string };
  plans: BillingPlan[];
}

export interface OrgSubscription {
  plan: string | null;
  status: string | null;
  currentPeriodEnd: string | null;
  gateway: { enabled: boolean; currency: string; publicKey: string | null };
}

export interface CheckoutSession {
  authorizationUrl: string;
  reference: string;
}
