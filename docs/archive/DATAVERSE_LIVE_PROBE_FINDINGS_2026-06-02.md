# Dataverse Live Probe Findings - 2026-06-02

Read-only Dataverse probes succeeded after console-approved network escalation. No code, Dataverse rows, or local probe-output files were modified during the probes.

## Verified Counts

| Entity set | Live count | Notes |
| --- | ---: | --- |
| `wmkf_appresearchers` | 339 | Bibliometric sidecar rows |
| `wmkf_potentialreviewerses` | 4269 | Vendor potential reviewer rows |
| `wmkf_apppublications` | 0 | Deployed, empty |
| `wmkf_apppublicationauthors` | 0 | Deployed, empty |
| `wmkf_app_z_publication_authors` | 404 | Obsolete `_z_` entity set is not deployed |

## Publication Entity Naming

The deployed publication-author entity is:

- Logical name: `wmkf_apppublicationauthor`
- Entity set: `wmkf_apppublicationauthors`
- Primary id attribute: `wmkf_apppublicationauthorid`

The `_z_` name is only a schema-file/create-order artifact, not the deployed Dataverse logical name.

## Attribute Inventory

Live metadata confirmed:

- `wmkf_appresearcher`: 24 custom `wmkf_*` attributes
- `wmkf_potentialreviewers`: 23 custom `wmkf_*` attributes

Relevant string max lengths:

| Entity | Attribute | Max length |
| --- | --- | ---: |
| `wmkf_appresearcher` | `wmkf_primaryaffiliation` | 500 |
| `wmkf_appresearcher` | `wmkf_department` | 255 |
| `wmkf_potentialreviewers` | `wmkf_organizationname` | 100 |

## Sidecar Link Audit

The `wmkf_appresearcher` to `wmkf_potentialreviewers` link shape is clean:

- Sidecar rows scanned: 339
- Potential reviewer rows scanned: 4269
- Null `_wmkf_potentialreviewer_value` links: 0
- Dangling `_wmkf_potentialreviewer_value` links: 0
- Duplicate sidecar links to the same potential reviewer: 0

Keep this link-shape audit as a pre-backfill/pre-drop gate before any collapse patch writes into live `wmkf_potentialreviewers` rows.

## Notes Fields

- `wmkf_appresearcher.wmkf_notes` exists in live metadata.
- `wmkf_appresearcher.wmkf_notes` has 0 populated rows.
- Nearby reviewer suggestion notes are real: `wmkf_appreviewersuggestions.wmkf_notes` has 3 non-null rows.

Implication: skipping migration of sidecar `wmkf_notes` is live-data safe today, but do not generalize that to reviewer suggestion notes.

## Review Implications

- The earlier DNS blocker is no longer absolute: escalated one-off probes can reach Azure auth and Dataverse.
- `docs/archive/APPRESEARCHER_COLLAPSE_PLAN.md` is correct that `wmkf_apppublicationauthor` is deployed and empty.
- Any audit or doc still treating `wmkf_app_z_publication_authors` as the live entity set is stale.
- The D-AFF max-length concern is real: `wmkf_primaryaffiliation` has 500 chars while `wmkf_organizationname` has 100.
