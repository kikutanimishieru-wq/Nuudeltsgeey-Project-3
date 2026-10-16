import { NextResponse } from 'next/server';
import { signOut } from '@/auth';

export async function POST() {
  await signOut({ redirect: false });
  return NextResponse.json({ status: 'SIGNED_OUT' });
}
