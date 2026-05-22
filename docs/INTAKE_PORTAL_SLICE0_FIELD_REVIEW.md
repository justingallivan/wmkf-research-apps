# Slice-0 Schema — Field Review for Connor

Pre-deploy review. Lists every field/entity that will be created on `--execute`, grouped by entity. Pulled verbatim from the deploy specs at `lib/dataverse/schema/wave4*/`. Reserved integer values are locked (per `docs/INTAKE_PORTAL_SCHEMA_CHANGES.md` 2026-05-14 entry) — flag anything you want changed BEFORE deploy.

**Four things land at deploy:**
1. New entity: `wmkf_proposalbudgetline` (budget rows)
2. New entity: `wmkf_portalmembership` (contact↔account join with approval state)
3. Three new fields on existing `wmkf_apprequestperson` (roster extensions)
4. One new field on existing `akoya_request` (`wmkf_totalothersources`)

Plus: option-set extension on `wmkf_apprequestperson.wmkf_role` (existing 2 values → 5; ships via standalone idempotent script, not as a wave entry).

---

## 1. New entity — `wmkf_proposalbudgetline`

Per-year, per-category budget rows. Child of `akoya_request` (parental, cascade delete). One row = one (request, year, category, line-item) tuple.

**Logical / Display:** `wmkf_proposalbudgetline` / "Proposal Budget Line"
**Schema name:** `wmkf_ProposalBudgetLine`
**Primary name attr:** `wmkf_Name` (max 160, required) — synthesized `Y{year} — {category}: {description}`

### Fields

| Schema name | Display | Type | Required | Range / Length | Notes |
|---|---|---|---|---|---|
| `wmkf_Year` | Year | Integer | ✅ | 1–10 | Program year (1-based) |
| `wmkf_Category` | Category | Picklist | ✅ | (see below) | 10-value option set |
| `wmkf_Description` | Description | String | — | max 500 | Free text line-item |
| `wmkf_Amount` | Amount | Money | — | 0 – 1,000,000,000 USD | One value per row |
| `wmkf_LineOrder` | Line Order | Integer | — | 0 – 100,000 | Display order within (request, year, category) |
| `wmkf_RoleCode` | Role Code | String | — | max 60 | Fixed-row discriminator (`principal-investigators`, `consumable-supplies`, `facilities-overhead`); null for dynamic rows |
| `wmkf_Headcount` | Headcount | Integer | — | 0 – 100,000 | Personnel-only (category=Personnel); null otherwise |
| `wmkf_EffortPct` | Effort % | Integer | — | 0 – 100 | Personnel-only; null otherwise |

### Picklist — `wmkf_Category` (reserved integers; DO NOT renumber post-deploy)

| Integer | Label | Class |
|---|---|---|
| `100000000` | Personnel | WMKF-spend |
| `100000001` | Equipment | WMKF-spend |
| `100000002` | Supplies | WMKF-spend |
| `100000003` | Travel | WMKF-spend |
| `100000004` | Other Direct | WMKF-spend |
| `100000005` | Tuition | WMKF-spend |
| `100000006` | Indirect | WMKF-spend (reserved, always $0) |
| `100000007` | Waived Indirect | Cost-share |
| `100000008` | Waived Tuition | Cost-share |
| `100000009` | Other Cost Share | Cost-share |

WMKF-spend aggregate filters `wmkf_Category NOT IN (100000007, 100000008, 100000009)`. Cost-share aggregate uses the inverse `IN` set, summed into `akoya_request.wmkf_totalothersources` (§4).

### Relationship — N:1 to `akoya_request`

- Schema: `wmkf_proposalbudgetline_request`
- Lookup attr: `wmkf_Request` (display "Request"), required
- **Cascade.Delete: Cascade** — deleting an `akoya_request` cascades delete to its budget lines (whole-proposal orphan cleanup only).
- 🟡 **Read this carefully:** the drain's post-submit-edit reconciliation **deactivates** obsolete rows (`statecode → Inactive`), it never hard-deletes them. The Item-6 recompute fires on that child Update and sums active children only. Cascade is for whole-request deletion (administrative path), not the drain.

