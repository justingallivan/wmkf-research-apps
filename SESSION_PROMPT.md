# Session 491 Prompt: Merge the Session 490 Decision Stack, Then Plan Materials-on-Acceptance

## Session 490 Summary

The owner reviewed the overnight lifecycle campaign and resolved every open decision. Work
landed as a **four-PR stack, unmerged at handoff**, each PR based on the one before it so the
shared Stage 7 plan rows and this file never conflict. Merge in order; GitHub retargets each
child to `main` as its parent merges. This checkout is on `claude/open-items-cycles-retry-hygiene`
(the top of the stack); the handoff commit lands there by owner choice.

| PR | Branch | Head | What |
|---|---|---|---|
| #170 | `claude/reviewer-lifecycle-d0-d3-tightenings` | `456d5029` | D0 taken (softDelete row-aware guard), D3 taken (repair op requires concrete ETag). All checks green incl. claude-review. |
| #171 | `claude/retire-generate-emails-and-proposal-wide-patch` | `d1810a24` | D2: generate-emails route/service/prompt/`markInvitationGenerated`/`patchFields` alias retired. D4: proposal-wide my-candidates PATCH + `setRequestMetadata` removed. All checks green. |
| #172 | `claude/acceptance-etag-d5-scripts-6d-decisions` | `06fe1253` | Accept/decline writes require a concrete ETag; D5: three raw-fetch one-offs archived + new LAW gate `check:script-suggestion-writers`; 6D-1 confirmed, 6D-2 parked. All checks green. |
| #173 | `claude/open-items-cycles-retry-hygiene` | `9b60cea5` + handoff | Follow-up cycles-load retry fix; four inline ETag regexes → `isConcreteEtag`; `isPastCutoff` → `lib/utils/past-cutoff.js`; reviewer leftovers; summary-blob extraction + `wmkf_summarypages` mapping removed; queue item 5 documented. CI was still running at handoff. |

### What Was Completed

1. **Owner decisions D0–D5 + 6D-1/6D-2 all resolved** (table below). D1 preserved by decision;
   everything else taken, removed, confirmed or parked. Each taken item has a mutation-checked test.
2. **Four idle worktrees removed** (`../WMKF_Apps-6c`, `-s2`, `-s3`, `-s4`), each verified clean and
   ancestor-of-main first.
