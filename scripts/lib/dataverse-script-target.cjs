/**
 * Target and Production-guard checks for owner-run Dataverse scripts.
 *
 * Every Dataverse call these scripts make goes through
 * lib/dataverse/client.js, whose interlock enforces the Production read and
 * write rules — but only when DATAVERSE_TARGET_INTERLOCK resolves to `on`
 * (unset means off). These checks refuse to start a Production run unless the
 * interlock is on and the operator has opted in, so the rules cannot be
 * skipped by a missing env line, and a write run fails before its first read
 * rather than partway through.
 *
 *   --target=sandbox  DYNAMICS_SANDBOX_URL, must be a registered sandbox host
 *   --target=prod     DYNAMICS_URL, must be a registered Production host, plus
 *                     DATAVERSE_TARGET_INTERLOCK=on
 *                     DATAVERSE_ALLOW_PROD_READS=yes
 *                     DATAVERSE_PROD_WRITE_ACK="<purpose> YYYY-MM-DD" (writes;
 *                     today's UTC date)
 */

const { classifyTarget } = require('../../lib/dataverse/core/interlock.js');

const TARGETS = Object.freeze({
  prod: { envName: 'DYNAMICS_URL', classification: 'production' },
  sandbox: { envName: 'DYNAMICS_SANDBOX_URL', classification: 'sandbox' },
});

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function parseTargetArg(argv) {
  const arg = argv.find((entry) => entry.startsWith('--target='));
  const target = arg ? arg.slice('--target='.length) : null;
  if (!Object.hasOwn(TARGETS, target || '')) {
    throw new Error('Pass --target=prod or --target=sandbox.');
  }
  return target;
}

function hasDatedProdWriteAck(raw, date = todayUtc()) {
  if (typeof raw !== 'string') return false;
  const match = raw.match(/^(.*)\s+(\d{4}-\d{2}-\d{2})$/);
  return Boolean(match && match[1].trim() && match[2] === date);
}

/**
 * Resolve the Dataverse resource URL for a target and refuse an unsafe run.
 * Reads env from the caller (after loadEnvLocal) so tests can pass a fixture.
 */
function resolveTargetResource({ target, write, env = process.env, date = todayUtc() }) {
  const config = TARGETS[target];
  if (!config) throw new Error(`Unknown target: ${target}`);
  const resourceUrl = String(env[config.envName] || '').replace(/\/+$/, '');
  if (!resourceUrl) throw new Error(`${config.envName} is not set for --target=${target}.`);
  if (classifyTarget(resourceUrl) !== config.classification) {
    throw new Error(`${config.envName} is not a registered ${config.classification} Dataverse host.`);
  }
  if (target === 'prod') {
    if (env.DATAVERSE_TARGET_INTERLOCK !== 'on') {
      throw new Error('Production runs require DATAVERSE_TARGET_INTERLOCK=on.');
    }
    if (env.DATAVERSE_ALLOW_PROD_READS !== 'yes') {
      throw new Error('Production runs require DATAVERSE_ALLOW_PROD_READS=yes.');
    }
    if (write && !hasDatedProdWriteAck(env.DATAVERSE_PROD_WRITE_ACK, date)) {
      throw new Error(
        `Production writes require DATAVERSE_PROD_WRITE_ACK="<purpose> ${date}" (today's UTC date).`,
      );
    }
  }
  return resourceUrl;
}

module.exports = { parseTargetArg, resolveTargetResource, hasDatedProdWriteAck };
