const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { constants } = require('node:fs');
const root = __dirname;
const publicFiles = new Set([
  'index.html', 'nuudeltsgeey-preview.html', 'style.css', 'app.js', 'economy.js',
  'architecture.js', 'style-eligibility.js', 'competition.js', 'bokh.js', 'ranking.js',
  'assets/mountains.svg',
  'docs/token-economy-v1.md', 'docs/mvp-architecture-v1.md', 'docs/tournament-operations.md',
  'docs/ikh-zasag-rulebook.md', 'docs/bokh-mode-v1.1.md', 'docs/operations-integration-v1.md',
  'docs/app-feature-spec.md', 'docs/security-monitoring-v1.md', 'docs/data-ai-strategy-v1.md',
]);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.md': 'text/plain; charset=utf-8' };
function allowedPath(rawUrl) {
  // Validate before URL normalization can erase traversal; decode once and reject nested encodings.
  let name;
  try { name = decodeURIComponent(rawUrl.split('?')[0]); } catch { return null; }
  if (!name.startsWith('/') || name.includes('\\') || name.includes('\0') || name.includes('%') ||
      name.split('/').some(segment => segment === '..' || segment === '.' || segment.startsWith('.'))) return null;
  const relative = name === '/' ? 'index.html' : name.slice(1);
  return publicFiles.has(relative) ? relative : null;
}
function createPreviewServer(publicRoot = root) {
  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end(); }
    const relative = allowedPath(req.url || '/');
    if (!relative) { res.writeHead(404); return res.end(); }
    let handle;
    try {
      const base = await fs.realpath(publicRoot);
      // Reject symlinks in every segment, even ones targeting another allowed repository path.
      let candidate = base;
      for (const segment of relative.split('/')) {
        candidate = path.join(candidate, segment);
        if ((await fs.lstat(candidate)).isSymbolicLink()) { res.writeHead(404); return res.end(); }
      }
      const resolved = await fs.realpath(candidate);
      if (resolved !== path.join(base, relative) || !resolved.startsWith(base + path.sep)) { res.writeHead(404); return res.end(); }
      handle = await fs.open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW);
      if (!(await handle.stat()).isFile()) { res.writeHead(404); return res.end(); }
      const data = await handle.readFile();
      res.writeHead(200, { 'Content-Type': types[path.extname(relative)], 'Content-Length': data.length });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch { if (!res.headersSent) res.writeHead(404); res.end(); }
    finally { if (handle) await handle.close(); }
  });
}
if (require.main === module) createPreviewServer().listen(5173, '127.0.0.1', () => console.log('eNomad Arena: http://localhost:5173'));
module.exports = { createPreviewServer, allowedPath };
