'use strict';
// Definitions only on import. Gate 2 approval is required before invoking cli.
const fs = require('node:fs');
const crypto = require('node:crypto');

const PREFIX = '/private/tmp/phase4-isolation-retest-qwhtwx0c/scratch/phase4-c2-assets-';
const ASSETS = Object.freeze([
  Object.freeze({ name: 'index.cjs', bytes: 2066577, sha256: '64bc0b76b47b72ec1665a9569998751064dc36fe51bffa5d8717ce233631f021', wasm: false }),
  Object.freeze({ name: 'pglite.wasm', bytes: 10498455, sha256: '864c7651fe2f23c38ff9e047a0b8851af0a5dbcbbb244a6a985bc254f274659e', wasm: true }),
  Object.freeze({ name: 'initdb.wasm', bytes: 300129, sha256: 'b33b41af366b4f7909085bb360b37587e5fa57a26113d84c21f23f9bfd63c0f8', wasm: true }),
  Object.freeze({ name: 'pglite.data', bytes: 6248214, sha256: '12384e109f1cea6edb978550d0445f8958ad4089cbbe3222d657f56e2e817d4b', wasm: false }),
]);
const CAPABILITIES = Object.freeze({ pglite_imported: false, wasm_instantiated: false,
  database_initialized: false, sql_executed: false, network_requested: false });
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function fail(code) { throw Object.assign(new Error(code), { diagnosticCode: code }); }

async function inspectAssets(ops) {
  // The injected adapter exists for mocks. cli constructs the only real adapter.
  const records = [], buffers = new Map();
  try {
    for (const spec of ASSETS) {
      const bytes = ops.read(spec);
      if (bytes.byteLength !== spec.bytes) fail('ASSET_SIZE_MISMATCH');
      if (ops.hash(bytes) !== spec.sha256) fail('ASSET_HASH_MISMATCH');
      // Retain exactly the verified bytes. No path is reopened for compilation.
      buffers.set(spec.name, bytes);
      records.push({ name: spec.name, bytes: spec.bytes, sha256: spec.sha256,
        read_verified: true, compilation: spec.wasm ? 'PENDING' : 'NOT_REQUESTED' });
    }
    // Verify all four assets before compiling either module, sequentially.
    for (const spec of ASSETS.filter(item => item.wasm)) {
      try { await ops.compile(buffers.get(spec.name)); }
      catch { fail('WASM_COMPILATION_FAILED'); }
      records.find(item => item.name === spec.name).compilation = 'COMPILED';
    }
    return { protocol: 1, scope: 'ASSET_READ_AND_WASM_COMPILE_ONLY',
      status: 'COMPILED_UNREVIEWED', assets: records, capabilities: CAPABILITIES };
  } catch (error) {
    return { protocol: 1, scope: 'ASSET_READ_AND_WASM_COMPILE_ONLY', status: 'INCOMPLETE',
      error: error.diagnosticCode || 'ASSET_READ_OR_HASH_FAILED', assets: records,
      capabilities: CAPABILITIES };
  }
}

function checkedRead(file, size) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const info = fs.fstatSync(fd);
    if (!info.isFile() || info.size !== size) fail('ASSET_TYPE_OR_SIZE_REJECTED');
    const bytes = Buffer.alloc(size);
    let offset = 0;
    while (offset < size) {
      const count = fs.readSync(fd, bytes, offset, size - offset, offset);
      if (!count) fail('SHORT_ASSET_READ');
      offset += count;
    }
    const extra = Buffer.alloc(1);
    if (fs.readSync(fd, extra, 0, 1, size) !== 0) fail('ASSET_GREW_DURING_READ');
    const after = fs.fstatSync(fd);
    if (after.size !== size || after.mtimeMs !== info.mtimeMs || after.ctimeMs !== info.ctimeMs)
      fail('ASSET_CHANGED_DURING_READ');
    return bytes;
  } finally { fs.closeSync(fd); }
}

function realAdapter(argv) {
  if (argv.length !== 3 || argv[0] !== '--owner-approved-c2-assets' ||
      !argv[1].startsWith(PREFIX) || !/^[A-Za-z0-9_-]+$/.test(argv[1].slice(PREFIX.length)) ||
      !/^[a-f0-9]{64}$/.test(argv[2])) fail('INVALID_DIAGNOSTIC_ARGUMENTS');
  const stage = argv[1];
  if (fs.realpathSync(stage) !== stage || fs.realpathSync(stage + '/assets') !== stage + '/assets')
    fail('STAGING_PATH_REJECTED');
  const exactNames = (directory, expected) => {
    const actual = fs.readdirSync(directory).sort();
    if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) fail('UNEXPECTED_STAGING_ENTRY');
  };
  exactNames(stage, ['assets', 'diagnostic.cjs', 'tmp']);
  exactNames(stage + '/assets', ASSETS.map(item => item.name));
  const sourceInfo = fs.lstatSync(stage + '/diagnostic.cjs');
  if (!sourceInfo.isFile() || sourceInfo.size > 32768) fail('DIAGNOSTIC_SOURCE_REJECTED');
  if (sha256(checkedRead(stage + '/diagnostic.cjs', sourceInfo.size)) !== argv[2])
    fail('DIAGNOSTIC_SOURCE_HASH_MISMATCH');
  return { read: spec => checkedRead(stage + '/assets/' + spec.name, spec.bytes),
    hash: sha256,
    compile: bytes => WebAssembly.compile(bytes) }; // Compilation only; no instances.
}

async function cli(argv) {
  let result;
  try { result = await inspectAssets(realAdapter(argv)); }
  catch { result = { protocol: 1, status: 'INCOMPLETE', error: 'DIAGNOSTIC_SETUP_REJECTED' }; }
  const payload = Buffer.from(JSON.stringify(result) + '\n');
  process.exitCode = result.status === 'COMPILED_UNREVIEWED' ? 0 : 1;
  try {
    if (payload.length > 8192 || fs.writeSync(1, payload) !== payload.length) fail('OUTPUT_FAILED');
  } catch { process.exitCode = 1; }
}

module.exports = { ASSETS, CAPABILITIES, inspectAssets, checkedRead, realAdapter, cli };
// Only the reviewed controller's verified-source Node -e wrapper invokes cli.
// This is accidental-use protection, not an authorization/security boundary.
if (require.main === module) {
  process.exitCode = 2;
  fs.writeSync(2, 'DIRECT_DIAGNOSTIC_EXECUTION_DISABLED\n');
}
