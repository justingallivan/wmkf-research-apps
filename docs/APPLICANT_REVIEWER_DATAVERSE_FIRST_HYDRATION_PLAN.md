---
title: Applicant-Recommended Reviewer Dataverse-First Hydration Plan
domain: reviewer-identity
kind: plan
status: draft
summary: "Exact-person Dataverse hydration plan for applicant-recommended reviewers, preserving identity, contact, COI, and partial-success safeguards."
canonical: false
cataloged: 2026-07-29
owner: product-engineering
related:
  - docs/REVIEWER_CANDIDATE_PROMOTION_REMEDIATION_PLAN.md
  - docs/REVIEWER_IDENTITY_CONTACT_PLAN.md
  - docs/atlas/dataverse-wmkf-potentialreviewers.md
  - docs/atlas/dataverse-wmkf-appreviewersuggestion.md
  - lib/services/workbench/applicant-reviewers-service.js
  - lib/services/workbench/enrich-recommended-service.js
  - lib/services/workbench/promote-applicant-reviewer-service.js
---

# Applicant-Recommended Reviewer Dataverse-First Hydration Plan

## Status and decision

**REVISED AFTER CLAUDE OPUS ADVERSARIAL REVIEW.**

The first draft received a `NEEDS REWORK` verdict. The revision removes the
shared-contact-projection/attestation blast radius, adds the missing
request-switch guard, uses a distinct applicant-link field and badge, preserves
current `research_only` promotion behavior, specifies roster pairing and SSE
failure shapes, and corrects the inactive-owner and null-email fall-throughs.
The review receipt and disposition are at the end of this document.

Applicant-recommended reviewers already arrive through
`akoya_request.wmkf_potentialreviewer1..5` lookups. Those values are exact
Dataverse `wmkf_potentialreviewers` GUIDs, not unanchored names. The Workbench
currently materializes the exact person/request suggestion but then projects
only the person name into the ingestion response. The later enrichment path
re-reads the exact person but carries forward only affiliation and the contact
lookup, discarding an existing email, email provenance, ORCID, and other known
person data before external enrichment begins.

This plan adds a server-owned, read-first hydration contract for this one
anchored path. It does **not** add fuzzy name reuse, automatically merge people,
or let stored person data bypass current identity or request-specific COI gates.

## Contract surface

- **Change surface:** hydrate exact Dataverse person data for
  applicant-recommended reviewer cards before external contact enrichment.
- **Entry points:** `ReviewerFindPanel` →
  `GET /api/workbench/applicant-reviewers` and
  `POST /api/workbench/enrich-recommended`; later promotion remains
  `POST /api/workbench/promote-applicant-reviewer`.
- **Persistence:** reads canonical `wmkf_potentialreviewers` and
  `wmkf_appreviewersuggestion`; existing enrichment writeback may fill or
  strengthen fields on the same person under its current precedence rules. No
  new table, entity, column, migration, alternate key, or API route.
- **Consumers:** Workbench Find cards, applicant enrichment roster rows,
  applicant promotion, Invite Reviewers, and the existing invitation send gate.
- **Prior findings:** the 2026-07-29 promotion remediation is authoritative for
  contact projection, staff confirmation, deterministic person reuse, and
  transport-unknown reconciliation. This plan must compose with it, not create
  a second promotion model.

## Verified current state

### Request 1002959

`scripts/probe-applicant-reviewer-known-state.mjs 1002959` was run read-only
against production on 2026-07-29.

| Slot | Exact linked person | Stored email | Stored source | Other exact-person evidence |
|---|---|---|---|---|
| 1 | Joshua Kritzer | `joshua.kritzer@tufts.edu` | absent | Tufts affiliation |
| 2 | Brian Kuhlman | `bkuhlman@email.unc.edu` | absent | UNC affiliation |
| 3 | Ian Maze | `ian.maze@mssm.edu` | absent | ORCID `0000-0003-1490-7781` |
| 4 | Lacramioara Bintu | `lbintu@stanford.edu` | absent | ORCID `0000-0001-5443-6633` |
| 5 | Charles Gersbach | `charles.gersbach@duke.edu` | `scholarly_multi` | ORCID, linked CRM contact, prior invitation |

The probe found one exact first/last-name person row for each slot. That is a
bounded check, not proof that no spelling-variant or cross-anchor duplicate
exists.

### Current caller → persistence → consumer flow

