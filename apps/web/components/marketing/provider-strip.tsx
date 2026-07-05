import { ArrowLeftRight } from 'lucide-react';

const YAML_BEFORE = `capabilities:
  tts:
    provider: elevenlabs`;

const YAML_AFTER = `capabilities:
  tts:
    provider: piper   # local, free`;

export function ProviderStrip() {
  return (
    <section aria-labelledby="providers-heading" className="bg-ink py-24 text-shell">
      <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-5 md:grid-cols-2">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-camel">No lock-in, by design</p>
          <h2
            id="providers-heading"
            className="mt-3 font-display text-[clamp(1.9rem,1.4rem+2vw,3rem)] font-extrabold leading-tight tracking-tight text-white"
          >
            No application code ever names a vendor.
          </h2>
          <p className="mt-5 max-w-md leading-relaxed text-stone">
            Every AI capability sits behind a provider abstraction. Swap a cloud voice API for a
            local model — or bring your own keys — by editing one line of configuration. The
            engine is open source; your videos never depend on our vendor choices.
          </p>
        </div>
        <div className="grid items-center gap-4 sm:grid-cols-[1fr_auto_1fr]">
          <pre className="overflow-x-auto rounded-2xl border border-line-dark bg-espresso p-5 font-mono text-xs leading-relaxed text-camel">
            {YAML_BEFORE}
          </pre>
          <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-carbon text-camel">
            <ArrowLeftRight size={17} strokeWidth={1.6} />
          </span>
          <pre className="overflow-x-auto rounded-2xl border border-line-dark bg-espresso p-5 font-mono text-xs leading-relaxed text-camel">
            {YAML_AFTER}
          </pre>
        </div>
      </div>
    </section>
  );
}