3. **D2 investigation** [VERIFIED via `git grep` + `git log -S`]: the only client of
   `/api/reviewer-finder/generate-emails` (`EmailGeneratorModal`) was deleted 2026-06-21 (`9114adeb`);
   no page/component/script referenced the route since; the route never wrote `api_usage_log` and the
   Vercel CLI exposes no historical request log, so runtime zero-hit is unverified (dashboard glance
   optional before merging #171). The `email-reviewer.js` prompt had that route as its sole caller.
4. **D4 investigation**: the proposal-wide PATCH served the standalone Reviewer Finder page's
   per-proposal Program Area / Grant Cycle dropdowns, deleted 2026-06-16 (`94bbbce4`); the Workbench
   never rebuilt them. Owner first chose (a) per-row results, then reversed to removal. **Explicit
   capability drop:** no post-save correction path for `wmkf_grantcyclecode`/`wmkf_programarea` on
   suggestion rows.
5. **D5 gate census**: 13 `scripts/` writers recorded (five more than the Stage 7 plan's grep census —
   alias resolution + fail-closed unresolved targets caught them); growth pinned by
   `tests/unit/script-suggestion-writers-recorded-set.test.js`. Documented limit: raw POST creates
   via fetch are not detected (every script's token call is a POST).
6. **Acceptance-write tightening** (follow-on to D3, owner-approved): accept requires a concrete
   `If-Match` checked BEFORE the acceptance job is enqueued; decline requires header or verifier-row
   `_etag`; missing → 412 `concurrent_modification` (client already maps to "refresh and try again").
   Consequence: a `/context` that returned `etag: null` now yields a reload prompt, not an unlocked write.
7. **Summary blob chain removed (option a)**: `analyze` no longer extracts/uploads; `save-candidates`
   no longer accepts `summaryBlobUrl`; `pdf-extractor.js` deleted; `wmkf_summarypages` no longer
   selected/mapped/written/defaulted. The Workbench client never requested extraction, so no live
   behavior changed. Dataverse attributes `wmkf_summarybloburl`/`wmkf_summarypages` and the drain-only
   PG columns stay (schema drops are separate decisions).
8. **Owner clarified the December 2026 flow** and it is documented as **work queue item 5**
   (`docs/CURRENT_WORK_QUEUE.md`), in `docs/STRATEGY.md` current execution, the strategy wiki router,
   and `project-accepted-awaiting-materials-is-transient`: materials in hand at request time; on
   acceptance + onboarding the system AUTOMATICALLY emails the reviewer a materials link. Not built;
   nothing in the acceptance job/drain sends materials today [VERIFIED]. Build when campaigns settle;
   plan before D26 invitations; live before the first D26 acceptance.
9. **Owner-run read-only probe** (scratchpad, not tracked): 0 rows in the accepted-awaiting-materials
   state; 7 null-status accepted rows are May–July test residue. The probe's request lookups 400'd
   because it selected `wmkf_grantcyclecode` on `akoya_requests` (column lives on the suggestion);
   fix the select before any rerun.

### Decisions table (final state)

| # | Outcome | Where |
|---|---|---|
| D0 | TAKEN — `softDelete` selects `wmkf_completedat`, gates with `isClosedEngagementRow` | #170 |
| D1 | PRESERVE — post-send invitation stamp stays unconditional (the fact recorded is "email left") | — |
| D2 | RETIRED — route, service, prompt, generation mark, `patchFields` alias | #171 |
| D3 | TAKEN — repair op requires concrete ETag; follow-on: accept/decline writes too | #170, #172 |
| D4 | REMOVED — proposal-wide PATCH branch + `setRequestMetadata` (owner reversed from (a) on the orphan finding) | #171 |
| D5 | TAKEN — archive executed one-offs, gate the rest (`check:script-suggestion-writers`) | #172 |
| 6D-1 | CONFIRMED — uniform fingerprint enforcement | #172 (record) |
| 6D-2 | PARKED — revisit only on an observed stale send | #172 (record) |

### Commits (this session, all on the stack; `git log --oneline main..claude/open-items-cycles-retry-hygiene`)
`2a7c9397` D0+D3 · `456d5029` D0/D3 restatements · `7fe51c53` D2 · `d1810a24` D4 · `582f0f6a`
accept/decline ETag + 6D records · `06fe1253` D5 archive + gate · `06bab592` cycles retry ·
`adad6107` ETag consolidation + leftovers · `c8f95dcb` #151 check + blob decision · `c4e83b84`
summary-blob extraction removed · `2531d2bc` `wmkf_summarypages` dropped from service · `268c19ef`
materials-on-acceptance clarification · `9b60cea5` queue item 5 · handoff: `git log -1`.

## Next Items

### Verified Open

1. **Merge the stack in order: #170 → #171 → #172 → #173.** Evidence: `gh pr checks <n>`; #170–#172
   were fully green at handoff, #173 CI was running after the last push. Each child retargets to
   `main` automatically. After #173 merges: confirm the Production deployment is Ready (`vercel inspect`,
   not a `vercel ls` grep), delete the four branches, and **add the DEVELOPMENT_LOG.md entry** — this
   session deliberately did not write one because nothing has reached `main`/Production yet (see
   Milestone Determination). Then re-run `/start` gates on `main`.
2. **Plan the automated materials-on-acceptance email (queue item 5).** Evidence:
   `docs/CURRENT_WORK_QUEUE.md` item 5 lists the design questions (precondition the drain can verify,
   accept-before-materials, idempotency across drain retries, PD visibility/override, manual modal as
   fallback). Plan-first; `/contract-reconcile` triggers apply. Timing: when campaigns settle, before
   D26 invitations go out.
3. **6D fingerprint smoke at the first D26 invitation batch.** Evidence: invitations are fingerprinted
   (6D-1 confirmed); no acceptance needed. Render → change a proposal detail in CRM → send → observe
   `draft_stale` skip → re-render → send. Write the PD checklist beforehand.
4. **Release-materials modal smoke** only if item 2 does not ship before the first D26 acceptance.
   Evidence: `project-accepted-awaiting-materials-is-transient`.

### Owner Decision Needed

1. **Dataverse attribute drops**: `wmkf_appreviewersuggestion.wmkf_summarybloburl` and
   `wmkf_appgrantcycle.wmkf_summarypages` are deployed but unused (both Atlas pages say so). Dropping
   is a schema change with its own pre-flight; historical values exist. Not urgent.
2. **Runtime zero-hit for generate-emails** (before merging #171, optional): a glance at the Vercel
   dashboard request logs for `/api/reviewer-finder/generate-emails`. Code evidence is decisive for
   in-app use; this is the one signal not obtainable from the CLI.

### Parked

- 6D-2 fingerprint coverage extension (batch-start hydration, Admin template drift) — reopen only on
  an observed stale send.
- Stage 4 of the lifecycle plan; progress-pill alignment/chronology; Ops eligibility view; automatic
  reviewer reminders (gate-protected hold); one-click PDF conversion. Not re-probed.
- Five stale one-off Preview callbacks in the Entra app registration. Owner cleanup.

### Verify Before Acting

1. **Two stashes** (`stash@{0}` on main, `stash@{1}` on `codex/reviewer-promotion-remediation`, July
   2026 reports) predate this work; untouched.
2. **Both recorded-set pins are LAW**: growing `RECORDED_IMPORTERS` (boundary gate) or
   `RECORDED_SCRIPT_WRITERS` (scripts gate) requires editing the matching
   `tests/unit/*-recorded-set.test.js` in the same PR; stale entries fail the gate itself.
3. **`bulkUpdateByRequest` removal pin** (`tests/unit/reviewer-suggestion-bulk-update-importers.test.js`)
   now carves out three gate scripts by name; a new file naming the identifier anywhere in
   lib/pages/shared/modules/scripts still fails.
4. **Merge-conflict hazard**: every stacked PR edits `SESSION_PROMPT.md` and the Stage 7 plan. Merge in
   order; do not cherry-pick a child ahead of its parent.
5. **Probe select bug** (item 9 above) before rerunning the scratchpad probe; and production Dataverse
   reads remain owner-run only (`feedback-never-self-authorize-prod-dataverse-reads`).

### Do Not Reopen Without New Decision

Automatic Complete from thank-you; Operations/Finance final remit flag from this application; BILL
API reviewer onboarding. No new schema, live lifecycle mutation, email send, cron invocation or
backfill is authorized. D1 stays unconditional by owner decision. D4's capability drop (no post-save
cycle/program-area correction) is accepted. D26 hide of Initial Assessments is intended.

## Preserve These Contracts

- Every taken decision has a mutation-checked test; reverting the guard turns a named test red
  (D0: `reviewer-suggestion-disposition`; D3: `reviewer-suggestion-deselect-legacy-declined`;
  accept/decline ETag: `external-review-services` + `external-review-routes`; cycles retry:
  `reviewer-follow-up`).
- `isConcreteEtag` (`lib/utils/etag.js`) is the single concrete-ETag rule; no inline copies remain.
- `check:reviewer-engagement-boundary` and `check:script-suggestion-writers` are both LAW with pinned
  recorded sets.
- Send transmits the previewed body verbatim; the server recomputes only the fingerprint and
  destination (6D, uniform across all four template types).
- Materials modal session identity by VALUE (`reviewer-draft-keys.js`); `ReviewersTab` passes
  `degraded={Boolean(error)}`.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/REVIEWER_LIFECYCLE_STAGE7_BUILD_PLAN.md` | D0–D5 decisions table with final outcomes and evidence |
| `docs/CURRENT_WORK_QUEUE.md` | item 5: automated materials-on-acceptance email (plan-first) |
| `scripts/check-script-suggestion-writers.js` | D5 LAW gate; `RECORDED_SCRIPT_WRITERS` (13) |
| `tests/unit/script-suggestion-writers-recorded-set.test.js` | growth pin for the recorded set |
| `lib/services/external-review/respond-service.js` | accept/decline ETag requirement |
| `lib/dataverse/adapters/reviewer-suggestion.js` | D0 guard, D3 op; `setRequestMetadata` + `patchFields` gone |
| `pages/workbench/reviewer-follow-up.js` | retryable `loadCycles` |
| `lib/utils/past-cutoff.js` | `isPastCutoff` (moved from expire-invitation) |
| `_archived/scripts/` + `_archived/README.md` | the three archived raw-fetch scripts with execution evidence |
| `.claude-memory/project-accepted-awaiting-materials-is-transient.md` | December-cycle flow clarification |

## Testing

```sh
# New gate pair (sequential) + census
npm run check:script-suggestion-writers && npm run check:script-suggestion-writers:self-test
node scripts/check-script-suggestion-writers.js --report
# Decision pins
npm test -- --runInBand --watch=false --testPathPattern 'reviewer-suggestion-disposition|deselect-legacy-declined|external-review-(services|routes)|reviewer-follow-up|script-suggestion-writers|my-candidates'
# Branch exit (all green at handoff on 9b60cea5)
npm test -- --runInBand --watch=false && npm run check:types && npm run lint && npm run build -- --webpack && git diff --check
```

## Handoff and Milestone Determination

**No DEVELOPMENT_LOG.md entry this session.** Everything shipped is on four unmerged PRs; nothing
reached `main` or Production. The retirement of the generate-emails route, the D4 capability drop,
and the new `check:script-suggestion-writers` gate ARE milestone-worthy — write the entry in Session
491 once the stack merges and the deployment is Ready. No CLAUDE.md, schema or environment change.
A new `check:*` gate was added to CI, the `/start` list and `docs/CI_GATES_REFERENCE.md`. The
claim-evidence pilot report recorded no eligible plan/design edit for this session; no observation
row added.
