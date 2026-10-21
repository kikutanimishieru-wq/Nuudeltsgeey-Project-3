// Offline UI rendering and pure state tests. No Next boot, HTTP, OAuth or storage.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..');
const cache = new Map();
const routes = [];
let buttons = [];
function load(relative) {
  const file = path.resolve(root, relative);
  if (cache.has(file)) return cache.get(file);
  const result = {}; cache.set(file, result);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, { exports: result, require(name) {
    if (name === 'react') return React;
    if (name === 'react/jsx-runtime') {
      const runtime = require('react/jsx-runtime');
      return { ...runtime, jsx(type, props, key) { if (type === 'button') buttons.push(props); return runtime.jsx(type, props, key); },
        jsxs(type, props, key) { if (type === 'button') buttons.push(props); return runtime.jsxs(type, props, key); } };
    }
    if (name === 'next/link') return { __esModule: true, default: ({ children, ...props }) => React.createElement('a', props, children) };
    if (name === 'next/navigation') return { useRouter: () => ({ push: p => routes.push(p) }) };
    const target = name.startsWith('@/') ? path.join(root, name.slice(2)) : name.startsWith('.') ? path.resolve(path.dirname(file), name) : null;
    if (!target) throw Error('UNAPPROVED_IMPORT: ' + name);
    const resolved = ['.ts', '.tsx'].map(ext => target + ext).find(p => fs.existsSync(p));
    if (!resolved) throw Error('UNAPPROVED_FILE');
    return load(path.relative(root, resolved));
  } }, { filename: file });
  return result;
}
const model = load('lib/mock-auth.ts');
const provider = load('components/onboarding/MockAuthProvider.tsx');
const ui = load('components/onboarding/Onboarding.tsx');
const nav = load('components/onboarding/AuthNavigation.tsx');
function render(Component, phase = 'signed-out', props = {}, dispatch = () => {}) {
  buttons = [];
  return renderToStaticMarkup(React.createElement(provider.MockAuthContext.Provider, { value: { state: { phase }, dispatch } }, React.createElement(Component, props)));
}
const reduce = (state, type) => model.mockAuthReducer(state, { type });
test('full demo journey: Discord begin, success, Steam and reset', () => {
  let s = model.initialMockState;
  assert.equal(model.mockPresentation(s).signedIn, false);
  s = reduce(s, 'BEGIN'); assert.equal(s.phase, 'authenticating');
  s = reduce(s, 'SUCCESS'); assert.equal(s.phase, 'discord-only');
  assert.equal(model.mockPresentation(s).join, false);
  s = reduce(s, 'CONNECT_STEAM'); assert.equal(model.mockPresentation(s).join, true);
  s = reduce(s, 'RESET'); assert.equal(s.phase, 'signed-out');
  assert.equal(model.mockPresentation(s).steam, false);
});
test('failed authentication, retry and cancellation never create demo account', () => {
  let s = reduce(model.initialMockState, 'BEGIN'); s = reduce(s, 'FAIL');
  assert.equal(s.phase, 'failed'); assert.equal(model.mockPresentation(s).signedIn, false);
  s = reduce(s, 'BEGIN'); assert.equal(s.phase, 'authenticating');
  assert.equal(reduce(s, 'RESET').phase, 'signed-out');
});
test('invalid transitions do not bypass Discord or account restriction', () => {
  assert.equal(reduce(model.initialMockState, 'CONNECT_STEAM').phase, 'signed-out');
  assert.equal(reduce(model.initialMockState, 'SUCCESS').phase, 'signed-out');
  assert.equal(reduce({ phase: 'restricted' }, 'CONNECT_STEAM').phase, 'restricted');
  assert.equal(model.mockAuthReducer(model.initialMockState, { type: 'PREVIEW', phase: 'invalid' }).phase, 'signed-out');
});
for (const [phase, allowed] of [['signed-out', false], ['discord-only', false], ['verified', true], ['restricted', false]]) {
  test('eligibility matrix: ' + phase, () => {
    const p = model.mockPresentation({ phase });
    assert.equal(p.browse, true); assert.equal(p.host, allowed); assert.equal(p.join, allowed);
    const html = render(ui.EligibilityNotice, phase);
    assert.match(html, /зөвхөн демо/);
    if (phase === 'restricted') { assert.match(html, /Steam холболт энэ хязгаарлалтыг арилгахгүй/); assert.doesNotMatch(html, /Steam бүртгэлээ холбоно уу/); }
  });
}
test('Discord-only login UI has no password, email or alternate provider controls', () => {
  const html = render(ui.default, 'signed-out', { page: 'login' });
  assert.match(html, /Discord-оор үргэлжлүүлэх/);
  assert.match(html, /Discord бүртгэлээр нэвтэрч Nuudeltsgeey-д нэгдээрэй/);
  assert.match(html, /ДЕМО ГОРИМ/); assert.doesNotMatch(html, /<input|<form|type="password"|type="email"|Steam-ээр нэвтрэх|Google/i);
  assert.doesNotMatch(html, /href="https?:/);
});
test('progress and failure UI are explicit and accessible', () => {
  const pending = render(ui.default, 'authenticating', { page: 'login' });
  assert.match(pending, /disabled=""/); assert.match(pending, /Амжилттай нэвтрэхийг үзүүлэх/); assert.match(pending, /Алдааг үзүүлэх/);
  assert.match(render(ui.default, 'failed', { page: 'login' }), /role="alert"/);
});
test('account clearly shows mock player, ID, connections and eligibility', () => {
  const html = render(ui.default, 'discord-only', { page: 'account' });
  for (const text of ['MongolWarrior', 'NMD-DEMO-000001', 'ЖИШЭЭ', 'Дутуу (демо)', 'Steam холбох (демо)']) assert.ok(html.includes(text));
  assert.match(html, /href="\/account\/identity"/);
});
test('identity page shows both providers and restricted override', () => {
  const html = render(ui.default, 'restricted', { page: 'identity' });
  assert.match(html, /Discord нэр:/); assert.match(html, /MongolWarrior \(демо\)/);
  assert.match(html, /Хязгаарлагдсан/); assert.match(html, /disabled=""/);
});
test('signed-out account is an honest empty state, not a fake profile', () => {
  const html = render(ui.default, 'signed-out', { page: 'account' });
  assert.doesNotMatch(html, /NMD-DEMO-000001/); assert.match(html, /href="\/login"/);
});
test('navigation reflects mock sign-in and logout/reset availability', () => {
  for (const sidebar of [true, false]) {
    const out = render(nav.AuthNavigation, 'signed-out', { sidebar });
    assert.match(out, /href="\/login"/); assert.match(out, /Нэвтрэх/); assert.doesNotMatch(out, /Демо гарах/);
    const signed = render(nav.AuthNavigation, 'verified', { sidebar });
    assert.match(signed, /href="\/account"/); assert.match(signed, /MongolWarrior/); assert.match(signed, /Демо гарах/);
    assert.match(signed, /бодит сесс биш/);
  }
});
test('all six preview states render without missing context', () => {
  for (const phase of model.mockPhases) {
    assert.equal(model.mockAuthReducer(model.initialMockState, { type: 'PREVIEW', phase }).phase, phase);
    for (const page of ['login', 'account', 'identity']) assert.match(render(ui.default, phase, { page }), /ДЕМО ГОРИМ/);
  }
});
test('new mock source has no network, cookies, persistence or server imports', () => {
  for (const file of ['lib/mock-auth.ts', 'components/onboarding/MockAuthProvider.tsx', 'components/onboarding/Onboarding.tsx', 'components/onboarding/AuthNavigation.tsx']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotMatch(source, /\b(fetch|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB)\b|document\.cookie|next\/headers|lib\/api|lib\/server|https?:\/\//);
  }
});

test('actual rendered demo buttons dispatch actions and only route internally', () => {
  let state = model.initialMockState;
  const dispatch = action => { state = model.mockAuthReducer(state, action); };
  render(ui.DiscordLoginButton, state.phase, {}, dispatch);
  buttons.find(b => b.className === 'discord-login').onClick();
  assert.equal(state.phase, 'authenticating');
  render(ui.default, state.phase, { page: 'login' }, dispatch);
  buttons.find(b => b.children === 'Алдааг үзүүлэх').onClick();
  assert.equal(state.phase, 'failed');
  render(ui.DiscordLoginButton, state.phase, {}, dispatch);
  buttons.find(b => b.className === 'discord-login').onClick();
  render(ui.default, state.phase, { page: 'login' }, dispatch);
  buttons.find(b => b.children === 'Амжилттай нэвтрэхийг үзүүлэх').onClick();
  assert.equal(state.phase, 'discord-only'); assert.deepEqual(routes, ['/account']);
  render(ui.SteamConnectCard, state.phase, {}, dispatch);
  buttons.find(b => b.children === 'Steam холбох (демо)').onClick();
  assert.equal(state.phase, 'verified');
  render(nav.AuthNavigation, state.phase, {}, dispatch);
  buttons.find(b => b.children === 'Демо гарах').onClick();
  assert.equal(state.phase, 'signed-out');
  render(ui.DemoControls, 'verified', {}, dispatch);
  buttons.find(b => b.children === 'Демог дахин эхлүүлэх').onClick();
  assert.equal(state.phase, 'signed-out');
});
