# Session 264 Prompt: Applicant-suggested reviewer promotion spec ready for Codex review

> **GIT.** All S263 work is on `main` (3 commits ahead of origin). Working tree clean.
> Priority for S264: send the revised applicant-suggested promotion spec to Codex for review,
> then discuss implementation. Group B build remains blocked on Connor's inputs.

## Session 263 — what happened

Two feature streams plus a Codex review cycle.

### Stream 1 — S263: Applicant-suggested reviewers unified into main candidate list

**Commits:** `c6a53045`, `c5d35163`, `1a8038e8`

- `enrich-recommended` now fires automatically (no manual button) once both `blobUrl` and
  `recommended` slots are ready — gated on `recPhase === 'idle'` and `!recRunningRef.current`
- Enriched applicant candidates (`recCandidates`) prepended into `displayCandidates` so they
  surface in the `applicant_suggested` provenance section of the main unified candidate list
- Applicant-suggested section is **read-only** (no checkbox) with note "Named by the applicant —
  already in this request's candidate pool. Invite from the Invite tab."
- Bottom card redesigned: status-only surface (no candidate list, no manual trigger, no Re-verify)
- Removed Re-verify button intentionally (enrichment is static within a cycle; error recovery
  via "Try again" only)
- Bug: auto-trigger `useEffect` referenced `enrichRecommended` before its `useCallback`
  declaration; fixed by moving the effect after the declaration (`1a8038e8`)

**Post-ship Codex review** found 4 bugs; all fixed in `c5d35163`:
1. Done-message used `recCandidates.length` but `needsIdentification` candidates route to
   `needs_identity_review`, not `applicant_suggested` — split into `recVerifiedCount` /
   `recIdentityReviewCount`
2. Blank status card when all recommendations are staff-removed — added "removed by staff" message
3. Missing "not saved as candidates" pool-consequence in ingestion-failure banner — restored
4. Pre-fetch `genRef` guard in `enrichRecommended` before the POST fires — added

**Wiki updated:** `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md` — S263 section,
auto-enrichment behavior, read-only hazard, recurring hazard note.

### Stream 2 — Applicant-suggested promotion redesign (spec, not yet built)

User identified pre-existing bug: applicant-suggested reviewers auto-promote into the candidate
pool on ingestion (`ensureApplicantRecommended` CREATE sets `wmkf_selected = true`). They should
require explicit PD promotion.

**Codex spec review** surfaced two plan-breaking gaps (save path creates duplicate person records;
`save-candidates` COI gate explicitly excludes applicant rows) and resolved all open decisions
with user.

**Revised spec is written and ready for next Codex implementation review** — see below.

---

## Priority for S264

### 1. Send revised spec to Codex for implementation review (FIRST TASK)

Send the full revised spec (reproduced below) to Codex. Ask Codex to review for implementation
correctness, flag any remaining gaps, and confirm it faithfully implements the user's intent
before any code is written.

### 2. Discuss implementation with user; then build

After Codex review, present findings to user. Adjust spec if needed. Then build.

### 3. Group B build — still blocked on Connor (unchanged)

Connor's four inputs still needed before build can start (field names, Graph write, PA flow,
prompt rows). See S262 section for details.

---

## Revised Spec: Applicant-Suggested Reviewers — Explicit Promotion Required

### User intent
> "The applicant-suggested reviewers always get promoted to the candidates tab automatically.
> This should not be the default behavior. That should only happen if a Program Director
> requests it because we are supposed to use the applicant-suggest reviewers sparingly."

Applicant-suggested reviewers must appear in the Find tab for PD review (enriched, with
COI/bibliometrics) but must **not** enter the candidate pool or Invite tab until a PD explicitly
selects them. Counts/rollups that depend on `wmkf_selected = true` will naturally exclude
unpromoted rows — confirmed correct.

### Layer 1 — Adapter: stop auto-selecting on create
**File:** `lib/dataverse/adapters/reviewer-suggestion.js`
- `ensureApplicantRecommended()` CREATE path (~line 395): `wmkf_selected = true` → `wmkf_selected = false`
- UPDATE and race-condition paths already skip `wmkf_selected` — no change
- "Never resurrect a staff-removed row" invariant preserved

### Layer 2 — Adapter: new query for enrichment
**File:** `lib/dataverse/adapters/reviewer-suggestion.js`
- Add `findApplicantRecommendedByRequest(requestId)`:
  filter `_wmkf_request_value eq {requestId} AND wmkf_applicantdisposition eq 100000000 AND {notExcludedFilter()}`
  — no `wmkf_selected` constraint; same select fields as `findByRequest`

