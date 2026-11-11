/** Sandbox + dedicated local-Postgres import transport. No Production path.
 * Operational import is service-principal attributed; staff editor attribution
 * is a separate contract. No metadata changes, existing-profile updates or deletions.
 * Inactive creates use one atomic create/deactivate changeset.
 */
const {assertTarget} = require('../../lib/services/expertise-finder/roster-rehearsal-target.cjs');
const contract = require('../../lib/services/expertise-finder/roster-contract.cjs');
const HOST = 'orgd9e66399.crm.dynamics.com';
const ENTITY = '/wmkf_expertiseprofiles';
const META = "/EntityDefinitions(LogicalName='wmkf_expertiseprofile')";
const SELECT = ['wmkf_expertiseprofileid','wmkf_name','wmkf_category','wmkf_leadpdeligible','_wmkf_staffuser_value','wmkf_contactguid','wmkf_creationkey','statecode',...contract.TEXT.map(contract.column)].join(',');
function check(ok, message) { if (!ok) throw Error(message); }
function checked(response) {
  check(response.ok, `Dataverse import operation failed (HTTP ${response.status})`);
  return response.body;
}
function normalized(raw) {
  const values = {...raw, wmkf_staffuser:raw._wmkf_staffuser_value};
  delete values._wmkf_staffuser_value; delete values.wmkf_expertiseprofileid;
  return {profileGuid:raw.wmkf_expertiseprofileid, values};
}
function payload(values) {
  const {wmkf_staffuser,...body} = values;
  // Omit an empty lookup on CREATE; no disassociation is necessary.
  if (wmkf_staffuser) body['wmkf_StaffUser@odata.bind'] = `/systemusers(${wmkf_staffuser})`;
  body.statuscode = values.statecode === 0 ? 1 : 2;
  return body;
}
function createStore({env, client, pg}) {
  const target = assertTarget(env);
  check(target.host === HOST && env.NODE_ENV !== 'production' && !env.VERCEL_ENV, 'Import CLI is local rehearsal only');
  const get = path => client.raw('GET', path, undefined, {}, {timeoutMs:30000});
  const post = (path, body) => client.raw('POST', path, body, {}, {timeoutMs:30000});
  const keyPath = key => {
    check(/^(legacy_[0-9a-f-]{36}_[1-9][0-9]*|app_[0-9a-f-]{36})$/.test(key), 'Invalid creation key');
    return `${ENTITY}(wmkf_creationkey='${key}')`;
  };
  return {
    targetHost:target.host,
    async readTarget({includeAuditTimestamps=false} = {}) {
      const profiles = [], seen = new Set();
      let next = ENTITY + '?$select=' + SELECT + (includeAuditTimestamps ? ',createdon,modifiedon' : '');
      while (next) {
        check(!seen.has(next) && seen.size < 100, 'Incomplete or looping roster census'); seen.add(next);
        const url = new URL(next, `https://${HOST}/api/data/v9.2/`);
        if (seen.size > 1 || next.startsWith('http')) check(next.startsWith('https://') && url.origin === `https://${HOST}` && url.pathname === '/api/data/v9.2/wmkf_expertiseprofiles', 'Foreign census continuation refused');
        const body = checked(await get(next));
        check(Array.isArray(body.value), 'Missing roster census rows');
        profiles.push(...body.value.map(normalized)); next = body['@odata.nextLink'];
      }
      return {version:1, complete:true, targetHost:HOST, profiles};
    },
    async preflight(plan) {
      const meta = checked(await get(META + '?$select=EntitySetName,IsAuditEnabled,IsOptimisticConcurrencyEnabled'));
      check(meta.EntitySetName === 'wmkf_expertiseprofiles' && meta.IsAuditEnabled?.Value === true && meta.IsOptimisticConcurrencyEnabled === true, 'Roster metadata/audit/concurrency not ready');
      const keys = checked(await get(META + '/Keys?$select=KeyAttributes,EntityKeyIndexStatus'));
      check(!keys['@odata.nextLink'] && Array.isArray(keys.value), 'Incomplete key metadata');
      for (const field of ['wmkf_creationkey','wmkf_staffuser','wmkf_contactguid']) check(keys.value.some(k=>k.EntityKeyIndexStatus==='Active' && k.KeyAttributes.length===1 && k.KeyAttributes[0]===field), 'Required alternate key is not Active');
      for (const row of plan.rows.filter(r=>r.action!=='exclude')) {
        const v = row.values;
        if (v.wmkf_staffuser) {
          const user = checked(await get(`/systemusers(${v.wmkf_staffuser})?$select=isdisabled`));
          check(user.isdisabled === false, 'Mapped User is not enabled');
        }
        if (v.wmkf_contactguid) {
          const contact = checked(await get(`/contacts(${v.wmkf_contactguid})?$select=statecode`));
          check(contact.statecode === 0, 'Mapped Contact is not active');
        }
      }
    },
    async findByKey(key) {
      const r = await get(keyPath(key) + '?$select=' + SELECT);
      if (r.status === 404) return null;
      return normalized(checked(r));
    },
    async create(values) {
      check(values.statecode === 0 || values.statecode === 1, 'Invalid profile state');
      const body = payload(values);
      if (values.statecode === 1) {
        await client.createInactiveExpertiseProfile(body, {timeoutMs:30000});
      } else checked(await post(ENTITY, body));
    },
    async bridgeTransaction(floor, work) {
      let phase = 'begin', began = false;
      try {
        await pg.query('BEGIN'); began = true;
        phase = 'identity';
        const identity = (await pg.query('SELECT current_database() AS database, current_user AS username')).rows[0];
        check(identity.database === 'roster_rehearsal' && identity.username === 'roster_rehearsal', 'Connected database identity mismatch');
        phase = 'lock';
        await pg.query("SET LOCAL lock_timeout = '5s'");
        await pg.query('LOCK TABLE expertise_roster, expertise_roster_identity, expertise_roster_binding IN ACCESS EXCLUSIVE MODE');
        phase = 'prepare';
        const lifecycle = (await pg.query("SELECT to_regclass('expertise_roster_cutover')::text AS name")).rows[0];
        check(lifecycle && Object.hasOwn(lifecycle, 'name') && lifecycle.name === null, 'Import is refused after roster lifecycle preparation');
        const seq = (await pg.query("SELECT pg_get_serial_sequence('expertise_roster','id') AS name")).rows[0].name;
        check(seq === 'public.expertise_roster_id_seq', 'Unexpected legacy sequence');
        const oldHigh = Number((await pg.query('SELECT last_value FROM expertise_roster_id_seq')).rows[0].last_value);
        let high = Math.max(floor, oldHigh, Number((await pg.query('SELECT COALESCE(MAX(id),0) AS n FROM expertise_roster')).rows[0].n), Number((await pg.query('SELECT COALESCE(MAX(id),0) AS n FROM expertise_roster_identity')).rows[0].n));
        const lookup = async (id, host) => (await pg.query('SELECT dataverse_profile_guid AS guid FROM expertise_roster_binding WHERE roster_id=$1 AND target_host=$2',[id,host])).rows[0]?.guid || null;
        phase = 'rows';
        await work({
          async ensureIdentity(id) { await pg.query('INSERT INTO expertise_roster_identity(id) VALUES($1) ON CONFLICT DO NOTHING',[id]); high = Math.max(high,id); },
          lookup,
          async bind(id, host, guid) {
            check(host === HOST && contract.guid(guid), 'Invalid target binding');
            const inverse = (await pg.query('SELECT roster_id FROM expertise_roster_binding WHERE target_host=$1 AND dataverse_profile_guid=$2',[host,guid])).rows[0];
            if (inverse) { check(id === null || inverse.roster_id === id, 'Profile already bound to another numeric identity'); return inverse.roster_id; }
            if (id === null) {
              high = Math.max(high, Number((await pg.query('SELECT COALESCE(MAX(id),0) AS n FROM expertise_roster_identity')).rows[0].n)) + 1;
              check(high <= 2147483647, 'Numeric identity space exhausted'); id = high;
              await pg.query('INSERT INTO expertise_roster_identity(id) VALUES($1)',[id]);
            }
            const existing = await lookup(id,host);
            check(!existing || existing === guid, 'Numeric identity already bound to another profile');
            if (!existing) await pg.query('INSERT INTO expertise_roster_binding(roster_id,target_host,dataverse_profile_guid) VALUES($1,$2,$3)',[id,host,guid]);
            return id;
          },
        });
        // Local fixture only: preserve a high-water above new IDs if old fixture
        // writers resume after our lock ends. Sequence gaps on rollback are safe.
        phase = 'sequence';
        await pg.query("SELECT setval('expertise_roster_id_seq', $1, true)",[Math.max(1,high)]);
        phase = 'commit';
        await pg.query('COMMIT');
      } catch (error) {
        error.transactionPhase = phase;
        // A successful ROLLBACK after a lost COMMIT response cannot tell us
        // whether the preceding transaction committed. Preserve that uncertainty.
        error.bridgeCommitted = phase === 'commit' ? null : false;
        error.rollbackSucceeded = null;
        if (began) {
          try { await pg.query('ROLLBACK'); error.rollbackSucceeded = true; }
          catch (rollbackError) { error.rollbackSucceeded = false; error.rollbackError = rollbackError.message; }
        }
        throw error;
      }
    },
  };
}
module.exports = {createStore, payload, normalized};
