import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // `.runtime/` holds production release snapshots; their copied tests must never run against fixtures.
  test: { exclude: ['**/node_modules/**', '**/.next*/**', '**/tmp/**', '**/.verify-*/**', '**/.runtime/**', 'scripts/*.test.mjs'] },
});
