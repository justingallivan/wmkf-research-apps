# Session 692 Prompt: Connor's intake flow map documented; decisions closed

Previous handoff (Session 691 prompt, written at the end of Session 690):
`git show f2cad0b45:SESSION_PROMPT.md`.

## Session 691 Summary — 2026-11-20 (Claude, main checkout)

### What Was Completed

1. **Session 690 follow-ups, done by delegated Sonnet agents and reviewed before commit.**
   - **D60 two-file restatements:** reconciled, including register row J27-065 and the
     D59/D60 promotion status. `d5973961a`.
   - **Stale retired-surface claims:** fixed in four docs; the A7 count is 32. `faf68478d`.
   - **Oversize cycle-page leaf:** split into `project-j27-cycle-page-rules` (active) and
     `-redesign-history` (closed). `72537957e`.
   - **Virus-scan UX:** traced. Consultant feedback had a retry bug, now fixed (item 6).
2. **Owner decisions closed** (recorded in the docs and memory named below):
   - **Compliance screening is not an app capability.** Connor's flow writes advisory
     compliance fields. Staff set `wmkf_readyforreview` by hand and withhold it from
     non-compliant applications. `cdd61a88c`.
   - **Grant Reporting and Literature Analyzer capabilities are archived** with no app
     destination. Report assessment will be redesigned inside the automatic flows.
     `52d84b686`.
   - **`/proposal-lists` stays open** to Workbench staff (plan decision 19). `dbf9be991`.
   - **Program-field readers: no app change.** Step 3 sets MR/SE in the request's
     Program field. The owner expects step 3 to be live before J27 proposals arrive.
     Audit: `docs/audits/program-field-membership-readers-audit-2026-11-20.md`.
     `44d9119b2`, `8e2c40c74`, `775ae615e`.
   - **J27 reviewer copy:** Connor's new flow triggers at `wmkf_phaseistatus` =
     Recommended. Staff decide the contents, and the reviewer portal serves the file
     unchanged. `50419061c`.
3. **Connor's Research intake flow map documented.** The canonical doc is
   `docs/POWER_AUTOMATE_RESEARCH_INTAKE_FLOWS.md`, covering steps 0–7: what each step
   writes, where, the format and the status. `73d5ee531`.
   - **Labels:** sections 1–8 are labeled as Connor's report.
   - **Probes:** owner-approved read-only metadata reads confirmed all 57 named fields,
     their lengths and the lookup targets. The three flows are not visible to the app's
     Dataverse identity.
   - **Connor's answers (section 10):**
     - A keyword-change flow will delete and recreate the staff documents.
     - MR/SE comes from the keyword default.
     - The reviewer-copy flow is to be built.
     - Step 1 will set disposition Recommended on applicant-suggested reviewers.
4. **Mode B sweep** of 195 files against the map, done in four disjoint agent passes.
   60 docs, plans, Atlas pages, wiki topics and memory leaves were reconciled. Report:
   `docs/audits/power-automate-intake-sweep-2026-11-20.md`. Live STALE is 0 after
   PR #665. `54b0cee99`, `ddb2ce308`.
5. **PR #664 merged (`cc4c90d7f`):** a `--force` prompt seed now refuses to weaken
   untrusted-content declarations (`lib/services/prompt-seed.js`). An independent review
   found nothing blocking. Its known minor gaps are in `project-prompt-governance`.
6. **PR #665 merged (`996ba8187`):** after a malware-scan rejection, consultant feedback
   now drops the file and its staged upload, so a retry re-stages it. Reviewed by Codex,
   no findings. The PR also fixed the `requestReadiness.js` comment.
7. **Dependabot #144 dismissed** as tolerable risk with an explanatory note. It is a
   transitive minimatch in tooling and the workflow chain; no app imports it. The owner
   refreshed local `node_modules`.

### Production Access This Session
All reads were read-only metadata (field definitions, choice options, lookup targets and
flow names); no request or applicant rows were read.
- **Compliance-field metadata:** the owner asked for this read. The follow-up lookup of
  user, solution and picklist was announced, not asked; both used raw fetch.
- **Field metadata and flow existence:** owner-approved by name. These reads went through
  the interlocked client with `DATAVERSE_ALLOW_PROD_READS=yes`.
- **Probes:** they live in the session scratchpad only and are not committed.

