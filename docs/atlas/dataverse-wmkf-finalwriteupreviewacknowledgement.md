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
Active. Schema availability does not mean the acknowledgement runtime is
enabled: no adapter, service, API route, readiness flag, or UI consumer exists
yet.

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

None yet. Wave 23 provisioned schema only. The planned Slice 2 adapter/service
will read by Final-document + reviewer identity and will derive personal state
from the current SharePoint publication version.

## Write Paths

None yet. The approved service contract will derive reviewer identity from the
authenticated session, reject responsible-PD self-acknowledgement, observe one
current Graph publication version, and conditionally update the caller's row.
No client-supplied reviewer, version, eTag, or timestamp will be authoritative.

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
- Next work is the typed adapter, readiness contract, service, focused tests,
  and then the dashboard/focused-review consumers. No runtime should be enabled
  merely because the table exists.
