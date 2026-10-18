import { NextResponse } from 'next/server';
import { assertSameOrigin, clientRateKey } from './request-security';
import { enforceRateLimit } from './rate-limit';
import { safeError } from './security-error';

export function secureMutation<C, R extends Request>(handler: (request: R, context: C) => Promise<Response>) {
  return async (request: R, context: C) => {
    try {
      assertSameOrigin(request);
      await enforceRateLimit('mutation-ingress', clientRateKey(request), 120);
      return await handler(request, context);
    } catch (error) {
      const result = safeError(error);
      return NextResponse.json({ error: result.error }, { status: result.status, headers: { 'Cache-Control': 'no-store', ...(result.status === 429 ? { 'Retry-After': '60' } : {}) } });
    }
  };
}
