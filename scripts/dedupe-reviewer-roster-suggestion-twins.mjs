#!/usr/bin/env node
/**
 * Dry-run by default. Deletes migration-era duplicate `reviewer_find_roster` rows:
 * a `legacy-row:<id>`-keyed row that carries a `suggestionId` for which the canonical
 * `suggestion:<id>`-keyed row ALSO exists in the same request. Writes require --execute.
 *
 * Why these rows are duplicates: migration 025 minted `legacy-row:<id>` placeholder keys
 * for every pre-existing roster row, and `stampSuggestionAnchor` later stamped the
 * Dataverse suggestion anchor into those blobs WITHOUT re-keying the row. Applicant
 * enrichment then wrote the canonical `suggestion:<id>` row. The client keys cards off the
 * stored `candidateKey` (reviewer-candidate-key.js), so the same person renders twice —
 * once selectable from the stale placeholder row, once read-only from the canonical row
 * carrying the current identity verdict. The promotion route resolves a suggestion ONLY to
 * the canonical key, so saving the selectable copy always 422s (S387, request 1002852).
 *
 * The canonical row wins: it is the one every server path reads, and it holds the current
 * identity-gate verdict. Deleting the placeholder twin therefore removes a card that could
 * never be saved — it does not remove a promotable reviewer.
 *
 * Contact carry-over: the placeholder often holds an email the canonical row withholds
 * (the identity gate nulls contact for an unconfirmed person). Before each delete, that
 * email is copied onto the canonical row as a QUARANTINED `contactLeads` entry
 * (`type:'email'`, `source:'prior_enrichment'`, `confidence:'low'`, `persistable:false`),
 * so the read-only needs-identity-review card still shows the address the PD needs while
 * the anchor-or-abstain rule keeps it out of any send path. It is not promoted to
 * `email`/`emailPersistAllowed` — confirming identity remains the only way to adopt it.
 *
 * Safety:
 *   - only rows whose canonical twin is present in the SAME request are touched
 *   - every candidate blob is written to a timestamped JSON backup before any write
 *   - a placeholder row holding a staff identity attestation, or manual contact edits,
 *     that the canonical row does NOT have is SKIPPED for manual review (never deleted)
 *   - carry-over is idempotent: an email lead with the same value is never added twice,
 *     and the lead list is capped like `pruneContactLeads` (MAX_ROSTER_CONTACT_LEADS)
 *   - carry-over is ordered BEFORE the delete and each pair is independent, so an
 *     interrupted run can only leave a not-yet-deleted duplicate, never a lost email;
 *     re-running converges (no cross-connection transaction is assumed — the pooled
 *     `sql` helper does not guarantee one connection per statement)
 *   - the canonical row is re-read and re-asserted by id + suggestion anchor at write
 *     time, and each delete re-asserts the placeholder key shape
 *   - Postgres only; no Dataverse reads or writes
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { sql } from '@vercel/postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    const [, k, v] = m;
    if (!process.env[k]) process.env[k] = v.trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }
}
if (!process.env.POSTGRES_URL && process.env.DATABASE_URL) {
  process.env.POSTGRES_URL = process.env.DATABASE_URL;
}

const execute = process.argv.includes('--execute');
const requestArg = process.argv.find((arg) => arg.startsWith('--request='));
const onlyRequest = requestArg ? requestArg.split('=')[1].trim().toLowerCase() : null;

function hasStaffAttestation(candidate) {
  return candidate?.pdIdentityConfirmed === true
    || !!candidate?.pdIdentityConfirmationId
    || !!candidate?.staffIdentityConfirmation;
}

function manualFields(candidate) {
  return Array.isArray(candidate?.manualContactFields) ? candidate.manualContactFields : [];
}

// Mirrors reviewer-search-logic MAX_ROSTER_CONTACT_LEADS so a carried-over lead can never
// grow a roster blob past the size the prune path enforces.
const MAX_ROSTER_CONTACT_LEADS = 8;

function emailOf(candidate) {
  const value = candidate?.email || candidate?.contactEnrichment?.email || null;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Add the placeholder's email to the canonical blob as a quarantined lead.
 * Returns the new candidate object, or null when there is nothing to do.
 *
 * Idempotency guard: returns null when an email lead with the same value (case-
 * insensitive) is already present, so a repeated run is a no-op.
 */
