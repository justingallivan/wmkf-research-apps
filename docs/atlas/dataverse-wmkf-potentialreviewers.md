# Atlas: `wmkf_potentialreviewers` (Dataverse, custom Foundation entity)

<!-- Prior versions of this page labeled this a "vendor entity + extensions." That was wrong. Live EntityDefinitions metadata: IsCustomEntity=true, IsManaged=false → custom Foundation entity, built by/for WMKF (not AkoyaGo). The only true vendor entity in the reviewer stack is akoya_request. Corrected 2026-05-28. -->

<!-- drain-table:file-purpose=atlas-state-page -->

**Last verified:** 2026-07-13 via `node scripts/preflight-reviewer-identity-binding-fields.mjs --target=prod --include-population`; row count re-probed 2026-07-12 via `scripts/reconcile-memory-claims.js`
**Live row count:** 4,416
**Entity set:** `wmkf_potentialreviewerses` (note Dynamics-pluralized form)
**Adapter:** `lib/dataverse/adapters/potential-reviewer.js`
**Extension manifests:** `lib/dataverse/schema/wave2-existing/wmkf_potentialreviewers-extensions.json` + `lib/dataverse/schema/wave13-reviewer-identity-binding/01_wmkf_potentialreviewers_identity_binding.json`

## Source of truth

**Connor's lead/person record.** One row per real person — global, not per-proposal. Email is the de-dupe key. Promoted to a CRM `contact` when staff first reaches out (via `wmkf_contact` lookup).

This is the **canonical person record** for the reviewer-finder domain. Dataverse `wmkf_potentialreviewers` has 4,416 rows because Connor's team also tracks reviewers from other systems and historical outreach; dropped Postgres `researchers` was only a small, 331-row historical pool.

## Key fields (live, sample-probed 2026-05-07)

Identity:
- `wmkf_potentialreviewersid` (PK)
- `wmkf_name` (full name) + `wmkf_firstname` + `wmkf_lastname`
- `wmkf_prefix` (Picklist — Mr/Dr/Prof/etc.)
- `wmkf_title` (String — job title)

Contact:
- `wmkf_emailaddress` (de-dupe key in adapter)
- `wmkf_organizationname`
- `wmkf_areaofexpertise`

Provenance / linking:
- `wmkf_source` (Picklist — where the lead came from)
- `wmkf_whyreviewerwaschosen` (free-form rationale)
- `wmkf_contact` (Lookup → `contacts`) — set when promoted to CRM contact
- `_wmkf_contact_value` is what shows in queries

Field caps observed empirically:
- `wmkf_organizationname` — 100 chars
- `wmkf_areaofexpertise` — 100 chars

**Board-writeup identity (S308 — reviewer/staff-CONFIRMED, distinct from the enrichment fields below):** `wmkf_academicrank` (200 — current academic rank, e.g. Professor / Investigator / Group Leader; NOT an administrative title), `wmkf_primarydepartment` (255 — primary department only), `wmkf_maininstitution` (255 — parent institution, not a center/institute within it). Captured (required) at Stage 2a accept via `lib/services/capture-self-reported-reviewer-identity.js` (reviewer self-report → person, non-fatal, ORCID-twin pattern) and staff-editable in the workbench (`CandidateEditModal` → `my-candidates` PATCH → `potential-reviewer.js update()`). Prefilled from `wmkf_department` / `wmkf_primaryaffiliation` but kept separate (overwriting those would degrade reviewer-card display + identity scoring). One canonical current value per person (NOT a per-request snapshot); board write-ups freeze the moment-in-time values. Schema-as-code: `lib/dataverse/schema/wave10-reviewer-board-identity/`. RequiredLevel None in Dataverse (enrichment creates the row without them); "required" is UI/route-enforced at accept only.

**Bibliometric fields (S213 — folded in from the dropped `wmkf_appresearcher` sidecar):** `wmkf_primaryaffiliation` (500, the canonical full-string affiliation per D-AFF), `wmkf_department` (255), `wmkf_orcid`/`wmkf_orcidurl`, `wmkf_googlescholarid`/`wmkf_googlescholarurl`, `wmkf_hindex`/`wmkf_i10index`/`wmkf_totalcitations`, `wmkf_website`/`wmkf_facultypageurl`, `wmkf_keywords` (Memo), `wmkf_emailsource`, `wmkf_lastchecked`/`wmkf_metricsupdatedat`/`wmkf_contactenrichedat`/`wmkf_contactenrichmentsource`. (`wmkf_organizationname` kept as a clamped-100 compat shadow.) Written by `adapters/researcher.js` (now person-targeting) + `potential-reviewer.js`. See `docs/archive/APPRESEARCHER_COLLAPSE_PLAN_V2.md`.

### Additive identity binding — deployed, not authoritative

