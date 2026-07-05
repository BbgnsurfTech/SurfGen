const FAQS = [
  {
    q: 'Is there a free way to use SurfGen?',
    a: 'Yes — two. Create an account on the hosted studio and start on the free tier, or self-host the entire open-source platform on your own hardware. The default self-host configuration runs on local providers only (Piper TTS, FFmpeg rendering) and needs no API keys at all.',
  },
  {
    q: 'What is the difference between the hosted studio and self-hosting?',
    a: 'Same code, different operator. The hosted studio is our managed deployment: we run the GPU workers, storage, and upgrades, and you pay a subscription. Self-hosting gives you the identical platform under the Apache-2.0 license — you bring the infrastructure.',
  },
  {
    q: 'Can I bring my own AI provider keys?',
    a: 'Yes. Every capability — voice, avatar, translation, rendering — resolves through a provider registry driven by configuration. Point a capability at your own ElevenLabs, OpenAI, or local model endpoint and the pipeline uses it; application code never names a vendor.',
  },
  {
    q: 'Who owns the videos I generate?',
    a: 'You do. Your scripts, voices, avatars, and rendered videos belong to you. Outputs are stored under your workspace and served through signed URLs only you control, and you can export or delete them at any time.',
  },
  {
    q: 'Can I cancel my subscription anytime?',
    a: 'Yes. Billing runs on monthly or annual cycles through Paystack; cancel from the billing page and your plan simply does not renew. Your projects remain exportable after cancellation.',
  },
  {
    q: 'What languages does SurfGen support?',
    a: 'Scripts can be written or generated in any language your chosen text provider supports, and the translation capability re-voices and re-subtitles a finished video into new languages without re-recording anything.',
  },
];

export function FaqSection() {
  return (
    <section id="faq" aria-labelledby="faq-heading" className="py-24">
      <div className="mx-auto w-full max-w-3xl px-5">
        <h2
          id="faq-heading"
          className="text-center font-display text-[clamp(1.9rem,1.4rem+2vw,3rem)] font-extrabold tracking-tight text-ink"
        >
          Questions, answered.
        </h2>
        <div className="mt-12 space-y-3">
          {FAQS.map((faq) => (
            <details
              key={faq.q}
              className="group rounded-2xl border border-line bg-card px-6 transition-colors open:border-primary/40"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 font-display text-[15px] font-bold text-ink [&::-webkit-details-marker]:hidden">
                {faq.q}
                <span className="text-xl font-light text-bronze transition-transform duration-200 group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="pb-6 text-sm leading-relaxed text-taupe">{faq.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
