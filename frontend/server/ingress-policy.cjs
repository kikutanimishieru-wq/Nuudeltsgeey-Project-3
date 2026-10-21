'use strict';
const { createHmac, timingSafeEqual, randomBytes } = require('node:crypto');
const FRONTEND = 'http://localhost:3002';
const HOST = 'localhost:3002';
const MARKER = 'x-nuudel-ingress-proof';
const MAX_HEADERS = 16 * 1024;
const BODY_LIMIT = 16 * 1024;
const BOUND_HEADERS = ['host', 'origin', 'cookie', 'content-type', 'content-length',
  'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest', 'sec-fetch-user'];
const SITES = new Set(['same-origin','same-site','cross-site','none']);
const MODES = new Set(['cors','navigate','no-cors','same-origin','websocket']);
function metadataValid(get) {
  const site = get('sec-fetch-site'), mode = get('sec-fetch-mode');
  const dest = get('sec-fetch-dest'), user = get('sec-fetch-user');
  return (site === null || SITES.has(site)) && (mode === null || MODES.has(mode))
    && (dest === null || new Set(['','audio','audioworklet','document','embed','empty','fencedframe','font','frame','iframe','image','json','manifest','object','paintworklet','report','script','serviceworker','sharedworker','style','track','video','webidentity','worker','xslt']).has(dest))
    && (user === null || user === '?1');
}
function targetValid(target) {
  if (typeof target !== 'string' || target.length > 10000 || !target.startsWith('/') || /[\x00-\x20\x7f-\uffff\\#]/.test(target)) return false;
  const path = target.split('?')[0];
  if (/%|\/\/|(?:^|\/)\.{1,2}(?:\/|$)/.test(path)) return false;
  const query = target.includes('?') ? target.slice(target.indexOf('?') + 1) : '';
  return query.length <= 8191 && !/%(?![a-fA-F0-9]{2})/.test(query);
}
function validateIncoming(req) {
  if (!Array.isArray(req.rawHeaders) || req.rawHeaders.length % 2 || req.httpVersion !== '1.1') return 'INVALID_HEADERS';
  const values = new Map(); let size = 2;
  for (let i=0; i<req.rawHeaders.length; i+=2) {
    const name = req.rawHeaders[i].toLowerCase(), value = req.rawHeaders[i+1];
    size += Buffer.byteLength(req.rawHeaders[i]) + Buffer.byteLength(value) + 4;
    if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(name) || /[\x00-\x08\x0a-\x1f\x7f]/.test(value)) return 'INVALID_HEADERS';
    if (name.startsWith('sec-fetch-') && !['sec-fetch-site','sec-fetch-mode','sec-fetch-dest','sec-fetch-user'].includes(name)) return 'INVALID_FETCH_METADATA';
    if (values.has(name)) return 'DUPLICATE_HEADER'; // Deliberately stricter than only security headers.
    values.set(name, value);
    if (name === 'forwarded' || name.startsWith('x-forwarded-') || name === 'x-real-ip' || name.startsWith('x-nuudel-ingress-')) return 'UNTRUSTED_FORWARDING';
  }
  if (size > MAX_HEADERS || values.size > 64) return 'HEADERS_TOO_LARGE';
  const get = name => values.get(name) ?? null;
  if (get('host') !== HOST) return 'INVALID_HOST';
  if (!targetValid(req.url)) return 'INVALID_TARGET';
  const api = req.url.split('?')[0].startsWith('/api/');
  if (!['GET','HEAD','POST'].includes(req.method) || (req.method === 'POST' && !api)) return 'METHOD_NOT_ALLOWED';
  const origin = get('origin');
  if (origin !== null) {
    try { const url = new URL(origin); if (!['http:','https:'].includes(url.protocol) || url.origin !== origin || url.username || url.password) return 'INVALID_ORIGIN'; }
    catch { return 'INVALID_ORIGIN'; }
  }
  if (!metadataValid(get)) return 'INVALID_FETCH_METADATA';
  if (req.method === 'POST' && (origin !== FRONTEND || get('sec-fetch-site') === 'cross-site')) return 'INVALID_ORIGIN';
  if (get('transfer-encoding') !== null || get('trailer') !== null || get('expect') !== null || get('upgrade') !== null) return 'UNSUPPORTED_FRAMING';
  const connection = get('connection');
  if (connection !== null && !['keep-alive','close'].includes(connection.toLowerCase())) return 'UNSUPPORTED_FRAMING';
  const length = get('content-length');
  if (length !== null && (!/^(0|[1-9][0-9]*)$/.test(length) || !Number.isSafeInteger(Number(length)))) return 'INVALID_LENGTH';
  if (req.method === 'POST' && length === null) return 'LENGTH_REQUIRED';
  if (Number(length ?? 0) > BODY_LIMIT || (req.method !== 'POST' && Number(length ?? 0) !== 0)) return 'BODY_TOO_LARGE';
  // Node's strict HTTP parser limits the framed body to Content-Length. The API
  // proxy independently counts bytes, including if this boundary is bypassed.
  return null;
}
function payload(method, target, get, stamp, nonce) {
  return JSON.stringify([method,target,BOUND_HEADERS.map(name => get(name)),stamp,nonce]);
}
function sealIncoming(req, key, now = Date.now()) {
  const nonce = randomBytes(16).toString('hex');
  const mac = createHmac('sha256',key).update(payload(req.method,req.url,name => req.headers[name] ?? null,now,nonce)).digest('hex');
  req.headers[MARKER] = `${now}.${nonce}.${mac}`;
}
function verifyProof(request, key, now = Date.now()) {
  if (!/^[a-f0-9]{64}$/.test(key ?? '')) return false;
  const proof = request.headers.get(MARKER) ?? '';
  const match = /^(\d{13})\.([a-f0-9]{32})\.([a-f0-9]{64})$/.exec(proof);
  if (!match || now < Number(match[1]) || now - Number(match[1]) > 60000) return false;
  const url = new URL(request.url);
  const expected = createHmac('sha256',key).update(payload(request.method,url.pathname + url.search,name => request.headers.get(name),Number(match[1]),match[2])).digest();
  return timingSafeEqual(expected,Buffer.from(match[3],'hex'));
}
function rejectResponse(req,res,code,status=400) {
  res.writeHead(status,{'content-type':'application/json','cache-control':'no-store',connection:'close'});
  // Do not drain an attacker-controlled body or reuse this connection.
  res.once('finish',()=>req.socket.destroy());
  res.end(JSON.stringify({error:code}));
}
function makeRequestListener(handle,key, options={}) {
  const bodyMs = options.bodyMs ?? 10000, responseMs = options.responseMs ?? 60000;
  return (req,res) => {
    const error = validateIncoming(req);
    if (error) { rejectResponse(req,res,error); return; }
    sealIncoming(req,key);
    // No data listeners are installed: Next retains ownership of the stream.
    const bodyTimer = setTimeout(()=>{ if (!req.complete) { if (!res.headersSent) rejectResponse(req,res,'BODY_TIMEOUT',408); req.socket.destroy(); } },bodyMs);
    const responseTimer = setTimeout(()=>{ if (!res.writableFinished) { if (!res.headersSent) rejectResponse(req,res,'REQUEST_TIMEOUT',504); req.socket.destroy(); } },responseMs);
    const clean = ()=>{clearTimeout(bodyTimer);clearTimeout(responseTimer);};
    res.once('finish',clean); res.once('close',clean);
    try { Promise.resolve(handle(req,res)).catch(()=>{ if (!res.headersSent) rejectResponse(req,res,'FRONTEND_UNAVAILABLE',503); else req.socket.destroy(); }); }
    catch { if (!res.headersSent) rejectResponse(req,res,'FRONTEND_UNAVAILABLE',503); else req.socket.destroy(); }
  };
}
// Next's public custom-server wrapper adds an upgrade listener automatically.
// Gate dispatch, rather than listener order: no Next upgrade callback can run.
function guardedServerClass(BaseServer) {
  return class extends BaseServer {
    emit(event,...args) {
      if (event === 'upgrade' || event === 'connect') { args[1].destroy(); return true; }
      if (event === 'checkContinue' || event === 'checkExpectation') { rejectResponse(args[0],args[1],'EXPECTATION_REJECTED',417); return true; }
      return super.emit(event,...args);
    }
  };
}
module.exports = { validateIncoming, metadataValid, targetValid, sealIncoming, verifyProof,
  makeRequestListener, guardedServerClass, MARKER, MAX_HEADERS, BODY_LIMIT };
