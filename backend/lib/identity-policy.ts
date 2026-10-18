export function hasAdministrativeHold(identity: { administrativeHoldAt?: Date | null; revokedAt?: Date | null; revocationKind?: string | null }) {
  // Legacy revocations with unknown provenance require explicit administrator review.
  return Boolean(identity.administrativeHoldAt || (identity.revokedAt && !['SELF', 'ADMIN_CLEARED'].includes(identity.revocationKind ?? '')));
}
