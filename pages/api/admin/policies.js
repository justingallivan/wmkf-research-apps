/**
 * API Route: /api/admin/policies
 *
 * Admin endpoint for publishing new versions of wmkf_policy slots.
 *
 * GET  — Returns the visible slots (server allowlist) with their active
 *        version + full version history + per-version isActive/isResidue
 *        derived flags. parentEtag returned so the client can pass it back
 *        as If-Match on publish.
 * POST  — Publish a new version. Body:
 *        { slotCode, versionLabel, title, body, effectiveDate?, parentEtag, requestId? }
 *
 * Publish flow (locked plan §A):
 *   1. Validate inputs (allowlist, lengths, date format, markdown).
 *   2. Write a 'pending' audit row to policy_publish_audit. Hard-abort on
 *      audit-write failure — audit availability is a precondition.
 *   3. Resolve the parent slot by code; fail loud on 0/>1 rows.
 *   4. Idempotency lookup by (parentId, versionLabel); dispatch into one of
 *      five branches: already_published, label_conflict, resume-from-flip,
 *      branch-A create+flip+retire, or a fresh-publish.
 *   5. Branch A: create child → PATCH parent with If-Match → PATCH prior
 *      version statecode (best-effort).
 *   6. Branch C (resume): re-read parent for fresh ETag, then run step 5
 *      from the parent flip onward.
 *   7. Write a 'final' audit row with the structured outcome. On failure
 *      of this write, raise a system_alerts entry and surface
 *      audit_finalize_failed in the response.
 *
 * Codex review notes that informed this implementation are listed at the
 * head of docs/atlas/dataverse-wmkf-policy-and-policy-version.md.
 */

import { randomUUID } from 'crypto';
import { sql } from '@vercel/postgres';
import { requireSuperuser } from '../../../lib/utils/auth';
import { DynamicsService } from '../../../lib/services/dynamics-service';
import { bypassDynamicsRestrictions } from '../../../lib/services/dynamics-context';
import { validatePolicyMarkdown } from '../../../shared/utils/policy-markdown';

// Server-side allowlist. Other slots remain invisible until staff are ready;
// expanding the allowlist is a deliberate code change, not a UI config.
const VISIBLE_SLOT_CODES = ['reviewer-coi', 'reviewer-ai-use'];

// Hardcoded after running scripts/probe-policyversion-statecodes.mjs.
// Verified 2026-05-10 against prod metadata. Re-run the probe if Dataverse
// shows the values have shifted (e.g., custom state additions).
const POLICY_VERSION_STATUS = Object.freeze({
  ACTIVE:  { statecode: 0, statuscode: 1 },
  RETIRED: { statecode: 1, statuscode: 2 },
});

const POLICY_ENTITY = 'wmkf_policies';
const POLICY_VERSION_ENTITY = 'wmkf_policyversions';

// Input limits — generous but bounded.
const MAX_LABEL_LEN = 50;
const MAX_TITLE_LEN = 300;
const MIN_BODY_LEN = 50;
const MAX_BODY_LEN = 64 * 1024;

