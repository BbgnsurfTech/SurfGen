export const DEV_SNIPPETS: Record<'curl' | 'node' | 'python', string> = {
  curl: `curl -X POST https://api.surfgen.io/v1/videos \\
  -H "Authorization: Bearer sk_live_••••7f3a" \\
  -H "Content-Type: application/json" \\
  -d '{
    "script": "Welcome to BBGNSURF.",
    "avatar": "amara-studio",
    "voice":  "amara-clone",
    "brand":  "bbgnsurf-core",
    "lipsync": { "provider": "musetalk" },
    "webhook": "https://you.dev/hooks/surfgen"
  }'`,
  node: `import { SurfGen } from "@surfgen/sdk";

const sg = new SurfGen(process.env.SURFGEN_KEY);

const job = await sg.videos.create({
  script:  "Welcome to BBGNSURF.",
  avatar:  "amara-studio",
  voice:   "amara-clone",
  brand:   "bbgnsurf-core",
  lipsync: { provider: "musetalk" },
});

// stream stage-by-stage progress
for await (const ev of sg.videos.stream(job.id)) {
  console.log(ev.stage, ev.progress);
}`,
  python: `from surfgen import SurfGen

sg = SurfGen(api_key=os.environ["SURFGEN_KEY"])

job = sg.videos.create(
    script="Welcome to BBGNSURF.",
    avatar="amara-studio",
    voice="amara-clone",
    brand="bbgnsurf-core",
    lipsync={"provider": "musetalk"},
)

video = sg.videos.wait(job.id)      # blocks until rendered
print(video.url)`,
};

export const API_KEYS = [
  { name: 'Production', key: 'sk_live_a1b9•••••••••7f3a', scope: 'Full access', dot: '#4F7C3A', used: '2h ago' },
  { name: 'Staging', key: 'sk_test_66c2•••••••••e0d1', scope: 'Full access', dot: '#C48A1F', used: '1d ago' },
  { name: 'CI · read-only', key: 'sk_ro_9f4d••••••••••2b7c', scope: 'Read only', dot: '#5C7A8B', used: '5d ago' },
];

export const METHOD_COLOR: Record<string, string> = {
  POST: '#4F7C3A',
  GET: '#5C7A8B',
  DELETE: '#A8442B',
  WS: '#7A4F22',
};

export const ENDPOINTS: Array<[method: string, path: string, desc: string]> = [
  ['POST', '/v1/videos', 'Create a render job'],
  ['GET', '/v1/videos/{id}', 'Fetch job status & output'],
  ['WS', '/v1/videos/{id}/stream', 'Live per-stage progress'],
  ['POST', '/v1/avatars', 'Register a photo / video avatar'],
  ['POST', '/v1/voices/clone', 'Clone a voice from a sample'],
  ['POST', '/v1/brands', 'Create or generate a brand kit'],
  ['GET', '/v1/providers', 'List enabled AI providers'],
  ['DELETE', '/v1/videos/{id}', 'Cancel a running job'],
];

export const WEBHOOK_EVENTS: Array<[event: string, desc: string, dot: string]> = [
  ['video.completed', 'Render finished · signed URL ready', '#4F7C3A'],
  ['video.progress', 'Stage advanced (voice → lip-sync → render)', '#5C7A8B'],
  ['video.failed', 'A stage exhausted its retries', '#A8442B'],
  ['voice.cloned', 'Voice clone training finished', '#8B5E2F'],
];

export const SURFACES: Array<{ icon: string; label: string; desc: string; tag: string; bg: string }> = [
  { icon: 'braces', label: 'REST API', desc: 'Resource CRUD over HTTPS with idempotency keys', tag: 'OpenAPI 3.1', bg: '#8B5E2F' },
  { icon: 'share-2', label: 'GraphQL', desc: 'Typed queries & subscriptions at /graphql', tag: 'SDL', bg: '#A67040' },
  { icon: 'radio', label: 'WebSocket', desc: 'Live job progress & realtime avatar streams', tag: 'ws://', bg: '#5C7A8B' },
  { icon: 'zap', label: 'gRPC', desc: 'Low-latency internal provider calls', tag: 'proto3', bg: '#7A4F22' },
];

export const SDKS: Array<{ pkg: string; lang: string; cmd: string; bg: string }> = [
  { pkg: '@surfgen/sdk', lang: 'TypeScript / Node', cmd: 'npm i @surfgen/sdk', bg: '#8B5E2F' },
  { pkg: 'surfgen', lang: 'Python 3.10+', cmd: 'pip install surfgen', bg: '#5C7A8B' },
  { pkg: 'surfgen-cli', lang: 'Command line', cmd: 'npx surfgen render script.md', bg: '#7A4F22' },
];
