# Session 291 Prompt: Nomenclature/app-lifecycle execution + contact-boundary policy

## ⚠️ Top-of-session must-knows

1. **`scripts/probe-rabinowitz-conflict.js` is UNTRACKED on purpose and must STAY
   untracked** — it hardcodes a real reviewer's email (`joshr@princeton.edu`),
   names-stay-local norm. Never `git add -A` it in. Stage specific files only.
2. **Push posture:** S290's 10 commits were pushed at end of session (see below). No
   standing no-push instruction carries into S291 unless Justin sets one. Pushing
   `main` auto-deploys to Vercel prod — the Invite Reviewers UI change is
   colleague-facing, so confirm before shipping anything new outward.
3. **Known-red test suites (unchanged):** `tests/unit/bill.test.js` and
   `tests/unit/discovery-verification-status.test.js` only. Confirm any red is ONLY
   these before chasing.

## Session 290 Summary

Closed the reviewer-record merge track end-to-end and **prod-confirmed** it, fixed a
real prod bug the non-mocked probe caught, shipped a colleague-facing Invite
Reviewers UX fix, and produced two Codex-reviewed strategy/findings docs.

### What Was Completed

1. **Reviewer-merge Chunk 4 — UI merge mode** (`080e7069`, `10ab7d4a`).
   `CandidateEditModal` flips into merge mode on a duplicate-key 409: keeper swap,
   orientation-aware field picker, blocked-reasons explainer, orphan-recovery on a
   torn email move. 13 RTL tests. Codex post-impl (4 catches) folded.

2. **Reviewer-merge Chunk 5 — non-mocked prod ordering probe (O8)** (`39d44117`,
   `169d8454`, prod-confirmed via `a19b934f`).
   `scripts/probe-merge-altkey-ordering.mjs` (prod-write, reversible, marker-gated
   teardown) — sub-probes A (email alt-key + 409 translation), B ((person,request)
   collision vs free), C (e2e `executeMerge`). `--run` → **A/B/C all pass, O8
   settled, cleanup verified.**

3. **Real prod bug the probe caught + fixed** (`a19b934f`). The 409 derived
   `conflictingRecordId` from the 412 body — which carries the record being WRITTEN
   plus its `modifiedby` systemuser, **NOT** the existing owner — so it surfaced a
   systemuser GUID and broke merge-mode entry. Fix: resolve the owner from the
   duplicate email via `potentialReviewerAdapter.findByEmailCandidates` (fail-closed
   on `statecode`); extracted `lib/dataverse/duplicate-key.js` (field/value only),
   pinned by `tests/unit/duplicate-key.test.js`. Codex pre+post-impl folded.

4. **Invite Reviewers tab: edit affordance + no-email guard** (`5f8412de`).
   Explicit "✏️ Edit contact" button on each card (mirrors the Find tab; the editor
   already existed but was hidden behind the clickable name). Invite checkbox
   disabled for never-invited no-email rows + Send set requires email (already-invited
   rows stay selectable for release). Local nomenclature cleanup: header
   "Candidates"→"Invite Reviewers", stale Invite/Completed tab refs fixed. Codex
   sanity-check (no safety findings) folded.

5. **Two Codex-reviewed docs** (`83ef65e4`, `0ee9e158`, `2b43668c`).
   - `docs/REVIEWER_CONTACT_BOUNDARY_GAP_FINDINGS.md` — Codex-led trace of the
     `wmkf_potentialreviewers ↔ CRM contacts` gap (no contact match at origination;
     corrections stranded; `ensureContact` email-only match spawns duplicate
     contacts). Findings + design stub, NOT built.
   - `docs/NOMENCLATURE_AND_APP_LIFECYCLE_STRATEGY.md` — strategy for the legacy-app
     nomenclature/lifecycle cleanup, **hardened by a Codex adversarial review**
     (added a 4th "live-cross-cutting" bucket, reclassified `phase-ii-writeup-legacy`
     as sunset-candidate, ALIAS auth-parity + grant/persisted-key preconditions, gate
     additions). `REVIEWER_MERGE_DESIGN.md` reconciled to Chunk-5 prod-confirmed.

### Commits (all pushed)
- `e0365b47` - Fix red doc-symbol-refs gate on local-only probe ref
- `080e7069` / `10ab7d4a` - Chunk 4 UI merge mode + Codex post-impl
- `39d44117` / `169d8454` - Chunk 5 ordering probe + Codex post-impl
- `a19b934f` - conflictingRecordId fix (prod-confirmed)
- `5f8412de` - Invite Reviewers edit + no-email guard
- `83ef65e4` - Chunk 5 prod-confirmed docs + contact-boundary findings
- `0ee9e158` / `2b43668c` - Nomenclature/app-lifecycle strategy + fact-consistency fix

## Potential Next Steps

