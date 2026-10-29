# Atlas: `wmkf_grantcycle` — operations Grant Cycle table

**Last verified:** 2026-10-28 via `scripts/probe-grant-cycle-dates.cjs`
(owner-run, read-only; evidence `docs/audits/grant-cycle-dates-2026-10-28-evidence.json`).

**Owner:** Connor's operations process creates rows (when the GOApply portal
opens for a cycle). Since 2026-10-28 (alignment log D43) the apps edit the
milestone dates through the cycle calendar. Not the apps table
`wmkf_appgrantcycle` (see `dataverse-wmkf-apppublication-and-appgrantcycle.md`).

**Entity set:** `wmkf_grantcycles` · **alternate key:** `wmkf_cyclecode`

## Shape

- 143 rows; 55 use modern `J`/`D` two-digit codes (foundations audit
  2026-10-21); others are historical March/September or four-digit-year codes.
  All rows have `statecode` 0, so state does not separate current cycles.
- Recent rows: D26 (Board 2026-12-10), J26 (2026-06-10), J27 (2027-06-10). No
  D27 row; expected only when its portal opens.
- Columns: `wmkf_cyclecode` (required), `wmkf_name`, `wmkf_meetingdate`
  (Board Meeting Date, required) and eleven optional milestone dates:
  `wmkf_researchproposalduedate`, `wmkf_researchleadershipsemifinalistemaildate`,
  `wmkf_researchleadershipsemifinalistmeetingdate`,
  `wmkf_researchchairssemifinalistemaildate`,
  `wmkf_researchchairssemifinalistmeetingdate`, `wmkf_researchreviewsduedate`,
  `wmkf_researchofframpmeetingdate`, `wmkf_researchleadershipfinalistemaildate`,
  `wmkf_researchchairsfinalistemaildate`, `wmkf_researchbudgetduedate`,
  `wmkf_boardmailingdate`. All dates are DateOnly / TimeZoneIndependent; all
  eleven milestone dates were null on D26, J26 and J27 at verification.
- `wmkf_cyclename` appears in the repo schema snapshot
  (`lib/dataverse/schema/wave0-prod-parity-foundation/01_wmkf_grantcycle.json`)
  but not in live metadata.
- Auditing: organization on; every column flagged; **table auditing turned on
  2026-10-28** (`scripts/enable-grant-cycle-audit.cjs`, alignment log T14).
- Linked from `akoya_request.wmkf_grantcycle` and `akoya_akoyaapply.wmkf_grantcycle`;
  the activated `WMKF_Set Grant Cycle from Opportunity` process sets the
  request lookup (T10).

## Runtime readers and writers

| Path | Operation | Status |
|---|---|---|
| `lib/dataverse/adapters/operations-grant-cycle.js` | list J/D rows with dates + ETag; PATCH one date column (`If-Match`, impersonated, no fallback); per-row `RetrieveRecordChangeHistory` | [SOURCE-BUILT ON BRANCH `claude/cycle-calendar`; NOT DEPLOYED, 2026-10-28] |
| `lib/services/cycle-calendar-service.js` ← `pages/api/cycle-calendar.js` | staff read; Grants Manager / Program Coordinator / superuser save | same |

No other runtime code reads this table (cycle-settings audit 2026-10-27, row
A4). Request cycle identity still derives from `wmkf_meetingdate` in
`lib/utils/cycle-code.js`; the lookup-first rule (T10) is planned, not built.
