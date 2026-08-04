# Session Prompt: Deploy the Reviewer Find baseline revert (Session 396)

> **Owner-directed handoff, 2026-08-03 (late).** Session 395 post-mortemed the
> warm-performance debacle and built the recovery branch. Your ONE job:
> get production functional (the owner's boss can use the app, slow is fine),
> then stop. Run `/start` first.

## Objective (owner's words)

Restore the app to its "fine, just slow" state. No reconcile buttons, no
per-card evidence-repair actions, checkboxes on previously-found reviewers.
Latency work is explicitly deferred until the owner approves a new,
incremental, tier-gated plan.

## Where things stand

- **[VERIFIED] Branch `reviewer-find-revert-baseline`** holds the recovery:
  runtime tree (lib/pages/shared/tests/scripts/package.json/.github) restored
  byte-for-byte to `94c5b9d9` (2026-08-01 22:36 — plan docs locked, zero
  implementation; the last tree with no identified defect), plus the one
  genuine keeper from the hotfix chain: `institution-coi-context.js`
  strict-GUID → permissive `isGuid` (from `edbe6931`; that bug predates the
  rollout). Docs/memory kept at HEAD as history.
- **[VERIFIED] Green on the branch:** `check:types`, all 527 unit suites
  (6,412 tests), `npm run build`.
- **[VERIFIED] Data is safe:** the rollout added zero DB migrations, zero
  env/cron requirements; all its state lives inside the roster `candidate`
  JSONB, which baseline code treats as opaque and passes through; staff
  identity confirmations / address attestations from the incident window use
  pre-existing field names baseline code reads. Nothing was promoted, invited,
  or emailed during the incident.
- **[NOT DONE] Not deployed, not pushed, not merged.** Production still serves
  the broken `7072d52a`-era build.
- Branch `reviewer-find-outcome-contract` holds Session 395's earlier
  forward-fix work (repair plan, regression fixtures, R0/R1 Codex reviews).
  It is ABANDONED as a direction — keep for history, do not merge.

## Post-mortem (read before doing anything clever)

`.claude-memory/feedback-latency-plan-scope-accretion-postmortem.md` — the
short version: a Friday-night latency plan self-expanded into a fail-closed
receipts/authority rewrite presented as "settled decisions," implementation
started 31 minutes after the plan was locked, 76 commits went direct to
auto-deploying `main` with no tier gate, verification never constructed the
production data shape, and five stacked hotfixes entrenched the breakage.
Superseded docs: `REVIEWER_FIND_PERFORMANCE_PLAN.md`,
`REVIEWER_WARM_STAGE_PRODUCER_SPEC.md`, `REVIEWER_FIND_BROWSER_TEST_PLAN.md`.

## Next steps, in order (this session's whole scope)

1. `/start` housekeeping on branch `reviewer-find-revert-baseline`; re-run the
   branch's own gate suite (baseline `package.json` — its `check:*` list is
   the authority, not the one in the /start skill text) and full unit tests;
   expect green as recorded above.
2. Expect and triage doc-drift gates only: docs at HEAD may reference removed
   code paths (`check:doc-symbol-refs`, `check:build-claim-freshness`,
   memory-drift advisories). Fix by marking docs historical/superseded —
   NEVER by resurrecting code.
3. Push the branch, create a Vercel **preview** deployment, and have the
   owner smoke it: warm roster for Request `1002903` shows previously-found
   reviewers with checkboxes; no "Reconcile previously found reviewers"
   button; no per-card "Refresh … evidence" actions; Katherine Ferrara and
   Kanaka Rajan rows render. Kanaka may show identity/institution caution
   copy — that's the pre-rollout state, acceptable.
4. On owner approval ONLY: merge to `main` (this is the deliberate Tier
   promotion), confirm the production deployment is Ready and serving, owner
   re-smokes production.
5. Close out durable surfaces: incident doc
   (`REVIEWER_FIND_WARM_RECONCILIATION_INCIDENT_2026-08-03.md`) → resolved-by-
   revert note + `status: historical`; memory router Task Routing lines for
   the incident; `DEVELOPMENT_LOG.md` entry; rewrite this file for the next
   session.
6. If time and owner energy allow, verify staff-authority data survived in
   the UI (a row confirmed during the incident still shows its confirmation).
   Read-only checks only.

## Do not

- Do not merge or push `main` without the owner's explicit go after the
  preview smoke.
- Do not start latency/performance work of any kind. The future latency
  effort requires a NEW owner-approved plan, tier-gated per
  `docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md`, built in small
  slices on top of working behavior.
- Do not cherry-pick anything else from `5b6757df..7072d52a` or from the
  `reviewer-find-outcome-contract` branch without owner sign-off.
- Do not send email, promote, or invite reviewers during verification.
  Request `1002903` stays read-only.
- Do not "fix" doc-drift gates by restoring deleted modules.

## Handoff summary

```text
Previous owner: Session 395 (Fable) — post-mortem + revert construction
Branch: reviewer-find-revert-baseline @ (uncommitted at handoff-write time;
  commit lands as the session's final act — verify with git log)
Baseline: 94c5b9d9 runtime tree + edbe6931 GUID fix
Production: still broken (7072d52a era) until step 4
Data: untouched, verified revert-safe
Abandoned branch (keep, don't merge): reviewer-find-outcome-contract
Post-mortem memory: feedback-latency-plan-scope-accretion-postmortem
```
