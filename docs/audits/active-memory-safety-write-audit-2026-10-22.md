# Active memory safety and write-instruction audit — 2026-10-22

**Status: checkpoint `cb18820d0`; all-claim audit INCOMPLETE.** The later
[remaining-memory audit](active-memory-remainder-audit-2026-10-22.md) closes the
active whole-read inventory and supersedes this report’s remaining-read queue.
 This continuation checks a named sample of active
memories against repository source and current owner decisions. It does not
certify all active memories or current external configuration. Sol investigated;
Luna edits confirmed defects; the parent reviews and runs local checks. Final
repair/review status is recorded below after completion.

## Scope and authority

Sweep Mode B and contract-reconcile review mode. Entry points are memory
instructions consumed by future agents. Persistence is repository documentation;
runtime source establishes behavioral contracts. Runtime source, enforced guards,
and explicit owner decisions outrank old plan/status prose. External permissions,
licenses, prices, automation inventories, deployments, and environment values
remain dated receipts or UNKNOWN today.

No live probes, sends, scanner calls, environment changes, deployments, migrations,
actual worktree changes, authentication actions, or pushes are authorized by this
pass. The unrelated critique and output directory and the owner-review-burden
memory remain untouched. Source-file corrections, if any, are comments only.

## Safety/write batch: whole-read inventory and bounded results

All leaf paths below are under `.claude-memory/`. “Agree” means the named scope
was supported or the existing uncertainty/historical boundary was appropriate;
it does not mean every sentence or live-state dependency was independently proven.

| Leaf | Bounded result / disposition |
|---|---|
| project-contact-promotion-permission.md | Repair universal accepted-reviewer scope: conditional test-request isolation skips follow-up; date privilege receipts. |
| project-dataverse-schema-deploy-gotchas.md | Repair guessed navigation casing, unconditional retries, raw-fetch exemption, and artifact-specific existence checks. |
| project-migration-numbers-claimed-off-main.md | Agree: filename tracking/sorted apply; allocated/applied database state UNKNOWN. |
| project-peer-review-executor-migration.md | Agree: both model calls use Executor and nonce assertions; published prompt/configuration UNKNOWN. |
| project-wave1-closeout-role-tail.md | Preserve closed migration and intentional role retention; July role and May database/PITR observations remain dated. |
| project-wave1-onboarding.md | Agree: app-grant helper does not implement staff-role assignment; proposed onboarding remains planned. |
| project-no-banking-pii-in-dataverse.md | Preserve owner prohibition; legacy-field interpretation explicitly provisional. |
| project-bill-honorarium-integration.md | Preserve BILL tabling and separate gates; qualify ordinary follow-up against conditional test isolation. |
| project-reviewer-accept-prod-automation.md | Qualify downstream creation and old environment inventory; preserve production-test authorization/automation boundary. |
| project-reviewer-duplicate-merge.md | Repair unknown-field fail-closed claim; preserve app-level authorization decision and actual known-field/ETag guards. |
| project-reviewer-closeout-payability.md | Agree: suggestion disposition is separate from Finance remit authority; external metadata/counts remain dated. |
| project-intake-portal-external-id-foundation.md | Separate built backend membership/draft/submit primitives from pending applicant UI and parked/incomplete broader workflow. |
| feedback-list-and-confirm-before-bulk-deletes.md | Agree: named-target authorization also covers destructive bulk status mutations. |
| feedback-never-self-authorize-prod-dataverse-reads.md | Agree: preserve explicit owner-controlled production access; no fresh configuration inference. |
| feedback-verify-write-paths-against-live-service.md | Add approved-target/access prerequisite without weakening mock-versus-real-wire lesson. |
| project-local-dev-auth-setup.md | Agree: nonproduction auth and local key primitive; clarify signing authority is separate from target/data access. |
| project-sandbox-rehearsal-bypass-allow-rule.md | Agree: historical machine-local permission is not application safety; current local rule presence UNKNOWN. |
| project-preview-rehearsal-venue-limits.md | Replace stale local-secret/production-only conclusion with local disposable-key and separately authorized data-target guidance. |
| project-intake-portal-virus-scan-e2e-deferred.md | Put future-pilot and named-product credit prerequisites before run instructions; alert attempt is not guaranteed persistence. |
| project-virus-scanning-it-context.md | Correct recipient fallback behavior and date tenant posture; preserve no-DFT-per-detection decision. |
| project-cloudmersive-advanced-endpoint.md | Retain source-supported advanced endpoint; gate diagnostic credit use and date efficacy experiments. |
| project-sharepoint-integration.md | Bounded agreement on discovery; writer completeness/authority and external grants/recovery remain separate. |
| project-sharepoint-property-promotion-rewrites-docx.md | Correct governed coverage, source/render attestation distinction, and universal round-trip claims. |
| project-test-residue-cleanup-is-for-data-mining.md | Preserve itemized authorization and cleanup rationale; no new inventory/delete/privilege authorization. |