1. `ingestApplicantReviewers` reads the five request lookups and materializes
   an unselected applicant-recommended suggestion using the exact person GUID.
   Its response carries only slot, person ID, formatted name, suggestion ID,
   creation state, and exclusion state.
   `[VERIFIED via lib/services/workbench/applicant-reviewers-service.js:89-121]`
2. `ReviewerFindPanel` passes that sparse `recommended[]` response to
   `ReviewerSearchSection`.
   `[VERIFIED via shared/components/reviewers/ReviewerFindPanel.js:367-369,653-670]`
3. `enrichRecommended` re-reads the exact Potential Reviewer by ID, but uses
   only affiliation and `_wmkf_contact_value`. Existing email, email source,
   and ORCID returned by the same adapter read are ignored.
   `[VERIFIED via lib/services/workbench/enrich-recommended-service.js:281-309
   and lib/dataverse/core/entity-registry.js:82-100]`
4. `ContactEnrichmentService` starts a new contact result with no email and
   `emailPersistAllowed=false`. Its source comment records that the old
   database-first tier was removed because generic discovery did not yet have
   an email. Applicant recommendations are different: they already have an
   exact person GUID and a server-readable person row.
   `[VERIFIED via lib/services/contact-enrichment-service.js:175-226]`
5. Applicant promotion re-reads the exact suggestion/person and requires a
   current person email before selecting the suggestion.
   `[VERIFIED via
   lib/services/workbench/promote-applicant-reviewer-service.js:293-321]`
6. Invitation sending reclassifies the persisted person address with
   `emailConfidence`: `ready`, `quick_check`, `research_only`, or `missing`.
   An absent/unrecognized source is `quick_check`, not `ready`; search-only
   sources remain unsendable.
   `[VERIFIED via lib/utils/reviewer-invite.js:73-201]`
7. The shared `projectReviewerContact` output is hashed into version-3
   automated identity attestations with a 14-day TTL. Changing its default
   output shape would invalidate in-flight receipts.
   `[VERIFIED via lib/services/reviewer-candidate-attestation.js:17-20,100-122,167-217]`
8. `dataverseContactEvidence` and the “Known in Dataverse by exact key” badge
   already mean an exact email/ORCID lookup performed during general search.
   Applicant slot hydration must use a different field and label.
   `[VERIFIED via lib/services/reviewer-contact-reconciliation.js:101-171 and
   shared/components/reviewers/ReviewerSearchSection.js:298-307]`
9. The applicant-ingestion GET currently lacks a post-await request guard. A
   response for request A can set state after the component has switched to
   request B.
   `[VERIFIED via shared/components/reviewers/ReviewerFindPanel.js:107-120]`

## Goals

1. Show staff immediately when an applicant recommendation is an exact known
   Dataverse person and what canonical contact/identity hints already exist.
2. Seed applicant enrichment with the exact person's existing affiliation and
   ORCID so the identity resolver does not discard strong server-owned anchors.
3. Reuse an already-persisted canonical email without pretending it was newly
   discovered or newly verified.
4. Preserve request-specific identity verification and COI computation.
5. Fail closed on inactive records, email-owner conflicts, contradictory
   addresses, and unavailable person reads.
6. Preserve per-reviewer partial success and stale-request UI protections.

## Non-goals

- Global name-based person deduplication or W4.2 anchor-union dedup.
- Automatic merge, slot relink, contact merge, or person deactivation.
- Treating an exact name match as identity authority.
- Promoting stored identity status as current request-specific verification.
- Skipping proposal-specific institution/coauthor COI checks.
- Adding a Dataverse or Postgres schema surface.
- Adding prior-engagement badges or a full reviewer-history query in the first
  implementation. Those can be a later read-only enhancement.
- Changing invitation templates, sending an invitation, or changing the
  `ready`/`quick_check`/`research_only` send policy.
- Changing the shared `projectReviewerContact` default projection,
  `pickVettedEmail`, or the v3 attestation digest in this slice.
- Reusing `dataverseContactEvidence` or its “Known in Dataverse by exact key”
  badge; that contract remains general-search evidence, not applicant-slot
  linkage.

## Invariant table

