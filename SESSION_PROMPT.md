# Session 181 Prompt: Continue intake drain build (post-Connor unblocks + UI surface)

## Session 180 Summary

Major build session: P4 deployed (the last drain prereq), then 5 of the 7
drain state transitions shipped behind two Codex review rounds. All 8 commits
pushed to `origin/main`.

### What Was Completed

1. **P4 — `INTAKE_BLOB_RW_TOKEN` private Blob store provisioned.**
   Store `intake-applicant-private` (id `store_Eaui32n6i2wYMS6E`, region
   `iad1`, access `private`). Token set in production / preview / development.
   Shared `BLOB_READ_WRITE_TOKEN` confirmed untouched. CLAUDE.md + runbook +
   drain plan §P4 updated to mark deployed. All 6 drain prereqs (P0-P5) now
   done.

2. **Drain Phase A — submit endpoint + cron skeleton.**
   - `pages/api/intake/submit.js` — full §5 spec: idempotency, 409 on
     terminal collision, attachment-shape validation, single-txn
     `submission_jobs` INSERT + `intake_drafts.request_id` UPDATE.
   - `pages/api/cron/drain-submissions.js` — two-phase claim with
     `lease_token`, classifier-driven retry taxonomy, transactional
     state-transition+audit. Wired: `queued → scanning → request_created`
     with duplicate-PK recovery (read-back via GET). `files_moved` /
     `dynamics_patched` / `status_flipped` BUILD-PENDING (park
     `next_attempt_at +1h` + dedup alert).
   - `vercel.json` cron at `*/2 * * * *` (registered in same commit per v7 §5).

3. **Codex round 12 (4 MOD / 0 BLOCKER) folded.**
   (a) 23505 partial-unique race → structured 409 `submission_in_progress`
       with `priorJobId / priorRequestId / priorStatus`.
   (b) Classifier honors `err.isTransient === false` override → config-bug
       500s terminal-fail instead of burning retries.
   (c) Phase B deploy handoff (unpark SQL) documented in drain plan.
   (d) Drain cron uses strict inline `CRON_SECRET` check (no dev bypass) —
       scope-limited to drain only; other 9 crons keep their dev bypass.

