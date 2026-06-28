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

### Verified Open

1. **Draft the Ops/Steph BILL-honorarium update.**
   Evidence: `.claude-memory/project-honorarium-payment-landscape.md`.
   The evidence chain is complete; frame it around the conservation-of-friction
   point and the capability question (can AkoyaGO's payment engine take a `contact`
   payee at all?) to Connor/Sarah/Bromelkamp.

2. **Thread 1 — Connor's manual honorarium classification.**
   Evidence: landscape memory "open threads" + the 2/19 audit on #1002764.
   What exactly Connor sets, and whether that classification step is automatable.

3. **Thread 2 — confirm the `wmkf_*approval` flag-fields are dead org-wide.**
   Evidence: landscape memory; null/false on paid grant #1002238.
   Confirms the two-stage (Dataverse folio + BILL/offline) approval model.

4. **Write the `parallel-agent-worktree` skill.**
   Evidence: `docs/PARALLEL_AGENT_WORKTREE_RUNBOOK.md` "Turning this into a skill";
   `scripts/bootstrap-machine.sh` already exists for the skill to call.

### Owner Decision Needed

1. **BILL API access** — the only thing that *removes* (vs relocates) honorarium
   payment friction. Evidence: landscape memory scoping section. Decision for
   Ops/leadership; the portal-integrated BILL onboarding is already built and gated.

2. **Self-report PNI segmentation field on the reviewer portal** — build the small
   version now or wait? Evidence: landscape memory scoping section.

### Parked

1. **Dataverse settings auditing (Connor).** Evidence:
   `project-dataverse-settings-audit-enablement.md`. Re-open when Connor sets scope
   + retention and flips the `wmkf_appsystemsetting` table audit flag.

2. **PD-override-correction sync.** Evidence:
   `docs/agent-wiki/topics/reviewer-identity.md`. Re-open if the reviewer-contact
   boundary tail is resumed.

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
