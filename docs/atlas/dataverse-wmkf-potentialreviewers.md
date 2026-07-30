# Atlas: `wmkf_potentialreviewers` (Dataverse, custom Foundation entity)

<!-- Prior versions of this page labeled this a "vendor entity + extensions." That was wrong. Live EntityDefinitions metadata: IsCustomEntity=true, IsManaged=false → custom Foundation entity, built by/for WMKF (not AkoyaGo). The only true vendor entity in the reviewer stack is akoya_request. Corrected 2026-05-28. -->

<!-- drain-table:file-purpose=atlas-state-page -->

**Last verified:** Wave 13 metadata/population refreshed 2026-07-14 via `node scripts/preflight-reviewer-identity-binding-fields.mjs --target=prod --include-population`; row count re-probed 2026-07-26 via `scripts/reconcile-memory-claims.js`
**Live row count:** 4,427
**Entity set:** `wmkf_potentialreviewerses` (note Dynamics-pluralized form)
**Adapter:** `lib/dataverse/adapters/potential-reviewer.js`
**Extension manifests:** `lib/dataverse/schema/wave2-existing/wmkf_potentialreviewers-extensions.json` + `lib/dataverse/schema/wave13-reviewer-identity-binding/01_wmkf_potentialreviewers_identity_binding.json`

## Source of truth

**Connor's lead/person record.** One row per real person — global, not per-proposal. Email is the de-dupe key. Promoted to a CRM `contact` when staff first reaches out (via `wmkf_contact` lookup).

This is the **canonical person record** for the reviewer-finder domain. Dataverse `wmkf_potentialreviewers` has 4,427 rows because Connor's team also tracks reviewers from other systems and historical outreach; dropped Postgres `researchers` was only a small, 331-row historical pool.

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
EXACT. `reviewer-identity-binding-writer.js` and its narrow `researcher.js` ETag
seam select/PATCH them only when explicitly invoked. The first production caller
is live since PR #57 / `00ffb09c`:
the acceptance drain passes stable `accepted_at` into self-report capture, which
commits the person binding before contact/honorarium follow-up. The columns remain
non-authoritative to policy readers and backfills; the immediate post-deploy
population probe returned zero rows, so no first durable binding event has yet
been observed at that immediate post-deploy checkpoint. The 2026-07-14 read-only
refresh found one person row with at least one Wave 13 value; its origin was not
adjudicated by this aggregate probe and it does not make the fields broadly
authoritative. The earlier dated output is captured in
`docs/audits/reviewer-identity-binding-prod-preflight-2026-07-13.md` and must be
refreshed before schema-adjacent work. Null
cannot confer action eligibility. Dirty legacy rows with existing identity
values but no lineage are blocked rather than inferred or cleared. Existing
resolver evidence remains in
`wmkf_identityevidencesummary` and `wmkf_identityverifiedanchorsjson`; the new
lineage field does not duplicate that evidence payload.

## Adapter contract (`lib/dataverse/adapters/potential-reviewer.js`)

Methods:
- `findByEmailCandidates`, `getByEmail`, `getById` — exact normalized-email
  lookup is uniqueness-aware. Promotion reuses only one active exact owner;
  multiple active owners fail for repair, and an inactive owner is not silently
  reused.
- `upsertByEmail({ name, email, affiliation, expertise, whyChosen })` —
  find-or-create on exact email; on match, **fill-if-empty only** (preserves
  staff edits). A lost alternate-key create race re-reads the exact owner and
  converges rather than creating another person.
- `update(id, updates, { ifMatch })` — partial ETag-capable update with
  name-splitting. Null/blank email is omitted, not interpreted as a clear.
- `clearEmailForEdit(id, { expectedEmail, expectedEmailSource, ifMatch,
  reason })` — the only staff-edit destructive clear; fresh exact-value checks
  plus ETag, and address/source are cleared atomically.
- `clearEmail(id, { ifMatch })` — merge-only atomic address/source clear.
- `deleteExactNew(id, { ifMatch })` — bounded save compensation for the exact
  newly created, freshly proven unreferenced person only.
- `setContactLink(potentialReviewerId, contactId)` — sets `wmkf_Contact@odata.bind`
- `getByIdForMerge` / `deactivate` — wide merge read and ETag-guarded terminal
  mutation.

`splitName` strips `Dr./Prof./Professor` prefixes and splits on whitespace.
`clamp` truncates to FIELD_MAX with `…` suffix.

## Read paths

- `pages/api/review-manager/send-emails.js` — outreach
- `pages/api/review-manager/render-emails.js` — `DynamicsService.getRecord('wmkf_potentialreviewerses', personId)` to hydrate person fields per email draft
- `pages/api/review-manager/reviewers.js` `fetchPotentialReviewers` — chunked OR-chain on `wmkf_potentialreviewersid` to hydrate the Review Manager reviewer list
- `pages/api/reviewer-finder/{save-candidates,my-candidates}.js`
- `lib/services/workbench/applicant-known-reviewer-service.js` — exact-GUID,
  read-only applicant-link hydration for ingestion, enrichment, and promotion.
  It projects the person email and source as one bounded pair and verifies that
  any active email owner is the same person; it never falls back to a name
  match. `applicant-reviewers-service.js` runs this after suggestion
  materialization so a person-read outage cannot masquerade as a suggestion
  write failure.
