import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const lock = (app: string) => JSON.parse(readFileSync(new URL(`../../${app}/package-lock.json`, import.meta.url), 'utf8')).packages as Record<string, { version?: string }>;
function atLeast(version: string, minimum: number[]) {
  const actual = version.split('.').map(Number);
  for (let index = 0; index < minimum.length; index++) { if (actual[index] > minimum[index]) return true; if (actual[index] < minimum[index]) return false; }
  return true;
}
describe('patched security dependency boundaries', () => {
  it.each(['backend', 'frontend'])('keeps every locked PostCSS copy patched in %s', app => {
    const copies = Object.entries(lock(app)).filter(([name]) => name.endsWith('/postcss'));
    expect(copies.length).toBeGreaterThan(0);
    for (const [, pkg] of copies) expect(atLeast(pkg.version!, [8, 5, 23])).toBe(true);
  });
  it('removes vulnerable test workers and mocker versions', () => {
    const packages = lock('backend');
    for (const [name, pkg] of Object.entries(packages)) {
      if (name.endsWith('/tinypool')) expect(atLeast(pkg.version!, [2, 1, 2])).toBe(true);
      if (name.endsWith('/vitest') || name.endsWith('/@vitest/mocker')) expect(atLeast(pkg.version!, [4, 1, 11])).toBe(true);
      if (name.endsWith('/deepmerge-ts')) expect(atLeast(pkg.version!, [8, 0, 0])).toBe(true);
    }
  });
  it('exercises the actual Prisma config merge dependency with nested records and cyclic input', async () => {
    const require = createRequire(import.meta.url);
    const configRequire = createRequire(require.resolve('@prisma/config'));
    const { deepmerge } = await import(configRequire.resolve('deepmerge-ts'));
    expect(deepmerge({ migrate: { path: 'migrations' } }, { migrate: { seed: 'node seed.cjs' } })).toEqual({ migrate: { path: 'migrations', seed: 'node seed.cjs' } });
    const a: any = {}; a.self = a; const b: any = {}; b.self = b;
    try { deepmerge(a, b); } catch (error) {
      // Bounded explicit rejection is also safe; unbounded stack exhaustion is not.
      expect(error).not.toBeInstanceOf(RangeError);
    }
  });
  it('loads an actual Prisma configuration with the patched merge dependency', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'nuudeltsgeey-prisma-config-'));
    try {
      await writeFile(join(directory, 'prisma.config.ts'), 'export default { schema: "schema.prisma", migrations: { path: "migrations" } };');
      const { loadConfigFromFile } = await import('@prisma/config');
      const result = await loadConfigFromFile({ configRoot: directory, configFile: 'prisma.config.ts' });
      expect(result.error).toBeUndefined();
      expect(result.config?.schema).toBe(join(directory, 'schema.prisma'));
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
