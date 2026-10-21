'use strict';
const crypto = require('node:crypto');
function requireSafe(ok, code) { if (!ok) throw new Error(code); }
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  requireSafe(value === null || ['string', 'boolean'].includes(typeof value) || (typeof value === 'number' && Number.isFinite(value)), 'INVALID_JSON');
  return JSON.stringify(value);
}
const digest = value => crypto.createHash('sha256').update(canonical(value)).digest('hex');
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function sign(payload, privateKey) {
  requireSafe(crypto.createPrivateKey(privateKey).asymmetricKeyType === 'ed25519', 'KEY_TYPE');
  return { payload, signature: crypto.sign(null, Buffer.from(canonical(payload)), privateKey).toString('base64') };
}
function verify(envelope, publicKey) {
  try {
    requireSafe(envelope && Object.keys(envelope).sort().join(',') === 'payload,signature', 'SIGNATURE');
    requireSafe(crypto.createPublicKey(publicKey).asymmetricKeyType === 'ed25519', 'SIGNATURE');
    requireSafe(typeof envelope.signature === 'string' && crypto.verify(null, Buffer.from(canonical(envelope.payload)), publicKey, Buffer.from(envelope.signature, 'base64')), 'SIGNATURE');
    return envelope.payload;
  } catch { throw new Error('SIGNATURE'); }
}
module.exports = { requireSafe, canonical, digest, hash, sign, verify };
