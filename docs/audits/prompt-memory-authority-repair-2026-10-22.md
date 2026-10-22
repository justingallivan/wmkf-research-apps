# Prompt and Memory Authority Repair — 2026-10-22

**Status: AUDIT INCOMPLETE — bounded documentation repairs and parent review fixes are incorporated; parent-owned final review and commit remain pending.**
This report covers only the six assigned `.claude-memory` files, `docs/EXECUTOR_CONTRACT.md`,
`docs/agent-wiki/topics/prompt-executor.md`, and `docs/SYSTEM_MODEL.md`. It does not claim a
repository-wide reconciliation.

## Scope and claims

| Claim | Evidence | Status |
|---|---|---|
| Dataverse prompt storage and Executor adoption are separate decisions. Expertise Finder reads current tool prompt rows through `resolveToolPrompt`, while retaining app-owned `LLMClient` calls. | `lib/services/tool-prompt-resolver.js:80-114`; `lib/services/expertise-finder/batch-match-service.js:162-176,217-233`; `docs/agent-wiki/topics/prompt-executor.md` | VERIFIED via source; user direction from 2026-04-25 staff-prompt principle retained |
| Full `overridePromptBody` editing remains future Phase 2 work. | `docs/EXECUTOR_CONTRACT.md` lists the input as deferred and again in the deferred scope | PLANNED; not stated as built |
| The Awardee tab has a staff-triggered abstract rewrite/edit flow with grantee approval; GAL/status-triggered automation remains unknown. | `shared/components/workbench/AwardeeTab.js:469-478`; `pages/api/workbench/grantee-deliverables/generate.js:36-61`; `lib/services/grantee-deliverables/generate-service.js:45-180`; `lib/services/grantee-abstract-service.js:45-92` | VERIFIED for the staff flow; UNKNOWN for future GAL/status automation |
| Closed-work archive entries route to historical evidence and do not establish current implementation state. | Assigned archive file; repository source/Atlas/probe rule in `CLAUDE.md` | AGREED and clarified; historical entries left intact |
| App and route-guard counts should be linked descriptively to their canonical derivations. | `docs/CANONICAL_COUNTS.md:27-39` defines 14 registry entries and 189 `pages/api` files with a `requireAppAccess()` call; the latter denominator is route files containing at least one call | VERIFIED via canonical derivation; duplicate numerals removed from the assigned memory and System Model |
| Anthropic auto-reload and spend-limit settings in S181 are historical observations. | Assigned credit-monitoring memory itself dates these to S181; no current account settings were probed | HISTORICAL; current settings UNKNOWN |
| PDF input handling varies by surface; the proposed `processingMode` switch is not an implemented runtime contract. | `pages/api/reviewer-finder/analyze.js:117-124,172`; `lib/services/claude-reviewer-service.js:199-236`; `lib/services/initial-assessment/artifact-service.js:94-100,217-225`; `pages/api/analyze-literature.js:253-270`; `pages/api/evaluate-multi-perspective.js:683-703`; `rg processingMode lib pages shared modules scripts tests` returned no matches | VERIFIED for named paths and bounded search; entire PDF ecosystem UNKNOWN / not audited |
| Executor budget revision 1 was published on 2026-09-07; the no-revision/fallback Admin read predates it. | `docs/EXECUTOR_CONTRACT.md` publication receipt and `lib/services/executor-budget-service.js:272-288` (latest-valid-revision / fallback behavior) | VERIFIED from recorded publication receipt and source; no new hosted-state probe |

## Repairs made

