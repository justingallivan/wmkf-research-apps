---
title: Reviewer Lifecycle Stage 5 — narrow document-pointer and thank-you operations
kind: plan
domain: reviewer-workbench
status: active
canonical: false
owner: product-engineering
last_verified: 2026-09-05
summary: Two narrow ETag-required adapter operations replace the generic receipt passthrough at the DOCX-pointer and thank-you-claim sites; optional helper skipped.
---

# Stage 5 — narrow document-pointer and thank-you operations

**Architect:** Claude (S489, owner autonomy grant 2026-09-05). **Builder:** Sonnet. **Reviewer:**
Opus. **Adversarial:** Codex ≤2 rounds, on the build. **Tier:** 1 (adapter + two services, contracts
unchanged) — branch `claude/reviewer-lifecycle-stage5` from `main`, PR. **Source of scope:**
refactor report §Stage 5 change order (1); the readiness audit rows "5 — narrow document-pointer and
thank-you operations" and "5 — shared receipt-persistence helper (optional)".

## Today [VERIFIED via source on main `5e49be66`]

`lib/dataverse/adapters/reviewer-suggestion.js:1370` `patchReviewReceipt(suggestionId, payload,
opts)` is a documented passthrough to `DynamicsService.updateRecord` with no field whitelist and no
excluded-row guard; `patchFields` (`:1382`) is the same function under a second name. Callers
outside the adapter:

| Caller | Purpose | Stage |
|---|---|---|
| `lib/services/review-documents/individual-file-service.js:652–663` `commitPointers` → `patchReviewReceipt(id, { wmkf_reviewsharepointfolder, wmkf_reviewfilename }, { ifMatch })` (one site in a two-attempt loop) | completed-review DOCX pointer, conditional write + readback + retry | **5A** |
| `lib/services/reviewer-thankyou-sweep.js:85–92` → `patchReviewReceipt(id, { wmkf_thankyousentat }, { ifMatch: row._etag })`; fails closed when `_etag` missing (`:63`) | thank-you courtesy claim before send | **5A** |
| `lib/services/review-manager/mark-received-no-file-service.js:122`; `lib/services/review-upload.js:293` | receipt producers (no-file, upload) | 5B (optional helper) — **skipped**, see below |
| `lib/services/reviewer-suggestion-sweep.js:150` `patchFields` | fixed conditional expire | Stage 3E |
| `lib/services/reviewer-finder/generate-emails-service.js:501` `patchFields` | legacy mark-as-sent stamp | Stage 3 expansion row 6 |

