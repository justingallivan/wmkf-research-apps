# Session 389 Prompt: Codex integration of the reviewer contact/address findings

> **BRANCH-SCOPED DOCUMENT.** This file was written on `codex/claude-ui-cleanup` by
> owner instruction (S388): session documentation lands on the feature branch, NOT
> `main`. `main`'s `SESSION_PROMPT.md` is untouched and still describes S388-as-planned.
> **Codex owns this work as of S388** and will create a fresh integration branch from
> current `main`. Treat this file as a handoff record, not as the repo-wide session
> prompt — and expect it to conflict with `main`'s copy on merge. Resolve in Codex's
> favor or drop it; nothing here is load-bearing for anyone but the integrator.

## Session 388 Summary

Started as a narrow UI-cleanup mandate in an isolated worktree, which the owner
expanded mid-session. One presentation change shipped; the rest of the session traced
a Find-tab complaint through the send gate into contact promotion and produced a
problem statement, a canonical-doc fix, and one live defect.

Ownership transferred to Codex at end of session. Claude made no feature changes after
that point.

### What Was Completed

1. **Find-tab identity evidence disclosure (`3716d801`, refined in `d9ed574f`)**
   A needs-identity-review card showed a publication COUNT but suppressed the papers,
   affiliation, address, and Dataverse evidence, so staff answered "is this the right
   person?" with nothing to answer from — the evidence appeared only AFTER
   "✓ This is the right person → edit & add", which commits a durable request-scoped
   attestation. Added a collapsed "Review evidence before confirming" disclosure on
   `identityUnverified` cards only: affiliation + provenance label, Dataverse match,
   address as plain text with its source, all recent papers, and a Google Scholar NAME
   SEARCH. The verified TREATMENT stays suppressed (no mailto chip, no readiness
   verdict, no green "known in Dataverse"). 7 unit tests in
   `tests/unit/reviewer-candidate-identity-evidence.test.js`.

   Two deliberate properties, both recorded in
   `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md`:
   - **The paper list is LOAD-BEARING** — do not truncate or collapse it. Affiliation,
     address, and the Dataverse match all descend from the SAME retrieval and agree
     with each other whether or not the right person was retrieved. The papers are the
     only item checkable against the proposal, which is what breaks the circularity.
   - The Scholar link always uses `buildScholarSearchUrl()`, never `googleScholarUrl` —
     stricter than the other three render sites, because on an unresolved row a stored
     profile URL is the namesake trap itself.

2. **Fixed a self-contradiction in a canonical contract doc (`06e5505d`)**
   `docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md` asserted both that a later
   `scholarly_multi` corroboration DOES supersede `staff_verified` to `ready` AND that
   human assertions are terminal against machine evidence. It cited
   `tests/unit/my-candidates-verify-address.test.js` in support of the first — but that
   test carries an explicit `CORRECTED` note (`:297-305`) recording the S387 reversal
   and asserts `emailSourceUpgradeAllowed('scholarly_multi','staff_verified') === false`.
   S387 updated the test and the precedence paragraph and missed the bullet. Fixed;
   fan-out over `docs/` and `.claude-memory/` found no other surface repeating it.

3. **New problem statement (`6ee00ae4`, extended `d9ed574f`/`e00d238c`/`41399610`)**
   `docs/REVIEWER_CONTACT_PROMOTION_AND_ADDRESS_LIFECYCLE.md` — §0–§5.4. **Nothing in
   it is built.** Every "today" claim is cited to `file:line` and verified against
   source; proposals are `[PROPOSED]`; unverifiable claims are `[ASSUMED]`.

4. **Adversarial review by Codex `gpt-5.6-sol`, and the response (`d9ed574f`)**
   Verdict needs-attention / NO-SHIP for §4 as drafted. Findings were re-verified
   against source rather than accepted on report. Promotion-on-decline was withdrawn
   (a response proves token possession, not receipt by the intended person); several
   `VERIFIED` labels became `[ASSUMED]`; the one-story framing was demoted to a lens.

