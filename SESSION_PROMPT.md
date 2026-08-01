# Session 389 Prompt: Codex integration of the reviewer contact/address findings

> **RELEASED INTEGRATION DOCUMENT.** Codex accepted Claude's S388 handoff,
> replayed all seven commits onto `codex/reviewer-contact-integration`, and
> implemented the acceptance-boundary hardening there. Reviewer runtime release
> `824bfcc6` entered `main` on 2026-07-31; its production deployment
> `dpl_35pUuvT8DowJPHbyBsiJxKGRNMZT` reached Ready. Claude's original
> `codex/claude-ui-cleanup` branch and worktree remain preserved at `2df84aae`.

> **S390/S391 implementation addendum (2026-07-31):** the §1 1/2/3R decision frame
> below is superseded for current planning. The owner chose person-scoped,
> no-expiry trust until contradicted, accepted a linked corresponding-author
> paper as valid evidence for an explicit exact-address attestation, and required
> every error/warning to offer a working remedy. The replacement draft is
> `docs/REVIEWER_ADDRESS_TRUST_AND_CONFLICT_RESOLUTION_PLAN.md`. The runtime,
> tests, and Wave 17 schema-as-code are built on
> `codex/reviewer-address-trust-plan`; Wave 17 and the runtime have not been
> deployed, so Production behavior remains unchanged pending schema-first release
> and a controlled signed-in pilot.
> Claude Opus 5's first adversarial implementation review returned NO-SHIP; its
> confirmed findings were fixed in `f1b85e78`. The second review confirmed all
> nine fixes but also returned NO-SHIP: `retry_check` can write person-scoped
> conflict state through a provisional ORCID, and five medium contract gaps
> remained. Codex has now remediated those findings in source: retry shares the
> anchor-grounded active-person rule, existing receipts are replayed rather
> than reopened, resolved applicant pairs remain unblocked, receipt-first
> partial success and stale ETags are explicit, typed promotion blocks retain
> remedies, and the route matrix records retry's writes. The third review of
> `21b44680` confirmed those fixes but returned NO-SHIP on a no-bundle receipt
> retry dead end, the promoted-conflict UI, roster identity authority, manual
> edit bypass, inactive-person reason, and one count typo. Codex has remediated
> those findings in source. The fourth review of `c5e6d008` confirmed them but
> returned NO-SHIP on JSONB-unstable and mutable-contact-bound identity receipts,
> loss of the adjudicated address pair in the no-bundle path, optional ETag
> enforcement, and incomplete UI repair guidance. Those findings are remediated
> in source; a fifth read-only adversarial review is pending.
> Wave 17/runtime promotion remains blocked until it passes.

## Session 388 Summary

Started as a narrow UI-cleanup mandate in an isolated worktree, which the owner
expanded mid-session. One presentation change shipped; the rest of the session traced
a Find-tab complaint through the send gate into contact promotion and produced a
problem statement, a canonical-doc fix, and one then-live defect that S389
subsequently resolved.

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
   `docs/REVIEWER_CONTACT_PROMOTION_AND_ADDRESS_LIFECYCLE.md` — §0–§5.4. At the
   Claude handoff it was a problem statement only. S389 subsequently implemented
   §4 (item 14); the other sections remain proposed unless marked resolved.

4. **Adversarial review by Codex `gpt-5.6-sol`, and the response (`d9ed574f`)**
   Verdict needs-attention / NO-SHIP for §4 as drafted. Findings were re-verified
   against source rather than accepted on report. Promotion-on-decline was withdrawn
   (a response proves token possession, not receipt by the intended person); several
   `VERIFIED` labels became `[ASSUMED]`; the one-story framing was demoted to a lens.

5. **Promotion-site map (`e00d238c`)**
   Bounded by disconfirming query: `wmkf_contact` can only be set by
   `potentialReviewer.setContactLink`, so its callers bounded the set. At the S388
   baseline there were four runtime doors — candidate save, manual add, invitation
   send, and the ACCEPT DRAIN.
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

14. **Reviewer contact-promotion boundary deployed in Production.**
    Invitation send no longer creates/links contacts or back-propagates ORCID.
    Every accepted reviewer, including honorarium opt-outs, enters one
    identity-aware promotion path; declines do not. Ambiguous email/ORCID,
    split identities, and namesakes remain unlinked with a durable alert.
    Genuine new contacts use a canonical-ORCID-derived primary key across
    duplicate reviewer rows, with reviewer-ID fallback when ORCID is absent.
    Contact creation and the reviewer link commit atomically under a reviewer
    ETag; existing links and inactive matches fail closed unless identity
    validation succeeds. The first post-implementation adversarial review found
    four P1 and four P2 issues; all were fixed. A fresh full re-review returned
    `READY`. Runtime release `824bfcc6` entered `main`; deployment
    `dpl_35pUuvT8DowJPHbyBsiJxKGRNMZT` reached Ready on 2026-07-31. Deployment-
    scoped logs showed signed-in Workbench/API traffic completing with HTTP 200.
    The authenticated production visual check then passed on Request `1002912`:
    Petr Cejka remained unselectable in Find pending identity confirmation, the
    disclosure rendered the unconfirmed affiliation/address provenance and all
    five retrieved papers, and its Scholar destination was a name search rather
    than a stored profile. The owner-authorized normal Find ingestion also
    restored the prior candidate set and recognized Rotem Sorek and four other
    applicant referrals as existing linked reviewers with known email data. No
    invitation, acceptance, decline, or identity-confirmation action was taken.

