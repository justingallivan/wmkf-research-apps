---
title: Reviewer Existing-Record Context Plan
domain: reviewer-identity
kind: plan
status: active
summary: "Reviewed plan to surface prior-request context on resolver-backed existing AkoyaGO reviewer cards without turning history into identity or email authority."
canonical: false
cataloged: 2026-08-20
last_verified: 2026-08-20
owner: product-engineering
related:
  - docs/REVIEWER_EMAIL_CONFLICT_SELF_SERVICE_PLAN.md
  - docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md
  - docs/atlas/dataverse-akoya-request.md
  - docs/atlas/dataverse-wmkf-potentialreviewers.md
  - docs/atlas/dataverse-wmkf-appreviewersuggestion.md
  - docs/atlas/postgres-reviewer-find-roster.md
  - lib/services/reviewer-contact-reconciliation.js
  - shared/components/reviewers/ReviewerSearchSection.js
---

# Reviewer Existing-Record Context Plan

## Outcome

When a literature-search candidate resolves to an exact existing AkoyaGO
reviewer person, the Find card should say why that person is familiar to the
system:

> **Already in AkoyaGO.** Previously listed as a potential reviewer on request
> **#1002278 — Deciphering the role of the secretome in aging (June 2026).**

That context sits beside—not in place of—the existing staff decision:
**Review and confirm** for a combined identity/email conflict or
**Review email choice** for an email-only conflict. There is no Admin step and
no additional card action.

The prior request is context, not proof. It may help staff recognize the person
or understand an older email, but it must not confirm identity, choose an email,
waive conflict checks, or make the candidate invite-ready.

## Verified Neville path

The first draft incorrectly assumed that Neville's card used the
applicant-recommended `applicantKnownReviewer` carrier. The read-only roster
probe required by the Opus review disproved that assumption.

| Claim | Evidence | Status |
|---|---|---|
| The smoked Neville card belongs to current request `e2639251-9644-f111-88b4-000d3a306d0c` / #1002874. | Production smoke/session receipt plus exact Postgres roster query | VERIFIED 2026-08-20 |
| Its active roster row is `source_kind=literature_retrieved`, `isApplicantRecommended=false`, with no `applicantKnownReviewer`, `potentialReviewerId`, or `seedResolvedPotentialReviewerId` in the browser DTO. | Read-only `reviewer_find_roster` query | VERIFIED 2026-08-20 |
| The roster row carries a trusted server identity receipt, ORCID-keyed `dataverseContactEvidence`, and `addressConflictPending=true`; the found email is `neville@sanjanalab.org`. | Read-only bounded roster projection | VERIFIED 2026-08-20 |
| The reconciliation service resolves the exact person server-side from the server receipt plus trusted ORCID and deliberately does not expose the Dataverse person ID. | `reviewer-contact-reconciliation.js:53-103,185-299` | VERIFIED via source 2026-08-20 |
| The current address-choice service re-resolves that same exact person from the roster candidate when there is no saved suggestion ID. | `reviewer-address-trust-service.js:196-210` | VERIFIED via source 2026-08-20 |
| Neville's Potential Reviewer person is `2fd942fb-f8b7-f011-bbd3-6045bd0510d4`, with stored email `neville.sanjana@nyulangone.org`. | Read-only Production Dataverse probe | VERIFIED 2026-08-20 |
| Neville has zero `wmkf_appreviewersuggestion` rows, so suggestion-only history misses him. | Read-only `findAllByPotentialReviewer` Production probe | VERIFIED 2026-08-20 |
| Neville is linked through legacy Potential Reviewer slot 4 on prior request `e64b7ede-f8b7-f011-bbd2-000d3a30a1aa` / #1002278, “Deciphering the role of the secretome in aging.” | Read-only Production OR-filter across `_wmkf_potentialreviewer1_value` … `_wmkf_potentialreviewer5_value` | VERIFIED 2026-08-20 |
| The prior request does not carry a 2022 business date. Its cycle fields are `akoya_fiscalyear=June 2026` and `wmkf_meetingdate=2026-06-04`; it was created/submitted in November 2025. | Read-only Production request probe | VERIFIED 2026-08-20 |

The UI must display the actual request number/title/cycle. It must not infer
“2022” from request number `1002278`, recollection, or Dataverse `createdon`.

## Contract-reconcile surface

- **Change surface:** add bounded prior-request context to exact-person
  Dataverse reconciliation evidence and render it on the Find card/dialog.
