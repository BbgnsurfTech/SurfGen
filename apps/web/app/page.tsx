const CAPABILITIES = [
  'AI Avatars',
  'Talking Photos',
  'Voice Cloning',
  'Lip Sync',
  'Text-to-Speech',
  'Translation',
  'Subtitles',
  'Script Generation',
  'Background Replacement',
  'Motion Generation',
];

const PROVIDERS = [
  { label: 'tts', chain: 'piper → elevenlabs → mock' },
  { label: 'llm', chain: 'ollama → openai → mock' },
  { label: 'avatar', chain: 'sadtalker → heygen → mock' },
  { label: 'render', chain: 'ffmpeg (local, always)' },
];

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col justify-between px-6 py-10 sm:px-10">
      <header className="flex items-baseline justify-between border-b border-(--color-line) pb-6">
        <span className="text-sm font-semibold tracking-[0.35em] uppercase">SurfGen</span>
        <span className="text-xs text-(--color-text-muted)">studio · coming online</span>
      </header>

      <section aria-labelledby="hero-heading" className="py-16 sm:py-24">
        <h1
          id="hero-heading"
          className="max-w-3xl text-4xl leading-[1.05] font-semibold tracking-tight text-balance sm:text-6xl"
        >
          AI avatar video generation,{' '}
          <span className="text-(--color-accent)">unchained from any one vendor.</span>
        </h1>
        <p className="mt-6 max-w-xl text-base leading-relaxed text-(--color-text-muted)">
          Every capability — voice, avatar, lip sync, translation — runs behind a provider
          abstraction. Point it at a cloud API or a model on your own GPU by editing one YAML
          file. Open source, Apache-2.0, self-hostable.
        </p>

        <ul className="mt-12 flex max-w-2xl flex-wrap gap-x-5 gap-y-2" aria-label="Capabilities">
          {CAPABILITIES.map((capability) => (
            <li key={capability} className="text-sm text-(--color-text-muted)">
              <span aria-hidden className="mr-2 text-(--color-accent)">
                ●
              </span>
              {capability}
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-label="Provider chains"
        className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-(--color-line) bg-(--color-line) sm:grid-cols-4"
      >
        {PROVIDERS.map((provider) => (
          <div key={provider.label} className="bg-(--color-surface-raised) p-5">
            <div className="text-xs tracking-widest uppercase text-(--color-accent)">
              {provider.label}
            </div>
            <div className="mt-2 font-mono text-xs leading-relaxed text-(--color-text-muted)">
              {provider.chain}
            </div>
          </div>
        ))}
      </section>

      <footer className="mt-16 flex items-center justify-between border-t border-(--color-line) pt-6 text-xs text-(--color-text-muted)">
        <span>Apache-2.0 · provider-independent by architecture</span>
        <span className="font-mono">config/ai.yaml decides — not the code</span>
      </footer>
    </main>
  );
}
