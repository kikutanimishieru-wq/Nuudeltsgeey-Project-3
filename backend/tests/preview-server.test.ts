import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
const require = createRequire(import.meta.url);
const { createPreviewServer, allowedPath } = require('../../server.cjs');
let directory: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'nuudeltsgeey-preview-'));
  await writeFile(join(directory, 'index.html'), '<h1>Public</h1>');
  await writeFile(join(directory, '.env'), 'PRIVATE_SECRET=not-real');
  await mkdir(join(directory, 'private'));
  await writeFile(join(directory, 'private', 'key.txt'), 'PRIVATE');
  await symlink(join(directory, '.env'), join(directory, 'app.js'));
  await symlink(join(directory, 'private'), join(directory, 'assets'));
});
afterAll(async () => { await rm(directory, { recursive: true, force: true }); });
async function response(url: string, method = 'GET') {
  let status = 0; let body = ''; const headers: Record<string, unknown> = {};
  const req = { url, method };
  let finish: () => void;
  const done = new Promise<void>(resolve => { finish = resolve; });
  const res = { headersSent: false, setHeader(key: string, value: unknown) { headers[key] = value; },
    writeHead(code: number, values?: object) { status = code; this.headersSent = true; Object.assign(headers, values); },
    end(data?: unknown) { body = data?.toString() ?? ''; finish(); } };
  createPreviewServer(directory).emit('request', req as IncomingMessage, res as unknown as ServerResponse);
  await done;
  return { status, body, headers };
}
describe('preview public-file boundary', () => {
  it.each(['/.env', '/backend/.env', '/.git/config', '/package.json', '/backend/auth.ts', '/backend/package-lock.json', '/node_modules/x.js', '/docs/governance/history/manifest.json', '/private/key.txt', '/server.cjs'])('denies sensitive repository path %s', async url => {
    const result = await response(url); expect(result.status).toBe(404); expect(result.body).not.toContain('PRIVATE');
  });
  it.each(['/../app.js', '/%2e%2e/app.js', '/%252e%252e/app.js', '/assets/../app.js', '/assets%5c..%5c.env', '/%00.env', '/%ZZ'])('rejects encoded or raw traversal %s', url => {
    expect(allowedPath(url)).toBeNull();
  });
  it('rejects a symlink under an explicitly public filename', async () => { expect((await response('/app.js')).status).toBe(404); });
  it('rejects symlinked parent directories', async () => { expect((await response('/assets/mountains.svg')).status).toBe(404); });
  it('preserves the public homepage and HEAD behavior', async () => {
    const get = await response('/'); expect(get.status).toBe(200); expect(get.body).toContain('Public'); expect(get.headers['X-Content-Type-Options']).toBe('nosniff');
    const head = await response('/index.html', 'HEAD'); expect(head.status).toBe(200); expect(head.body).toBe('');
  });
  it('preserves documented public files and rejects POST', async () => {
    expect(allowedPath('/docs/tournament-operations.md')).toBe('docs/tournament-operations.md');
    expect((await response('/', 'POST')).status).toBe(405);
  });
});
