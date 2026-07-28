# Session 379 Prompt: Review-synthesis reliability and lifecycle closure

## Session 379 In-Progress Summary

The local review-synthesis reliability change is implemented and focused
verification is green. `executePrompt` now preserves the normalized full text
and stop metadata, requires `stopReason=end_turn` before either raw or JSON
output can reach persistence, retains policy-compliant failure diagnostics, and
capability-gates prompt-level Anthropic native JSON schema. The synthesis prompt
uses a strict schema, and `synthesizeReviews` retries one confirmed
`claude_output_truncated` invocation once with a bounded doubled budget. Because
the retry is caller-owned, both semantic model invocations independently attempt
their own append-only `wmkf_ai_run` row.

Verification so far: 102 focused/surrounding Executor and synthesis tests
passed; `check:model-registry` and its six-case self-test passed. Independent
post-implementation review found no P0 and identified fail-open mode validation,
retry-cap, audit-link, complement-test, and stale-doc issues; those local issues
were corrected; the bounded follow-up returned READY. Commit, governed prompt
publication/deployment, and the controlled post-fix production smoke remain.

## Local Operational Retention Milestone — Complete

The owner-approved, fail-closed source disposal removed all 139 reviewed
ignored, untracked regular files (15,287,781 bytes) with zero failures and zero
residual regular files in scope. Preflight reverified every source hash, all 82
archive-backed copies, all 20 separately preserved unique-source files, and
source/archive separation. The owner-only organizational archive remains
retained; five excluded dependency symlinks remain untouched.

Use
`docs/audits/local-operational-data-retention-audit-2026-07-27.md` and
`docs/audits/local-operational-source-disposal-receipt-2026-07-27.md` for the
privacy-safe evidence. This closes only the ignored local regular-file
component; reachable public Git history remains unresolved under
`docs/audits/public-repository-pii-history-audit-2026-07-27.md`.

## Public Git History Remediation — Owner Decisions Pending

Read-only GitHub preflight and a disposable `git-filter-repo` simulation are
complete. The public repository currently has 68 branch refs, one tag, 91 PR
head refs, nine PR merge refs, nine open PRs, 1,942 Actions artifacts, zero
forks, and four linked local worktrees. Two worktrees contain untracked files.

The targeted simulation selected 694 non-current historical blobs across 65
audited paths plus three history-only commit-message contacts. It removed all
selected objects/values, preserved the then-current public `main` tree exactly,
and passed object-integrity checks. All 91 PR head refs changed, so a real
rewrite requires GitHub Support cleanup and full old-clone invalidation.

A later semantic review reopened the current-tree privacy prerequisite:
`modules/expertise_matching` is a non-production reference/demo that
duplicates the protected 38-person production roster and retains person-linked
cycle assignment/usage findings. The production app, authenticated API, and
database remain live and are not removal targets. The owner must decide
whether to privately archive and remove the retired duplicate or retain a
sanitized public design/findings record. The earlier dry-run counts validate
mechanics but are not a complete final removal specification.

No external or destructive action is yet authorized. Use
`docs/PUBLIC_GIT_HISTORY_REMEDIATION_PLAN.md` for the execution invariants,
alternatives, exact decision list, and final-freeze requirement.

## Session 378 Summary

Session 378 executed the owner-authorized production review-synthesis smoke on
Request `1002788`, stopped after the first regeneration failure, restored the
reversible synthetic review, and reconciled the changed durable facts.

### What Was Completed

1. **Production smoke executed as a bounded failure**
   - A controlled review was entered through the signed-in staff Manual Review
     Entry path, creating exactly 11 answer rows and changing only receipt,
     status, affiliation, and staff-upload fields.
   - The first and only Regenerate attempt returned HTTP 500.
   - Vercel and Dataverse recorded
     `Claude output not valid JSON: Unexpected end of JSON input`.
   - Failed AI run `be61f383-f289-f111-ab0f-70a8a59cded0`
     (`2026-27-07-1355`) used `claude-sonnet-5`,
     `review-synthesis.generate` v2, and Vercel Interactive source; its review
     input override is redacted.