- **Entry points:** `POST /api/reviewer-finder/enrich-contacts`,
  `reconcileReviewerContacts`, `CandidateCard`, and `CandidateEditModal`.
- **Persistence:** read-only Dataverse queries against
  `wmkf_appreviewersuggestion` and `akoya_request`; the existing
  `reviewer_find_roster.candidate` JSON stores the pruned context. No migration,
  new table, new Dataverse field, or Dataverse write.
- **Consumers:** Find-card copy, combined identity/email dialog, roster reload,
  reviewer identity docs/tests, and the existing enrich-contacts route's
  behavior description.
- **Prior finding:** prior request association explains Neville's existing
  AkoyaGO person and should be visible during the staff decision.

## Product invariants

| Invariant | Likely files | Verification |
|---|---|---|
| Neville's resolver-backed search card receives prior request #1002278 even though he has no suggestion rows. | reconciliation service + adapters | legacy-only Neville fixture |
| Request context never changes identity, COI, email readiness, selection, promotion, or send policy. | reconciliation projection + existing policy helpers | decision projections identical with/without context |
| Both canonical suggestion links and legacy five-slot links are considered. | reviewer-suggestion/grant-request adapters + reconciliation helper | suggestion-only and legacy-only fixtures |
| Current request #1002874 is excluded, so current activity can never explain itself as prior use. | history helper | current + older fixture returns only older request |
| Duplicate links from the two representations collapse by request GUID. | history helper | same request in both sources renders once |
| Business timing comes from `wmkf_meetingdate`, then `akoya_fiscalyear`; request-number digits and `createdon` are not treated as the year. | history projection | #1002278 fixture renders June 2026, never 2022 |
| Optional history delay/failure cannot discard enriched results or block the card action. | reconciliation service | timeout and rejected-read tests preserve candidate/action |
| Browser state is bounded and server-owned; the person ID remains private. | evidence prune helper | at most three summaries; raw rows/IDs/ETags stripped |
| Context renders independently of the existing-record warning tone. | CandidateCard | combined conflict plus structural/repair-warning fixture both retain context |
| A same-name candidate without a confident exact server match gets no history. | reconciliation boundary | ambiguous/provisional/name-only fixtures make no history query |

## Staff experience

### Card

Render the context in a neutral block before the identity/email warning, even
when the identity is still unverified:

- One prior request:
  **Already in AkoyaGO. Previously listed as a potential reviewer on #1002278 —
  Deciphering the role of the secretome in aging (June 2026).**
- Several prior requests:
  **Already in AkoyaGO. Linked to 3 prior requests; most recent: #… (June
  2026).**
- Exact person but history is absent or unavailable:
  keep the current card behavior; do not claim there was no prior use.

Do not add another button. The one primary decision remains the existing
**Review and confirm** / **Review email choice** action.

### Email/identity dialog

Above the stored/found choices, repeat the most recent prior association and
state the boundary:

> AkoyaGO previously listed this person on request #1002278 (June 2026). That
> may help you recognize the person, but it does not establish which email is
> current.

If several prior requests exist, show up to three. A small secondary
**Open request** link may open the existing Workbench request route in a new
tab. It must not close or replace the current choice.

## Bounded data contract

Extend the already bounded Dataverse evidence object; do not expose the person
GUID that authorized the server read:

```js
contactEnrichment: {
  dataverseContactEvidence: {
    // existing fields unchanged
    priorRequestContext: {
      complete: true,
      totalCount: 1,
      requests: [{
        requestId: 'e64b7ede-f8b7-f011-bbd2-000d3a30a1aa',
        requestNumber: '1002278',
        title: 'Deciphering the role of the secretome in aging',
        fiscalYear: 'June 2026',
        meetingDate: '2026-06-04',
      }],
    },
  },
}
```

- `requests` is newest-first and capped at three.
- `totalCount` is the deduplicated count only when both association sources
  completed within bounds.
- `complete:false` means a source timed out, failed, or exceeded its source cap;
  available rows may render, but count copy must not imply completeness.
- If both sources fail or the presentation budget expires before either
  returns, omit the context rather than assert `totalCount: 0`.
- Raw source tags, suggestion rows, ETags, reviewer-slot numbers, and unrelated
  request fields do not cross the browser boundary.

## Read algorithm

Keep the helper local to `reviewer-contact-reconciliation.js` unless tests show
that a small separate module is clearer. It accepts only the server-resolved
Potential Reviewer GUID, the current request GUID, and a presentation budget.
It never accepts or resolves a name.

