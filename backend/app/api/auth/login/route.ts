import { NextResponse } from 'next/server';
import { z } from 'zod';
import { signIn } from '@/auth';

const schema = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_LOGIN' }, { status: 400 });
  try {
    await signIn('credentials', { email: parsed.data.email, password: parsed.data.password, redirect: false });
    return NextResponse.json({ status: 'SIGNED_IN' });
  } catch {
    return NextResponse.json({ error: 'INVALID_LOGIN' }, { status: 401 });
  }
}
