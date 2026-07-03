export type ProviderState = 'Primary' | 'Enabled' | 'Standby' | 'Disabled' | 'Beta';

export interface Provider {
  name: string;
  kind: string;
  mark: string;
  state: ProviderState;
  caps: string[];
  latency: string;
  calls: string;
}

export const PROVIDER_CATEGORIES = [
  ['llm', 'LLM'],
  ['avatar', 'Avatar'],
  ['voice', 'Voice / TTS'],
  ['lipsync', 'Lip-sync'],
  ['video', 'Video Gen'],
  ['image', 'Image'],
  ['translation', 'Translation'],
  ['storage', 'Storage'],
] as const;
export type ProviderCategory = (typeof PROVIDER_CATEGORIES)[number][0];

export const STATE_COLOR: Record<ProviderState, [fg: string, bg: string]> = {
  Primary: ['#4F7C3A', 'rgba(79,124,58,.12)'],
  Enabled: ['#8B5E2F', 'rgba(139,94,47,.1)'],
  Standby: ['#C48A1F', 'rgba(196,138,31,.12)'],
  Disabled: ['#A89684', 'rgba(168,150,132,.14)'],
  Beta: ['#5C7A8B', 'rgba(92,122,139,.14)'],
};

type Row = [string, string, string, ProviderState, string[], string, string];

const DATA: Record<ProviderCategory, Row[]> = {
  llm: [
    ['Anthropic', 'Cloud API', 'AC', 'Primary', ['Script', 'Enhance'], '240ms', '1.2M calls'],
    ['OpenAI', 'Cloud API', 'AI', 'Enabled', ['Script', 'Rewrite'], '310ms', '840k calls'],
    ['Ollama', 'Local · self-hosted', 'OL', 'Enabled', ['Local', 'Offline'], '90ms', 'On-prem'],
    ['Gemini', 'Cloud API', 'GM', 'Standby', ['Script'], '—', 'Failover'],
    ['vLLM', 'Local GPU', 'VL', 'Enabled', ['Batch'], '70ms', 'GPU-3'],
    ['OpenRouter', 'Cloud gateway', 'OR', 'Disabled', ['Routing'], '—', '—'],
  ],
  avatar: [
    ['HeyGen', 'Cloud API', 'HG', 'Enabled', ['Photo', 'Video'], '2.1s', '—'],
    ['D-ID', 'Cloud API', 'DI', 'Standby', ['Talking photo'], '—', 'Failover'],
    ['Tavus', 'Cloud API', 'TV', 'Disabled', ['Realtime'], '—', '—'],
    ['SadTalker', 'Local GPU', 'ST', 'Enabled', ['Photo', 'Local'], '4.8s', 'GPU-1'],
    ['MuseTalk', 'Local GPU', 'MT', 'Primary', ['Lip-sync', 'Local'], '3.2s', 'GPU-2'],
    ['Local 3D', 'Self-hosted', '3D', 'Beta', ['3D'], '6.0s', 'GPU-4'],
  ],
  voice: [
    ['ElevenLabs', 'Cloud API', 'EL', 'Enabled', ['Clone', 'Emotion'], '420ms', '—'],
    ['XTTS', 'Local GPU', 'XT', 'Primary', ['Clone', 'Local'], '180ms', 'GPU-1'],
    ['OpenAI TTS', 'Cloud API', 'AI', 'Enabled', ['Stream'], '260ms', '—'],
    ['Azure', 'Cloud API', 'AZ', 'Standby', ['SSML'], '—', 'Failover'],
    ['Coqui', 'Local', 'CQ', 'Enabled', ['Local'], '150ms', 'CPU'],
    ['Piper', 'Local CLI', 'PP', 'Enabled', ['Fast', 'Edge'], '40ms', 'CPU'],
  ],
  lipsync: [
    ['MuseTalk', 'Local GPU', 'MT', 'Primary', ['HD', 'Local'], '3.2s', 'GPU-2'],
    ['Wav2Lip', 'Local GPU', 'WL', 'Enabled', ['Fast'], '2.1s', 'GPU-1'],
    ['SadTalker', 'Local GPU', 'ST', 'Enabled', ['Expressive'], '4.8s', 'GPU-1'],
    ['EchoMimic', 'Local GPU', 'EM', 'Beta', ['Emotion'], '5.1s', 'GPU-4'],
  ],
  video: [
    ['Runway', 'Cloud API', 'RW', 'Standby', ['T2V'], '—', 'Failover'],
    ['LTX Video', 'Local GPU', 'LT', 'Enabled', ['Fast T2V'], '8s', 'GPU-3'],
    ['Hunyuan', 'Local GPU', 'HY', 'Beta', ['HD'], '22s', 'GPU-4'],
    ['CogVideoX', 'Local GPU', 'CV', 'Enabled', ['T2V'], '15s', 'GPU-3'],
    ['Wan', 'Local GPU', 'WN', 'Disabled', ['I2V'], '—', '—'],
  ],
  image: [
    ['Flux', 'Local GPU', 'FX', 'Primary', ['T2I'], '2.4s', 'GPU-2'],
    ['SDXL', 'Local GPU', 'SX', 'Enabled', ['T2I'], '1.9s', 'GPU-2'],
    ['ComfyUI', 'Local · graph', 'CU', 'Enabled', ['Workflow'], 'varies', 'GPU-3'],
    ['Automatic1111', 'Local WebUI', 'A1', 'Standby', ['T2I'], '—', '—'],
  ],
  translation: [
    ['DeepL', 'Cloud API', 'DL', 'Primary', ['40 langs'], '180ms', '—'],
    ['NLLB', 'Local', 'NL', 'Enabled', ['200 langs', 'Local'], '90ms', 'GPU-3'],
    ['Google', 'Cloud API', 'GG', 'Standby', ['Broad'], '—', 'Failover'],
    ['Azure', 'Cloud API', 'AZ', 'Enabled', ['Docs'], '210ms', '—'],
  ],
  storage: [
    ['MinIO', 'Self-hosted S3', 'MI', 'Primary', ['S3', 'On-prem'], '12ms', 'On-prem'],
    ['AWS S3', 'Cloud', 'S3', 'Enabled', ['Durable'], '40ms', '—'],
    ['Cloudflare R2', 'Cloud', 'R2', 'Enabled', ['Zero-egress'], '35ms', '—'],
    ['Local NAS', 'On-prem', 'NA', 'Standby', ['Archive'], '—', '—'],
  ],
};

export const PROVIDERS_BY_CATEGORY: Record<ProviderCategory, Provider[]> = Object.fromEntries(
  Object.entries(DATA).map(([category, rows]) => [
    category,
    rows.map(([name, kind, mark, state, caps, latency, calls]) => ({ name, kind, mark, state, caps, latency, calls })),
  ]),
) as Record<ProviderCategory, Provider[]>;
