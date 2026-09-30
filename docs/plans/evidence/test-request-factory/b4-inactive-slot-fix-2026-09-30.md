# B4 inactive ordinary applicant-slot fix — 2026-09-30

**P2 FIXED on branch; release remains BLOCKED and PR #369 stays draft.** Runtime candidate `40ab24f3e9da5af0259aa481014621cdd7837d37` replaces `92ccbd0bd`. Claude Opus 5.5 independently re-reviewed the exact fix through the owner's authorized OAuth/subscription method: **FIX VERIFIED BY SOURCE; no P0–P2 findings**. No Production migration, Dataverse write, slot PATCH, email or live job drain ran.

## Behavior and invariants

`/contract-reconcile` Mode B surface: Find-tab applicant-slot ingestion → binding capability → Dataverse suggestion materialization → exact-person hydration → existing inactive repair card. Entry is authenticated GET `/api/workbench/applicant-reviewers`; its shell/identity/DAL context are unchanged. Persistence is the existing `wmkf_appreviewersuggestion` junction. Consumers are Find/Candidates, promotion, merge and the release checklist. Prior finding: Opus P2, reproduced against real capability/service before this fix.

| Invariant | Enforcement | Verification |
|---|---|---|
| Server-read inactive ordinary slot reaches its repair card | Ingestion alone supplies `allowInactiveOrdinary: true` to the capability and adapter | Real ingestion/capability/adapter/hydrator suite, marker false and null; both cases red before fix |
| No synthetic or unknown-marker inactive exception | Literal boolean true plus exact false/null marker after exact identity/marker read | True, undefined, string and numeric markers; missing marker/wrong identity refused |
| Non-on reviewer switch stops before person read | Existing isolation check runs first | Off/unset/invalid with an actual populated ordinary inactive slot |
| Other binds/person edits remain strict | Default false; upsert/manual/repoint do not forward the option; merge calls ensureApplicantRecommended without it | Real adapter default-refusal cases; source fan-out and existing merge/identity suites |
| No resurrection or outreach change | New row selected=false; existing no-op/update semantics preserved | Retry over selected+invited fixture creates once, performs zero PATCHes, retains selected state |
| Marker change before adapter read cannot bypass guard | Adapter re-reads marker with the same narrow option | Ordinary first read → inactive synthetic second read fails with zero junction writes |

[VERIFIED via source/tests] The capability validates the switch, GUIDs, exact person identity and marker presence before considering the exception. Values other than literal true cannot opt in. An inactive marker-true person remains refused before test-Request/pairing reads; active synthetic admission still needs both switches and an exact verified pairing. Only the two ingestion calls opt in in runtime source. The adapter option defaults false because `reviewer-merge.js` also uses `ensureApplicantRecommended`.

[VERIFIED via real-chain mocked-transport Jest] Materialization succeeds for the inactive ordinary slot, then the unchanged strict hydration helper reaches its inactive fallback. The DTO is `inactive/person_inactive`; Find maps it to `needs_record_repair`. `projectCanonicalApplicantContact` returns reusable=false, and promotion still refuses with person_inactive before person writes. This restores visibility for repair without authorizing promotion or identity edits.

Partial success remains per-slot through Promise.allSettled and identified recommendedFailed entries. Repair hydration remains a separate knownLookupFailed result; successful junction materialization is not erased. No UI async state, route/auth, enum, column, schema, cleanup strategy, manifest or V57 block changed (N/A for these audits). The adapter read/write race is unchanged; a fresh marker read narrows adoption but is not a transaction with Dataverse. My Candidates identity edits for inactive people remain strict; the fix does not make an inactive merged-away identity editable. The preexisting inactive hydrator fallback is read-only and does not recheck the marker; it yields an unreusable repair card even if a marker changes later.

## Verification and release evidence

