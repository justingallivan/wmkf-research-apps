---
title: Bounded Memory Health Cleanup — 2026-10-17
summary: "Evidence-based disposition of the 13 files flagged by memory-health; preserves owner guidance and moves mutable or historical state out of active routing."
canonical: false
owner: product-engineering
last_verified: 2026-10-17
---

Status: point-in-time audit of the 13-file health worklist, not a whole-store or
live-environment certification. Do not use these counts after the named checks
change. The unrelated untracked `output/` directory was not edited during this cleanup.

## Scope and contract

**Mode:** bounded Mode B truth audit of the 13 findings from
`npm run check:memory-health -- --json`.

**Claims:** active memory contains useful owner preferences and procedural
hazards; historical/live-state detail is either grounded and bounded or belongs
in its authoritative source; router retrieval reaches the intended guidance.

**Expected authority:** direct owner decisions in the memory entries;
`CLAUDE.md`; `.claude/skills/parallel-agent-worktree/SKILL.md`;
`docs/AGENT_COLLABORATION_PLAN.md`; `scripts/apply-migrations.js`;
`lib/db/migrations/`; `lib/db/migrations-manifest.json`;
`docs/atlas/postgres-infra-tables.md`; the current sentiment plan and service;
the Test Request Factory rehearsal script and plan; and the applicable UI/workflow
plans. CodeGraph was queried first; it returned no relevant symbols for most of
these behavioral memories, so only relevant direct source reads/searches were
used. No production database, Vercel, or machine-local permissions probe was run.

**Contract-reconcile review surface:** memory leaf → `MEMORY.md` retrieval →
agent guidance → health/router checks. Persistence is the Git-tracked memory
file; consumer is the agent session. Runtime/async/partial-success/enum audits
are N/A because no runtime behavior was changed.

**Excluded:** the other 285 memory leaves, live external state, and
`docs/RECONCILIATION_REPORT.json` regeneration. The drift report is stale or
incomplete and remains read-only; the checker reports five drift findings from
its committed report. No live refresh was authorized or performed.

## Findings and dispositions

| File | Baseline flag(s) | Classification | Disposition |
|---|---|---|---|
| `feedback-codex-model-gpt56-sol.md` | oversize-routed, shadow-atlas | Real defect + lexical false positive | Removed contradictory superseded invocation rules; preserved the 2026-09-08 Sol preference and 2026-10-07 Astra/low acceptance as dated evidence, plus explicit-model, no-substitution, no-config-edit, and worktree/base constraints. Retained origin and modified metadata. Current model availability remains unknown. |
| `feedback-codex-worktree-owner-runs-it.md` | shadow-atlas | Real defect + lexical false positive | Corrected S509/S510 contradiction: dispatch is supported with `-C <worktree>`; hand the prompt over when the owner says they are running it themselves. Preserved S536 commit and review-hook cautions. |
| `feedback-consistency-over-preview-rationale.md` | shadow-atlas | Accepted lexical false positive | Unchanged: the Dataverse phrase and finding-disposition table are part of a dated reasoning example, not a state claim. |
| `feedback-fixtures-return-raw-transport-shape.md` | shadow-atlas | Accepted lexical false positive | “Rows” and Dynamics bypass terms describe fake transport/context shapes in a dated test lesson, not an Atlas claim. Kept raw-wire shape, validator, and real-entry-point guidance; labeled the case historical. |
| `feedback-keep-the-owners-named-input-source.md` | shadow-atlas | Accepted lexical false positive | “Migration” and “tables” describe scope cost in a dated owner-preference example, not live schema. Preserved the requested-input rule and historical boundary. |
| `feedback-orchestrator-checks-builds-before-review.md` | shadow-atlas | Accepted lexical false positive | “Invariant table” is a review artifact, not a database table. Kept the checklist, mutation, and review-order requirements; marked the session evidence historical. |
| `feedback-question-the-rehearsal-venue.md` | shadow-atlas | Accepted lexical false positive | Dataverse identifies the linked sandbox-background-processing note; it is not an unsupported entity claim. Kept the venue-fidelity decision rule and marked dated examples historical. |
| `feedback-staff-ui-desktop-first.md` | no-recall-rule | Hygiene debt | Added a recall rule while preserving the owner’s desktop-first staff-app preference and separate portal audience. |
| `feedback-staff-ui-never-shows-internal-ids.md` | shadow-atlas | Accepted lexical false positive | “Rows” refers to UI records in the dated design example. Kept the owner’s human-readable staff UI rule. |
| `feedback-verify-deploy-is-the-merge-build.md` | shadow-atlas | Accepted lexical false positive | “Table” refers to Vercel CLI output, not a data table. Kept the commit-specific deployment verification and stderr warning as dated operational guidance. |
| `project-deliberation-session-precedes-site-visit.md` | no-recall-rule | Hygiene debt | Added a recall rule without weakening the owner’s definition: deliberation is the internal briefing before the site visit. |
| `project-migration-numbers-claimed-off-main.md` | oversize-routed, shadow-atlas | Real defect + hygiene debt | Removed the stale mutable “next number”; replaced it with a checked-in-source and owner-run tracker allocation procedure. The full prior chronology is preserved in the historical companion below. Verified the apply script sorts filenames and skips tracker entries. Production tracker state remains unknown. |
| `project-sandbox-rehearsal-bypass-allow-rule.md` | shadow-atlas | Real defect + lexical false positive | Kept the exact owner-authorized allow-rule template, pinned sandbox hostname, script scope, env-file-only adjustment, and repository-root requirement. Changed current local presence to UNKNOWN (last checked 2026-10-05); the script’s production refusal and execute/advance restriction were verified in source. Distinguished the rule check (Request 1000341) from separate GoVerify-path proofs (Requests 1000338–1000340). |

