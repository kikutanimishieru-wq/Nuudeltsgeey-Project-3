'use strict';
// Synthetic buffers and fake compilation only. No PGlite or sandbox imports.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const vm = require('node:vm');
const originalLoad = Module._load;
Module._load = function (name, ...rest) {
  if (name.includes('@electric-sql') || name.includes('node_modules') || /\.(wasm|data)$/.test(name))
    throw Error('RUNTIME_IMPORT_FORBIDDEN');
  return originalLoad.call(this, name, ...rest);
};
// Any accidental use of a real compilation/instantiation boundary fails tests.
const forbidden = () => { throw Error('REAL_WASM_FORBIDDEN'); };
global.WebAssembly = Object.freeze({ compile: forbidden, instantiate: forbidden,
  compileStreaming: forbidden, instantiateStreaming: forbidden, Module: forbidden, Instance: forbidden });
const d = require('./phase4-runtime-assets-diagnostic.cjs');

function adapter({ badHash, badSize, readError, compileError } = {}) {
  const calls = [], buffers = new Map();
  return {
    calls, buffers,
    read(spec) {
      calls.push(['read', spec.name]);
      if (readError === spec.name) throw Error('synthetic read failure');
      const bytes = { name: spec.name, byteLength: spec.bytes + (badSize === spec.name ? 1 : 0) };
      buffers.set(spec.name, bytes); return bytes;
    },
    hash(bytes) {
      calls.push(['hash', bytes.name]);
      return badHash === bytes.name ? '0'.repeat(64) : d.ASSETS.find(s => s.name === bytes.name).sha256;
    },
    async compile(bytes) {
      calls.push(['compile', bytes.name, bytes]);
      if (compileError === bytes.name) throw Error('synthetic compile rejection');
      return Object.freeze({ syntheticModule: true });
    },
  };
}

test('import does not touch runtime files or compile/instantiate anything', () => {
  assert.equal(d.ASSETS.length, 4);
  assert(Object.isFrozen(d.ASSETS));
  assert(d.ASSETS.every(Object.isFrozen));
});

test('all fixed reads/hash checks precede sequential fake compilation of same verified buffers', async () => {
  const ops = adapter(); const result = await d.inspectAssets(ops);
  assert.equal(result.status, 'COMPILED_UNREVIEWED');
  assert.deepEqual(ops.calls.slice(0, 8).map(c => c[0]), ['read', 'hash', 'read', 'hash', 'read', 'hash', 'read', 'hash']);
  const compiled = ops.calls.filter(c => c[0] === 'compile');
  assert.deepEqual(compiled.map(c => c[1]), ['pglite.wasm', 'initdb.wasm']);
  for (const call of compiled) assert.equal(call[2], ops.buffers.get(call[1]));
  assert.deepEqual(result.assets.map(a => a.compilation), ['NOT_REQUESTED', 'COMPILED', 'COMPILED', 'NOT_REQUESTED']);
  assert(Object.values(result.capabilities).every(value => value === false));
});

for (const name of ['index.cjs', 'pglite.wasm', 'initdb.wasm', 'pglite.data']) {
  test('tampered asset stops before compilation: ' + name, async () => {
    const ops = adapter({ badHash: name }); const result = await d.inspectAssets(ops);
    assert.equal(result.status, 'INCOMPLETE');
    assert.equal(result.error, 'ASSET_HASH_MISMATCH');
    assert.equal(ops.calls.filter(c => c[0] === 'compile').length, 0);
  });
}

test('wrong size or missing/denied asset fails without retry', async () => {
  for (const config of [{ badSize: 'pglite.wasm' }, { readError: 'initdb.wasm' }]) {
    const ops = adapter(config); const result = await d.inspectAssets(ops);
    assert.equal(result.status, 'INCOMPLETE');
    assert.equal(ops.calls.filter(c => c[0] === 'compile').length, 0);
    assert.equal(ops.calls.filter(c => c[0] === 'read' && c[1] === Object.values(config)[0]).length, 1);
  }
});

test('compilation rejection preserves partial results and never retries', async () => {
  const ops = adapter({ compileError: 'initdb.wasm' }); const result = await d.inspectAssets(ops);
  assert.equal(result.error, 'WASM_COMPILATION_FAILED');
  assert.deepEqual(result.assets.map(a => a.compilation), ['NOT_REQUESTED', 'COMPILED', 'PENDING', 'NOT_REQUESTED']);
  assert.equal(ops.calls.filter(c => c[0] === 'compile').length, 2);
});