function withCarriedEmailLead(canonical, email) {
  if (!email) return null;
  const enrichment = canonical?.contactEnrichment && typeof canonical.contactEnrichment === 'object'
    ? canonical.contactEnrichment
    : {};
  const leads = Array.isArray(enrichment.contactLeads) ? enrichment.contactLeads : [];
  const already = leads.some((lead) => lead?.type === 'email'
    && typeof lead.value === 'string'
    && lead.value.trim().toLowerCase() === email.toLowerCase());
  if (already) return null;
  if (leads.length >= MAX_ROSTER_CONTACT_LEADS) return null;
  const lead = {
    type: 'email',
    value: email,
    sourceUrl: null,
    source: 'prior_enrichment',
    confidence: 'low',
    rejectedReason: null,
    persistable: false,
  };
  return {
    ...canonical,
    contactEnrichment: { ...enrichment, contactLeads: [...leads, lead] },
  };
}

const { rows } = await sql`
  SELECT legacy.id           AS legacy_id,
         legacy.request_id   AS request_id,
         legacy.candidate_key AS legacy_key,
         legacy.status       AS legacy_status,
         legacy.display_name AS display_name,
         legacy.candidate    AS legacy_candidate,
         canonical.id        AS canonical_id,
         canonical.candidate_key AS canonical_key,
         canonical.status    AS canonical_status,
         canonical.candidate AS canonical_candidate
  FROM reviewer_find_roster legacy
  JOIN reviewer_find_roster canonical
    ON canonical.request_id = legacy.request_id
   AND canonical.candidate_key = 'suggestion:' || lower(legacy.candidate->>'suggestionId')
  WHERE legacy.candidate_key LIKE 'legacy-row:%'
    AND legacy.candidate->>'suggestionId' IS NOT NULL
  ORDER BY legacy.request_id, legacy.display_name
`;

const scoped = onlyRequest
  ? rows.filter((row) => String(row.request_id).toLowerCase() === onlyRequest)
  : rows;

const deletable = [];
const skipped = [];
for (const row of scoped) {
  const legacy = row.legacy_candidate || {};
  const canonical = row.canonical_candidate || {};
  if (hasStaffAttestation(legacy) && !hasStaffAttestation(canonical)) {
    skipped.push({ row, reason: 'placeholder row holds a staff identity attestation the canonical row lacks' });
    continue;
  }
  const lostManual = manualFields(legacy).filter((field) => !manualFields(canonical).includes(field));
  if (lostManual.length > 0) {
    skipped.push({ row, reason: `placeholder row holds manual contact edits the canonical row lacks: ${lostManual.join(', ')}` });
    continue;
  }
  deletable.push(row);
}

console.log(`Reviewer roster suggestion-twin dedupe (${execute ? 'EXECUTE' : 'DRY RUN'})`);
if (onlyRequest) console.log(`  scoped to request: ${onlyRequest}`);
console.log(`  duplicate pairs found:   ${scoped.length}`);
console.log(`  ${execute ? 'deleting' : 'would delete'}:${execute ? '        ' : '           '}${deletable.length}`);
console.log(`  skipped for review:      ${skipped.length}\n`);

for (const row of deletable) {
  const legacyEmail = row.legacy_candidate?.email || row.legacy_candidate?.contactEnrichment?.email || '—';
  const canonicalEmail = row.canonical_candidate?.email || row.canonical_candidate?.contactEnrichment?.email || '—';
  console.log(`  ${(row.display_name || '').padEnd(24)} ${row.legacy_key.padEnd(16)} [${row.legacy_status}] → keeping ${row.canonical_key} [${row.canonical_status}]`);
  console.log(`  ${' '.repeat(24)} placeholder email=${legacyEmail}  canonical email=${canonicalEmail}`);
}
for (const entry of skipped) {
  console.log(`  SKIP ${(entry.row.display_name || '').padEnd(22)} ${entry.row.legacy_key} — ${entry.reason}`);
}

