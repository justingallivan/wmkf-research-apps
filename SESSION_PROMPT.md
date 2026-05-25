# Session 185 Prompt: Pilot wiring + UI rewrite for the three-call attach dance

## Session 184 Summary

**Net work: 14 commits — the full S184 6-chunk intake-attach build,
all chunks Codex-reviewed pre-impl AND post-impl.** Shipped the
three-call applicant-attachment dance end-to-end: migration, utilities,
service helpers, two endpoints, orphan-sweep cron, and the
submit-side A1 guard. Plus a race fix at the SQL level when the
chunk-5 post-impl review caught a TOCTOU in the cardinality gate.
Route count 91 → 93. Unit suite gained ~200 cases.

### What Was Completed

**Chunks 1-6 of the three-call attach dance**:

1. **Migration + scoping (chunks 1 + 1-follow-up)**.
   `pending_attachments JSONB NOT NULL DEFAULT '[]'::jsonb` column on
   `intake_drafts` (migration 013). Drain plan amendments A1-A7
   reconciled paragraph-by-paragraph (Codex round-1 catch: the
   callout-box deferral wasn't enough — actual contradictions had to
   be fixed line by line per `feedback-reconcile-dont-append-docs`).

2. **Utilities (chunks 2 + 2-follow-up)**. Three new modules:
   - `lib/utils/file-magic.js` → `validateIntakeAttachment` (PDF/DOCX/XLSX,
     parameterized over field `accept[]`)
   - `lib/utils/blob-filename.js` → `sanitizeBlobFilename` (NFKC,
     whitespace-padded `..` rejection, codepoint-aware truncation —
     Codex round-2 caught both real attack vectors)
   - `lib/utils/intake-blob.js` → `getIntakeBlobToken` (fail-loud on
     missing/whitespace-only `INTAKE_BLOB_RW_TOKEN`)

3. **Service helpers (chunk 3 + chunk 5 race-fix)**.
   `IntakeDraftService.{getById, appendPending, selectPendingForDraft,
   promoteToClean, removePending, listPendingOlderThan}`.
   `promoteToClean` carries a SQL-level cardinality gate (third
   `UPDATE WHERE` clause counts `attachments[]` filtered by `fieldKey`,
   blocks if `>= cap`). Codex pre-impl caught the CTE-vs-WHERE EvalPlanQual
   confusion; chunk-5 post-impl caught the cardinality race that this
   gate now fixes at the only race-safe layer.

4. **`POST /api/intake/draft/upload-token` (chunks 4 + 4-follow-up)**.
   Auth + direct-owner-short-circuit + bridge + cardinality + sanitizer
   + Blob token mint (BEFORE pending append so a mint failure doesn't
   orphan) + audit. Codex post-impl caught: missing `Number.isSafeInteger`
   on `draftId`, missing `maxSizeMb` 500, post-`appendPending` invariant
   verify, audit `metadata` missing `draftId`. 50 unit tests.

5. **`POST /api/intake/draft/attach` (chunks 5 + two follow-ups)**.
   19-step sequence with 5 outcome branches + 9 audit actions.
   `removePending`-first concurrency gate via `promoteToClean`'s SQL.
   Magic-mismatch keeps Blob (operator-decision); size/infected/cap-race
   delete Blob. Codex post-impl caught the TOCTOU cardinality race +
   `blob_url: null` fail-loud + `scanned_at` fallback + `sniffedType`
   in magic-mismatch audit. 61 unit tests.

6. **Orphan-sweep cron + A1 submit guard (chunks 6 + 6-follow-up)**.
   `MaintenanceService.sweepIntakePending()` runs `removePending`-first
   (concurrency gate against `/attach.promoteToClean`'s shared opaque
   pathname per A5). Wired as task #6 in the daily maintenance cron
   (BEFORE `cleanupBlobs` so sweep-del failures feed into the next
   cleanup task on the same tick). Submit endpoint rejects 409
   `pending_attachments_present` if `intake_drafts.pending_attachments`
   non-empty. 15 unit tests + 4 A1 guard tests.

**Memory + CLAUDE.md closeout (commit 14)**:
   - `.claude-memory/feedback-real-fix-not-design-note.md` — user
     pushback on "acceptable for pilot" framing; default to "real fix
     + cost".
   - `.claude-memory/project-codex-design-pre-impl-iteration.md` —
     the 14-commit iteration pattern that worked.
   - CLAUDE.md updated: intake-draft-service entry, 4 new utility-class
     entries, database schema row, Extended Documentation pointer to
     scoping + per-chunk design docs.

### Commits