## Evidence matrix and disconfirming checks

| Claim | Entry/writer → persistence → consumer evidence | Disconfirming check / conclusion |
|---|---|---|
| Lookup bindings are always PascalCase | `lib/bill/honorarium-onboard-orchestrator.js:154-163` constructs actual honorarium payload with lowercase Akoya navigation names and PascalCase WMKF names. | Concrete lowercase counterexample; exact relationship metadata is authority, not attribute casing. |
| Any schema failure can safely be retried indefinitely | `scripts/apply-dataverse-schema.js:69-75,95-104,165,223-228` sends deterministic and transient failures through the same exit. | No failure classifier supports blanket retry; diagnose transient lock only, bound attempts, re-preflight partial application. |
| Raw paging is universally fine for scripts | `lib/services/dynamics/read-ops.js:266-326` checks restrictions and uses guarded transport; `dynamics/http.js:60` interlocks it. Old `scripts/backfill-request-person-junction.js:105,157` uses raw fetch. | Raw fetch does not inherit those controls; reviewed paging must preserve target, authorization, restrictions, timeouts, and completeness. |
| All schema artifacts are checked by SchemaName | `lib/dataverse/schema-apply.js:196-202,319-329,347-381` distinguishes relationship schema names from attribute logical names. | Attribute branch falsifies the universal claim; old wave2 discrepancy needs fresh authorized metadata before operational reliance. |
| A new lifecycle field automatically blocks merge | `lib/services/reviewer-merge.js:30-53,63-66,82-84` checks only enumerated signals and exclusion. Execute re-plans at `:366-368`; guards/provenance/conditional slot operations at `:382-387,448-520`. | An unlisted field is not scanned by `.some`; documentation must not manufacture a whitelist guarantee. App-level authorization remains owner-approved. |
| Acceptance always promotes/creates honorarium | `reviewer-acceptance-drain.js:598-624` cancels isolated test follow-up and retries unknown markers; ordinary opt-out/normal paths at `:654-701`. `respond-service.js:422-485` queues before the fresh accept PATCH. | Handler success is not drain completion; isolation, opt-out, request/BILL gates and failure handling remain distinct. No live flag value checked. |
| Intake backend primitives remain unbuilt | `pages/apply/index.js:60-64` still shows foundation UI; membership service `:49-95`, submit route `:99-207,302`, draft service `:99-115` implement separate backend hops. | Existing persistence paths falsify the build-next list; they do not establish a finished applicant UI or full submission drain. |
| Local external tokens require production secret | `lib/services/external-token.js:36-45,88-119,125-167` accepts a configured 32+ character local key. | Local mint/verify primitive disproves production-only secret requirement; it grants no record authorization and bypasses no target interlock. |
| Awaited notification guarantees durable alert | `pages/api/intake/draft/attach.js:485-526` awaits notify but catches its failure, still returning rejection. `notification-service.js:81-83,119-130` separates storage and best-effort email. | Failure branch falsifies persistence/delivery guarantee. Blob deletion also has an explicit failure path at attach `:430-455`. |
| Missing category recipients prevents all alert emails | `lib/services/alert-recipients.js:93-115,128-142` resolves category/default/active-superuser fallback; `notification-service.js:173-203` unions explicit recipients. | Fallback and resolvable explicit PD are counterexamples; deliberate category configuration remains recommended. |
| Diagnostic scanner calls are free authorization | `lib/services/cloudmersive-scan.js:55,63-75,209-219,311-318` defines endpoint/flags and reaches vendor HTTP. Current `CLAUDE.md` rule 12 requires named-product possible-credit authorization. | Source proves real invocation, not current vendor pricing/efficacy. Historical entitlement estimates are not authorization. No call made. |
| Governed DOCX identity covers only word/ | `lib/services/documents/governed-docx-hash.js:124-195,241-291` traverses and includes reachable outside parts/relationships. | Explicit outside-parts hash branch falsifies word-only summary. |
| Source/render attestations guarantee whole-byte parity | `docx-package-attestation.js:831-972,980-1023` normalizes characterized metadata; only render enables specified existing SharePoint-shaped rewrites. `bundle-file-copy.js:289,311-335` settle-checks identity fields before receipt. | Source path has stronger existing-part/content-type checks, but neither is universal whole-package equality. Historical XLSX sample does not establish PPTX behavior. |

## Durable restatement scope

