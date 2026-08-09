# Session 410 Prompt: Initial Assessment pilot gate (admin evidence in flight)

> **Handoff, 2026-08-09 (Session 409).** The institution pair-consistency
> program closed: Stage 1 promoted, the enrichment seam landed as a composite,
> and both surfaces now carry stop-rules. The ROR strategic-reset assignment
> that opened Session 409 is **answered and closed** — do not re-open it (see
> "Do Not Reopen"). The live thread is the Initial Assessment pilot, whose
> administrative half is blocked on an emailed request to Connor.

## Session 409 Summary

### What Was Completed

1. **ROR arm-2 measurement — headroom hypothesis falsified.**
   - Ran the frozen-40 benchmark with `--institution-resolver ror`.
   - Promotion gates identical to the arm-1 baseline (correctBindGain 8,
     falseBinds 0, misses 4, providerFailures 0); combined outcomes identical
     across all 40 cases; only two works-stage reason changes.
   - Conclusion recorded: byline corroboration, not institution resolution, is
     the binding constraint. Do-not-inject recommendation stands.

2. **Wave 6 — enrichment institution seam opted into segment comparison, then
   fixed to a composite after adversarial review.**
   - The seam at `institutionEvidenceConnectsIdentity` now clears when EITHER
     the legacy checker (one-hop associated-link corroboration) OR the staged
     segment-comparison checker (exact segment match + decoration proof)
     clears — strictly additive versus prior production.
   - Motivating case: request 1002912 (Lunenfeld-Tanenbaum Research Institute
     byline vs the same name with ", University of Toronto" appended) produced
     a false "Institution mismatch" banner and blocked writes.
   - Codex round-6 caught that the first, staged-only version regressed the
     VUMC-class (hospital vs parent university) and blocked writes for correct
     identities. The composite restores those clears.
   - Fail-closed catch, the tri-state null contract, and the `identityConfirmed`
     write-gate conjunction are all unchanged.
   - Gates: live pair gate PASS 157/157 (providerFailures 0, clean tree);
     frozen-40 rerun identical to baseline field-for-field; 114 focused tests.

3. **Cycle-unresolved measurement tool built and merged (read-only).**
   - `benchmarks/institution-pair-consistency/measure-cycle-unresolved.js`
     pulls a cycle's candidate reviewers from Dataverse, extracts institution
     pairs, and replays both checker arms with full provenance and
     refuse-overwrite artifacts.
   - **Finding:** across all 249 in-scope unresolved/ambiguous/null candidates
     in cycle D26, **zero** carry any persisted evidence anchor. This is empty
     *by construction* — `wmkf_identityverifiedanchorsjson` projects only
     anchors that survived verification, and "unresolved" means none did.
     Measuring that population therefore requires live evidence re-discovery.

4. **Per-request replay answered the practical version of that question.**
   - Request 1002914's Find roster (57 rows, persisted in Postgres
     `reviewer_find_roster` as render DTOs) replayed through old vs new logic.
   - Of the 3 rows carrying a mismatch banner: 1 (Beverly Davidson, CHOP)
     clears under the new code as a genuine false alarm; 2 (Dan Wang,
     Feng Zhang) correctly still surface as namesake binds.
   - Across 53 comparable pairs: old logic contradicted 42, new logic 25 —
     17 newly cleared, all on identity-verified reviewers.
   - Caveat: only the 3 persisted flags are ground truth for production
     operands; the roster DTO does not store the byline evidence list, so the
     other 50 used `priorAffiliation || suggestedInstitution` as a proxy.

5. **Doc sweep (Mode A) after promotion.**
   - Corrected `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md`, which
     still claimed the S400 institution-verdict branch was UNMERGED and that
     production ran pre-fix behavior, and framed the segment-whole extractor as
     a future acceptance spec. All three are now false.
   - Updated the cost-calibration memory: enrichment is no longer "frozen";
     gate discipline and the seam stop-rule are recorded.
   - Gates green: agent-wiki (+self-test), doc-currency, fact-consistency,
     doc-symbol-refs, build-claim-freshness.