5. **Promotion-site map (`e00d238c`)**
   Bounded by disconfirming query: `wmkf_contact` can only be set by
   `potentialReviewer.setContactLink`, so its callers are the complete set. Exactly four
   runtime doors — candidate save, manual add, invitation send, and the ACCEPT DRAIN.
   Door 4 already promotes the contact and writes the reviewer's self-supplied mailing
   address at accept, before its capture-only deferral short-circuit, so it runs today
   with BILL tabled. So "promote on response, not send" is not new work; it is "remove
   door 3, let door 4 create new contacts."

   Final state [VERIFIED via read-only probes]: 0 placeholder-keyed rows carrying an anchor,
   0 duplicate `(request_id, suggestionId)` pairs, 0 rows failing the ungated-promotable
   invariant, 0 pinned of 385 person rows scanned.

6. **Four adversarial Codex passes, then a Codex write-access fix pass**
   Every pass found something real. Two reversed decisions of mine (human-assertion
   terminality; an illusory same-object pairing check). The write pass replaced a
   hand-rolled brace matcher with a real parse; verifying its work then found two gaps in
   it (an undeclared `@babel/traverse` import, and `errorRecovery` masking partial parses).

7. **A false clean result caught only by running it**
   The backfill's first successful dry run reported `0 person rows pinned` — vacuous.
   `queryReviewers` returns ONE 25-row page plus `hasMore`; it had scanned 25 of 385 rows.
   No review caught this because static reading cannot see a truncating read. Fixed with
   `potential-reviewer.queryAllReviewers`, a printed denominator, and a refusal on a
   zero-row read. Recorded in `docs/agent-wiki/topics/dataverse-dynamics.md`.

8. **Initial Assessment production schema and prompt gates completed 2026-07-30**
   The owner accepted the provisional v1 prompt/template pair and explicitly
   authorized the additive Production writes. Wave 16 created and read back the
   complete `wmkf_requestdocument` entity, attributes, five relationships,
   generation-key alternate key, and
   `akoya_request.wmkf_CurrentInitialAssessment` pointer. The create-only seed
   published `initial-assessment.generate` v1 at
   `fc8a4c3b-5e8c-f111-ab0f-7ced8d3d15a6`; a repeat dry-run refused overwrite.
   PR #102 subsequently merged as `1e958ee0` and deployed Ready as
   `dpl_AxxroabhpXLX1pz75MW6486fB4ci`.

9. **Controlled Initial Assessment pilot proved mechanics only on Request `1002788`.**
   Signed-in generation created Ready/Draft registry row
   `fb995f0f-628c-f111-ab0f-6045bd018a07`, populated the canonical request
   pointer, wrote SharePoint item `01G4GVMS77A2SBVPGA4VFINZFWAFIZGVFG`,
   and recorded completed AI run
   `b7ae9b17-628c-f111-ab0f-000d3a31c468`. The per-request Workbench and
   cycle-wide locator opened the same item. A same-input UI retry preserved
   the one row/run/item, timestamps, and attempt count, proving no duplicate,
   overwrite, upload, or second model call. Opening the Word file created
   SharePoint version `2.0`.

   The source was later identified as an old Phase I proposal, not the current
   Phase II proposal. The resulting artifact is therefore valid evidence for
   registry, SharePoint, consumer, and idempotency mechanics, but not for
   approved-input semantic correctness.

   The pilot also exposed two runtime defects. SharePoint repacked the uploaded DOCX,
   so canonical version `1.0` did not match the registry's pre-upload hash;
   `recoverUploadedFile()` would reject an untouched upload. The producer also
   omitted `requestId` from `executePrompt()`, leaving the exact run's
   `wmkf_ai_request` lookup null. Visible v1/v2 text was semantically unchanged
   and Foundation Opportunity still required staff input, so substantive human
   editing was not proven by that first rehearsal; Request `1003109` later
   closed that gate. Durable evidence:
   `docs/INITIAL_ASSESSMENT_CONTROLLED_PILOT_2026-07-30.md`.