Investigators searched memories, docs, wiki, root instructions, rules, and skills for
these claims. Confirmed linked corrections include the membership build plan,
merge design, credentials scanner procedures, and Dataverse/Dynamics wiki. Known
entity-specific navigation names remain intact; historical Factory review records
remain historical. The report records bounded evidence rather than a vendor or
live-environment refresh.

## Repair verification

Parent final diff review is complete for the 25 repaired memory leaves and linked
durable restatements. Corrections found during review included wrong source paths,
overly broad historical summaries, an unsupported mandatory sandbox-before-production
sequence, and claims that instruction delivery mechanically enforced prior whole-file
reads. Those were corrected against the actual source and release policy.

Passed, with each gate before its self-test and the fixture-writing battery serial:
agent-invariants; memory-router; fact-consistency; canonical-pointers; doc-symbol-refs;
build-claim-freshness; agent-wiki; harness-framing; doc-currency; API-route coverage;
Atlas coverage; their applicable self-tests; and docs-catalog. The two edited JavaScript
files were parsed and their non-comment token streams compared with `435a3bbca`:
identical. No runtime logic was changed, and no runtime test suite was needed for those
comment corrections. These gates do not establish vendor/live-state or universal
memory correctness.

Memory health scans 304 leaves and reports **11 advisory flags** (seven shadow-atlas,
two weak-basis, two oversize-routed). The prior count was ten; the additional weak-basis flag names the
preview-rehearsal note, which intentionally retains dated environment observations. That note's current source-backed local signing rule
was reviewed; its retained environment observations are intentionally historical.
The flag is recorded rather than hidden through keyword changes or checker edits.
The owner-review-burden leaf remains byte-unchanged. The whole-repository audit remains
incomplete regardless of bounded gate results.

## Operating-instruction batch: whole-read inventory

| Leaf | Bounded result / disposition |
|---|---|
| feedback-author-adversarial-pass-first.md | Agree: producer grammar, exceptions, siblings before independent review. |
| feedback-cap-subagent-load-in-reproduction-briefs.md | Preserve owner process/worker ceilings; no load exercise performed. |
| feedback-dont-tune-against-hook-source.md | Preserve substantive correction then surface actual block; no matcher-tuning authorization. |
| feedback-returning-machine-sync-before-install.md | Agree with branch-aware startup and no forceful dependency repair. |
| feedback-scope-git-stash-in-shared-worktrees.md | Repair restore-to-HEAD advice: preserve exact pre-mutation bytes and stash ownership. |
| feedback-verify-branch-before-git-action.md | Repair universal sibling-path/current-branch topology claims; inspect ownership each task. |
| feedback-commit-before-delegating-to-worktree-agent.md | Remove whole-index staging patch example; share explicit owned dependencies without index changes. |
| project-agent-worktree-base-is-main.md | Bound S575 base observation; no blind merge/reorientation of an existing checkout. |
| feedback-reviewer-differs-from-author.md | Preserve independent review policy; current user Sol/Luna/parent assignment governs this task. |
| feedback-pause-for-codex-on-high-stakes.md | Preserve risk-scaled preimplementation review; no redundant authorization request here. |
| feedback-share-codex-verbatim.md | Preserve owner output policy; named reminder hook covers Agent/Task, not universal clients. |
| feedback-surface-full-review-findings.md | Preserve all-findings delivery; paid-review mentions do not authorize invocation. |
| feedback-codex-delegation-review-vs-rescue-routing.md | Bounded agreement on hook routing/markers; no wrapper or runtime invocation. |
| reference-codex-rescue-pkill-overstep.md | Preserve termination warning; old wrapper failure does not waive required contract review. |
| reference-codex-detached-exec-protocol.md | Retain S331 procedure as history; remove active broad kill/newest-session/job-file deletion guidance. |
| reference-codex-rescue-plan-task-runs-readonly.md | Repair universal immutable sandbox/main-root assertions; effective runtime capability remains unknown. |

## Verification-norm batch: whole-read inventory