// ─────────────────────────────────────────────────────────────────────────
// Public handler
// ─────────────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const gate = await requireSuperuser(req, res);
  if (!gate) return;

  try {
    return await bypassDynamicsRestrictions('admin-policies', async () => {
      if (req.method === 'GET') {
        return await handleGet(req, res);
      }
      return await handlePost(req, res, gate.profileId);
    });
  } catch (err) {
    console.error('[admin/policies] unexpected error:', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}

// ─────────────────────────────────────────────────────────────────────────
// GET — list visible slots with versions
// ─────────────────────────────────────────────────────────────────────────

async function handleGet(req, res) {
  const slots = [];
  for (const code of VISIBLE_SLOT_CODES) {
    const slot = await loadSlotState(code);
    slots.push(slot);
  }
  return res.json({ slots });
}

async function loadSlotState(slotCode) {
  const parents = await DynamicsService.queryRecords(POLICY_ENTITY, {
    select: 'wmkf_policyid,wmkf_code,wmkf_displayname,_wmkf_activeversion_value',
    filter: `wmkf_code eq '${escapeOData(slotCode)}'`,
    top: 2,
  });
  const parentRecords = parents.records || [];

  if (parentRecords.length === 0) {
    return {
      code: slotCode, parentId: null, displayName: null, parentEtag: null,
      activeVersion: null, versions: [], invariantError: 'slot_not_provisioned',
    };
  }
  if (parentRecords.length > 1) {
    return {
      code: slotCode, parentId: null, displayName: null, parentEtag: null,
      activeVersion: null, versions: [],
      invariantError: 'duplicate_slot_rows',
      duplicateIds: parentRecords.map(r => r.wmkf_policyid),
    };
  }

  const parent = parentRecords[0];
  // Fetch parent again as a single record so we get an ETag annotation.
  const parentRow = await DynamicsService.getRecord(POLICY_ENTITY, parent.wmkf_policyid, {
    select: 'wmkf_policyid,wmkf_code,wmkf_displayname,_wmkf_activeversion_value',
  });

  const activeVersionId = parent._wmkf_activeversion_value || null;

  const versionsQuery = await DynamicsService.queryRecords(POLICY_VERSION_ENTITY, {
    select: 'wmkf_policyversionid,wmkf_versionlabel,wmkf_policytitle,wmkf_policybody,wmkf_effectivedate,statecode,statuscode',
    filter: `_wmkf_policy_value eq ${parent.wmkf_policyid}`,
    orderby: 'createdon desc',
    top: 50,
  });
  const versions = (versionsQuery.records || []).map(v => {
    const isActive = v.wmkf_policyversionid === activeVersionId;
    const isRetired = v.statecode === POLICY_VERSION_STATUS.RETIRED.statecode;
    return {
      id: v.wmkf_policyversionid,
      versionLabel: v.wmkf_versionlabel,
      title: v.wmkf_policytitle,
      bodyExcerpt: excerpt(v.wmkf_policybody, 300),
      body: v.wmkf_policybody,
      effectiveDate: normalizeDateOnly(v.wmkf_effectivedate),
      statecode: v.statecode,
      statuscode: v.statuscode,
      isActive,
      isResidue: !isActive && !isRetired,
    };
  });

  const activeVersion = versions.find(v => v.isActive) || null;

  return {
    code: slotCode,
    parentId: parent.wmkf_policyid,
    displayName: parent.wmkf_displayname,
    parentEtag: parentRow._etag || null,
    activeVersion: activeVersion ? {
      id: activeVersion.id,
      versionLabel: activeVersion.versionLabel,
      title: activeVersion.title,
      body: activeVersion.body,
      effectiveDate: activeVersion.effectiveDate,
    } : null,
    versions,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// POST — publish a new version
// ─────────────────────────────────────────────────────────────────────────

async function handlePost(req, res, profileId) {
  const { slotCode, versionLabel, title, body, effectiveDate, parentEtag } = req.body || {};
  const requestId = (req.body && req.body.requestId) || randomUUID();

  // Step 1: input validation. Allowlist FIRST so unsanitized slotCode never
  // reaches an OData filter.
  const validation = validateInputs({ slotCode, versionLabel, title, body, effectiveDate, parentEtag });
  if (!validation.ok) {
    return res.status(400).json({
      status: validation.status,
      error: validation.error,
      details: validation.details || null,
    });
  }
  const normalized = validation.normalized;

  // Step 2: pending audit row. Hard-abort if this write fails.
  let pendingAuditId = null;
  try {
    pendingAuditId = await writePendingAudit({
      requestId, slotCode: normalized.slotCode, versionLabel: normalized.versionLabel,
      title: normalized.title, profileId,
    });
  } catch (err) {
    console.error('[admin/policies] pending audit write failed:', err);
    return res.status(500).json({
      status: 'audit_unavailable',
      error: 'Audit table unavailable; refused to perform privileged mutation.',
    });
  }

  // From here on, every exit path writes a final audit row.
  let finalOutcome = null;
  try {
    finalOutcome = await runPublish({
      slotCode: normalized.slotCode,
      versionLabel: normalized.versionLabel,
      title: normalized.title,
      body: normalized.body,
      effectiveDate: normalized.effectiveDate,
      parentEtag: normalized.parentEtag,
      profileId,
    });
  } catch (err) {
    console.error('[admin/policies] publish failed:', err);
    finalOutcome = {
      status: 'failed',
      child: { id: null, created: false, reused: false },
      parent: { flipped: false },
      priorRetired: false,
      orphan: null,
      freshState: null,
      warnings: [`internal_error:${err.message}`],
    };
  }

  // Step 3: final audit row (and system_alerts on its failure).
  const auditWritten = await writeFinalAudit({
    requestId, profileId,
    slotCode: normalized.slotCode, versionLabel: normalized.versionLabel,
    title: normalized.title,
    versionId: finalOutcome.child?.id || null,
    priorVersionId: finalOutcome.priorRetiredId || null,
    parentId: finalOutcome.parentId || null,
    status: finalOutcome.status,
    outcomeJson: finalOutcome,
    warningsJson: finalOutcome.warnings || [],
    pendingAuditId,
  });

  const responseBody = {
    status: finalOutcome.status,
    child: finalOutcome.child,
    parent: finalOutcome.parent,
    priorRetired: finalOutcome.priorRetired,
    auditWritten,
    warnings: [...(finalOutcome.warnings || [])],
    orphan: finalOutcome.orphan || null,
    freshState: finalOutcome.freshState || null,
  };
  if (!auditWritten) {
    responseBody.warnings.push('audit_finalize_failed');
    if (responseBody.status === 'completed') responseBody.status = 'partial';
  }

  // HTTP status mapping per plan §5
  const httpStatus =
    finalOutcome.status === 'concurrency_conflict' ? 409 :
    finalOutcome.status === 'label_conflict' ? 409 :
    finalOutcome.status === 'slot_not_provisioned' ? 500 :
    finalOutcome.status === 'duplicate_slot_rows' ? 500 :
    finalOutcome.status === 'failed' ? 500 :
    200;
  return res.status(httpStatus).json(responseBody);
}

// ─────────────────────────────────────────────────────────────────────────
// Publish flow internals
// ─────────────────────────────────────────────────────────────────────────

async function runPublish({ slotCode, versionLabel, title, body, effectiveDate, parentEtag, profileId }) {
  // Resolve slot. Allowlist already gated slotCode, so the OData filter is safe.
  const slotState = await loadSlotState(slotCode);
  if (slotState.invariantError === 'slot_not_provisioned') {
    return failure('slot_not_provisioned', `Slot '${slotCode}' is not provisioned in Dataverse.`);
  }
  if (slotState.invariantError === 'duplicate_slot_rows') {
    return failure('duplicate_slot_rows', `Multiple parent rows for slot '${slotCode}'.`, { duplicateIds: slotState.duplicateIds });
  }

  const parentId = slotState.parentId;
  const priorActiveId = slotState.activeVersion?.id || null;

  // Idempotency lookup by (parentId, versionLabel)
  const existing = await DynamicsService.queryRecords(POLICY_VERSION_ENTITY, {
    select: 'wmkf_policyversionid,wmkf_versionlabel,wmkf_policytitle,wmkf_policybody,wmkf_effectivedate,statecode,statuscode',
    filter: `_wmkf_policy_value eq ${parentId} and wmkf_versionlabel eq '${escapeOData(versionLabel)}'`,
    top: 2,
  });
  const existingRecords = existing.records || [];
  const existingRow = existingRecords[0] || null;

  if (existingRow) {
    const sameFields =
      existingRow.wmkf_policytitle === title &&
      existingRow.wmkf_policybody === body &&
      normalizeDateOnly(existingRow.wmkf_effectivedate) === effectiveDate;

    const alreadyActive = priorActiveId === existingRow.wmkf_policyversionid;

    if (sameFields && alreadyActive) {
      // Branch B — already published
      return {
        status: 'already_published',
        child: { id: existingRow.wmkf_policyversionid, created: false, reused: true },
        parent: { flipped: false },
        priorRetired: false,
        priorRetiredId: null,
        parentId,
        orphan: null,
        warnings: [],
      };
    }

    if (sameFields && !alreadyActive) {
      // Branch C — resume from step 2 (flip), using a fresh parent ETag
      return await flipAndRetire({
        parentId, childId: existingRow.wmkf_policyversionid,
        priorActiveId, mode: 'resume',
      });
    }

    // Branch D — label conflict. Surface per-field flags so the UI / operator
    // can tell which of (title | body | effectiveDate) drifted.
    const titleMatches = existingRow.wmkf_policytitle === title;
    const bodyMatches = existingRow.wmkf_policybody === body;
    const dateMatches = normalizeDateOnly(existingRow.wmkf_effectivedate) === effectiveDate;
    return {
      status: 'label_conflict',
      child: { id: existingRow.wmkf_policyversionid, created: false, reused: false },
      parent: { flipped: false },
      priorRetired: false,
      priorRetiredId: null,
      parentId,
      orphan: null,
      warnings: [],
      details: {
        fieldsMatch: { title: titleMatches, body: bodyMatches, effectiveDate: dateMatches },
        existing: {
          versionLabel: existingRow.wmkf_versionlabel,
          title: existingRow.wmkf_policytitle,
          bodyLength: (existingRow.wmkf_policybody || '').length,
          bodyExcerpt: excerpt(existingRow.wmkf_policybody, 200),
          effectiveDate: normalizeDateOnly(existingRow.wmkf_effectivedate),
        },
        submitted: {
          versionLabel,
          title,
          bodyLength: body.length,
          bodyExcerpt: excerpt(body, 200),
          effectiveDate,
        },
      },
    };
  }

  // Branch A — create child, then flip + retire
  let childId = null;
  try {
    const created = await DynamicsService.createRecord(POLICY_VERSION_ENTITY, {
      wmkf_versionlabel: versionLabel,
      wmkf_policytitle: title,
      wmkf_policybody: body,
      wmkf_effectivedate: effectiveDate,
      'wmkf_Policy@odata.bind': `/${POLICY_ENTITY}(${parentId})`,
    });
    childId = created.wmkf_policyversionid;
  } catch (err) {
    // Duplicate-key violation = a concurrent publish raced us to step 1.
    // Re-read and re-dispatch into the branch logic. This is a tail-call:
    // the recursion bottoms out because the existingRecords path is taken.
    if (isDuplicateKeyError(err)) {
      return await runPublish({ slotCode, versionLabel, title, body, effectiveDate, parentEtag, profileId });
    }
    throw err;
  }

  // Use the ETag the client passed for the first try. Branch C re-reads
  // a fresh ETag internally.
  return await flipAndRetire({
    parentId, childId, priorActiveId, parentEtag, mode: 'fresh',
  });
}

async function flipAndRetire({ parentId, childId, priorActiveId, parentEtag, mode }) {
  // For resume mode, fetch a fresh parent ETag rather than trusting whatever
  // the client passed. (Codex round-3 finding #7.)
  let etag = parentEtag;
  if (mode === 'resume') {
    const parentRow = await DynamicsService.getRecord(POLICY_ENTITY, parentId, {
      select: 'wmkf_policyid',
    });
    etag = parentRow._etag;
  }

  try {
    await DynamicsService.updateRecord(POLICY_ENTITY, parentId, {
      'wmkf_ActiveVersion@odata.bind': `/${POLICY_VERSION_ENTITY}(${childId})`,
    }, { ifMatch: etag });
  } catch (err) {
    if (err.status === 412) {
      // Concurrency conflict. The newly-created child is now an orphan.
      let freshState = null;
      try {
        const slotCodeForReload = await reverseLookupSlotCode(parentId);
        if (slotCodeForReload) freshState = await loadSlotState(slotCodeForReload);
      } catch { /* best effort */ }
      return {
        status: 'concurrency_conflict',
        child: { id: childId, created: mode === 'fresh', reused: mode === 'resume' },
        parent: { flipped: false },
        priorRetired: false,
        priorRetiredId: null,
        parentId,
        orphan: { id: childId, reason: 'parent_etag_mismatch' },
        freshState,
        warnings: [],
      };
    }
    throw err;
  }

  // Retire prior active. Best effort — statecode is decorative; the
  // source of truth is parent.wmkf_activeversion.
  const warnings = [];
  let priorRetired = false;
  if (priorActiveId) {
    try {
      await DynamicsService.updateRecord(POLICY_VERSION_ENTITY, priorActiveId, {
        statecode: POLICY_VERSION_STATUS.RETIRED.statecode,
        statuscode: POLICY_VERSION_STATUS.RETIRED.statuscode,
      });
      priorRetired = true;
    } catch (err) {
      warnings.push('prior_retire_failed');
      console.error('[admin/policies] prior retire failed:', err.message);
    }
  }

  return {
    status: 'completed',
    child: { id: childId, created: mode === 'fresh', reused: mode === 'resume' },
    parent: { flipped: true },
    priorRetired,
    priorRetiredId: priorRetired ? priorActiveId : null,
    parentId,
    orphan: null,
    warnings,
  };
}

async function reverseLookupSlotCode(parentId) {
  // For freshState surfacing on concurrency_conflict. Cheap.
  const r = await DynamicsService.getRecord(POLICY_ENTITY, parentId, { select: 'wmkf_code' });
  return r.wmkf_code || null;
}

// ─────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────

function validateInputs({ slotCode, versionLabel, title, body, effectiveDate, parentEtag }) {
  if (!VISIBLE_SLOT_CODES.includes(slotCode)) {
    return { ok: false, status: 'invalid_input', error: `Unknown slot code '${slotCode}'.` };
  }
  if (typeof versionLabel !== 'string' || versionLabel.length === 0 || versionLabel.length > MAX_LABEL_LEN) {
    return { ok: false, status: 'invalid_input', error: `versionLabel must be 1..${MAX_LABEL_LEN} chars` };
  }
  if (typeof title !== 'string' || title.length === 0 || title.length > MAX_TITLE_LEN) {
    return { ok: false, status: 'invalid_input', error: `title must be 1..${MAX_TITLE_LEN} chars` };
  }
  if (typeof body !== 'string' || body.length < MIN_BODY_LEN || body.length > MAX_BODY_LEN) {
    return { ok: false, status: 'invalid_input', error: `body must be ${MIN_BODY_LEN}..${MAX_BODY_LEN} chars` };
  }
  const dateNormalized = normalizeDateOnly(effectiveDate) || todayISO();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateNormalized)) {
    return { ok: false, status: 'invalid_input', error: 'effectiveDate must be YYYY-MM-DD' };
  }
  const markdownCheck = validatePolicyMarkdown(body);
  if (!markdownCheck.ok) {
    return {
      ok: false,
      status: 'invalid_body',
      error: 'Policy body contains disallowed content.',
      details: { reason: markdownCheck.reason, dropped: markdownCheck.dropped || [] },
    };
  }
  return {
    ok: true,
    normalized: {
      slotCode,
      versionLabel: versionLabel.trim(),
      title: title.trim(),
      body,
      effectiveDate: dateNormalized,
      parentEtag: typeof parentEtag === 'string' ? parentEtag : null,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Audit
// ─────────────────────────────────────────────────────────────────────────

async function writePendingAudit({ requestId, slotCode, versionLabel, title, profileId }) {
  const r = await sql`
    INSERT INTO policy_publish_audit
      (request_id, slot_code, version_label, title, profile_id, phase, status)
    VALUES
      (${requestId}, ${slotCode}, ${versionLabel}, ${title}, ${profileId || null}, 'pending', 'pending')
    RETURNING id
  `;
  return r.rows[0]?.id || null;
}

async function writeFinalAudit({ requestId, profileId, slotCode, versionLabel, title, versionId, priorVersionId, parentId, status, outcomeJson, warningsJson }) {
  try {
    await sql`
      INSERT INTO policy_publish_audit
        (request_id, slot_code, parent_id, version_label, version_id, prior_version_id,
         title, profile_id, phase, status, outcome_json, warnings_json)
      VALUES
        (${requestId}, ${slotCode}, ${parentId || null}, ${versionLabel},
         ${versionId || null}, ${priorVersionId || null},
         ${title}, ${profileId || null}, 'final', ${status},
         ${JSON.stringify(outcomeJson)}::jsonb,
         ${JSON.stringify(warningsJson || [])}::jsonb)
    `;
    return true;
  } catch (err) {
    console.error('[admin/policies] final audit write failed:', err);
    try {
      await sql`
        INSERT INTO system_alerts (alert_type, severity, title, message, source, metadata)
        VALUES (
          'policy_audit_finalize_failed',
          'error',
          'Policy publish audit finalize failed',
          ${`Final audit write failed for request ${requestId} (slot ${slotCode}, label ${versionLabel}). Pending audit row may be present; reconcile manually.`},
          'admin/policies',
          ${JSON.stringify({ requestId, slotCode, versionLabel, status, error: err.message })}::jsonb
        )
      `;
    } catch (alertErr) {
      console.error('[admin/policies] system_alerts insert also failed:', alertErr.message);
    }
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function failure(status, message, details = null) {
  return {
    status,
    child: { id: null, created: false, reused: false },
    parent: { flipped: false },
    priorRetired: false,
    priorRetiredId: null,
    parentId: null,
    orphan: null,
    warnings: [],
    details: details ? { ...details, message } : { message },
  };
}

function escapeOData(s) {
  return String(s).replace(/'/g, "''");
}

function excerpt(s, n) {
  if (!s) return '';
  if (s.length <= n) return s;
  return s.slice(0, n) + '…';
}

function normalizeDateOnly(v) {
  if (!v) return null;
  const s = String(v);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function isDuplicateKeyError(err) {
  const msg = (err && err.message) || '';
  return /duplicate.*key|alternate.*key|0x80060888|DuplicateKey|already exists/i.test(msg);
}
