import { secureMutation } from '@/lib/secure-route';
import { NextResponse } from 'next/server';
import { signOut } from '@/auth';

export const POST = secureMutation(async function POST() {
  await signOut({ redirect: false });
  return NextResponse.json({ status: 'SIGNED_OUT' });
});