| Leaf | Bounded result / disposition |
|---|---|
| feedback-apply-reconcile-to-fix-work.md | Agree: fix work requires independent evidence and restatement reconciliation. |
| feedback-behavior-claims-cite-the-producer.md | Agree norm; S275 incident does not prove present hook coverage. |
| feedback-cite-ground-truth.md | Agree: memory provenance is not independently established present truth. |
| feedback-completeness-by-scanner-not-enumeration.md | Bound scanner evidence to actual roots/extensions/patterns/exemptions. |
| feedback-corrections-decay-unless-mechanized.md | Repair unconditional command execution rule; authorization and NOT RUN remain explicit. |
| feedback-enforcement-hierarchy.md | Preserve derivation/gate preference over advisory friction; examples need evidence. |
| feedback-falsify-not-confirm.md | Agree: complementary searches, independent denominators, bounded claims. |
| feedback-idempotency-name-the-mechanism.md | Agree: identify enforcing mechanism; historical hold-step example stays historical. |
| feedback-plan-contracts-read-the-extremes.md | Agree: whole-flow/extreme-instance/denominator requirements. |
| feedback-read-the-implementation-not-the-callers-docblock.md | Agree norm; historical field/reminder examples not independently refreshed. |
| feedback-reconcile-dont-append-docs.md | Preserve all-agent whole-read rule; distinguish instruction delivery from mechanical read enforcement. |
| feedback-scrutinize-exemptions-and-fallthrough.md | Bound enum hook to registered pairs/configured tool path; internal errors fail open. |
| feedback-self-review-before-delegating-review.md | Agree: producer/boundary/concurrency/provenance checks; no paid-tool authorization. |
| feedback-symbol-consumer-fanout.md | Agree: raw persisted-symbol consumer review complements structural discovery. |
| feedback-verify-external-platform-claims.md | Agree: primary evidence/use-case scope; old vendor numbers remain historical. |
| feedback-vacuous-clean-results-print-the-denominator.md | Agree core: denominators/paging/populations; old only-running-can-see rationale stays historical. |
| feedback-thoroughness-default.md | Agree: whole-file reconciliation and honest partial-scope reporting. |
| feedback-timebox-metawork.md | Repair P0-only auto-ship example; blocking gates and release approvals still apply. |
| feedback-drive-to-completion.md | Preserve authorized persistence and real owner forks; no safety/release override. |

The requested filename `feedback-trace-before-recommending.md` did not exist.
It is not counted as read and no substitute was invented.

## Operating-source evidence and limits

Installed plugin source was read locally, without launching it, under
`/Users/gallivan/.claude/plugins/cache/openai-codex/codex/1.0.6/` on this host.
`codex-companion.mjs:461-495,764-782` resolves requested cwd and passes the request's
sandbox; `lib/codex.mjs:74-82,1095-1119` includes cwd/sandbox on resume/start.
This falsifies hardcoded-main-root claims but does not prove effective runtime
sandbox changes succeed. `codex-companion.mjs:963-1010` implements an exact-job
cancel path; that does not certify cancellation bug-free. No job was cancelled,
no PID inspected or killed, and no job evidence removed. The historical wrapper
incidents remain preserved; current required contract review is not waived.

Shared-index staging and restore-to-HEAD examples were compared with repository
ownership/preservation rules. Exporting a patch from explicit paths and preserving
the actual preimage avoids treating other work or an old stash as this task's
property. Historical plan references to watchdogs are visibly bounded; they are
not new operating instructions.

The parent read `.claude/hooks/enum-parity-commit-guard.js`: recognized Bash commit
calls run the registered enum gate; internal parse/helper failures intentionally
fail open. This is not universal enforcement for every client or unregistered
pair. The email-source test's four roots, `.js`/`.mjs` filter, and exemptions were
source-checked at `tests/unit/email-source-pairing-invariant.test.js:39,49-101`.
Path-scoped rule delivery is not proof a whole-file read happened. No checker,
hook, or test behavior was changed to alter those limits.

## Historical read-inventory checkpoint and then-next queue

The companion CSV enumerates all 272 active leaves present in this census. It
separates the 37 active leaves in the earlier 38-leaf sample (one was closed),
these 59 additional whole-read leaves, and the 176-leaf complement. The earlier
sample and this continuation are not exhaustive source verification of every
sentence; historical review work outside these named inventories is not silently
counted. The file is an audit record, not a new runtime registry.

1. **P1:** inspect remaining current write/security instructions in the CSV
   complement, including reviewer identity persistence/field verification,
   address/contact linking, applicant exclusion/COI boundaries, and request
   upload/retirement recommendations. Preserve current owner decisions; source
   presence is not live environment evidence.
2. **P2:** continue tooling/runtime/deployment and operational-memory claims not
   in the named sample, then roadmap/product integration and remaining feedback.
   Use bounded source evidence and exact per-leaf coverage rather than mass
   timestamp refreshes or blanket historical demotion.
3. **P3:** compress large current hubs only after contract reconciliation, with
   current/historical authority separated and preserved evidence. Do not chase
   advisory flags to zero by deleting useful decisions or changing checkers.

Unknown external schema/permissions, old vendor efficacy/pricing, current
configuration, and actual resumed-session capability are retained limits, not
instructions to probe live systems. Owner holds on BILL, intake/GOApply, role
retention, and approved merge authorization remain controlling.
