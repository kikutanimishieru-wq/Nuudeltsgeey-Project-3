'use strict';
// Interface reserved for architecture/owner review. No SQL, connector, callback,
// credential or environment variable can activate a destructive implementation.
const CONTRACT = Object.freeze({ version: 1, enabled: false,
  approvalBindings: ['targetDigest', 'reportDigest', 'snapshotDigest', 'manifestDigests', 'leaseFence', 'expiresAt', 'ownerApprovalDigest'],
  boundaries: ['verify-target', 'fence-and-quiesce', 'begin', 'lock-exact-tables', 'revalidate-approved-inventory', 'mutation-requires-separate-review', 'verify-preservation', 'commit', 'fresh-read-only-verification'],
  failure: 'quarantine; verify rollback or commit read-only; never automatically retry',
});
function executeCleanup() { throw new Error('CLEANUP_EXECUTOR_DISABLED'); }
module.exports = { CONTRACT, executeCleanup };
