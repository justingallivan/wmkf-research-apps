---
title: "Chunk 6 Design — Orphan-sweep cron + submit-side A1 guard"
domain: intake-portal
kind: spec
status: active
summary: "Final chunk of the S184 build. Two pieces, paired in a single commit because the contract amendments are intertwined."
canonical: false
cataloged: 2026-07-02
owner: product-engineering
related:
  - pages/api/intake/submit.js
  - pages/api/cron/maintenance.js
  - lib/services/maintenance-service.js
  - tests/unit/intake-pending-sweep.test.js
---

# Chunk 6 Design — Orphan-sweep cron + submit-side A1 guard

Final chunk of the S184 build. Two pieces, paired in a single commit
because the contract amendments are intertwined.

## 1. A1 submit-side guard

`/api/intake/submit` must reject 409 if `intake_drafts.pending_attachments`
is non-empty at submit time. Otherwise: submit succeeds with the
already-clean `attachments[]`, the drain promotes the request to
Dataverse, but the still-pending Blob bytes (mid-`/attach` race or
crashed browser) are orphaned — no path back into the application.

### Sequence

Current submit endpoint (`pages/api/intake/submit.js`) — between steps
4 (load draft via `getByKey`) and 5 (attachment shape validation), add:

```js
// 4a) Reject if a Blob upload is still in-flight (S184 A1).
const pending = Array.isArray(draft.pending_attachments) ? draft.pending_attachments : [];
if (pending.length > 0) {
  return jsonError(res, 409, 'pending_attachments_present', {
    pendingCount: pending.length,
    message: 'An upload is still in progress. Wait for it to finish, or refresh and remove the in-flight item before submitting.',
  });
}
```

The applicant-facing message points at the recovery path: wait or
remove. The 409 status + `pendingCount` lets the UI show specific
guidance.

### Audit

Per the chunk-4/5 posture (audit security signals + happy paths, skip
validation-noise rows): do NOT audit this rejection. It's a normal
user-error / timing artifact, not a probe signal. The clean rejection
+ client retry is sufficient.

### Tests

Extend `tests/unit/intake-submit-endpoint.test.js` (existing). Two
cases:
- Submit with non-empty `pending_attachments` → 409 `pending_attachments_present`
  with `pendingCount` in body.
- Submit with empty `pending_attachments` → continues normally
  (regression guard).

## 2. Orphan-sweep cron handler

The three-call dance leaves stale `pending_attachments` entries
behind whenever:
- The browser never PUTs the bytes (closed tab between
  `/upload-token` and step 2).
- The browser PUTs but never calls `/attach` (network drop, crash).
- `/attach` returns a scan-error (transient or misconfigured), the
  pending entry stays for retry, and the applicant doesn't retry.
- The 1h Blob token expires and the bytes can't be replaced.

