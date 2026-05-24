# Session 184 Prompt: Intake attach endpoint + DFT/Connor follow-throughs

## Session 183 Summary

**Net work: 9 commits, all defensive/security-shaped.** Built the
Cloudmersive virus-scan service and wired it into the live reviewer-
upload flow (gated off by default via `VIRUS_SCAN_ENABLED`). Built the
intake-portal autosave endpoint. Reconciled the design tension between
the design doc's "bytes never traverse" claim and the drain plan's
"synchronous scan" requirement into a documented three-call dance for
the upcoming attach endpoint. Calibrated the spend-alert threshold
against 60d of real prod data. Drafted DFT and Connor emails (rewrote
Connor's prior draft into stakeholder register after feedback). Three
Codex review rounds (#8, #9, #10) caught + fixed 1 BLOCKER + 3 MODs +
4 LOWs in the autosave endpoint before they shipped to anyone using it.

### What Was Completed

1. **Cloudmersive scanner service + EICAR smoke (`270fbe7`).**
   - `lib/services/cloudmersive-scan.js` — `scanBytes(bytes, filename)`
     returning `{scan_result, foundViruses, scannedAt, scanner}`. Uses
     existing `buildServiceError`/`buildNoResponseError` so the drain
     classifier already knows what to do with the structured errors.
     30s timeout, 3-retry on 5xx/network with backoff, fails loud on
     missing `CLOUDMERSIVE_API_KEY`.
   - 12 unit tests + `scripts/smoke-virus-scan.mjs` (EICAR live-API
     smoke; verified against real Cloudmersive endpoint).

2. **Reviewer-upload integration (`1843b54`).**
   - `lib/utils/virus-scan-config.js` — `isVirusScanEnabled()` single
     source of truth reading `VIRUS_SCAN_ENABLED`. Default off.
   - `lib/services/review-upload.js` — new `runVirusScans()` helper
     called between structured-data validation and folder resolution.
     `Promise.allSettled` parallelism (per Codex round-8). Three new
     `ok:false` reasons: `infected`, `scan_misconfigured` (4xx/missing
     key), `scan_unavailable` (5xx/network exhaust). Discriminated via
     `err.isTransient`.
   - `lib/utils/review-upload-response.js` — shared HTTP response mapper
     so the two endpoints (staff session + external token) can't drift.
     `infected` → 422, `scan_misconfigured` → 500, `scan_unavailable`
     → 503; all client-facing messages opaque, structured details
     logged server-side.
   - 11 new shared-core tests + 7 mapper tests.
   - CLAUDE.md + `docs/CREDENTIALS_RUNBOOK.md` env-var + runbook updates
     (emergency bypass procedure documented).

3. **DFT virus-scan questions draft (`1843b54`).**
   - `docs/DFT_VIRUS_SCAN_QUESTIONS_DRAFT.md` — 5 focused questions for
     IT about Defender for Office 365 / Safe Attachments / endpoint AV.
     Answers determine whether app-side scanning is primary or
     defense-in-depth. Verified the actual SharePoint URL
     (`appriver3651007194.sharepoint.com/sites/akoyaGO`) — note the
     AkoyaGO-tenant origin may mean DFT needs to bounce part to AkoyaGO.
   - **Not sent yet.** Your action.

4. **Connor Q1-Q4 email rewrite (`76b608a`).**
   - Prior draft was over-technical ("semantically load-bearing",
     "intake-portal drain"). Rewrote in stakeholder register: frames
     every question from Connor's POV, leads with consequence not
     mechanism, drops internal doc citations.
   - Added `.claude-memory/feedback-stakeholder-email-tone.md` so the
     register becomes default for Connor/Sarah/DFT drafts.
   - **Sent.** Awaiting Connor's reply.

5. **Intake-portal attach design reconciliation (`400551c`).**
   - Codex round-7 design pass settled the architectural tension between
     `INTAKE_PORTAL_DESIGN.md` ("bytes never traverse function") and
     `INTAKE_PORTAL_DRAIN_PLAN.md` ("synchronous scan on attach"):
     three-call dance — upload-token mints a path-scoped Blob token,
     browser PUTs direct, attach downloads-and-scans from private Blob.
   - Folded in 4 Codex-driven design changes: delete-on-infected (not
     90-day keep); server-minted attachmentId + path; `pendingAttachments[]`
     JSONB array on the draft for in-flight uploads; daily orphan-sweep
     cron. All spec'd; **no code yet — that's S184's big build**.

6. **Spend-alert calibration (`3fee411`).**
   - 60d prod data: max legitimate day $26.16 (batch processing); avg
     active day $1.85; threshold was firing on legitimate batch days.
   - Code default changed $10 → $75 (~3× headroom over max while still
     catching a true runaway within an hour).
   - **Your action**: flip the prod env var to match
     (`vercel env add DAILY_SPEND_ALERT_CENTS production` → `7500`).

7. **Intake-portal autosave endpoint (`55080d7`).**
   - `POST /api/intake/draft` — applicant-session-gated upsert for the
     form's `draft_json`. Any-role membership (Contributors can edit).
   - New `IntakeDraftService.upsertDraftJson()` — touches only
     `draft_json`, never overwrites `attachments[]` (avoids the race
     where an autosave between an `/attach` append and the UI's state
     push would clobber the appended row).
   - New `MembershipService.hasLiveMembership()` — any-role equivalent
     of `hasSubmitterRole()`.
   - Server owns `idempotency_key` lifecycle: minted on first autosave,
     preserved across subsequent ones. Caller-supplied keys stripped.
   - Bridge + identity_conflict handling mirrors `/submit`.
   - 23 endpoint tests; security matrix updated (90 → 91 routes).

8. **Codex rounds 8-10 fixes (`a5d69b2`, `d0e379a`, `abe63b6`).**
   - **BLOCKER (round-8):** `requestId` ownership-takeover at
     `/api/intake/draft`. The endpoint accepted `requestId` from the
     body and the service's with-request branch reassigned `contact_oid`
     on conflict — any Contributor at an institution who knew a request
     GUID could overwrite/reassign another Contributor's draft. Fixed
     by rejecting any non-null `requestId` at the endpoint (the
     with-request branch is documented out-of-v1-scope).
   - **MOD (round-8):** First-autosave two-tab race could mint two
     different `idempotency_key`s. Fixed at SQL layer with `jsonb_set`
     + `COALESCE` on the existing row's key.
   - **MOD (round-9):** Round-8's COALESCE didn't distinguish SQL NULL
     (key absent) from JSONB null (key present, value null) — the
     latter would silently preserve JSON null. Fixed with `NULLIF`
     against `'null'::jsonb` on both sides.
   - **LOW (round-9 → round-10):** Service precondition originally just
     required "non-empty string", which accepted whitespace, control
     chars, 1KB strings. Tightened to UUIDv4 regex — the field is
     internal infrastructure only minted by the endpoint via
     `crypto.randomUUID()`.
   - **Misc LOWs:** test.each refactor for diagnosability; metadata
     shape assertion; new `tests/unit/intake-draft-service.test.js`
     with 27 cases (req-arg + 16 shape-rejection + happy + uppercase).
   - **Round-10 verdict:** all findings closed except one structural
     LOW (mock can't validate SQL text — deferred to integration tests).

### Commits

| Hash | Subject |
|---|---|
| `270fbe7` | Cloudmersive virus-scan service + EICAR smoke (S183) |
| `1843b54` | Wire Cloudmersive scanner into reviewer-upload flow (S183) |
| `76b608a` | Rewrite Connor Q1-Q4 email in stakeholder register (S183) |
| `400551c` | Reconcile intake-portal attach design across DESIGN + DRAIN_PLAN (S183) |
| `3fee411` | Calibrate DAILY_SPEND_ALERT_CENTS default $10 -> $75 (S183) |
| `55080d7` | Add /api/intake/draft autosave endpoint (S183) |
| `a5d69b2` | Fix /api/intake/draft Codex round-8 findings: BLOCKER + 1 MOD + 1 LOW (S183) |
| `d0e379a` | Harden upsertDraftJson against JSON-null idempotency_key (S183) |
| `abe63b6` | Tighten upsertDraftJson idempotency_key contract to UUIDv4 (S183) |

### What stayed green throughout

- All 7 CI gates: `check:atlas`, `check:atlas:self-test`,
  `check:api-routes`, `check:fact-consistency`,
  `check:prompt-injection-tagging`, `check:canonical-pointers`,
  `check:memory-drift` (advisory).
- Unit suite grew from 815 (S181 baseline) → **898 passing**.

## Potential Next Steps

### 1. Intake attach endpoint — the big build (carried from S183)

Fully spec'd this session (`docs/INTAKE_PORTAL_DRAIN_PLAN.md`
§"Attachment upload — three-call dance"). Scope:

- `POST /api/intake/draft/upload-token` — auth + membership + draft
  ownership, mint `attachmentId = crypto.randomUUID()`, derive
  server-controlled pathname (`drafts/{draftId}/{attachmentId}/{filename}`),
  append `pendingAttachments[]` entry to the draft's JSONB, mint
  Vercel Blob client-upload token scoped to that exact pathname +
  field-config `maxBytes` + 1h `validUntil`. Return `{attachmentId,
  token, pathname}`.
- `POST /api/intake/draft/attach` — `{draftId, attachmentId}` only
  (server derives the rest), look up pending entry, download bytes
  from private Blob (`INTAKE_BLOB_RW_TOKEN`), recompute sha256/size,
  magic-byte validate, `scanBytes`, branch:
  - clean → atomic remove pending + append to `attachments[]`, 200
  - infected → delete Blob + audit metadata + remove pending, 422
  - scan_misconfigured → leave pending, 500 (operator fix unblocks retry)
  - scan_unavailable → leave pending, 503 (cloudmersive recovery
    unblocks retry; browser re-POSTs same attachmentId)
- New `IntakeDraftService` helpers: `appendPending`,
  `promoteToClean(attachmentId)`, `removePending(attachmentId)`.
- Per-field `maxBytes` resolution from `shared/forms/<cycle>/schema.js`
  — need to investigate the schema shape first.
- Orphan-sweep cron handler in the existing maintenance cron: sweep
  `pendingAttachments` older than 1h (past token expiry).
- Tests for both endpoints + the cron sweep.
- Same idempotency contract style as the autosave endpoint (server
  owns identity, no trust of client metadata).

Expected scale: full session of focused work. Codex review round
after the build.

### 2. Connor's reply lands → wire status_flipped + persons handlers

These were the two drain pieces blocked on Connor's Q1-Q4 answers.
Once the reply lands:
- **Q1** unblocks `status_flipped` drain handler (final state
  transition).
- **Q2** unblocks `wmkf_apprequestperson` POSTs + parent PI fields
  at Create.
- **Q3** unblocks pilot view filters (Connor + AkoyaGO admin work,
  not ours).
- **Q4** unblocks Connor's recompute flow ship.

### 3. DFT reply (when it lands) — decide app-side scanning posture

If DFT confirms Defender for Office 365 + Safe Attachments are on:
scanning is defense-in-depth and the priority of any future scanning
work (e.g., expanding to grant-reporting uploads) drops.

If DFT confirms they're NOT on: app-side is primary, and we should
think about hardening other entry points (staff direct uploads, PA
flows). That's a strategic conversation, not just code.

### 4. Carryover, dates not yet hit

- Wave 1 elevation revert on prod app user.
- W6 reviewer Postgres DROP — fires ≥ 2026-07-01.
- ~~Archive intake meeting agenda~~ — fires ≥ 2026-05-27 (3 days
  out from session end).

### 5. Stale loose ends from S181

- 1h cache write column split (only needed if we ever start using 1h
  caching).

## Your action items, not mine

- Send the **DFT email** (`docs/DFT_VIRUS_SCAN_QUESTIONS_DRAFT.md`).
- Flip prod env var: `vercel env add DAILY_SPEND_ALERT_CENTS production`
  → `7500`.
- When ready to start exercising the reviewer-upload scanner in
  preview: `vercel env add VIRUS_SCAN_ENABLED preview` → `true`
  (CLOUDMERSIVE_API_KEY is already set per S183 work). Verify with
  a real reviewer upload + EICAR via the live `/external/review/*`
  path.

## Key Files Reference

### New this session

| File | Purpose |
|---|---|
| `lib/services/cloudmersive-scan.js` | `scanBytes()` Cloudmersive client w/ structured errors + retries |
| `lib/utils/virus-scan-config.js` | `isVirusScanEnabled()` kill-switch single source of truth |
| `lib/utils/review-upload-response.js` | Shared HTTP mapper for reviewer-upload failure reasons |
| `scripts/smoke-virus-scan.mjs` | EICAR + clean live-API round-trip smoke |
| `pages/api/intake/draft.js` | Applicant autosave endpoint (NEW route 91) |
| `tests/unit/cloudmersive-scan.test.js` | 12 cases |
| `tests/unit/review-upload-response.test.js` | 7 cases |
| `tests/unit/intake-draft-endpoint.test.js` | 25 cases |
| `tests/unit/intake-draft-service.test.js` | 27 cases (new — service-level for upsertDraftJson) |
| `docs/DFT_VIRUS_SCAN_QUESTIONS_DRAFT.md` | Drafted, not yet sent |
| `.claude-memory/feedback-stakeholder-email-tone.md` | Connor/Sarah/DFT draft register |

### Materially edited this session

| File | Change |
|---|---|
| `lib/services/review-upload.js` | New `runVirusScans()` helper between structured-data validation and folder resolution |
| `lib/services/intake-draft-service.js` | New `upsertDraftJson()` (draft_json only, idempotency_key UUIDv4 + jsonb_set + COALESCE + NULLIF) |
| `lib/services/membership-service.js` | New `hasLiveMembership()` any-role guard |
| `pages/api/cron/spend-check.js` | Default 1000 → 7500 cents |
| `pages/api/review-manager/upload-review.js` | Uses shared response mapper |
| `pages/api/external/review/[token]/upload.js` | Uses shared response mapper |
| `docs/INTAKE_PORTAL_DESIGN.md` | "Bytes never traverse" softened; delete-on-infected; no-trust-client-metadata |
| `docs/INTAKE_PORTAL_DRAIN_PLAN.md` | Three-call dance spec + pendingAttachments + orphan-sweep cron |
| `docs/INTAKE_PORTAL_CONNOR_Q1_Q4_DRAFT.md` | Rewritten in stakeholder register |
| `docs/API_ROUTE_SECURITY_MATRIX.md` | New `/api/intake/draft` row |
| `docs/CREDENTIALS_RUNBOOK.md` | `VIRUS_SCAN_ENABLED` + `CLOUDMERSIVE_API_KEY` + spend calibration |
| `CLAUDE.md` | Env-vars section updated; `INTAKE_BLOB_RW_TOKEN` description corrected for 3-call flow |

## Testing

```bash
# All gates green pre-stop:
npm run check:atlas                       # 30 PG / 32 DV ✓
npm run check:atlas:self-test             # 12/12 patterns ✓
npm run check:api-routes                  # 91 routes ✓ (up from 90)
npm run check:fact-consistency            # ✓
npm run check:prompt-injection-tagging    # 24 migrated, 0 pending ✓
npm run check:canonical-pointers          # 9 pointers ✓

# Full unit suite (S181 baseline 815 → S183 close 898):
npx jest tests/unit                       # 898 ✓ / 0 failures

# Live virus-scan smoke (needs CLOUDMERSIVE_API_KEY in .env.local):
node scripts/smoke-virus-scan.mjs         # clean → clean, EICAR → infected
```

## Open Items (architectural, non-blocking)

- **Connor Q1-Q4 reply** — sent this session, awaiting reply.
- **DFT virus-scan questions** — drafted, not yet sent.
- **Reviewer-upload scanning** — built but `VIRUS_SCAN_ENABLED` unset
  in all envs. No behavior change in prod until flipped.
- **Intake attach endpoint** — fully spec'd, no code yet. S184's
  main build.
- **Spend threshold prod env var** — code default bumped to $75,
  prod env var still at the old value until manually updated.
- **DAILY_SPEND_ALERT_CENTS** calibration — Codex round-10 noted
  one residual LOW (mock can't validate SQL text) deferred to
  whenever an intake-portal integration test harness is stood up.
