#!/usr/bin/env node
/**
 * Propose or apply Dataverse Contact links for active Board/Consultant roster rows.
 *
 * Dry run (default):
 *   node --import ./scripts/lib/use-extensionless.mjs scripts/link-roster-contacts.js
 *
 * Apply exact, active, email-bearing ORCID matches plus explicitly confirmed
 * name matches:
 *   node --import ./scripts/lib/use-extensionless.mjs scripts/link-roster-contacts.js \
 *     --apply --actor-profile-id 7 --confirm 12=11111111-1111-4111-8111-111111111111
 */

const fs = require('node:fs');
const path = require('node:path');

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function loadLocalEnv() {
  for (const filename of ['.env', '.env.local']) {
    try {
      const text = fs.readFileSync(path.join(process.cwd(), filename), 'utf8');
      for (const line of text.split('\n')) {
        const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (!match || process.env[match[1]]) continue;
        process.env[match[1]] = match[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
      }
    } catch (_) { /* Optional local env file. */ }
  }
}

function parseArgs(argv) {
  const confirmations = new Map();
  let apply = false;
  let actorProfileId = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') {
      apply = true;
      continue;
    }
    if (arg === '--actor-profile-id' || arg.startsWith('--actor-profile-id=')) {
      const value = arg === '--actor-profile-id' ? argv[++index] : arg.slice('--actor-profile-id='.length);
      actorProfileId = Number(value);
      if (!Number.isSafeInteger(actorProfileId) || actorProfileId <= 0) {
        throw new Error('--actor-profile-id must be a positive integer');
      }
      continue;
    }
    let value = null;
    if (arg === '--confirm') value = argv[++index];
    else if (arg.startsWith('--confirm=')) value = arg.slice('--confirm='.length);
    else throw new Error(`Unknown argument: ${arg}`);
    const match = String(value || '').match(/^(\d+)=([0-9a-f-]+)$/i);
    if (!match || !GUID_RE.test(match[2])) {
      throw new Error('--confirm must use rosterId=contactId with a valid Contact GUID');
    }
    const rosterId = Number(match[1]);
    if (!Number.isSafeInteger(rosterId) || rosterId <= 0 || confirmations.has(rosterId)) {
      throw new Error(`Duplicate or invalid roster ID in --confirm: ${match[1]}`);
    }
    confirmations.set(rosterId, match[2].toLowerCase());
  }
  if (apply && !actorProfileId) throw new Error('--apply requires --actor-profile-id for audit attribution');
  return { apply, actorProfileId, confirmations };
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function rowContactId(row) {
  return String(row?.contactid || '').trim().toLowerCase();
}

function candidateSummary(row) {
  return {
    contactId: rowContactId(row),
    name: String(row?.fullname || [row?.firstname, row?.lastname].filter(Boolean).join(' ') || '').trim() || null,
    email: normalizeEmail(row?.emailaddress1),
    active: row?.statecode === undefined || row?.statecode === 0,
  };
}

async function proposeRosterLink(row, dependencies) {
  const normalizedOrcid = dependencies.normalizeOrcid(row.orcid);
  if (normalizedOrcid.state === 'valid') {
    const result = await dependencies.findByOrcidCandidates(normalizedOrcid.id);
    if (!result?.one || !result?.row) {
      return {
        source: 'orcid',
        status: result?.inactiveOnly ? 'inactive_only' : result?.ambiguous ? 'ambiguous' : 'none',
        candidates: (result?.rows || []).map(candidateSummary),
      };
    }
    const contactId = rowContactId(result.row);
    const email = normalizeEmail(result.row.emailaddress1);
    const active = result.row.statecode === undefined || result.row.statecode === 0;
    if (!GUID_RE.test(contactId) || !active || !email) {
      return { source: 'orcid', status: !active ? 'inactive_only' : 'email_missing' };
    }
    return { source: 'orcid', status: 'candidate', contactId, email, automatic: true };
  }

  const candidates = await dependencies.searchByName(row.name, { top: 2 });
  const usable = (candidates || []).filter((candidate) => (
    GUID_RE.test(rowContactId(candidate))
    && (candidate.statecode === undefined || candidate.statecode === 0)
    && normalizeEmail(candidate.emailaddress1)
  ));
  if (usable.length !== 1 || (candidates || []).length !== 1) {
    return {
      source: 'name',
      status: (candidates || []).length > 1 ? 'ambiguous' : (candidates || []).length === 1 ? 'unusable' : 'none',
      candidates: (candidates || []).map(candidateSummary),
    };
  }
  return {
    source: 'name',
    status: 'candidate',
    contactId: rowContactId(usable[0]),
    email: normalizeEmail(usable[0].emailaddress1),
    automatic: false,
  };
}

