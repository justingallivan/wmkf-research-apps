# Phantom co-PI on seven grant requests — incident record (2026-08-12)

Shareable brief: https://claude.ai/code/artifact/bd6881e6-7fbf-4e1a-8c6c-bb4b6e96ab14

**Summary.** One duplicate contact carrying the placeholder email `_@_._` is
attached as a co-PI to seven unrelated requests. It became visible on
2026-08-12 when the grantee portal for request 1002132 rendered the byline
"Heinrich Jaeger and Yvonne Mariajimenez". **No application code is at fault** —
the app read and rendered the data correctly at every step. Root cause is
upstream in the akoyaGO import.

All figures below come from read-only production Dataverse queries on
2026-08-12 `[VERIFIED via probe]`.

## The contact

| | |
|---|---|
| Duplicate (bad) | Yvonne Mariajimenez · `2a67a272-9eb5-f011-bbd3-6045bd0510d4` · `_@_._` · created 2025-10-30T14:41:07Z |
| Genuine (leave alone) | Yvonne Mariajimenez · `bb262b83-cd8f-ee11-8179-000d3a310f67` · `ymariajimenez@nlsla.org` · created 2023-11-30 |

She has no connection to any of these proposals. Only one contact in the org
carries the exact email `_@_._`.

## Affected requests

The bad link exists in **two** places per request: the `akoya_request.wmkf_copi{n}`
slot (what CRM staff see) and the `wmkf_apprequestperson` junction row (what the
grantee portal reads via `fetchCoPIs`). The slot is **not** always Co-PI 1.

| Request | Project | Slot | Junction row | Portal exposure |
|---|---|---|---|---|
| 1002132 | Non-Reciprocal Matter | copi1 | `a3f0e64d-654a-f111-bec6-000d3a306da2` | **SENT** 2026-08-12T18:26:49Z; awardee replied twice |
| 1002262 | Soil-Inspired Digital Twins for Functional Materials | copi1 | `745c1b57-654a-f111-bec6-70a8a59d207f` | not generated |
| 1002363 | Metabolic Control of Circulation | copi1 | `252c5860-654a-f111-bec7-000d3a3065b8` | not generated |
| 1002367 | High-Resolution Arctic Methane Flux Network | copi4 | `eec97f63-654a-f111-bec7-000d3a3064b7` | not generated |
| 1002865 | Illuminating The 'Dark Matter' Of Biology | copi2 | `d66b5b68-654a-f111-bec6-70a8a5b32213` | not generated |
| 1002880 | Expanding the Ultraviolet Frontier | copi1 | `52891867-654a-f111-bec6-000d3a306d0c` | not generated |
| 1003053 | Genomes That Last: Chromoglass | copi1 | `3ab7057c-654a-f111-bec6-70a8a59d207f` | not generated |

Exposure is **1 of 14** requests with a generated grantee abstract.

## Timeline

1. **2025-10-30** — request 1002132 created 14:38:53Z; the placeholder contact
   created 14:41:07Z, sharing a GUID batch suffix. Likely mechanism: the importer
   requires an email to match/create a contact, fell back to a placeholder for
   emailless co-PIs, and every later emailless co-PI matched that same record.
2. **2026-05-07T22:37:21Z** — `scripts/backfill-request-person-junction.js`
   copied `wmkf_copi1..5` slots into the junction (creator
   `# WMK: Research Review App Suite`). It copied faithfully; the source was
   already wrong.
3. **2026-08-12T18:26:49Z** — staff sent the abstract request for 1002132. That
   flow writes only `wmkf_abstractformatted`, the deliverable status, and an
   email activity — it never touches participants.

## Remediation

`scripts/remediate-placeholder-copi.js` (committed `64dd4bf4`) — dry-run by
default; clears 7 slots and deletes 7 junction rows.

```bash
DATAVERSE_ALLOW_PROD_READS=yes node scripts/remediate-placeholder-copi.js --dry-run
DATAVERSE_ALLOW_PROD_READS=yes \
  DATAVERSE_PROD_WRITE_ACK="remediate placeholder co-PI $(date -u +%F)" \
  node scripts/remediate-placeholder-copi.js --execute
```

Guards: refuses any contact whose email is not punctuation-only; caps at 25 rows;
resolves slot nav properties from live metadata (`wmkf_CoPI{n}`); re-runnable
after partial failure since the plan rebuilds from live state. `deleteRecord`
does **not** tolerate 404 (unlike `disassociate`) — if a PA flow cascades the
junction delete, expect 404 failures that are actually successes.

## Open items

- **Connor — fix the importer.** The only change that prevents recurrence. Also
  confirm whether a PA flow currently syncs slots → junction on create/update.
- **Program staff — re-enter genuine co-PIs.** The placeholder likely stood in
  for real co-PIs lacking an email; the slot table above records exactly what was
  cleared where.
- **Data hygiene — retire the duplicate contact** *after* the junction rows are
  deleted, never before.
- **Separate flag: request 1002788** "To Explore the Universe" has a test-data
  byline (`abc@uc.com`, `alex@alex.com`, malformed `river@uc.com.`), marked
  Submitted with an invite on 2026-08-10. Unrelated; not acted on.

## Caveats

- The seven-request count covers contacts whose email is exactly `_@_._`. Other
  placeholder shapes (`x@x.com`, blank, `noemail@…`) would not appear — this is a
  floor, not a ceiling.
- Product question, not a bug: the grantee portal shows co-PIs to an external
  awardee with no staff review of that list, which is why a data error surfaced
  in front of a grantee rather than internally.