2. **No partial synthesis write**
   - `wmkf_reviewsynthesisjson` remained exactly 1,709 characters with SHA-256
     `a91f05cc0a20cad72341db9d7fc5fe808ed3b28610a35dfdaca82d69beebbcba`.
   - The request `modifiedOn` remained `2026-07-24T18:43:25Z`.
   - This is the third controlled current-v2 incomplete-JSON failure; it is not
     evidence that the successful v1 memo is invalid.

3. **Synthetic state fully restored**
   - Deleted exactly the 11 staged answer IDs.
   - Restored the four suggestion fields to their exact baseline.
   - Verified zero answers, no draft, unchanged target non-staging fields,
     unchanged sibling fields, and unchanged email/material/reminder/thank-you
     markers.
   - The append-only failed AI audit row intentionally remains.
   - A signed-in production reload again showed zero submitted and two
     outstanding reviews.

4. **Queue and durable documentation reconciled**
   - The production-smoke item closed through its documented bounded-diagnosis
     alternative.
   - The next task is synthesis structured-output reliability and the approved
     lifecycle contract—not another blind regeneration.

## Prior Session 377 Summary

Session 377 completed a repository-wide material-claim audit against current
source, tests, migrations, configuration, and dated probe evidence. It repaired
the highest-risk false claims, recorded residual drift and live-state unknowns,
and explicitly stopped short of claiming sentence-perfect or live-environment
reconciliation.

Three domain agents divided the initial evidence gathering. A separate Codex
adversarial review challenged the report, and Claude Code then performed an
independent read-only adversarial pass. Claude found nine additional issues; the
documentation-scoped findings were corrected, and the one runtime issue was
registered as an open P1 rather than silently changed.

The complete audit commit was fast-forwarded to `main` and pushed as `0263e07f`.

### What Was Completed

1. **Repository-wide material-claim audit and partial reconciliation**
   - Audited current documentation, memory, source comments, guides, Atlas
     pages, instruction surfaces, gate claims, and selected tests against code.
   - Durable report:
     `docs/audits/AUDIT_FULL_DOCUMENTATION_TRUTH_2026-07-26.md`.
   - The report names active residual drift, mixed historical/current plans,
     unsafe operational scripts, invalid line references, and live probes that
     were not run.

2. **High-risk false claims repaired**
   - Emergency auth documentation now names the actual
     `NODE_ENV=production` predicate and the required
     `EMERGENCY_AUTH_BYPASS=true`.
   - The BILL/discovery expected-red exemption was closed after the exact suites
     passed 78/78 tests.
   - Integrity Screener guides no longer promise a History tab or durable
     dismissal suppression.
   - Executor failure/audit/output semantics, Virtual Review Panel provider
     selection, Dynamics Explorer context trimming, Blob-token ownership,
     reviewer persistence, prompt paths, and model/gate enforcement claims were
     reconciled.
   - `AI_PROMPTS_DETAILED.md` is historical/noncanonical rather than a false
     exhaustive source of prompt truth.

3. **Operational hazards surfaced without destructive action**
   - Twenty-five non-archive scripts mention the dropped `reviewer_suggestions`
     table; some contain direct mutations.
   - `scripts/README.md` no longer provides copy-pasteable commands for those
     retired-table flows and marks them blocked.
   - Script quarantine/removal was not performed because it changes operational
     capability and requires owner-approved scope.

4. **Independent adversarial review completed**
   - Codex review caught report self-drift, omitted active reviewer documents,
     overbroad Atlas verification, and unsupported owner-policy language.
   - Claude found nine further issues, including the auth-status divergence,
     incorrect Dynamics history wording, false prompt canonicality, stale seed
     comments, and gate/CI overclaims.
   - Claude's follow-up verdict after repairs: ready to commit, with no remaining
     documentation blocker.

5. **Verification completed**
   - Full Jest: 517/517 suites, 6,150/6,150 tests.
   - Focused post-Claude auth/Executor verification: 74/74 tests.
   - Production build passed.
   - ESLint exited with 0 errors and 50 pre-existing warnings.
   - Relevant documentation, Atlas, API, wiki, memory, instruction, model,
     prompt-injection, trust/data-boundary, and secret gates passed; paired
     self-tests passed where defined.

