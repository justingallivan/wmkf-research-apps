# Session 315 Prompt: (open — pick from Next Items)

## Session 314 Summary

Two parallel streams on `main`, disjoint file sets, merged cleanly:
- **Claude (isolated worktree):** designed + drafted the **honorarium portal-creation
  strategy** for the no-BILL cycle — our app becomes the sole creator of reviewer
  honorarium `akoya_request`s. Verified against live prod Dataverse (read probes + one
  authorized `$1` sentinel create/read/delete, cleaned up + confirmed gone in AkoyaGO).
- **Codex (main tree):** continued **memory hygiene** — reduced router pressure,
  triaged pending/slice memories, code-grounded reviewer migration + identity memories,
  audited Dynamics/Power Tools and Batch B cleanup candidates, built the cleanup queue +
  Dynamics trim package, and reconciled the Dynamics AI-run docs / Explorer guard in
  `pages/api/dynamics-explorer/chat.js`. See `docs/audits/*-2026-07-02.md`.

### What Was Completed (Claude — honorarium)

1. **New strategy doc `docs/HONORARIUM_PORTAL_CREATION_STRATEGY.md`** — the source of
   truth. Portal is sole creator via the existing `ensureHonorariumOnboarding` pipeline
   with BILL deferred; reviewers no longer self-register through GoApply. Covers the
   verified create-body spec (set vs. auto-populated), the config flip, contact linkage,
   proposal linkage (Options A/C), and a schema-change tracker for Connor.
2. **Drafted create-body changes** (`lib/bill/honorarium-onboard-orchestrator.js`,
   `lib/bill/honorarium-discriminators.js`, `tests/unit/honorarium-onboard-orchestrator.test.js`;
   33/33 green). Fixed a **latent nav-casing bug** (`akoya_ProgramId`→`akoya_programid`,
   `akoya_PrimaryContactId`→`akoya_primarycontactid`) that would have 400'd the first real
   create; added the missing fields (all-three amounts, `akoya_requesttype`=Scholarship,
   derived `akoya_fiscalyear`, reminder-flags-off, proposal-referencing `akoya_title`);
   left `akoya_requestsource`/`akoya_requeststatus` to verified auto-population.
   **⚠️ DRAFT, config-gated, NOT live — nothing creates until the env flip.**

### Commits (Session 314, `0ec28d33..cd82c405`)
- `cd82c405` — Draft: honorarium create-body changes (Claude)
- `05d0a3f5` — Proposal-linkage design + schema tracker (Claude)
- `258341db` — Contact-linkage note (Claude)
- `0294d7f1` — Honorarium strategy doc (Claude)
- `de58be96` `1036c07c` `711f459e` `054ea96c` `1ab9c0ed` `4af56809` — memory hygiene / Dynamics (Codex)

### Worktree state
- **`.claude/worktrees/claude-parked`** on `claude/parked` at `cd82c405` — **parked for
  reuse** with `node_modules` + symlinks (`.env.local`, `.agents/skills`, harness memory
  slug). To reuse next Claude session: reset to `main` and branch fresh.
