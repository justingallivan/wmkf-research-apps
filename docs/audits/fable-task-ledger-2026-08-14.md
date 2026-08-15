# Fable Audit Task Ledger — 2026-08-14

**Point-in-time control-plane artifact** for the Fable Production Audit, Security, and Refactor
exercise (`docs/FABLE_AUDIT_SECURITY_REFACTOR_MASTER_BRIEF.md`). This is an audit working record,
not canonical architecture documentation.

## Phase 0 baseline

- Branch: `fable/audit-refactor-planning-2026-08-14`, created from `origin/main` @ `f8a606e6`.
  Upstream: **not pushed yet** — push `-u origin` before session end (non-main push does not deploy).
- Worktree at branch creation: clean; `main` synchronized with `origin/main`.
- Full `/start` gate battery (all 57 `check:*` scripts incl. self-tests, serial pairing): **all green**
  this session at `f8a606e6`. Not re-run for Phase 0 step 7; recorded as verified-this-session.
- Gate proof boundaries (what green proves / does not prove):
  - `check:api-routes` proves matrix **inventory coverage** of `pages/api/**`; it does NOT prove
    semantic authorization correctness of any route.
  - `check:atlas` proves referenced tables/entity sets have an Atlas page; NOT that page content is current.
  - `check:dataverse-access-layer` / `check:route-service-boundary` / `check:dynamics-context-boundary` /
    `check:odata-escape` prove boundary/law conformance shapes their AST census detects; NOT runtime authz.
  - `check:trust-boundary-guid` proves intra-file taint from `req.query`/`req.body` to known Dataverse
    selectors is GUID-guarded; interprocedural taint is a documented non-goal.
  - `check:secret-scan` proves no secret-shaped literal in the current tracked tree; NOT history.
  - Doc gates (`doc-currency`, `fact-consistency`, `doc-symbol-refs`, `build-claim-freshness`, etc.)
    prove registered drift patterns only; semantic drift outside registered patterns is uncovered.
- Audit baselines (pinned so scouts cannot pick different ones):
  - Last broad **security** audit: `docs/archive/SECURITY_AUDIT_2026-05-21.md` →
    baseline commit `04979f28` (last origin/main commit before 2026-05-22).
  - Last broad **documentation-truth** audit: `docs/audits/AUDIT_FULL_DOCUMENTATION_TRUTH_2026-07-26.md`
    → baseline commit `c2b57d07` (last origin/main commit before 2026-07-27).
- Campaign window / release posture: **[NEEDS OWNER]** — no current doc states the active window.
  Assuming the restrictive posture (no runtime writes are authorized in this exercise anyway).
- Production probes: standing owner rule `feedback-never-self-authorize-prod-dataverse-reads`
  applies and is NOT overridden by the brief — Fable never sets `DATAVERSE_ALLOW_PROD_READS`;
  Phase 2 commands are handed to Justin to run/approve (see probe ledger "who executes").

## Evidence-label legend

- `[VERIFIED via X]` — personally confirmed against source/probe/gate output X.
- `[INFERRED from X]` — derived, evidence chain named.
- `[CONFLICT]` — authorities disagree; both cited.
- `[UNKNOWN]` — could not be established with authorized means.
- `[NEEDS OWNER]` — policy/authority decision required.
- `[PRELIMINARY; REVERIFY]` — routing clue from brief/memory; not an accepted finding.

## Task ledger

| ID | Owner | Scope | Writable surface | Expected artifact | Start | Last progress | Disposition |
|---|---|---|---|---|---|---|---|
| P0 | Fable | Control plane: branch, baselines, ledger, skeletons | this branch | this file + 3 skeletons | 2026-08-14 | 2026-08-14 | done |
| S1 | Explore scout | Change/system inventory since baselines | none (read-only) | evidence table + top-5 risk surfaces | 2026-08-14 | launched | running |
| S2 | Explore scout | Semantic security route/side-effect map (T1/T2 surfaces excluded — Fable-personal) | none (read-only) | route trace table + defect-class findings | 2026-08-14 | relaunched after delegation-guard narrowing | running |
| S3 | Explore scout | Workbench performance/data-flow trace | none (read-only) | journey traces + duplicate-read census | 2026-08-14 | launched | running |
| S4 | Explore scout | Tests/gates/operability controls map | none (read-only) | enforcement map + false-confidence risks | 2026-08-14 | launched | running |
| T1 | Fable | Merge-candidates authorization trace (confirm/refute) | none | security-audit § finding | 2026-08-14 | confirmed; recorded | done |
| T2 | Fable | Reviewer token mint/regeneration eligibility trace | none | security-audit § finding | 2026-08-14 | divergence confirmed; recorded | done |

## Probe approval ledger (Phase 2)

No probes proposed yet. Every row must be complete and reviewed BEFORE execution.

| # | Target | Credential source | Operation | Who executes | Expected requests | Output class | PII redaction | Timeout | Read-only proof |
|---|---|---|---|---|---|---|---|---|---|
| — | | | | Justin (default for prod Dataverse) | | | | | |