1. After `lookupReviewerIdentity` returns a confident, name-consistent exact
   match with `reviewerId`, retain that ID only inside the server function.
2. Start two bounded source reads in parallel:
   - add a lightweight reviewer-suggestion adapter read selecting only
     `_wmkf_request_value`, ordered newest-first, `top:25`; and
   - query requests whose `_wmkf_potentialreviewer1_value` through
     `_wmkf_potentialreviewer5_value` equals the exact GUID, selecting only
     request ID/number/title/fiscal year/meeting date, newest-first, `top:25`.
   Record `hasMore` as `complete:false`; do not scan thousands of rows for a
   three-item UI projection.
3. Gather server-returned request GUIDs, exclude current request #1002874 by
   GUID, and deduplicate.
4. Canonical-suggestion links need request metadata. Chunk those GUIDs in the
   helper (25 per call) before calling `grantRequestAdapter.findByIds`;
   `findByIds` does not chunk for its caller.
5. Sort by meeting date descending, then fiscal year/request number fallback;
   retain three summaries and the bounded deduplicated count.
6. Give this optional presentation work a short explicit budget (target three
   seconds) using a `Promise.race` whose history promise returns data rather
   than mutating the candidate. Assign the evidence only if history wins. A
   late read therefore cannot mutate a candidate after the response path has
   continued.
7. The Dataverse transport currently installs its own 30-second AbortSignal and
   does not compose caller signals (`lib/services/dynamics/http.js:47-50`). Do
   not falsely claim cancellation. The short race bounds user-visible latency;
   adding transport-wide signal composition is a separate cross-cutting change,
   not part of this slice.
8. Catch source errors independently. Reconciliation remains optional display
   evidence and keeps the enrich-contacts route's existing fail-open behavior.

The helper runs only for a confident exact server match. It does not run for
provisional ORCID, ambiguous candidates, name-only candidates, or candidates
whose server identity receipt is absent. The existing `deadlineController`
still prevents starting reconciliation after the main enrichment budget has
expired; the new short race prevents request-history context from consuming
the remainder of that budget.

## Whole-flow trace

1. **Caller:** staff opens Reviewers → Find and runs/loads reviewer enrichment.
2. **Client state:** the literature candidate exists under the current request
   generation.
3. **Request payload:** current request GUID plus the existing candidate batch;
   no history or person ID is supplied by the browser.
4. **Route:** existing app access, rate limit, request GUID validation, SSE,
   deadline, and DAL context remain unchanged.
5. **Service:** server receipt plus trusted ORCID resolves the exact person;
   optional prior-request context is then read using that server-only GUID.
6. **Persistence/read:** Dataverse suggestion + legacy request associations;
   bounded evidence later persists in existing Postgres roster JSON.
7. **Response:** existing enriched candidate plus the nested optional context.
8. **Consumer:** `pruneDataverseContactEvidence` preserves only the bounded
   summaries; card and dialog render them without changing decision helpers.
9. **Docs/tests/gates:** focused reconciliation/prune/component tests, route
   behavior docs, reviewer identity wiki, and Atlas read-path updates.

## Audit disposition

- **Whole-flow:** in scope and traced above.
- **Partial success:** in scope. Each history source can fail independently;
  all history can fail without changing the candidate result.
- **Async/stale state:** the history promise returns immutable data and cannot
  mutate after the presentation race loses. Existing client generation guards
  still govern the SSE result.
- **Helper semantics:** “prior association” means only a legacy potential-
  reviewer slot or canonical suggestion link. It does not collapse “listed,”
  “invited,” and “completed a review.”
- **Durable surface:** no schema or route. Existing roster JSON gains one
  bounded optional evidence field; Atlas/API behavior docs change when code
  lands.
- **Symbol fan-out:** `dataverseContactEvidence` has a whitelist prune seam and
  live/roster consumers; both live and reload rendering require tests.
- **Destructive work:** N/A.

## Implementation sequence

1. Add the two bounded association reads and local union/dedupe projection,
   with the exact Neville failure mode: legacy slot present, zero suggestions.
2. Attach context only after confident server-side person resolution inside
   `reconcileReviewerContacts`; keep the person GUID out of the result.
3. Extend `pruneDataverseContactEvidence` with a strict three-row projection so
   the context survives `pruneCandidateForRoster` and roster reload.
4. Render the neutral context block on `CandidateCard` independently of the
   `knownReviewer.status` and `identityUnverified` branches. Render the same
   bounded context in `CandidateEditModal`.
