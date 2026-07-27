# Adversarial Review of Session 364 — Reviewer-Holistic M1 Work

- **Reviewed:** 2026-07-17 (Session 365), by Claude, at the request of the owner.
- **Scope:** commit `e94e8f78` ("Complete M1 identity v2 and record scoped pilot")
  on branch `codex/m1-evaluation-foundation`, the local
  `outputs/reviewer-holistic-m1/` artifacts, and the Session 364 handoff on
  `main` (`5a122755`).
- **Method:** every material claim was recomputed from raw artifacts or
  re-executed with the branch's own code (in a scratch worktree at the branch
  tip), not accepted from docs. Verification labels follow
  `docs/CLAUDE_REMEDIATION_PLAN.md` conventions.
- **Verdict:** all Session 364 claims survive falsification; no correctness
  defects. Two MEDIUM process/coverage findings (F1, F2) should be fixed before
  the next evaluation cycle. Nothing here invalidates recorded results.

> **Current privacy follow-up (2026-07-27):** this remains a historical review
> of the named commit. The four production proposal cohort/evaluation/manifest
> files referenced below are no longer tracked operational inputs; their public
> paths now contain aggregate receipts. Current planner, runner, probe, and
> validators require explicit external files, and public tests use synthetic
> fixtures. Present-tense statements below describe the reviewed 2026-07-17
> tree unless a follow-up note says otherwise.

## 1. Claims verified (all reproduced empirically)

### 1.1 Identity benchmark v2 `[VERIFIED via data]`

- `docs/audits/reviewer-holistic-identity-benchmark-v2.json` (branch): 40 cases,
  strata 20 hazard / 20 clean_positive, labels **25 Bind / 15 Abstain**
  (`expected.abstain` counted directly). v1 remains 23/17.
- Case-by-case diff v1→v2 shows **exactly** the four owner clarifications and
  nothing else:
  - `hazard-02-robert-sang`: Abstain→Bind, anchor `orcid:0000-0002-4582-8544`.
  - `clean-07-will-harcombe`: Abstain→Bind, anchor `orcid:0000-0001-8445-2052`.
  - `hazard-05-li-huei-tsai` + `hazard-19-li-huei-tsai-correction`: ORCID anchor
    corrected `0000-0003-1262-0592` → `0000-0001-5607-113X` (labels unchanged).
  - `hazard-15-alexandria-landsman`: anchor upgraded institutional-profile →
    `orcid:0000-0002-8194-8439` (label unchanged).
- Import v2 (`reviewer-holistic-identity-labeling-import-v2.json`): 40 rows,
  workbook sha256 `fdabbb94…183c94` matches the hash recorded in
  `docs/REVIEWER_HOLISTIC_REVIEW_IMPLEMENTATION_PLAN.md`.
- The import↔benchmark cross-check in
  `scripts/lib/reviewer-holistic-m1.js` (`validateIdentityLabelingImport`) is
  strong: per-case normalized-label equality against frozen expected labels,
  deterministic blind-ID mapping, exact 40-row coverage, version pairing
  (`IDENTITY_IMPORT_VERSIONS`), and benchmark-version match. Verified passing,
  including `--require-frozen`, by running the branch validator.

### 1.2 Frozen v1 assets untouched `[VERIFIED via git + data]`

- `e94e8f78` touches only: plan doc, manifest, the two new v2 assets,
  `scripts/lib/reviewer-holistic-m1.js`,
  `scripts/validate-reviewer-holistic-m1-assets.js`, and one line of
  `tests/unit/reviewer-holistic-evaluation-manifest.test.js`.
- At the reviewed commit,
  `docs/audits/reviewer-holistic-proposal-evaluation-v1.json` had 0 runs / 0
  scores / 0 armMembership — "unchanged and unscored" was accurate.
  The 60 completed runs live only in local `outputs/…/execution-v1.json`
  (60/60 `completed`).

### 1.3 Run provenance survives the manifest edit `[VERIFIED via command]`

- Recomputed the manifest fingerprint with the branch's own canonicalization
  (`scripts/lib/reviewer-holistic-run-plan.mjs` `sha256Canonical` over
  `{evaluationScriptVersion, baseline, redesign, execution, proposalEvaluation,
  runtimeConfig}`): `837d8a70467be4572693dca30ff02c7f81361dd56eb0cdd9b21afe32fb0ebe56`
  **both before and after** the fixtureVersion edit, matching
  `execution-v1.json.manifestFingerprint`. The fingerprint input excludes
  `identityBenchmark`, so the paid run's recorded contract is genuinely
  unaffected by the v1→v2 flip.

### 1.4 Scoped 10-per-proposal pilot integrity `[VERIFIED via recomputation]`

- `scoring-package-v1.json`: 345 candidates across 10 proposals.
- Pilot scored artifact
  (`reviewer-holistic-m1-10-pilot-scored-v1.json`): 100 candidates = **exactly**
  the first 10 package rows per proposal (0 subset violations, 0 outside
  first-10); arm memberships match the original `unblinding-map-v1.json` with
  **0 mismatches**.
- Recomputing per-arm aggregates from raw `candidateScores` +
  `candidateArmMembership` reproduces
  `reviewer-holistic-m1-10-pilot-comparison-v1.json.aggregateByArm` exactly:
  - baseline: 74 candidates, 73 correctPerson, 61 shortlist, **61 eligibleShortlist**
  - redesign: 74 candidates, 68 correctPerson, 61 shortlist, **61 eligibleShortlist**
