# Session 388 Prompt: Close the partial governed Initial Assessment pilot

## Session 387 Summary

Session 387 did **not** do the work its own prompt planned. The owner opened with a
production bug — a reviewer who could not be invited — and the session became a
diagnosis-and-remediation run on the reviewer address/identity gates. The Initial
Assessment pilot proceeded in parallel on `codex/initial-assessment-pilot` (Codex). Its
two commits have now been recovered onto current `main` as
`codex/initial-assessment-pilot-recovery`; see Next Items.

Shipped to production as `c688aa0c` (fast-forward, 15 commits, auto-deployed and verified
`● Ready`). Four production data sweeps were executed and verified.

### What Was Completed

1. **Diagnosed the original report: "cannot invite W. Lee Kraus on request 1002852"**
   Two independent causes, both confirmed against live data:
   - **Gate parity.** The Find-tab card grouping (`provenanceGroupOf`) tested three of the
     four clauses the promote route's `requiresIdentityConfirmation` enforces, so a card
     could be selectable while the server refused it with 422
     `identity_confirmation_required`. The predicate now lives once in
     `lib/utils/reviewer-provenance.js` (`requiresStaffIdentityConfirmation`) and both
     sides import it. Applied to `APPLICANT_SUGGESTED` only — widening it would make
     literature/proposal-named rows unsavable via `save-candidates`' `isUnresolvedIdentity`.
     [VERIFIED: 0 of 145 live active applicant rows are reclassified, so no staff-visible
     change today; this closes a latent hole.]
   - **Split roster rows.** `stampSuggestionAnchor` writes `suggestionId` into a blob
     without re-keying the row, so a migration-025 `legacy-row:<id>` placeholder carried a
     suggestion anchor while applicant enrichment wrote the canonical `suggestion:<id>` row
     separately. The client keys cards off the stored `candidateKey`, so one person rendered
     twice — and the selectable copy was the one `findCandidateBySuggestion` cannot resolve.

2. **Staff address attestation for research-only addresses** (`verifyEmailAddress`)
   An address whose only provenance is a web search is `research_only`: render and send both
   refuse it, and no send-time checkbox can promote it. The advertised escape hatch
   ("verify it, then Edit contact") is a **no-op** when the verified address is the one
   already stored, because `CandidateEditModal:161` omits an unchanged email. New
   `PATCH /api/reviewer-finder/my-candidates { requestId, suggestionId, verifyEmailAddress,
   verifiedEmail }` stamps `emailSource='staff_verified'` → `quick_check` (never `ready`).
   Request-scoped, lifecycle-gated (selected / not invited / not responded), address
   re-read and matched server-side, and ETag-conditional.

3. **Address-provenance precedence** (the root cause behind Prashant Mali)
   `wmkf_emailsource` was fill-if-empty, so the FIRST source recorded for a person pinned
   their address tier forever. Mali's person row read `serp_search` (unsendable) while
   request 1002874's roster row read `affiliation` — his address is embedded in his own
   PubMed affiliation string. `researcher.upsertByPotentialReviewer` now lets a strictly
   stronger tier supersede a weaker one for the SAME address, ETag-conditional, with tiers
   derived from `emailSourceTier`/`emailSourceUpgradeAllowed` in the same module that
   defines the send-gate buckets. **A stored human assertion (`manual`/`staff_verified`) is
   TERMINAL against machine evidence** — reversed after review, because the person row is
   shared across requests, so an automatic promotion to `ready` would delete a send-time
   acknowledgement everywhere including where the staffer made it.

4. **Address and provenance are now written together, enforced by a scanner**
   All four `wmkf_emailaddress` writers in `potential-reviewer.js` (`update`, `create`,
   `upsertByEmail`, `clearEmail` — which nulls both) carry `wmkf_emailsource`, and every
   caller passes one. `tests/unit/email-source-pairing-invariant.test.js` parses `lib/`,
   `pages/`, `scripts/`, `shared/` and fails on an address written without a source, with a
   positive control and an argued exemption set. It found **seven** call sites that three
   adversarial reviews had read past, including a live one in
   `contact-enrichment/persistence.js`.