### Commits

- `9d02b322` — Enable segment-comparison at the enrichment institution seam
- `2f61be66` — Widen consumer-scope contract to allow enrichment segment-comparison
- `2ba72222` — Add request-1002912 Lunenfeld-Tanenbaum fixture row and unit pins
- `00b98a2b` — Wave 6 live pair gate PASS 157/157 (enrichment flip)
- `8b5b3deb` — Frozen-40 gate rerun with enrichment segment-comparison flip landed
- `2bfb3000` — Reconcile plan doc for Wave 6 enrichment seam opt-in landing
- `b9f023ef` — Compose legacy + staged institution checkers at the enrichment seam
- `c632a90f` — Merge enrichment segment-comparison composite (production deploy)
- `895d1f91` — Merge cycle-unresolved pair-consistency measurement tool
- `363490ea` — Sweep: reconcile wiki + memory after Wave 6 composite promotion

## Next Items

### Blocked — Waiting On External Response

1. **Initial Assessment pilot: administrative evidence.**
   Evidence: `docs/INITIAL_ASSESSMENT_CONTROLLED_PILOT_2026-07-30.md` §"Required
   follow-up" item 5; `docs/CURRENT_WORK_QUEUE.md` item 1.
   Justin emailed Connor on 2026-08-09 with the brief at
   `outputs/sharepoint-admin-check-brief.md` (untracked). Four read-only checks:
   library version limit, second-stage recycle bin, Purview retention policy
   scoped to the akoyaGO site, and ordinary-editor permission level. The app
   holds only `Sites.Selected` and cannot self-answer these (site-permission
   enumeration returns 403; retention-label read returns no fields, which is
   ambiguous rather than negative). **When answers arrive:** record them as
   verified evidence in the pilot report, which closes the administrative half
   of the gate. Do not treat silence as a pass.

### Verified Open

1. **Workbench version history, administrator restore, and milestone
   snapshots.**
   Evidence: pilot report evidence matrix row "Workbench history/restore and
   milestone freeze" — classified PLANNED with **no current producer/action**.
   This is the product half of the same gate and is genuinely unbuilt. Current
   metadata readback (version + last-modified) is live; there is no history
   view, no admin restore, and no milestone snapshot row/artifact.
   **Sequencing note:** worth designing against Connor's answers — if the
   library version cap is low, milestone snapshots become the mechanism that
   preserves the original AI draft rather than a convenience.

### Owner Decision Needed

1. **Whether the cycle measurement tool gets live evidence re-discovery.**
   Evidence: `benchmarks/institution-pair-consistency/results/cycle-measure-d26-full-2026-08-09.json`
   (funnel: 437 suggestions → 415 persons → 249 in scope → 216 with a claimed
   institution → 0 with evidence anchors).
   Measuring the unresolved population cycle-wide means fetching ORCID/OpenAlex
   bylines for ~216 candidates. The cheaper alternative already exists: the
   per-request roster replay used on 1002914 can be pointed at any request on
   demand. Justin said he would test further and come back.

2. **Whether `DEVELOPMENT_LOG.md` is revived or formally retired.**
   Evidence: file tail reads "Last Updated: May 14, 2026"; no Stage 1 or Wave 6
   milestone entries exist despite two production cutovers. No entry was added
   this session by design (the `/stop` contract defaults to skipping).

3. **Whether the "August 10 gate" in the work queue is a live external
   commitment.**
   Evidence: `docs/CURRENT_WORK_QUEUE.md` item 1 names it; the doc's frontmatter
   `last_verified` is 2026-07-30 and the pilot report itself does not name that
   date. Confirm before treating it as a deadline.

### Parked

