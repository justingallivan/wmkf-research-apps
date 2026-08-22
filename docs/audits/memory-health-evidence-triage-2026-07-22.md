---
title: Memory Health Evidence Triage — 2026-07-22
summary: "Source-backed triage of the advisory memory-health findings, separating verified factual drift from formatting and verification debt."
canonical: false
owner: product-engineering
last_verified: 2026-07-22
---

# Memory Health Evidence Triage — 2026-07-22

## Scope and method

This pass evaluated the output of `scripts/check-memory-health.js`; it did not
treat every warning as a factual defect. The checker is intentionally advisory:

- `no-recall-rule` detects a missing heading, not stale content.
- `weak-basis` detects structural language without a strong `last_verified`
  value.
- `shadow-atlas` detects structural language without the checker's recognized
  grounding syntax.
- `oversize-routed` detects routed files over 5,120 bytes.
- `stale-routed` detects stale/superseded files still present in the router.

Material claims were checked against source, Atlas pages, current instruction
and skill contracts, focused tests, or a live read-only HTTP probe before a
memory file was changed. This is a durable-document reconciliation only: the
entry points are `.claude-memory/MEMORY.md` and the agent skills; persistence is
the tracked documentation and memory files; consumers are future agents and CI
documentation gates. There is no application runtime or data mutation in this
change.

## Baseline and result

| Advisory signal | Before | Initial triage | After residual audit | Triage result |
|---|---:|---:|---:|---|
| Unique files flagged | 117 | 98 | 97 | The reduction reflects verified repairs and targeted formatting improvements, not a claim that the remaining files are stale. |
| `shadow-atlas` | 38 | 33 | 33 | Remaining entries require claim-by-claim evidence work; the signal alone does not prove drift. |
| `weak-basis` | 66 | 55 | 55 | Remaining entries are a verification queue, not known factual defects. |
| `no-recall-rule` | 58 | 45 | 45 | Pure routing/format debt unless a content review finds a separate problem. |
| `oversize-routed` | 6 | 1 | 0 | The sole initial residual was source-audited and compressed in the follow-up below. |
| `stale-routed` | 0 | 0 | 0 | No stale/superseded memory remains directly routed. |

The initial 117-file queue contained 77 routed and 40 unrouted files. Unrouted
files have lower routine exposure, so the pass prioritized routed operational
guidance and high-risk structural claims rather than mechanically rewriting all
warnings.

## Verified drift corrected

1. **Codex model and transport guidance.** `[VERIFIED via the installed
   codex-cli-runtime skill and docs/AGENT_COLLABORATION_PLAN.md, 2026-07-22]`
   The routed memory forced `gpt-5.5` and foregrounded old detached/rescue
   transports. The current runtime says to leave the model unset unless the user
   explicitly requests one. The old directive is now `superseded`, the router
   points to the active collaboration contract, and the legacy transport notes
   are identified as fallbacks.

2. **Honorarium payment recommendation and BILL design status.** `[VERIFIED via
   docs/agent-wiki/topics/finance-honoraria.md,
   docs/HONORARIUM_PORTAL_CREATION_STRATEGY.md, and current honorarium source,
   2026-07-22]` The long memory mixed an active PNI/BILL integration proposal
   with the later owner decision to table BILL work. It now states one current
   contract: the portal creates the Dataverse honorarium request; BILL API work
   is tabled; payment occurs outside this application. Four BILL design/handoff
   documents that still carried `status: active` are now explicitly historical
   with a pointer to the current no-BILL contract. Historic numeric probe results
   remain explicitly dated and require re-probing before reuse.

3. **Reviewer duplicate-merge status.** `[VERIFIED via reviewer-merge.js,
   CandidateEditModal.js, my-candidates-service.js, and focused tests,
   2026-07-22]` A historical paragraph still said the merge UI was not built,
   while later text in the same memory correctly recorded that it shipped. The
   earlier statement is now labeled as the historical S289 boundary.

4. **Resolved reviewer E2E work.** `[VERIFIED via the memory's recorded 23/23
   closeout and the routed archive, 2026-07-22]` The completed re-baseline was
   still marked active and directly routed. It is now closed and indexed through
   the closed-work archive.

5. **Collaboration-plan status.** `[VERIFIED via
   .claude/skills/agent-coordination/SKILL.md and the tracked skill symlink
   contract, 2026-07-22]` The plan still described the coordination skill as
   proposed even though it is implemented. The document now identifies itself
   and that skill as active.

## Current high-value guidance refreshed

The following memories were retained after their operational claims were checked
against their named source, Atlas, tests, or probe evidence:

- Branded-domain routing: `[VERIFIED via live read-only HTTP probes, 2026-07-22]`
  all four branded app roots redirected to sign-in, the legacy root redirected to the
  applications host, and the legacy `/api/health` path was excluded from the
  domain redirect.
- Reviewer Phase II gate, forename guards, identity evidence, and external
  accept/decline behavior: `[VERIFIED via current reviewer services and focused
  tests, 2026-07-22]`.
- Grant phasing, peer-review Executor migration, grantee-waiver versioning,
  reviewer closeout payability, staff rescue, duplicate merge, and dormant
  upload behavior: `[VERIFIED via their current source/Atlas consumers,
  2026-07-22]`.
- Reviewer affiliation/institution linking: `[VERIFIED via current source,
  2026-07-22]`; the recorded backlog counts remain 7 completed and 10 open.

These edits add recall rules and evidence dates where useful, but do not convert
historical decisions into claims about current production state.

## Follow-up resolution of the residual

The routed `.claude-memory/project-reviewer-holistic-redesign-parallel-build.md`
was subsequently audited end to end on 2026-07-22 against the full umbrella
plan, the newer identity/contact plan, runtime seams and callers, binding-writer
consumers, evaluation-only pipeline location, and dormant Track B switch. It is
now a compact current routing contract; detailed implementation chronology
remains in the controlling plans, audits, and git history. The dedicated record
is `docs/audits/reviewer-holistic-memory-reconciliation-2026-07-22.md`.

## Sweep report

The durable-fact sweep covered the changed concepts and their common historical
wording: `gpt-5.5`, `codex:codex-rescue`, `BILL API`, `PNI`, `NOT built yet:
Chunk 4 UI`, `project-e2e-reviewer-rebaseline-parked`, and `Proposed Skill
Support`. Remaining historical occurrences are acceptable only when explicitly
labeled as historical, superseded, tabled, or fallback guidance. The active
router and current collaboration contract no longer restate the superseded
model or transport rule.

## Evidence commands

```bash
npm run check:memory-health -- --quiet
rg -n "gpt-5\\.5|codex:codex-rescue|BILL API|PNI|NOT built yet: Chunk 4 UI|project-e2e-reviewer-rebaseline-parked|Proposed Skill Support" .claude-memory docs .claude/skills
curl -I https://applications.wmkeck.org/
curl -I https://reviews.wmkeck.org/
curl -I https://grantees.wmkeck.org/
curl -I https://submissions.wmkeck.org/
curl -I https://wmkfresearch.vercel.app/
curl -I https://wmkfresearch.vercel.app/api/health
```

The live HTTP calls were read-only. No authenticated application action or data
write was performed.
