# Factory reviewer promotion correction

Status: branch implementation; not merged, deployed or live-proved.
Owner authorized the narrow fix and Claude Fable plan/code subscription reviews.
No invitation is sent by this change. The existing bounded rehearsal remains a
separate operation after release.

## Contract and invariants

Contract-reconcile Mode B. Surface: promote one already-bound fictional Factory
applicant reviewer into Invite without editing its identity. Entry: applicant
status action → existing authenticated promote-applicant-reviewer route →
service → fresh capability/canonical contact → guarded Dataverse suggestion
selection → existing Postgres roster finalizer → keyed response → guarded client
reload. Persistence remains the existing suggestion and operational roster;
no schema, route, provider, background worker or email transport is added.

| Invariant | Enforcement | Verification |
|---|---|---|
| Browser Factory hints grant no authority | Service resolves server capability from the suggestion person and request | Spoofed ordinary-row hint remains blocked |
| Synthetic exception requires isolation and exact active test pairing | Existing synthetic-reviewer capability; re-read before selection | Capability-denial, inactive, kind/email drift cases |
| Ordinary identity/address behavior remains | Exempt only freshly verified synthetic kind; defer binding errors to prior position | Existing route/contact/service characterization suites |
| Fictional scholarly claims never edit or supply the test identity | Reject contact edits; use canonical stored email, skip person/address/researcher writes | Missing-roster and unresolved/mismatched-roster tests contain real conflicting claims |
| Protected roster/engagement states remain unavailable | Existing engagement guards, Factory active/saved-status allowlist and deceased hold | Protected statuses, deceased evidence and select race tests |
| No promotion with unverifiable or ambiguous canonical email | Exact email owner hydration, valid stored address and unchanged-email check | Missing/malformed/conflicting/unavailable contact tests |
| Supporting roster failure does not conceal committed selection | Existing per-suggestion partialSuccess contract and client saved outcome | Store/parent-refresh failure tests |
| Old responses cannot affect another request | Existing generation lifecycle; every new post-await state/callback checks generation | Deferred success/failure after request switch |
| Only confirmed success removes the action | Exact suggestion success, local saved outcome and terminal keys | Malformed/failure/pending/read-only/terminal UI cases |

[VERIFIED via branch source and focused tests] The display hint is emitted only
by request-scoped server hydration, on the recommendation rather than the pruned
contact DTO. The UI labels the fictional Factory identity explicitly. An
all-Factory recommendation list does not start automatic scholarly enrichment;
mixed and ordinary lists retain the incumbent enrichment path. This is not a
scholarly identity confirmation or address-trust attestation.

Partial-success audit: Dataverse selection is the unit of committed success;
roster failure returns the exact suggestion plus partialSuccess. A failed or
malformed response makes no client success claim. A supporting reload/callback
cannot turn confirmed success into an invitation-send retry.

Async audit: new promotion uses the controller generation, shared saving lock
and request-bound outcome. Existing roster reload independently checks its
expected generation. Unmount invalidates the generation. No new stream or
fire-and-forget provider work is introduced.

Helper audit: no shared helper extraction; existing canonical contact,
capability, key, engagement and roster-finalizer contracts retain their distinct
roles. A Factory hint never enters the server authorization decision. The
ordinary identity-edit restriction still refuses synthetic people.

Durable audit: no new entity/column/table/index, migration, route, enum or status.
The existing finalizer already supports a missing-row insert and returns a
saved flag. Its active/saved conflict guard and partial-success limitation remain;
Postgres and Dataverse are not an atomic transaction. Ordinary roster lookup
and scholarly identity protections are unchanged.

Fan-out audit: the new recommendation-only hint flows from hydration through
applicant ingestion to the Find status action and automatic-enrichment filter.
It is not persisted as staff, scholarly or address authority. No global card
selectability or identity-edit policy is relaxed. Existing saved suggestion
engagement remains authoritative across Find and Invite.

Complement audit: ordinary or unverifiable capability gets no exception;
nonrecommended/wrong-request/engaged suggestions stop before selection; protected
or unreadable roster state cannot use the missing-row fallback; nonempty contact
payloads refuse for Factory; changed kind/email refuses; missing/ambiguous contact
refuses. Disabled/read-only/handled/terminal client paths expose no action.

## Review and validation

Claude Fable reviews use host OAuth, safe mode, read-only Read/Grep/Glob and an
empty MCP configuration, with a credential-free environment whitelist. Review
inputs contain repository source and synthetic cases only, no live fixture data
or private operational artifacts. No substitute review product is used.

Plan review returned named required changes: early capability with preserved
ordinary error precedence; canonical Factory contact instead of fictional AI
claims; typed revalidation conflict and kind/email comparison; direct UI callback
with terminal hiding; recommendation-level hint and canonical fallback key/name.
These were incorporated into the branch implementation and focused tests.

