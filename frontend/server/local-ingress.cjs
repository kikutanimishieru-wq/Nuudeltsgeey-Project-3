'use strict';
// Importing this module does not create listeners or load Next.
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { Server } = require('node:http');
const { guardedServerClass, makeRequestListener, MAX_HEADERS } = require('./ingress-policy.cjs');
const SHUTDOWN_MS = 5000;
async function main() {
  if (process.env.NODE_ENV !== 'development' || process.env.FRONTEND_CANONICAL_ORIGIN !== 'http://localhost:3002'
    || process.env.BACKEND_INTERNAL_ORIGIN !== 'http://127.0.0.1:3001') throw new Error('LOCAL_CONFIGURATION_REQUIRED');
  // Generated before Next loads/prepares. Never accepted from the launching env.
  process.env.NUUDEL_LOCAL_INGRESS_KEY = randomBytes(32).toString('hex');
  process.env.NUUDEL_LOCAL_INGRESS_MODE = 'development-v1';
  let app, server, bindAbort;
  let state = 'PREPARING'; // PREPARING -> BINDING -> RUNNING -> STOPPING -> EXIT_REQUESTED
  let prepareSettled = false;
  let cleanupStarted = false;
  let requestedStatus = 1;
  let finishBind;
  const stopping = () => state === 'STOPPING' || state === 'EXIT_REQUESTED';
  const requestExit = status => {
    if (state === 'EXIT_REQUESTED') return;
    state = 'EXIT_REQUESTED';
    process.exitCode = status;
    // Current process only. This does not attest that Next descendants exited.
    process.exit(status);
  };
  const cleanup = async () => {
    if (!prepareSettled || cleanupStarted || state !== 'STOPPING') return;
    cleanupStarted = true;
    const operations = [];
    if (server) {
      operations.push(new Promise((resolve,reject)=>{
        try { server.close(error => error ? reject(error) : resolve()); }
        catch { reject(new Error('CLOSE_FAILED')); }
      }));
      // Independent operation: a close() error cannot skip connection cleanup.
      operations.push(Promise.resolve().then(()=>server.closeAllConnections()));
    }
    if (app) operations.push(Promise.resolve().then(()=>app.close()));
    const outcomes = await Promise.allSettled(operations);
    if (outcomes.every(outcome=>outcome.status === 'fulfilled')) requestExit(requestedStatus);
    // Rejection/hang keeps the hard deadline armed. A resolved app.close()
    // cannot establish complete cleanup: Next itself suppresses some errors.
  };
  const tryCleanup = () => { void cleanup().catch(()=>{ /* Hard deadline remains armed. */ }); };
  const stop = status => {
    if (stopping()) return;
    state = 'STOPPING';
    requestedStatus = status;
    process.exitCode = status;
    // Never clear or unref this timer. Normal completion explicitly exits;
    // uncertain cleanup or pending preparation reaches the nonzero fallback.
    setTimeout(()=>requestExit(1),SHUTDOWN_MS);
    if (bindAbort) {
      try { bindAbort.abort(); } catch { /* Explicit close and fallback remain. */ }
    }
    if (finishBind) finishBind();
    tryCleanup();
  };
  // Keep handlers installed: repeated signals do not restore default termination
  // or reset/extend the first shutdown deadline.
  process.on('SIGINT',()=>stop(130));
  process.on('SIGTERM',()=>stop(143));
  try {
    const next = require('next');
    app = next({ dev:true,dir:path.join(__dirname,'..'),hostname:'localhost',port:3002 });
    await app.prepare();
    prepareSettled = true;
    if (stopping()) { tryCleanup(); return; }
    state = 'BINDING';
    const GuardedServer = guardedServerClass(Server);
    server = new GuardedServer({insecureHTTPParser:false,maxHeaderSize:MAX_HEADERS,headersTimeout:5000,
      requestTimeout:15000,connectionsCheckingInterval:1000,keepAliveTimeout:1000},
      makeRequestListener(app.getRequestHandler(),process.env.NUUDEL_LOCAL_INGRESS_KEY));
    server.maxHeadersCount = 0;
    server.maxConnections = 32;
    server.on('clientError',(_error,socket)=>{socket.destroy();});
    server.on('error',()=>stop(1));
    bindAbort = new AbortController();
    await new Promise(resolve=>{
      finishBind = resolve;
      server.listen({port:3002,host:'127.0.0.1',signal:bindAbort.signal},resolve);
    });
    finishBind = undefined;
    if (stopping()) return;
    state = 'RUNNING';
  } catch {
    prepareSettled = true;
    stop(1);
    tryCleanup();
  }
}
if (require.main === module) main().catch(()=>{console.error('LOCAL_INGRESS_FAILED');process.exitCode=1;});
module.exports = { main, SHUTDOWN_MS };