- `../WMKF_Apps-codex` parked on `codex/parked` at `1093492d` (Codex's).

## Next Items

### Verified Open (honorarium — this session)

1. **Config flip to turn honorarium creation on.** `docs/HONORARIUM_PORTAL_CREATION_STRATEGY.md` §2.
   Set the 3 discriminator GUIDs, unset `HONORARIUM_ONBOARDING_DEFERRED`, set
   `BILL_ONBOARDING_DEFERRED=true`, set `honorarium.default_amount`. Code draft is ready
   and gate-clean; this is the go-live gate.
2. **Connor — GoApply-linkage question** (doc §7). **Sent 2026-07-01, awaiting reply.**
   Does any payment/folio/Ops view require the `akoya_goapplyapplication/phase/submitter`
   lookups (absent on app-created rows)?
3. **Connor — honorarium→proposal self-lookup schema change** (doc §8/§9). Proposed
   `wmkf_relatedproposal` (`akoya_request → akoya_request`); Connor OK in principle, tracked
   in doc §9 for his end-of-work update. Once added: uncomment the TODO in the orchestrator
   create body and **confirm the exact nav-property casing from live metadata** first.
4. **Memory reconcile (hand to Codex).** `[[project-honorarium-payment-landscape]]` and
   `docs/agent-wiki/topics/finance-honoraria.md` still describe the pre-decision
   "capture-only / BILL-not-integrating" state — reconcile to reference the new strategy
   doc + the "app is sole creator" decision. Claude deferred all durable-memory writes this
   session (Codex owns memory hygiene).

### Verified Open (memory hygiene — Codex)

1. **Apply ready Dynamics memory trims now that Claude is parked.** Evidence:
   `docs/audits/memory-cleanup-queue-2026-07-02.md` and
   `docs/audits/memory-trim-package-dynamics-power-tools-2026-07-02.md`. First targets:
   `.claude-memory/project-dataverse-power-tools.md` and
   `.claude-memory/project-dynamics-explorer-reuse-power-tools.md`.
2. **Continue cleanup queue with Batch C or honorarium-memory reconcile.** Evidence:
   `docs/audits/memory-cleanup-queue-2026-07-02.md`; honorarium-specific reconcile is
   item 4 above.

### Verify Before Acting (carried from S313 — re-verify before acting)

1. **Confirm 1003125 shows all 5 renamed applicant reviewers** after the S312 roster cache
   clear. Have Duncan reload the Find tab. Evidence:
   `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md`.
2. **Other D26 requests may have been missed by the triage backfill.** Offered, not run: a
   read-only sweep of D26 `akoya_requests` that are `triage=null` and not `Phase II Pending`.
   Evidence: `pages/api/workbench/dashboard.js:166`.

### Verified Open (carried from S313)

1. **Applicant-suggested roster cache-staleness (product fix).** Editing an applicant
   reviewer after first enrichment won't reflect. Evidence:
   `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md`; `reviewer-search-logic.js:123`.
2. **Reviewer-materials attach-and-verify build (option 2).** Design captured (`a84e5f8b`),
   not built. Evidence: `docs/agent-wiki/topics/external-reviewer-portal.md`.
3. **Bracket-alias cleanup PR (email templates).** Drop legacy `[bracket]` aliases after
   soak — do NOT remove before greenlit. Evidence:
   `docs/EMAIL_TOKEN_SYNTAX_UNIFICATION_PLAN.md` §5; `[[project-email-template-token-syntax]]`.
4. **Surface 3 board-identity fields on Track Reviewers (read-only) + Excel export.**
   Carried S308→S314, not built. Evidence:
   `docs/REVIEWER_STAGE2A_IDENTITY_CAPTURE_BUILD_PLAN.md` §C step 9.
5. **Invite-modal: collapse campaign-timeline block into `<details>`.** Low effort, not
   greenlit. Evidence: `shared/components/reviewers/InviteEmailModal.js` (~L294-319).
6. **Reviewer nice-to-haves #4 & #5 unbuilt.** #4 reviewer-memory flag + searchable notes;
   #5 controlled expertise-tag taxonomy. Evidence:
   `docs/REVIEWER_WORKBENCH_NICE_TO_HAVES_PLAN.md` §4, §5.
7. **Optional `wmkf_firstname` trailing-whitespace pass.** Low-priority hygiene. Evidence:
   `docs/agent-wiki/topics/dataverse-dynamics.md`.

### Owner Decision Needed (carried from S313)

1. **Writeup-generator tab + reviewer-database browse.** Needs scope/prioritization.
   Evidence: `.claude-memory/project-workbench-consolidation-rollout.md`.
2. **Remit-flag on review-completion** — wire `wmkf_authorizationtoremitpaymentflag` on
   submit? Now intersects the honorarium strategy (doc §3b tracks the flag). Evidence:
   `.claude-memory/project-honorarium-payment-landscape.md`.

### Parked (carried from S313)

1. **Honorarium payment pipeline enablement.** Capture-only in prod
   (`HONORARIUM_ONBOARDING_DEFERRED` + 3 GUIDs absent). Re-open trigger: leadership decision.
   Note: the S314 strategy addresses request *creation*, not payment — payment stays
   offline. Evidence: `lib/bill/honorarium-onboard-orchestrator.js`; doc §1.
2. Longer carried list (BILL API access, PNI self-report, workbench access boundaries,
   applicant-exclusion, Dataverse settings audit, nomenclature/app-sunset sweep). Re-open
   trigger: owner prioritization. Evidence: `.claude-memory/MEMORY.md` router.

### Do Not Reopen Without New Decision (carried from S313)

1. **Digit-stripping name normalization is load-bearing (S312).** Evidence:
   `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md`.
2. **thankyou email has NO secure-link button (S311).** Intentional. Evidence:
   `pages/api/review-manager/send-emails.js`; `3817944e`.
3. **`{{proposalTitle}}` vs `{{proposalClause}}` are distinct (S311).** Evidence:
   `[[project-email-template-token-syntax]]`.
4. **Email template dual-syntax `[bracket]` aliases are intentional (S311).**
5. **h-index is NOT staff-editable in edit modals (S310).** Evidence:
   `CandidateEditModal.js`; `204086ec`.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/HONORARIUM_PORTAL_CREATION_STRATEGY.md` | Honorarium portal-creation source of truth (S314): create-body spec, config flip, schema tracker, open Connor items. |
| `lib/bill/honorarium-onboard-orchestrator.js` | Drafted create body (nav-casing fix + fields). Config-gated; not live. |
| `lib/bill/honorarium-discriminators.js` | Discriminator GUIDs + new `HONORARIUM_AKOYA_REQUEST_TYPE_SCHOLARSHIP`, optional `HONORARIUM_CURRENCY_ID`. |
| `docs/audits/*-2026-07-02.md` | Codex's S314 memory-hygiene audit trail. |
| `.claude/worktrees/claude-parked` | Parked reusable Claude worktree (node_modules + symlinks). |

## Testing

```bash
npm test   # full suite; honorarium orchestrator unit suite 33/33 green as of S314
npx jest tests/unit/honorarium-onboard-orchestrator.test.js
```
