# Session 197 Prompt: Lock Workbench tab structure → write the scoping doc

## ⏰ Time-sensitive carryovers

### Operator-side action items
1. **Intake portal virus-scan e2e** — DEFERRED to pre-launch. Must run EICAR through `/apply` flow before the **next cycle's Phase I intake** goes live (the June 2026 Phase II Research pilot is superseded — see `docs/SYSTEM_MODEL.md`). Recipe in [`project-intake-portal-virus-scan-e2e-deferred`](.claude-memory/project-intake-portal-virus-scan-e2e-deferred.md).

### BILL reviewer-honorarium build status
- **Chunks SHIPPED:** 2-3, 6, 7a, **1 (Connor's `wmkf_HonorariumRequest` lookup, S196)**.
- **Chunks PENDING:** 4 (extend respond.js — now UNBLOCKED on schema; Vercel-side work), 5 (Stage 2a UI address inputs — held), 8 (E2E sandbox test — blocked on Steph).
- **Target ready:** 2026-06-10. First reviewer invitations ≥ 2026-06-17.

## Session 196 Summary

Mixed-mode session: closeout-status design decision + S195 carryover, schema deploy, Connor schema work reflected, a reviewer-data-model visual doc that surfaced two architectural redundancy findings, and a 5-round Codex review iteration on the resulting collapse plan that produced a generalizable memory entry on fix-work verification.

### What was completed

1. **`wmkf_completedat` deployed to prod Dataverse** (`571a148`)
   - DateTime field on `wmkf_appreviewersuggestion`, paired with the existing `wmkf_reviewstatus = complete` (100000004) enum value (which Connor confirmed was unused).
   - Closeout model locked: reviewer submission flips `wmkf_reviewstatus = review_received` (payment-eligible for Steph); PD click "Close out" flips to `complete` + stamps `wmkf_completedat` (drops row from PD dashboard). Subpar/withhold case handled out-of-band PD→Steph (no schema).
   - No new field needed for "payable status" — the existing enum already encoded the two-state distinction (reviewer-done vs PD-done) we needed.

2. **BILL terminology drift patched** (`5928eb6`)
   - `docs/BILL_HONORARIUM_INTEGRATION_DESIGN.md` had ~5 references to `wmkf_potentialreviewer` as the host for the `wmkf_HonorariumRequest` lookup. Actual junction is `wmkf_appreviewersuggestion` (per-engagement). Fixed across 2 docs.

3. **Connor's `wmkf_HonorariumRequest` lookup shipped + reflected** (`a6e6e37`)
   - Connor created the Lookup on `wmkf_appreviewersuggestion`, target `akoya_request`, RequiredLevel=None. Verified live via metadata GET.
   - BILL chunk 1 ✅. Chunk 4 now unblocked from the schema side.
   - Audit catalog + atlas page + session prompt + BILL design doc updated.

4. **Reviewer data model doc** (`b11fee5`)
   - New `docs/REVIEWER_DATA_MODEL.md` — 3 views (focused ER, expanded ER w/ grant+honorarium, lifecycle write-paths) + "Where do I look for X?" reference + naming gotchas.
   - Walkthrough with user surfaced that `wmkf_appresearcher` is structural redundancy. Atlas page had `wmkf_potentialreviewers` mislabeled as "vendor entity" — live metadata confirmed `IsCustomEntity=true, IsManaged=false` (custom Foundation). Atlas corrected.
   - User reframe: since promotion doesn't move data (just sets `wmkf_contact` lookup), `wmkf_potentialreviewer` itself is a reviewer-sidecar to `contact`. Adding another 1:1 sidecar below it (`appresearcher`) is structural over-normalization.

5. **Appresearcher collapse plan** (`7ed4b43`, `49d93ae`, `ec3d097`, `4f8646b`)
   - New `docs/APPRESEARCHER_COLLAPSE_PLAN.md` — full 7-phase plan to fold `wmkf_appresearcher` bibliometric fields into `wmkf_potentialreviewer` post-pilot.
   - **5 rounds of Codex review** (rounds 1-4: Codex reviewed my fixes; round 5: Codex applied its own findings, I reviewed). Each round caught fresh bugs in the prior round's fix work — see meta-pattern below.
   - Ground truth pinned: 334 appresearcher rows, 0 rows on each publication entity, 17 source fields verified, `wmkf_apppublicationauthor.wmkf_researcher → wmkf_appresearcher` is a live FK dependency.
   - All identified WRONG-NOW doc drift reconciled (REVIEWER_DATA_MODEL, REVIEWER_POSTGRES_TO_DATAVERSE_PLAN, atlas page, 2 memory entries).
   - Plan committed and ready for post-pilot execution. ~8 hours of focused work projected.

6. **Memory entry: apply reconcile rules to fix-work** (`ec3d097`)
   - New `.claude-memory/feedback-apply-reconcile-to-fix-work.md`.
   - Generalizes [[feedback-reconcile-dont-append-docs]], [[feedback-cite-ground-truth]], [[feedback-verify-external-platform-claims]] to apply to MY fix work, not just original drafts.
   - Failure patterns named: internal contradictions, partial doc fixes, unverified claims smuggled by table structure, wrong premises about adjacent state.
   - **Key insight from the 5-round Codex loop:** when Codex applied its own findings (round 5) the fix pass was cleaner than any of my fix passes. The inversion (Codex fixes, Claude reviews) broke the round-after-round cycle. Worth remembering for future plan-iteration work.

### Commits this session
- `4f8646b` — Codex round-4 self-applied fixes — plan/migration doc convergence
- `ec3d097` — Fold Codex round-3 + memory entry on fix-work verification rigor
- `49d93ae` — Fold Codex round-2 review into collapse plan + pin verified ground truth
- `7ed4b43` — Fold Codex review into appresearcher collapse plan + reconcile WRONG-NOW docs
- `b11fee5` — Add reviewer data model doc + flag appresearcher collapse (post-pilot)
- `a6e6e37` — Reflect Connor's wmkf_HonorariumRequest lookup shipped (BILL chunk 1)
- `5928eb6` — Patch BILL doc terminology drift: HonorariumRequest host is appreviewersuggestion
- `571a148` — Add wmkf_completedat for Request Workbench PD closeout (S196)

## Potential next steps for S197

### 1. Lock the Workbench tab structure (CARRYOVER from S196 step 1 — PRIMARY)
3-tab (Find + Roster + Closeout) vs 4-tab (Find / Invite / Track / Closeout). User was returning with overnight instinct in S196; conversation pivoted to the closeout-status design instead. Still unresolved.

### 2. Draft `docs/REQUEST_WORKBENCH_SCOPING.md`
Connor/Sarah-shareable. Once tab structure locks, structure is:
- Holistic architecture (three tiers: global / cycle-scoped / per-request)
- Phasing change + simplified trigger model (Phase I sunsetting)
- Reviewer-lifecycle slice as v1 (URL, tabs, what they do, what they replace)
- Artifact-storage inventory pass
- Explicit out-of-scope for v1

### 3. BILL chunk 4 implementation
Schema dependency cleared (Connor's `wmkf_HonorariumRequest` lookup shipped). Now Vercel-side: extend `respond.js` accept path to create the honorarium `akoya_request` and PATCH the junction's new lookup. Per `docs/BILL_HONORARIUM_INTEGRATION_DESIGN.md`.

### 4. Other open items (deferred)
- Row content on the cycle dashboard (compaction direction set, specifics open)
- `isActionableForPD` policy function rules
- Reviewer Pool surface design

## Key files reference

| File | Purpose |
|------|---------|
| `docs/REVIEWER_DATA_MODEL.md` | NEW S196 — 3-view visual orientation for reviewer-domain entities |
| `docs/APPRESEARCHER_COLLAPSE_PLAN.md` | NEW S196 — post-pilot collapse plan (Codex-converged across 5 rounds) |
| `lib/dataverse/schema/wave5/01_wmkf_appreviewersuggestion_workbench.json` | NEW S196 — `wmkf_completedat` schema manifest |
| `.claude-memory/feedback-apply-reconcile-to-fix-work.md` | NEW S196 — meta-rule for fix-work verification rigor |
| `.claude-memory/project-appresearcher-collapse-post-pilot.md` | UPDATED S196 — collapse decision + plan pointer |
| `docs/REVIEWER_INTERACTION_DESIGN.md` | Stale claim: line 141 says "Status state machine on `wmkf_potentialreviewer`" — actually on `wmkf_appreviewersuggestion`. Worth fixing during the scoping-doc work or earlier. |

## Testing
N/A this session (schema add was deploy-verified; design work otherwise).