`lib/dataverse/schema/wave13-reviewer-identity-binding/01_wmkf_potentialreviewers_identity_binding.json`
defines six live nullable fields: `wmkf_identitybindingversion`,
`wmkf_identitybindingsource`, `wmkf_identitybindinganchor`,
`wmkf_identityboundat`, `wmkf_identityderivedbindingversion`, and
`wmkf_identityfieldlineagejson`. They provide a monotonic person-binding
generation plus compact per-field lineage for safe correction/invalidation.
The owner-approved production-only apply completed 2026-07-12. **[VERIFIED
2026-07-13 via the command in Last verified]** typed metadata reported all six
EXACT. No production caller uses these names: the
inert `reviewer-identity-binding-writer.js` and
its narrow `researcher.js` ETag seam now select/PATCH them only when explicitly
invoked, and a raw caller census finds focused tests but no production caller.
The columns therefore remain non-authoritative and every existing row remains
null/legacy-unbound; the same population probe returned zero rows. The dated
output is captured in
`docs/audits/reviewer-identity-binding-prod-preflight-2026-07-13.md` and must be
refreshed before schema-adjacent work. Null
cannot confer action eligibility. Dirty legacy rows with existing identity
values but no lineage are blocked rather than inferred or cleared. Existing
resolver evidence remains in
`wmkf_identityevidencesummary` and `wmkf_identityverifiedanchorsjson`; the new
lineage field does not duplicate that evidence payload.

## Adapter contract (`lib/dataverse/adapters/potential-reviewer.js`)

Methods:
- `getByEmail`, `getById`
- `upsertByEmail({ name, email, affiliation, expertise, whyChosen })` — find-or-create on email; on match, **fill-if-empty only** (preserves staff edits)
- `update(id, updates)` — partial update with name-splitting
- `setContactLink(potentialReviewerId, contactId)` — sets `wmkf_Contact@odata.bind`

`splitName` strips `Dr./Prof./Professor` prefixes and splits on whitespace.
`clamp` truncates to FIELD_MAX with `…` suffix.

## Read paths

- `pages/api/review-manager/send-emails.js` — outreach
- `pages/api/review-manager/render-emails.js` — `DynamicsService.getRecord('wmkf_potentialreviewerses', personId)` to hydrate person fields per email draft
- `pages/api/review-manager/reviewers.js` `fetchPotentialReviewers` — chunked OR-chain on `wmkf_potentialreviewersid` to hydrate the Review Manager reviewer list
- `pages/api/reviewer-finder/{save-candidates,my-candidates}.js`
- `pages/api/workbench/enrich-recommended.js`, `lib/services/contact-enrichment-service.js`, `adapters/researcher.js` — read the bibliometric fields here (S213: was the `wmkf_appresearcher` sidecar)
- `lib/services/reviewer-identity-binding-writer.js` — inert fail-closed binding snapshot read; currently test-only with no production caller

## Write paths

- Endpoints: same as read (via `upsertByEmail` / `update` / `setContactLink`)
- `scripts/backfill-postgres-to-dataverse.js` — `upsertByEmail` against the Postgres `researchers` pool during Wave 2 backfill.
- `lib/services/reviewer-identity-binding-writer.js` — one complete ETag-guarded person PATCH after transition validation; currently test-only with no production caller

## Cross-system

| Source | Mapping |
|---|---|
| Postgres `researchers` | Migrates 1:1 by email match — produces the identity half of the new model |
| Dataverse `contacts` | Promoted on first outreach via `wmkf_contact` lookup; AppendTo permission granted 2026-05-01 |
| ~~Dataverse `wmkf_appresearcher`~~ | **DROPPED S213** — bibliometric snapshots folded onto this entity (see Key fields) |
| Vendor `akoya_requests.wmkf_potentialreviewer1..5` | Legacy per-proposal slots (not the canonical link — those are in `wmkf_appreviewersuggestion`) |

## "Engaged" semantics + one-shot post-pilot drop (locked S136; cleanup-cron approach replaced)

Per the migration plan, this table is treated as **scratch + history** rather than canonical-person. A `wmkf_potentialreviewer` row becomes "engaged" (= history) when ANY of the 8 signals on its linked `wmkf_appreviewersuggestion` are populated (see that page). The earlier cleanup-cron plan was replaced (Codex-reviewed) with a **one-shot post-pilot DELETE script** matching the Wave 1 precedent: drops un-engaged rows where `wmkf_meetingdate < today - 30 days` (the `wmkf_appresearcher` sidecar that this once cascaded onto was dropped S213 — bibliometrics are now columns on this row). No cron exists or is planned. Permanent reviewer identity ultimately lives in `contact` via promotion (`wmkf_contact` lookup).

## Migration disposition (live source of truth for reviewer identity)

Already the live source of truth for reviewer identity. Dataverse `wmkf_potentialreviewers` currently has 4,416 rows, including vendor-historical and post-cutover writes; pre-cutover bulk import from Postgres `researchers` was replaced with an engagement-history approach (don't bulk-migrate). One-shot post-pilot drop (per the section above) is the cleanup vehicle.

## Open questions / gotchas

- Dataverse `wmkf_potentialreviewers` currently has 4,416 rows, much larger than the dropped Postgres `researchers` 331-row historical pool. Per the migration plan: don't import researchers in bulk — engagement-history approach replaces the bulk-import pattern.
- `wmkf_contact` lookup population unknown — should probe how many rows have a non-null contact link before any drop operation runs.
- The "per-proposal slot vs. per-person canonical" distinction is contextual: the *table* is per-person (email is the dedupe key, `upsertByEmail` is idempotent), but `akoya_request.wmkf_potentialreviewer1..5` lookups treat individual rows as **per-proposal slot fills**. Both framings are correct; the one-shot post-pilot DELETE acts on per-person rows that have no per-proposal engagement (the earlier cleanup-cron design was replaced — see "Engaged semantics" section above).