test('unexpected arguments are rejected before any filesystem access', () => {
  const real = fs.realpathSync;
  fs.realpathSync = () => { throw Error('FILESYSTEM_MUST_NOT_BE_CALLED'); };
  try {
    for (const argv of [[], ['--execute'], ['--owner-approved-c2-assets', '/arbitrary', '0'.repeat(64)],
      ['--owner-approved-c2-assets', '/private/tmp/phase4-isolation-retest-qwhtwx0c/scratch/phase4-c2-assets-../x', '0'.repeat(64)]])
      assert.throws(() => d.realAdapter(argv), /INVALID_DIAGNOSTIC_ARGUMENTS/);
  } finally { fs.realpathSync = real; }
});

function fakeFile({ initialSize = 3, afterSize = 3, mode = true, short = false, grow = false, closeError = false } = {}) {
  const originals = Object.fromEntries(['openSync', 'fstatSync', 'readSync', 'closeSync'].map(k => [k, fs[k]]));
  let stats = 0, closes = 0;
  fs.openSync = (file, flags) => { assert(flags & fs.constants.O_NOFOLLOW); return 42; };
  fs.fstatSync = () => ({ isFile: () => mode, size: stats++ === 0 ? initialSize : afterSize, mtimeMs: 1, ctimeMs: 1 });
  fs.readSync = (fd, bytes, offset, length, position) => {
    if (short) return 0;
    if (position === initialSize) return grow ? 1 : 0;
    bytes.fill(0, offset, offset + length); return length;
  };
  fs.closeSync = () => { closes++; if (closeError) throw Error('close failed'); };
  return { restore() { Object.assign(fs, originals); }, closes: () => closes };
}

test('descriptor reads reject special files, short reads, growth and close errors', () => {
  for (const config of [{ mode: false }, { short: true }, { grow: true }, { afterSize: 4 }, { closeError: true }]) {
    const file = fakeFile(config);
    try { assert.throws(() => d.checkedRead('/synthetic', 3)); assert.equal(file.closes(), 1); }
    finally { file.restore(); }
  }
});

test('verified descriptor read returns a private buffer', () => {
  const file = fakeFile();
  try { assert.deepEqual(d.checkedRead('/synthetic', 3), Buffer.alloc(3)); assert.equal(file.closes(), 1); }
  finally { file.restore(); }
});

test('staging canonicalization, extra entries and changed diagnostic source are rejected', () => {
  const realpath = fs.realpathSync, readdir = fs.readdirSync, lstat = fs.lstatSync;
  const stage = '/private/tmp/phase4-isolation-retest-qwhtwx0c/scratch/phase4-c2-assets-synthetic';
  try {
    fs.realpathSync = value => value + '-redirected';
    assert.throws(() => d.realAdapter(['--owner-approved-c2-assets', stage, '0'.repeat(64)]), /STAGING_PATH_REJECTED/);
    fs.realpathSync = value => value;
    fs.readdirSync = () => ['unexpected'];
    assert.throws(() => d.realAdapter(['--owner-approved-c2-assets', stage, '0'.repeat(64)]), /UNEXPECTED_STAGING_ENTRY/);
    fs.readdirSync = value => value === stage ? ['assets', 'diagnostic.cjs', 'tmp'] : d.ASSETS.map(a => a.name);
    fs.lstatSync = () => ({ isFile: () => true, size: 3 });
    const file = fakeFile();
    try {
      assert.throws(() => d.realAdapter(['--owner-approved-c2-assets', stage, '0'.repeat(64)]), /DIAGNOSTIC_SOURCE_HASH_MISMATCH/);
    } finally { file.restore(); }
  } finally { fs.realpathSync = realpath; fs.readdirSync = readdir; fs.lstatSync = lstat; }
});

test('CLI rejects invalid setup and failed output without runtime access or retry', async () => {
  const original = fs.writeSync, oldStatus = process.exitCode;
  let calls = 0;
  fs.writeSync = (fd, payload) => {
    calls++; assert.equal(fd, 1);
    assert.equal(JSON.parse(payload.toString()).status, 'INCOMPLETE');
    return 0; // Simulated short stdout write.
  };
  try { await d.cli([]); assert.equal(process.exitCode, 1); assert.equal(calls, 1); }
  finally { fs.writeSync = original; process.exitCode = oldStatus; }
});

