import { defineConfig } from 'vitest/config';
import { createRequire } from 'node:module';
const budgets = createRequire(import.meta.url)('./phase4-budgets.cjs');
// Explicit opt-in only; native fixtures never run in the normal *.test.ts suite.
export default defineConfig({ test: {
  include: ['scripts/phase4-native.ts'], environment: 'node', fileParallelism: false,
  maxWorkers: 1, testTimeout: budgets.test, hookTimeout: budgets.hook,
  retry: 0, bail: 1, silent: true, cache: false,
  reporters: ['./scripts/phase4-reporter.cjs'],
} });