- `pages/api/workbench/enrich-recommended.js`,
  `lib/services/contact-enrichment-service.js`, `adapters/researcher.js` — read
  bibliometric fields here (S213: was the `wmkf_appresearcher` sidecar).
  Applicant enrichment additionally seeds exact-person affiliation/ORCID and
  retains the bounded `applicantKnownReviewer` projection in the Postgres
  roster; per-person read failures remain explicit and retryable.
- `lib/services/workbench/promote-applicant-reviewer-service.js` — freshly
  re-reads the exact applicant-linked person and active email ownership before
  promotion. Canonical contact reuse performs no email write and cannot bypass
  identity, current-request COI, or the invitation send classifier.
- `lib/services/reviewer-identity-binding-writer.js` — fail-closed binding snapshot read; first production caller is live in acceptance-drain self-report

## Write paths

- Endpoints: same as read (via `upsertByEmail` / `update` / `setContactLink`)
- `lib/services/reviewer-finder/save-candidates-service.js` — canonical contact
  projection precedes all writes; exact active email-owner reuse, create-race
  convergence, and bounded exact-new-person compensation protect the promotion
  boundary.
- `lib/services/reviewer-finder/my-candidates-service.js` — normal edits never
  infer an email clear; the explicit clear command carries expected
  address/source, reason, and person ETag.
- `lib/services/reviewer-merge.js` — plans and preflights keeper/loser plus all
  reference ETags; every person mutation passes `ifMatch`.
- `scripts/backfill-postgres-to-dataverse.js` — `upsertByEmail` against the Postgres `researchers` pool during Wave 2 backfill.
- `lib/services/reviewer-identity-binding-writer.js` — one complete ETag-guarded person PATCH after transition validation; first production caller is live in acceptance-drain self-report
- `lib/services/capture-self-reported-orcid.js` — stable acceptance events use the binding writer with the event identity (`boundAt`/`resolvedAt`) truncated to Dataverse second precision (DateTime columns drop fractional seconds on round-trip, so a job retry must replay as an exact no-op); only typed `legacy_classification_required` falls back to the transitional person writes, and contact fill follows person persistence

### Shared-person identity/contact monotonicity

The person row is shared across requests. The compatibility writer in
`lib/dataverse/adapters/researcher.js` therefore treats automated decisions
monotonically: `confirmed` is sticky; `probable` is not downgraded by
unresolved/ambiguous evidence; a probable refresh requires overlapping trusted
anchors; and a binding conflict abstains rather than overwriting. Automated
confirmed input is capped at probable unless it entered through the dedicated
binding-writer authority. Legacy rows do not carry field-level lineage, so
`clearIdentityFields` now deliberately abstains instead of destructively
clearing shared identity fields. Every compatibility transition is
ETag-guarded; conflicts require a fresh read/retry.

## Cross-system

| Source | Mapping |
|---|---|
| Postgres `researchers` | Migrates 1:1 by email match — produces the identity half of the new model |
| Dataverse `contacts` | Promoted on first outreach via `wmkf_contact` lookup; AppendTo permission granted 2026-05-01 |
| ~~Dataverse `wmkf_appresearcher`~~ | **DROPPED S213** — bibliometric snapshots folded onto this entity (see Key fields) |
| Vendor `akoya_requests.wmkf_potentialreviewer1..5` | Legacy per-proposal slots (not the canonical link — those are in `wmkf_appreviewersuggestion`) |

## Blocked cleanup proposal

The S136 plan treated this entity as scratch/history and proposed a one-shot
post-pilot delete of “unengaged” people. That proposal is a **stale conflict and
is blocked pending an owner retention decision**. Current Finder save, identity
reuse, enrichment, board-writeup, and contact-link flows treat
`wmkf_potentialreviewers` as the canonical reusable reviewer-person store. The
caller audit proves the inherited bulk-delete proposal is unsafe to run as
written; it does not establish a permanent retention policy. No inherited
cleanup plan may delete rows from this entity without a new caller audit,
relationship probe, and owner-approved retention policy.

## Migration disposition (live source of truth for reviewer identity)

Already the live source of truth for reviewer identity. Dataverse
`wmkf_potentialreviewers` had 4,427 rows at the 2026-07-26 probe, including
historical and post-cutover writes. The old engagement-based bulk-delete proposal
is blocked in its current form; any future retention work requires an owner
decision and must preserve current person reuse and relationship semantics.

## Open questions / gotchas

- Dataverse `wmkf_potentialreviewers` currently has 4,427 rows, much larger than the dropped Postgres `researchers` 331-row historical pool. Per the migration plan: don't import researchers in bulk — engagement-history approach replaces the bulk-import pattern.
- `wmkf_contact` lookup population is a mutable live-state question; re-probe it
  before contact-promotion or retention work.
- The table is per-person (email is the dedupe key and `upsertByEmail` is
  idempotent). Native `akoya_request.wmkf_potentialreviewer1..5` lookups are a
  separate per-request representation; whether every modern assignment co-writes
  those slots is currently **UNKNOWN** and must not be assumed.