| Invariant | Likely files | Verification |
|---|---|---|
| The applicant slot's exact person GUID is the only reuse anchor. Name equality never selects or merges a person. | applicant known-person helper; applicant service; enrichment service | same-name/different-ID fixture never rebinds |
| Hydrated contact fields are server-read. Client input cannot assert `knownInDataverse`, person ID, stored email, or source. | routes + services | route/service test with spoofed client fields proves they are ignored |
| A stored email remains associated with its stored source. Missing source stays `quick_check`; it is never upgraded to `ready` merely because the row exists. | known-person projection; reviewer-invite helper reuse | source-null and unknown-source fixtures |
| Missing stored addresses do not become promotion-ready. `research_only` preserves current behavior: it may enter Invite after identity checks but remains unsendable until the existing verification path changes its source. | applicant canonical-contact projection; promotion; send gate | missing/research-only promotion + send tests |
| Existing canonical contact can be reused without a redundant email write; the send gate still reclassifies it before dispatch. | enrichment; promotion; send tests | no email PATCH assertion + quick-check/research-only send fixtures |
| Stored ORCID/affiliation are identity hints, not a bypass. Unresolved/contradicted identity still requires staff confirmation. | enrichment; provenance helper; promotion | ORCID seed reaches resolver; unresolved result still 422s |
| COI is recomputed for the current request even when contact is already complete. | enrich-recommended service | known-contact fixture still invokes institution/coauthor COI |
| An enriched email differing from the stored person email never overwrites or silently replaces it. | reconciliation helper; researcher adapter call | conflicting-address fixture yields review state and no email/source relabel |
| Email provenance upgrades only for the same normalized address and only through existing precedence/ETag logic. | researcher adapter (existing) + enrichment call | same-address stronger-source and different-address tests |
| A person read or conflict failure affects only that reviewer; other applicant recommendations remain visible/retryable. | applicant service response; enrichment SSE | mixed success fixture returns exact failed suggestion/person IDs |
| A request/proposal change cannot apply late hydration/enrichment to the new context. | ReviewerFindPanel; ReviewerSearchSection | existing generation/request guards plus stale-result test |
| The shared contact projection and in-flight v3 attestation digest remain byte-compatible. | reviewer-vetted-email; reviewer-candidate-attestation | default projection/digest compatibility test |
| Applicant slot evidence and search-time `dataverseContactEvidence` remain distinct contracts. | known-person helper; roster prune; CandidateCard | field/badge vocabulary tests |
| No new durable schema or route is introduced. | source + docs | git diff; route/Atlas gates as applicable |

## Planned design

### 1. Add a narrow server-owned known-person projection

Add a small Workbench helper, tentatively
`lib/services/workbench/applicant-known-reviewer.js`, with three narrow
responsibilities:

1. `loadApplicantKnownReviewer(personId)` reads
   `potentialReviewerAdapter.getById(personId)` using the existing primary
   person projection.
2. `projectApplicantKnownReviewer(person)` returns a deliberately bounded DTO.
3. `projectCanonicalApplicantContact({ applicantKnownReviewer, candidate })` decides
   whether the exact already-persisted contact permits applicant promotion.
   It reuses `emailConfidence` for address action but is deliberately separate
   from `projectReviewerContact`, whose default output is attestation-bound and
   governs new automated/staff contact persistence.

```js
{
  status: 'known' | 'inactive' | 'unavailable' | 'email_conflict',
  potentialReviewerId,
  name,
  affiliation,
  email,
  emailSource,
  emailReadiness: { action, level, reason },
  orcid,
  contactLinked,
}
```

The helper may read and classify. It must **not** write, merge, relink a request
slot, infer identity from name, compute COI, convert a stored source, or change
the shared `projectReviewerContact` default.

`emailReadiness` must introduce no source allowlist. It calls the existing
classifier with an explicit object literal so a Dataverse response that omits a
null attribute cannot fall through as `quick_check`:

```js
emailConfidence({
  email: person?.wmkf_emailaddress ?? null,
  emailSource: person?.wmkf_emailsource ?? null,
})
```

Before returning `known`, an email-bearing row checks
`potentialReviewerAdapter.findByEmailCandidates(email)`:

- `result.one`, `result.row.statecode === 0` (or the adapter's documented active
  representation), and the ID equals the exact slot person → continue;
- multiple active owners, an inactive-only owner, or a different active owner
  → `email_conflict`, with no automatic repair;
- no email → `missing` through the existing classifier.

Do not treat `result.one` alone as active: the adapter can return one inactive
row when there is no active owner. The check must inspect `statecode`.

This email-owner consistency check does **not** prove that no duplicate person
exists under another/absent email or a spelling variant. Name and ORCID are not
automatic cross-person merge keys in this slice.