1. **Stage 2 typed institution relationships.**
   Evidence: `docs/INSTITUTION_PAIR_CONSISTENCY_RESOLUTION_PLAN.md` Stage 1
   stop-rule and Wave 6 seam stop-rule.
   Would resolve the remaining cross-tier inconsistency (Harvard↔HMS,
   Dana-Farber) and the residual conservatism seen on request 1002914 (e.g.
   "Henry Ford Health" vs "Department of Dermatology, Henry Ford Health,
   Detroit" does not clear, likely because that institution does not resolve
   cleanly upstream). Nothing is currently blocked on it. **Re-open trigger:** a
   named owner decision, not accumulated findings.
2. **Retired-table operational scripts** (25 non-archive scripts referencing the
   dropped `reviewer_suggestions` table). Evidence: work queue "Audit
   follow-ups". Needs owner-approved scope and caller review.
3. **Dependabot advisories** (2 moderate on the default branch).

### Verify Before Acting

1. **Any claim that the enrichment path is "frozen" or "behavior-identical."**
   Evidence: superseded as of `c632a90f`. The plan doc marks the old statements
   historical rather than deleting them — read the Wave 6 section, not the
   Wave 4 one, for current behavior.
2. **Production resolver authority.** Still `legacy-default`. Verify live
   configuration before claiming any other mode; a Ready deployment does not
   change configured authority.

### Do Not Reopen Without New Decision

1. **The ROR strategic-reset assignment that opened Session 409.** It is
   answered: arm-2 measured, headroom falsified, do-not-inject recorded in
   `docs/INSTITUTION_PAIR_CONSISTENCY_RESOLUTION_PLAN.md`. Re-opening requires
   an institution-resolution-bound benchmark (e.g. short-form affiliations),
   not another run of the frozen 40.
2. **Further iteration on the institution checker or the enrichment seam.**
   Two explicit owner-directed stop-rules ("Fix it, but I think you're starting
   to chase your tail", 2026-08-09). Findings freeze-and-document to Stage 2.
3. **Promotion based on the Session 408 15-row diagnostic.** It compares
   different contracts and is not a promotion gate.

## Key Files Reference

| File | Purpose |
|------|---------|
| `lib/services/workbench/enrich-recommended-service.js` | Enrichment seam; composite checker construction (~:643) and `institutionEvidenceConnectsIdentity` (~:158) |
| `lib/services/institution-affiliation-consistency.js` | The checker itself — frozen, 6 adversarial rounds; do not edit |
| `tests/unit/institution-checker-consumer-scope.test.js` | Machine-enforces which consumer gets which checker semantics |
| `benchmarks/institution-pair-consistency/run-pair-gates.js` | Live 157-row pair gate; frozen provenance artifacts |
| `benchmarks/institution-pair-consistency/measure-cycle-unresolved.js` | Read-only cycle measurement CLI |
| `docs/INITIAL_ASSESSMENT_CONTROLLED_PILOT_2026-07-30.md` | Pilot evidence matrix + required follow-up |
| `outputs/sharepoint-admin-check-brief.md` | Brief sent to Connor (untracked) |

## Testing

```bash
# Focused suites for the institution surface
npx jest tests/unit/institution-checker-consumer-scope.test.js \
  tests/unit/institution-pair-segment-comparison.test.js \
  tests/unit/enrich-recommended-institution-evidence.test.js \
  tests/unit/benchmarks/institution-pair-consistency-fixtures.test.js \
  tests/unit/benchmarks/run-pair-gates-offline.test.js \
  tests/unit/benchmarks/measure-cycle-unresolved-offline.test.js --runTestsByPath

# Live pair gate (real OpenAlex calls; new slug required, refuses overwrite)
node benchmarks/institution-pair-consistency/run-pair-gates.js --slug <new-slug>

# Cycle measurement (read-only Dataverse; omit --cycle to list cycles)
node benchmarks/institution-pair-consistency/measure-cycle-unresolved.js \
  --cycle D26 --slug <new-slug> [--limit N]
```