### 1. Execute the nomenclature/app-lifecycle strategy (IN PROGRESS — S291)
`docs/NOMENCLATURE_AND_APP_LIFECYCLE_STRATEGY.md` is the plan. **S291 shipped:**
Commit 1 (additive `APP_LIFECYCLE_REGISTRY` + `ROUTE_NAMESPACE_LIFECYCLE` exports
+ `docs/NOMENCLATURE_GLOSSARY.md`); the enforcement gates `check:route-lifecycle-auth`
+ `check:scaffolding-tokens` (+ a fail-closed scaffolding-token Write/Edit hook);
and **Phase 1 / Commit 2** — archived `phase-ii-writeup-legacy` + `/api/process-legacy`
+ `proposal-summarizer-legacy` after the owner confirmed the page is invisible to all
suite users and not in active use (runtime-log retention is ~1 day so logs couldn't
prove months of non-use). **Remaining:** Phase 2 (rename live internals, e.g.
`CandidatesPanel` → an Invite-Reviewers name), Phase 3 (document the borrowed
`/api/reviewer-finder` + `/api/review-manager` namespaces), Phase 4 (fact-level
`/sweep`). Honor the consolidated-grant + persisted-key inventory **precondition**
in §3 before any rename/alias. **Parked for discussion:** bookmarks to the old
`wmkfresearch.vercel.app` domain (vs `applications.wmkeck.org`) "may cause problems"
— owner wants to talk through those soon.

### 2. Contact-boundary gap — owner policy decision, then build
`docs/REVIEWER_CONTACT_BOUNDARY_GAP_FINDINGS.md` lists the open policy questions
(auto-link vs staff-confirm; who owns truth on conflicts). When decided, the
**lowest-policy-dependency increment** is the `ensureContact` ORCID-fallback fix
(stops the duplicate-contact-on-corrected-email bug). Build is blocked on Justin's
policy answers.

### 3. Deferred Codex P2 merge hardening (optional, design-doc'd)
Not built; Justin's call: map mid-merge Dataverse 409/412 to a retryable 409
(currently 500); trim suggestion/request IDs from the plan response if unused; add
an audit breadcrumb on keeper+loser at deactivate. (Chunk 5 — DONE this session.)

### 4. Step-2 reviewer↔contact linker (BLOCKED — do not start cold)
`docs/REVIEWER_CONTACT_LINKER_DESIGN.md`. Blocked on Connor's Q1–Q4
(`CONNOR_CONTACT_MERGE_AND_REVIEWER_LINKING.md`) + a probe of which contact→request
links count as "associated with an active award". Note: the newer S290
contact-boundary findings doc (#2) overlaps this boundary — reconcile the two before
building either.

### 5. Long-stale carryovers (VERIFY-FIRST or retire — do NOT assume open)
Ridden forward several sessions without re-verification; probe live state before
acting, and retire if already done/blocked:
- S288: record real-replay human sign-off in `docs/MODEL_CHANGE_STRATEGY.md`
  (reviewer-finder already pinned to `claude-opus-4-8` in prod); logged-in Admin
  Models visual smoke (owner-only check).
- S285/S286: request `1002788` test-data triage; E2E of Restore Removed Candidates
  + PD identity override; reviewer-portal review-upload design decision; optional
  auto-on-award abstract cron.

## Key Files Reference

| File | Purpose |
|------|---------|
| `shared/components/reviewers/CandidatesPanel.js` | Invite Reviewers tab — edit button + no-email guard (S290). |
| `lib/dataverse/duplicate-key.js` | `translateDuplicateKeyError` (field/value only); shared by route + probe. |
| `pages/api/reviewer-finder/my-candidates.js` | PATCH 409 resolves conflicting owner by email, fail-closed on statecode. |
| `scripts/probe-merge-altkey-ordering.mjs` | Non-mocked prod alt-key/merge probe (O8). `--run` against throwaway rows. |
| `docs/NOMENCLATURE_AND_APP_LIFECYCLE_STRATEGY.md` | Cleanup strategy (Codex adversarially reviewed). Entry point for #1. |
| `docs/REVIEWER_CONTACT_BOUNDARY_GAP_FINDINGS.md` | potentialreviewer↔contact gap findings + stub (#2). |
| `docs/REVIEWER_MERGE_DESIGN.md` | Merge v1 — chunks 1–5 BUILT + prod-confirmed. |
| `scripts/probe-rabinowitz-conflict.js` | UNTRACKED, names-local. Never commit. |

## Testing

```bash
# Merge + duplicate-key unit tests:
npx jest tests/unit/candidate-edit-modal-merge.test.js tests/unit/duplicate-key.test.js \
  tests/unit/reviewer-merge-service.test.js

# Non-mocked prod probe (Justin runs it; auto-mode prod-deploy guard blocks the agent):
#   ! node scripts/probe-merge-altkey-ordering.mjs          # plan-only
#   ! node scripts/probe-merge-altkey-ordering.mjs --run    # 3 sub-probes + cleanup

# Gates touched this session (all green):
npm run check:fact-consistency && npm run check:doc-symbol-refs \
  && npm run check:build-claim-freshness && npm run check:agent-wiki
```

## Gotchas / Continuity

- The reviewer-merge track is **DONE + prod-confirmed**; do not re-open it as a build
  task. Remaining merge items are the optional P2 hardening (#3).
- The Invite Reviewers edit is live to colleagues once deployed — the editor and the
  name-click open the SAME PATCH-mode modal; no-email rows are unselectable for
  invite (but `send-emails` also skips `no_email`, a triple backstop).
- Nomenclature cleanup is sequenced: dead-end UI removal → archive true orphans →
  rename live internals → `/sweep` docs. Don't rename route paths (contracts) or
  bare-rename persisted keys (`model_override:reviewer-finder:model`, preferences).
```