5. **Four production data sweeps, executed and verified**

   | Sweep | Result |
   | --- | --- |
   | `dedupe-reviewer-roster-suggestion-twins.mjs` | 26 placeholder twins deleted, 17 withheld emails carried onto canonical rows as quarantined `contactLeads`; +2 test rows later |
   | `recanonicalize-reviewer-roster-anchors.mjs` | 156 rows re-keyed to `suggestion:<id>` after Dataverse ownership validation; 50 stamped `needsIdentification` (fail-closed) |
   | `stamp-ungated-applicant-roster-rows.mjs` | 35 active applicant rows that were promotable with NO identity gate, stamped |
   | `backfill-email-source-precedence.mjs` | 6 pinned person rows upgraded (5 → `affiliation`, Walsworth → `institution_page`) |

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

15 commits, `3f56bb7d..c688aa0c` on `main`. Highlights:
- `5a6c863c` — applicant card selectability matches the promote identity gate
- `908dfa3e` — staff attestation for a research-only address
- `57023db9` — scope + ETag-guard the attestation (Codex review)
- `f377e2f5` — anchor-based roster resolution + fail-closed recanonicalization
- `4aee09d4` — fail-closed stamp for ungated applicant rows
- `33092e00` — stronger provenance supersedes a weaker stored source
- `fc157a4a` — the four adversarial-review findings on precedence
- `4256e853` — close the two findings the verification pass kept open
- `f21c0761`, `538d4878` — invariant enforced by scanner, raw payloads included
- `ba976d83` — AST-based scanner (Codex fix, plus two gaps in it)
- `c688aa0c` — paginate the person query (the backfill was scanning 25 of 385)

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

2. **Exercise address attestation only when a truthful eligible production row exists.**
   Evidence: the signed-in Workbench inspection covered requests `1002912` and `1002874`.
   Every checked research-address candidate had already been invited, so the server's
   selected/not-invited/not-responded gate correctly made none eligible. No invitation was
   sent and no shared-person provenance was falsely stamped merely to satisfy a smoke.

3. **Run the Q9 ordinary-user app-access smoke in the office.**
   Evidence: `docs/Q9_PREFS_APPACCESS_DAL_MIGRATION_PLAN.md:47,245,428`;
   `.claude-memory/project-app-access-control.md`. Unchanged from S386 — still a required
   Stage 4 release gate needing another person's ordinary staff account in Preview.

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

2. **Re-key the 12 `candidate:`-keyed saved rows that carry a suggestion anchor.**
   Evidence: S387 probe — they are `saved`, so there is no live dead-end; left untouched.
   Re-keying would make `savedKeys` count them. Cosmetic until someone re-opens those
   requests.

3. **The 3 person rows with `wmkf_emailsource='database'`.**
   Evidence: S387 probe of 385 person rows. An unrecognized source: `emailConfidence`
   classifies it `quick_check`, `emailSourceTier` gives it no precedence claim. Decide
   whether `database` is a real source to classify or a value to retire.

### Parked

1. **`stampSuggestionAnchor` still stamps anchors without re-keying.**
   Evidence: `lib/services/reviewer-roster-store.js:368-384`;
   `docs/atlas/postgres-reviewer-find-roster.md`.
   Dormant — the recanonicalization removed the fuel (0 placeholder-keyed rows carry an
   anchor). Re-open if twins reappear, or before any path makes a search-origin row
   promote-routed. The recurrence path is PASSIVE: opening the Find tab on a request with
   pre-spine rows auto-runs enrichment and mints a canonical row beside the placeholder.

### Verify Before Acting