---

## 2. New entity — `wmkf_portalmembership`

Contact↔account join with approval state. One row per (person, institution) pair regardless of approval state (alt key prevents duplicates). Re-applying after rejection updates the existing row.

**Naming:** logical name `wmkf_portalmembership` — no internal underscores, matching the sibling `wmkf_App*` convention (`wmkf_apprequestperson` etc.). An earlier draft used `wmkf_portal_membership`; renamed to the no-underscore form pre-deploy (S178, Justin decision), build plan + design + atlas updated in the same pass.

**Logical / Display:** `wmkf_portalmembership` / "Portal Membership"
**Schema name:** `wmkf_PortalMembership`
**Primary name attr:** `wmkf_Name` (max 200, required) — synthesized `{contact} @ {account} ({role})`

### Fields

| Schema name | Display | Type | Required | Notes |
|---|---|---|---|---|
| `wmkf_Role` | Role | Picklist | ✅ | 2 values (see below) |
| `wmkf_IsPrimary` | Is Primary | Boolean | — | Default `false`; flags official-comms contact for this (contact, account) pair |
| `wmkf_ApprovalStatus` | Approval Status | Picklist | ✅ | 4 values (see below) |
| `wmkf_PriorDecisionStatus` | Prior Decision Status | Picklist | — | Nullable (no 4th "none" value); 3 values |
| `wmkf_RequestedAt` | Requested At | DateTime | — | Date+time |
| `wmkf_ApprovedAt` | Approved At | DateTime | — | Date+time; null until approved |
| `wmkf_RejectionReason` | Rejection Reason | String | — | max 850; surfaced to applicant on rejection |

### Picklists

**`wmkf_Role`:**

| Integer | Label |
|---|---|
| `100000000` | Submitter |
| `100000001` | Contributor |

Submitter = institution-wide submit authority. Contributor = read/assist. Request-level allowed-submitters is a Phase 1 follow-up (not pilot).

**`wmkf_ApprovalStatus`:**

| Integer | Label |
|---|---|
| `100000000` | Rejected |
| `100000001` | Revoked |
| `100000002` | Approved |
| `100000003` | Requested |

`Approved` + `statecode` Active = live membership. 🟡 **Integer alignment with `wmkf_PriorDecisionStatus` is deliberate** — Rejected/Revoked/Approved share the same integers in both picklists so the re-application snapshot (current terminal → prior) is correct whether copied by label or by raw integer. Requested=100000003 has no prior equivalent.

**`wmkf_PriorDecisionStatus`:**

| Integer | Label |
|---|---|
| `100000000` | Rejected |
| `100000001` | Revoked |
| `100000002` | Approved |

Nullable. Snapshot of prior `wmkf_ApprovalStatus` on re-application.

### Relationships

| Kind | Schema | → Entity | Lookup attr | Display | Required |
|---|---|---|---|---|---|
| N:1 | `wmkf_portalmembership_contact` | `contact` | `wmkf_Contact` | Contact | ✅ |
| N:1 | `wmkf_portalmembership_account` | `account` | `wmkf_Account` | Account | ✅ |
| N:1 | `wmkf_portalmembership_requestedby` | `contact` | `wmkf_RequestedBy` | Requested By | — |
| N:1 | `wmkf_portalmembership_approvedby` | `systemuser` | `wmkf_ApprovedBy` | Approved By | — |

### Alternate key

`wmkf_contact_account` over (`wmkf_contact`, `wmkf_account`) — prevents duplicate (person, institution) pairs.

---

## 3. New fields on existing `wmkf_apprequestperson`

Three nullable additions for roster extension. Existing entity (5,561 rows as of S139).