- Reframed prompt-storage guidance to keep the 2026-04-25 staff-editability principle while making storage and execution independent decisions. Expertise Finder is documented as Dataverse-backed with its own resolver/composer and LLM call. `overridePromptBody` is explicitly future work. Grant Reporting was not assigned a new implementation obligation.
- Added the existing staff-triggered house-style abstract rewrite to the Awardee memory and kept GAL/status-triggered automation as UNKNOWN. The May rationale for grantee approval and deliverable collection remains historical context.
- Changed the closed-work archive recall guidance to require source, Atlas, and authorized probes for current-state claims. Kept the existing historical entries, including the don't-rebuild guardrail, unchanged.
- Replaced duplicated app/endpoint numerals with descriptive canonical-count links. The route-guard link now states the canonical denominator: files under `pages/api` with at least one `requireAppAccess()` call.
- Changed current Anthropic settings guidance to require a fresh account-settings check and marked the S181 auto-reload description historical.
- Replaced universal PDF tiers and the unimplemented `processingMode` request with bounded, per-surface descriptions. Preserved the text-versus-vision motivation as unmeasured historical design rationale.
- Reconciled the Executor contract and wiki: revision 1 publication is current recorded history; the no-revision/fallback panel view is a dated pre-publication observation.
- Removed the duplicated live application count from the System Model in favor of its canonical link.

## Historical holds

- The Apr 25 owner principle that staff-editable prompt content belongs in Dataverse remains intact.
- The May awardee rationale for grantee abstract approval, artwork, and release collection remains intact.
- The Aug 30 Executor budget fallback observation and Sep 7 publication receipt are both retained with their chronology.
- The S181 Anthropic account observation is retained only as history.
- The original PDF text/vision rationale is retained as historical context, without asserting the unmeasured cost ratio or universal coverage.
- No rows in the closed-work archive were rewritten.
- `docs/SECURITY_ARCHITECTURE.md` retains dated March 2026 app-count references marked `fact-consistency:ignore`; it is a historical snapshot and outside this ownership scope.

## Outside-scope hits classified as historical

- **HISTORICAL:** `.claude-memory/project-app-roadmap-2026-04-25.md:16,29,31,43` is a dated roadmap snapshot with stale status; its Grant Reporting and Integrity Screener dependency statements were preserved as history, not treated as current guidance or a remaining repair.
- **HISTORICAL:** `.claude-memory/project-reviewer-apps-redesign-history.md:314` is in a closed history record. The old open-scope wording was left unchanged as historical context, not treated as a remaining repair.
- **HISTORICAL:** `docs/SECURITY_ARCHITECTURE.md:687,711,1310` contains old count references, each explicitly dated/ignored as an archived March 2026 snapshot. Per task instruction, those entries remain unchanged.
- The remaining `Auto-reload ON` occurrence in the assigned credit memory is inside the explicitly labeled S181 historical observation. Remaining `processingMode` occurrences in the assigned PDF memory are explicit statements that no shared runtime parameter exists or is required.

## Verification and limits

- The nine assigned target documents were read in full before editing.
- CodeGraph was consulted before source review. Local searches were then limited to the relevant contract terms and assigned documentation; source searches found zero `processingMode` matches in `lib`, `pages`, `shared`, `modules`, `scripts`, and `tests`.
- Assigned-file searches were rerun for the superseded current-state phrases. The remaining same-term hits are the explicit historical or negative statements described above.
- No tests, gates, external probes, environment reads, or commits were performed in this delegated documentation pass. Parent verification is recorded below; repository-level reconciliation is not claimed.


## Parent verification

Parent reviewed the full diff and checked the source-backed prompt, budget,
PDF and Awardee claims against the independent Sol findings. The archive
Do-not wording was corrected so it prohibits assuming current authority,
without prohibiting use of historical evidence. The stale-status April roadmap
and closed redesign history are historical records, not new repair items.

Relevant document gates passed: memory router, fact consistency, canonical
pointers, document-symbol references, build-claim freshness, agent wiki, harness
framing, document currency and docs catalog, with their applicable sequential
self-tests in the parent verification round. No application behavior, live data,
account setting, deployment or environment was changed.

Remaining review work is named in the shared audit index; this report does not
certify all memories or the PDF ecosystem.
