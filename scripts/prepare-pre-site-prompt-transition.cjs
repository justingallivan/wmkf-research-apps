#!/usr/bin/env node
/** Offline only. Reads one explicit snapshot export, writes a create-only local
 * review artifact. Never loads env, Dataverse, model/provider clients or secrets.
 * Usage: node scripts/prepare-pre-site-prompt-transition.cjs --input snapshot.json --output plan.json
 */
const fs = require('node:fs');
const { parseJson, LIMITS } = require('../lib/prompt-publication/json-contract');
const { preparePreSiteTransition } = require('../lib/prompt-publication/pre-site-transition');
function main(args) {
  if (args.length !== 4 || args[0] !== '--input' || args[2] !== '--output' || !args[1] || !args[3]) throw new Error('Expected --input snapshot.json --output plan.json');
  if (fs.statSync(args[1]).size > LIMITS.bytes) throw new Error('Snapshot exceeds input limit');
  const plan = preparePreSiteTransition(parseJson(fs.readFileSync(args[1], 'utf8')));
  fs.writeFileSync(args[3], JSON.stringify(plan, null, 2) + '\n', { flag:'wx', mode:0o600 });
  console.log(JSON.stringify({action:plan.action,currentSnapshotHash:plan.currentSnapshotHash,proposedSnapshotHash:plan.proposedSnapshotHash,deploymentAuthorized:false}));
}
if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(error.code || 'pre_site_transition_preparation_failed'); process.exitCode = 1; }
}
module.exports = { main };
