# Session 275 Prompt: Reviewer engagement build (Phase 1) + land the bundle

## Session 274 Summary

Three threads this session: (1) honorarium **capture-only** deferral + backfill (merged), (2) **email-template hub** in Profile Settings + invitation rework (merged), (3) a full **reviewer-engagement redesign → spec** plus a reliability-guardrail memory and a link-permanence doc correction (on a held, pushed, **unmerged** branch).

> **WHERE THE WORK IS:** the reviewer-engagement design + this handoff live on branch **`chore/reviewer-flow-docs-and-citation-memory`** (pushed, not merged). `main`'s SESSION_PROMPT stays at S274 until the bundle merges — **to resume, check out that branch.**

### What Was Completed

1. **Honorarium capture-only deferral + backfill** — merged (PR #34)
   - `ensureHonorariumOnboarding` returns `status:'deferred'` AFTER capturing contact+address but BEFORE minting the `akoya_request`/calling BILL, when `HONORARIUM_ONBOARDING_DEFERRED=true` OR the discriminator GUIDs are unset. No throw → no per-reviewer warning email; one non-emailing `honorarium_capture_only` notice. Address-PATCH-failure and partial-GUID-config get emailing warnings.
   - `scripts/backfill-honorarium-capture-only.mjs` — cycle-scoped (`--cycle`), dry-run default, reuses the idempotent orchestrator.

2. **Email-template hub in Profile Settings** — merged (PR #35)
   - "Request Abstract Email" (renamed from "Grantee Invitation Email"); new **Reviewer Emails** card (the 6-type `EmailTemplatesModal`, same pref key as Workbench); retired the dead legacy cluster (deleted `SettingsModal`, `EmailGeneratorModal`, `EmailTemplateEditor`, `EmailSettingsPanel`).
   - Invitation reworked to surface proposal details (title/PI/co-PIs/institution/abstract) for early COI; PI = projectleader-only; co-PIs from the `wmkf_apprequestperson` junction.

3. **Reviewer engagement redesign → spec** — held branch (unmerged)
   - Settled on **MODEL B (accept-now):** reviewer **accepts + onboards at the offer stage** (COI/AI acks + mailing address; honorarium capture-only), sits tight, then the PD **releases the proposal** later. The "hold / agree-in-principle" flow is **dormant** (`isProposalReadyForReviewers()` hardcoded `true`) and NOT used in this design.
   - `docs/REVIEWER_ENGAGEMENT_SPEC.md` — Model B spine (verified vs live code) + four additions: **Release-to-reviewers**, **two reminders** (respond-by per-reviewer offset; review-due), **PD-confirmed quota** notify + selective decline (writes `withdrawn_sufficient`), **state-split token TTL** (invite=review-due cap, materials=long; no JWT extension). 4-phase sequencing; new Dataverse fields as a dependency. **Codex-vetted** (all 7 verified-citations confirmed; Part-2 findings folded in — esp. token-cap must ship WITH Release).
   - **Link-permanence correction:** docs claimed "the URL doesn't change across the journey" — wrong; `render-emails` re-mints per email (latest-link-wins). Corrected 3 design docs + 2 email-template strings.
   - **New always-read memory** `feedback-behavior-claims-cite-the-producer` — tag behavior claims `[verified file:line]`/`[unverified]` even in chat; read the PRODUCER not the consumer; plan ≠ built state. (Born from this session's repeated assert-without-verify failures.)

### Commits — branch `chore/reviewer-flow-docs-and-citation-memory` (pushed, UNMERGED)
- `586d5be8` citation/producer-trace memory
- `ff3c5a1a` link-permanence doc/copy corrections
- `c04bc647` Codex Model-B interpretation snapshot
- `ca0b92ac` reviewer engagement spec
- `18933df3` spec revised per Codex sanity pass
- (+ this SESSION_PROMPT commit)
- Merged to `main` earlier this session: **PR #34** (honorarium), **PR #35** (email hub).

## Potential Next Steps

### 1. Land the bundle — DONE
Merged via PR #36 (squash, 2026-06-21). Branch deleted.

### 2. Reviewer-engagement build (schema dependency CLEARED ✓)
Per `docs/REVIEWER_ENGAGEMENT_SPEC.md` §4, the 9 new Dataverse fields (8 campaign-config columns on `akoya_request` + `wmkf_respondremindersentat` on the suggestion) were **provisioned in prod 2026-06-21** (`lib/dataverse/schema/wave7-reviewer-engagement/`, applied + published + verified). The schema is no longer a blocker — build can proceed. Order:
- **Phase 1:** per-request campaign config (discrete columns) + panel "days to respond" (offset) change. No token behavior change yet.
- **Phase 2:** Release-to-reviewers action + token TTL (ship together) + the upload `materials_sent` guard.
- **Phase 3:** two reminders (daily cron) + `wmkf_respondremindersentat`.
- **Phase 4:** quota count-after-write + conditional notify + PD selective decline.

### 3. Model-B invitation copy fix (small, anytime)
The shipped invitation copy still says "no commitment today, COI/AI + honorarium come later" (Model A). Change to "you confirm COI/AI + honorarium details when you accept; the proposal follows later." See SPEC §5.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/REVIEWER_ENGAGEMENT_SPEC.md` | The build spec — Model B + 4 additions, phases, schema, edge cases |
| `docs/REVIEWER_ENGAGEMENT_PLAN_INTERPRETATION.md` | Codex's Model-B flow interpretation (mermaid + open questions) |
| `lib/bill/honorarium-onboard-orchestrator.js` | Honorarium capture-only deferral tier |
| `scripts/backfill-honorarium-capture-only.mjs` | Go-live backfill for capture-only reviewers |
| `pages/profile-settings.js` | Email-template hub (signature, Request Abstract, Reviewer Emails) |
| `.claude-memory/feedback-behavior-claims-cite-the-producer.md` | Reliability guardrail (cite the producer) |

## Gotchas / Continuity

- **Reviewer flow is Model B (accept-now) LIVE today** because `lib/external/proposal-readiness.js::isProposalReadyForReviewers()` returns hardcoded `true`; the HoldView path is dormant. Don't reintroduce the hold/finalize two-step.
- **Reviewer secure links are NOT stable across emails** — `render-emails` re-mints per email; "latest link wins." Use the link in the most recent email.
- **Honorarium is capture-only this cycle** (discriminator GUIDs unset) — address captured, no `akoya_request` minted, no per-reviewer alert.
- The held branch is the source of truth for the reviewer-engagement work; the two interpretation/spec `.md` files supersede each other in that order.
