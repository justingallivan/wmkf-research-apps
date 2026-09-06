# Atlas: `wmkf_apprequestperson` (Dataverse, WMKF junction entity)

**Last verified:** 2026-05-15 (S155) — live `wmkf_role` data re-probed (`scripts/probe-apprequestperson-role-data.js`); base entity 2026-05-08 via S139 deploy (`c8cbfe1`) + backfill (`8b9b287`)
**Live row count:** 5,561 (4,488 PI + 1,073 Co-PI; re-confirmed 2026-05-15 — zero rows in `100000002`–`100000004`)
**Entity set:** `wmkf_apprequestpersons`
**Schema spec:** `lib/dataverse/schema/wave2/wmkf_app_request_person.json`; slice-0 roster-field additions `lib/dataverse/schema/wave4-existing/wmkf_apprequestperson-roster-fields.json`; `wmkf_role` enum expansion `scripts/extend-apprequestperson-role-picklist.mjs` (NOT a wave spec — apply-dataverse-schema.js is creation-only, see `[[project_slice0_role_probe]]`)

## Source of truth

**Junction tracking PI / co-PI participation across `akoya_request` history.** One row per (request, contact, role). Replaces the legacy 6-OR query against `akoya_request._wmkf_projectleader_value` + `_wmkf_copi1..5_value` for "what proposals has this person been on?" lookups.

Read-side strategy is **UNION** with `akoya_request._wmkf_projectleader_value`, **not** junction-first / projectleader-fallback (see `docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md` §5 and `pages/api/reviewer-finder/contact-history.js` header comment). The projectleader lookup field stays authoritative for active PI in parallel with the junction because (a) other vendor flows still update it, and (b) Connor's PA flows dual-write `_wmkf_projectleader_value` alongside the `pi` junction row. The junction is the **sole source** for legacy co-PI history.

## Fields

Identity:
- `wmkf_apprequestpersonid` (PK)
- `wmkf_assignmentkey` (String, ApplicationRequired) — primary name; backfill convention `<requestNum>-<role>-<position>` (e.g. `1002787-PI-0`) for picker display

Lookups (PascalCase nav-property names — `@odata.bind` requires PascalCase, plain reads use lowercase logical names):
- `wmkf_Request` / `_wmkf_request_value` → `akoya_request` (ApplicationRequired)
- `wmkf_Contact` / `_wmkf_contact_value` → `contact` (ApplicationRequired)