### 2. Enrich the applicant-ingestion response additively

After `ensureApplicantRecommended` succeeds, the ingestion service loads the
exact person and adds `applicantKnownReviewer` to that recommendation.

The hydration call must be outside the existing materialization `try/catch`.
Otherwise a successful suggestion write followed by a person-read failure
would be falsely reported in `recommendedFailed` and would corrupt
`recommendedComplete`.

The existing materialization result remains authoritative:

```js
{
  slot,
  potentialReviewerId,
  name,
  suggestionId,
  created,
  skippedExcluded,
  applicantKnownReviewer
}
```

Hydration failure must not erase a successfully materialized recommendation or
turn it into a false “applicant listed none” state. Add separate response
fields:

```js
knownLookupComplete: boolean,
knownLookupFailed: [{ slot, potentialReviewerId, suggestionId, code }]
```

Do not overload `recommendedComplete`, which currently means suggestion
materialization completed. The unit of known-person hydration success is one
suggestion/person ID, not a count.

Before returning any richer applicant contact payload, fix
`ReviewerFindPanel.runIngestion`: capture the submitted request ID and, after
every await on both success and error paths, skip state writes when
`requestIdRef.current !== submittedRequestId`. This is a Phase 2 prerequisite,
not an optional cleanup.

### 3. Re-read and seed enrichment server-side

`enrichRecommended` must not trust the GET response or any client copy of
`applicantKnownReviewer`. It re-runs the exact person read from each
`wmkf_appreviewersuggestion._wmkf_potentialreviewer_value`.

Build the verification candidate from the canonical person:

- name: canonical person name, with formatted suggestion name only as fallback;
- affiliation: primary affiliation, then organization;
- ORCID: stored canonical ORCID;
- person/suggestion IDs: exact server-read anchors;
- stored contact: kept in the bounded `applicantKnownReviewer` object until
  reconciliation.

Passing the stored ORCID into the existing candidate shape lets
`ContactEnrichmentService._identityAnchorForCandidate` use it. This is evidence
reuse, not an identity verdict.

Do not reuse `contactEnrichment.dataverseContactEvidence`: that existing field
means an exact email/ORCID lookup performed during general search. Do not place
the stored address at candidate top level while leaving its source only in the
applicant object; the roster pruner must preserve address and source as a
bounded pair.

The existing staff-confirmed roster preservation branch remains first and
unchanged. A current actor-bound confirmation is stronger than automated
rehydration and must not be replaced on retry.

### 4. Reconcile stored and newly enriched contact explicitly

After external verification/enrichment, reconcile
`applicantKnownReviewer.email` and the new
`candidate.contactEnrichment.email` by exact normalized address:

| Stored person | Enrichment result | Output/action |
|---|---|---|
| no email | vetted email | existing enrichment/persistence contract |
| email A | no email | retain A/source as paired canonical stored contact; do not invent provenance |
| email A | email A | retain the paired canonical contact; allow only the existing same-address provenance-strengthening path |
| email A | email B | surface `contact_claim_mismatch`; persist neither address replacement nor source relabel |
| `research_only` A | any | retain its send-blocking action; preserve current promotion semantics |
| inactive/conflicted person | any | keep row non-selectable with exact repair reason |

The reconciliation helper must not copy a source from email B onto email A.
`researcherAdapter.upsertByPotentialReviewer` already requires same stored email
before a stronger source upgrade and uses the person ETag; preserve that
contract.

`pruneCandidateForRoster` must preserve `applicantKnownReviewer` through a
strict bounded projector. Add a round-trip test proving that its email/source
pair and canonical-contact promotion decision are identical before and after a
roster write/read. Do not change the generic top-level
`email: c.email || e.email` / `emailSource: e.emailSource` contract in this
slice.

### 5. Separate persisted-contact reuse from new-write authority

`emailPersistAllowed` answers whether an automated candidate may write a newly
found email. It should not be overloaded to mean that an address already
exists on the exact canonical person.

Use the applicant helper's separate
`projectCanonicalApplicantContact({ applicantKnownReviewer, candidate })`
projection.
This is not a new source classifier: it calls `emailConfidence` and adds only
the exact-person/ownership/mismatch preconditions for **reuse without a
write**.

