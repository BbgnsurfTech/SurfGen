import type { Metadata } from 'next';
import {
  DM_Sans,
  JetBrains_Mono,
  Manrope,
  Plus_Jakarta_Sans,
  Sora,
  Space_Grotesk,
} from 'next/font/google';
import './globals.css';

const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-jakarta' });
const manrope = Manrope({ subsets: ['latin'], variable: '--font-manrope' });
const jetbrains = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains' });
// Brand-kit font options — rendered live in the brand builder preview.
const spaceGrotesk = Space_Grotesk({ subsets: ['latin'], variable: '--font-space-grotesk' });
const dmSans = DM_Sans({ subsets: ['latin'], variable: '--font-dm-sans' });
const sora = Sora({ subsets: ['latin'], variable: '--font-sora' });

export const metadata: Metadata = {
  title: 'SurfGen — AI video generation platform',
  description:
    'Provider-agnostic AI avatar video platform. Talking photos, voice cloning, lip sync, translation — cloud or fully local, swapped by configuration alone.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${jakarta.variable} ${manrope.variable} ${jetbrains.variable} ${spaceGrotesk.variable} ${dmSans.variable} ${sora.variable}`}
    >
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