Both 5A operations must remain legal after receipt / Complete (refactor report: "never put 'no
existing receipt' on document attachment or courtesy claim"); the composed test
`tests/integration/reviewer-engagement-contract.test.js:351` already exercises pointer + thank-you
on a completed review and rejects a second receipt.

## 5A change

In `reviewer-suggestion.js`, add two named operations next to `patchReviewReceipt`:

```js
export async function attachReviewDocumentPointer(suggestionId, { folder, filename }, { ifMatch, ...opts })
  // payload = { wmkf_reviewsharepointfolder: folder, wmkf_reviewfilename: filename }; requires a
  // non-empty string ifMatch (throws adapterError 400 'missing_version' otherwise); no other fields.
export async function claimThankYou(suggestionId, sentAtIso, { ifMatch, ...opts })
  // payload = { wmkf_thankyousentat: sentAtIso }; requires ifMatch the same way.
```

Both call the same `DynamicsService.updateRecord(ENTITY_SET, id, payload, { ifMatch, ...opts })`
transport as today — byte-identical request shape, so the 412 behavior the callers depend on
(`commitPointers` retry/readback; sweep `claimFailed++`) is unchanged. No excluded-row read is added
(the pointer and thank-you paths run after receipt; the report keeps these as legitimate specialized
operations, and adding a pre-read would change the call count the contract test observes — verify
before deciding otherwise).

Callers: `individual-file-service.js` uses `attachReviewDocumentPointer` at both sites;
`reviewer-thankyou-sweep.js` uses `claimThankYou`. `patchReviewReceipt`/`patchFields` stay exported
(Stage 7 narrows them after the remaining callers migrate).

**Missing-version policy:** both callers already supply an ETag (`current._etag`, `row._etag`) and
the sweep already fails closed on a missing one, so requiring `ifMatch` codifies current behavior
rather than tightening it. [VERIFIED for the sweep at `:63`; the pointer path's `current._etag`
comes from `rereadPointer` → `getSuggestionById(id, select)` (`:645–650`), a Dataverse read that
returns `_etag` on every row — builder confirms in `individual-review-file-service.test.js` fixtures
and adds the missing-ETag case as a fail-closed test if none exists.]

## 5B decision — skip the shared receipt helper (recorded)

The four receipt producers differ in version requirement (external legacy `setVersion` optional,
staff manual mandatory), data completeness (no-file partial/empty) and file specificity (upload).
The readiness audit already marks the helper optional with "narrow input design required if
selected". No caller has changed since; the benefit is not established. **Skip**, as the refactor
report permits, and record the skip in the receipt. Stage 7 narrows `patchReviewReceipt` only after
the no-file and upload producers get their own named operations, which becomes the first Stage 7
prerequisite rather than a Stage 5 helper.

## Tests

- New `tests/unit/reviewer-suggestion-receipt-ops.test.js`: each op sends exactly its payload and
  forwards `ifMatch`; missing/empty `ifMatch` throws before any transport call; extra payload keys
  cannot be smuggled (signature does not accept them).
- Existing pins stay green and unchanged: `tests/integration/reviewer-engagement-contract.test.js`
  (`:351` completed-review case), `tests/unit/reviewer-thankyou-sweep.test.js`,
  `tests/unit/send-review-thankyous-cron.test.js`, `tests/unit/notification-trust-model-pushup.test.js`,
  `tests/unit/individual-review-file-service.test.js`, `tests/unit/file-review-docx-cron.test.js`,
  `tests/unit/review-docx-repair-service.test.js`, `tests/unit/review-docx-backfill-service.test.js`,
  `tests/integration/reviewer-engagement-races.test.js`.
- Mutation checks: (a) drop the `ifMatch` requirement → op test red; (b) add a stray field to the
  pointer payload → op test red; (c) route the sweep back through `patchReviewReceipt` → the
  census test from Stage 3A (extended to these two ops) red.
- Slice exit: retained selection + full suite, types, lint, build, `check:dataverse-access-layer`
  (new adapter exports — check whether the ratchet counts named exports), `check:request-document-writers`
  (touches the review-document pointer path — run it), `git diff --check`.

## Build record

- **Build (Sonnet, 2026-09-05) — stopped once for an architect decision, correctly.** The adapter
  ops, both caller edits and the new op test were built per §5A; the pointer path's ETag provenance
  was verified (`@odata.etag → _etag` on every read via `lib/services/dynamics/annotations.js:23–26`;
  all pointer fixtures carry `_etag`). Two pinned unit suites (`individual-review-file-service`,
  `reviewer-thankyou-sweep`) replace the adapter module with hand-built mock objects exposing only
  `patchReviewReceipt`, so the new op names resolved to `undefined` and 12 assertions failed
  silently through the callers' own catch blocks; the real-transport pins
  (`reviewer-engagement-contract` `:351`, `-races`) passed unchanged. **Architect decision:** those
  mocks are test infrastructure, not behavior pins — add one forwarding shim per mock (no assertion
  changed) and record the edit. Plan corrections from the build: `commitPointers` has ONE call site
  executed up to twice (not "2 sites"); the census helper matches module specifiers, not named
  exports, so mutation (c) cannot be caught by the census — its outcome is recorded honestly rather
  than manufactured. `check:dataverse-access-layer` is a violation detector with no export-count
  ratchet, so new named exports do not trip it.

## Review checkpoints

Opus: confirm byte-identical transport call per site; confirm the pointer path's ETag provenance;
confirm no pre-read was introduced. Codex round 1 on the build; round 2 only for a confirmed defect.

## Docs (after merge)

Readiness audit rows 5 (both) → complete / skipped-recorded; Atlas page
`docs/atlas/dataverse-wmkf-appreviewersuggestion*` only if a write path description names the
generic patch (grep); service catalog; receipt `docs/audits/REVIEWER_LIFECYCLE_STAGE5_RECEIPT_<date>.md`.