Initial code review found two issues, now corrected in the frozen revision:
server promotion retains the incumbent unengaged `saved` re-promotion path;
Find still hides saved terminal keys under its existing policy. The Factory
command restores the prior search phase in its guarded finally block, so success
or failure does not hide or relabel an unrelated search. A mixed recommendation
UI test now actually exercises the ordinary enrichment boundary. Fictional
Factory identities do not produce scholarly institution measurements.

Local validation of the frozen revision:
- 14 focused reviewer suites, 189 tests passed.
- Type check, scoped ESLint (zero errors; one existing controller effect warning)
  and production Next build passed.
- Reviewer-engagement, DAL, route-service, API security, Atlas, documentation
  currency, fact consistency and secret gates passed, with their self-tests run
  sequentially; docs-catalog passed.
- Earlier whole-unit checkpoint: 1,499 suites passed, one failed; 26,411 tests
  passed, three failed. All three are in `meeting-sessions-view.test.js` and
  reproduce with the same assertions from an isolated archive of unchanged base
  `d3016b5da7e0ce3abc2e2719348a35a5f9df17f4`. They are not fixed by this scoped
  change. Final focused verification includes the subsequent Fable corrections.

Final Fable verification: **READY FOR OWNER REVIEW**. All enumerated findings
closed against the frozen source and explicit diff. Review found no bypass,
ordinary regression, async partial-success hole or ID-binding gap. This is a
source review verdict, not a hosted deployment or invitation proof.

Named residual limits: a hypothetical Factory `coi_dropped` row is absent from
visible roster buckets, so its stale display action may still render; the server
refuses it with 409 before selection. The all-Factory list deliberately shows the
Factory identity label rather than a scholarly verification summary. Existing
cross-system finalization and the separately reproduced base test failures remain
as described above.

## Frozen source/test fingerprints

SHA-256, checked unchanged after the final Fable verdict. Subsequent receipt-only
edits do not change the reviewed runtime.

| File | SHA-256 |
|---|---|

| `lib/services/workbench/applicant-known-reviewer-service.js` | `034a6b984dbe1fe4509fe209fbf9f4fd94c650880319fe1b85adb4f4ce865937` |
| `lib/services/workbench/applicant-reviewers-service.js` | `43f91ce5c07112c8ed47ebce7219ed7b06f22d232c7c8b001728a7d62e69ba75` |
| `lib/services/workbench/promote-applicant-reviewer-service.js` | `76d1fc9a285171c03b5cd372e05b0c00998c4e43afe46256c0a05ba4f5ad2137` |
| `shared/components/reviewers/ReviewerSearchSection.js` | `aa418b2cec34744580e4acc34bce5615bd5933b51e4631d25739bae60e248548` |
| `shared/components/reviewers/search/ApplicantReviewerStatus.js` | `800037abc37d1361ca0851f1142c4d6544145e32edaa88cb8f98ce128b14e8fd` |
| `shared/components/reviewers/search/useApplicantReviewerEnrichment.js` | `fb81fd3001d22305c0a07f7dbca84f6fdedd5a95f50f1db201ea3b554122829c` |
| `shared/components/reviewers/search/useReviewerPromotion.js` | `5452830214885eda8ba452c742cf2ba44b0d64c36e728abcefe1b12683cdd3f3` |
| `shared/components/reviewers/search/useReviewerSearchController.js` | `f6fa85f2c338a853f76f6aad461341b72e57d799635d6f57e78a96eef070a311` |
| `tests/unit/applicant-known-reviewer.test.js` | `ebaac106923c01c18414ce02db1fa31d26cd0229e989894ff4500170c1acbe4b` |
| `tests/unit/workbench-applicant-reviewers-service.test.js` | `691109ff2a1d8bf63745c37a05e9bb85077d7eda5432a12c9df67d2dc9d592b0` |
| `tests/unit/workbench-promote-applicant-reviewer-service.test.js` | `fbefe056194bc73d76286afe158c95ffb8fe7298bb33123891bbbe2e6d31b9fd` |
| `tests/unit/factory-reviewer-promotion-ui.test.js` | `f1ea815e0be6f91570d1b84853ff508ce499a8a383a149c5b85af7353151f095` |

Source-only review response fingerprints (private response files are not committed):

- plan: `c38dd39118ef30b836e46abc1d57fac4a90d0f30086fe20c71249e063ec77f00`
- code: `1085f713e84023c927555e4144d0b7c915350f5b1fd1d2f267a3420aa3d0238e`
- final: `9b1e798c1975808cf0d354cbbab0f5b7231990893c0740de37941d04fda741cc`
