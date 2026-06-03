# Intake Portal & Pilot Schema Changes — Audit Catalog

Per `project_dataverse_creator_privileges.md` (2026-05-06), Connor delegated entity/field creation authority to Justin/Claude for pilot-scope work under a summary-after model. This file is the running catalog of every Dataverse change made under that delegation.

**Conventions:**
- One section per change batch, newest first.
- Each entry: date, scope, list of entities/fields/choices, rationale, status.
- Pilot-scope only. Out-of-scope (vendor entity restructures, AkoyaGo-affecting changes) still requires explicit Connor sign-off.

---

## 2026-06-02 — Reviewer Identity Resolver Phase 2 PR1: identity-decision fields (S214)

**Scope:** Six fields on `wmkf_potentialreviewers` holding the resolver's *current* identity verdict (`docs/REVIEWER_IDENTITY_RESOLVER_PHASE2_DESIGN.md` §2.5). Schema-as-code: `lib/dataverse/schema/wave6/03_wmkf_potentialreviewers_identity.json`.

**Rationale:** The deterministic identity resolver classifies each reviewer (confirmed/probable/ambiguous/unresolved/rejected); this status is the single gate for whether identity-bearing fields persist or count toward ranking. Stored on the person (Dataverse = reviewer-identity ground truth).

### New fields
- `wmkf_identitystatus` (String 20) — confirmed | probable | ambiguous | unresolved | rejected
- `wmkf_identityconfidenceband` (String 10) — high | medium | empty
- `wmkf_identityresolverversion` (String 30)
- `wmkf_identityresolvedat` (DateTime)
- `wmkf_identityevidencesummary` (String 2000)
- `wmkf_identityverifiedanchorsjson` (Memo 50000) — compact JSON of verified anchors

Strings (not Picklists) for status/band: lower deploy risk + consistent with the existing `wmkf_emailsource`; the resolver (`lib/services/reviewer-identity-resolver.js`) enforces valid values in code.

