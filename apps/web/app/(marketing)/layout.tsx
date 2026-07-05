import type { Metadata } from 'next';
import { MarketingFooter } from '../../components/marketing/marketing-footer';
import { MarketingNav } from '../../components/marketing/marketing-nav';

export const metadata: Metadata = {
  title: 'SurfGen — Turn scripts into studio-quality avatar video',
  description:
    'Write a script, pick a voice, choose an avatar — SurfGen generates, lip-syncs, subtitles, and renders the finished video. Hosted studio on an open-source engine.',
  openGraph: {
    title: 'SurfGen — AI avatar video, one pipeline',
    description:
      'Talking photos, voice cloning, lip sync, translation, and a full timeline editor — every AI capability swappable by configuration.',
    images: [{ url: '/og.webp', width: 1520, height: 760 }],
  },
};

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <MarketingNav />
      <main className="flex-1">{children}</main>
      <MarketingFooter />
    </div>
  );
}