The shared `projectReviewerContact(candidate, options)` default, its return
shape, `pickVettedEmail`, and `contactAttestationProjection` remain unchanged.
That avoids invalidating in-flight v3 receipts and prevents applicant reuse
semantics from leaking into the email reconciler, precedence backfills, or
ordinary save-candidates.

Rules for the applicant canonical-contact projection:

- the server derives it only after a fresh exact person read and unique-owner
  check;
- the roster stores evidence, not authority; the promotion service re-derives
  the decision from current Dataverse state;
- any stored email is promotion-reusable under current behavior after identity
  checks, but its `emailConfidence.action` remains visible and authoritative
  for sending;
- `quick_check` still requires the existing send acknowledgement;
- `research_only` preserves current promotion behavior but remains unsendable
  until the existing staff-verification path changes its persisted source;
- missing, inactive, ownership-conflicted, or stored/enriched-mismatch contact
  is not promotion-ready;
- it does not bless metrics, ORCID, affiliation, identity, or COI;
- client-supplied `applicantKnownReviewer` is never trusted by the promotion
  service.

Add a compatibility test proving that default
`contactAttestationProjection(candidate)` and its digest inputs are unchanged
for existing non-applicant candidates. No projection-version bump is planned
because the default projection is not changing.

### 6. Align promotion with the hydrated contract

`promoteApplicantReviewer` already re-reads the exact suggestion, roster row,
and person. Extend its final contact check:

1. prove the suggestion still points to the expected active person;
2. project current canonical applicant contact from the fresh person read;
3. classify the persisted email with `emailConfidence`;
4. preserve current promotion semantics for an existing address after the
   identity gate, while returning its send action (`ready`, `quick_check`, or
   `research_only`) explicitly;
5. reject `missing`, inactive, ownership-conflicted, or address-mismatched
   contact with a stable code;
6. perform no email write when canonical contact is reused;
7. select the suggestion only after those checks.

The invitation send path remains the final address-action authority and still
requires its current acknowledgement for `quick_check` and refuses
`research_only`. Tightening `research_only` at promotion would be a separate
behavior change requiring a reachable Find-tab staff-verification action; it
is not smuggled into this hydration slice.

### 7. Render known state without creating a second identity decision

`ReviewerFindPanel` and `ReviewerSearchSection` should show:

- `Existing linked reviewer record`;
- canonical affiliation and ORCID when present;
- stored email plus its current `ready`/`quick_check`/`research_only` reason;
- a repair/verification message for unavailable, inactive, or conflicting
  contact.

The badge means “exact linked person row exists,” not “identity verified” or
“safe to invite.” Existing identity-review, COI, and email-action UI remains
authoritative.

This label and `applicantKnownReviewer` are distinct from the existing
`dataverseContactEvidence` / “Known in Dataverse by exact email/ORCID” search
contract. Neither field is reused or overloaded.

The client may render server-projected known state but may not post it back as
authority. Promotion is still request/suggestion-ID based and server-rechecked.

### 8. Preserve partial success and stale-state behavior

The GET path reports known-person hydration failures per suggestion while
retaining every successfully materialized recommendation.

The SSE path should emit additive structured progress/failure data and continue
other reviewers where safe:

```js
{
  stage: 'applicant_hydration',
  status: 'failed',
  suggestionId,
  potentialReviewerId,
  code: 'person_unavailable' | 'person_inactive' | 'email_conflict',
  message,
}
```

The client continues to render `message` and may later use the identifiers for
row-local retry/copy. Unknown `stage`/`status` values are display-only and grant
no authority.

`enrich-recommended-service.js`'s current
`if (suggestions.length === 0) complete { recommended: [] }` branch must not
produce a false clean empty result when applicant rows existed but every person
read failed. Emit one unresolved/non-selectable result per failed
suggestion/person anchor, persist it if safe, and complete with those rows plus
their failure codes. A genuine zero-junction input may still complete empty.

The Search/SSE generation token and post-await checks remain load-bearing. The
GET ingestion path does **not** currently have an equivalent guard; Phase 2
adds it before richer data ships. Add tests where request A's successful and
failed ingestion responses arrive after switching to request B and prove no A
state renders under B.

## Complement and fall-through behavior