### Commits
23 commits, `f2cad0b45..5ec1ff2d5`, all on `main` and pushed. They include merges
`cc4c90d7f` (#664) and `996ba8187` (#665).

## Next Items

### Verified Open

1. **Watch for Connor's step 3 going live before early December.** After it does,
   confirm on one real or test J27 request (owner-approved read) that:
   - `akoya_programid`, `wmkf_programareaserved` and `wmkf_ai_keywords` are populated;
   - the staff version and `AI Materials/Narrative-Bibliography_` appear after step 5.
   Evidence: map section 0 status note; audit doc.
2. **Connor builds that are promised but not yet confirmed:** the keyword-change flow,
   the reviewer-copy flow (Recommended trigger), and step 1 setting
   `wmkf_applicantdisposition` = Recommended. Evidence: map section 10, items 1, 4 and 5.
3. **Low-priority questions for Connor:** whether `wmkf_ai_methodologies` comes from
   `intake.keywords` or another prompt, and whether `wmkf_ai_compliancesummary` is
   retired (map section 10, items 6 and 7).
4. **`cycle-dossier.entry` cache read:** re-run
   `scripts/probe-ai-run-cache-reads.js --prompt cycle-dossier.entry` after the next
   dossier batch. This is a Production read and needs the owner's OK.

### Owner Decision Needed

1. **Step-3 prompt limits vs the CSO workbook handoffs:** 12 differences are listed and
   not reconciled. Examples: the executive summary minimum, the methodology sentence cap,
   the personnel length, the keyword JSON vs controlled lists, flags vs
   injection/compliance/fit, PD scores vs assignment, and `intake.*` vs `proposal.*`
   names. Evidence: the full list is in
   `docs/audits/power-automate-intake-sweep-2026-11-20.md`, section "Step-3 output vs
   prompt handoffs".
2. **Optional: a Workbench control for setting `wmkf_readyforreview`.** Today staff set it
   only in Dynamics; the app writes it only for Factory test requests. Nobody has asked
   for this.

### Parked

1. **Proposal lists:**
   - Two-level sections and the staff-version PDF wait on keywords from step 3.
   - Check real J27 Scored membership once proposals are scored.
   - The owner's test list is still on.
2. **Connor's roster connection read check:**
   `docs/plans/EXPERTISE_ROSTER_CONNOR_HANDOFF_2026-11-19.md`.
3. **Do not merge the Executor lineage branch.** The Chairs stages and the automatic
   Integrity Screen each need separate approval.
4. **Minor:** other permanent consultant-feedback finalize rejections (e.g.
   `image_too_large`) still reuse the dead staging id on retry. Noted in PR #665.

### Verify Before Acting

1. **Executive Summary trial batch-2 cleanup after November 23:** needs a fresh expiry
   check and the owner's preflight. It is destructive.
2. **Merged remote branches** `claude/prompt-seed-untrusted-guard` and
   `claude/consultant-feedback-scan-retry` could be deleted. Both are merged into
   `origin/main`; confirm before deleting.
3. **Worktree disposal:** follow the runbook's preservation preflight.

### Do Not Reopen Without New Decision

1. **Compliance screening as an app feature:** no (owner, 2026-11-20).
2. **Destinations for the Grant Reporting and Literature Analyzer capabilities:**
   archived.
3. **Narrowing `/proposal-lists` to the CSO:** no (decision 19).
4. **Guarding direct Dataverse prompt edits and non-helper seed scripts:** these are
   trusted channels by decision.

## Concurrent Workstreams

| Stream | Owning reference | Resume boundary |
|---|---|---|
| PA intake flows (Connor) | `docs/POWER_AUTOMATE_RESEARCH_INTAKE_FLOWS.md` | Map and sweep done; waiting on step 3 go-live and Connor's builds |
| Memory hygiene | `docs/MEMORY_HYGIENE_RUNBOOK.md` §18 | Session 690 audits done; router is 7,492 B |
| Proposal lists | `docs/plans/J27_PROPOSAL_LIST_EMAILS_PLAN_2026-11-18.md` | Decision 19 recorded; sections wait on keywords |
| Chairs | `docs/plans/J27_CHAIRS_RECOMMENDATION_PRODUCTION_PLAN_2026-11-18.md` | Separate approval per stage |
| Intake/Executor | `docs/plans/PA_PROMPT_DELIVERY_HANDOFF_2026-11-16.md` | Parked lineage; no merge |

## Key Files Reference

| File | Purpose |
|---|---|
| `docs/POWER_AUTOMATE_RESEARCH_INTAKE_FLOWS.md` | Canonical map of Connor's intake flows, app implications, and the question log |
| `docs/audits/power-automate-intake-sweep-2026-11-20.md` | Sweep evidence matrix and probes |
| `docs/audits/program-field-membership-readers-audit-2026-11-20.md` | Program-field reader classification |
| `.claude-memory/project-connor-intake-flow-map.md` | Routed memory pointer to the map |
| `lib/services/prompt-seed.js` | Seed helper with the A7 guard (`assertSeedKeepsUntrustedDeclarations`) |
| `shared/components/workbench/ConsultantFeedbackSection.js` | `scan_infected` retry fix |
| `shared/config/requestReadiness.js`, `shared/config/workbenchVisibility.js` | J27 ready-flag gate |

## Testing

```bash
npx jest --runInBand --silent tests/unit/prompt-seed.test.js tests/unit/adapter-ai-prompt.test.js tests/unit/consultant-feedback-section.test.js
npm run check:memory-router && npm run check:memory-router:self-test
npm run check:doc-currency && npm run check:doc-currency:self-test
```

## Closeout

**Milestone determination:** no DEVELOPMENT_LOG entry.
- Today's work was documentation of an external system, owner decisions, a contained
  hardening (#664) and a bug fix (#665).
- No new production capability, cutover or architecture change shipped from this repo.

**Other closeout checks:**
- CLAUDE.md is unchanged.
- Claim-evidence report: no eligible plan or design edit recorded, so no observation row.
