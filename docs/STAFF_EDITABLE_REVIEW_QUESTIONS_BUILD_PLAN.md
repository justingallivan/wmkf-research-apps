# Staff-Editable Review Questions — Build Plan

**Status:** IN PROGRESS — scoped + Codex-reviewed S303 (2026-06-29) from `REVIEWER_REVIEW_FORM_AUTHORING_BUILD_PLAN.md` §0 #6 (the deferred staff-editable-questions phase, now eligible because the authoring flow shipped). **Phase A artifacts built + Codex-reviewed S303** (entity spec, fetcher + 18 unit tests, seed, Atlas — commit `f06316bb` + the P1/P2 fixes); prod `--execute` create + seed are the gated next step. Phases B–E not started. Codex design-review findings folded in (see §11); the Phase-A P0 (missing `primaryNameAttribute`) is resolved in §2. Owner decisions captured below (S303).

**Codex correction (S303):** the parent-rating-column reader fan-out was re-verified by literal-column grep. `virtual-review-panel.js` and `dataverse-export/preview.js` do **NOT** read `wmkf_reviewer{impact,risk,overallrating}` (they matched an unrelated "average/aggregate" term search in the initial scoping pass) — they are removed from the §6 reader list. `ReviewerManagePanel.js:977-979` (a DTO consumer) was missed and is added. Net: the retirement fan-out is smaller and has no LLM-prompt/export dependency.

**Date:** 2026-06-29

---

## 0. Owner decisions (S303)