5. Update the enrich-contacts API-matrix description, reviewer identity/
   workbench wiki, and the three affected Atlas read-path descriptions after
   implementation. Record the live context in the email-conflict plan without
   changing its decision contract.
6. Deploy as Tier-1 runtime work, then signed-in smoke Neville's card and open
   the dialog through neutral Cancel. No email choice or Dataverse write is
   required for this read-only-context smoke.

## Verification

Focused tests:

- Neville-shaped `literature_retrieved` candidate, confident ORCID match,
  legacy slot #1002278, and zero suggestion rows;
- canonical suggestion-only history;
- same request in both sources dedupes;
- current request #1002874 is excluded;
- multiple rows sort/cap; `hasMore` makes `complete:false`;
- #1002278 renders June 2026, never 2022;
- one/both source failures and three-second presentation timeout preserve the
  candidate and existing action;
- a late history promise cannot mutate already-returned evidence;
- provisional/ambiguous/name-only/no-receipt cases make no history read;
- prune strips raw fields/person ID and caps three requests;
- roster reload preserves the bounded context;
- card renders context during the combined warning and during an additional
  structural/repair warning, with one primary action and no Admin control;
- combined modal shows context, both email choices, and the “not proof of
  current email” boundary;
- existing request-generation race tests remain green.

Scoped gates, each gate followed sequentially by its self-test where one exists:

1. focused contact-reconciliation, search-logic/prune, roster, card, modal, and
   enrich-contacts route suites;
2. `npm run check:api-routes` then `npm run check:api-routes:self-test` when the
   route matrix description changes;
3. `npm run check:dataverse-access-layer` then its self-test;
4. `npm run check:route-service-boundary` then its self-test;
5. `npm run check:doc-currency` then its self-test;
6. `npm run check:fact-consistency` then its self-test;
7. `npm run check:docs-catalog`;
8. `npm run check:types`;
9. production build and signed-in read-only smoke.

## Non-goals

- No Admin workflow.
- No automatic email selection or same-domain heuristic.
- No inference that a request association proves identity.
- No claim that the person completed a review unless
  `wmkf_reviewreceivedat` independently proves that separate fact.
- No name-based history lookup and no browser-visible person GUID.
- No new API route, table, Dataverse field, alert, audit record, or migration.
- No transport-wide AbortSignal refactor.
- No cleanup of legacy reviewer slots or suggestion rows.
- No applicant-recommended carrier in this slice; Neville's reported card is a
  resolver-backed literature candidate, and expanding to a different producer
  is not required to fix it.

## Acceptance criteria

1. Neville's current #1002874 card shows prior request #1002278 even though he
   has no suggestion rows and no person GUID in the browser DTO.
2. The context helps staff decide without claiming that prior history proves
   the current person or email.
3. Current request #1002874 cannot be presented as its own provenance.
4. Optional history delay/failure cannot block or delay the existing action
   beyond the short presentation budget.
5. The card still presents one primary user action and no Admin dependency.

## Opus adversarial review and disposition

Claude Opus performed one read-only review and changed no repository files. Its
draft verdict was **NEEDS REWORK** for one blocker and four named issues. No
second review round was requested or run.

| Material finding | Disposition |
|---|---|
| The draft's Neville example contradicted its applicant-only carrier. | ACCEPTED. A read-only roster probe established current request #1002874 and `literature_retrieved` provenance. The plan now uses the exact resolver/reconciliation carrier. |
| Optional history could add unbounded latency to applicant ingestion. | ACCEPTED AT THE CORRECTED SEAM. Applicant ingestion is no longer touched. Reconciliation uses capped reads plus a short presentation race. |
| The draft falsely called `findByIds` chunked. | ACCEPTED. The helper now owns explicit 25-ID chunking. |
| The draft needed context on every applicant-known loader return. | SUPERSEDED. The corrected plan does not modify that loader. |
| The generic context appeared only in the `knownReviewer.status==='known'` card branch. | ACCEPTED. Context now renders independently of applicant status and warning tone. |

The disconfirming probe also established that a caller AbortSignal is currently
overwritten by the Dataverse transport. The final plan therefore bounds visible
latency honestly with a no-mutation presentation race rather than claiming a
cancel capability the transport does not provide.

**Final plan verdict: READY TO IMPLEMENT.** The draft blocker is resolved with
live roster evidence, and the remaining material findings are incorporated
without expanding the product scope or starting a nit-driven review loop.