1. **Anything that assumes `main` is at `3f56bb7d`.**
   `main` is now `c688aa0c`. The worktree branch `worktree-claude+main-diagnosis` (in
   `.claude/worktrees/claude+main-diagnosis`) is fully merged into `main` and can be removed
   once its `scripts/.roster-dedupe-backup/` JSON backups are no longer wanted — they hold
   the pre-change state of all four sweeps and contain reviewer names and emails
   (gitignored, local-only).

2. **`check:agent-wiki` in a fresh worktree.**
   It fails on a missing `.agents/skills` symlink, which is untracked and local. That is an
   environment artifact, not a red gate: `ln -sfn ../.claude/skills .agents/skills` makes it
   pass. Do not "fix" the wiki page it names.

### Do Not Reopen Without New Decision

1. **Human assertions (`manual`/`staff_verified`) are terminal against machine evidence.**
   Evidence: `lib/utils/reviewer-invite.js` `emailSourceUpgradeAllowed`;
   `docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md`. Decided after an adversarial review
   argued both sides; an earlier commit claimed the opposite and was corrected in place.

2. **`promote-applicant-reviewer` keeps the canonical-key-only lookup.**
   Evidence: `findCandidateBySuggestionAnchor`'s header. Resolving a pre-identity-spine blob
   there is fail-OPEN: its gate inputs are null and the row would be waved through.

3. **`provenanceGroupOf` applies the full server gate to `APPLICANT_SUGGESTED` only.**
   Evidence: `save-candidates-service.js` `isUnresolvedIdentity` — widening it makes
   literature/proposal-named rows unsavable.

## Key Files Reference

| File | Purpose |
| --- | --- |
| `lib/utils/reviewer-invite.js` | Send-gate buckets AND provenance precedence (`emailSourceTier`/`emailSourceUpgradeAllowed`) — one module so the adapter cannot disagree with the gate |
| `lib/utils/reviewer-provenance.js` | `requiresStaffIdentityConfirmation` — the shared applicant identity gate |
| `lib/utils/reviewer-vetted-email.js` | `pickVettedEmail` (may this persist?) vs `pickAssertedEmailPair` (does this blob vouch for this pairing?) |
| `lib/dataverse/adapters/potential-reviewer.js` | The only writer of `wmkf_emailaddress`; all four writers pair the source. `queryAllReviewers` for population sweeps |
| `lib/services/reviewer-roster-store.js` | `findCandidateBySuggestion` (canonical-only, promote) vs `findCandidateBySuggestionAnchor` (roster actions) |
| `tests/unit/email-source-pairing-invariant.test.js` | The scanner enforcing address+provenance across the repo |
| `docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md` | Canonical send-gate + precedence contract |
| `docs/atlas/postgres-reviewer-find-roster.md` | Roster key hazards, twin recurrence, executed sweep results |
| `scripts/.roster-dedupe-backup/` | Pre-change backups for all four sweeps (gitignored, contains PII) |

## Testing

```bash
rtk npx jest tests/unit tests/integration   # 544 suites / 6553 tests green
rtk npm run lint
rtk npm run check:agent-wiki && rtk npm run check:agent-wiki:self-test
rtk npm run check:atlas && rtk npm run check:atlas:self-test
rtk npm run check:doc-symbol-refs && rtk npm run check:fact-consistency
```

A bare `npx jest` additionally picks up `tests/e2e/*.spec.js`, which are Playwright specs
that cannot load under jest (pre-existing, unrelated). Scope runs to `tests/unit` and
`tests/integration`.

Re-verify the S387 data invariants (read-only; the last needs
`DATAVERSE_ALLOW_PROD_READS=yes`):

```bash
rtk node scripts/stamp-ungated-applicant-roster-rows.mjs        # expect 0 to stamp
rtk node scripts/dedupe-reviewer-roster-suggestion-twins.mjs    # expect 0 pairs
DATAVERSE_ALLOW_PROD_READS=yes rtk node scripts/backfill-email-source-precedence.mjs
# expect: 385 person rows scanned, 0 pinned
```
