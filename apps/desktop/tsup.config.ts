import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts', 'src/preload.ts'],
  // Electron main/preload load via require; package.json "main" points at dist/main.cjs.
  format: ['cjs'],
  outExtension: () => ({ js: '.cjs' }),
  external: ['electron'],
  sourcemap: true,
  clean: true,
});
