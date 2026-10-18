import { SecurityError } from './security-error';

export function applicationOrigin() {
  const value = process.env.APP_URL;
  if (!value) throw new SecurityError('IDENTITY_CONFIGURATION_REQUIRED', 503);
  const url = new URL(value);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
      (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) {
    throw new SecurityError('INVALID_APPLICATION_ORIGIN', 503);
  }
  return url.origin;
}

export function assertSameOrigin(request: Request) {
  if (request.headers.get('origin') !== applicationOrigin() || request.headers.get('sec-fetch-site') === 'cross-site') {
    throw new SecurityError('INVALID_ORIGIN');
  }
}

export function clientRateKey(request: Request) {
  // Only configure a header that the ingress overwrites and cannot be supplied by clients.
  const trusted = process.env.TRUSTED_CLIENT_IP_HEADER;
  return trusted ? (request.headers.get(trusted)?.slice(0, 200) || 'unknown') : 'shared-ingress';
}
