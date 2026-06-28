# Reviewer Finder → Dataverse Cutover: Outstanding Work

> **Status banner (2026-05-19):** Workstreams **2a** (Review Manager `/reviewers` GET/PATCH) and **2b** (`send-emails` Dataverse migration) **SHIPPED in W3–W6 / S164**. Both `pages/api/review-manager/reviewers.js` and `pages/api/review-manager/send-emails.js` are now Dataverse-backed, and the Postgres `grant_cycles` table is drain-only (post-W3 cutover 2026-05-12). Workstream 1 (contact promotion at first invitation) and Workstream 3 (historical backfill) — re-verify before treating either as outstanding; the contact-promotion hook appears wired in `send-emails.js` per the W5 docstring. The 2026-04-30 narrative below describes the pre-cutover state and is retained for historical context.

**Status as of 2026-04-30:** Reviewer Finder is fully Dataverse-backed for save and read paths. Postgres still receives dual writes from `save-candidates.js` and remains the source of truth for the rest of the reviewer lifecycle (Review Manager UI). This document covers the three workstreams that finish the migration and the historical backfill.

## Current state

| Concern | Postgres | Dataverse |
|---|---|---|
| Save new candidates | Source of truth | Dual-write target |
| My Candidates GET/PATCH/DELETE | (unused) | Source of truth |
| Review Manager `/reviewers` GET/PATCH | Source of truth | (unused) |
| Review Manager send-emails | Source of truth | (unused; sender resolution only) |
| Review Manager upload-review | Source of truth | (unused) |
| Lifecycle timestamps (`materials_sent_at`, `reminder_sent_at`, etc.) | Source of truth | Field schema exists, not written by Review Manager |
| `wmkf_contact` link on potentialreviewer | n/a | **Never set** (promotion path not hooked up) |
| Pre-J26 historical rows | 333 rows | 0 rows |

## Workstream 1 — Contact promotion at first invitation

**Why:** Foundation-visible value. Today, `wmkf_potentialreviewers.wmkf_contact` is always null. When staff first reaches out to a reviewer, that person should be promoted to a real CRM `contact` so they show up in standard CRM workflows (relationship history, future communications, etc.). The adapter already has `setContactLink(potentialReviewerId, contactId)`; needs to be wired into the send flow.

**Scope:** narrow add-on. Doesn't depend on the bigger Review Manager migration — runs as a side effect of any send.

**Implementation:**

1. **Add `find-or-create contact by email`** to `lib/services/dynamics-service.js` (or new `lib/dataverse/adapters/contact.js`):
   - Query `contacts` by `emailaddress1 eq <email>` — return existing if found.
   - Otherwise create a new contact with `firstname`, `lastname`, `emailaddress1`. Pull names from the linked `wmkf_potentialreviewers` row.

2. **Add `lookupPotentialReviewerByEmail`** lookup so `send-emails.js` can find the person row from the recipient email. (Already exists as `getByEmail` on the adapter.)

3. **Hook into `pages/api/review-manager/send-emails.js`** — after a successful `createAndSendEmail` call, in the lifecycle update block:
   - For each successfully-sent recipient, look up `potentialreviewer` by email.
   - If found and `_wmkf_contact_value` is null:
     - Find or create the CRM contact.
     - Call `potentialReviewer.setContactLink(prId, contactId)`.
   - Failures are non-fatal — log and continue (email already sent).

4. **Smoke test**: send a real email to a J26 reviewer, verify contact is created and linked.

**Adapter additions:**
- `lib/dataverse/adapters/contact.js` (new): `findByEmail(email)`, `createMinimal({ firstName, lastName, email })`.

**Files touched:** `lib/dataverse/adapters/contact.js` (new), `pages/api/review-manager/send-emails.js`.

**Risks:**
- Promoting one PD's reviewer pollutes the org-wide contacts table for everyone. Confirm Foundation's policy on contact provenance — may want a `wmkf_source = 'reviewer-finder'` tag.
- Existing J26 invitations that already went out won't trigger promotion (no historical fix). One-shot backfill could promote prior invitees from `reviewer_suggestions` rows where `email_sent_at IS NOT NULL`.

**Estimated effort:** half a session.

---

## Workstream 2 — Full Review Manager Dataverse migration