10. **Initial Assessment runtime fixes are deployed in Production.**
    New `wmkf_contenthash` values use a `gdc1:`-tagged SHA-256 of normalized
    governed DOCX content: every `word/` package part remains covered, while
    the document relationship part is canonicalized only to remove
    SharePoint-injected `customXml` relationships and XML
    ordering/whitespace. Synthetic complement tests prove SharePoint metadata
    normalization is ignored while Word-body changes are detected. A one-off
    test against the actual pilot producer, SharePoint-v1, and v2 packages
    proved producer=v1 and producer≠v2. Unverifiable legacy raw hashes now
    block for operator reconciliation instead of being mislabeled as an edit
    and triggering a duplicate model/upload attempt. Recovery-stage exceptions
    persist Failed state immediately. The Executor call includes the request
    GUID with `requireNoPersistence`, so a mutable prompt row cannot turn this
    producer into an `akoya_request` writer. Opus returned `READY` after its
    material findings were addressed. Commit `9c88a1fa` is on `main` and
    production deployment `dpl_EVPb3vTWBYSUSABJYdKAPohruyQ1` is Ready with a
    clean initial error scan.

11. **Canonical-input Initial Assessment production proof passed on Request `1003109`.**
    PR #103 merged as `84155a5a`; production deployment
    `dpl_GiWsUy84mXW9bLDwSXYGoyHehqcW` reached Ready. Signed-in Workbench
    generation used the exact active
    `Reviewer Materials/Proposal_1003109.pdf`. A fresh read-only recomputation
    from that file matched the stored input fingerprint
    `df23a4ebfa2661d89dce81ea4c6cbe2937fa9f4607fb3e2a50981a49b1851a1b`
    and generation key
    `4803841d396aa1d2563aa36d2135efe6b51cc527183755dfbeca37f1f85f582f`.
    Registry row `3cec63a4-768c-f111-ab0f-6045bd018a07` is Ready/Draft,
    the request pointer targets it, SharePoint item
    `01G4GVMS3U3DHMJQ7GERBLB2QA3SYTLNHO` is registered, and AI run
    `528b97af-768c-f111-ab0f-7ced8d3d15a6` has the correct request lookup.
    An exact-input UI retry preserved the single row/run/item and attempt
    count. Production GET/POST returned 200 and the deployment error scan was
    clean.

12. **Interrupted-finalization recovery passed on Request `1003109`.**
    A controlled post-upload/pre-finalization failure left the existing
    SharePoint file intact while the registry row was Failed and the request
    pointer was empty. Signed-in `Retry draft` restored the same registry row
    and request pointer with attempt count `2`, while preserving AI run
    `528b97af-768c-f111-ab0f-7ced8d3d15a6`, SharePoint item
    `01G4GVMS3U3DHMJQ7GERBLB2QA3SYTLNHO`, version `1.0`, eTag,
    last-modified time, size, and governed hash. There was no second model
    call, upload, overwrite, duplicate row, or cleanup work. The owner accepts
    service-principal attribution for system-generated Dataverse registry
    writes; SharePoint native version history remains the required human-edit
    attribution surface.

13. **Substantive Initial Assessment editing passed on Request `1003109`.**
    Justin Gallivan edited the canonical SharePoint Word document, including
    Foundation Opportunity. Graph readback showed version `2.0`, attributed to
    Justin's user identity, on the same stable SharePoint item
    `01G4GVMS3U3DHMJQ7GERBLB2QA3SYTLNHO`. Read-only DOCX inspection found no
    remaining `STAFF INPUT REQUIRED` marker, and both the per-request Workbench
    and D26 locator still open the same item. The Dataverse registry correctly
    remains an upload/finalization snapshot at version `1.0`. Production
    deployment `dpl_HhiYXVFAtsGMwjU9UDcKz22AfvR2` (`68bcb4e8`) now performs
    response-only Graph-current refresh, and signed-in checks showed both
    consumers displaying the same current SharePoint version `2.0` and
    last-modified time. A disposable production-library audit then proved
    previous-version inspection/restore and signed-in first-stage recycle
    recovery. Justin's account was denied the second-stage administrator view;
    configured version limits, site/library retention, ordinary-editor
    permissions, Workbench history/admin restore, and milestone snapshots
    remain open.

