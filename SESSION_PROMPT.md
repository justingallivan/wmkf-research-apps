# Session 180 Prompt: Drain endpoint build (P4 → /api/intake/submit → /api/cron/drain-submissions)

## Session 179 Summary

A very large session: the drain plan v3 from S178 went through five more
Codex review rounds (v4→v7) and then transitioned **plan-to-code**.
Five of the six prerequisite pieces (P0/P1/P2/P3/P5) landed in this
single session. Only P4 (manual Vercel Blob provisioning) remains
before the drain endpoint code itself can be built.

### What Was Completed

1. **Drain plan v4 → v7** (9 review rounds total across S178+S179, 5 of
   them in S179). Convergence trail on real artifacts: 21 → 11 → 4 →
   stalled → 2 → 4 → 5 → 3 → 2 → 3 → 4. Each round caught real signal;
   no false-positive churn. The Codex-review pattern that worked:
   broker-driven (rescue subagent) is unreliable on multi-question
   reviews; **local-terminal Codex** is dramatically faster (~30s) and
   never stalled in S179.

2. **P0 — `submission_jobs` schema migration.** Migration
   `011_submission_jobs_states.sql` adds the `request_created` state,
   `akoya_requestnum`, `locked_until`, `lease_token` columns, and
   rekeys the partial-unique index to `(contact_oid, account_id,
   form_key)`. Mirrored in `setup-database.js` v30 inline block. Fully
   idempotent (`IF EXISTS`/`IF NOT EXISTS` everywhere, including the
   `DROP CONSTRAINT`). Dev-Neon applied; smoke verifies all three new
   columns + new indexes + old indexes dropped.

3. **P3 — `intake_drafts` requestless-uniqueness rekey.** Migration
   `012_intake_drafts_uniqueness.sql` swaps the requestless partial-
   unique to `(contact_oid, account_id, form_key)`. Service patch in
   `intake-draft-service.js` (upsert ON CONFLICT + `getByKey` now
   requires `contactOid` on the requestless branch). Smoke test
   expanded — 22 → 23 ✓ green.

4. **P5 — `wmkf_apprequestperson.wmkf_role` picklist verification.**
   All 5 values present in prod (`Senior Personnel` /
   `Key Personnel` / `Other` added during the S178 deploy; not
   separately tracked at the time). Live-data probe re-confirmed
   CLEAR (5,561 rows, none in 100000002-4).

5. **P2 — `contact.wmkf_portaloid` deployed to prod Dataverse.** Added
   the column (String 50, nullable, schema `wmkf_PortalOid`) and
   alternate key `wmkf_portaloid` via
   `apply-dataverse-schema.js --wave=4-followup`. The `parseArgs`
   parser was extended to accept string-suffixed wave names.
   Naming reconciled: v7 draft `wmkf_portal_oid` →
   deployed `wmkf_portaloid` (matches the S178 no-internal-underscore
   convention). Alt-key `EntityKeyIndexStatus` was `Pending` at
   verification time; transitions to `Active` over a few minutes.

6. **P1 — Structured-error shape across services.** New
   `lib/utils/service-error.js` with `buildServiceError` +
   `buildNoResponseError`. Wired into every drain-dependent throw site
   in `dynamics-service.js` and `graph-service.js`. `fetchWithTimeout`
   in both files now wraps every network throw automatically.
   Errors carry `.status`, `.serviceName`, `.dataverseCode`,
   `.dataverseMessage`, `.isTransient`, `.noResponse`, `.causeKind`.
   Round-11 added an `options.isTransient` override so config-bug
   throws (missing env vars) terminal-fail instead of being retried.
   21 tests; full unit suite 612 ✓ / 0 failures. 412-aware callers
   verified preserved.

### Commits (S179, `main`, 14)

