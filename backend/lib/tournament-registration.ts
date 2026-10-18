import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { assertCompetitiveIdentity } from './permissions';
import { assertCurrentPermission } from './transaction-authority';
import { assertTournamentIndependent } from './competition-authority';
import { writeAudit } from './audit';
import { SecurityError } from './security-error';
import { configurationPolicy, rosterConfiguration, competitiveFormats, entrantCapacities, classifyVerifiedActiveStarters, type CompetitiveFormat } from './tournament-configuration';
import { attendanceRuleVersion, assertCheckInTime, protectedDeadline, completeEntrant, registrationDeadline, selfAttendancePolicy } from './tournament-attendance-policy';
const fail = (code: string): never => { throw new SecurityError(code, 409); };
const memberSchema = z.object({ playerId:z.string().min(1), isStarter:z.boolean() }).strict();
const registrationSchema = z.object({ teamId:z.string().min(1).optional(), roster:z.array(memberSchema).min(1).max(6) }).strict();
const latenessSchema = z.object({ reason:z.string().trim().min(1).max(1000), evidenceRef:z.string().trim().min(1).max(200).optional(), matchId:z.string().min(1).optional() }).strict();
function parse<T>(schema: z.ZodType<T>, raw: unknown) { const result=schema.safeParse(raw); if (!result.success) throw new SecurityError('INVALID_INPUT',400); return result.data; }
// JSONB normalizes object-key order. Canonicalize before hashing so an auditor can
// recompute the same digest after reading the stored snapshot back from PostgreSQL.
export function snapshotDigest(value: unknown): string {
  function canonical(item: unknown): string {
    if (Array.isArray(item)) return '[' + item.map(canonical).join(',') + ']';
    if (item !== null && typeof item === 'object') return '{' + Object.entries(item).sort(([a],[b])=>a < b ? -1 : a > b ? 1 : 0).map(([key,val])=>JSON.stringify(key)+':'+canonical(val)).join(',') + '}';
    const encoded=JSON.stringify(item);
    if (encoded === undefined) throw new SecurityError('INVALID_LOCK_SNAPSHOT',409);
    return encoded;
  }
  return createHash('sha256').update(canonical(value)).digest('hex');
}
async function eventLock(tx: Prisma.TransactionClient,tournamentId: string) {
  await tx.$queryRaw`SELECT "id" FROM "Tournament" WHERE "id" = ${tournamentId} FOR UPDATE`;
  const event=await tx.tournament.findUnique({where:{id:tournamentId},include:{registrationPolicy:true,lockSnapshot:true}});
  if (!event) throw new SecurityError('TOURNAMENT_NOT_FOUND',404);
  if (event.configurationPolicy !== configurationPolicy) fail('LEGACY_EVENT_REQUIRES_EXPLICIT_MIGRATION');
  if (event.style !== 'Open Bracket' || event.entryFee !== 0 || !competitiveFormats.includes(event.format as CompetitiveFormat) || !entrantCapacities.includes(event.capacity as 2)) fail('UNSUPPORTED_CONFIGURATION');
  return event;
}
type Event = Awaited<ReturnType<typeof eventLock>>;
function requirePolicy(event: Event) {
  const policy=event.registrationPolicy;
  if (!policy) return fail('EVENT_REQUIRES_FINAL_GOVERNANCE_OPENING');
  if (!event.startsAt || policy.registrationClosesAt.getTime() !== registrationDeadline(event.startsAt).getTime()) fail('REGISTRATION_POLICY_VERSION_MISMATCH');
  if (policy.rulesVersion !== attendanceRuleVersion || event.rulesVersion !== attendanceRuleVersion || policy.attendancePolicyRef !== selfAttendancePolicy || policy.deadlineApprovalRef !== attendanceRuleVersion) fail('HISTORICAL_POLICY_REQUIRES_EXPLICIT_REVIEW');
  return policy;
}
async function clock(tx: Prisma.TransactionClient) { return (await tx.$queryRaw<Array<{now:Date}>>`SELECT clock_timestamp() AS "now"`)[0].now; }
async function users(tx: Prisma.TransactionClient,ids: string[]) {
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ANY(${[...new Set(ids)].sort()}::text[]) ORDER BY "id" FOR UPDATE`;
  return tx.user.findMany({where:{id:{in:ids}},include:{profile:true,externalIdentities:true}});
}
async function actorProfile(tx: Prisma.TransactionClient,actorId: string) {
  const actor=(await users(tx,[actorId]))[0];
  if (!actor?.profile) throw new SecurityError('COMPETITIVE_IDENTITY_REQUIRED');
  assertCompetitiveIdentity(actor); return actor.profile;
}
async function authorizeEntry(tx: Prisma.TransactionClient,actorId: string,entry:{teamId:string|null;soloPlayerId:string|null}) {
  const profile=await actorProfile(tx,actorId);
  if (entry.teamId) {
    await tx.$queryRaw`SELECT "id" FROM "Team" WHERE "id" = ${entry.teamId} FOR UPDATE`;
    if ((await tx.team.findUnique({where:{id:entry.teamId}}))?.captainId !== profile.id) throw new SecurityError('ONLY_TEAM_CAPTAIN');
  } else if (entry.soloPlayerId !== profile.id) throw new SecurityError('ONLY_REGISTERED_PLAYER');
  return profile;
}
function editable(event: Event) { if (event.lockSnapshot || ['ROSTER_LOCKED','LIVE','COMPLETED','ARCHIVED'].includes(event.status)) fail('TOURNAMENT_ROSTER_LOCKED'); }
function validateRosterShape(event:Event,roster:z.infer<typeof memberSchema>[],allowEmpty=false) {
  const config=rosterConfiguration(event.format as CompetitiveFormat);
  if (new Set(roster.map(p=>p.playerId)).size !== roster.length) fail('DUPLICATE_PLAYER');
  const active=roster.filter(p=>p.isStarter).length,bench=roster.length-active;
  if (active > config.starters || (!allowEmpty && active < 1)) fail('INVALID_ACTIVE_LINEUP');
  if (bench && config.approvedSubstituteLimit === null) fail('SUBSTITUTE_MAXIMUM_UNRESOLVED');
  if (bench > (config.approvedSubstituteLimit ?? 0)) fail('SUBSTITUTE_LIMIT_EXCEEDED');
}
async function validateRoster(tx: Prisma.TransactionClient,event: Event,roster:z.infer<typeof memberSchema>[],teamId:string|null,excludeId?:string) {
  validateRosterShape(event,roster);
  let profiles=await tx.playerProfile.findMany({where:{id:{in:roster.map(p=>p.playerId)}}});
  if (profiles.length !== roster.length) fail('PLAYER_NOT_FOUND');
  {
    const accounts=await users(tx,profiles.map(p=>p.userId)); accounts.forEach(assertCompetitiveIdentity);
    if (accounts.length !== profiles.length) fail('COMPETITIVE_IDENTITY_REQUIRED');
    await tx.$queryRaw`SELECT "id" FROM "PlayerProfile" WHERE "id" = ANY(${roster.map(p=>p.playerId).sort()}::text[]) ORDER BY "id" FOR UPDATE`;
    profiles=await tx.playerProfile.findMany({where:{id:{in:roster.map(p=>p.playerId)}}});
  }
  if (profiles.some(p=>p.floor < 1)) fail('FLOOR_ELIGIBILITY_UNRESOLVED');
  if (teamId) {
    await tx.$queryRaw`SELECT "id" FROM "TeamMembership" WHERE "teamId" = ${teamId} AND "leftAt" IS NULL FOR SHARE`;
    const memberships=await tx.teamMembership.findMany({where:{teamId,leftAt:null,playerId:{in:roster.map(p=>p.playerId)}}});
    if (profiles.some(p=>!memberships.some(m=>m.playerId === p.id))) fail('CURRENT_TEAM_MEMBERSHIP_REQUIRED');
  }
  if (await tx.tournamentRosterMember.findFirst({where:{playerId:{in:roster.map(p=>p.playerId)},registration:{tournamentId:event.id,withdrawnAt:null,...(excludeId ? {id:{not:excludeId}} : {})}}})) fail('DUPLICATE_TOURNAMENT_PARTICIPATION');
}
async function audit(tx: Prisma.TransactionClient,actorId:string,tournamentId:string,action:string,entityId=tournamentId) {
  await writeAudit(tx,{actorId,tournamentId,action,entityType:'Tournament',entityId});
}
export async function openRegistration(actorId:string,tournamentId:string) {
  return prisma.$transaction(async tx=> {
    const event=await eventLock(tx,tournamentId); editable(event);
    await actorProfile(tx,actorId);
    if (event.hostUserId !== actorId) throw new SecurityError('ONLY_TOURNAMENT_HOST');
    if (event.status !== 'DRAFT' || !event.startsAt || await clock(tx) >= registrationDeadline(event.startsAt)) fail('REGISTRATION_CANNOT_OPEN');
    // Adopt the new owner-approved policy only on an unopened draft, never on
    // historical/published events or a populated roster.
    if (event.registrationPolicy || await tx.tournamentRegistration.count({where:{tournamentId}})) fail('EXISTING_POLICY_REQUIRES_EXPLICIT_REVIEW');
    await tx.tournamentRegistrationPolicy.create({data:{tournamentId,registrationClosesAt:registrationDeadline(event.startsAt!),deadlineApprovalRef:attendanceRuleVersion,rulesVersion:attendanceRuleVersion,attendancePolicyRef:selfAttendancePolicy}});
    await tx.tournament.update({where:{id:tournamentId},data:{status:'REGISTRATION_OPEN',rulesVersion:attendanceRuleVersion,maxSubstitutes:rosterConfiguration(event.format as CompetitiveFormat).approvedSubstituteLimit}});
    await audit(tx,actorId,tournamentId,'FINAL_GOVERNANCE_REGISTRATION_OPENED'); return {status:'REGISTRATION_OPEN',rulesVersion:attendanceRuleVersion,registrationClosesAt:registrationDeadline(event.startsAt!)};
  });
}
export async function registerEntrant(actorId:string,tournamentId:string,raw:unknown) {
  const input=parse(registrationSchema,raw);
  return prisma.$transaction(async tx=> {
    const event=await eventLock(tx,tournamentId); editable(event); const policy=requirePolicy(event),now=await clock(tx);
    if (event.status !== 'REGISTRATION_OPEN' || now >= policy.registrationClosesAt) fail('REGISTRATION_CLOSED');
    const own=await actorProfile(tx,actorId);
    await authorizeEntry(tx,actorId,{teamId:input.teamId ?? null,soloPlayerId:!input.teamId ? own.id : null});
    if (event.format === '1v1' ? !!input.teamId || input.roster.length !== 1 || input.roster[0].playerId !== own.id : !input.teamId) fail('ENTRANT_FORMAT_MISMATCH');
    await validateRoster(tx,event,input.roster,input.teamId ?? null);
    if (await tx.tournamentRegistration.count({where:{tournamentId,withdrawnAt:null,disqualifiedAt:null}}) >= event.capacity) fail('TOURNAMENT_CAPACITY_REACHED');
    const prior=await tx.tournamentRegistration.findFirst({where:{tournamentId,...(input.teamId ? {teamId:input.teamId} : {soloPlayerId:own.id})}});
    if (prior) fail('ENTRANT_ALREADY_RECORDED');
    if (await clock(tx) >= policy.registrationClosesAt) fail('REGISTRATION_CLOSED');
    const entry=await tx.tournamentRegistration.create({data:{tournamentId,teamId:input.teamId,soloPlayerId:!input.teamId ? own.id : null,status:'APPROVED',roster:{create:input.roster}},select:{id:true,status:true}});
    await audit(tx,actorId,tournamentId,'ENTRANT_REGISTERED',entry.id); return entry;
  });
}
export async function editRoster(actorId:string,tournamentId:string,registrationId:string,raw:unknown) {
  const input=parse(z.object({roster:z.array(memberSchema).min(1).max(6)}).strict(),raw);
  return prisma.$transaction(async tx=> {
    const event=await eventLock(tx,tournamentId); editable(event); requirePolicy(event);
    const entry=await tx.tournamentRegistration.findFirst({where:{id:registrationId,tournamentId,withdrawnAt:null,disqualifiedAt:null}});
    if (!entry) throw new SecurityError('REGISTRATION_NOT_FOUND',404);
    await authorizeEntry(tx,actorId,entry);
    if (!entry.teamId) fail('SOLO_ROSTER_CANNOT_BE_REASSIGNED');
    await validateRoster(tx,event,input.roster,entry.teamId,entry.id);
    const prior=await tx.tournamentRosterMember.findMany({where:{registrationId}});
    await tx.tournamentRosterMember.deleteMany({where:{registrationId,playerId:{notIn:input.roster.map(p=>p.playerId)}}});
    for (const member of input.roster) {
      if (prior.some(p=>p.playerId === member.playerId)) await tx.tournamentRosterMember.update({where:{registrationId_playerId:{registrationId,playerId:member.playerId}},data:{isStarter:member.isStarter}});
      else await tx.tournamentRosterMember.create({data:{registrationId,...member}});
    }
    await writeAudit(tx,{actorId,tournamentId,action:'PRELOCK_ROSTER_CHANGED',entityType:'TournamentRegistration',entityId:registrationId,metadata:{previousRoster:JSON.stringify(prior.map(p=>({playerId:p.playerId,isStarter:p.isStarter}))),nextRoster:JSON.stringify(input.roster)}}); return {status:'UPDATED'};
  });
}
export async function withdrawEntrant(actorId:string,tournamentId:string,registrationId:string) {
  return prisma.$transaction(async tx=> {
    const event=await eventLock(tx,tournamentId);
    const entry=await tx.tournamentRegistration.findFirst({where:{id:registrationId,tournamentId}});
    if (!entry) throw new SecurityError('REGISTRATION_NOT_FOUND',404);
    await authorizeEntry(tx,actorId,entry);
    if (entry.withdrawnAt) fail('ALREADY_WITHDRAWN');
    await tx.tournamentRegistration.update({where:{id:registrationId},data:{withdrawnAt:await clock(tx)}});
    await audit(tx,actorId,tournamentId,event.lockSnapshot ? 'POSTLOCK_WITHDRAWAL_RECORDED' : 'ENTRANT_WITHDRAWN',registrationId);
    return {status:'WITHDRAWN',lockedClassificationPreserved:!!event.lockSnapshot};
  });
}
type Rejection = { rejected: string };
function resolveResult<T>(result:T|Rejection):T {
  if (result && typeof result === 'object' && 'rejected' in result) throw new SecurityError(String(result.rejected),409);
  return result as T;
}
// Expiry is committed even when the enclosing request returns a conflict. Throwing
// inside the transaction would roll back the expiry/audit along with the denial.
async function expireLatenessRequests(tx:Prisma.TransactionClient,tournamentId:string,actorId:string,now:Date) {
  const requests=await tx.tournamentLatenessRequest.findMany({where:{tournamentId,status:'REQUESTED',policyVersion:attendanceRuleVersion}});
  for (const request of requests) {
    if (now <= request.protectedDeadline) continue;
    await tx.tournamentLatenessRequest.update({where:{id:request.id},data:{status:'EXPIRED',expiredAt:now}});
    const claim=await tx.tournamentLatenessClaim.findUnique({where:{id:request.claimId}});
    if (claim && !claim.usedAt) await tx.tournamentLatenessClaim.update({where:{id:claim.id},data:{decision:'EXPIRED',decisionAt:now}});
    await audit(tx,actorId,tournamentId,'LATENESS_REQUEST_EXPIRED',request.id);
  }
}
export async function checkInPlayer(actorId:string,tournamentId:string,raw:unknown={}) {
  const input=parse(z.object({latenessRequestId:z.string().min(1).optional()}).strict(),raw);
  const result=await prisma.$transaction(async tx=> {
    const event=await eventLock(tx,tournamentId); requirePolicy(event);
    const profile=await actorProfile(tx,actorId);
    const member=await tx.tournamentRosterMember.findFirst({where:{playerId:profile.id,registration:{tournamentId,withdrawnAt:null,disqualifiedAt:null,status:'APPROVED'}}});
    if (!member) throw new SecurityError('REGISTRATION_NOT_FOUND',404);
    // A successful action stays idempotent after its window and roster lock.
    // A supplied request must belong to this same successful attendance action.
    if (member.checkedInAt && member.checkInRuleVersion === attendanceRuleVersion) {
      if (input.latenessRequestId) {
        const prior=await tx.tournamentLatenessRequest.findUnique({where:{id:input.latenessRequestId},include:{claim:true}});
        if (!prior || prior.tournamentId !== tournamentId || prior.claim.playerId !== profile.id || prior.status !== 'AUTO_APPROVED') fail('LATENESS_REQUEST_NOT_APPROVED_FOR_PLAYER');
      }
      return {status:'CONFIRMED',checkedInAt:member.checkedInAt,attendance:'SELF_CONFIRMED'};
    }
    editable(event);
    if (!['REGISTRATION_OPEN','REGISTRATION_CLOSED','CHECK_IN'].includes(event.status)) fail('CHECK_IN_NOT_AVAILABLE');
    // Floors, current membership and identity are rechecked in the same transaction.
    await tx.$queryRaw`SELECT "id" FROM "PlayerProfile" WHERE "id" = ${profile.id} FOR UPDATE`;
    const current=await tx.playerProfile.findUnique({where:{id:profile.id}});
    const entry=await tx.tournamentRegistration.findUnique({where:{id:member.registrationId}});
    if (entry?.teamId) await tx.$queryRaw`SELECT "id" FROM "TeamMembership" WHERE "teamId" = ${entry.teamId} AND "playerId" = ${profile.id} AND "leftAt" IS NULL FOR SHARE`;
    if (entry?.teamId && !await tx.teamMembership.findFirst({where:{teamId:entry.teamId,playerId:profile.id,leftAt:null}})) fail('CURRENT_TEAM_MEMBERSHIP_REQUIRED');
    const now=await clock(tx);
    if (now < event.startsAt!) {
      if (input.latenessRequestId) fail('LATE_CHECK_IN_NOT_STARTED');
      assertCheckInTime(event.startsAt!,now);
    } else {
      protectedDeadline(current?.floor ?? 0,event.startsAt!);
      await expireLatenessRequests(tx,tournamentId,actorId,now);
      if (now > protectedDeadline(2,event.startsAt!)) return {rejected:'PROTECTED_CHECK_IN_DEADLINE_PASSED'};
      if (!input.latenessRequestId) fail('PERSONAL_LATENESS_REQUEST_REQUIRED');
      const request=await tx.tournamentLatenessRequest.findUnique({where:{id:input.latenessRequestId},include:{claim:true}});
      if (!request || request.tournamentId !== tournamentId || request.matchId || request.claim.playerId !== profile.id || request.policyVersion !== attendanceRuleVersion || request.scheduledStart.getTime() !== event.startsAt!.getTime()) return fail('LATENESS_REQUEST_NOT_FOUND');
      if (request.status !== 'REQUESTED' || request.claim.usedAt) fail('LATENESS_INCIDENT_UNAVAILABLE');
      const consumed=await tx.tournamentLatenessClaim.updateMany({where:{id:request.claimId,usedAt:null,policyVersion:attendanceRuleVersion},data:{usedAt:now,decision:'AUTO_APPROVED',decisionAt:now,decisionById:actorId}});
      if (consumed.count !== 1) fail('LATENESS_INCIDENT_ALREADY_USED');
      await tx.tournamentLatenessRequest.update({where:{id:request.id},data:{status:'AUTO_APPROVED',completedAt:now}});
      await audit(tx,actorId,tournamentId,'LATENESS_AUTOMATICALLY_APPROVED_AND_USED',request.id);
    }
    await tx.tournamentRosterMember.update({where:{id:member.id},data:{checkedInAt:now,checkInRuleVersion:attendanceRuleVersion}});
    await audit(tx,actorId,tournamentId,'PLAYER_SELF_CHECK_IN_CONFIRMED',member.id);
    return {status:'CONFIRMED',checkedInAt:now,attendance:'SELF_CONFIRMED'};
  });
  return resolveResult(result);
}
export async function recordLatenessClaim(actorId:string,tournamentId:string,raw:unknown) {
  const input=parse(latenessSchema,raw);
  const result=await prisma.$transaction(async tx=> {
    const event=await eventLock(tx,tournamentId); editable(event); requirePolicy(event); const profile=await actorProfile(tx,actorId);
    const member=await tx.tournamentRosterMember.findFirst({where:{playerId:profile.id,registration:{tournamentId,withdrawnAt:null,disqualifiedAt:null,status:'APPROVED'}}});
    if (!member) throw new SecurityError('REGISTRATION_NOT_FOUND',404);
    if (input.matchId) fail('MATCH_SCHEDULE_INTEGRATION_UNAVAILABLE');
    const entry=await tx.tournamentRegistration.findUnique({where:{id:member.registrationId}});
    if (entry?.teamId) {
      await tx.$queryRaw`SELECT "id" FROM "TeamMembership" WHERE "teamId" = ${entry.teamId} AND "playerId" = ${profile.id} AND "leftAt" IS NULL FOR SHARE`;
      if (!await tx.teamMembership.findFirst({where:{teamId:entry.teamId,playerId:profile.id,leftAt:null}})) fail('CURRENT_TEAM_MEMBERSHIP_REQUIRED');
    }
    await tx.$queryRaw`SELECT "id" FROM "PlayerProfile" WHERE "id" = ${profile.id} FOR UPDATE`;
    const current=await tx.playerProfile.findUnique({where:{id:profile.id}});
    const scheduledStart=event.startsAt!,deadline=protectedDeadline(current?.floor ?? 0,scheduledStart),now=await clock(tx);
    if (now < scheduledStart) fail('LATENESS_HAS_NOT_STARTED');
    await expireLatenessRequests(tx,tournamentId,actorId,now);
    if (now > deadline) return {rejected:'PROTECTED_CHECK_IN_DEADLINE_PASSED'};
    if (member.checkedInAt) fail('PLAYER_ALREADY_CHECKED_IN');
    let claim=await tx.tournamentLatenessClaim.findUnique({where:{tournamentId_playerId:{tournamentId,playerId:profile.id}}});
    if (claim?.usedAt) fail('LATENESS_INCIDENT_ALREADY_USED');
    if (claim && claim.policyVersion !== attendanceRuleVersion) fail('HISTORICAL_LATENESS_REQUIRES_REVIEW');
    if (claim && await tx.tournamentLatenessRequest.findFirst({where:{claimId:claim.id,status:'REQUESTED'}})) fail('LATENESS_REQUEST_ALREADY_PENDING');
    if (!claim) claim=await tx.tournamentLatenessClaim.create({data:{tournamentId,playerId:profile.id,scheduledStart,protectedDeadline:deadline,reason:input.reason,evidenceRef:input.evidenceRef ?? '',policyVersion:attendanceRuleVersion,decision:'REQUESTED'}});
    const request=await tx.tournamentLatenessRequest.create({data:{claimId:claim.id,tournamentId,scheduledStart,protectedDeadline:deadline,reason:input.reason,policyVersion:attendanceRuleVersion,requestedAt:now},select:{id:true,status:true,protectedDeadline:true}});
    await audit(tx,actorId,tournamentId,'PERSONAL_LATENESS_REQUEST_RECORDED',request.id); return request;
  });
  return resolveResult(result);
}
export async function finalizeTournament(actorId:string,tournamentId:string) {
  return prisma.$transaction(async tx=> {
    const event=await eventLock(tx,tournamentId); editable(event); const policy=requirePolicy(event),now=await clock(tx);
    await assertCurrentPermission(tx,actorId,'REVIEW_MINOR'); await assertTournamentIndependent(tx,actorId,tournamentId);
    if (!['REGISTRATION_OPEN','REGISTRATION_CLOSED','CHECK_IN'].includes(event.status) || now < event.startsAt!) fail('FINALIZATION_NOT_AVAILABLE');

    let entries=await tx.tournamentRegistration.findMany({where:{tournamentId,withdrawnAt:null,status:'APPROVED',disqualifiedAt:null},include:{roster:{include:{player:true}}}});
    const accounts=await users(tx,entries.flatMap(e=>e.roster.map(p=>p.player.userId)));
    const identityEligible=new Map(accounts.map(account=> {
      try {assertCompetitiveIdentity(account);return [account.id,true] as const;} catch {return [account.id,false] as const;}
    }));
    await tx.$queryRaw`SELECT "id" FROM "PlayerProfile" WHERE "id" = ANY(${[...new Set(entries.flatMap(e=>e.roster.map(p=>p.playerId)))].sort()}::text[]) ORDER BY "id" FOR UPDATE`;
    entries=await tx.tournamentRegistration.findMany({where:{tournamentId,withdrawnAt:null,status:'APPROVED',disqualifiedAt:null},include:{roster:{include:{player:true}}}});
    await expireLatenessRequests(tx,tournamentId,actorId,now);
    const claims=await tx.tournamentLatenessClaim.findMany({where:{tournamentId}});
    const approvedRequests=await tx.tournamentLatenessRequest.findMany({where:{tournamentId,status:'AUTO_APPROVED',policyVersion:attendanceRuleVersion}});
    const seen=new Set<string>(),qualified:typeof entries=[],disqualified:typeof entries=[];
    for (const entry of entries) {
      for (const member of entry.roster) { if (seen.has(member.playerId)) fail('DUPLICATE_TOURNAMENT_PARTICIPATION'); seen.add(member.playerId); }
      validateRosterShape(event,entry.roster,true);
      if (entry.teamId) await tx.$queryRaw`SELECT "id" FROM "Team" WHERE "id" = ${entry.teamId} FOR UPDATE`;
      if (entry.teamId) await tx.$queryRaw`SELECT "id" FROM "TeamMembership" WHERE "teamId" = ${entry.teamId} AND "leftAt" IS NULL FOR SHARE`;
      const memberships=entry.teamId ? await tx.teamMembership.findMany({where:{teamId:entry.teamId,leftAt:null}}) : [];
      const eligible=(member:typeof entry.roster[number])=>identityEligible.get(member.player.userId) === true && member.player.floor >= 1 && (!entry.teamId || memberships.some(m=>m.playerId === member.playerId));
      const attended=(member:typeof entry.roster[number])=> {
        if (!member.checkedInAt || member.checkInRuleVersion !== attendanceRuleVersion) return false;
        if (member.checkedInAt >= registrationDeadline(event.startsAt!) && member.checkedInAt < event.startsAt!) return true;
        return approvedRequests.some(r=>r.claimId === claims.find(c=>c.playerId === member.playerId && c.usedAt)?.id && !r.matchId && r.completedAt?.getTime() === member.checkedInAt!.getTime());
      };
      if (now <= protectedDeadline(2,event.startsAt!) && entry.roster.some(p=>p.isStarter && p.player.floor === 2 && eligible(p) && !attended(p) && !claims.some(c=>c.playerId === p.playerId && c.usedAt))) fail('FLOOR_2_PROTECTION_WINDOW_PENDING');
      const complete=completeEntrant(event.startersPerTeam,entry.roster.map(p=>({isStarter:p.isStarter,eligible:eligible(p),attended:attended(p)})));
      (complete ? qualified : disqualified).push(entry);
    }
    const classification=classifyVerifiedActiveStarters(event.format as CompetitiveFormat,qualified.map(e=>({players:e.roster.map(p=>({playerId:p.playerId,activeStarter:p.isStarter,verifiedEligible:true}))})));
    const snapshot={lateAttendance:approvedRequests.map(r=>({requestId:r.id,claimId:r.claimId,scheduledStart:r.scheduledStart.toISOString(),protectedDeadline:r.protectedDeadline.toISOString(),completedAt:r.completedAt?.toISOString() ?? null})),policy:attendanceRuleVersion,attendanceMeaning:'PLAYER_SELF_CONFIRMATION_NOT_PHYSICAL_VERIFICATION',attendancePolicyRef:policy.attendancePolicyRef,deadlineApprovalRef:policy.deadlineApprovalRef,
      settings:{format:event.format,capacity:event.capacity,style:event.style,startsAt:event.startsAt!.toISOString(),registrationClosesAt:policy.registrationClosesAt.toISOString(),entryFee:event.entryFee,startersPerTeam:event.startersPerTeam,maxSubstitutes:rosterConfiguration(event.format as CompetitiveFormat).approvedSubstituteLimit,rulesVersion:policy.rulesVersion},
      entrants:qualified.map(e=>({registrationId:e.id,teamId:e.teamId,players:e.roster.map(p=>({playerId:p.playerId,userId:p.player.userId,floor:p.player.floor,accountStatus:accounts.find(a=>a.id === p.player.userId)!.accountStatus,identityEligible:identityEligible.get(p.player.userId) === true,activeStarter:p.isStarter,checkedInAt:p.checkedInAt?.toISOString() ?? null,checkInRuleVersion:p.checkInRuleVersion,attendanceMeaning:'SELF_CONFIRMED',identities:accounts.find(a=>a.id === p.player.userId)!.externalIdentities.map(i=>({identityId:i.id,provider:i.provider,verifiedAt:i.verifiedAt.toISOString()}))}))})),
      disqualifiedRegistrationIds:disqualified.map(e=>e.id)};
    for (const entry of disqualified) await tx.tournamentRegistration.update({where:{id:entry.id},data:{disqualifiedAt:now,disqualificationReason:'INCOMPLETE_ACTIVE_STARTERS'}});
    for (const entry of qualified) await tx.tournamentRegistration.update({where:{id:entry.id},data:{rosterLockedAt:now}});
    await tx.tournament.update({where:{id:tournamentId},data:{status:'ROSTER_LOCKED'}});
    const locked=await tx.tournamentLockSnapshot.create({data:{tournamentId,lockedAt:now,lockedById:actorId,rulesVersion:policy.rulesVersion,...classification,snapshot,digest:snapshotDigest(snapshot)},select:{tournamentId:true,lockedAt:true,activePlayerCount:true,classification:true,digest:true}});
    await writeAudit(tx,{actorId,tournamentId,action:'ROSTERS_SETTINGS_AND_CLASSIFICATION_LOCKED',entityType:'Tournament',entityId:tournamentId,metadata:{activePlayerCount:locked.activePlayerCount,classification:locked.classification,digest:locked.digest}});
    for (const entry of disqualified) await audit(tx,actorId,tournamentId,'INCOMPLETE_ENTRANT_DISQUALIFIED',entry.id);
    return locked;
  },{timeout:30000});
}

export async function playerAttendanceStatus(actorId:string,tournamentId:string) {
  return prisma.$transaction(async tx=> {
    const event=await eventLock(tx,tournamentId); requirePolicy(event);
    const profile=await actorProfile(tx,actorId);
    const member=await tx.tournamentRosterMember.findFirst({where:{playerId:profile.id,registration:{tournamentId,withdrawnAt:null,disqualifiedAt:null,status:'APPROVED'}}});
    if (!member) throw new SecurityError('REGISTRATION_NOT_FOUND',404);
    const claim=await tx.tournamentLatenessClaim.findUnique({where:{tournamentId_playerId:{tournamentId,playerId:profile.id}}});
    const request=claim ? await tx.tournamentLatenessRequest.findFirst({where:{claimId:claim.id,status:'REQUESTED'}}) : null;
    const now=await clock(tx);
    return {checkedInAt:member.checkedInAt,attendance:member.checkedInAt ? 'SELF_CONFIRMED' : 'NOT_CHECKED_IN',
      serverTime:now,checkInOpensAt:registrationDeadline(event.startsAt!),checkInClosesAt:event.startsAt,
      protectionUsed:!!claim?.usedAt,pendingRequest:request ? {id:request.id,status:now > request.protectedDeadline ? 'EXPIRED' : request.status,protectedDeadline:request.protectedDeadline} : null};
  });
}