- Wrong-person rows: **6 total — 5 redesign-only, 1 in both arms
  (RPC-3FCCEABB562D); none shortlisted in either arm.** This matches the
  handoff's "five redesign-only wrong-person cases" and "no wrong-person
  candidate was shortlisted" claims, and the failure-analysis buckets in
  `reviewer-holistic-m1-10-pilot-failure-analysis-v1.md` match the raw data.
- `validateProposalEvaluation(pilotArtifact, {requireScored: true})` passes
  (re-run with the branch lib). Note: run through the CLI with a non-default
  proposal path, the manifest-consistency check is intentionally skipped
  (`validate-reviewer-holistic-m1-assets.js` guards it to the default path).

### 1.5 Gates and tests `[VERIFIED via command on branch worktree]`

- `tests/unit/reviewer-holistic-evaluation-manifest.test.js`: green (9 pass).
- `check:docs-catalog`, `check:fact-consistency`, `check:fact-consistency:self-test`: green.
- On `main` (Session 365 start): all 57 `check:*` gates + self-tests green.

## 2. Findings

### F1. MEDIUM — "Frozen" manifest mutated in place; freeze is asserted, not enforced

At the reviewed commit,
`docs/audits/reviewer-holistic-evaluation-manifest-v1.json` carried
`status: "frozen"`, yet `e94e8f78` edited `identityBenchmark.fixtureVersion`
v1→v2 **and updated the guarding unit-test literal in the same commit**
(`tests/unit/reviewer-holistic-evaluation-manifest.test.js:58`). The test pins
whatever the last commit says, so it is decorative against exactly this class of
edit. Session 364's own handoff guardrail ("create a new evaluation version and
manifest entry first") was honored for the evaluation assets but not for the
manifest itself.

Mitigations already in place: the edit is outside the fingerprinted region
(§1.3) and the plan doc records v1 as historical.

**Required change (pick one):** record fixture changes as an
amendment/history entry (or a `manifest-v2`) instead of rewriting the frozen
file; or explicitly document that `identityBenchmark` sits outside the
manifest's freeze scope (and why the fingerprint excludes it).

**Follow-up 2026-07-27:** operational manifests are external, versioned inputs;
the tracked path is an aggregate receipt. The validator requires an explicit
manifest file, so an in-repository test literal can no longer redefine the
operational freeze.

### F2. MEDIUM — Standing gate no longer validates the active fixture

`npm run eval:reviewer-holistic:m1` defaults to the **v1** identity pair
(`DEFAULT_IDENTITY_PATH` in `scripts/validate-reviewer-holistic-m1-assets.js:22-25`),
and **no code cross-checks `manifest.identityBenchmark.fixtureVersion` against
the benchmark assets** [VERIFIED via branch-wide `git grep fixtureVersion`]:
the only non-doc consumers are
`scripts/validate-reviewer-holistic-evaluation-manifest.js:178,286` (shape-check
only — non-empty string, no version set, no file existence) and
`tests/unit/reviewer-holistic-evaluation-manifest.test.js:61` (pins the
literal, updated in the same commit — see F1). The manifest declares v2 active,
but the v2 asset is validated only when its path is passed explicitly. A
corrupted or drifted v2 file keeps every standing gate green. Confirmed
empirically: the default run validates v1 and never opens v2.

**Required change:** derive the default identity path from the manifest's
`fixtureVersion` (fail closed if the file is missing), or validate both v1 and
v2 in the default run; add a consistency check that the manifest fixtureVersion
corresponds to an existing frozen benchmark.

**Follow-up 2026-07-27:** closed for the current CLI contract. There is no
implicit operational manifest default; the supplied external manifest selects
the identity fixture, and missing or mismatched inputs fail closed.

### F3. LOW — evaluationVersion conflation risk

The pilot scored artifact reuses
`evaluationVersion: "reviewer-proposal-head-to-head-v1"` — the same identifier
as the tracked, unscored 345-candidate freeze — distinguished only by
`scopeVersion: "reviewer-holistic-m1-10-per-proposal-v1"` in the scope
artifact. The handoff's "do not cite the pilot as the original result"
guardrail mitigates; a distinct evaluationVersion would be structurally safer
for any future artifact.

### F4. LOW — Fail-open filename fallback, contained

`identityImportFileFor()` in `scripts/validate-reviewer-holistic-m1-assets.js`
falls back to the **v1** import filename when a benchmark filename doesn't
match its regex. Downstream version cross-checks fail closed on any actual
mismatch, so residual risk is minimal. Optional hardening: error on
non-matching filenames instead of falling back.

### F5. Observations (no action required)

- "Preserves 245 excluded rows" was verified arithmetically (345 − 100, plus
  the workbook sha256 pinned in the scope artifact); the xlsx itself was not
  parsed in this review.
- One wrong-person row (RPC-1C26C14601DE, Ekesan) has
  `disqualifierReason: "None"` despite `correctPerson: false` — a workbook
  data-entry oddity; does not affect any aggregate.
- The 19-commit branch `codex/m1-evaluation-foundation` remains unmerged to
  `main`, consistent with the Tier-gated release posture; no production surface
  is touched by `e94e8f78`.

## 3. Conclusion

Session 364's record is accurate. The core substantive conclusion — the
redesign is not promotion-ready without a final fail-closed output filter
(redesign wrong-person 6/74 vs baseline 1/74, three carrying explicit
removed/excluded signals) — is well supported by the raw data. Fix F1 and F2
before the next evaluation cycle; F3/F4 are optional hardening.
