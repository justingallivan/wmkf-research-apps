# Session 388 Prompt: Resume the governed Initial Assessment pilot

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

1. **Promote the recovered governed Initial Assessment pilot only after its live gates are approved.**
   Evidence: `codex/initial-assessment-pilot-recovery` contains the two recovered pilot
   commits plus current documentation and contract reconciliation. A fresh independent
   adversarial review found and drove fixes for finalize ambiguity, canonical-pointer
   multiplicity/lifecycle, cleanup overflow/races, UI refresh sequencing, prompt boundary
   drift, route-body closure, pagination, and run provenance; its final verdict is READY.
   The full unit/integration suite passes (544 suites / 6,553 tests), the production build
   passes, lint has 0 errors (51 existing warnings), and relevant contract, Atlas, route,
   prompt, Dataverse, documentation, memory, and type gates pass. No Initial Assessment
   schema, prompt, application code, or artifact has been promoted or written live. Owner
   decisions below still gate that work.

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

1. **Production dummy request IDs, human testers, and exact schedule.**
   Evidence: `docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md`.
   The intended path is an owner-approved controlled production rehearsal after
   colleagues create representative dummy requests. Building an integrated
   Dataverse sandbox environment is out of scope. These remaining inputs gate
   the 2026-08-10 pilot; intake begins around 2026-08-18.

2. **Accept or revise the provisional Initial Assessment v1 prompt/template pair.**
   Evidence: same plan. The source implementation preserves the decided applicant-title
   (`akoya_title`) and staff-authored Foundation Opportunity requirements, but source
   implementation is not owner approval for production seeding.

3. **Artifact registry and SharePoint target-library controls.**
   Evidence: `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md`.
   The pilot registry schema, provisional prompt/template pair, applicant-title
   (`akoya_title`) source, and staff-authored Foundation Opportunity requirement
   are implemented in source. Verify SharePoint version, restore, recycle,
   retention, permission, and milestone-snapshot behavior against the dedicated
   production dummy requests before the controlled rehearsal. The generic registry has
   source-document/version/hash fields, but this pilot producer currently fingerprints
   the extracted Project Description content rather than binding a governed source
   artifact/version; decide whether that stronger lineage is required before rehearsal.

4. **Re-key the 12 `candidate:`-keyed saved rows that carry a suggestion anchor.**
   Evidence: S387 probe — they are `saved`, so there is no live dead-end; left untouched.
   Re-keying would make `savedKeys` count them. Cosmetic until someone re-opens those
   requests.

5. **The 3 person rows with `wmkf_emailsource='database'`.**
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
