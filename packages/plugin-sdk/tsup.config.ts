import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/conformance.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  external: ['vitest'],
});