The sweep cron deletes the orphan Blob (if any), removes the pending
entry, and audits per entry. Cutoff is **2h** per A6 (1h Blob token
expiry + 1h safety margin so a slow legitimate `/attach` retry isn't
prematurely 404'd).

### Plumbing

The daily `pages/api/cron/maintenance.js` job has 7 cleanup tasks
today. Add the intake-pending sweep as **task #8**:

```js
// 8. Intake-portal pending-attachment sweep (S184 chunk 6).
try {
  results.intakePending = await MaintenanceService.sweepIntakePending();
  if (results.intakePending?.deleted) totalDeleted += results.intakePending.deleted;
} catch (error) {
  results.intakePending = { error: error.message };
}
```

### `MaintenanceService.sweepIntakePending()`

New static method on `lib/services/maintenance-service.js`. Returns
`{ deleted: <number>, blobDelErrors: <number>, removePendingErrors: <number>, scanned: <number> }`.
Shape mirrors the existing `cleanupBlobs` reporter so the cron handler's
summary formatter (line 105-110) renders it consistently.

**Order of operations — Codex pre-impl Q3+Q7 catch.** Original draft
had `del` first, then `removePending`. That's UNSAFE: pending and
clean rows share the SAME opaque pathname (`drafts/{draftId}/{attachmentId}`
per A5), and a concurrent `/attach` could `promoteToClean` between
our `listPendingOlderThan` read and our `del` — wiping the bytes of
a just-promoted clean entry. The atomic JSONB `removePending` is the
concurrency gate: if it returns `{removed: true}` we know the entry
was still pending at the moment we removed it. If `{removed: false}`,
a concurrent `/attach` won the race and the bytes must stay.

```js
static async sweepIntakePending({ cutoffHours = 2 } = {}) {
  const cutoffIso = new Date(Date.now() - cutoffHours * 3600_000).toISOString();
  const stale = await IntakeDraftService.listPendingOlderThan(cutoffIso);

  let deleted = 0;
  let blobDelErrors = 0;
  let removePendingErrors = 0;
  let blobToken = null;

  try {
    blobToken = getIntakeBlobToken();
  } catch (err) {
    // No token = no point trying Blob deletions. Still proceed with
    // JSONB removal — the entries are stale either way, and an
    // orphan Blob is recoverable; an unbounded-growing JSONB column
    // is not.
    console.warn('[sweepIntakePending] INTAKE_BLOB_RW_TOKEN unset; skipping Blob deletions');
  }

  for (const { draftId, entry } of stale) {
    // 1. Atomic JSONB remove FIRST — this is the concurrency gate.
    //    {removed:true} means we won the race against any concurrent
    //    /attach.promoteToClean. {removed:false} means /attach already
    //    promoted the entry; we must NOT touch its Blob (now part of
    //    attachments[]) and we must NOT audit (this isn't an orphan).
    let removed = false;
    try {
      const r = await IntakeDraftService.removePending(draftId, entry.attachmentId);
      removed = r.removed;
    } catch (err) {
      removePendingErrors += 1;
      console.warn('[sweepIntakePending] removePending failed for', draftId, entry.attachmentId, err?.message ?? err);
      continue; // skip Blob del + audit — entry state is unknown
    }

    if (!removed) {
      // Lost the race. Pending entry is no longer there — /attach
      // promoted it. Leave the Blob alone, no audit row.
      continue;
    }

    deleted += 1;

    // 2. Now-safe: entry was DEFINITELY pending at JSONB removal time.
    //    Best-effort Blob delete. 404 is fine (bytes may have never
    //    been PUT in the first place).
    if (blobToken && entry.pathname) {
      try {
        await blobDel(entry.pathname, { token: blobToken });
      } catch (err) {
        if (!isNotFound(err)) {
          blobDelErrors += 1;
          console.warn('[sweepIntakePending] del failed for', entry.pathname, err?.message ?? err);
        }
      }
    }

    // 3. Audit (per scoping doc Q5 — one row per ACTUALLY-removed entry;
    //    A3 metadata/payload split).
    IntakeAuditService.log({
      actorOid: null,
      actorType: 'system',
      action: 'draft.attach_orphan_swept',
      targetEntity: 'intake_drafts',
      targetId: draftId,
      payload: { filename: entry.filename },
      metadata: {
        draftId, attachmentId: entry.attachmentId,
        fieldKey: entry.fieldKey,
        pathname: entry.pathname,
        createdAt: entry.createdAt,
        validUntil: entry.validUntil,
        cutoffIso,
      },
    }).catch(() => {});
  }

  // Codex Q6 catch: include `errors` total for the cron summary
  // formatter (line 104-107 of maintenance.js expects {deleted, errors}).
  const errors = blobDelErrors + removePendingErrors;
  return { deleted, scanned: stale.length, errors, blobDelErrors, removePendingErrors };
}
```

### `isNotFound(err)` helper

Vercel Blob `del()` 404 shape needs sniffing. Looking at @vercel/blob
v2.3 surface, `del()` returns Promise<void> and throws on non-2xx.
The error shape isn't deeply documented. Safe fallback: treat any
error message containing "not found" / "404" or `err.status === 404`
as a not-found. Inline helper in the maintenance service:

```js
function isNotFound(err) {
  if (!err) return false;
  if (err.status === 404) return true;
  const msg = (err.message || '').toLowerCase();
  return msg.includes('not found') || msg.includes('404');
}
```

If Codex pushback on this fuzzy match: a tighter alternative is to
HEAD the Blob first to check existence, but that's two API calls per
sweep entry instead of one — overkill.

### Audit shape

Per chunk-3 § 2 Q5 (locked): one audit row per removed entry. Shape
matches A3 split — `filename` digested in `payload`, everything else
(including `cutoffIso` so operator can see WHEN the sweep ran) in
`metadata`.

Actor: `actorType: 'system'`, `actorOid: null` — these aren't user-
initiated.

### Tests

`tests/unit/intake-pending-sweep.test.js` (new), mocked deps:
- `@vercel/blob` (`del`), `lib/services/intake-draft-service`
  (`listPendingOlderThan`, `removePending`), `lib/services/intake-audit-service`,
  `lib/utils/intake-blob` (`getIntakeBlobToken`).

Target ~10 cases:
- Empty pending → no-op (count: 0).
- One stale entry → del succeeds + removePending + audit row.
- Two stale entries → both processed, return count 2.
- Del 404 → swallow + still removePending + audit (success path).
- Del transient throw → blobDelErrors += 1, still removePending + audit.
- `INTAKE_BLOB_RW_TOKEN` unset → skip del, still removePending + audit
  (don't leave the JSONB growing unbounded).
- `removePending` throws → removePendingErrors += 1, audit still fires.
- `listPendingOlderThan` throws → propagate (cron handler catches).
- `cutoffHours` default = 2 (passed as 2 hours back in ISO string).
- Per-entry audit metadata has `cutoffIso` + `pathname` + `attachmentId` + filename in payload.

### Cron handler test

Extend `tests/unit/maintenance-cron.test.js` if it exists (verify
plumbing — the new task #8 is called and its result is folded into
the summary). If no test exists, skip — the cron handler is mostly
glue; the sweep service is where the logic lives.

## 3. Risks / rollback

- **A1 guard is a new reject path** on a load-bearing endpoint
  (`/api/intake/submit`). All existing submit tests must continue to
  pass without modification (they don't set `pending_attachments`).
- **No new env vars.** Sweep uses the existing `INTAKE_BLOB_RW_TOKEN`
  and `CRON_SECRET`.
- **Sweep is best-effort.** If the cron fails entirely, the existing
  maintenance error path catches it and emits an `ops` alert.
- **No security matrix change.** The cron route already exists
  (`/api/cron/maintenance`). The new sweep is internal plumbing under
  the existing route.
- **Mid-pilot rollout**: chunks 4-5 ship endpoints. Without chunk 6's
  A1 guard, an applicant who races `/upload-token` against `/submit`
  could submit with stale pending entries. Chunk 6 should ship to the
  pilot environment BEFORE the chunks 4-5 endpoints are wired into a
  UI that allows that race.

## 4. Open questions for Codex

### Q1 — Audit on sweep failures?

If `del()` throws OR `removePending` throws, we increment a counter
but don't audit. Should each failure get its own audit row (mirror
of chunk-5 `infected_del_failed` / `cap_race_del_failed` posture)?

My default: no per-entry audit on sweep failure. The cron's run-level
`maintenance_runs` row already captures the error counts in
`details.intakePending`; per-entry audit on sweep failures would
add row-cost without strong forensic value (these aren't security
signals — they're cleanup-path noise). Codex view?

### Q2 — Order of operations: del before removePending vs the reverse?

Currently: del Blob FIRST, then `removePending`. If `del` fails, we
still `removePending` (and increment `blobDelErrors`). Alternative:
`removePending` FIRST so the JSONB drain happens reliably; del Blob
on best-effort second.

Trade-off: del-first means a failed del leaves an orphan Blob that
the sweep WILL retry on the next tick (because the pending entry was
removed first under my CURRENT design — oh wait, no, I do del first,
THEN remove on success-of-del-or-not). Hmm. Let me re-read.

Per the code above: del first, then `removePending` runs whether or
not del threw. So a failed del leaves an orphan Blob; the pending
entry is gone; the next sweep tick won't retry.

If I reverse: `removePending` first; if it succeeds, attempt del.
A failed del = orphan Blob with no retry path. Same outcome.

Either order has the same orphan-Blob risk. The cleaner posture is
del-first because the Blob is the larger storage cost and the cron
is the only chance to clean it up.

Codex: agree, or push for the reverse?

### Q3 — `isNotFound(err)` heuristic

The 404-sniff is fuzzy. Worth using @vercel/blob's actual error type
(if exported) or hitting `head()` first?

My default: keep the fuzzy match; it's a small surface and the cost
of a missed 404 is just a logged warning, not a bug. Codex?

### Q4 — Sweep cron cadence

Maintenance runs daily at 3 AM UTC. With a 2h pending TTL, an entry
created at 4 AM UTC waits ~23 hours to be swept. That's fine
operationally (orphan Blobs cost ~pennies), but maybe a faster cron
makes sense?

My default: daily is fine. Faster cadence adds db/Blob load without
solving an actual user-facing problem. Codex?

### Q5 — Reporting shape

The handler today summarizes per-task in line 105-110. Custom result
shape `{deleted, blobDelErrors, removePendingErrors, scanned}` —
will the summary formatter render it sensibly?

Current code:
```js
if (typeof val === 'number') return `${key}: ${val} deleted`;
if (val?.deleted !== undefined) return `${key}: ${val.deleted} deleted, ${val.errors || 0} errors`;
if (val?.error) return `${key}: ERROR - ${val.error}`;
```

The second branch matches `{deleted, ...}` and reports "intakePending:
N deleted, 0 errors" — but my result has `blobDelErrors` +
`removePendingErrors`, not `errors`. Either:
- Rename to `errors: blobDelErrors + removePendingErrors` for the
  formatter compatibility.
- Add an explicit summary string in the result shape.

Codex preference? I'm leaning toward returning both granular and
total: `{deleted, scanned, errors: blobDelErrors + removePendingErrors, blobDelErrors, removePendingErrors}`.