[VERIFIED via Jest] 45 focused/changed non-Postgres suites / 1,712 tests passed, including the permanent real-chain regression suite (10 cases). Its false/null ordinary cases failed before the source fix (two failures, seven guards passed at that stage). Broader coverage includes merge, adapter writeback, identity, email, acceptance pause/resumption and slot fences. [VERIFIED via command output] All 18 relevant source gate/self-test, TypeScript and scoped ESLint commands passed. Gate/self-test pairs ran sequentially. [Test/gate receipt](b4-inactive-slot-fix-tests-2026-09-30.json).

[VERIFIED via GET-only committed clean probe] Both isolation flags freshly read on/on for Local, B4 Preview and Production; all nine marker reads returned present/HTTP 200. Effective prvReadWorkflow remains Global. Refreshed section 13 at this candidate has 14 readable activated flows, zero hard incomplete reasons and the same six owner dispositions; complete=false. [Combined supplement](b4-dataverse-fix-supplement-2026-09-30.json); [section 13 receipt](reviewer-slot-readiness-receipt-2026-09-30T18-31-30-343Z.json). The combined 18:31 receipt is current. All env pulls were mode-0600 temporary files deleted in finally; only on/off values are retained. Ledger-dependent checks are blocked: ledger not on this machine until tomorrow's home-Mac restore (see [owner ledger update](b4-ledger-location-update-2026-09-30.md)); cast digest, owner schema receipts, automation dispositions/indirect-chain review, deployment-captured switch readback and deliberate Tier 2 promotion remain blocked or unknown as recorded in the [release report](b4-release-readiness-2026-09-30.md).

[VERIFIED via GitHub at `40ab24f3e`] All 12 checks passed, including Jest, PostgreSQL 16 and Vercel. PR is draft, mergeable and clean. [CI snapshot](b4-ci-at-inactive-slot-fix-2026-09-30.json).

[VERIFIED via command output] All 20 relevant documentation/Atlas/secret/scaffolding/harness/agent-invariant/catalog commands passed with gate/self-test pairs sequential. Dated JSON receipts parse and staged whitespace is clean. Bounded /sweep Mode A searched plan/evidence/memory/handoff: initial Opus review/provenance are explicitly historical; current plan/report/handoff point to the fixed/re-reviewed/re-probed candidate. Zero remaining live claims that this P2 is unfixed. The advisory claim-evidence pilot report was unavailable because local state could not be read; no observation row was fabricated.

## Independent Opus follow-up — verbatim

Reviewed fix parent `0dcda0359` → `40ab24f3e`, exact diff SHA-256 `6a1ab271518774989cc8b05a97a3d4d88182078431a4aceec55dd7d5b14474e1`. Host-side CLI used only Read/Grep/Glob, API-key/alternate-provider variables removed, no fallback and no GitHub comment. 18 read operations, 96 seconds, successful result, zero permission denials. Opus did not run tests; execution evidence above is Codex's. [Provenance](b4-inactive-slot-fix-provenance-2026-09-30.json).

**Verdict: FIX VERIFIED BY SOURCE.** I found no P0, P1 or P2 issues.

I only read code, using Read, Grep and Glob. I didn't run anything. The results you gave me (45 suites / 1712 tests and 18 gate/lint/type commands passing, and the two ordinary-inactive cases failing before the fix) are your execution evidence; I haven't reproduced them. I read the fix diff and the current files it names, and the diff matches those files.

## Call chain

- **Slot ingestion** (`lib/services/workbench/applicant-reviewers-service.js:119-131`): the ingestion check at `:122` and the adapter call at `:130` both pass `allowInactiveOrdinary: true`. Nothing else in `lib/` passes it; a search found only these two call sites plus the capability and adapter plumbing.
- **Adapter** (`lib/dataverse/adapters/reviewer-suggestion.js:61-81`, `:784-790`): `assertPersonBindable` defaults the option to false and forwards it only when there is a `requestId`. The paths without a `requestId` are unchanged. `upsert` (`:527`), `ensureStaffManualCandidate` (`:1121`) and `repointToPotentialReviewer` (`:482`) don't forward caller options, so they stay strict.
- **Merge caller** (`lib/services/reviewer-merge.js:459-462`): it passes `{ actingUserSystemId, requireEtag: true }` only, so `ensureApplicantRecommended` stays strict for merges.
- **Capability check** (`lib/services/test-requests/synthetic-reviewer-capability.js:57-77`), in order:
  1. The reviewer isolation switch is checked first (`:57`), so a switch that isn't on refuses before the person is read.
  2. The GUIDs are validated.
  3. The person is read, with exact identity and a marker that must actually be present (`:61-64`).
  4. The exception at `:65-67` applies only when the option is exactly `true` and the marker is exactly `false` or `null`.
  5. The inactive refusal follows at `:68`.