1. **Editable scope = everything, fully variable.** Staff add/remove/reorder/edit *all* questions, including the rating (picklist) questions — not just the narrative rich-text ones. (Chosen over "narrative-only" and "narrative + rating labels".)
2. **System of record = a new Dataverse entity** (`wmkf_reviewquestion`), edited via the admin panel, read through a cached fetcher mirroring `PolicyFetcher`. (Chosen over a Postgres table — matches the §0 #6 intent, the `wmkf_policy` precedent, and Connor's Dataverse→Excel workflow.)
3. **Live edit; the snapshot protects history.** Edits take effect immediately. The `wmkf_appreviewanswer` snapshot already captures question-text-as-asked per submitted review, so past reviews are never disturbed. In-flight drafts reconcile to the current set on next load (stable keys; removed questions drop, added appear empty). No draft/publish version machinery. (Chosen over policy-style draft/publish versioning.)
4. **All ratings move to the snapshot; retire the parent rating columns.** Stop using `wmkf_reviewerimpact/risk/overallrating` as the system of record for ratings; ALL ratings (core + any new) live in the `wmkf_appreviewanswer` child snapshot (`wmkf_answervalue` + label in `wmkf_answertext`). Connor pivots/averages from the child table. **The external (Connor/reporting) gate is RESOLVED (S303)** — see §7; only the internal reader migration still orders the retirement.

---

## 1. The architectural spine

**Today** [VERIFIED via source, S303] `lib/external/review-form-schema.js` exports a hardcoded `reviewFormSchema.fields` array, **statically imported** by 8 consumers:

| Consumer | Uses |
|---|---|
| `shared/components/external/ReviewFormFields.js` | walks `reviewFormSchema` (legacy upload form) |
| `shared/components/external/ReviewAuthoringForm.js` | walks `reviewFormSchema` (in-browser authoring) |
| `shared/components/workbench/ReviewsTab.js` | `labelForReviewRating`, `reviewRatingShortLabels` |
| `pages/api/external/review/[token]/draft.js` | schema-key whitelist + sanitize |
| `pages/api/external/review/[token]/submit.js` | full-form validation/build |
| `pages/api/external/review/[token]/context.js` | prefill assembly |
| `lib/external/build-review-submission.js` | `validateReviewSubmission` + `buildReviewSubmission` |
| `lib/services/review-upload.js`, `pages/api/review-manager/mark-received-no-file.js` | `validateReviewForm` (parent-only legacy path) |

The change that drives everything: **a synchronous, always-present, build-time array becomes a runtime-loaded, possibly-empty (Dataverse-down), async-fetched set.** Three consequences:

- **Server consumers** (draft/submit/context/build-review-submission/upload validator) must `await` the question set and thread it through, instead of importing it.
- **Client consumers** (`ReviewFormFields`, `ReviewAuthoringForm`, `ReviewsTab`) can't fetch async at import time — the question set must flow to the client **through `context.js`** as data. (This **reverses the Phase-2 decision** that removed `formSchema` from the `context.js` response because both renderers imported it statically — see authoring plan §8 Phase 2.)
- **Fail-closed when Dataverse is unreachable**, exactly like `PolicyFetcher` (no bundled fallback): a reviewer cannot author against an unknown question set; render an error, never a broken/empty form. The current 11 questions are migrated into the entity as the **seed** (one-time), so steady-state always has a set.

`review-form-schema.js` is **retained** as: (a) the normalized field *shape* contract + the seed definition, and (b) the pure helpers (`labelForReviewRating` etc.) re-pointed to operate on the fetched set. It stops being the system of record for *which* questions exist.

---

## 2. Data model

### 2a. New Dataverse entity `wmkf_reviewquestion` (system of record for the question SET)

Schema-as-code, new wave (`lib/dataverse/schema/wave9-review-questions/`), prod dry-run → execute (sandbox is schema-stale per `project-dynamics-sandbox-state`). One row **per current question**:

| Column | Type | Holds |
|---|---|---|
| `wmkf_Name` (**primary name attribute**) | Text (String 100) | display name — **required by `schema-apply`** (Codex P0; `lib/dataverse/schema-apply.js:235-257`, mirrors wave8 `01_wmkf_appreviewanswer.json:9-15`). Populate with the question text or key. |
| `wmkf_questionkey` | Text (String 100) | stable question id (`impact`, `q2`, …) — **alt key**, immutable, never reused. Max 100 to match `wmkf_appreviewanswer.wmkf_questionkey` [VERIFIED via `01_wmkf_appreviewanswer.json:18-23`] so the snapshot join stays type-aligned. |
| `wmkf_questionorder` | Whole Number | display order |
| `wmkf_questiontext` | Multiline Text | the question label/text as shown |
| `wmkf_questiontype` | Text | `picklist` \| `richtext` \| `string` |
| `wmkf_required` | Two Options (bool) | required? |
| `wmkf_maxlength` | Whole Number | richtext/string cap (null → default) |
| `wmkf_hint` | Text (nullable) | optional helper text |
| `wmkf_options` | Multiline Text (JSON) | for `picklist`: `[{value,label}]`; null otherwise |
| `statecode` | (standard) | **soft-delete** — removing a question deactivates the row (never hard-delete; keeps key stable + history legible). Active filter `statecode eq 0` matches the policy precedent [VERIFIED via `pages/api/admin/policies.js:44-50`]. |

**`schema-apply` is create-only** [VERIFIED via `lib/dataverse/schema-apply.js:8-11`] — re-running on a partially-created entity can duplicate artifacts (`project-dataverse-schema-deploy-gotchas.md`). The wave9 JSON must be complete (primary name + all columns + alt key) before the first `--execute`.

**Why JSON for `wmkf_options`** (not a child option table): options are never queried natively (only *answers* are, and those are already in the `wmkf_appreviewanswer` snapshot as `answerValue`+`answerText`). Simplest-first; revisit only if options need native querying.

**Alt key** on `wmkf_questionkey` so the admin save path is an idempotent upsert (mirrors the answer-snapshot alt-key pattern).

**Key immutability is mechanically enforced, not just documented (Codex P1).** The admin save route diffs submitted rows against the current set **by Dataverse row identity** (the `wmkf_reviewquestionid` the editor round-trips), so a text edit can never rewrite a row's `wmkf_questionkey` — an edited key would orphan the `wmkf_appreviewanswer` snapshot join. New rows get a brand-new key; existing rows' keys are read-only in the editor and rejected server-side if changed.

### 2b. `wmkf_appreviewanswer` (system of record for ANSWERS) — unchanged

Already holds all 11 questions including ratings (`wmkf_answervalue` for picklists). **No schema change needed** — decision #4 (ratings → snapshot) is already structurally supported. The snapshot is what makes "live edit" safe.

### 2c. Postgres `review_drafts` — unchanged

`draft_json` keyed by `field.key`. Reconciliation on load handles key add/remove (§5).

---

## 3. The fetcher

`lib/external/review-question-fetcher.js` — `ReviewQuestionFetcher`, mirroring `PolicyFetcher`:
- 5-minute cache, single-flight via `Map`, `invalidate()` hook called by the admin save route.
- `getActiveQuestionSet()` → ordered array of normalized fields **in the exact shape `reviewFormSchema.fields` produces today** (`{ key, order, label, type, required, maxLength, hint?, options? }`), so downstream validators/renderers change as little as possible.
- **Fail closed** (throw) when Dataverse is unreachable or the set is empty/invalid — callers surface an error, never a degraded form. Active rows only (`statecode eq 0`), ordered by `wmkf_questionorder`. (Mirrors `PolicyFetcher`'s throw-on-misconfigured-active-content [VERIFIED via `lib/external/policy-fetcher.js:66-82`].)
- Validates set sanity at fetch time: unique keys, contiguous-ish order, every `picklist` has parseable `options`, ≥1 question. (The policy fetcher's "active-child sanity" analogue.)
- **Cache is process-local (Codex P1).** The cache + `invalidate()` are a module-local `Map`, same as `PolicyFetcher` [VERIFIED via `lib/external/policy-fetcher.js:20-21,121-128`] — there is no cross-instance revalidation. So "edits take effect immediately" (§0 #3) means **immediately in the saving process**; other serverless instances pick up the change within the ≤5-min TTL. This is acceptable (a staff edit is rare; reviewers tolerate ≤5 min) — but the claim is **scoped to same-process**, not global. If true cross-instance immediacy is ever needed, switch to a version/etag fetch that forces freshness; not built in v1.

---

## 4. Admin editor (the variable-length twist — §0 #6)

- **Route:** `pages/api/admin/review-questions.js`, `requireSuperuser`.
  - `GET` — current active set + an etag/version token for optimistic save.
  - `POST` (save) — accepts the **full ordered set** the editor produced; diffs against current; performs add (create) / edit (update) / remove (soft-delete via statecode) / reorder (order updates) as one **`executeChangeset`** (the atomic `$batch` primitive built S302) so a partial save can't leave the set inconsistent. Calls `ReviewQuestionFetcher.invalidate()` on success.
  - Validation: unique keys, key-format (`^[a-z][a-zA-Z0-9_]*$` — allows camelCase; the live `overallRating` key has an uppercase letter, so the lowercase-only form first drafted here was wrong, corrected S303 in `review-question-fetcher.js`), key-immutability (an existing row's key can't change — it's the snapshot join), picklist option shape, length caps, ≥1 question, exactly-the-types-we-support.
- **UI:** `shared/components/admin/ReviewQuestionsSection.js` — a **variable-length list editor**: add/remove rows, drag-to-reorder (or up/down), inline edit of text/type/required/options. This is the structural difference from the existing fixed-field admin sections (`EmailDefaultsSection`, `PoliciesSection`) — it's a collection editor, not a fixed form. Reuses the admin-panel scaffolding + `requireSuperuser` gate.
- **Audit:** write a save-audit row (mirror `policy_publish_audit`) — who changed the set, when, the before/after diff — so a question-set change is traceable. (Connor/PD will ask "who changed Q6".)

---

## 5. Consumer fan-out (all in one phase or the form silently drifts)

Replace every static `reviewFormSchema.fields` use with the fetched set:

- **`context.js`** — `await getActiveQuestionSet()`, attach it to the response (re-add the `formSchema`/`questions` field removed in Phase 2). Pre-submit prefill overlays `draft_json`; post-submit reconstructs from child rows (unchanged).
- **Client `ReviewFormFields` / `ReviewAuthoringForm`** — receive the set **as props** from `context`, drop the static import. `ReviewAuthoringForm` already gates render on the draft GET; now it also depends on the context-supplied set (already loaded — no new round-trip).
- **`draft.js`** — whitelist/sanitize against the fetched set's keys.
- **`build-review-submission.js`** — `validateReviewSubmission`/`buildReviewSubmission` take the set as a parameter (no module-level import). The parent/child rating-equality backstop is **removed/relaxed** as ratings stop writing parent columns (see §6 staging).
- **`submit.js`** — fetch the set, pass to the builder.
- **`review-upload.js` / `mark-received-no-file.js`** — `validateReviewForm(input, set)` against the fetched set (legacy parent-path; see §6 — during dual-write these still PATCH the canonical columns).
- **`ReviewsTab.js`** — rating display moves from `labelForReviewRating(staticSchema)` to the snapshot's `answerText` label (the answer already carries its label); narrative render unchanged.

**In-flight draft reconciliation (§0 #3):** on `ReviewAuthoringForm` load, overlay `draft_json` onto the current set by key — keys absent from the current set are ignored (a removed question's stale answer is dropped, mirroring the draft route's existing unknown-key drop [VERIFIED via `pages/api/external/review/[token]/draft.js:67-83`]), keys new to the set render empty. `submit` validates strictly against the current set. Document this as the accepted behavior (a reviewer mid-draft when staff edit sees the new set on next load). Two reconciliation edge cases Codex flagged (P1) that v1 must handle, not just document:

- **Type change mid-draft.** Editing a question's `type` (e.g. richtext→picklist) can leave a `draft_json` value that the new editor can't consume — current client normalization is type-sensitive and richtext takes the raw value without a type check [VERIFIED via `shared/components/external/ReviewAuthoringForm.js:26-43`]. Reconciliation must **discard a draft value whose stored shape doesn't match the current field type** (treat as empty), never feed a string to a picklist control or vice-versa. Type-aware overlay, keyed by `(key, type)`.
- **Required-question-added mid-session needs a "reload" signal, not a bare 400.** Today submit validates all required fields and 400s before any write [VERIFIED via `lib/external/build-review-submission.js:59-120`, `pages/api/external/review/[token]/submit.js:160-166`]. A reviewer who opened the page under the old set and submits against a newly-added required question would get a generic validation error. Submit must return a **distinguishable "questions changed — reload" outcome** (e.g. a `set_changed` code keyed on a question-set version/hash echoed from `context`) so the client prompts a reload instead of showing a confusing field error.

---

## 6. Ratings → snapshot, staged (decision #4) — the high-risk part

The 3 parent rating columns (`wmkf_reviewerimpact/risk/overallrating`) have these **verified** readers (Codex re-verified by literal-column grep S303 — the earlier "VRP/export" entries were a scoping miss and are removed; see the header correction). Each goes null-after-stop-writing unless migrated:

| Reader | Evidence | Notes |
|---|---|---|
| `lib/external/review-form-schema.js:42-43,64-65,127-128` | key→column map | the schema itself |
| `lib/external/build-review-submission.js:174-180,211-234` | writes + parent/child equality assert | relax exactly as §6 says |
| `lib/external/verify-suggestion-token.js:31-34` | token context loads ratings | feeds `context.js` prefill |
| `pages/api/external/review/[token]/context.js:221-227` | returns ratings in `prefill` | |
| `pages/api/review-manager/reviewers.js:237-241` | DTO emits `reviewerImpact/Risk/OverallRating` | the DTO source |
| `lib/dataverse/adapters/reviewer-suggestion.js:54-57,263-265` | `FIELD_SELECT` + merge predicate | |
| `lib/services/reviewer-merge.js:34-40,75-80` | engagement-blocker signal | historical signal only |
| `shared/components/workbench/ReviewsTab.js:33-46,80-83` | consumes DTO ratings | |
| `shared/components/reviewers/ReviewerManagePanel.js:977-979` | **missed by initial scoping** — staff upload modal prefill consumes DTO ratings | Codex P1 |
| tests | `tests/unit/reviews-tab.test.js:25-39`, `tests/integration/review-manager-reviewers-answers.test.js:53-56`, `tests/unit/review-upload.test.js:211-219` | update with the readers |

**NOT readers** (removed from the earlier list): `shared/config/prompts/virtual-review-panel.js` (its own static AI schema at `:47-107`, no parent-column read) and `pages/api/dataverse-export/preview.js` (validates export specs, no parent-column read). There is **no LLM-prompt or export dependency** on these columns.

Retiring them is **not** a single delete. Stage it:

- **6a. Dual-write (no reader breaks).** Submit writes ALL ratings to the snapshot (already does) **and** continues to PATCH the canonical-3 parent columns *when those three keys are present in the set*. Nothing downstream changes yet. New (4th+) rating questions are snapshot-only from day one.
- **6b. Migrate readers to the snapshot.** Re-point each reader in the table above to source ratings from `wmkf_appreviewanswer` (the keyed child read already exists from Phase 4). `/contract-reconcile` the DTO chain (`reviewers.js` → `ReviewsTab` / `ReviewerManagePanel`).
- **6b-legacy. Legacy staff write paths (Codex P1).** `lib/services/review-upload.js:220-233` and `pages/api/review-manager/mark-received-no-file.js:57-72` still **PATCH the parent rating columns** on the staff upload / mark-received paths — they do **not** write `wmkf_appreviewanswer` snapshot rows. Before §6d, these must either write snapshot rating rows or be retired, or post-retirement staff-entered ratings vanish. This was unaddressed in the first draft's phasing; it lands in Phase D.
- **6c. Connor / external reporting re-point — RESOLVED (S303).** The external gate is cleared (owner confirmed). Connor's Dataverse→Excel averaging / any Power BI or saved view reading `wmkf_reviewer*rating` is no longer a blocker on retirement. See §7.
- **6d. Stop writing / drop the parent columns.** Only after 6a–6b + 6b-legacy (all writers emit snapshot rows; all readers read the snapshot). Dropping the columns is destructive Dataverse schema work — separate, explicitly-gated step; keep the columns (just unwritten) if in doubt.

Until 6d, the parent/child rating-equality invariant in `buildReviewSubmission` still holds for the canonical 3 and is the safety net during dual-write.

---

## 7. External dependency — RESOLVED (S303)

The external (Connor / reporting) gate on retiring `wmkf_reviewer{impact,risk,overallrating}` is **cleared** — owner-confirmed S303. No external sign-off blocks the retirement. The retirement is now ordered only by the **internal** reader+writer migration (§6b/6b-legacy): the in-repo readers in the §6 table, plus the legacy staff write paths, must move to the `wmkf_appreviewanswer` child table before the parent columns stop being written. (There is no LLM-prompt or export dependency — see the §6 "NOT readers" note.)

This was originally the same class of risk as the 2026-05-03 "dormant tables were load-bearing" lesson — a column that *looks* internal feeding an external report — which is why it was raised before planning; the owner has since confirmed it's handled.

---

## 8. Phasing (lowest-risk first)

- **Phase A — entity + fetcher + seed (no UI, no consumer change). ARTIFACTS BUILT S303 (prod create + seed pending).** Schema JSON (`lib/dataverse/schema/wave9-review-questions/01_wmkf_reviewquestion.json`), `ReviewQuestionFetcher` (`lib/external/review-question-fetcher.js`, 13 unit tests green), seed (`scripts/seed-review-questions.mjs`), and Atlas page all landed; schema + seed dry-runs green. The prod `--execute` create + seed are the one remaining gated step (creating prod schema is hard to reverse — done deliberately, not on autopilot). Spec: author the **complete** wave9 `wmkf_reviewquestion` JSON first — **including `primaryNameAttribute: wmkf_Name`, `wmkf_questionkey` String 100, and the alt key** (Codex P0; `schema-apply` is create-only, so a partial spec can duplicate artifacts on re-run). Create in prod (dry-run → execute). Seed the current 11 questions. Build `ReviewQuestionFetcher` + tests (fail-closed, sanity, process-local cache/invalidate). Atlas page + fact-consistency.
- **Phase B — consumer migration to the fetched set (behavior-preserving).** Split into **B1 server** (thread the set through the routes, `build-review-submission`, the upload validators) and **B2 client/context** (set flows through `context.js` to `ReviewFormFields`/`ReviewAuthoringForm` as props), but **ship B1+B2 together behind parity tests** — every static-schema consumer (§5 + the test list) assumes synchronous presence and breaks individually if split across deploys. Include the **type-aware draft reconciliation** + the **`set_changed` reload signal** (§5, Codex P1). Ratings still dual-write the parent columns (§6a). Net behavior identical to today, sourced from Dataverse. Full E2E re-run (authoring, submit, read-back) proves parity.
- **Phase C — admin editor.** `review-questions.js` route (atomic changeset save + audit + invalidate, **row-identity-based key-immutability enforcement**) + `ReviewQuestionsSection` variable-length UI. Now staff can edit. In-flight draft reconciliation verified (incl. type-change).
- **Phase D — rating reader + writer migration (§6b/6b-legacy).** Move the §6-table readers AND the legacy staff write paths (`review-upload.js`, `mark-received-no-file.js`) to the snapshot. `/contract-reconcile` each. (No VRP/export work — they don't read the columns.)
- **Phase E — retire parent columns (§6d).** External gate resolved (§7); ordered after Phase D (all readers AND writers on the snapshot). Stop writing, then optionally drop.

Each phase Codex-reviewed and folded in before the next (the authoring-epic cadence).

---

## 9. Gates, tests, risks

**Gates:** `check:atlas` (new entity ownership), `check:api-routes` (new admin route), `check:fact-consistency`/`check:doc-currency`, `check:migrations-manifest` (if any PG audit table), `check:status-enum-parity` (question-type producer↔consumer), `check:trust-boundary-guid`/`check:route-lifecycle-auth` (admin route). `check:prompt-injection-tagging` — **re-decide in Phase D**: once the VRP prompt reads ratings/answers from the snapshot, the untrusted-content boundary the authoring plan deferred may now apply (reviewer HTML → LLM).

**Tests:** unit — fetcher (fail-closed, sanity, cache/invalidate), admin save diff (add/edit/remove/reorder, key-immutability, atomic changeset), reconciliation (draft keys vs current set). Integration — admin GET/POST (superuser gate, optimistic save, audit), submit/draft against a fetched set, dual-write parity. E2E — staff edits the set → reviewer sees the new set; mid-draft reviewer reconciles; submit snapshot fidelity holds across an edit.

**Top risks:**
1. **Async/empty schema** — every consumer assumed sync+present (§5 table + tests). Fail-closed everywhere; never render a partial form. Ship B1+B2 together behind parity tests.
2. **Parent-column retirement fan-out** (§6) — verified reader table + the two legacy staff *writer* paths; stage + `/contract-reconcile`. No VRP/export dependency (corrected). External reporting gate resolved (§7); internal reader+writer migration orders it.
3. **Key immutability** — a changed key orphans the snapshot join; enforce by **row identity** in the admin save, not just docs (§2, Codex P1).
4. **In-flight drafts across an edit** — type-aware reconcile-on-load + `set_changed` reload signal (§5, Codex P1).
5. **OData discipline on keys** — any admin/filter/upsert use of a question key must allowlist + escape exactly like `submit.js:82-95` (Codex P1).
6. **Process-local cache** — "immediate" is same-process; ≤5-min cross-instance (§3).

---

## 10. Reusable infrastructure (verified present, S303)

- Versioned-content + cached-fetcher precedent: `wmkf_policy`/`wmkf_policyversion`, `lib/external/policy-fetcher.js`, `pages/api/admin/policies.js`, `shared/components/admin/PoliciesSection.js`.
- Atomic multi-row write: `DynamicsService.executeChangeset` (S302) — the admin save uses it.
- Snapshot child table + keyed read: `wmkf_appreviewanswer`, the Phase-4 `queryAllRecords` read in `review-manager/reviewers.js`.
- Schema-as-code: `lib/dataverse/schema/` + `scripts/apply-dataverse-schema.js` (wave8 is the template).
- Admin panel scaffolding + `requireSuperuser`: `pages/admin.js`, `shared/components/admin/*`.
- Field-shape + seed + helpers: `lib/external/review-form-schema.js` (retained, re-pointed).

---

## 11. Codex design-review log (S303)

Codex reviewed the DRAFT plan read-only (`/contract-reconcile`-style) and surfaced the following; all folded in above. Verdict: **BLOCKING-until-resolved**, the sole hard blocker being the Phase-A schema P0 — now resolved in §2.

- **P0 — missing `primaryNameAttribute`.** `schema-apply` requires it (`lib/dataverse/schema-apply.js:235-257`); wave8 has `wmkf_Name` (`01_wmkf_appreviewanswer.json:9-15`). → §2 spec now includes it. **Verified this session.**
- **Correction — VRP + dataverse-export are NOT parent-column readers.** Literal-column grep finds no match in `virtual-review-panel.js` / `dataverse-export/preview.js`; the earlier listing conflated an unrelated "average/aggregate" term grep. → §6 reader list corrected; retirement has no LLM/export dependency. **Verified this session by re-grep.**
- **Missed reader — `ReviewerManagePanel.js:977-979`** (staff upload modal prefill consumes the DTO ratings). → added to the §6 table. **Verified this session.**
- **P1 — key immutability must be mechanically enforced** by row identity (§2). 
- **P1 — key max length** should be String 100 to match the snapshot join (§2).
- **P1 — type-change-mid-draft** can break the editor; needs type-aware reconciliation (§5).
- **P1 — required-added-mid-session** needs a `set_changed` "reload" signal, not a bare 400 (§5).
- **P1 — process-local cache** vs the "immediate" claim; scoped to same-process + ≤5-min cross-instance (§3).
- **P1 — legacy staff write paths** (`review-upload.js`, `mark-received-no-file.js`) still PATCH parent columns and must move to the snapshot before §6d (§6 6b-legacy, Phase D).
- **P1 — OData discipline on keys** mirroring `submit.js:82-95` (§7/§9).
- **Phasing — split Phase B** into server + client/context, ship together behind parity tests (§8).

### Phase A code review (S303, commit `f06316bb` + fixes)

Codex reviewed the built Phase A read-only. **No P0.** Schema engine compatibility, the `wmkf_questionkey` String-100 snapshot-join match, the Boolean shape, and the single-attribute alt key all confirmed sound. Findings folded in (same-session fixes):
- **P1 — `invalidate()` race:** an in-flight pre-edit fetch could repopulate stale cache. Fixed with a generation counter (`review-question-fetcher.js` — cache write skipped if `generation` changed mid-fetch). Test added.
- **P1 — >100-row silent truncation:** `queryRecords` caps `$top` at 100. Fixed — the fetcher now throws (fail-closed) on `hasMore`/`totalCount > records.length`. Test added.
- **P1 — seed/alt-key index race:** `seed-review-questions.mjs` now gates `--execute` on `EntityKeyIndexStatus === 'Active'` (via `DynamicsService.getEntityKey`) and aborts otherwise, so seeding can't race a not-yet-Active index into duplicate rows.
- **P2s:** strict-boolean `wmkf_required` (throws, no silent optional); strict-integer option values (rejects `"4abc"`); duplicate `wmkf_questionorder` rejected; plan status line corrected. All tested (18 fetcher tests green).
- **Noted, not fixed:** dry-run validates URLs/existence, not POST metadata bodies — the real prod `--execute` is the first true validation (Atlas + seed header say so).

**Verdict:** prod `--execute` create is safe to attempt; the seed self-gates on the key being Active; the Phase-B-blocking P1s are resolved.
