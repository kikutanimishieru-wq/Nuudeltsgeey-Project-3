import type { NextRequest } from 'next/server';
import { handlers } from '@/auth';
import { secureMutation } from '@/lib/secure-route';
export const GET = handlers.GET;
export const POST = secureMutation(async (request: NextRequest) => handlers.POST(request));