4. **Drain Phase B step 1 — `files_moved` state wired.**
   `handleRequestCreated` streams each attachment from private Blob → SharePoint
   at `akoya_request/{requestnum}_{guidUpper}/Applicant_Uploads/`. Per-file
   idempotency via `sharepoint_paths` JSONB skip. Post-download sha256
   verification. Lease renewal before every external call. Pure helpers
   (`requestFolderName` / `isAlreadyWritten` / `guessContentType`)
   extracted to `lib/utils/drain-files-moved-helpers.js`. Attachment shape
   extended to require `pathname` (private-Blob `get` doesn't accept URL).

5. **Drain Phase B step 2 — `dynamics_patched` budget-lines half wired.**
   `handleFilesMoved` POSTs each pre-gen `wmkf_proposalbudgetline` child
   with per-child duplicate-PK skip via `dynamics_patches.budget_lines`
   JSONB tracking. Submit pre-generates UUIDs from `draft.draft_json.
   budget_lines` and stashes to `payload.children.budget_lines`. Persons
   children + parent aggregates deferred (Connor Q2 dependency).
   Helper `lib/utils/intake-budget-line-payload.js` with synthesizeName +
   validation + Dataverse POST body builder.

6. **Connor Q1-Q4 email drafted** (`docs/INTAKE_PORTAL_CONNOR_Q1_Q4_DRAFT.md`).
   Send-ready: state-machine diagram, copy-pasteable reply templates per
   question, "unblocks what" table, no deadline pressure. **NOT yet sent —
   pending Justin's review/send.**

7. **Contact bridge + OID-vs-GUID submit fix.**
   `lib/services/contact-bridge-service.js` — `resolveContactForSession`:
   OID match → email-link → create. Conflict route per `DESIGN.md:175`.
   Defensive duplicate-PK recovery for the alt-key Pending window. **FIXES
   BUG** in submit that Codex round 12 missed: `hasSubmitterRole` was
   getting the External ID OID where Dataverse filter expects the Contact
   GUID → silently returned `isSubmitter=false` for every applicant.

8. **Codex round 13 (2 CLEAN / 2 MOD / 1 BLOCKER) folded.**
   (a) BLOCKER Q3 — alt-key Pending race: bridge could create duplicate
       contacts while the index was building. Fixed via
       `ensureAltKeyActive()` probe (cached Active permanently, monotonic);
       new `DynamicsService.getEntityKey()` helper. Submit translates to
       503 + `Retry-After: 30` if probe fails.
   (b) MOD Q4 — multi-match conflict audit now includes `candidates`.
   (c) MOD Q5 — `validateAttachmentSet` for filename uniqueness (two
       same-named attachments with different sha would silently overwrite
       in SharePoint).

### Commits (S180, `main`, 9 pushed to origin)

| Hash | Description |
|---|---|
| `7bf07d3` | P4 deployed: `INTAKE_BLOB_RW_TOKEN` private store provisioned |
| `d09886f` | Drain Phase A: submit endpoint + drain skeleton (`queued → request_created`) |
| `7009512` | Drain Phase A round-12 fold: 4 MOD findings from Codex |
| `de159d0` | Drain Phase B step 1: `files_moved` state wired |
| `83ba1a4` | Drain Phase B step 2: `dynamics_patched` budget-lines half wired |
| `18ff50a` | Draft Connor Q1-Q4 email — unblocks status_flipped + persons handler |
| `d7766a0` | Build contact-bridge-service + fix OID-vs-GUID bug in submit |
| `8ed3476` | Round-13 fold: alt-key probe + audit candidates + filename uniqueness |
| (this) | Document Session 180 and create Session 181 prompt |

### State Machine Status

```
queued → scanning → request_created → files_moved → dynamics_patched (budget-lines)
                                                                ↓
                                                  [parks: persons + parent aggregates,
                                                          waiting on Connor Q2 +
                                                          contact-resolution service]
                                                                ↓
                                                  [status_flipped] → [completed]
                                                     ↑ waits on Connor Q1
```

### Test Count Growth

| Stage | Tests |
|---|---|
| Pre-S180 baseline | 612 ✓ |
| After Phase A skeleton | 664 ✓ (+52) |
| After Phase B step 1 | 687 ✓ (+23) |
| After Phase B step 2 | 717 ✓ (+30) |
| After bridge | 739 ✓ (+22) |
| After round-13 fold | **754 ✓** (+15) |

## Potential Next Steps

### 1. Send Connor Q1-Q4 email (zero build cost, large critical-path payoff)

`docs/INTAKE_PORTAL_CONNOR_Q1_Q4_DRAFT.md` is send-ready. Q1 unblocks
`status_flipped` (the last state transition). Q2 unblocks the persons
handler. Q3 unblocks pilot view filters. Q4 unblocks Connor's recompute
PA flow. Until these answers land, drain build is capped at the budget-
lines half of `dynamics_patched`.

### 2. Verify alt-key Active in prod (5 min; safety check)

The S179 deploy of `contact.wmkf_portaloid` alt-key was `Pending →
Active over a few minutes`. The bridge's `ensureAltKeyActive` will
fail-loud with 503 if still Pending, so a real applicant submitting
would get an error. Quick re-probe before pilot opens:

```bash
node -e "
const { DynamicsService } = require('./lib/services/dynamics-service');
DynamicsService.getEntityKey('contact', 'wmkf_portaloid').then(k =>
  console.log('Status:', k?.EntityKeyIndexStatus || 'NOT FOUND'));
"
```

Expected: `Status: Active`.

### 3. After Connor answers Q1 — `status_flipped` handler

PATCH the Q1-named picklist field on the parent `akoya_request` with
the Q1 integer value. State transition: `dynamics_patched →
status_flipped`. Smallest of the remaining handlers — one PATCH call,
no children to walk. Unparks rows currently stuck at `dynamics_patched`
via the v7 §"Phase B deploy handoff" SQL.

### 4. After Connor answers Q2 — persons handler + contact resolution

Larger build. The `wmkf_apprequestperson` children need `wmkf_Contact@
odata.bind` GUIDs for every roster member (PI, Co-PI, key personnel,
etc.). The submitting applicant's GUID is already in
`payload.contact_id` (S180 stash). Other roster members need
either:
  - Per-row lookup by email (similar to bridge but for non-self contacts)
  - OR a "needs staff contact-resolution" state with a parking handler
Decision needed before the build — Connor's Q2 answer affects which.

### 5. Build `/apply` UI + `/api/intake/draft` autosave + attach endpoint

Frontend / applicant-facing pieces. Larger scope; could be its own
multi-session arc. The draft endpoint is the immediate prerequisite for
any applicant ever exercising the drain. `/api/intake/draft/attach`
needs to write to the `INTAKE_BLOB_RW_TOKEN` store and populate the
`pathname` field on the attachment record. `/api/intake/jobs/[id]` is
the read-only status endpoint the applicant polls after submit.

### 6. Codex round 14 (only after substantive new code lands)

Round 13 closed cleanly on the 3-commit surface (Phase B steps + bridge).
Don't run reviews back-to-back without new substantive surface. Next
candidate: after `status_flipped` + persons or after the `/apply` UI lands.

### 7. Carryover from S179 tail (unchanged — still parked)

- Wave 1 elevation revert on prod app user (deferred until pilot iteration settles).
- W6 reviewer Postgres drain-only DROP (one-shot DELETE + DROP, fire ≥ 2026-07-01; still well in the future).

### 8. Repo hygiene trigger (fires soon)

`project-intake-meeting-agenda-cleanup` memory: `git mv
docs/INTAKE_PORTAL_MEETING_AGENDA_2026-05-13.md` to `docs/archive/`
once meeting decisions have landed. Trigger date is `≥ 2026-05-27` —
4 days away from today (2026-05-23).

## Key Files Reference

### New this session

| File | Purpose |
|---|---|
| `pages/api/intake/submit.js` | Applicant submit endpoint (idempotency + bridge + atomic INSERT+UPDATE) |
| `pages/api/cron/drain-submissions.js` | State machine drain with two-phase claim + classifier |
| `lib/services/contact-bridge-service.js` | OID → Dataverse Contact GUID resolution + alt-key probe |
| `lib/services/membership-service.js` | Submitter-role guard via `wmkf_portalmemberships` |
| `lib/utils/drain-error-classifier.js` | 10-category retry taxonomy (pure) |
| `lib/utils/intake-attachment-shape.js` | Per-attachment + set-level validation (filename uniqueness) |
| `lib/utils/drain-files-moved-helpers.js` | Pure helpers (folder name, idempotency check, content-type) |
| `lib/utils/intake-budget-line-payload.js` | `wmkf_proposalbudgetline` validation + POST body builder |
| `docs/INTAKE_PORTAL_CONNOR_Q1_Q4_DRAFT.md` | **Send-ready email** to Connor (not yet sent) |
| `tests/unit/{contact-bridge-service,intake-budget-line-payload,intake-attachment-shape,drain-error-classifier,drain-files-moved-helpers}.test.js` | 142 new test cases |

### Modified this session

| File | Change |
|---|---|
| `CLAUDE.md` | Added `INTAKE_BLOB_RW_TOKEN` env-var entry; route count 85→87 |
| `docs/CREDENTIALS_RUNBOOK.md` | Added `INTAKE_BLOB_RW_TOKEN` + backfilled `DVX_BLOB_RW_TOKEN` rows |
| `docs/INTAKE_PORTAL_DRAIN_PLAN.md` | P4 marked deployed; CLI command fix; Phase B deploy handoff §added |
| `docs/API_ROUTE_SECURITY_MATRIX.md` | `/api/intake/submit` + `/api/cron/drain-submissions` + "Applicant session" access class added |
| `docs/CANONICAL_COUNTS.md` | Route count regenerated 85 → 87 |
| `lib/services/dynamics-service.js` | New `getEntityKey()` metadata helper |
| `vercel.json` | Drain cron registered at `*/2 * * * *` |

## Testing

```bash
# All gates green pre-stop:
npm run check:atlas             # 29 PG / 32 DV ✓
npm run check:atlas:self-test   # 12/12 patterns ✓
npm run check:api-routes        # 87 routes ✓
npm run check:fact-consistency  # ✓
npm run check:canonical-pointers # ✓

# Full unit suite:
npx jest tests/unit             # 754 ✓ / 0 failures

# Drain endpoint live-test (requires CRON_SECRET in .env.local):
# curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/drain-submissions

# Verify alt-key Active in prod before pilot (S181 step 2 above):
node -e "const {DynamicsService} = require('./lib/services/dynamics-service'); \
  DynamicsService.getEntityKey('contact', 'wmkf_portaloid').then(k => \
  console.log('alt-key status:', k?.EntityKeyIndexStatus || 'NOT FOUND'))"
```

## Open Items (architectural, non-blocking)

- **Connor Q1-Q4 email status** — drafted in repo, not yet sent. Decision: Justin reviews + sends when ready.
- **alt-key Active verification** — assumed Active by now (S179 was 1 day ago); verify before pilot opens.
- **`status_flipped` target value** — depends on Connor Q1; drain currently parks rows at `dynamics_patched`.
- **Persons handler design** — depends on Connor Q2; affects whether contact resolution is per-row lookup or staff-assisted.
- **Tuition cap rule** — fixed-$ vs %-of-budget decision (TBD), parked in `BUDGET_FORM_SPEC.md`.
- **Tail items from earlier sessions** — Wave 1 elevation revert; W6 reviewer Postgres DROP (≥ 2026-07-01).

## Codex Notes (S180 refinement)

- Local-terminal Codex remained reliable (both round-12 and round-13 hit
  ~30s end-to-end with substantive findings).
- **Broker-driven Codex (`codex:codex-rescue` subagent) re-tested in S180,
  still unreliable** — stalled the same way as S179 round 4. Memory updated
  (`project-codex-recurring-review`): default to drafting copy-pasteable
  prompts for Justin to run locally; do NOT call the rescue subagent unless
  explicitly asked to retry.
- **Pattern continues:** every Codex round finds real bugs neither Claude
  nor manual review caught. Round 13 caught a BLOCKER (alt-key Pending
  race that would have created duplicate contacts in prod).
