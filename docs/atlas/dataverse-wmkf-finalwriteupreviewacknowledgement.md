# Atlas: `wmkf_finalwriteupreviewacknowledgement` (Dataverse, WMKF child entity)

**Last verified:** 2026-08-31 via
`scripts/preflight-final-writeup-review-acknowledgement-schema.mjs --target=prod`
after the owner-approved Wave 23 Production apply.
**Live row count:** 1, verified by an exact Production entity-set count and
complete-row readback on 2026-08-31.
**Entity set:** `wmkf_finalwriteupreviewacknowledgements`
**Schema spec:**
`lib/dataverse/schema/wave23-final-writeup-review-acknowledgement/wmkf_finalwriteupreviewacknowledgement.json`

## Source of Truth

This organization-owned entity is the durable home for one staff reviewer's
latest version-aware acknowledgement of one Final Writeup Request Document.
It is neutral tracking, not approval, compliance, document lifecycle, or a
legal audit trail.

**[PRODUCTION SCHEMA LIVE 2026-08-31]** The hardened metadata readback reports
11 exact / 0 absent / 0 divergent / 0 pending. The alternate-key index is
Active. **[PRODUCTION RUNTIME AND FIRST ACKNOWLEDGEMENT PROVED 2026-08-31]** PR #140 /
merge `ce229778` shipped the typed adapter, distinct literal-on readiness
interlock, backend mark/read service, authenticated routes, Final-tab consumer,
and ordinary-staff dashboard. Production readiness is exact `on` in Ready
deployment `dpl_B9k3AprnYp5ExpkqpT3dUxCUZqWo`; Preview remains unset. Signed-in
dashboard and Request `1002788` Final reads showed zero reviews, retained Word
access, and correctly omitted responsible-PD self-review. An eligible colleague
then reached the Production create boundary but received Dataverse `0x80040220`
for missing `prvCreatewmkf_FinalWriteupReviewAcknowledgement`; the service reread
and confirmed no partial row. After the permission gap was remediated, the
colleague retry succeeded and appeared in review history. Independent readback
proved exactly one complete row for Request `1002788`, an enabled reviewer, and
all required stable file/version observation fields populated.

## Identity and Key

- `wmkf_finalwriteupreviewacknowledgementid` — Dataverse primary key.
- `wmkf_name` — required synthetic display name, String(200).
- `wmkf_FinalDocument` / `_wmkf_finaldocument_value` — required lookup to the
  Final `wmkf_requestdocument` row.
- `wmkf_Reviewer` / `_wmkf_reviewer_value` — required lookup to the enabled
  Dataverse `systemuser` derived from the authenticated application session.
- `wmkf_finalwriteupreview_document_reviewer_key` — Active alternate key on
  `wmkf_finaldocument` + `wmkf_reviewer`; one row stores that reviewer's latest
  acknowledgement for that Final artifact.

Relationship schema names are pinned:

- `wmkf_finalwriteupreview_finaldocument`
- `wmkf_finalwriteupreview_reviewer`

Both relationships use `Delete: Restrict`; Assign, Merge, Reparent, Share, and
Unshare use `NoCascade`.

## Security Role

**[PRODUCTION VERIFIED 2026-08-31]** Commit `6659bba2` tracks
`lib/dataverse/schema/roles/wave23-final-writeup-reviewer.json`. The
owner-approved apply created `WMKF Final Writeup Reviewer`, added it to
`wmkfResearchReviewAppSuite`, and assigned it directly to all 11 confirmed
audience members. Read-only Dataverse verification proved 11/11 assignments and
11/11 effective Global coverage for:

- acknowledgement Create, Read, Write, and Append;
- Request Document Append To; and
- User Append To.

The declarative specification contains only those six grants and explicitly
contains no Delete, Assign, Share, or Request Document write. Dataverse added
nine standard App Opener baseline privileges during role creation (SharePoint
data and plug-in/SDK-message access), so the live role contains 15 privileges.
All nine also appear in the built-in App Opener role; none crosses the prohibited
operations above.

## Version Observation Fields

- `wmkf_sharepointdriveid` — required String(300), stable Graph drive identity.
- `wmkf_sharepointitemid` — required String(300), stable Graph item identity.
- `wmkf_publicationversionid` — required String(300), observed publication
  version and primary freshness comparison.
- `wmkf_acknowledgedetag` — required String(300), diagnostic observed eTag;
  eTag alone must never mark an acknowledgement stale.
- `wmkf_sharepointlastmodified` — required DateTime/UserLocal, secondary
  observed freshness signal.
- `wmkf_acknowledgedat` — required DateTime/UserLocal, acknowledgement time.

## Read Paths

