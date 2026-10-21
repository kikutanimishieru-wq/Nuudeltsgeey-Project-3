#!/usr/bin/env node
'use strict';
const { readPrivate, writeExclusive } = require('./manifest.cjs');
const { analyze } = require('./dry-run.cjs');
function main(args) {
  if (args.length < 3 || args[0] !== 'dry-run') throw new Error('USAGE');
  // Offline signed snapshot only. Deliberately accepts no URL, key or policy override.
  const [, inventoryPath, outputPath, ...manifestDirectories] = args;
  const report = analyze({ inventory: readPrivate(inventoryPath), manifestDirectories });
  writeExclusive(outputPath, report);
  process.stdout.write(JSON.stringify({ status: report.status, blockers: report.blockers, approvedDeletionCount: 0 }) + '\n');
  return 2;
}
if (require.main === module) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch { process.stderr.write('BLOCKED: local dry-run input or verification failed; details suppressed.\n'); process.exitCode = 2; }
}
module.exports = { main };