| Hash | Subject |
|---|---|
| `1b88b21` | Chunk 1/6: intake_drafts.pending_attachments column + S184 scoping (A1-A7) |
| `6bc1780` | Chunk 1 follow-up: reconcile drain-plan paragraphs + 2 nits (Codex) |
| `29018d6` | Chunk 2/6: three intake-attach utilities (file-magic, sanitizer, blob token) |
| `573c7c0` | Chunk 2 follow-up: 2 sanitizer/token fixes + 3 tests (Codex round-2) |
| `baaf0f7` | Chunk 3/6: IntakeDraftService pending-attachment helpers |
| `1933509` | Chunk 4/6: POST /api/intake/draft/upload-token |
| `d46d7f7` | Chunk 4 follow-up: 5 MODs + 4 LOWs (Codex post-impl review) |
| `fa3fb3b` | Chunk 5/6: POST /api/intake/draft/attach |
| `ef43140` | Chunk 5 follow-up: SQL-level cardinality race fix + 3 MODs + 4 tests |
| `49dd321` | Chunk 5 race-fix follow-up: Codex Q4+Q6 catches |
| `3a1859b` | Chunk 6/6: orphan-sweep cron + /api/intake/submit A1 guard |
| `04d4980` | Chunk 6 follow-up: Codex Q5+Q7 catches |
| `975e589` | CLAUDE.md: S184 intake-attach build references + memory entries |

### What stayed green throughout

- All 7 CI gates: `check:atlas`, `check:atlas:self-test`,
  `check:api-routes` (91 → 93), `check:fact-consistency`,
  `check:prompt-injection-tagging`, `check:canonical-pointers`,
  `check:drain-table-mentions`, `check:prompt-storage-mentions`.
- Unit suite: 898 (S183 baseline) → ~1100 (+~200 cases).

## Potential Next Steps

### 1. Preview-environment wiring (S183 carryovers still pending + S184 follow-up)

Three env-var actions queued from prior sessions; chunks 4-5 endpoints
are SHIPPED but unreachable through the preview UI without these:

- Send the **DFT virus-scan questions email** (drafted in S183 at
  `docs/DFT_VIRUS_SCAN_QUESTIONS_DRAFT.md`, not sent yet — applicant-
  side scanning posture decision depends on DFT's answer).
- `vercel env add CLOUDMERSIVE_API_KEY production` (already in
  preview per S184 wiring test; not yet in prod).
- `vercel env add VIRUS_SCAN_ENABLED production` → `true` once DFT
  question is resolved.
- Confirm `INTAKE_BLOB_RW_TOKEN` is set in prod (S184 chunk 4+5
  endpoints fail-loud without it). Production env was not exercised
  during the build session.

### 2. UI rewrite for the three-call dance — the BIG carryover

The chunks 4-5 endpoints are LIVE but no UI calls them yet. The form
code in `shared/components/intake/` is still on the old single-call
attachment model (file passes through the function). Rewriting the
applicant-portal form's file-input flow to the three-call pattern is
the next big build:

1. UI mints `{draftId, fieldKey, filename, contentType}` → POST
   `/api/intake/draft/upload-token`.
2. UI uses `@vercel/blob/client` `put(pathname, file, {token, access:'private', ...})`
   with the returned token to PUT bytes directly.
3. UI POSTs `{draftId, attachmentId}` to `/api/intake/draft/attach`,
   handles the 7+ response shapes (200 attached, 200 already_attached,
   404, 409, 413, 422 infected/magic_mismatch/cap, 500, 503).

UX considerations:
- Progress bar via `@vercel/blob/client` `put()`'s `onUploadProgress`
  callback.
- Retry-friendly: 503 `scan_unavailable` / `blob_unavailable` should
  show "try again in a moment" not "upload failed."
- Idempotent retry: 200 `already_attached` should be a silent success,
  not a duplicate-upload warning.
- Cardinality errors (`field_max_files_exceeded` / `field_already_has_attachment`)
  need field-level UI feedback, not a generic toast.

This is probably a full session of focused frontend work + manual
preview-environment smoke + Codex review.

### 3. Smoke the live endpoints on preview

Before UI work: write a small smoke script that exercises the three-
call dance against `https://wmkfresearchapps-preview.vercel.app` using
a real applicant session. Confirms:
- Token mint includes the right `allowedContentTypes` + `validUntil`.
- Browser-direct PUT succeeds against `INTAKE_BLOB_RW_TOKEN`'s store.
- `/attach` returns 200 attached + populates `attachments[]` + audit
  row lands with the right A3 split.
- A1 submit guard fires when pending non-empty.

### 4. Connor's Q1-Q4 reply → status_flipped + persons handlers

Carryover from S183. When the reply lands:
- Q1 unblocks `status_flipped` drain handler.
- Q2 unblocks `wmkf_apprequestperson` POSTs + parent PI fields at
  Create.
- Q3 unblocks pilot view filters (Connor + AkoyaGO admin work, not
  ours).
- Q4 unblocks Connor's recompute flow ship.

### 5. Carryover, dates not yet hit

- Wave 1 elevation revert on prod app user (no fire-by date).
- W6 reviewer Postgres DROP — fires ≥ 2026-07-01.
- Archive intake meeting agenda — fires ≥ 2026-05-27 (TOMORROW from
  session end on 2026-05-24).

### 6. Stale loose ends from S181

- 1h cache write column split (only needed if we ever start using
  1h caching).

## Your action items, not mine

- Send the DFT email.
- `vercel env add VIRUS_SCAN_ENABLED production` → `true` AFTER DFT.
- `vercel env add CLOUDMERSIVE_API_KEY production`.
- Verify `INTAKE_BLOB_RW_TOKEN` is set in production (check via
  `vercel env ls | grep INTAKE_BLOB_RW_TOKEN`).

## Key Files Reference

### New this session

| File | Purpose |
|---|---|
| `lib/db/migrations/013_intake_drafts_pending_attachments.sql` | `pending_attachments` column |
| `lib/utils/file-magic.js` (extended) | `validateIntakeAttachment` for intake fields |
| `lib/utils/blob-filename.js` (NEW) | `sanitizeBlobFilename` for applicant-supplied filenames |
| `lib/utils/intake-blob.js` (NEW) | `getIntakeBlobToken` helper |
| `lib/utils/form-schema.js` (NEW) | Schema loader + `findFileField` + `countFieldEntries` |
| `lib/services/intake-draft-service.js` (extended) | 6 new pending-attachment helpers |
| `lib/services/maintenance-service.js` (extended) | `sweepIntakePending` |
| `pages/api/intake/draft/upload-token.js` (NEW) | Three-call dance leg 1 |
| `pages/api/intake/draft/attach.js` (NEW) | Three-call dance leg 3 |
| `pages/api/intake/submit.js` (extended) | A1 guard |
| `pages/api/cron/maintenance.js` (extended) | Task #6 wired |
| `docs/INTAKE_ATTACH_BUILD_SCOPING.md` | Scoping doc (locked) |
| `docs/INTAKE_ATTACH_CHUNK3_DESIGN.md` | Chunk 3 design |
| `docs/INTAKE_ATTACH_CHUNK4_DESIGN.md` | Chunk 4 design |
| `docs/INTAKE_ATTACH_CHUNK5_DESIGN.md` | Chunk 5 design |
| `docs/INTAKE_ATTACH_CHUNK6_DESIGN.md` | Chunk 6 design |
| `tests/unit/intake-attach-utils.test.js` (NEW) | 31 cases |
| `tests/unit/intake-draft-service-pending.test.js` (NEW) | 26 cases |
| `tests/unit/intake-upload-token-endpoint.test.js` (NEW) | 50 cases |
| `tests/unit/intake-attach-endpoint.test.js` (NEW) | 61 cases |
| `tests/unit/intake-submit-pending-guard.test.js` (NEW) | 4 cases |
| `tests/unit/intake-pending-sweep.test.js` (NEW) | 16 cases |
| `.claude-memory/feedback-real-fix-not-design-note.md` (NEW) | User pushback rule |
| `.claude-memory/project-codex-design-pre-impl-iteration.md` (NEW) | The iteration pattern |

### Materially edited this session

| File | Change |
|---|---|
| `CLAUDE.md` | intake-draft-service entry expanded; 4 new utility classes; database schema row; Extended Docs pointer; route count 91 → 93 |
| `docs/API_ROUTE_SECURITY_MATRIX.md` | 2 new rows (upload-token + attach); count 91 → 93 |
| `docs/CANONICAL_COUNTS.md` | api-route-file-count 91 → 93 |
| `docs/INTAKE_PORTAL_DRAIN_PLAN.md` | A1-A7 callout + line-by-line reconciliation of three-call dance section |
| `docs/atlas/postgres-infra-tables.md` | intake_drafts row mentions pending_attachments + 2h sweep |
| `docs/INTAKE_ATTACH_BUILD_SCOPING.md` | Codex round-1 + round-2 fold-ins; `cutoffIso` rename |
| `scripts/setup-database.js` | pending_attachments in CREATE TABLE + idempotent ALTER + COMMENT |

## Testing

```bash
# Run all gates pre-stop (all green):
npm run check:atlas                       # 30 PG / 32 DV ✓
npm run check:atlas:self-test             # 12/12 patterns ✓
npm run check:api-routes                  # 93 routes ✓ (up from 91)
npm run check:fact-consistency            # ✓
npm run check:prompt-injection-tagging    # 24 migrated, 0 pending ✓
npm run check:canonical-pointers          # 9 pointers ✓
npm run check:drain-table-mentions        # ✓
npm run check:prompt-storage-mentions     # ✓

# Run the full intake-attach test surface:
npx jest tests/unit/intake-               # ~250 cases ✓
```

## Open Items (architectural, non-blocking)

- **The endpoints are LIVE but no UI calls them yet** — chunks 4-5
  ship the API; the form-side rewrite to the three-call pattern is
  the next big build (Next Step #2).
- **No integration tests for the actual SQL** — chunk 3's
  `promoteToClean` cardinality gate's atomicity is unit-tested only
  via mocks. Real-PG EvalPlanQual behavior is documented Postgres
  semantics, but a real integration test would close the last gap.
  Not blocking pilot; worth doing post-launch.
- **A1 guard non-fire tests are weak scaffolding** (pg.Pool not
  mocked). Full `/api/intake/submit` endpoint test suite is a
  separate session of work; flagged in chunk-6 Codex post-impl review.
- **Audit-failure invisibility** — `sweepIntakePending` uses fire-and-
  forget audit writes; a persistent `intake_audit` outage produces
  clean-looking sweep results. Matches the broader best-effort audit
  contract; noted but no action taken.