| Input outside the happy path | Required behavior |
|---|---|
| Slot has no person ID | existing skip behavior |
| Exact person 404/read failure | recommendation remains; known lookup marked unavailable; no fallback name reuse |
| Exact person inactive | non-selectable repair state; no automatic reactivation |
| Person has no email, including an omitted null attribute | explicit normalized `email:null` → missing-email enrichment path |
| Person email source absent/unknown | `quick_check`; never auto-upgraded merely because it was stored |
| Person email source `research_only` | preserves current promotion behavior; Invite send remains blocked until corrected/verified |
| Exact email owner differs or is ambiguous | merge/repair state; no relink or create |
| Stored and enriched emails differ | contact-claim mismatch; no overwrite |
| Stored ORCID conflicts with new evidence | identity review; no ORCID replacement through this slice |
| Identity unresolved despite known contact | explicit staff confirmation required |
| Current-request COI found | existing applicant COI flag behavior; known contact does not bypass |
| Known-person read succeeds but roster write fails | exact per-row partial result/alert; no false clean completion |
| Unknown applicant-known status/action value | fail closed for promotion; display-only in Find |
| Client supplies/changes `applicantKnownReviewer` | UI may be cosmetic; promotion ignores it and re-reads server state |

## Implementation sequence

### Phase 1 — Pure projection and exact read

- Add the known-person helper and tests.
- Reuse `emailConfidence`.
- Add unique active email-owner consistency check.
- Keep the shared contact projection and v3 receipt digest unchanged.
- No UI or persistence behavior change yet.

### Phase 2 — Ingestion response and immediate UI

- Add the missing request-switch guard first.
- Add `applicantKnownReviewer`, `knownLookupComplete`, and exact failure rows,
  with hydration outside the materialization `try/catch`.
- Render `Existing linked reviewer record` and contact readiness.
- Preserve sparse-response compatibility and existing materialization counts.

### Phase 3 — Enrichment seeding and reconciliation

- Re-read exact people in `enrichRecommended`.
- Pass stored ORCID/affiliation into verification.
- Attach separate applicant-linked person evidence.
- Preserve `applicantKnownReviewer` as a bounded email/source pair in the roster;
  do not reuse `dataverseContactEvidence`.
- Reconcile same/different stored and enriched addresses.
- Replace the false-clean-empty all-read-failed branch with explicit unresolved
  rows and structured failure identifiers.
- Increment `APPLICANT_ENRICHMENT_CACHE_VERSION` so old roster JSON cannot mask
  the new semantics.

### Phase 4 — Promotion alignment

- Derive the applicant canonical-contact projection from fresh server reads.
- Use the same applicant-specific projection in UI and server while leaving the
  attestation-bound shared projection unchanged.
- Preserve current promotion behavior for existing `research_only` contact;
  block missing/inactive/conflict/mismatch.
- Prove no redundant email write for canonical reuse.

### Phase 5 — Verification and production smoke

- Run scoped tests and relevant gates sequentially.
- Deploy through the current reviewer campaign release strategy.
- Signed-in smoke on request 1002959:
  - all five show `Existing linked reviewer record`;
  - Ian Maze, Lacramioara Bintu, and Charles Gersbach seed ORCID;
  - Charles shows the `scholarly_multi` ready address;
  - the four source-null addresses show `quick_check`, not `ready`;
  - no duplicate person/suggestion is created;
  - no invitation is sent.
- Re-run the read-only probe and verify exact person/suggestion IDs are
  unchanged.

## Test matrix

### Service/helper tests

- active exact person, source-null email → known + `quick_check`;
- active exact person, `scholarly_multi` email → known + `ready`;
- active exact person, `serp_search` email → known + `research_only`;
- missing email → known + `missing`;
- inactive person → inactive;
- unique owner is same person → known;
- active owner is another person → email conflict;
- multiple active owners → email conflict;
- person read failure → exact unavailable result;
- no branch falls back to normalized name.

### Enrichment tests

- stored ORCID is present on the candidate received by identity/contact
  enrichment;
- stored affiliation is retained as claimed evidence;
- known contact still executes current-request COI;
- stored A + enriched A upgrades only under existing provenance precedence;
- stored A + enriched B writes neither an address replacement nor a source
  relabel;
- unresolved identity with known email stays confirmation-required;
- one failed person does not suppress successful siblings;
- all failed person reads do not return a false empty-success result;
- current staff-confirmed roster row remains unchanged on rerun.

### Promotion/send tests

- canonical `ready` email reuses with no email PATCH;
- canonical source-null/unknown email is `quick_check`, promotes only after the
  identity gate, and still requires the send acknowledgement;
- canonical `research_only` email preserves current promotion behavior and is
  still rejected by the send gate;