| Schema name | Display | Type | Range / Length | Notes |
|---|---|---|---|---|
| `wmkf_EffortPct` | Effort % | Integer | 0 – 100 | Percent effort for this person on this request |
| `wmkf_BiosketchUrl` | Biosketch URL | String | max 500 | Reference URL to attachment |
| `wmkf_LineOrder` | Line Order | Integer | 0 – 100,000 | Display order within the request's personnel list |

### Plus: `wmkf_role` enum extension (ships via separate script)

Existing picklist extends from 2 → 5 values:

| Integer | Label | Status |
|---|---|---|
| `100000000` | PI | Existing (preserved) |
| `100000001` | Co-PI | Existing (preserved) |
| `100000002` | Senior Personnel | **NEW** |
| `100000003` | Key Personnel | **NEW** |
| `100000004` | Other | **NEW** |

🟢 Live-data probe 2026-05-15 confirmed slots 100000002–100000004 unoccupied (re-run at deploy via `scripts/probe-apprequestperson-role-data.js`). Existing readers already filter `wmkf_role IN (PI, Co-PI)`, so the expansion is non-breaking by construction.

---

## 4. New field on existing `akoya_request`

One net-new field (other slice-0 aggregates reuse existing AkoyaGO fields — `akoya_request` = WMKF requested, `akoya_expenses` = total project cost, `wmkf_numberofyearsoffunding` = year count).

| Schema name | Display | Type | Range | Notes |
|---|---|---|---|---|
| `wmkf_TotalOtherSources` | Total Other Sources | Money | 0 – 1,000,000,000 USD | Cost-share total; sum of `wmkf_proposalbudgetline.wmkf_amount` over cost-share categories |

Aggregate semantics: `akoya_expenses = akoya_request + wmkf_totalothersources`. Maintained by the drain + the Item-6 recompute flow (Option A′ flow-body-conditional, your 2026-05-20 PASS).

---

## What I'd specifically want your eyes on

1. **`wmkf_portalmembership` entity name** (§2) — RESOLVED S178: normalized to the no-underscore form matching sibling `wmkf_App*` entities. No open question; noted here only so the entity name is on your radar for the shape review.
2. **Picklist integer reservations** (§1 `wmkf_Category` 10 values, §2 `wmkf_ApprovalStatus` 4 values + `wmkf_PriorDecisionStatus` 3 values, §3 `wmkf_role` slots 100000002–100000004). These lock at deploy and downstream PAs / drain guards / packet builder will hardcode them. Flag any value you'd rather see different.
3. **`wmkf_Category` cost-share labels** were normalized to spaced form ("Waived Indirect" / "Waived Tuition" / "Other Cost Share") S163. Filter-predicate shorthand in some other docs still uses camelCase (`WaivedIndirect` etc.) — those are integer-backed semantic references, not display labels. Comfortable with this split?
4. **Cascade.Delete: Cascade on `wmkf_proposalbudgetline_request`** — administrative whole-request deletion is the only intended use; drain reconciliation deactivates, never deletes. OK as specced?
5. **`wmkf_Amount` MinValue=0 at Dataverse level** — drain server-side is the authoritative guard against negative values. Two-layer enforcement OK?

Nothing else here should surprise you — these are the 2026-05-14 schema-review decisions condensed.

---

## Source

Authoritative specs (do not re-author — these are what `apply-dataverse-schema.js --wave=4` deploys):

- `lib/dataverse/schema/wave4/wmkf_proposalbudgetline.json`
- `lib/dataverse/schema/wave4/wmkf_portalmembership.json`
- `lib/dataverse/schema/wave4-existing/wmkf_apprequestperson-roster-fields.json`
- `lib/dataverse/schema/wave4-existing/akoya_request-intake-aggregates.json`
- `scripts/extend-apprequestperson-role-picklist.mjs` (the `wmkf_role` enum extension)

Full design context: `docs/INTAKE_PORTAL_SCHEMA_CHANGES.md` 2026-05-14 entry, `docs/BUDGET_FORM_SPEC.md` v3, `docs/INTAKE_PORTAL_DESIGN.md` §Membership.
