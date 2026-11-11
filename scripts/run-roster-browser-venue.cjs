#!/usr/bin/env node
/** Local, real-OAuth walkthrough venue. Owns one disposable PG schema and no
 * Dataverse writes. Ctrl-C stops Next, verifies sandbox preservation, and drops
 * only the owned schema. All evidence/logs are private; no credentials printed.
 * Usage: node scripts/run-roster-browser-venue.cjs PRIVATE_FULL_ENV STAFF_ENV NEW_PRIVATE_DIR [PRIVATE_AUTHORIZED_MANIFEST]
 */
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const assert = require('node:assert/strict');
const { parse } = require('dotenv');
const { createRosterPgFixture } = require('../tests/helpers/roster-pg-fixture.cjs');
const { assertTarget, assertBrowserTarget } = require('../lib/services/expertise-finder/roster-rehearsal-target.cjs');
const { fingerprint } = require('./lib/expertise-roster-import-plan.cjs');
const CANARY = 'b34e680b-849c-4207-a2c5-689defd79aa7';
const OWNER = 900001;
const OTHER = 900002;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const root = path.resolve(__dirname, '..');
function privateInput(file) {
  assert(path.isAbsolute(file));
  const stat = fs.lstatSync(file);
  assert(stat.isFile() && !stat.isSymbolicLink() && !(stat.mode & 0o077), 'Private regular input required');
  return fs.readFileSync(file);
}
function writePrivate(dir, name, value) {
  fs.writeFileSync(path.join(dir, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}
async function freePort(host) {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen({ host, port: 3000, exclusive: true }, resolve); });
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
function validateLiveManifest(live) {
  const source = require('../docs/plans/evidence/test-request-factory/app-owned-location-rehearsal-2026-09-23.json');
  const location = source.appOwnedSharePointProvision;
  const receipt = require('../docs/plans/evidence/test-request-factory/app-owned-location-receipt-2026-09-23.json');
  const graphFolder = receipt.locationProvision.graphFolder;
  const approval = live?.authorization;
  assert(approval && ['attachments', 'matching', 'publicBlob'].every(key => typeof approval[key] === 'boolean') &&
    (approval.attachments || approval.matching) && (!approval.publicBlob || approval.matching),
  'Explicit live authorization fields required');
  assert(!approval.matching || live.approvedModel === 'claude-sonnet-5-5', 'Exact named matching model required');
  assert(live.sandboxHost === new URL(source.target).hostname && live.requestId === source.requestId &&
    live.requestNumber === source.requestNumber && live.factoryRunId === source.runId &&
    live.locationId === location.locationId && live.parentLocationId === location.parentLocationId &&
    live.library === location.parentLibrary && live.graphParentFolderId === location.graphFolderId &&
    live.graphFolderPath === `${location.folder}/Consultant Feedback` &&
    live.site?.key === 'akoyago-shared' && live.site.scope === 'shared' &&
    live.site.siteUrl === 'https://appriver3651007194.sharepoint.com/sites/akoyaGO' &&
    live.siteId === graphFolder.siteId && live.driveId === graphFolder.driveId &&
    live.blobStore === 'wmkf-uploads-private' && live.blobPrefix === `portal-staging/consultant_feedback/${source.requestId}/`,
  'Live Request or storage candidate differs from reviewed fixture');
  return live;
}
function environment(rehearsal, staff, schema, live = null) {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
    NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', AUTH_REQUIRED: 'true',
    NEXTAUTH_URL: 'http://localhost:3000', NEXTAUTH_SECRET: randomBytes(48).toString('base64url'),
    EXPERTISE_ROSTER_REHEARSAL: 'on', EXPERTISE_ROSTER_BROWSER_REHEARSAL: 'on',
    EXPERTISE_ROSTER_BROWSER_SCHEMA: schema, DYNAMICS_IMPERSONATION_ENABLED: 'true' };
  for (const key of ['POSTGRES_URL', 'DATABASE_URL', 'POSTGRES_URL_NON_POOLING', 'POSTGRES_PRISMA_URL',
    'DYNAMICS_URL', 'DYNAMICS_TENANT_ID', 'DYNAMICS_CLIENT_ID', 'DYNAMICS_CLIENT_SECRET',
    'DATAVERSE_TARGET_INTERLOCK', 'DATAVERSE_DAL_ENFORCEMENT']) {
    assert(rehearsal[key], `Missing rehearsal setting ${key}`); env[key] = rehearsal[key];
  }
  for (const key of ['AZURE_AD_CLIENT_ID', 'AZURE_AD_CLIENT_SECRET', 'AZURE_AD_TENANT_ID']) {
    assert(staff[key], `Missing staff setting ${key}`); env[key] = staff[key];
  }
  if (live) {
    const { authorization } = validateLiveManifest(live);
    env.SHAREPOINT_SITE_URL = live.site.siteUrl;
    for (const [approved, key] of [
      [authorization.attachments, 'UPLOADS_BLOB_RW_TOKEN'],
      [authorization.matching, 'CLAUDE_API_KEY'],
      [authorization.publicBlob, 'BLOB_READ_WRITE_TOKEN'],
    ]) {
      if (approved) {
        assert(staff[key], `Missing approved live setting ${key}`);
        env[key] = staff[key];
      }
    }
  }
  assertBrowserTarget(env);
  return env;
}
async function seed(fixture, user) {
  await fixture.primary.query(`ALTER TABLE user_profiles
    ADD COLUMN name VARCHAR(255) UNIQUE,
    ADD COLUMN display_name VARCHAR(255), ADD COLUMN avatar_color VARCHAR(7) DEFAULT '#6366f1',
    ADD COLUMN is_default BOOLEAN DEFAULT false, ADD COLUMN is_active BOOLEAN DEFAULT false,
    ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, ADD COLUMN last_used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN azure_id VARCHAR(255) UNIQUE, ADD COLUMN azure_email VARCHAR(255),
    ADD COLUMN last_login_at TIMESTAMP, ADD COLUMN needs_linking BOOLEAN DEFAULT false,
    ADD COLUMN dynamics_systemuser_id UUID, ADD COLUMN dynamics_reconciled_at TIMESTAMP;
    UPDATE user_profiles SET name='Synthetic fixture placeholder' WHERE id=1;
    ALTER TABLE user_profiles ALTER COLUMN name SET NOT NULL;
    CREATE TABLE dynamics_user_roles (id SERIAL PRIMARY KEY,
      user_profile_id INTEGER REFERENCES user_profiles(id) UNIQUE,
      role VARCHAR(20) NOT NULL DEFAULT 'read_only', granted_by INTEGER REFERENCES user_profiles(id),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
  await fixture.primary.query(`INSERT INTO user_profiles
    (id,name,display_name,is_active,azure_id,azure_email,dynamics_systemuser_id,needs_linking)
    VALUES ($1,'Roster walkthrough operator','Roster walkthrough operator',true,$2,$3,$4,false),
           ($5,'Synthetic unrelated user','Synthetic unrelated user',false,NULL,NULL,NULL,false)`,
    [OWNER, user.azureactivedirectoryobjectid, user.internalemailaddress.toLowerCase(), user.systemuserid, OTHER]);
  const result = { proposal_summary: { title: 'Synthetic walkthrough history — no model run', program: 'Synthetic',
    core_question: 'Verify history rendering and user isolation only.' }, no_lead_recommendation: true,
    staff_assignment: {}, consultant_overlap: [], board_interest: [], expertise_gaps: [], conflicts: [] };
  for (const id of [OWNER, OTHER]) await fixture.primary.query(`INSERT INTO expertise_matches
    (user_profile_id,proposal_title,proposal_filename,match_results,model_used,input_tokens,output_tokens,estimated_cost_cents)
    VALUES ($1,$2,'synthetic-fixture.txt',$3::jsonb,'synthetic-fixture-no-model',0,0,0)`,
    [id, id === OWNER ? result.proposal_summary.title : 'UNRELATED fixture — must not appear', JSON.stringify(result)]);
}
function verifyCensus(before, after) {
  assert.equal(after.profiles.length, before.profiles.length, 'Sandbox profile count changed');
  for (const prior of before.profiles) {
    const current = after.profiles.find(p => p.profileGuid === prior.profileGuid);
    assert(current, 'Sandbox profile disappeared');
    if (prior.profileGuid !== CANARY) assert.equal(fingerprint(current), fingerprint(prior), 'Non-canary profile changed');
    else {
      const business = profile => {
        const values = { ...profile.values }; delete values['@odata.etag']; delete values.modifiedon;
        return values;
      };
      assert.equal(fingerprint(business(current)), fingerprint(business(prior)), 'Canary business values were not restored');
    }
  }
  return { totalProfiles: after.profiles.length, allNonCanaryProfilesUnchanged: true, canaryBusinessValuesRestored: true,
    canaryEtagChanged: before.profiles.find(p => p.profileGuid === CANARY).values['@odata.etag'] !== after.profiles.find(p => p.profileGuid === CANARY).values['@odata.etag'] };
}
function watchServer(child, signals = process) {
  let stopRequested = false;
  const stop = () => {
    stopRequested = true;
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  };
  signals.on('SIGINT', stop); signals.on('SIGTERM', stop);
  const done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      const stopped = stopRequested && ([130, 143].includes(code) || ['SIGINT', 'SIGTERM'].includes(signal));
      code === 0 || stopped ? resolve() : reject(Error('Venue server failed'));
    });
  });
  return { done, dispose() { signals.removeListener('SIGINT', stop); signals.removeListener('SIGTERM', stop); } };
}
async function feedbackRows(fixture) {
  return (await fixture.primary.query('SELECT to_jsonb(f) AS row FROM consultant_feedback f ORDER BY id')).rows.map(entry => entry.row);
}
function attachmentCleanupPending({ staging, feedback, baselineFeedback }) {
  // A consumed row still owns the exact Graph and Blob cleanup evidence.
  return staging.length > 0 || fingerprint(feedback) !== fingerprint(baselineFeedback);
}

async function main(args) {
  assert([3, 4].includes(args.length), 'Three paths and an optional authorized manifest required');
  const [fullFile, staffFile, evidenceDir, manifestFile] = args;
  const rehearsal = parse(privateInput(fullFile)), staff = parse(privateInput(staffFile));
  assert(path.isAbsolute(evidenceDir));
  const parent = fs.realpathSync(path.dirname(evidenceDir));
  assert(parent !== root && !parent.startsWith(root + path.sep), 'Evidence must be outside worktree');
  assert(!(fs.statSync(parent).mode & 0o077), 'Private evidence parent required');
  if (manifestFile) {
    const manifestParent = fs.realpathSync(path.dirname(manifestFile));
    assert(manifestParent !== root && !manifestParent.startsWith(root + path.sep), 'Live manifest must be outside the worktree');
  }
  const live = manifestFile ? validateLiveManifest(JSON.parse(privateInput(manifestFile))) : null;
  const { host } = assertTarget(rehearsal);
  assert(!rehearsal.VERCEL_ENV && rehearsal.NODE_ENV !== 'production');
  assert(!fs.readdirSync(root).some(name => /^\.env(?:\.|$)/.test(name) && name !== '.env.example'), 'Worktree environment fallback refused');
  await freePort('127.0.0.1'); await freePort('::1');
  fs.mkdirSync(evidenceDir, { mode: 0o700 });
  // App service authentication only; these credentials never authenticate an agent.
  for (const key of ['DYNAMICS_TENANT_ID','DYNAMICS_CLIENT_ID','DYNAMICS_CLIENT_SECRET','DATAVERSE_TARGET_INTERLOCK','DATAVERSE_DAL_ENFORCEMENT']) process.env[key] = rehearsal[key];
  delete process.env.VERCEL_ENV; process.env.NODE_ENV = 'development';
  const { createClient, getAccessToken } = require('../lib/dataverse/client.js');
  let client;
  async function refreshClient() { client = createClient({ resourceUrl: rehearsal.DYNAMICS_URL, token: await getAccessToken(rehearsal.DYNAMICS_URL) }); }
  await refreshClient();
  const readOnly = { raw(method, ...rest) { assert.equal(method, 'GET'); return client.raw(method, ...rest); } };
  async function get(resource) { const response = await readOnly.raw('GET', resource); assert(response.ok, 'Sandbox read failed'); return response.body; }
  const mapping = JSON.parse(privateInput(path.join(path.dirname(fullFile), 'full-mapping.json')));
  const owners = mapping.rows.filter(row => row.legacyId === 12 && row.confirmed === true);
  assert(mapping.targetHost === host && owners.length === 1 && GUID.test(owners[0].staffUserGuid));
  const user = await get(`/systemusers(${owners[0].staffUserGuid})?$select=systemuserid,azureactivedirectoryobjectid,internalemailaddress,isdisabled`);
  assert(user.isdisabled === false && GUID.test(user.azureactivedirectoryobjectid) && typeof user.internalemailaddress === 'string');
  const { eq } = require('../lib/dataverse/core/odata.js');
  const sameEmail = await get(`/systemusers?$filter=${encodeURIComponent(eq('internalemailaddress', user.internalemailaddress))}&$select=systemuserid,azureactivedirectoryobjectid,isdisabled`);
  assert(!sameEmail['@odata.nextLink'] && sameEmail.value.length === 1);
  assert(sameEmail.value[0].systemuserid === user.systemuserid && sameEmail.value[0].azureactivedirectoryobjectid === user.azureactivedirectoryobjectid && sameEmail.value[0].isdisabled === false);
  const grants = await get(`/wmkf_appuserappaccesses?$filter=${encodeURIComponent(`_wmkf_user_value eq ${user.systemuserid}`)}&$select=wmkf_appkey`);
  assert(!grants['@odata.nextLink'] && grants.value.some(g => g.wmkf_appkey === 'expertise-finder'));
  if (live?.authorization.attachments) {
    assert(grants.value.some(g => g.wmkf_appkey === 'reviewers'), 'Existing reviewers grant required');
  }
  const store = require('./lib/expertise-roster-import-store.cjs').createStore({ env: rehearsal, client: readOnly, pg: null });
  const before = await store.readTarget({ includeAuditTimestamps: true });
  const canary = before.profiles.find(p => p.profileGuid === CANARY);
  assert(canary && canary.values.statecode === 1 && !canary.values.wmkf_contactguid && !canary.values.wmkf_staffuser && /^app_/.test(canary.values.wmkf_creationkey), 'Expected inactive unlinked canary unavailable');
  const importReceipt = JSON.parse(privateInput(path.join(path.dirname(fullFile), 'full-import-receipt.json')));
  const importBaseline = JSON.parse(privateInput(path.join(path.dirname(fullFile), 'target-before.json')));
  assert(!importReceipt.rows.some(row => row.profileGuid === CANARY) && !importBaseline.profiles.some(row => row.profileGuid === CANARY), 'Canary belongs to original import evidence');
  writePrivate(evidenceDir, 'sandbox-before.json', before);
  let fixture, child, serverWatch, logFd, failure, baselineFeedback;
  try {
    fixture = await createRosterPgFixture(fullFile);
    assert.equal((await fixture.primary.query('SELECT 1 FROM public.expertise_roster_binding WHERE dataverse_profile_guid=$1', [CANARY])).rowCount, 0, 'Canary has a real import binding');
    await seed(fixture, user);
    if (live?.authorization.attachments) {
      for (const migration of ['031_portal_upload_staging.sql', '049_consultant_feedback_attachments.sql']) {
        await fixture.primary.query(fs.readFileSync(path.join(root, 'lib/db/migrations', migration), 'utf8'));
      }
      baselineFeedback = await feedbackRows(fixture);
    }
    const env = environment(rehearsal, staff, fixture.schema, live);
    writePrivate(evidenceDir, 'venue.json', { schema: fixture.schema, profileId: OWNER, canary: CANARY, publicBefore: fixture.before, origin: env.NEXTAUTH_URL });
    logFd = fs.openSync(path.join(evidenceDir, 'server.log'), 'wx', 0o600);
    child = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'start', '--hostname', 'localhost', '--port', '3000'], { cwd: root, env, stdio: ['ignore', logFd, logFd] });
    serverWatch = watchServer(child);
    console.log('Venue launched on http://localhost:3000; Ctrl-C stops it and verifies cleanup.');
    await serverWatch.done;
  } catch (error) { failure = error; }
  finally {
    if (child?.pid && child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await new Promise(resolve => child.once('exit', resolve)); }
    if (logFd !== undefined) fs.closeSync(logFd);
    let cleanup, census;
    try {
      await refreshClient();
      const after = await store.readTarget({ includeAuditTimestamps: true });
      writePrivate(evidenceDir, 'sandbox-after.json', after); census = verifyCensus(before, after);
      if (census.canaryEtagChanged) {
        const attribution = await get(`/wmkf_expertiseprofiles(${CANARY})?$select=_modifiedby_value,_modifiedonbehalfby_value,modifiedon`);
        writePrivate(evidenceDir, 'canary-attribution.json', attribution);
        assert.equal(attribution._modifiedby_value?.toLowerCase(), user.systemuserid.toLowerCase(), 'Canary editor attribution differs');
        census.canaryAttributedToSignedInOperator = true;
      }
    } catch (error) { failure ||= error; }
    let retainSchema = false;
    if (baselineFeedback) {
      retainSchema = true;
      try {
        const { rows: staging } = await fixture.primary.query('SELECT * FROM portal_upload_staging ORDER BY id');
        const feedback = await feedbackRows(fixture);
        writePrivate(evidenceDir, 'attachment-sql-cleanup.json', { staging, feedback, baselineFeedback });
        retainSchema = attachmentCleanupPending({ staging, feedback, baselineFeedback });
        assert(!retainSchema, 'Attachment activity retained for exact cleanup verification');
      } catch (error) { failure ||= error; }
    }
    try { if (fixture) cleanup = await fixture.cleanup({ retainSchema }); } catch (error) { failure ||= error; }
    serverWatch?.dispose();
    const result = { success: !failure, census, publicUnchanged: !!cleanup && cleanup.before === cleanup.after,
      fixtureRemoved: cleanup?.removed === true, ...(retainSchema ? { retainedSchema: fixture.schema } : {}) };
    writePrivate(evidenceDir, 'result.json', result);
    console.log(JSON.stringify(result));
  }
  if (failure) throw failure;
}
if (require.main === module) main(process.argv.slice(2)).catch(() => { console.error('Venue failed; inspect private evidence without exposing credentials.'); process.exitCode = 1; });
module.exports = { environment, seed, verifyCensus, watchServer, validateLiveManifest, attachmentCleanupPending };