### Commits

6 commits, `8a34a057..41399610`, all on `codex/claude-ui-cleanup`:
- `3716d801` — Show identity evidence before staff confirm a reviewer
- `6ee00ae4` — Problem statement for reviewer contact promotion and address lifecycle
- `06e5505d` — Fix the `staff_verified` precedence contradiction; record the UI change
- `d9ed574f` — Act on the S388 adversarial review: UI wording, load-bearing papers, doc
- `e00d238c` — Map every contact-promotion site; §4 is smaller than it looked
- `41399610` — The reviewer's own contact confirmation never reaches the send gate

## Next Items

### Verified Open

1. **Complete the remaining governed Initial Assessment pilot gates.**
   Canonical-input generation, new-run request lineage, exact reuse, and
   interrupted-finalization recovery passed on Request `1003109`. The
   attributed substantive edit, including Foundation Opportunity, also passed,
   and both consumers still resolve the same stable item. Refresh and display
   Response-only Graph-current version/last-modified refresh by stable
   drive/item identity is deployed and live-verified in both consumers on
   Request `1003109`. Native previous-version inspection/restore and
   first-stage recycle recovery also pass in the production Request library.
   Finish the administrator checks for configured version limits, second-stage
   recovery, site/library retention, and ordinary-editor permissions, then add
   Workbench history/admin restore and milestone snapshots before describing
   the artifact system as production-ready.

2. **Push/integration of this branch.**
   Evidence: `git log --oneline main..codex/claude-ui-cleanup` (6 commits). Base
   `8a34a057`; `main` has advanced 4 commits (SharePoint metadata work). Only
   `docs/DOCS_CATALOG.md` overlaps and it is GENERATED — resolve with
   `npm run generate:docs-catalog`, never a hand-merge. Codex will create a fresh
   integration branch from current `main`.

3. **The UI change has never been rendered against a real request.**
   Evidence: `.env.local` `DYNAMICS_URL=https://wmkf.crm.dynamics.com` (production, per
   `lib/dataverse/core/target-registry.js:28`); `DATAVERSE_TARGET_INTERLOCK=on` with
   `VERCEL_ENV` unset → deployment `local`, so `lib/dataverse/core/interlock.js` denies
   prod reads without `DATAVERSE_ALLOW_PROD_READS=yes` and denies prod writes outright.
   Also `shared/components/reviewers/ReviewerSearchSection.js:1265-1275` auto-fires
   `enrichRecommended()` on mount, which spends paid enrichment and writes roster rows to
   production Neon. Verified by jsdom tests and gates only.

### Owner Decision Needed

1. **Artifact registry and SharePoint target-library controls.**
   Evidence: `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md`.
   The pilot registry schema and governed prompt v1 are live in Production; the
   application, applicant-title (`akoya_title`) source, and staff-authored
   Foundation Opportunity requirement are implemented and production-proved.
   Graph-current readback, native version restore, and first-stage recycle
   recovery pass. Obtain SharePoint/Purview administrator evidence for version
   limits, second-stage recovery, retention, and ordinary-editor permissions,
   then implement Workbench history/admin restore and milestone-snapshot
   behavior. The generic registry has
   source-document/version/hash fields, but this pilot producer currently fingerprints
   the extracted canonical reviewer-proposal content rather than binding a governed source
   artifact/version; decide whether that stronger lineage is required before rehearsal.

1. **§1 option 1 / 2 / 3R** — whether a staff identity attestation may reduce send
   friction. `gpt-5.6-sol` recommends 3R (request-scoped, time-boxed waiver) over blanket
   promotion. Reopens an S387 "Do Not Reopen" item.
2. **Promotion on identity-bearing accept (§4.1/§4.3)**, including the CRM-visibility
   tradeoff — an invited-but-unresponsive reviewer would no longer appear as a `contacts`
   row. Needs a CRM-facing staff answer, not a code answer.
