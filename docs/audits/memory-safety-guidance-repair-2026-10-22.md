# Memory safety guidance repair — 2026-10-22

## Scope and invariants

Sweep Mode A (five accepted claim corrections), contract-reconcile Mode B.
This is a documentation and source-comment repair following the read-only domain
review. No runtime behavior, worktree topology, environment configuration, deployment,
external data, or owner policy is changed. Historical probes are not refreshed.

| Invariant / claim | Entry / producer → persistence → consumer evidence | Documentation repair | Status |
|---|---|---|---|
| Request-specific identity uncertainty cannot erase shared fields. | save-candidates-service → researcher.clearIdentityFields → existing person fields preserved; adapter returns cleared:false for every stored status. | Phase-one memory/current Recall Rule; Phase-2 design historical boundary; misleading save-service comments. | VERIFIED via current source |
| Automated decisions preserve confirmed/probable evidence with concurrency protection. | researcher.writeIdentityDecision reads status/anchors, rejects downgrade or disjoint probable refresh, requires ETag, passes ifMatch to updateRecord. | Sticky-confirmed memory and C0.2 historical/current separation. | VERIFIED via current source |
| Portal withdrawal is bounded, not an arbitrary financial reset. | respond-service locks after materials or receipt; accepted decline → applyStage2aResponse ETag-bound exact linked-request cleanup → cancellation/drain compensation; person/suggestion history retained. | Hold-step memory and finance wiki; retain separate staff withdrawal/release semantics. | VERIFIED via current source |
| Invitation mailbox is distinct from the editing actor. | send-emails-service assigned PD resolution → invitation emailPayload PD mailbox/system ID/noFallback:true; other templates retain acting staff sender. | Invite-workflow Recall Rule and June signature history. | VERIFIED via current source |
| Acceptance response does not establish follow-up completion. | respond-service stages reviewer_acceptance_jobs before fresh accept PATCH → returns acceptanceJobId; leased acceptance drain re-reads state → orchestrator/contact/honorarium/email → retry/terminal outcomes and late-withdrawal compensation. | BILL integration summary/body/history, finance wiki, production-testing memory. | VERIFIED via current source |

No new enum, table, route, helper, asynchronous branch, or persistence contract was
introduced. Contract audits for new partial-success, async state, helper extraction,
and symbol fan-out changes are N/A; existing queue and conditional-write branches
were examined as documentation evidence. Durable-surface and doc-reconciliation
checks apply. Source edits must have identical non-comment tokens to HEAD.

## Restatement classification

- STALE → repaired: six active memory leaves (phase1, sticky-confirmed, hold-step,
  invite-workflow, BILL integration, production-automation testing); finance wiki;
  live clear-on-downgrade design instructions; C0.2 non-atomic-current wording;
  two save-candidates comment regions.
- AGREE: potentialreviewers Atlas already states ETag protection/no blanket clears;
  Postgres acceptance ledger Atlas already describes durable follow-up;
  accept-decline-links memory and invitation wiki describe the newer contracts.
- HISTORICAL: June resolver design and May/June BILL chunk design now visibly
  separated from current guidance. Prior audits, archive snapshots, dated original
  implementation records, and the ORCID-backprop design's explicitly historical
  body retain their evidence. The July29 promotion plan distinguishes its pre-fix
  baseline from the repair contract.
- UNRELATED: other inline upload/stream/UI references found in the initial broad
  search; no edits warranted.

Disconfirming checks: read the clear adapter's body rather than infer from its
name; check missing-ETag and probable-anchor branches; check materials and receipt
locks before decline; inspect non-invitation transport fallback; inspect accept
return and actual drain call to ensureHonorarium rather than assume synchronous
completion. All support the bounded corrections above.

Owner decisions preserved: BILL remains tabled pending a new decision; approved
contact capture is distinct from prohibited banking PII; Finance retains final
remit authority; hold/finalize stays retired; production tests remain fenced and
require the Power Automate owner review. Existing historical cleanup/probe commands
are records or separately gated procedures, not authorization to execute them.

## Verification and limits

Validation: all 24 selected check/self-test invocations passed (10 sequential pairs:
atlas, doc-currency, fact-consistency, doc-symbol-refs, build-claim-freshness,
canonical-pointers, drain-table-mentions, prompt-storage-mentions, agent-wiki,
memory-router; plus agent-invariants, docs-catalog, memory-drift, memory-health).
The catalog initially reported its expected generated-summary drift; regenerating
it changed only the Phase-2 design summary row, and the catalog check then passed.
Memory-health remains advisory: seven shadow-atlas signals and one weak-basis
signal. The latter is this repair's explicit statement that phase-one historical
counts were not re-probed; it does not negate the source-verified safety contract.
No advisory signal was hidden by refreshing historical measurements.

The save-candidates file has identical Babel non-comment tokens to HEAD;
`git diff --check` passed. Runtime tests/build were not run for prose/comment-only
changes. Fresh reviewer `safety_review` found no blocking issue, checked current
adapter source, caught the related C0.2 restatement, and verified preserved owner
boundaries and historical framing. Its narrow C0.2 correction is included.

Claims: 5 → VERIFIED 5 (repository behavior only). Repeated scoped searches leave
zero live stale assertions for these five corrected contracts; historical wording
is explicitly bounded. Verdict: RECONCILED for these five claims only.
No live probes were run. Current serving deployment, environment flags, automation
inventory, permissions, payment counts and alert states remain UNKNOWN in this
repair. Sourcing changes, faculty-page status, release timestamps, and historical
closeout/deployment conflicts remain deferred to the other proposed batches.
This report certifies only the five scoped claim corrections, not the whole domain.