**[PRODUCTION-LIVE; SIGNED-IN READ SMOKE PASSED 2026-08-31]**
`lib/dataverse/adapters/final-writeup-review-acknowledgement.js` exposes named
reads for one Final artifact, one Final-artifact + reviewer pair, and a bounded
batch of at most 25 server-derived Final identities.
`lib/services/final-writeup/acknowledgement-service.js` resolves the current
Final pointer, validates the enabled session-derived `systemuser`, reads one
stable-ID Graph publication observation, and derives `unreviewed`, `reviewed`,
or `updated` from publication-version identity. eTag and last-modified remain
diagnostic and do not override an equal publication version.
`pages/api/workbench/final-writeup/acknowledgement.js` supplies only the
session-derived reviewer identity and exact request/current-Final fences.
`shared/components/workbench/FinalWriteupTab.js` consumes the route during
group review, shows positive reviewer initials and the non-PD caller's personal
state, and treats expected schema-not-ready as an unavailable optional panel so
the Word action remains independent.

`lib/services/final-writeup/dashboard-service.js` and
`pages/api/workbench/final-writeups.js` are also Production-deployed. They batch-read
acknowledgements for at most 100 requests with current-Final pointers, derive
ordinary staff open/history/stewardship queues plus an optional focused row,
and keep a reviewed row in history after a later Word edit while labeling its
freshness Updated. The route accepts only an optional Request GUID and derives
the reviewer from the session. No persona inference or complete coordinator
matrix is present.

## Write Paths

**[PRODUCTION-PROVED 2026-08-31]** The service accepts a
trusted session-derived system-user ID from the authenticated route boundary,
never a reviewer in the write payload. It rejects responsible-PD self-acknowledgement, observes
one current Graph publication version, creates the composite-key row or
conditionally replaces it with `If-Match`, preserves the timestamp on an exact
version no-op, and rereads after ambiguous failures so a committed write is not
reported as failed. Writes request `noFallback` impersonation. The route invokes
this path only after app access and exact-body validation. The live flag is
exact `on`. The first eligible non-PD POST reached Dataverse but lacked Create;
the subsequent reread found no row. The dedicated role then became effective
for all 11 audience members, and the colleague retry created the exact row and
returned the reviewed-history state. The stored acknowledgement time is
`2026-08-31T19:05:31Z`.

## Cross-System Contract

| Target | Mapping |
|---|---|
| `wmkf_requestdocument` | Parent Final artifact identity; a materially new Final successor does not inherit acknowledgements. |
| `systemuser` | Reviewing staff identity resolved from the signed-in application profile. |
| SharePoint / Microsoft Graph | Stable drive/item identity plus publication version, eTag, and last-modified observation; document bytes remain in SharePoint. |

## Deployment Evidence and Remaining Work

- The owner confirmed that the 11 active sign-in-capable staff profiles are the
  complete intended PD/PC/CSO/President audience and all resolve to enabled
  `systemuser` rows.
- The first local apply attempt was denied before its first POST by the target
  interlock. Readback remained 11 absent, proving no partial creation.
- The approved rerun used the repository's date-bounded, auditable
  `DATAVERSE_PROD_WRITE_ACK` operator exception without changing interlock mode.
- The apply created the entity, six custom attributes, two relationships, and
  alternate key. Readback progressed through metadata propagation and finished
  at 11 exact / 0 absent / 0 divergent / 0 pending with the key Active.
- PR #140 merged as `ce229778b05178bf4aabafe630e46de4843f5e81`; Preview
  deployment `dpl_9YMZvQFWLoRNrDzuKKugyj1DTkv2` and Production deployment
  `dpl_P7xay61LHnxohad9FEtSniBAosuY` both reached Ready. The custom-domain
  unauthenticated route redirected to sign-in as expected, and a bounded
  Production error-log scan returned no entries.
- Production activation deployment `dpl_B9k3AprnYp5ExpkqpT3dUxCUZqWo` reached
  Ready with the readiness value exact `on`. A signed-in dashboard/Final smoke
  on Request `1002788` confirmed zero reviews, the independent Word action, and
  responsible-PD exclusion; the post-smoke error scan was empty.
- The typed adapter, distinct readiness contract, backend mark/read service,
  acknowledgement route, Final-tab consumer, bounded dashboard projection,
  dashboard route, and ordinary staff dashboard/focused-review pages are
  Production-live with focused adapter/service/route/component tests.
  Preview readiness remains unset.
- The first eligible colleague POST isolated a missing Create privilege and
  persisted no acknowledgement. The tracked dedicated role was then created,
  solution-bound, and assigned to all 11 audience members under explicit owner
  approval. Direct assignment and effective coverage of all six requested
  Global privileges passed 11/11. The colleague's post-role retry succeeded and
  review history displayed the completed state; independent readback proved one
  complete acknowledgement row for Request `1002788`. No session-identity bypass
  or manufactured Final was used.
  Dedicated supporting-material data routes, the positively identified
  PC/leadership persona lenses, and the complete coordinator matrix remain;
  their rollout still requires the separate persona/access proofs.
