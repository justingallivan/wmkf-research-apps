# Session 299 Prompt: Ops BILL/honorarium update + parallel-agent skill

## Session 298 Summary

Two parallel tracks ran via a git worktree (Codex on the admin dashboard, Claude
on a deep honorarium-payment investigation), then the worktree workflow itself was
turned into reusable tooling.

### What Was Completed

1. **Reverse-engineered the reviewer honorarium onboarding→payment reality** (live
   Dataverse probes, read-only). Key findings, all `[VERIFIED via probe 2026-06-27]`:
   - **Onboarding chain:** staff invites each reviewer into GoApply (87/87 have an
     `akoya_goapplyinviteurl`, invite precedes registration ~3.6d median) → reviewer
     **self-registers** under their own email (87/87, 0 staff submissions) → AkoyaGO
     sync provisions the contact (as a **non-vendor**) + honorarium `akoya_request`
     → **Connor manually classifies** it (the 2/19 edits) → then nothing.
   - **The wall:** **0 of 9,151** PAID disbursements ever went to an individual —
     the payment engine is **rail-agnostic** (ACH/check/BILL all just channels;
     pre-BILL grant #997034 paid by ACH through the same machinery) but
     **payee-bound to institutions**. Honoraria have 0 payment rows, 0 vendor
     records. "Mimic Rosie's grant flow" = a payee-model capability question for
     Connor/Sarah/Bromelkamp, not a portal task.
   - **Approvals are two-stage:** a human advances the `akoya_folio` state machine
     (Ready To Send → Ready to Pay, e.g. Sarah Hibler) in Dataverse; the money-out
     approval happens in BILL/offline (the `wmkf_*approval` flag-fields are all
     null/false even on the paid $900K grant #1002238).
   - **PNI-without-API scoping:** the BILL PNI is the asset (16-digit, leading-0
     format from 301 live values); without API access friction is *relocated*, not
     removed. Recommendation: build a small self-report "BILL account? + PNI"
     segmentation field (persist on the contact), not the kludgy signup-help infra;
     the real lever is BILL API access. Steph: addresses obsolete going forward
     (kept for now).
   - Captured in `.claude-memory/project-honorarium-payment-landscape.md` (new) +
     extended `akoya-payment-field-semantics.md` and `akoya-request-honorarium-nomenclature.md`
     + a dated probe note in `docs/BILL_HONORARIUM_INTEGRATION_DESIGN.md`.

2. **Admin dashboard Dataverse-info buttons** (Codex, in a parallel worktree).
   Each Dataverse-backed admin card (Email Defaults, Policies, Prompt Templates,
   honorarium amount) gets an ⓘ button revealing the backing entity/field/row for
   manual Power Automate edits. Reviewed read-only (in scope, no shared-primitive
   edits, **all field mappings verified against live `pages/api/admin/*` routes**),
   lint 0 / build clean. **Merged + deployed to prod** (READY on `applications.wmkeck.org`).

3. **Parallel-agent worktree workflow → reusable tooling.**
   `docs/PARALLEL_AGENT_WORKTREE_RUNBOOK.md` (command-level how-to, keep-and-reuse vs
   teardown, gotchas) + `scripts/bootstrap-machine.sh` (idempotent per-machine setup:
   `.agents/skills` symlink, path-derived auto-memory symlink, `npm install`,
   `.env.local` presence check; optional `--worktree NAME`; verified idempotent) +
   a dev-environment wiki pointer. The Codex worktree is **parked** at
   `../WMKF_Apps-codex` on `codex/parked` for reuse (node_modules + symlinks intact).

### Commits
- `19db48f0` - Person-vs-institution payee + BILL vendor-id field divergence
- `ebcf18b7` - Reverse-engineered honorarium onboarding→payment current-state
- `db742c72` - PNI-without-API scoping conclusion
- `8d694a34` - Merge codex/admin-card-dataverse-info (Dataverse field-info buttons)
- `ae99ace5` / `ed56e384` / `9d0107b5` - Worktree runbook (+ keep-and-reuse, bootstrap req)
- `760e47e7` - scripts/bootstrap-machine.sh

## Next Items

> **S299 progress (2026-06-28):** Ops/Steph BILL-honorarium update **drafted**
> (`scratchpad/ops-bill-honorarium-update.md` — ready to send/convert). **Thread 2
> RESOLVED + REFUTED** — the `wmkf_*approval` fields are NOT dead org-wide (3 of 4
> populated; only `wmkf_controllerapproved` unused); see
> `.claude-memory/project-honorarium-payment-landscape.md` + the probe
> `scripts/probe-akoya-approval-flags-deadness.js`. **`parallel-agent-worktree`
> skill shipped** (commit `ca07945e`). **New scope decision:** our app *may* set
> `wmkf_authorizationtoremitpaymentflag` when a review lands (`wmkf_reviewreceivedat`)
> as a fulfillment/eligible-to-pay trigger — all approvals stay out of scope (tracked
> candidate, not committed).

### Standing Dangling Threads (full memory + design-doc sweep, S299 2026-06-28)

A consolidated register of every genuine loose end found across `.claude-memory/`
and `docs/`. None are silently abandoned — each has an owner, blocker, or rationale.

**Actionable now — no external blocker**
1. ~~**Honorarium Thread 1**~~ **(DONE 2026-06-28)** — Connor's classification is a
   FIXED TEMPLATE (Individual / Honorarium / Research Reviewer / $250 flat / cycle
   meeting-date), no per-reviewer judgment → fully automatable. Probe:
   `scripts/probe-akoya-honorarium-classification-step.js`; detail in
   `.claude-memory/project-honorarium-payment-landscape.md` chain step 4.
2. ~~**SerpAPI hobby-tier cost eval**~~ **(DONE 2026-06-28)** — usage was ~1.7% of the
   15k Production plan, so Justin **downgraded to Developer ($75/mo, 5k)** (confirmed via
   account API), saving ~$75/mo. Cost fact reconciled across 5 files. Evidence:
   `.claude-memory/project-serpapi-capability-erosion.md`.
3. ~~**Stale-audit cleanup**~~ **(DONE 2026-06-28)** — verified BOTH F-001 and F-002
   are resolved in code (relationship restriction check present; ALS migration complete,
   0 shim callers, fails closed) and the drain-table "deferred cleanup" is superseded
   (dropped via migration 018). Doc stamped. Only the generic write-helper restriction
   policy remains an owner decision. Evidence: `docs/CORRECTED_AUDIT_FINDINGS_FOR_CLAUDE_REVIEW_2026_05_26.md`.
4. **Docs ARCHIVE batch (follow-up from the staleness audit)** — Codex audited all 309
   `docs/` files (`docs/DOCS_STALENESS_AUDIT_2026-06-28.md`, merged 2026-06-28). The 2
   DELETEs are done; **40 files are recommended ARCHIVE** and deferred. Apply in a focused
   batch: either add an in-place `Status: historical` banner, or move to `docs/archive/`
   **with every exact-path reference updated first**, then run `check:doc-symbol-refs` +
   `check:canonical-pointers` sequentially. Most ARCHIVE items have inbound refs — don't
   bulk-move blind.

**Blocked on a named owner / decision**
1. **Reviewer-Workbench access boundaries** (3 unresolved: team-open read set?
   reviewer-mgmt = lead PD only? writeup-edit perms + CSO/President view?) → **Justin**.
   Evidence: `.claude-memory/project-reviewer-apps-redesign-direction.md`.
2. **BILL API access** — the only thing that *removes* (vs relocates) honorarium
   friction; portal-integrated onboarding is built + gated → **Ops/leadership**.
3. **Self-report PNI segmentation field** — build the small version now or wait? → owner.
4. **Applicant-exclusion policy** — how broadly may a PI exclude reviewers, on what
   basis → **foundation/stakeholders**. Evidence:
   `.claude-memory/project-applicant-exclusion-policy-pending.md`.
5. **Awardee onboarding** — GAL-sent status field is unknown; must be discovered in
   Dataverse before any build → **Connor**. Evidence: `.claude-memory/project-awardee-onboarding.md`.
6. **Dataverse settings auditing** → **Connor** (re-open when he sets scope + retention
   and flips the `wmkf_appsystemsetting` audit flag). Evidence:
   `.claude-memory/project-dataverse-settings-audit-enablement.md`.
7. **GRANTEE_PORTAL title-field provenance** (`wmkf_wmkfprojectdescription` vs
   `wmkf_projecttitle1`) → **Connor + Sarah** (doc-only; doesn't block the build).
   Evidence: `docs/GRANTEE_PORTAL_BUILD_PLAN.md`.

**Gates a real launch (soft deadlines)**
1. **Stage-2A pre-cycle TODOs** — COI policy body still `[PLACEHOLDER]`; `wmkf_policy*`
   delete-privilege role unrestricted. Both before slice 1 ships to a real cycle.
   Evidence: `docs/REVIEWER_STAGE_2A_BUILD_PLAN.md`.
2. **Intake-portal virus-scan E2E** — must run before the portal goes live to real
   applicants. Evidence: `.claude-memory/project-intake-portal-virus-scan-e2e-deferred.md`.
3. **J27 cluster (~Dec 2026)** — `wmkf_requestdocument` doc-capture table,
   grant-phasing relabel model, ~300-proposal triage dashboard, prompt-storage
   Phase 1/2. Design-locked; awaiting next cycle + Connor/Sarah form design.

**Parked by design / already tracked**
PD-override-correction sync (`docs/agent-wiki/topics/reviewer-identity.md`) ·
honorarium BILL capture-only lock · Wave-1 role-elevation revert · drain-table drops
(date-gated 2026-07-01) · VRP/Perplexity provider coupling · Dynamics sandbox stale
schema · nomenclature/app-sunset sweep · deferred code cleanup ·
`docs/REVIEWER_IDENTITY_RECONCILIATION_EDITS.md` four doc-hygiene questions.

### Verify Before Acting

1. **Long-stale pre-S294 carryovers** (model real-replay signoff, request `1002788`
   triage, Restore-Removed-Candidates E2E, reviewer-portal upload design). Verify
   each against source/docs/probes before treating as actionable.

### Do Not Reopen Without New Decision

1. **c01a9baa reviewer-email-defaults deploy** — confirmed live this session (Vercel
   shows the deployment READY in production); S297's open verify-item is **DONE**.

2. **Reviewer↔CRM-contact boundary epic** —
   `docs/REVIEWER_CONTACT_BOUNDARY_GAP_FINDINGS.md`; email/affiliation stay alert-only.

## Key Files Reference

| File | Purpose |
|------|---------|
| `.claude-memory/project-honorarium-payment-landscape.md` | The reverse-engineered honorarium onboarding→payment current-state + Ops scoping. |
| `docs/PARALLEL_AGENT_WORKTREE_RUNBOOK.md` | How to run Claude + Codex in parallel via a worktree. |
| `scripts/bootstrap-machine.sh` | Idempotent per-machine setup (symlinks, npm install); run after cloning on a new machine. |
| `shared/components/admin/DataverseFieldInfoButton.js` | The admin Dataverse-info popover component (Codex). |

## Testing

```bash
./scripts/bootstrap-machine.sh           # idempotent; reports all-green on a set-up machine
npm run check:agent-invariants           # symlink invariants
npm run check:agent-wiki                  # dev-environment topic pointer
# Codex worktree reuse next time:
git -C ../WMKF_Apps-codex fetch origin && git -C ../WMKF_Apps-codex checkout -B codex/<task> origin/main
```

## Gotchas / Continuity

- **Codex worktree is parked, not torn down** at `../WMKF_Apps-codex` (`codex/parked`).
  Reuse it; don't recreate. Its `.env.local` is a symlink to the main repo's.
- **`scripts/bootstrap-machine.sh` never creates `.env.local`** (secrets) — provision
  separately (secure copy, or `vercel env pull` + hand-fill Sensitive vars).
- The honorarium findings are investigation/analysis, not shipped code — the only
  prod change this session was the admin info-buttons.