Role + provenance:
- `wmkf_role` (Picklist, ApplicationRequired): `100000000=PI`, `100000001=Co-PI`. Slice 0 (intake portal pilot) expands to 5 values — `100000002=Senior Personnel`, `100000003=Key Personnel`, `100000004=Other` (integers reserved S150; **spec'd S155 as `scripts/extend-apprequestperson-role-picklist.mjs`, NOT yet deployed** — target 2026-05-19). Live-data probe 2026-05-15 confirmed slots `100000002`–`100000004` unoccupied (point-in-time; re-run the probe at deploy). AO/Liaison are account-level (intake portal pilot scope) and not in this junction; reviewers stay on `wmkf_potentialreviewer`. **Source-filter invariant:** reviewer / co-PI consumers MUST filter `wmkf_role IN (100000000, 100000001)` at the OData level so the slice 0 expansion is non-breaking; intake-portal-roster consumers can read the full set.
- `wmkf_authorposition` (Integer 0..5): provenance from legacy slot fields — `0` for PI (from `_wmkf_projectleader_value`), `1..5` for co-PI (from `_wmkf_copi1..5_value`). Optional; PA-flow-created rows may leave this null.

Slice-0 roster fields (spec `lib/dataverse/schema/wave4-existing/wmkf_apprequestperson-roster-fields.json`; **spec'd S155, NOT yet deployed** — target 2026-05-19; all nullable):
- `wmkf_effortpct` (Integer 0..100) — percent effort for this person on this request.
- `wmkf_biosketchurl` (String 500) — reference URL to this person's biosketch attachment.
- `wmkf_lineorder` (Integer 0..100000) — display order within the request's personnel list.

Alternate key:
- `wmkf_request_contact_role` covers `(wmkf_request, wmkf_contact, wmkf_role)` — authoritative dedupe; same person can hold both PI and Co-PI rows on the same request (rare but legal — distinct rows since role is part of the key).

## Read paths

- `pages/api/reviewer-finder/contact-history.js` — UNION-read endpoint for a single contact's PI/co-PI history. Pulls junction filtered at source to `wmkf_role IN (PI, Co-PI)` (post-2026-05-14; before that, the source filter was "any role"; tightened so Senior/Key/Other intake-portal roster rows don't pollute reviewer history) + projectleader-field rows in parallel via `queryAllRecords`, dedupes on `(requestId, role)`, returns per-row `sources: ['junction'|'projectleader'|both]` provenance. Both source queries paginate via `@odata.nextLink` (5000 cap) — see commit history for the original `top:100` truncation bug.
- `pages/api/external/review/[token]/context.js` (S144) — co-PI display list for Stage 2a's proposal summary card. Junction-only read (role=Co-PI), expand on `wmkf_Contact($select=fullname,firstname,lastname)`, ordered by `wmkf_authorposition asc,createdon asc`, dedup by contact GUID. The legacy `_wmkf_copi1..5_value` slot fields are NOT consulted here — see "Migration disposition" below.
- ~~`pages/api/reviewer-finder/generate-emails.js`~~ — **retired 2026-09-06 (owner decision D2)**; it read the Co-PI rows for the invitation Co-PI line. The live render/send path reads Co-PIs through the adapter instead.
- `scripts/acceptance-w4.js` — smoke benchmark; mirrors `contact-history.js`'s UNION read. Filters `role IN (PI, Co-PI)` as of 2026-05-14.

## Write paths

- `scripts/backfill-request-person-junction.js` — one-time backfill from legacy slot fields. Idempotent on rerun: pre-fetches every existing junction row via raw `@odata.nextLink` pagination (NOT `queryAllRecords`, which caps at 5000 — the backfill itself created 5,561 rows so the cap-guard would fire before any keys were checked). Defense-in-depth on duplicate-key errors during insert.
- **(Future)** Connor's PA flows on `akoya_request` create/update — net-new flows that dual-write the junction row alongside `_wmkf_projectleader_value` for PI, and the role's slot field for new co-PI fills. Status: unblocked since 2026-05-07; not yet built. Until they ship, `contact-history.sources` arrays will show single-source `[junction]` for legacy data and single-source `[projectleader]` for any post-backfill PI changes — that's the transition-state honesty signal.

## Cross-system

| Source | Mapping |
|---|---|
| `akoya_request._wmkf_projectleader_value` | UNION-read for PI. Steady-state dual-write owned by Connor's PA flows. |
| `akoya_request._wmkf_copi1..5_value` | One-time backfill source for Co-PI rows; vendor co-PI slots become **read-only legacy** once Connor's create/update flows ship. |
| `contact` | Required lookup target; same person can hold many junction rows across requests. |

## Migration disposition

Net-new entity (S139). No drain or migration — all population is via the one-time backfill (legacy slot fields) plus future PA-flow inserts. The legacy `wmkf_copi1..5` slots stay in place during the transition for vendor compatibility but become read-only legacy once steady-state PA flows ship.

## Open questions / gotchas

- **`@odata.bind` keys are case-sensitive.** Use PascalCase nav-property names (`wmkf_Request@odata.bind`, `wmkf_Contact@odata.bind`), not the lowercase logical column names. Lowercase keys produce a `0x80048d19` "Error identified in Payload" 400. Plain reads use lowercase. Confirmed during the backfill smoke run.
- **`queryAllRecords` cap.** The DynamicsService helper caps at 5000 rows (`MAX_EXPORT_RECORDS`). The junction is already at 5,561 rows; any operational read of "all junction rows" must use raw `@odata.nextLink` pagination. Mirrored in both the backfill prefetch and any future reconciler.
- **Per-row `sources` provenance is steady-state, not transient.** Even after Connor's PA flows ship, vendor flows that update `_wmkf_projectleader_value` outside the PA path will produce single-source `[projectleader]` rows. Don't assume two-source PI rows everywhere.
- **No reverse name-search.** `wmkf_assignmentkey` is for picker display only (`<requestNum>-<role>-<position>`); do not parse it as a join key.