async function runBackfill(rows, options, dependencies) {
  const results = [];
  const usedConfirmations = new Set();
  for (const row of rows) {
    try {
      const proposal = await proposeRosterLink(row, dependencies);
      const base = {
        rosterId: Number(row.id),
        name: row.name,
        preferredEmail: normalizeEmail(row.preferred_email),
        ...proposal,
      };
      if (proposal.status !== 'candidate') {
        results.push({ ...base, outcome: 'skipped' });
        continue;
      }

      const confirmation = options.confirmations.get(Number(row.id));
      if (confirmation && confirmation !== proposal.contactId) {
        usedConfirmations.add(Number(row.id));
        results.push({ ...base, outcome: 'skipped', status: 'confirmation_mismatch' });
        continue;
      }
      const authorized = proposal.automatic || confirmation === proposal.contactId;
      if (confirmation) usedConfirmations.add(Number(row.id));
      if (!options.apply) {
        results.push({ ...base, outcome: proposal.automatic ? 'would_apply' : 'confirmation_required' });
        continue;
      }
      if (!authorized) {
        results.push({ ...base, outcome: 'confirmation_required' });
        continue;
      }

      try {
        const updated = await dependencies.writeLink(Number(row.id), proposal.contactId, options.actorProfileId);
        results.push({ ...base, outcome: updated ? 'applied' : 'row_changed' });
      } catch (error) {
        if (error?.code !== '23505') throw error;
        const conflict = await dependencies.findActiveConflict(proposal.contactId);
        results.push({
          ...base,
          outcome: 'conflict',
          conflictingRosterId: conflict?.id ? Number(conflict.id) : null,
          conflictingName: conflict?.name || null,
        });
      }
    } catch (error) {
      results.push({ rosterId: Number(row.id), name: row.name, outcome: 'error', error: error.message });
    }
  }

  for (const rosterId of options.confirmations.keys()) {
    if (!usedConfirmations.has(rosterId)) {
      results.push({ rosterId, name: null, outcome: 'unused_confirmation' });
    }
  }
  return results;
}

async function main() {
  loadLocalEnv();
  const options = parseArgs(process.argv.slice(2));
  const [{ sql }, contactAdapter, { normalizeOrcid }, { enterDynamicsBypassForScript }] = await Promise.all([
    import('@vercel/postgres'),
    import('../lib/dataverse/adapters/contact.js'),
    import('../lib/utils/orcid-normalize.js'),
    import('../lib/services/dynamics-context.js'),
  ]);
  enterDynamicsBypassForScript('link-roster-contacts');

  const roster = await sql`
    SELECT id, name, preferred_email, orcid
    FROM expertise_roster
    WHERE is_active = true
      AND role_type IN ('Board', 'Consultant')
      AND dataverse_contact_id IS NULL
    ORDER BY role_type, name, id
  `;
  const dependencies = {
    normalizeOrcid,
    findByOrcidCandidates: contactAdapter.findByOrcidCandidates,
    searchByName: contactAdapter.searchByName,
    async writeLink(rosterId, contactId, actorProfileId) {
      const result = await sql`
        UPDATE expertise_roster
        SET dataverse_contact_id = ${contactId}, updated_by = ${actorProfileId}, updated_at = CURRENT_TIMESTAMP
        WHERE id = ${rosterId} AND is_active = true AND dataverse_contact_id IS NULL
        RETURNING id
      `;
      return result.rows.length === 1;
    },
    async findActiveConflict(contactId) {
      const result = await sql`
        SELECT id, name FROM expertise_roster
        WHERE dataverse_contact_id = ${contactId} AND is_active = true
        ORDER BY id LIMIT 1
      `;
      return result.rows[0] || null;
    },
  };
  const results = await runBackfill(roster.rows, options, dependencies);
  console.table(results);
  const counts = results.reduce((acc, row) => {
    acc[row.outcome] = (acc[row.outcome] || 0) + 1;
    return acc;
  }, {});
  console.log(JSON.stringify({ mode: options.apply ? 'apply' : 'dry-run', counts }, null, 2));
  if (results.some((row) => ['error', 'confirmation_mismatch', 'unused_confirmation'].includes(row.outcome))) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { normalizeEmail, parseArgs, proposeRosterLink, runBackfill };
