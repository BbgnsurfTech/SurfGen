import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SurfGen — open-source AI video generation',
  description:
    'Provider-agnostic AI avatar video platform. Talking photos, voice cloning, lip sync, translation — cloud or fully local, swapped by configuration alone.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
