import { secureMutation } from '@/lib/secure-route';
import { NextResponse } from 'next/server';
import { signOut } from '@/auth';

export const POST = secureMutation(async function POST() {
  const result = await signOut({ redirect: false });
  return NextResponse.json(result, {headers:{'Cache-Control':'no-store'}});
});
