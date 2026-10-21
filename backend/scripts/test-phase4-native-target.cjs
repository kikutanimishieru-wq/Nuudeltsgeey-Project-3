// Exercise only the native target guard, never import or execute native fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(__dirname + '/phase4-native.ts', 'utf8');
const header = source.slice(source.indexOf('const branch ='), source.indexOf('const clients ='));
const code = ts.transpileModule(header + '\nunexpired();', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const hostname = 'ep-delicate-poetry-b5bbwllj.c-7.us-east-2.aws.neon.tech';
const base = { PHASE4_NATIVE_AUTHORIZED: 'br-withered-mode-b528hnhk', PHASE4_VALIDATION_DATABASE_URL: `postgresql://neondb_owner:synthetic@${hostname}/neondb?sslmode=require&sslaccept=strict`, PHASE4_RUN_ID: 'p4_0123456789abcdef', PHASE4_EXPIRES_AT: '2026-10-26T09:48:09Z' };
class Clock extends Date { static now() { return Date.parse('2026-10-19T10:00:00Z'); } }
const run = changes => vm.runInNewContext(code, { process: { env: { ...base, ...changes } }, URL, Date: Clock });
run({});
for (const branch of ['br-wispy-mountain-b5nku4bf', 'br-plain-glitter-b5cadax8', 'br-morning-queen-b5u7j4qz', 'other']) assert.throws(() => run({ PHASE4_NATIVE_AUTHORIZED: branch }));
for (const host of ['ep-crimson-rain-b5po4mqa.c-7.us-east-2.aws.neon.tech', 'ep-round-leaf-b5w0evea.c-7.us-east-2.aws.neon.tech', 'ep-still-rain-b55chfrd.c-7.us-east-2.aws.neon.tech', hostname.replace('.c-7.', '-pooler.c-7.')]) assert.throws(() => run({ PHASE4_VALIDATION_DATABASE_URL: base.PHASE4_VALIDATION_DATABASE_URL.replace(hostname, host) }));
for (const expiry of ['', '2026-10-26T09:48:10Z', '2026-10-19T10:01:00Z']) assert.throws(() => run({ PHASE4_EXPIRES_AT: expiry }));
assert.throws(() => run({ PHASE4_VALIDATION_DATABASE_URL: base.PHASE4_VALIDATION_DATABASE_URL.replace('sslaccept=strict', 'sslaccept=accept_invalid_certs') }));
console.log('PASS: native V4 target guards only; no fixtures executed.');