### Commits

Seven Claude commits were replayed without content conflicts onto
`codex/reviewer-contact-integration`:
- `f2244653` — Show identity evidence before staff confirm a reviewer
- `c1ae9791` — Problem statement for reviewer contact promotion and address lifecycle
- `39e200d3` — Fix the `staff_verified` precedence contradiction; record the UI change
- `9b8437a5` — Act on the S388 adversarial review: UI wording, load-bearing papers, doc
- `072ac969` — Map every contact-promotion site; §4 is smaller than it looked
- `ed2cd351` — The reviewer's own contact confirmation never reaches the send gate
- `f7a3d7e9` — Record the S388 handoff to Codex

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

1. **Reviewer address trust P1–P4 — implemented in source, deployment pending.**
   The owner approved the Dataverse current-state bundle, exact-bundle-only
   `staff_verified` readiness, automatic durable contradiction writes, and
   all-outbound-email blocking. The implementation includes a total
   reason-to-remedy matrix across ordinary and applicant-recommended promotion.
   Apply Wave 17 before runtime promotion, then run the controlled signed-in
   pilot. Evidence: `docs/REVIEWER_ADDRESS_TRUST_AND_CONFLICT_RESOLUTION_PLAN.md`.
   The first Opus implementation review's confirmed findings are remediated.
   The second review of `f1b85e78` returned NO-SHIP on the retry path's weaker
   ORCID binding plus five medium contract gaps. The third review of `21b44680`
   confirmed those fixes, found six additional gaps, and returned NO-SHIP. Those
   gaps are remediated in source. The fourth review of `c5e6d008` found the
   identity receipt was JSONB-order-sensitive and contact-mutable, the no-bundle
   receipt lost its address pair, ETag enforcement was optional, and two UI
   failures omitted their repair action. Those gaps are remediated; obtain a
   fifth read-only Opus review before release.
2. ~~**Acceptance-time promotion scope (§4.1/§4.3).**~~ **DONE in source, S389:**
   sending never promotes; every identity-bearing acceptance—including honorarium
   opt-outs—promotes through identity-aware/idempotent matching; declines do not.
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

1. **Current runtime only: `manual` / `staff_verified` are TERMINAL against machine evidence.**
   Evidence: `lib/utils/reviewer-invite.js:151` `emailSourceUpgradeAllowed`;
   `lib/dataverse/adapters/researcher.js:238-243`;
   `tests/unit/my-candidates-verify-address.test.js:297-313`. S387 decision after
   adversarial review. Do not change this before the replacement plan's durable
   conflict enforcement exists. The draft proposes that only a new, valid,
   exact-address trust bundle now makes `staff_verified` ready in the S391
   implementation; legacy source-only rows remain quick-check. Wave 17 and the
   runtime branch are not yet deployed. §5.4's `reviewer_confirmed` proposal would still need
   an explicit carve-out, not a silent exception.

2. **The evidence disclosure's paper list must not be truncated or collapsed**, and its
   Scholar link must stay a name search. Evidence: source comments in
   `ReviewerSearchSection.js` and the S388 block in
   `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md`.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/REVIEWER_ADDRESS_TRUST_AND_CONFLICT_RESOLUTION_PLAN.md` | Owner-approved S391 implementation contract; source/tests built, Wave 17 + runtime deploy/pilot pending |
| `docs/REVIEWER_CONTACT_PROMOTION_AND_ADDRESS_LIFECYCLE.md` | Active §4 promotion contract plus remaining §1/§2/§3-provenance/§5 proposals |
| `shared/components/reviewers/ReviewerSearchSection.js` | The identity-evidence disclosure (the only feature change this session) |
| `tests/unit/reviewer-candidate-identity-evidence.test.js` | 7 tests pinning the disclosure, incl. the no-truncation and no-stored-profile guards |
| `docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md` | Canonical send-gate contract — the `staff_verified` contradiction is fixed here |
| `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md` | Load-bearing-papers note + Scholar 4th-site rule |
| `lib/services/review-manager/send-emails-service.js` | Explicit no-contact-write send boundary |
| `lib/services/reviewer-acceptance-drain.js` | Accept-only promotion trigger, including opt-outs |
| `lib/bill/honorarium-onboard-orchestrator.js` | Identity-aware accepted-contact promotion + address/ORCID capture |
| `lib/dataverse/adapters/contact.js` | Deterministic accepted-reviewer contact creation |
| `lib/services/reviewer-finder/save-candidates-service.js:1084-1121` | Origination-time confident-link / ambiguous-unlinked policy |
| `lib/utils/reviewer-invite.js` | Send-gate buckets + provenance precedence |

## Testing

```bash
rtk npx jest tests/unit tests/integration    # 547 suites / 6614 tests green at 824bfcc6
rtk npm run lint                             # 0 errors (51 pre-existing warnings, none in touched files)
rtk npm run build                            # clean
rtk npx jest tests/unit/reviewer-candidate-identity-evidence.test.js   # the 7 disclosure tests
```

All relevant `check:*` gates were green at `824bfcc6`, including `check:agent-wiki`,
`check:doc-symbol-refs`, `check:fact-consistency`, `check:drain-table-mentions`,
`check:docs-catalog`, and `check:types`.

Production deployment, signed-in Workbench/API HTTP checks, and the authenticated
Request `1002912` Find-tab visual check passed. The normal Find ingestion was run
with explicit owner authorization; no live invitation, identity confirmation,
decline, or acceptance write-path rehearsal was run.