3. **Contact provenance attribute(s) (§3)** — Dataverse schema decision.
4. **Durable vs disposable home for the non-response signal (§5.2).**
5. ~~Contracts-doc contradiction~~ — **DONE** in `06e5505d`.
6. **`reviewer_confirmed` address source (§5.4)** — write the reviewer's own
   confirmation back to provenance. Needs an explicit carve-out from §2.1 terminality.

### Parked

1. **Always-show-the-proposal-anchor comparison in the evidence disclosure.**
   Evidence: `shared/components/reviewers/ReviewerSearchSection.js:407-414` —
   `institutionMismatch` / `expertiseMismatch` already compute proposal-side vs retrieved
   and render ONLY when they fire, so silence is ambiguous between "they agree" (real
   corroboration) and "no comparison possible". Owner deprioritized: the restructure would
   push the papers down, and the papers are the working control. Re-open if namesake
   confirmations are observed in practice.

### Verify Before Acting

1. **Anything treating `docs/BILL_CHUNK_4_DESIGN.md` as current.**
   Evidence: its own frontmatter `status: historical` and banner — automated BILL
   integration was TABLED 2026-07-12. Owner confirmed S388: the apps do **not** refer
   reviewers to BILL.com in any way; the accept-time path under `lib/bill/` is honorarium
   payment-INFORMATION COLLECTION only and the naming is vestigial. Cite it only as a
   recorded historical observation.

2. **Anything reading `wmkf_responsereceivedat` as "a response arrived".**
   Evidence: `lib/services/reviewer-suggestion-sweep.js:93-96` stamps it with the SWEEP
   time alongside `wmkf_responsetype = no_response`. `wmkf_responsetype` is the
   discriminator; the timestamp is not.

3. **Anything assuming `main` is at `8a34a057`.** It is 4 commits ahead.

### Do Not Reopen Without New Decision

1. **`manual` / `staff_verified` are TERMINAL against machine evidence.**
   Evidence: `lib/utils/reviewer-invite.js:151` `emailSourceUpgradeAllowed`;
   `lib/dataverse/adapters/researcher.js:238-243`;
   `tests/unit/my-candidates-verify-address.test.js:297-313`. S387 decision after
   adversarial review. §5.4's `reviewer_confirmed` proposal would need an EXPLICIT
   carve-out, not a silent exception.

2. **The evidence disclosure's paper list must not be truncated or collapsed**, and its
   Scholar link must stay a name search. Evidence: source comments in
   `ReviewerSearchSection.js` and the S388 block in
   `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md`.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/REVIEWER_CONTACT_PROMOTION_AND_ADDRESS_LIFECYCLE.md` | The problem statement — §0–§5.4, nothing built, six owner decisions |
| `shared/components/reviewers/ReviewerSearchSection.js` | The identity-evidence disclosure (the only feature change this session) |
| `tests/unit/reviewer-candidate-identity-evidence.test.js` | 7 tests pinning the disclosure, incl. the no-truncation and no-stored-profile guards |
| `docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md` | Canonical send-gate contract — the `staff_verified` contradiction is fixed here |
| `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md` | Load-bearing-papers note + Scholar 4th-site rule |
| `lib/services/review-manager/send-emails-service.js:573-597` | Door 3 — the §4.2 live defect |
| `lib/bill/honorarium-onboard-orchestrator.js:86,108,369` | Door 4 — accept-time promotion + address capture, live today |
| `lib/services/reviewer-finder/save-candidates-service.js:1084-1121` | Door 1 — the deliberate do-not-link decision that door 3 overrides |
| `lib/utils/reviewer-invite.js` | Send-gate buckets + provenance precedence |

## Testing

```bash
rtk npx jest tests/unit tests/integration    # 546 suites / 6576 tests green at 41399610
rtk npm run lint                             # 0 errors (51 pre-existing warnings, none in touched files)
rtk npm run build                            # clean
rtk npx jest tests/unit/reviewer-candidate-identity-evidence.test.js   # the 7 disclosure tests
```

All `check:*` gates were green at `41399610`, including `check:agent-wiki`,
`check:doc-symbol-refs`, `check:fact-consistency`, `check:drain-table-mentions`,
`check:docs-catalog`, and `check:types`.

Not run: any live/visual verification (see Verified Open #3).
