import { NextResponse } from 'next/server';

export function GET() {
  return NextResponse.json({ service: 'nuudeltsgeey-backend', status: 'ok' });
}