Seven `shadow-atlas` flags remain. They are accepted lexical hits in behavioral
notes; they are not evidence that those notes contain an ungrounded current
schema or row-count claim. They were left visible rather than editing prose only
to satisfy the heuristic.

## Historical migration chronology

The detailed former migration note is preserved verbatim, minus its frontmatter,
in [`memory-migration-allocation-history-2026-10-17.md`](memory-migration-allocation-history-2026-10-17.md).
Its banner states that the chronology is point-in-time evidence through
2026-10-10 and must not be used as current allocation state. The active memory
now routes agents to current files, manifest, Atlas, and the authorized tracker
read.

## Verification

| Check | Result | Scope / limit |
|---|---|---|
| `npm run check:memory-health -- --json` before | 13 files flagged: 10 shadow-atlas, 2 no-recall-rule, 2 oversize-routed (overlapping flags); 298 files scanned | Advisory worklist, not semantic verdict |
| `npm run check:memory-health -- --json` after | 7 files, all accepted shadow-atlas lexical hits; no recall, size, weak-basis, or stale-router flags | Same checker and scan root |
| `npm run check:memory-router` | Pass: 7,816 bytes, 70 lines, 59 unique direct leaf refs; all 298 topic files resolve and carry valid status | Structural router gate only |
| `npm run check:memory-router:self-test` | Pass: 20/20 cases | Node emitted `MaxListenersExceededWarning` during fixtures; no case failed |
| `npm run check:fact-consistency` | Pass: 1,001 live doc/memory files scanned; canonical facts current | Relevant because durable facts were edited |
| `npm run check:fact-consistency:self-test` | Pass: prose fixtures and independent derive cross-check | Run sequentially after gate |
| `npm run check:memory-drift` | Read-only; committed report generated 2026-08-24; five stale row-count findings reported | Not a live probe; report not regenerated |

Disconfirming checks: the source of the migration apply order is
`scripts/apply-migrations.js` (`listMigrationFiles`, tracker lookup, sorted apply
loop); current allocation claims were removed, so no production number is
asserted. The rehearsal script's argument validation was read to disconfirm
whether the GoVerify bypass could target production; source rejects that
combination. The owner’s current local allow-rule presence was not checked and
remains UNKNOWN. Current Codex catalog/config, current production migration
tracker, and current Vercel CLI stream behavior remain UNKNOWN where applicable.

## Outcome

The 13 findings are dispositioned and the actionable guidance is preserved.
This bounded audit does not establish live environment state or claim the
five drift findings are resolved. The seven remaining health flags are
documented accepted lexical false positives, not suppressed by checker edits.

## Parent review and final gates

Parent reviewed the complete changed memory files and diff. Corrections preserved
the later dispatch preference, model/config and worktree constraints, the exact
sandbox permission template, the deliberation definition, and historical migration
evidence. Checker-only word substitutions were reverted; no heuristic was changed.
The deployment note now consistently requires the merge commit-specific check.

Additional sequential checks passed: `check:agent-invariants`;
`check:doc-symbol-refs` and self-test; `check:build-claim-freshness` and self-test;
`check:harness-framing` and self-test; `check:docs-catalog`; and
`check:doc-currency` and self-test. These establish bounded document consistency,
not current live service state.