test('diagnostic source has only fixed builtin imports and no execution of asset JS', () => {
  const source = fs.readFileSync(__dirname + '/phase4-runtime-assets-diagnostic.cjs', 'utf8');
  const imports = [...source.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map(m => m[1]);
  assert.deepEqual(imports, ['node:fs', 'node:crypto']);
  assert(!/WebAssembly\.(instantiate|instantiateStreaming|compileStreaming|Instance|Module)\s*[.(]/.test(source));
  assert(!/\b(eval|Function)\s*\(/.test(source));
  assert(!/\bimport\s*\(/.test(source));
});

// Evaluate only reviewed diagnostic source with fake Node -e globals/boundaries.
// No child process, sandbox, runtime asset read or real WebAssembly is used.
test('successful Node -e routing reaches real CLI with fake filesystem/hash/compile', async () => {
  const source = fs.readFileSync(__dirname + '/phase4-runtime-assets-diagnostic.cjs', 'utf8');
  const stage = '/private/tmp/phase4-isolation-retest-qwhtwx0c/scratch/phase4-c2-assets-synthetic';
  const pin = 'a'.repeat(64), events = [], handles = new Map(), compiled = [];
  const specs = new Map(d.ASSETS.map(spec => [stage + '/assets/' + spec.name, spec]));
  specs.set(stage + '/diagnostic.cjs', { bytes: 3, sha256: pin, name: 'diagnostic.cjs' });
  let nextFd = 40, publish;
  const published = new Promise(resolve => { publish = resolve; });
  const fakeFs = {
    constants: fs.constants,
    realpathSync: path => path,
    readdirSync: path => {
      assert([stage, stage + '/assets'].includes(path));
      return path === stage ? ['assets', 'diagnostic.cjs', 'tmp'] : d.ASSETS.map(s => s.name);
    },
    lstatSync: path => { assert.equal(path, stage + '/diagnostic.cjs'); return { isFile: () => true, size: 3 }; },
    openSync: (path, flags) => {
      assert(specs.has(path)); assert(flags & fs.constants.O_NOFOLLOW);
      const fd = nextFd++; handles.set(fd, specs.get(path)); return fd;
    },
    fstatSync: fd => ({ isFile: () => true, size: handles.get(fd).bytes, mtimeMs: 1, ctimeMs: 1 }),
    readSync: (fd, bytes, offset, length, position) => {
      if (position === handles.get(fd).bytes) return 0;
      bytes.fill(0, offset, offset + length); return length;
    },
    closeSync: fd => { assert(handles.delete(fd)); },
    writeSync: (fd, payload) => { assert.equal(fd, 1); publish(JSON.parse(payload.toString())); return payload.length; },
  };
  const fakeCrypto = { createHash: algorithm => {
    assert.equal(algorithm, 'sha256');
    return { update(bytes) { this.bytes = bytes; return this; }, digest(format) {
      assert.equal(format, 'hex');
      const spec = [...specs.values()].find(s => s.bytes === this.bytes.length);
      assert(spec); events.push(['hash', spec.name, this.bytes]); return spec.sha256;
    } };
  } };
  const fakeProcess = { argv: ['/usr/local/bin/node', '--owner-approved-c2-assets', stage, pin] };
  const context = {
    module: { exports: {} }, process: fakeProcess, Buffer,
    require: name => {
      assert(['node:fs', 'node:crypto'].includes(name));
      return name === 'node:fs' ? fakeFs : fakeCrypto;
    },
    WebAssembly: { compile: async bytes => {
      assert.equal(events.length, 5); // source plus all four assets verified first
      const match = events.find(e => e[2] === bytes); assert(match);
      compiled.push(match[1]); return { syntheticModule: true };
    }, instantiate: forbidden, Module: forbidden, Instance: forbidden },
  };
  const wrapper = '\nvoid module.exports.cli(process.argv.slice(1));\n';
  const controller = fs.readFileSync(__dirname + '/phase4-runtime-assets-controller.py', 'utf8');
  assert(controller.includes("source.decode('utf8') + '\\nvoid module.exports.cli(process.argv.slice(1));\\n'"));
  vm.runInNewContext(source + wrapper, context, { timeout: 1000 });
  const result = await published;
  assert.equal(fakeProcess.exitCode, 0);
  assert.equal(result.status, 'COMPILED_UNREVIEWED');
  assert.deepEqual(compiled, ['pglite.wasm', 'initdb.wasm']);
  assert.equal(handles.size, 0);
  assert.deepEqual(result.assets.map(a => a.name), d.ASSETS.map(a => a.name));
});

test('direct file entry refuses before asset reads or compilation', () => {
  const source = fs.readFileSync(__dirname + '/phase4-runtime-assets-diagnostic.cjs', 'utf8');
  const module = { exports: {} }, writes = [], fakeProcess = { argv: ['node', 'diagnostic.cjs'] };
  const load = name => {
    if (name === 'node:crypto') return {};
    assert.equal(name, 'node:fs');
    return { writeSync: (fd, value) => { writes.push([fd, value]); return value.length; } };
  };
  load.main = module;
  vm.runInNewContext(source, { module, process: fakeProcess, require: load, WebAssembly: { compile: forbidden } },
                     { timeout: 1000 });
  assert.equal(fakeProcess.exitCode, 2);
  assert.deepEqual(writes, [[2, 'DIRECT_DIAGNOSTIC_EXECUTION_DISABLED\n']]);
});