### Commits

- `4adafb62` — Trim derivable CLAUDE.md content and record two verification lessons
- `9bb2e6d4` — Reconcile Project Shape removal and record the npm/brew install-path hazard
- `e5d9b78f` — Reconcile live Dataverse row counts
- `0263e07f` — Reconcile documentation claims with code

## Next Items

### Verified Open

1. **FIRST: finish review-synthesis structured-output reliability promotion.**
   Evidence: `docs/CURRENT_WORK_QUEUE.md`,
   `docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md`, and
   `docs/WORKBENCH_REVIEWS_TAB_BUILDOUT_PLAN.md`.
   Three controlled current-v2 production calls failed before writeback with
   incomplete JSON. The local fix and focused tests are complete: native JSON
   schema is prompt-opt-in/capability-gated, nonterminal responses fail before
   persistence, and only confirmed `max_tokens` gets one caller-owned bounded
   retry. Independent follow-up review is READY and the gates are green. Commit,
   publish the governed prompt version, deploy deliberately, then run one
   controlled post-fix smoke.

2. **Resolve or explicitly defer the P1 auth-status policy divergence.**
   Evidence: `pages/api/auth/status.js`, `lib/utils/auth-policy.js`, and the
   audit report's high-risk disposition table.
   `/api/auth/status` can report `enabled:false` while production-mode server
   enforcement remains enabled. Use `/contract-reconcile` before changing the
   response because `RequireAuth`, `Layout`, and the home page consume it.

3. **Continue the deadline and lifecycle implementation discussion.**
   Evidence: `docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md` Calendar Gate
   and Decision Log.
   Obtain each fixed date, audience, and minimum required artifact/action before
   converting the relative sequence into calendar commitments. Synthesis
   participation semantics were owner-confirmed on 2026-07-27; use the plan's
   resolved state machine rather than reopening that decision.

4. **Plan the next reconciliation slice without claiming the repository clean.**
   Evidence:
   `docs/audits/AUDIT_FULL_DOCUMENTATION_TRUTH_2026-07-26.md`.
   Highest-value candidates are read-only live probes, retired-table script
   quarantine, reconciliation-generator redesign, line-reference validation,
   and full-body reclassification of the explicitly named mixed plans.

5. **Proceed with Q9 app-access Stage 4 from the deterministic acceptance
   baseline.**
   Evidence: `docs/Q9_PREFS_APPACCESS_DAL_MIGRATION_PLAN.md` and
   `docs/audits/q9-app-access-stage2-acceptance-2026-07-27.md`.
   The owner replaced the low-signal passive warn soak with
   `DATAVERSE_DAL_UNIVERSAL=on` contract acceptance across each app-access
   entry-point class plus a read-only live inventory. All 33 focused assertions
   passed. Stage 2 is satisfied; Stage 4 is ready to execute. Preserve its
   required deliberately designated ordinary-user Preview smoke, reversible
   grant/revoke restoration check, authenticated reviewer-finder
   `analyze`/`discover` check with a known prompt override, and production log
   watch at release time.

### Owner Decision Needed

1. **Auth-status contract.**
   Decide whether `/api/auth/status` should report the effective
   `isAuthRequired()` enforcement state or remain a narrower configuration hint
   with consumers changed accordingly.

2. **Retired-table script disposition.**
   Authorize and scope quarantine, fail-closed guards, archival, or removal for
   operational scripts that still target dropped reviewer tables.

3. **Read-only live probe pack.**
   Authorize a dated pass over Vercel environment posture, Postgres/Dataverse
   counts and statuses, prompt/question rows, external reviewer usage, BILL,
   Blob, and external automation state.

4. **Fixed deadlines.**
   Provide the fixed dates and minimum outcomes for the remaining Workbench
   lifecycle. Synthesis participation semantics are closed in
   `docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md`.

### Parked

