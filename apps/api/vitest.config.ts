import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  // SWC handles the decorator metadata Nest needs; ESM output for vitest.
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: { include: ['test/**/*.test.ts'] },
});
