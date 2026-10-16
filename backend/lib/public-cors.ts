export function publicCorsHeaders(request: Request) {
  const origin = request.headers.get('origin');
  const allowedOrigin = process.env.FRONTEND_ORIGIN ?? 'http://localhost:3002';
  const headers = new Headers();
  if (origin === allowedOrigin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary', 'Origin');
  }
  return headers;
}

export function publicCorsOptions(request: Request) {
  const headers = publicCorsHeaders(request);
  headers.set('Allow', 'GET, OPTIONS');
  headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return new Response(null, { status: 204, headers });
}