- **Marker cases:**
  - A marker of `true`, `undefined`, `'false'` or `0` never qualifies, so those inactive people are still refused.
  - A missing marker is refused as unavailable before the state check.
  - A synthetic (`true`) person reaching `:78` must already have passed `:68`, so it must be active. The synthetic path still needs both switches, a verified test Request and an exact slot or suggestion pairing.
- **Hydration** (`lib/services/workbench/applicant-known-reviewer-service.js:15-29`): it calls the capability check strictly, catches `reviewer_person_inactive`, re-reads the person, checks exact identity and non-zero state, then projects the `inactive` / `person_inactive` card (`lib/utils/applicant-known-reviewer.js:141-142`). It doesn't reach the email-owner lookup.

## Partial success, curation and stale reads

- Each slot still gets its own `Promise.allSettled` outcome (`applicant-reviewers-service.js:119-153`), so one failing slot doesn't affect the others. Hydration still runs only after materialization.
- Creating a new row still sets `wmkf_selected=false`. Updating an existing row (`reviewer-suggestion.js:801-852`, `:895-906`) never writes `wmkf_selected` or the outreach timestamps. The no-op path returns the row's current selected state and engagement. The fix touches none of this.
- The person is read twice before writing: once in the service and again in the adapter. A marker that changes between the two reads is refused at the adapter read. The new test at file lines 104-113 covers this; the change makes the refusal come back as `reviewer_person_inactive`, and there is still no write. The remaining gap between the adapter read and the write already existed and isn't widened.

## Tests (source review)

- **Capability test** (`tests/unit/synthetic-reviewer-capability.test.js:97-134`): accepts `false`/`null` markers; refuses `true`, `undefined`, `'false'` and `0`; requires the literal `true` (rejects `false`, `undefined`, `'true'` and `1`); and refuses a missing marker or the wrong identity.
- **New integration test** (`tests/unit/workbench-applicant-reviewers-inactive.test.js`): runs the real ingestion, capability check, adapter and hydration, and mocks only transport. It covers:
  - creating an unselected row, then a repeat ingestion over a selected and invited row with no update, no new create and no email lookup;
  - `ensureApplicantRecommended`, `upsert` and `ensureStaffManualCandidate` staying strict by default;
  - an inactive synthetic slot failing before any write;
  - the marker changing between the two reads;
  - the isolation switch set to off, missing or invalid, refusing before the person is read.

Two gaps below P2. Mixed active and inactive slots in one Request aren't exercised by the new file, and its repeat run takes the no-op path. The rule that updates never write `wmkf_selected` relies on the existing suites. Neither blocks the fix, since the per-slot and update logic is unchanged.

## Notes below P2 (not findings)

1. **My Candidates identity edits.** The earlier review noted that editing identity for an inactive linked person now returns 409 `reviewer_identity_edit_blocked` (`lib/services/reviewer-finder/my-candidates-service.js:666-677`). This fix deliberately leaves that caller strict. It fails safely, and editing a merged-away inactive person is arguably wrong anyway. It still deserves an explicit accept-or-change decision recorded in the ledger so it isn't silently absorbed.
2. **Hydrator fallback doesn't check the marker.** The fallback at `applicant-known-reviewer-service.js:22-28` doesn't re-check the marker. It only matters if the marker flips after ingestion, and even then it can only produce a card that can't be reused (`projectCanonicalApplicantContact` returns `person_inactive`). This existed before the fix and is out of scope.

The external release blockers (ledgers, owner decisions on automation, promotion) are unchanged and not repeated here. PR #369 should stay draft.