| Hash | Description |
|---|---|
| `b8c1a96` | Drain plan v4: fold Codex round-3 + round-4 self-narration |
| `8fadfb8` | Drain plan v5: fold round-5 (lease-token + Graph site/drive) |
| `ed32e94` | Drain plan v6: fold round-6 (cron registration + 3 spec gaps) |
| `f24cae4` | Drain plan v7: fold round-7 (5 GAPS, narrow delta sanity check) |
| `050ab85` | P0: submission_jobs schema migration for drain plan v7 |
| `bfadb63` | P0 round-8 fold: idempotent migration + setup-database contract + atlas |
| `8d3047d` | Drain plan v7 round-9 fold: P0 apply runbook + SQL snippet sync |
| `ad6a511` | P3: intake_drafts requestless-uniqueness rekey + service patch |
| `4150a7e` | P5 verified: wmkf_apprequestperson.wmkf_role picklist fully expanded in prod |
| `9a49ce2` | P2 deployed: contact.wmkf_portaloid + alternate key on prod |
| `ac73abd` | P3+P2 round-10 fold: document with-request branch, broaden smoke, reserve wmkf_portaloid |
| `bb29283` | P1: structured-error shape across dynamics + graph services |
| `afa61fb` | P1 round-11 fold: 408-transient, no-double-wrap, isTransient override, getDriveId miss |
| (this commit) | Document Session 179 and create Session 180 prompt |

## Prerequisite checklist (where we are)

| Prereq | Status | Notes |
|---|---|---|
| P0 — submission_jobs schema | ✅ committed; dev-Neon applied | Prod-Neon apply per the v7 runbook is pending |
| P1 — structured-error shape | ✅ committed; 612 unit tests green | |
| P2 — contact.wmkf_portaloid | ✅ deployed to prod | Alt-key Pending → Active (re-probe before relying on uniqueness) |
| P3 — intake_drafts uniqueness | ✅ committed; dev-Neon applied; smoke 23 ✓ | Prod-Neon apply pending |
| P5 — wmkf_role picklist | ✅ verified in prod | |
| **P4 — private Blob store** | **⏳ remaining** | **Manual Vercel CLI provisioning** |

## Potential Next Steps

### 1. P4 — Provision the private Blob store (~15-30 min, Justin's hands)

The drain's `files_moved` state reads applicant attachments from a
**private** Vercel Blob store (separate from the shared public
`phase-ii-summaries-blob`). Mirrors the Dataverse Export `DVX_BLOB_RW_TOKEN`
pattern documented in CLAUDE.md.

Manual steps (Vercel CLI gotcha: 2nd Blob store can't be connected under
a custom env-var name via CLI — must read token from dashboard):

```bash
vercel blob store add intake-applicant-private --access private
# Then read the token from the Vercel dashboard:
vercel env add INTAKE_BLOB_RW_TOKEN <token> production preview development
```

Update `docs/CREDENTIALS_RUNBOOK.md` with the new env-var entry.

Once P4 lands, all 6 prereqs are done and drain endpoint code itself
can begin.

### 2. Apply P0 + P3 migrations to prod Neon

Per v7 P0's Apply Mechanism subsection, dev-then-prod:

```bash
psql "$PROD_DATABASE_URL" -f lib/db/migrations/011_submission_jobs_states.sql
psql "$PROD_DATABASE_URL" -f lib/db/migrations/012_intake_drafts_uniqueness.sql
```

Both migrations are idempotent. Verify post-apply:

```bash
psql "$PROD_DATABASE_URL" -c "\d submission_jobs" | grep -E 'akoya_requestnum|locked_until|lease_token'
psql "$PROD_DATABASE_URL" -c "SELECT indexname FROM pg_indexes WHERE tablename='intake_drafts';"
```

### 3. Begin drain-endpoint build

With all prereqs landed, the next code piece is `/api/intake/submit`
(applicant submits → INSERT submission_jobs + populate
intake_drafts.request_id in same txn → return 200 with {jobId,
requestId, status}; on terminal collision return 409
`previous_submission_terminal`).

Then `/api/cron/drain-submissions` (the state machine). Register the
cron in `vercel.json` **in the same commit as the route file**
(per v7 round-7 §5 — register-before-route schedules 404s).

Plan sections to consult: `INTAKE_PORTAL_DRAIN_PLAN.md` §6 (the 7-state
machine), §"Error taxonomy" (the classifier the structured errors feed),
§"Duplicate-PK recovery in `request_created`" (the lease-token guarded
recovery code).

### 4. Connor Q1-Q4 email (still parked from S178)

Plan §"Connor questions (sharpened)" has the 4 asks. Q1 is the most
load-bearing (which source picklist field + integer + label for the
post-submit status). Q4 needs the exact Option A′ condition expression
+ P4 evidence artifacts. Drain build can scaffold through
`dynamics_patched` without these; only `status_flipped` waits.

