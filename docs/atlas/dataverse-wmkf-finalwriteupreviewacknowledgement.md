# Atlas: `wmkf_finalwriteupreviewacknowledgement` (Dataverse, WMKF child entity)

**Last verified:** 2026-08-31 via
`scripts/preflight-final-writeup-review-acknowledgement-schema.mjs --target=prod`
after the owner-approved Wave 23 Production apply.
**Live row count:** 0, verified by an exact Production entity-set count on
2026-08-31.
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
Active. **[SOURCE-BUILT, NOT DEPLOYED 2026-08-31]** A typed adapter, distinct
literal-on readiness interlock, and backend mark/read service now exist. Schema
availability still does not mean the acknowledgement runtime is enabled: no
API route, UI consumer, deployment, live readiness value, or Production write
exists yet.

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

**[SOURCE-BUILT, NOT DEPLOYED 2026-08-31]**
`lib/dataverse/adapters/final-writeup-review-acknowledgement.js` exposes named
reads for one Final artifact and one Final-artifact + reviewer pair.
`lib/services/final-writeup/acknowledgement-service.js` resolves the current
Final pointer, validates the enabled session-derived `systemuser`, reads one
stable-ID Graph publication observation, and derives `unreviewed`, `reviewed`,
or `updated` from publication-version identity. eTag and last-modified remain
diagnostic and do not override an equal publication version. There is no API or
UI consumer yet.

## Write Paths

**[SOURCE-BUILT, NOT DEPLOYED 2026-08-31]** The service accepts a trusted
session-derived system-user ID from its future route boundary, never a reviewer
in the write payload. It rejects responsible-PD self-acknowledgement, observes
one current Graph publication version, creates the composite-key row or
conditionally replaces it with `If-Match`, preserves the timestamp on an exact
version no-op, and rereads after ambiguous failures so a committed write is not
reported as failed. Writes request `noFallback` impersonation. No route invokes
this path and the live flag remains unset.

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
- The typed adapter, distinct readiness contract, backend service, and 26
  focused tests are source-built. Next work is the authenticated route/Final-tab
  wiring and then the dashboard/focused-review consumers. No runtime should be
  enabled merely because the table exists.