if (!execute) {
  console.log('\nNo writes performed. Re-run with --execute to delete the placeholder twins.');
  process.exit(0);
}

if (deletable.length === 0) {
  console.log('\nNothing to delete.');
  process.exit(0);
}

// Backups carry reviewer names + emails, so they land in a gitignored directory
// alongside the other person-data script artifacts — never at the repo root.
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = path.join(__dirname, '.roster-dedupe-backup');
fs.mkdirSync(backupDir, { recursive: true });
const backupPath = path.join(backupDir, `roster-twin-backup-${stamp}.json`);
fs.writeFileSync(backupPath, JSON.stringify(deletable, null, 2));
console.log(`\nBackup of ${deletable.length} row(s) written to ${backupPath}`);

let deleted = 0;
let carried = 0;
let failed = 0;
for (const row of deletable) {
  const placeholderEmail = emailOf(row.legacy_candidate);
  try {
    // 1) Carry the email over FIRST. Re-read the canonical row so a concurrent write
    //    (e.g. a fresh enrichment) is merged into, not clobbered by, this update.
    if (placeholderEmail) {
      const live = await sql`
        SELECT candidate FROM reviewer_find_roster WHERE id = ${row.canonical_id} LIMIT 1
      `;
      const liveCandidate = live.rows[0]?.candidate || null;
      if (!liveCandidate) {
        console.log(`  SKIP ${row.display_name} — canonical row ${row.canonical_id} no longer exists`);
        failed += 1;
        continue;
      }
      if (emailOf(liveCandidate)) {
        // The canonical row now has its own email (identity was confirmed, or a newer
        // enrichment resolved it). Nothing to carry — its own contact wins.
        console.log(`  ${(row.display_name || '').padEnd(24)} canonical row already has an email — no carry-over`);
      } else {
        const next = withCarriedEmailLead(liveCandidate, placeholderEmail);
        if (next) {
          const upd = await sql`
            UPDATE reviewer_find_roster
              SET candidate = ${JSON.stringify(next)}::jsonb, updated_at = now()
              WHERE id = ${row.canonical_id}
                AND lower(candidate->>'suggestionId') = lower(${String(row.legacy_candidate?.suggestionId || '')})
            RETURNING id
          `;
          const n = upd.rowCount || upd.rows?.length || 0;
          if (n === 0) {
            console.log(`  SKIP ${row.display_name} — canonical row failed its anchor re-assertion`);
            failed += 1;
            continue;
          }
          carried += 1;
          console.log(`  ${(row.display_name || '').padEnd(24)} carried ${placeholderEmail} → canonical contactLeads`);
        }
      }
    }

    // 2) Delete the placeholder. Re-assert its key shape so a row re-keyed by a
    //    concurrent writer between the scan and here is left alone.
    const res = await sql`
      DELETE FROM reviewer_find_roster
      WHERE id = ${row.legacy_id}
        AND candidate_key = ${row.legacy_key}
        AND candidate_key LIKE 'legacy-row:%'
      RETURNING id
    `;
    const n = res.rowCount || res.rows?.length || 0;
    deleted += n;
    if (n === 0) console.log(`  NO-OP ${row.display_name} ${row.legacy_key} — row changed since the scan`);
  } catch (err) {
    failed += 1;
    console.error(`  ERROR ${row.display_name} ${row.legacy_key}: ${err?.message || err}`);
  }
}

console.log(`\nCarried over ${carried} email(s); deleted ${deleted} placeholder twin row(s); ${failed} pair(s) left for review.`);
if (failed > 0) console.log('Re-run the dry run to see what remains — carry-over is idempotent, so a re-run is safe.');
console.log(`Backup retained at ${backupPath}`);
console.log('Restore a row with: INSERT INTO reviewer_find_roster (request_id, candidate_key, status, display_name, normalized_name, candidate, source_kind) — see the backup JSON.');