- missing/inactive/conflicted person is rejected with stable code;
- client-spoofed `applicantKnownReviewer` is ignored by the server;
- person/suggestion mismatch is rejected;
- transport-unknown behavior refetches rather than blindly retrying;
- the existing non-applicant v3 contact-attestation projection/digest remains
  compatible across the change;
- roster prune/read preserves the applicant email/source pair and produces the
  same applicant canonical-contact decision.

### UI/stale-state tests

- existing-linked-record badge does not imply identity verification and is
  distinct from the exact-email/ORCID “Known in Dataverse” badge;
- correct action reason renders for ready/quick-check/research-only/missing;
- per-row known lookup failure remains retryable;
- late request-A result cannot update request B;
- old applicant roster cache misses after the cache-version increment.

## Gates

Run gate and self-test sequentially where both exist:

1. scoped Jest suites for applicant ingestion, enrichment, promotion,
   reviewer-vetted-email/invite, roster, and UI stale-state behavior;
2. `npm run check:dataverse-access-layer` and its self-test (unconditional: the
   helper adds a new Dataverse adapter call surface);
3. `npm run check:route-service-boundary` and self-test;
4. `npm run check:api-routes` only if a route contract/security listing changes
   (no new route is planned);
5. `npm run check:atlas` and self-test after updating the two reviewer Atlas
   read-path descriptions;
6. `npm run build`;
7. `/contract-reconcile` across GET ingestion → SSE enrichment → roster →
   promotion → Invite/send before completion.

## Durable documentation

On implementation, reconcile:

- `docs/atlas/dataverse-wmkf-potentialreviewers.md` read paths;
- `docs/atlas/dataverse-wmkf-appreviewersuggestion.md` Workbench enrichment and
  promotion paths;
- `docs/REVIEWER_CANDIDATE_PROMOTION_REMEDIATION_PLAN.md` only if the canonical
  projection contract itself changes materially;
- `docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md` for the new applicant
  persisted-contact reuse decision and unchanged send classifier;
- this plan's status and implementation log.

No migration manifest, schema manifest, API route count, or new Atlas entity
page is planned.

## Acceptance criteria

1. Applicant recommendations hydrate from their exact Dataverse person before
   external enrichment.
2. Request 1002959 visibly recognizes all five linked people and preserves the
   correct address-source action.
3. Existing ORCID/affiliation evidence reaches the resolver.
4. Known contact never bypasses identity or current-request COI.
5. Stored and newly enriched address disagreement cannot mutate the shared
   person.
6. Canonical persisted contact can be reused without an email write;
   `quick_check` retains its acknowledgement, `research_only` remains
   unsendable, and missing/conflict cannot promote.
7. Per-person failures remain explicit and retryable.
8. No person, suggestion, contact, or invitation is created by hydration.
9. Relevant tests/gates and a signed-in no-send smoke pass.

## Review receipt

**Reviewer:** Claude Opus, high effort, read-only  
**Date:** 2026-07-29  
**Initial verdict:** `NEEDS REWORK`

The review found three P0 blockers in the first draft:

1. extending the shared contact projection would invalidate in-flight v3
   attestation receipts;
2. the GET ingestion path lacked the stale-request guard the draft claimed;
3. `dataverseContactEvidence` and “Known in Dataverse” already had a distinct
   exact-email/ORCID search meaning.

It also found roster-prune address/source de-pairing, null-email
`emailConfidence` fall-through, an undeclared `research_only` restriction,
false clean-empty SSE behavior, inactive-owner fall-through, hydration
placement inside the wrong `try/catch`, and missing gates/docs.

**Revision disposition:** all named findings are incorporated into this
document. The revised design:

- leaves the shared attestation-bound projection unchanged;
- uses an applicant-specific persisted-contact reuse projection;
- adds the GET request-switch guard as a prerequisite;
- uses `applicantKnownReviewer` / “Existing linked reviewer record”;
- persists the applicant email/source as a bounded roster pair;
- normalizes null email explicitly before classification;
- preserves current `research_only` promotion behavior and unchanged send
  blocking;
- specifies structured per-row SSE failures and the all-read-failed result;
- rechecks inactive state explicitly;
- places hydration outside the suggestion materialization `try/catch`;
- makes the DAL gate unconditional and adds the enforcement-contract doc.

The complete review is preserved in
`docs/audits/applicant-reviewer-dataverse-first-hydration-opus-review-2026-07-29.md`.