**Why:** Today `my-candidates.js` reads from Dataverse but `review-manager/reviewers.js` reads from Postgres. New picker-saved candidates exist in both (dual-write). Older Postgres-only candidates exist only in Postgres. Once Postgres dual-write is removed, Review Manager goes blind. To remove the dual-write safely, Review Manager must read from Dataverse first.

**Scope:** roughly twice the my-candidates work. Touches three endpoints + their UI consumers.

### 2a. `/api/review-manager/reviewers` (read + status PATCH) — ~60% of effort

**GET shape:** today returns "accepted" reviewers grouped by proposal. In Dataverse-speak: suggestions where `wmkf_accepted = true` (or `wmkf_reviewstatus` indicates accepted state). Same PD-default scope as `my-candidates`, with `?requestId` / `?requestNumber` collaborator override.

**PATCH:** today writes `review_status`, `notes`, `proposal_url`, `proposal_password`, `materials_sent_at`, `reminder_sent_at`, `review_received_at`, `thankyou_sent_at`, `review_blob_url`, `review_filename`. All these fields exist on `wmkf_appreviewersuggestion` already (per our adapter's `FIELD_SELECT`). Map to `updateLifecycle` calls.

**Adapter additions:**
- `reviewer-suggestion.findAcceptedByPD(systemUserId, { cycleCode })` — same as `findByPD` but adds `wmkf_accepted eq true` to the suggestion filter.
- Extend `updateLifecycle` map (already covers most fields; check parity).

**Files touched:** `pages/api/review-manager/reviewers.js` rewrite; `lib/dataverse/adapters/reviewer-suggestion.js` extension.

### 2b. `/api/review-manager/send-emails` migration

**Today:** pulls recipient data from Postgres `reviewer_suggestions` join `researchers`, sends email, updates Postgres lifecycle timestamps.

**After:** pulls recipient data from `wmkf_appreviewersuggestion` joined to `wmkf_potentialreviewers`. Lifecycle timestamps update via `suggestionAdapter.updateLifecycle`. Includes Workstream 1 (contact promotion).

**Important:** `drafts[]` body has `suggestionId` typed as `number` today (line 90 type guard); after cutover, it's a Dataverse GUID. UI consumers send what the API gives them, so this should flow naturally — but the type guard needs relaxing.

**Files touched:** `pages/api/review-manager/send-emails.js` rewrite.

### 2c. `/api/review-manager/upload-review` migration

**Today:** uploads file to Vercel Blob, then writes `review_blob_url`, `review_filename`, `review_received_at`, `review_status = 'complete'` to Postgres `reviewer_suggestions`.

**After:** same blob upload, but writes the lifecycle fields to Dataverse via `suggestionAdapter.updateLifecycle`.

**Files touched:** `pages/api/review-manager/upload-review.js` rewrite.

### 2d. `/api/review-manager/render-emails`

Preview-only, no DB writes — but it does pull recipient data from Postgres to fill in templates. Migrate the read source to Dataverse so previews match what send-emails will use.

**Files touched:** `pages/api/review-manager/render-emails.js` light edit.

### 2e. UI sweep

`pages/review-manager.js` consumes these endpoints. The UI shape stays mostly identical (we keep the same JSON keys), but `suggestionId` becomes a GUID. Search the UI for any int-coerce logic on suggestion IDs and remove. Also review any Postgres-FK assumptions (`grant_cycle_id` → `grantCycleCode`).

**Estimated effort:** 1.5–2x the my-candidates session.

**Risks:**
- Postgres-only historical Review Manager state (rows from before save-candidates dual-write) will be invisible until the Workstream 3 backfill runs. If users currently have in-flight reviews from before the cutover, those need backfilling first or the migration breaks them.
- Field parity — verify every Postgres lifecycle field has a Dataverse equivalent. `proposal_password` and `proposal_url` are on the suggestion already (`wmkf_proposalpassword`, `wmkf_proposalurl`); confirm.

---

## Workstream 3 — Postgres → Dataverse historical backfill

**Why:** 333 rows exist in Postgres `reviewer_suggestions` from Reviewer Finder usage prior to the picker entry path. After Workstream 2, the Review Manager UI shows only Dataverse data; historical reviewers become invisible without a backfill. Also nice for organizational visibility (CRM dashboards) regardless of Review Manager.

**Scope:** mechanical migration. No new code surface; just a one-shot script.

**Implementation:**

1. **Build `scripts/backfill-postgres-to-dataverse.js`** — read each Postgres row, run through the same three adapter calls `save-candidates.js` does:
   - `potentialReviewer.upsertByEmail` (will hit the existing-row-fill-empty path for any duplicates).
   - `researcher.upsertByPotentialReviewer`.
   - `reviewerSuggestion.upsert`.
2. **Map Postgres FK fields to Dataverse:**
   - `grant_cycle_id` → derive cycleCode via `grant_cycles.short_code`.
   - `proposal_id` (Postgres string) → resolve to `akoya_request` GUID by `request_number`. Postgres rows missing `request_number` can't be backfilled (skip + report).
3. **Backfill lifecycle state too** — historical rows have `materials_sent_at`, `review_status`, etc. populated; preserve via `updateLifecycle` after upsert.
4. **Idempotent**: re-running the script should be a no-op for already-backfilled rows (the `(potentialreviewer, request)` upsert handles that).
5. **Dry-run mode first**: report which rows can/can't be migrated without writing.

**Files touched:** `scripts/backfill-postgres-to-dataverse.js` (new). No production code changes.

**Estimated effort:** ~half a session. Mostly data shape mapping and validation.

**Risks:**
- Some Postgres rows may have no `request_number` (legacy Phase II uploads pre-CRM-link). Those can't be located on a Dataverse request — skip and report; possibly archive separately.
- Email-only dedup: if the Foundation has multiple historical entries for the same person across cycles, the upsert path fills empty fields only — reviewer-history-style data quality issues persist.

---

## Recommended order

1. **Workstream 3 (backfill) first.** Surface historical data into Dataverse before flipping any Review Manager reads. This way Workstream 2 can launch with full data on day one, no users left blind.
2. **Workstream 2 (Review Manager migration).** Brings the rest of the reviewer lifecycle into Dataverse.
3. **Workstream 1 (contact promotion)** can land as part of 2b (send-emails migration) for free, or before/after — it's independent.

If you'd rather deliver user-visible value sooner: **Workstream 1 first** (small, isolated win), then 3, then 2.

## Cleanup at the end

After all three are done and validated:
- Remove the dual-write block from `pages/api/reviewer-finder/save-candidates.js` — write only to Dataverse.
- Drop or archive Postgres tables: `reviewer_suggestions`, `researchers`, `grant_cycles`, `proposal_searches`, `researcher_keywords`, `researcher_publications`. Keep a snapshot.
- Remove `cycleId` (numeric) and `userProfileId` query params from UI calls.
- Drop legacy "create cycle and assign all unassigned" UI flow (moot in the new world; cycles bake at save time).

## Validation checklist (each workstream)

- [ ] Build clean (`npx next build`)
- [ ] Smoke script confirms data shape against test request 1002379 (Quantum Chimera)
- [ ] Browser real-auth flow exercised end-to-end
- [ ] No Postgres reads/writes remain in the migrated endpoint (grep for `from '@vercel/postgres'` / `import { sql }`)
- [ ] Per-candidate failure isolation preserved (one bad row doesn't fail the batch)
- [ ] `bypassRestrictions('<endpoint-name>')` called once at handler entry

## Hand-off context (carry over if resuming in a fresh session)

- **Adapters live in:** `lib/dataverse/adapters/{potential-reviewer,researcher,reviewer-suggestion}.js`
- **PD resolver:** `lib/services/program-director-resolver.js` (`resolveByEmail(azureEmail)`)
- **Cycle helpers:** `lib/utils/cycle-code.js` (`meetingDateToCycleCode`, `cycleCodeToOdataFilter`, `cycleCodeToLabel`)
- **Test data:** request `54e2b88b-04b9-f011-bbd3-6045bd02b4cc` (Quantum Chimera, J26) has 4 saved suggestions with full bibliometric chain — use this for smoke tests.
- **Smoke scripts:** `scripts/smoke-{recent-suggestions,suggestions-by-request,find-by-name,my-candidates}.js`
- **`bypassRestrictions` is mandatory** at handler entry — `DynamicsService` fails closed otherwise. Forgetting this is a common bug class.
- **`akoya_title` is the proposal title field**, not `akoya_name`. `akoya_requestnum` is the request number, not `akoya_requestnumber`.
- **Field-length cap on `wmkf_potentialreviewers.wmkf_organizationname` is 100 chars** — clamp truncates with ellipsis. Researcher's `wmkf_primaryaffiliation` is uncapped.
