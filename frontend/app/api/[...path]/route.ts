import { proxyRequest } from '@/lib/server/backend-proxy';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
function handle(request: Request) {
  return proxyRequest(request, { env: {
    NUUDEL_LOCAL_INGRESS_KEY: process.env.NUUDEL_LOCAL_INGRESS_KEY,
    NUUDEL_LOCAL_INGRESS_MODE: process.env.NUUDEL_LOCAL_INGRESS_MODE,
    NODE_ENV: process.env.NODE_ENV,
    FRONTEND_CANONICAL_ORIGIN: process.env.FRONTEND_CANONICAL_ORIGIN,
    BACKEND_INTERNAL_ORIGIN: process.env.BACKEND_INTERNAL_ORIGIN,
  }, fetch });
}
export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const HEAD = handle;
export const OPTIONS = handle;