### 5. Codex round 12 on the v8-or-final plan posture

Diminishing returns territory but plausibly worthwhile after some build
shipping. Round 11 was the most refined yet (4 MOD / 0 BLOCKER on the
largest code surface). Don't run review for review's sake — only when
there's a substantive new artifact (e.g., drain endpoint code).

## Key Files Reference

| File | Purpose |
|---|---|
| `docs/INTAKE_PORTAL_DRAIN_PLAN.md` | v7 working plan — covers state machine, error taxonomy, apply runbook, idempotency, child payloads |
| `docs/INTAKE_PORTAL_SCHEMA_CHANGES.md` | Catalog (newest entry: S179 P2 contact column + alt-key) |
| `lib/db/migrations/011_submission_jobs_states.sql` | P0 — applied dev; prod pending |
| `lib/db/migrations/012_intake_drafts_uniqueness.sql` | P3 — applied dev; prod pending |
| `lib/dataverse/schema/wave4-followup/contact-portal-oid.json` | P2 — deployed prod |
| `lib/utils/service-error.js` | P1 helpers; the drain classifier's contract |
| `lib/services/dynamics-service.js` | P1 wired; 5 throw sites + fetchWithTimeout |
| `lib/services/graph-service.js` | P1 wired; 4 throw sites + fetchWithTimeout |
| `lib/services/intake-draft-service.js` | P3 patched; upsert + getByKey contact-scoped |
| `scripts/setup-database.js` | v26 + v30 inline blocks aligned with migrations 011/012 |
| `scripts/smoke-intake-draft.js` | 23 ✓ smoke test for the draft service |
| `scripts/apply-dataverse-schema.js` | parseArgs accepts string-suffixed waves |
| `scripts/probe-apprequestperson-role-data.js` | Re-runnable picklist data probe |
| `scripts/extend-apprequestperson-role-picklist.mjs` | Re-runnable picklist extender (idempotent) |
| `tests/unit/error-shape.test.js` | 21 tests; the contract Codex hammered in round 11 |
| `vercel.json` | NO cron for drain-submissions yet — lands with the route file (per v7 §5) |

## Open Items (architectural, non-blocking)

- **Tuition cap rule** — fixed-$ vs %-of-budget decision (TBD), parked
  in `BUDGET_FORM_SPEC.md`. Validation rule only.
- **`status_flipped` target value** — depends on Connor Q1; the drain
  can scaffold through `dynamics_patched` without it.
- **Alt-key `wmkf_portaloid` index state** — `Pending` at S179 deploy;
  re-probe before drain code relies on Dataverse-side uniqueness
  enforcement (the auth bridge isn't building yet so not blocking).
- **Tail items from earlier sessions** — Wave 1 elevation revert
  on the prod app user (deferred); W6 reviewer Postgres drain-only
  tables (one-shot DELETE + DROP, fire ≥ 2026-07-01).

## Codex Review Strategy (refined this session)

- **Local-terminal Codex is the default for non-trivial reviews.**
  Broker-driven (rescue subagent) stalled on round 4 (14 min, no
  findings) but local hit 30s on rounds 5-11. 5 local rounds in S179,
  zero failures.
- **Run review only after substantive artifacts.** Round 10 (P3+P2)
  found 1 MOD + 2 LOW; round 11 (P1, largest surface) found 4 MOD / 0
  BLOCKER. Code reviews are paying off; further plan-doc reviews are
  diminishing returns.
- **Prompts: 5 narrow questions, ≤10 min time-box, file:line anchors,
  CLEAN-allowed verdicts.** This is what's been working.

## Testing

```bash
# Verify everything from S179 is still green:
npm run check:atlas
npm run check:atlas:self-test
npm run check:api-routes
npm run check:fact-consistency
npm run check:memory-drift:no-write

# Unit tests (P1 + the rest):
npx jest tests/unit                  # 612 ✓

# P3 smoke (requires dev Neon migration applied):
node scripts/smoke-intake-draft.js   # 23 ✓

# P5 re-probe (live Dynamics; read-only):
node scripts/probe-apprequestperson-role-data.js
node scripts/extend-apprequestperson-role-picklist.mjs

# P2 alt-key state re-probe — if it's still Pending after a few hours,
# something's wrong; the auth bridge build is gated on Active.
```
