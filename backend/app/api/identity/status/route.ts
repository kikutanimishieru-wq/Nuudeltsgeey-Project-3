import { hasAdministrativeHold } from '@/lib/identity-policy';
import { NextResponse } from 'next/server';
import { requireUser, authError } from '@/lib/session';
export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({ identities: ['STEAM', 'DISCORD'].map(provider => {
      const identity = user.externalIdentities.find(link => link.provider === provider);
      return { provider, verified: Boolean(identity && !identity.revokedAt && !hasAdministrativeHold(identity)), securityHold: Boolean(identity && hasAdministrativeHold(identity)), verifiedAt: identity?.verifiedAt ?? null };
    }) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { const result = authError(error); return NextResponse.json({ error: result.error }, { status: result.status }); }
}