1. **Automatic synthesis triggering and another production regeneration until
   the synthesis reliability defect is fixed, reviewed, and tested and the
   approved readiness state machine is implemented.**

2. **Implementation of the four placeholder tabs until the design/calendar
   gate is complete.**

3. **Mechanical status-flipping of large plans.**
   Each named mixed plan needs a full-body historical/current rewrite before
   frontmatter changes.

4. **Destructive reviewer cleanup or retired-table script execution.**
   Current person reuse and dropped-table state make inherited cleanup guidance
   unsafe.

### Verify Before Acting

1. **Do not cite the audit as a sentence-perfect or live-environment-complete
   reconciliation.**
   It is a repository-wide material-claim audit with partial reconciliation.

2. **Do not cite the earlier 55-command startup result as a complete registered
   gate battery.**
   No machine-readable command receipt identified the omitted command.

3. **Do not change `/api/auth/status` as a comment-only cleanup.**
   It is a live cross-layer behavior contract with multiple consumers.

4. **Do not run or repair retired-table scripts from their names alone.**
   Inventory callers, tables, and destructive behavior first.

5. **Do not promote probe-required external state to verified.**
   Source truth cannot establish current Vercel, Dataverse, Postgres, BILL,
   Blob, SharePoint, or Power Automate state without a dated probe.

### Do Not Reopen Without New Evidence

1. **The BILL/discovery test exemption is closed.**
   The exact suites passed 78/78 and are no longer expected-red.

2. **Integrity Screener has no current History UI or durable dismissal
   suppression.**

3. **The detailed AI prompt inventory is historical/noncanonical.**
   Current truth comes from source plus live prompt rows.

4. **The S376 Workbench pass was bounded, not a complete domain audit.**

## Key Files Reference

| File | Purpose |
| --- | --- |
| `docs/audits/AUDIT_FULL_DOCUMENTATION_TRUTH_2026-07-26.md` | Audit method, corrections, residual drift, probe boundary, and recommendations |
| `docs/CURRENT_WORK_QUEUE.md` | Canonical priority queue plus verified audit follow-ups |
| `docs/CI_GATES_REFERENCE.md` | Actual enforcement tiers and serial fixture guidance |
| `docs/AUTHENTICATION_SETUP.md` | Correct emergency bypass contract |
| `pages/api/auth/status.js` | Open client-bootstrap/server-enforcement divergence |
| `lib/utils/auth-policy.js` | Effective fail-closed auth policy |
| `docs/EXECUTOR_CONTRACT.md` | Reconciled Executor input/output/failure contract |
| `docs/APPLICATION_STATE_ATLAS.md` | Data-layer routing and ownership |
| `scripts/README.md` | Blocked legacy operational script guidance |
| `docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md` | Current product execution sequence |
| `docs/Q9_PREFS_APPACCESS_DAL_MIGRATION_PLAN.md` | App-access DAL Stage 4, now unblocked by deterministic context acceptance |
| `docs/audits/local-operational-data-retention-audit-2026-07-27.md` | Local retention findings, preservation boundary, and completed source-disposal status |
| `docs/audits/local-operational-source-disposal-receipt-2026-07-27.md` | Privacy-safe aggregate receipt for the completed 139-file disposal |
| `docs/audits/public-repository-pii-history-audit-2026-07-27.md` | Current-tree privacy findings, including the unresolved retired expertise-matching duplicate, and reachable-history findings |

## Testing

```bash
rtk npm run check:docs-catalog
rtk npm run check:doc-currency
rtk npm run check:doc-currency:self-test
rtk npm run check:fact-consistency
rtk npm run check:fact-consistency:self-test
rtk npm run check:atlas
rtk npm run check:atlas:self-test
rtk npm run check:api-routes
rtk npm run check:api-routes:self-test
rtk npm run check:agent-wiki
rtk npm run check:agent-wiki:self-test
rtk npm run check:memory-router
rtk npm run check:memory-router:self-test
rtk npm run check:instruction-architecture
rtk npm run check:agent-invariants
rtk npm run lint
rtk npm test -- --runInBand --silent
```