**File:** `pages/api/workbench/enrich-recommended.js`
- Replace `findByRequest(requestId, { selectedOnly: true })` → `findApplicantRecommendedByRequest(requestId)`
- No other changes; enrichment writes (`researcherAdapter.upsertByPotentialReviewer`, `setMatchReason`) do not touch `wmkf_selected`

### Layer 3 — applicant-reviewers.js + UI: drop `selected` field; fix recCount
**File:** `pages/api/workbench/applicant-reviewers.js`
- Remove `selected: result.selected !== false` from each row in `recommended` array
  (field no longer has meaningful semantics; all new rows are `wmkf_selected = false`)

**File:** `shared/components/reviewers/ReviewerSearchSection.js`
- `recCount` (line 928): `recommended.filter((r) => r.selected !== false).length` → `recommended.length`
- Auto-enrichment trigger: same filter expression → `recommended.length`
- Remove "All applicant-suggested reviewers have been removed by staff." conditional
- Remove "Removed by staff" pill from the applicant-reviewers card

### Layer 4 — New promotion endpoint
**File:** `pages/api/workbench/promote-applicant-reviewer.js` (new)
- `POST { requestId, suggestionId }`
- Auth: `requireAppAccess` (same guard as other workbench routes)
- Validate `suggestionId` is a GUID
- Fetch junction row by `suggestionId`; verify `_wmkf_request_value === requestId` (ownership)
- Verify `wmkf_applicantdisposition === 100000000` (guard: only applicant rows)
- PATCH `wmkf_selected = true` via `updateLifecycle(suggestionId, { selected: true })`
- Return `{ success: true, suggestionId }`
- Register in `docs/API_ROUTE_SECURITY_MATRIX.md`

Rationale: sidesteps `save-candidates` COI gate (which has a comment explicitly excluding
applicant rows) and avoids `upsertByEmail` → duplicate person record risk.

### Layer 5 — UI: applicant_suggested section becomes selectable
**File:** `shared/components/reviewers/ReviewerSearchSection.js`
- Remove `applicant_suggested` from `readOnlySection`
- Section note: → "Named by the applicant — select to add to this request's candidate pool."
- Save handler: when saving selected candidates, detect `provenanceGroupOf(c) === 'applicant_suggested'`
  and call `POST /api/workbench/promote-applicant-reviewer` with `{ requestId, suggestionId: c.suggestionId }`
  instead of routing through `save-candidates`
- On success: update local `recCandidates` to reflect promoted state

### Layer 6 — One-time data migration script
**File:** `scripts/demote-applicant-suggested-reviewers.js` (new)
- Query all `wmkf_appreviewersuggestion` rows where `wmkf_applicantdisposition = 100000000`
  AND `wmkf_selected = true`
- PATCH each to `wmkf_selected = false` via `updateLifecycle`
- Log count processed and failures; idempotent
- Run **after** code deploy, **before** announcing to PDs
- All-or-nothing confirmed safe: no PD has manually promoted any applicant-suggested reviewer

### What does NOT change
- `save-candidates.js` — untouched
- `my-candidates.js` / Invite tab — untouched; unpromoted rows stay out naturally
- `provenanceGroupOf` — untouched
- Grant-cycle counts, proposal reviewer counts, rollups — unpromoted rows drop out (correct)
- `needs_identity_review` routing — unchanged

---

## Continuity guardrails

- **`reviewer-finder` model namespace still live** — do NOT remove from `baseConfig.js`
- **API routes not touched** — dual-keyed routes stay until Connor confirms grant migration
- **Triage is LIVE in prod** — `wmkf_triagestatus` is the signal
- **S263 applicant_suggested section is currently read-only** — Layer 5 above will make it
  selectable; do not add checkboxes before the promotion endpoint exists

## Key Files Reference

| File | Role |
|------|------|
| `shared/components/reviewers/ReviewerSearchSection.js` | S263 unified candidate list + status card |
| `pages/api/workbench/enrich-recommended.js` | Applicant enrichment SSE endpoint |
| `pages/api/workbench/applicant-reviewers.js` | Ingestion endpoint (materializes wmkf_potentialreviewer1..5 slots) |
| `lib/dataverse/adapters/reviewer-suggestion.js` | `ensureApplicantRecommended` + `findByRequest` + `updateLifecycle` |
| `pages/api/reviewer-finder/save-candidates.js` | Normal save path — NOT to be used for applicant promotion |
| `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md` | S263 behavior documented here |
| `docs/GROUP_B_WRITEUP_SPINE_DESIGN.md` | Group B design doc (share with Connor) |

## Testing
```bash
npm run build && npm run lint
npm test                       # FULL suite
npm run check:api-routes && npm run check:trust-boundary-guid
npm run check:atlas && npm run check:agent-wiki
```
