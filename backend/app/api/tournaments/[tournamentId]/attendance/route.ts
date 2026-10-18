import { NextResponse } from 'next/server';
import { requireCompetitiveUser } from '@/lib/session';
import { safeError } from '@/lib/security-error';
import { playerAttendanceStatus } from '@/lib/tournament-registration';
export async function GET(_:Request,{params}:{params:Promise<{tournamentId:string}>}) {
  try {
    const user=await requireCompetitiveUser();
    return NextResponse.json(await playerAttendanceStatus(user.id,(await params).tournamentId),{headers:{'Cache-Control':'no-store'}});
  } catch(error) {
    const result=safeError(error);
    return NextResponse.json({error:result.error},{status:result.status,headers:{'Cache-Control':'no-store'}});
  }
}