**Status: ⚠ DEPLOY PENDING.** Dry-run against prod was CLEAN (collision-free, all 6 additive). `--execute` was repeatedly blocked by a 429 `0x80071151` — "another [Import] running" — which a live `importjobs` probe confirmed is a **rolling Microsoft managed-solution update wave** (`msdyn_URModernAdminBase`, then `msdynce_EmailTemplateConfigSolution`, …), NOT WMKF work and NOT our error. Zero partial state (fails on field #1; idempotent). **Deploy once the Microsoft update window clears:** `node scripts/apply-dataverse-schema.js --target=prod --wave=6 --execute` (re-checks existing wave6 fields as `· exists`, creates the 6 identity fields). PR1 threading/write-gates are blocked on this deploy.

## 2026-05-31 — Request Workbench Phase 0: `wmkf_appreviewersuggestion.wmkf_applicantdisposition` (S208)

**Scope:** One local Picklist field on `wmkf_appreviewersuggestion`. Deployed via `apply-dataverse-schema.js --target=prod --wave=6 --execute` against prod. New wave directory (`lib/dataverse/schema/wave6/`).

**Rationale:** Request Workbench Phase 0 (`docs/REQUEST_WORKBENCH_BUILD_PLAN.md`) unifies applicant-recommended and applicant-excluded reviewers onto the existing per-(person, request) engagement junction `wmkf_appreviewersuggestion`. A single picklist distinguishes them from the normal staff/Claude-discovered candidate (null). Per-request scoped **by construction** — the disposition lives only on the junction row, never on the global `wmkf_potentialreviewer` person, so a reviewer excluded by one applicant stays eligible/enrichable for every other request. Replaces the idea of a parallel child table (human-legibility schema principle: expand enums on existing entities, don't proliferate tables).

### New field

| Schema name | Logical name | Type | Options | Notes |
|---|---|---|---|---|
| `wmkf_ApplicantDisposition` | `wmkf_applicantdisposition` | Picklist (local optionset) | `Recommended=100000000`, `Excluded=100000001` (null = staff/Claude-discovered, the normal case) | `excluded` rows also written `wmkf_selected=false`. Read-filter convention `notExcludedFilter()` = `(… eq null or … ne 100000001)` — the `eq null or` is load-bearing (Dataverse drops rows whose filter evaluates to null). `findById` + both token-mint paths fail closed on excluded. |

**Verification:** Dry-run then `--execute`; re-run reports `· exists` (idempotent). Live metadata probe confirmed the optionset: `100000000=Recommended`, `100000001=Excluded`. Entity now carries 77 `wmkf_`-prefixed attributes (108 total incl. virtual `*name` denorms).

**Status:** DEPLOYED to prod 2026-05-31. Atlas: `docs/atlas/dataverse-wmkf-appreviewersuggestion.md` (Applicant disposition section + read convention).

---

## 2026-05-28 — BILL chunk 1: `wmkf_appreviewersuggestion.wmkf_HonorariumRequest` (Connor)

**Scope:** One Lookup field on `wmkf_appreviewersuggestion`. Created by Connor outside the `apply-dataverse-schema.js` flow; logged here for catalog continuity.

**Rationale:** Resolves the BILL honorarium integration's only blocking schema dependency (chunk 1 in `docs/BILL_HONORARIUM_INTEGRATION_DESIGN.md`). The portal-extension slice (chunk 4) PATCHes this lookup at honorarium-request create time so the junction → honorarium link is captured at the moment we know it, instead of being lost forever. Closes the "ghost honorarium" data-quality issue (Amy's #1002764 → grant #1002238 had no DB link).

Host-entity history: Connor's 2026-05-26 decision said "junction." An earlier draft of the BILL doc rendered that as `wmkf_potentialreviewer`, which is the per-person record (4,267 rows) and NOT the per-engagement junction. Reconfirmed S196 2026-05-28 that "junction" = `wmkf_appreviewersuggestion` (336 rows). BILL doc terminology drift was patched in the same session.

**Changes:**

### `wmkf_appreviewersuggestion` — honorarium-request linkage

| Schema name | Logical name | Type | Target | Required | Notes |
|---|---|---|---|---|---|
| `wmkf_HonorariumRequest` | `wmkf_honorariumrequest` | Lookup | `akoya_request` | None (nullable) | Populated by portal at honorarium-request create. No backfill. Companion virtual `wmkf_HonorariumRequestName` (String) auto-generated by Dataverse. |

**Verification:** Live `LookupAttributeMetadata` GET on prod confirmed `Targets=[akoya_request]`, `RequiredLevel.Value=None`. Throwaway probe (run-and-delete).

**Status:** DEPLOYED to prod 2026-05-28 by Connor.

---

## 2026-05-28 — Request Workbench prep: `wmkf_appreviewersuggestion.wmkf_completedat` (S196)

**Scope:** One DateTime field on `wmkf_appreviewersuggestion`. Deployed via `apply-dataverse-schema.js --wave=5 --execute` against prod. New wave directory (`lib/dataverse/schema/wave5/`) opened to separate Request Workbench prep from intake-portal work.

**Rationale:** The Request Workbench (S195 design reframe, scoped in S196) needs a per-engagement "PD has closed this out" signal so the PD dashboard can filter `wmkf_reviewstatus != complete` and show "closed out N days ago." The existing `wmkf_reviewstatus` picklist already has a `complete` value (100000004) that was previously unused (Connor confirmed S196) — the Workbench claims it for "PD has read the review and is done paying attention" semantics. The new `wmkf_completedat` field pairs with that state, closing the only transition on the row that previously had no paired timestamp (existing pattern: `emailsentat`, `materialssentat`, `responsereceivedat`, `reviewreceivedat`, `thankyousentat`).

Distinct from `wmkf_reviewreceivedat`: that field marks when the *reviewer* submitted (payment-eligibility signal for Steph); `wmkf_completedat` marks when the *PD* finished processing.

**Changes:**

### `wmkf_appreviewersuggestion` — Workbench closeout timestamp

| Schema name | Logical name | Type | Required | Notes |
|---|---|---|---|---|
| `wmkf_CompletedAt` | `wmkf_completedat` | DateTime | None (nullable) | Set by the Request Workbench when PD clicks "Close out." No PA / no downstream automation reacts to it; pure record-keeping + dashboard surface. |

**Verification:** Live metadata GET on `EntityDefinitions(LogicalName='wmkf_appreviewersuggestion')/Attributes?$filter=LogicalName eq 'wmkf_completedat'` confirmed `AttributeType=DateTime, IsCustomAttribute=true`. Throwaway verification script (run-and-delete pattern).

**Companion schema work (Connor-owned, not in this deploy):** `wmkf_HonorariumRequest` lookup on the same entity (`wmkf_appreviewersuggestion`), target `akoya_request`, optional. Confirmed host entity with Connor S196 — supersedes the prose in `docs/BILL_HONORARIUM_INTEGRATION_DESIGN.md` lines 126/225, which referred to `wmkf_potentialreviewer` due to terminology drift. The BILL doc should be patched separately.

**Status:** DEPLOYED to prod 2026-05-28.

---

## 2026-05-22 — Slice-0 followup: `contact.wmkf_portaloid` + alternate key (S179, drain plan v7 P2)

**Scope:** One nullable string column + one alternate key on the OOB `contact` entity. Mini-deploy through `apply-dataverse-schema.js --wave=4-followup` (the `parseArgs` parser was extended to accept string-suffixed wave names so this fresh wave directory doesn't re-run wave 4 specs).

**Rationale:** The forthcoming applicant-portal auth bridge (`lib/services/contact-bridge-service.js`) reads `session.user.contactOid` (Entra External ID `oid` claim) and resolves it to a Dataverse `contact` row. Without a dedicated column and a uniqueness constraint, the bridge would have to fall back to less reliable joins (email + lookup race-prone) and there would be no Dataverse-side defense against two portal contacts sharing the same OID. The alternate key is the Dataverse-side belt-and-suspenders behind the application-side guard.

**Changes:**

### `contact` — applicant-portal OID column + alt-key

| Schema name | Logical name | Type | Length | Required | Notes |
|---|---|---|---|---|---|
| `wmkf_PortalOid` | `wmkf_portaloid` | String | 50 | None (nullable) | Entra External ID `oid` claim; set by auth bridge on first login; nullable so non-portal contacts (donors, foundation liaisons, etc.) are unaffected. |

| Alt-key schema | Key attributes | Initial state |
|---|---|---|
| `wmkf_portaloid` | `[wmkf_portaloid]` | `EntityKeyIndexStatus=Pending`; transitions to `Active` async over a few minutes once Dataverse finishes building the unique index. Uniqueness is NOT enforced until `Active` — re-probe before the auth-bridge build relies on it. |

**Naming convention reconciliation:** v7 draft text said `wmkf_portal_oid` (snake_case) and alt-key `wmkf_PortalOid_AlternateKey`. Deployed names dropped the internal underscore (matches the S178 `wmkf_portal_membership` → `wmkf_portalmembership` rename and the broader no-internal-underscore convention on `wmkf_*` logical names) and shortened the alt-key name to match the wave-2 single-column alt-key precedent (alt-key schema name = key column name). The plan was updated post-deploy to reflect the actual deployed names.

**Verification:** `node scripts/verify-p2.mjs` (throwaway, run-and-delete) hit the live metadata API and confirmed both artifacts present with expected shape. Re-check the alt-key state later with a fresh GET on `EntityDefinitions(LogicalName='contact')/Keys`.

**Status:** DEPLOYED to prod 2026-05-22. Drain plan v7 P2 checklist item ✓.

---

## 2026-05-14 — Schema review w/ Connor — decisions superseding 2026-05-13 entries

**Scope:** Live schema-decision walkthrough with Connor. Established "human-legibility over normalization purity" as the governing principle (memory `feedback_human_legibility_schema_principle`). Multiple proposed new entities collapsed into extensions of existing ones; live Dataverse probe found existing fields covering 3 of 4 proposed aggregate additions.

**Status:** Decisions locked; JSON specs not yet written. **Schema slice deploy blocked on Item 6** (drain-vs-PA write conflict on aggregate fields) until that decision is taken separately. Authoritative summary: `docs/BUDGET_FORM_SPEC.md` v3 top status block + `docs/INTAKE_PORTAL_SCHEMA_REVIEW_2026-05-14.md` outcome banner.

### Cost-share — unified into `wmkf_proposalbudgetline.wmkf_category` enum

The 2026-05-13 plan to create `wmkf_proposalcostshare` as a separate entity is **withdrawn.** Cost-share rows live in `wmkf_proposalbudgetline` via three new `wmkf_category` enum values:

- `WaivedIndirect`
- `WaivedTuition`
- `OtherCostShare`

Aggregate queries asking "what is WMKF being asked to fund?" must filter `wmkf_category NOT IN (WaivedIndirect, WaivedTuition, OtherCostShare)`. This is the forever-filter cost accepted in exchange for fewer obscure child tables.

Numeric integer values for the three new categories: **TBD pre-deploy** — reserve and document before the schema slice deploys (Codex feedback: too late to pick at deploy).

### `wmkf_proposalbudgetline` — three additions to 2026-05-13 shape

| Field | Type | Notes |
|---|---|---|
| `wmkf_rolecode` | Text(60) | Fixed rows only (`principal-investigators`, `consumable-supplies`, `facilities-overhead`); null for dynamic rows |
| `wmkf_headcount` | Whole Number | `wmkf_category = Personnel`; null otherwise |
| `wmkf_effortpct` | Whole Number (0–100) | `wmkf_category = Personnel`; null otherwise |

### Roster — extend `wmkf_apprequestperson`, do NOT create `wmkf_proposalroster`

The 2026-05-13 plan to create `wmkf_proposalroster` is **withdrawn.** Roster data lives in the existing `wmkf_apprequestperson` junction (S139, 5,561 rows). Slice 0 changes:

- Add three nullable fields: `wmkf_effortpct` (Whole 0–100), `wmkf_biosketchurl` (Text 500), `wmkf_lineorder` (Whole).
- Expand `wmkf_role` enum from 2 values (PI=100000000, Co-PI=100000001) to 5 by adding `Senior Personnel`, `Key Personnel`, `Other`. Reserve integer values pre-deploy.
- Existing readers `pages/api/reviewer-finder/contact-history.js`, `pages/api/reviewer-finder/generate-emails.js`, `pages/api/external/review/[token]/context.js`, and `scripts/acceptance-w4.js` filter `wmkf_role IN (PI, Co-PI)` to preserve current scope. Patched 2026-05-14.

### Aggregate fields on `akoya_request` — reuse existing where possible

Live Dataverse probe 2026-05-14: 577 attributes on `akoya_request`; 0 collisions on proposed-new names; 3 functional equivalents present.

| Aggregate | Field on `akoya_request` | Source |
|---|---|---|
| Year count | `wmkf_numberofyearsoffunding` (Picklist 1–5) | Existing — reuse |
| WMKF-requested total | `akoya_request` (Money, "Requested Amount") | Existing — reuse |
| Total project cost | `akoya_expenses` (Money, "Total Project Budget") | Existing — reuse |
| Cost-share total | `wmkf_totalothersources` (Money) | **NEW** — only net-new field |

Downstream patches landed 2026-05-14: `pages/api/grant-reporting/lookup-grant.js` no longer falls back to `akoya_request` as award amount when `akoya_grant` is null (drain-written requested amount would otherwise display as award amount on pre-decision records).

### `wmkf_portalmembership` — `wmkf_priordecisionstatus` add

| Field | Type | Notes |
|---|---|---|
| `wmkf_priordecisionstatus` | Choice (null / Rejected / Revoked / Approved) | Snapshot prior `wmkf_approvalstatus` on re-application; clear back to null on next decision |

### Numeric integer values reserved (pre-deploy)

Microsoft custom option-set convention: values start at `100000000` and increment by 1 within a single option set. Reserved 2026-05-14 (S150) so the JSON specs can be written with stable integers and Atlas reads identically across consumers. **Do not renumber after slice 0 deploys** — third-party consumers (Connor's PAs, drain guards, packet builder) will hardcode these.

**`wmkf_proposalbudgetline.wmkf_category`** (new option set, 10 values total):

| Integer | Label | Class |
|---|---|---|
| `100000000` | `Personnel` | WMKF-spend |
| `100000001` | `Equipment` | WMKF-spend |
| `100000002` | `Supplies` | WMKF-spend |
| `100000003` | `Travel` | WMKF-spend |
| `100000004` | `Other Direct` | WMKF-spend |
| `100000005` | `Tuition` | WMKF-spend |
| `100000006` | `Indirect` | WMKF-spend (reserved, always $0) |
| `100000007` | `Waived Indirect` | Cost-share |
| `100000008` | `Waived Tuition` | Cost-share |
| `100000009` | `Other Cost Share` | Cost-share |

> **`Tuition` added at `100000005` 2026-05-22 (S178, Justin decision)** — net-new WMKF-spend direct-cost category; the cost-share block (`Waived Indirect` / `Waived Tuition` / `Other Cost Share`) and `Indirect` shifted up by 1. Done **pre-deploy**, so the "do not renumber" rule above is not yet in force — slice 0 has not been applied. After deploy this table is frozen.
> **Labels normalized to spaced form 2026-05-18 (S163, Justin decision)** — resolves the prior camelCase-vs-spaced inconsistency with the WMKF-spend labels; this table stays the verbatim source for `wmkf_proposalbudgetline.json`'s option labels. Filter-predicate shorthand elsewhere (`wmkf_category NOT IN (WaivedIndirect, …)` in BUDGET_FORM_SPEC / ITEM_6 / this doc's lines 22-26) still uses the old camelCase tokens — those are **integer-backed category references, not the display label**, and the integers are authoritative for every guard, so they are intentionally left as semantic shorthand.

WMKF-spend aggregate queries filter `wmkf_category NOT IN (100000007, 100000008, 100000009)`. Cost-share aggregate (`wmkf_totalothersources`) uses the inverse `IN` set.

**`wmkf_apprequestperson.wmkf_role`** (existing option set, extending from 2 → 5 values):

| Integer | Label | Status |
|---|---|---|
| `100000000` | `PI` | Existing (preserved) |
| `100000001` | `Co-PI` | Existing (preserved) |
| `100000002` | `Senior Personnel` | **NEW** |
| `100000003` | `Key Personnel` | **NEW** |
| `100000004` | `Other` | **NEW** |

Existing readers (contact-history, generate-emails, external review context, acceptance-w4) already filter `wmkf_role IN (100000000, 100000001)` per the 2026-05-14 source-scope patch, so the enum expansion is non-breaking by construction.

**`wmkf_portalmembership.wmkf_priordecisionstatus`** (new option set, 3 values; field is nullable so "no prior decision" is represented by absence, not a fourth value):

| Integer | Label |
|---|---|
| `100000000` | `Rejected` |
| `100000001` | `Revoked` |
| `100000002` | `Approved` |

### Outstanding pre-deploy

- **Item 6 — drain-vs-PA aggregate write conflict.** Decision locked 2026-05-14 as A+B hybrid; rule-exception edit landed S150 (`INTAKE_PORTAL_DESIGN.md` § "Power Automate boundary" → "Exception — intake portal aggregate fields on `akoya_request`"). **Updated 2026-05-18 (S163, corrected post-Codex): Item 6 gate SHRANK to one open pre-deploy item — P1-Update.** Connor's S162 ruling dissolved P2 + P1-Delete (no Delete trigger) and P3 landed S150, but the residual **P1-Update** — does the parent-status trigger filter bind/fire on a `statecode`-only deactivation Update — is **unverified** and **remains a pre-deploy gate** (an earlier S163 draft wrongly called it "the docs' clean case, post-deploy"; that was a Codex-flagged overstatement, now corrected). Clearable only by Connor maker-portal validation **or** an explicitly recorded team risk waiver — neither has happened. The old "Tests 1+2 (Connor — pending) gate slice 0" framing is superseded by this narrower one-item gate — see `INTAKE_PORTAL_ITEM_6_DISCUSSION.md` § 0 "Update 2026-05-18 (S163)" + `INTAKE_PORTAL_DESIGN.md` § "Power Automate boundary" → "Preconditions — current model" for the authoritative status + the corrected Option B drain lifecycle.
- ~~**`submission_jobs` migration** — missing from `005_intake_portal.sql`; add `009_submission_jobs.sql` before slice 0.~~ Landed S150 as `lib/db/migrations/009_submission_jobs.sql` (+ V30 inline block in `scripts/setup-database.js`). Table not yet applied to prod — runs with the slice 0 deploy.
- ~~**Numeric integer values for new enum entries**~~ — reserved S150, see above. Transcribe to new `dataverse-wmkf-proposalbudgetline.md` Atlas page at slice 0 + amend `dataverse-wmkf-portalmembership.md` (if created) / inline note in design doc otherwise.
- ~~**Live-probe verification of `wmkf_apprequestperson.wmkf_role` before deploy.**~~ **Verified CLEAR 2026-05-15 (S155).** Both the option-set definition and live row data were probed: definition has exactly 2 values (PI=`100000000`, Co-PI=`100000001`); live data distribution is 4,488 PI + 1,073 Co-PI = 5,561 rows with **zero** rows occupying `100000002`–`100000004`. Slice 0's enum extension is non-breaking on this axis. **Correct tool is `node scripts/probe-apprequestperson-role-data.js`** (definition + row-data probe, exit 0=CLEAR / 3=BLOCK / 1=ERROR) — *not* `scripts/dynamics-schema-diff.js`, which is a Dynamics-Explorer annotation-coverage diff that cannot target `wmkf_apprequestperson` (not in `TABLE_ANNOTATIONS`) and never inspects row data. **Re-run the probe at deploy time (target 2026-05-19)** — live data can change between now and then; the CLEAR result is point-in-time, not durable. (`scripts/probe-picklist.js wmkf_apprequestperson.wmkf_role` covers the definition half alone if only that is needed.)
- ~~**Attribute-name collision check on existing entities** (`akoya_request` + `wmkf_apprequestperson`).~~ **Verified CLEAR 2026-05-18 (S163)** via `scripts/probe-slice0-attr-collision.mjs` (read-only metadata GET — NOT a Connor/`Get-CrmEntityAttributes` dependency; the `INTAKE_PORTAL_SCHEMA_REVIEW_2026-05-14.md` § "Connor runs it" framing is superseded). Net-new surface is 1 field on `akoya_request` (`wmkf_totalothersources`; the other two aggregates reuse existing AkoyaGO fields) + 3 on `wmkf_apprequestperson` (`wmkf_effortpct`/`wmkf_biosketchurl`/`wmkf_lineorder`) — all clear against 577 / 35 live attrs respectively. Re-run at deploy (point-in-time).
- **Atlas pages:** new `docs/atlas/dataverse-wmkf-proposalbudgetline.md`; amend `docs/atlas/dataverse-wmkf-apprequestperson.md` for new fields + expanded enum (apprequestperson page amended S150 for the expanded enum; new-fields amendment lands at slice 0).
- **Form mapping `shared/forms/phase-ii-research-2026-06/map-to-dynamics.js`** — entity targets resolved 2026-05-14; remaining markers now flagged `blockedOn: 'item-6'`.
- **Drain server-side validation** — must reject negative `wmkf_amount` Money values per row before `createRecord` (Dataverse won't enforce). Add to drain implementation slice (downstream of Item 6).

---

## 2026-05-13 — Intake portal pilot — three entities queued (Connor sync, Track 1)

**Scope:** Three new pilot entities approved in shape during the 2026-05-13 Connor+Sarah sync. Two are confirmed for pilot; one is narrowed-scope replacement of the 2026-05-06 plan.

**Status:** Queued — JSON specs to be drafted by Justin/Claude under `lib/dataverse/schema/intake/` for Connor design review by **2026-05-15**. Apply to prod by **2026-05-18** (idempotent reruns + 30s-backoff retry per recent gotchas). Names below are working — naming alignment with the 2026-05-06 suggestions (`wmkf_budgetline` / `wmkf_personnel`) is itself an open question for Connor's review.

### `wmkf_portalmembership` — contact ↔ account join with approval state

Shape approved 2026-05-13 as drafted in `INTAKE_PORTAL_DESIGN.md` "One new entity" section. No changes from the 2026-05-06 baseline. Institution-claim approval workflow lives portal-side at `/apply/admin/memberships` (Option A); Connor's PA is not on the approval path.

### `wmkf_proposalbudgetline` (working name) — budget rows child of `akoya_request`

| Attribute | Type | Notes |
|---|---|---|
| `wmkf_proposalbudgetlineid` | PK | |
| `wmkf_name` | Text(160) | Synthesized: `Y{year} — {category}: {description}` |
| `_wmkf_request_value` | Lookup → `akoya_request` | Parental, cascade delete |
| `wmkf_year` | Whole number (1–10) | Int, not Choice (forward-compatible across program lengths) |
| `wmkf_category` | Choice | Pilot values: Personnel, Equipment, Supplies, Travel, Other Direct, Tuition, Indirect (reserved) — full 10-value set + cost-share above |
| `wmkf_description` | Text(500) | Line-item description |
| `wmkf_amount` | Money (USD) | |
| `wmkf_lineorder` | Whole number | Display order within `(request, year, category)` |

### `wmkf_proposalroster` (working name) — co-PI + key personnel child of `akoya_request`

Shape not yet sketched — to be drafted alongside `wmkf_proposalbudgetline` for Connor's 2026-05-15 review. Working assumptions: 1:N parental from `akoya_request`; per-row contact lookup + role choice (PI / Co-PI / Senior Personnel / Key Personnel / Other) + percent effort + optional biosketch attachment reference. Shape should align with the existing `wmkf_apprequestperson` junction's role taxonomy where possible.

### Deferred (was in 2026-05-06 plan, dropped to next cycle)

- **`wmkf_milestone`** — captured as narrative field on `akoya_request` for pilot.
- **`wmkf_priorsupport`** — captured as attached PDF for pilot.

Both expand to real child entities post-pilot. Narrowing the 2026-05-06 set keeps schema work to two entities in the 20-day pilot window.

### Outstanding before specs are written

- Connor weighs in on the `wmkf_proposalbudgetline` vs. `wmkf_budgetline` naming (and `wmkf_proposalroster` vs. `wmkf_personnel`).
- Connor confirms the category Choice values for `wmkf_proposalbudgetline.wmkf_category` match WMKF Research conventions.
- Cover-doc template structure (Connor's PA reads the rows + populates a Word template grouped by year + category) — drives whether we need a synthesized `wmkf_name` or PA assembles its own display strings.
- Sarah's Phase II Research field inventory (Track 2 carryover from 2026-05-13) — confirms whether budget + roster are the only repeating sections worth structuring for pilot.

---

## 2026-05-07 — Workflow-chaining fields on `akoya_request` + Field Set B (deployed, Justin/Claude)

**Scope:** 6 workflow-chaining `wmkf_ai_*` fields + 22 Field Set B fields on `akoya_request` (28 total). Deployed to prod 2026-05-07 in a single batch via `lib/dataverse/schema/wave2-existing/akoya_request-ai-extensions.json`. Closes Q5 in `docs/archive/CONNOR_QUESTIONS_2026-04-15.md` and the Field Set B skeleton entry below.

**Status:** Live in prod. All 28 attributes confirmed via `apply-dataverse-schema.js --target=prod --wave=2 --execute` (idempotent rerun shows `· exists` on all).

| Field | Type |
|---|---|
| `wmkf_ai_keywords` | Memo (JSON array) |
| `wmkf_ai_methodologies` | Memo (JSON array) |
| `wmkf_ai_riskflags` | Memo (JSON array) |
| `wmkf_ai_teaminfo` | Memo (JSON) |
| `wmkf_ai_budgetsummary` | Multi-line text |
| `wmkf_ai_timeline` | Multi-line text |

Field names normalized to `wmkf_ai_*` no-underscore-after-prefix convention (per v3 spec naming rule), so `wmkf_ai_risk_flags` → `wmkf_ai_riskflags`, etc.

---

## 2026-05-07 — Echo-prompt parity oracle row in `wmkf_ai_prompt` (planned, Justin/Claude)

**Scope:** Single seeded `wmkf_ai_prompt` row that echoes its inputs as outputs. Approved by Connor 2026-05-07 as a parity test oracle: both Vercel `executePrompt()` and the upcoming PA-side `ExecutePrompt` child flow should produce byte-identical `wmkf_ai_run` rows for identical inputs. Cheap drift-detector across the two Executor implementations.

**Status:** Not yet seeded. No new schema — just a new row in the existing `wmkf_ai_prompt` table.

**Naming proposal:** `executor.echo-parity` (`<domain>.<purpose>` per `project_prompt_storage_strategy.md`).

---

## 2026-05-07 — `wmkf_apprequestperson` junction (planned, Justin/Claude to deploy)

**Scope:** Net-new junction entity tracking PI/co-PI participation across `akoya_request` history. Resolves the S136 lock (`project_reviewer_postgres_to_dataverse_migration.md`) and Connor's 2026-05-07 sign-off on vendor-data junctions.

**Status (2026-05-07):** Schema deployed to prod (`lib/dataverse/schema/wave2/wmkf_app_request_person.json` applied via `apply-dataverse-schema.js --target=prod --wave=2 --execute`). Entity, both attrs, both lookups, and alt key all confirmed live. Backfill script not yet written.

Deploy hit Dataverse 429 throttling between metadata customizations (concurrent `EntityCustomization` lock). The apply script is idempotent so a 30s-backoff retry loop completed it cleanly. Future schema deploys should expect the same — bake retry-with-backoff into any wrapper script.

**Schema:**
- `wmkf_request` — Lookup → `akoya_request`
- `wmkf_contact` — Lookup → `contact`
- `wmkf_role` — Choice: `pi | copi`
- `wmkf_authorposition` — Whole number, optional (0 for PI; 1–5 for legacy co-PI slot of origin)
- Alt key: `(wmkf_request, wmkf_contact, wmkf_role)`
- Ownership: OrganizationOwned

**Population:**
- One-time backfill (`scripts/backfill-request-person-junction.js`) — walks every `akoya_request`, emits ~3,000 rows. Justin/Claude.
- Ongoing sync — **Connor's net-new PA flows** on `akoya_request` create/update. PA flows create `contact` records as needed and write junction rows directly.
- **`_wmkf_projectleader_value` (PI lookup) stays live** — used by other flows unrelated to reviewers. PA flows dual-write (projectleader field + junction `pi` row). Only the **co-PI slots** (`_wmkf_copi1..5_value`) become obsolete read-only legacy data post-migration.

**Read-side strategy (steady state, revised 2026-05-07):** `/api/reviewer-finder/contact-history` UNIONs junction rows (role = pi OR copi) with `akoya_request._wmkf_projectleader_value` matches. Not a fallback — projectleader stays authoritative for PI in parallel with the junction. Avoids transition-window failure modes (junction stale on a projectleader-only update, or vice versa).

---

## 2026-05-07 — `wmkf_expertise` Memo on `systemuser` (created by Connor)

**Scope:** New Memo field `wmkf_expertise` on `systemuser` for Program Director expertise descriptions (e.g., "organic chemistry, materials science, catalysis"). Created by Connor (vendor-entity addition outside delegated scope, but included in this catalog for completeness).

**Status:** Live. Swap-out of hardcoded PD GUIDs/expertise in PA + Vercel prompts is downstream and not yet scheduled.

**Note:** Field name collides nominally with the planned `wmkf_expertise` column on `wmkf_app_expertise_roster` (per `docs/POSTGRES_TO_DATAVERSE_MIGRATION.md`). No conflict — Dynamics scopes custom field names per entity.

---

## 2026-05-07 — Field Set B (Grant Report Extraction) skeleton — SUPERSEDED

**Status:** Deployed as part of the combined batch in the "Workflow-chaining fields on `akoya_request` + Field Set B" entry above. Field shapes below preserved for diff-reference; refer to `lib/dataverse/schema/wave2-existing/akoya_request-ai-extensions.json` for the live spec.

**Counts (Whole number, nullable):**
- `wmkf_ai_reportpostdocs`
- `wmkf_ai_reportgradstudents`
- `wmkf_ai_reportundergrads`
- `wmkf_ai_reportpubstotal`
- `wmkf_ai_reportpubspeerreviewed`
- `wmkf_ai_reportpubsnonpeerreviewed`
- `wmkf_ai_reportpatentsawarded`
- `wmkf_ai_reportpatentssubmitted`

**Multi-line text:**
- `wmkf_ai_reportadditionalfunding`
- `wmkf_ai_reportprojectimpacts`
- `wmkf_ai_reportawardsandhonors`
- `wmkf_ai_reportimplications`
- `wmkf_ai_reportoutcomesummary`
- `wmkf_ai_reportgoalsassessment` (JSON payload — full per-goal breakdown)
- `wmkf_ai_reportnotesforstaff`

**Publication fields (flat, not JSON — Connor 2026-05-07):**
- `wmkf_ai_reportpub1citation` (Multi-line text)
- `wmkf_ai_reportpub1abstract` (Multi-line text)
- `wmkf_ai_reportpub1source` (Single-line text)
- `wmkf_ai_reportpub2citation` (Multi-line text)
- `wmkf_ai_reportpub2abstract` (Multi-line text)
- `wmkf_ai_reportpub2source` (Single-line text)

**Choice:**
- `wmkf_ai_reportoverallrating` — `successful` / `mixed` / `unsuccessful` (Connor 2026-05-07: fine as a starting set; full rating mechanism not yet spec'd, expect iteration).

**Provenance:** All runs writing these fields log to `wmkf_ai_run` with `wmkf_ai_tasktype = 682090001` (Report).

---

## 2026-05-09 — Reviewer Stage 2a slice 1 (S143)

**Driver:** `docs/REVIEWER_STAGE_2A_BUILD_PLAN.md` slice 1 — Stage 2a invitation-landing page (pre-materials).

**Wave:** 3 (`lib/dataverse/schema/wave3/`).

### New entities

- **`wmkf_policy`** (parent — policy slot) — primary name `wmkf_code`, alt-key on code, lookup `wmkf_activeversion` → `wmkf_policyversion`. General-purpose slot library; first uses are `reviewer-coi` and `reviewer-ai-use`.
- **`wmkf_policyversion`** (child — versioned text) — primary name `wmkf_versionlabel`, lookup to parent `wmkf_policy`, `wmkf_policytitle` + `wmkf_policybody` (Memo) + `wmkf_effectivedate`. Each row immutable once referenced by an engagement row.

Atlas: `docs/atlas/dataverse-wmkf-policy-and-policy-version.md`.

### New fields on `wmkf_appreviewersuggestion`

Engagement-scope contact corrections (write target for Stage 2a self-confirmations; never propagated to `wmkf_potentialreviewers` or `contact`):
`wmkf_reviewerfirstname`, `wmkf_reviewerlastname`, `wmkf_reviewernickname`, `wmkf_reviewertitle`, `wmkf_revieweremail`, `wmkf_reviewerorcid`.

Decline structured capture:
`wmkf_declinereason` (Memo, was the locked-S136 field), `wmkf_declinereasonpicklist` (Picklist 5 options), `wmkf_declinereferral` (Memo).

State stamps:
`wmkf_honorariumoptout` (Boolean), `wmkf_withdrawnsufficientat` (DateTime), `wmkf_coiackedat` + `wmkf_aiuseackedat` (DateTime).

Policy ack lookups (pin to exact `wmkf_policyversion` row):
`wmkf_coipolicyversion` (Lookup), `wmkf_aiusepolicyversion` (Lookup).

### Picklist extension

`wmkf_appreviewersuggestion.wmkf_responsetype`: added `withdrawn_sufficient = 100000003` via `scripts/extend-responsetype-picklist.mjs`.

### Native entity audit

Enabled `IsAuditEnabled = true` on `wmkf_appreviewersuggestion` via `scripts/enable-suggestion-audit.mjs` (PUT against EntityDefinitions endpoint with full body). Replaces a parallel `wmkf_reviewer_audit` entity that the plan originally proposed — uses Dataverse's native field-level before/after capture instead.

### Seed rows

`scripts/seed-stage2a-policies.mjs` creates two parents (`reviewer-coi`, `reviewer-ai-use`) plus one Active child each (`wmkf_versionlabel = 2026-05-09`). AI-use body lifts from review form footer; COI body uses an explicit `[PLACEHOLDER]` until staff feedback on wording lands. Idempotent — safe to re-run.

### Pending before slice 1 ships to a real cycle

- Replace the COI placeholder body with finalized staff-approved text (create new `wmkf_policyversion` row, flip `wmkf_activeversion`).
- Configure Dataverse security role to restrict delete privilege on `wmkf_policy` / `wmkf_policyversion` to admin role (per immutability rules §4a in build plan).
- Remaining slice-1 work: extend `/api/external/review/[token]/context` payload, build `/respond` endpoint, page composition rewrite (state-driven view dispatch on existing route).

