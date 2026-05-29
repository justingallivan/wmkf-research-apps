# WMKF Research Phase II — Budget Form: UI/UX & Data Spec

**Status:** v3 draft (2026-05-14, S149 — schema review w/ Connor). v2 had Other Sources as a separate `wmkf_proposalcostshare` entity; v3 **re-overturns that** — cost-share lives back in `wmkf_proposalbudgetline` via three new `wmkf_category` enum values (`WaivedIndirect`, `WaivedTuition`, `OtherCostShare`). Driver: human-legibility schema principle (memory `feedback_human_legibility_schema_principle`) — non-technical staff browse Dataverse, fewer obscure tables wins, accept the forever-filter cost on aggregate queries. v3 also (a) replaces the proposed `wmkf_totalwmkfrequested` / `wmkf_projectyears` / `wmkf_totalprojectcost` fields with existing `akoya_request` (Money) / `wmkf_numberofyearsoffunding` (Picklist 1–5) / `akoya_expenses` (Money) — verified via live Dataverse probe — and (b) extends `wmkf_apprequestperson` (S139 junction, 5,561 rows) instead of creating a new `wmkf_proposalroster` entity. v2-era references to `wmkf_proposalcostshare` and `wmkf_proposalroster` in this doc are superseded; the v3 sections below are authoritative. Companion build plan: `docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md` (different slice — membership approval).

> **Item 6 — drain-vs-PA write conflict — UNRESOLVED.** Codex review 2026-05-14 surfaced that the v2 plan (drain PATCHes parent aggregates + Connor's PA flow recomputes on every child write) violates the `INTAKE_PORTAL_DESIGN.md` § "Power Automate boundary" invariant "they never write the same field." Tracked as a separate decision; do NOT deploy the schema slice until Item 6 lands. Three viable redesigns (drain-only writes at submit + PA filters on a submitted flag; PA-only writes always + drain writes children only; rollup fields if AkoyaGO write paths to `akoya_request`/`akoya_expenses` can be audited as dormant). All v3 sections below are correct against whichever Item 6 redesign lands, except § "Aggregate fields on `akoya_request`" which describes the **target** field set (consumer of whichever writer wins).

---

## Overview

A multi-section budget form for grant applicants. Built as a single page (or wizard step) within the existing app suite. Drafts persist to Postgres `intake_drafts.draft_json`; externalized to Dataverse asynchronously via the `submission_jobs` drain cron on submit. The form replaces a free-form Excel spreadsheet that applicants were filling out incorrectly.

---

## Page Structure

```
[Header: Application context — org name, project title (read-only, pulled from earlier form step)]

[Section 1: Grant Duration]
[Section 2: Personnel Costs]
[Section 3: Equipment Costs]
[Section 4: Operations Costs]
[Section 5: Other Sources of Funding]
[Section 6: Budget Summary (live, read-only)]

[Actions: Save Draft | Submit]
```

---

## Section 1: Grant Duration

A single dropdown at the top of the form. Its value controls which year columns are revealed throughout the rest of the form.

| Field | Type | Options | Default |
|---|---|---|---|
| Number of project years | Dropdown | 1, 2, 3 | 3 |

**Conditional logic:** When value = 1, show only "Year 1" columns. When value = 2, show "Year 1" and "Year 2" columns. When value = 3, show all three year columns.

---

## Section 2: Personnel

### 2a. Header concept

Each personnel row has:
- **Role label** (fixed or user-specified)
- **Headcount** (integer, ≥ 0)
- **% Effort / FTE** (see § 2e below)
- **WMKF funding** per active year (currency, ≥ 0)

### 2b. Fixed personnel rows (always shown)

> **Label change from spreadsheet:** The section previously read "Salary + Fringe Benefits" — use **"Salaries & Fringe Benefits"** as the section sub-label to make clear that entered amounts must include fringe.

| Row label | Headcount field? |
|---|---|
| Principal Investigators | Yes |
| Co-Investigators | Yes |
| Postdoctoral Fellows | Yes |
| Graduate Student Stipends | Yes |
| Graduate Student Tuition/Fees | Yes |

### 2c. "Other Personnel" — dynamic rows

- A button: **"+ Add Personnel Role"**
- Each added row has: a free-text label input + headcount + WMKF per year
- Minimum: 0 additional rows. Maximum: suggest 10 (configurable).
- Rows can be removed with a trash icon.

### 2d. Column structure per row (repeated for each active year)

| Field | Type | Validation |
|---|---|---|
| WMKF Amount (Year N) | Currency input | ≥ 0, numeric only |

(Headcount is a single field, not repeated per year — it's a descriptor, not summed.)

### 2e. Effort / FTE field (per personnel row)

Each personnel row includes a single **% Effort** field (not repeated per year).

| Field | Type | Validation | Notes |
|---|---|---|---|
| % Effort | Numeric, 0–100 | Must be > 0 if any WMKF amount > 0 | Whole numbers sufficient |

**Policy decision captured:** Applicants enter the **total WMKF dollar request** (salary + fringe already included) and note what effort percentage is being applied. The form does not calculate salary from effort. The % Effort field is for reviewer context only.

ℹ️ **Info icon tooltip for % Effort:**
> *"Enter the percentage of this person's time that will be devoted to the project. The dollar amount you enter should already reflect this effort (e.g., if a PI earns $200K and will spend 20% effort, enter $40,000 plus applicable fringe benefits)."*

ℹ️ **Info icon tooltip for Salaries & Fringe Benefits (section level):**
> *"Include both salary and fringe benefits (benefits, payroll taxes, etc.) in each dollar amount. Do not list salary and fringe separately."*

### 2f. Subtotals

Auto-calculated, read-only:
- WMKF subtotal per year (Year 1, Year 2, Year 3)
- WMKF cumulative (sum of all active years)

---

## Section 3: Equipment

### 3a. Structure

Equipment is entirely dynamic (no fixed rows). All rows are user-specified.

- A button: **"+ Add Equipment Item"**
- Each row: free-text description + WMKF amount per active year
- The section can be empty (no equipment in budget).

| Field | Type | Validation |
|---|---|---|
| Description | Text input | Required if row exists |
| WMKF Amount (Year N) | Currency input | ≥ 0 |

### 3b. Subtotals

Auto-calculated, read-only:
- WMKF subtotal per year
- WMKF cumulative

---

## Section 4: Operations

### 4a. Fixed operation rows (always shown, but amount can be $0)

| Row label | WMKF input | Notes |
|---|---|---|
| Consumable Supplies | Enabled | |
| Animal Costs | Enabled | |
| Travel / Symposia | Enabled | |
| Contracted Services | Enabled | |
| Renovations | Enabled | |
| Facilities / Overhead | **Disabled** | See policy note below |

**Facilities / Overhead — WMKF policy note:** The WMKF amount fields for Facilities/Overhead must be rendered as **disabled (locked) inputs** with a tooltip:

> *"WMKF funding for Facilities & Overhead is not currently permitted."*

Do not hide the field — keep it visible so applicants understand the row exists but is restricted. When policy changes, this becomes a single feature-flag toggle with no form restructuring required. The Facilities/Overhead amount is instead captured under Other Sources (see Section 5).

### 4b. Dynamic "Other Operations" rows

- Button: **"+ Add Operations Item"**
- Each row: free-text description + WMKF per active year

### 4c. Subtotals

Auto-calculated, read-only:
- WMKF subtotal per year
- WMKF cumulative

---

## Section 5: Other Sources of Funding

**Background context for developers:** In the prior Excel-based process, the only "Other Sources" field applicants reliably filled in was Facilities/Overhead (an institutional overhead calculation). These three structured categories replace that single opaque field, giving the foundation visibility into the *nature* of each institutional contribution.

### 5a. Section-level helper text (display to applicant)

> *"Most cost-sharing takes the form of waived indirect or tuition costs. If your institution is contributing direct costs (e.g., renovations, equipment, salary support), use 'Other Cost Share / In-Kind' and describe the contribution."*

### 5b. Three fixed categories (always shown)

| Row label | Notes |
|---|---|
| Waived Indirect Costs | Indirect costs the institution is waiving on behalf of the project |
| Waived Tuition Costs | Tuition costs the institution is waiving |
| Other Cost Share / In-Kind | Requires a free-text description if any amount > 0 |

### 5c. Column structure

| Field | Type | Validation |
|---|---|---|
| Amount (Year N) | Currency input | ≥ 0 |
| Description (Other row only) | Text input | Required if any Other amount > 0 |

### 5d. Subtotals

- Other Sources subtotal per year
- Other Sources cumulative

---

## Section 6: Budget Summary (read-only)

A live-updating panel, always visible (sticky or at-a-glance).

| Row | Year 1 | Year 2 | Year 3 | Cumulative |
|---|---|---|---|---|
| Personnel (WMKF) | auto | auto | auto | auto |
| Equipment (WMKF) | auto | auto | auto | auto |
| Operations (WMKF) | auto | auto | auto | auto |
| **Total WMKF** | **auto** | **auto** | **auto** | **auto** |
| Other Sources | auto | auto | auto | auto |
| **Total Project Cost** | **auto** | **auto** | **auto** | **auto** |

### Validation banner

> ✅ *"Cumulative WMKF total: $400,000 — valid (multiple of $100,000)"*

> ❌ *"Cumulative WMKF total: $342,500 — not a multiple of $100,000. Add $57,500 to reach $400,000, or remove $42,500 to reach $300,000."*

Both round-up and round-down targets are always shown. In practice, the difference is typically absorbed by adjusting Consumable Supplies. Runs live and blocks form submission.

---

## Validation Rules

| Rule | Trigger | Message |
|---|---|---|
| All currency fields numeric | On blur | "Please enter a dollar amount (numbers only)" |
| All currency fields ≥ 0 | On blur | "Amount cannot be negative" |
| Dynamic row description required | On submit | "Please enter a description for each custom line item" |
| "Other Cost Share" description required if amount > 0 | On blur / submit | "Please describe the nature of this cost share" |
| Cumulative WMKF must be a multiple of $100,000 | Live + on submit | "Total WMKF request must be a multiple of $100,000" |
| At least one budget line item must have a value > 0 | On submit | "Budget cannot be empty" |
| Headcount must be a whole number ≥ 0 | On blur | "Enter a whole number (0 or more)" |
| % Effort must be > 0 if any WMKF amount > 0 | On blur | "Enter the effort percentage for this role" |
| **Tuition (category `100000005`) capped — `[DECISION TBD]`** | Live + on submit | _Message pending cap decision_ |

> **Tuition cap — OPEN POLICY DECISION (S178).** The Foundation historically did **not** allow tuition as a fundable expense; this is now reversed — applicants may request a *modest* tuition amount under category `Tuition` (`100000005`). The amount is capped, but the cap form is **undecided**: either (a) a fixed maximum dollar amount, or (b) a percentage of the total budget. Once decided, this becomes a concrete validation rule (client-side live check + drain server-side hard gate, mirroring the $100K-multiple trust-boundary pattern). Until then, no Tuition-specific enforcement ships. The form should keep the Tuition field visible regardless — same "visible but governed" pattern as the restricted Facilities/Overhead row (§ Operations).

---

## Data wiring

The budget form is a planned section of the applicant intake form. *(It was scoped for the now-superseded June 2026 Phase II Research pilot, but the scoping carries forward as planning for the next cycle's Phase I intake form — see `docs/SYSTEM_MODEL.md`.)* It follows the same Postgres-first / async-drain pattern as the rest of the intake portal (see `docs/INTAKE_PORTAL_DESIGN.md` § "Draft staging" and § "Submission lifecycle"). There is no standalone "budget submission" entity — `akoya_request` is the parent.

### Editing layer — Postgres `intake_drafts.draft_json`

While the applicant edits, budget data lives as a sub-object inside the existing `intake_drafts.draft_json` JSONB column. No separate FK, no per-budget status field. The intake draft row IS the in-progress budget. Browser autosaves debounced to `/api/intake/draft` (30s of inactivity or field blur).

Proposed JSONB shape:

```jsonc
draft_json = {
  // ... other form sections ...
  budget: {
    projectYears: 3,                              // 1 | 2 | 3 — drives column visibility
    personnel: [
      {
        kind: "fixed",                             // "fixed" | "dynamic"
        roleCode: "principal-investigators",       // stable enum for fixed; null for dynamic
        label: "Principal Investigators",          // user-editable for dynamic; static for fixed
        headcount: 2,
        effortPct: 25,
        year1: 80000, year2: 80000, year3: 80000
      },
      // ... 4 more fixed personnel rows ...
      {
        kind: "dynamic",
        roleCode: null,
        label: "Research Technician",
        headcount: 1,
        effortPct: 100,
        year1: 65000, year2: 67000, year3: 0
      }
    ],
    equipment: [
      { description: "Confocal microscope upgrade", year1: 120000, year2: 0, year3: 0 }
    ],
    operations: [
      { kind: "fixed", code: "consumable-supplies", label: "Consumable Supplies",
        year1: 15000, year2: 15000, year3: 15000 },
      // ... 4 more enabled fixed operations rows ...
      { kind: "fixed", code: "facilities-overhead", label: "Facilities / Overhead",
        year1: 0, year2: 0, year3: 0, locked: true },    // always 0; policy-locked
      { kind: "dynamic", code: null, label: "Cloud compute time",
        year1: 8000, year2: 8000, year3: 8000 }
    ],
    otherSources: [
      { sourceType: "waived-indirect-costs", description: null,
        year1: 150000, year2: 150000, year3: 150000 },
      { sourceType: "waived-tuition-costs", description: null,
        year1: 30000, year2: 30000, year3: 30000 },
      { sourceType: "other-cost-share", description: "Lab renovation funded by institution",
        year1: 50000, year2: 0, year3: 0 }
    ]
  }
}
```

Notes on the shape:
- **No subtotals or cumulative totals stored.** They're derived client-side and recomputed during the drain cron's externalization step. Storing them invites drift between the line items and the totals.
- **`projectYears` clipping:** `year2` / `year3` fields can be present in JSONB regardless of `projectYears`, but UI must zero them when `projectYears` shrinks, and the externalization step must ignore them. Decision: clip on UI shrink (cleaner state).
- **`kind: "fixed"` vs `"dynamic"`** with a stable `roleCode` / `code` on fixed rows lets the drain step map cleanly to externalized field names without relying on label text matching. Facilities/Overhead is identified by `roleCode='facilities-overhead'` (not a separate `locked` flag — dropped per Codex v3 review; `wmkf_locked` was a mutable Boolean for a policy invariant).

**Audit-log events (per `INTAKE_PORTAL_DESIGN.md` § "intake_audit" contract — material financial data requires audit coverage):**

| Trigger | `action` | `payload` (service hashes to sha256) |
|---|---|---|
| Autosave upsert of `intake_drafts` row | `budget.draft.autosave` | `{ budgetCumulativeTotal, lineItemCount }` — full JSONB not in payload (too noisy for autosave cadence; the draft row itself is the canonical state) |
| Applicant clicks Submit | `budget.submit.enqueued` | `{ submissionJobId, budgetCumulativeTotal, lineItemCount, otherSourcesCumulativeTotal }` |
| Drain externalization succeeds | `budget.externalize.success` | `{ submissionJobId, rowCountWritten, aggregateTotals }` |
| Drain externalization fails (permanent) | `budget.externalize.failed` | `{ submissionJobId, attempts, lastError }` |
| $100K-multiple invariant violated at submit | `budget.validation.failed` | `{ submissionJobId, cumulativeTotal, expectedRoundUp, expectedRoundDown }` |

Calls go through `IntakeAuditService.log({ actorOid, actorType, action, targetEntity: 'wmkf_proposalbudgetline', payload, ... })` per the live signature at `lib/services/intake-audit-service.js:32`. Audit writes are non-blocking; failures warn but never block the response.

### Externalized layer — Dataverse (on submit, via drain cron)

When the submit endpoint queues a `submission_jobs` row, the drain cron's `dynamics_patched` step walks `payload.budget` and writes to Dataverse: child rows under **one entity (`wmkf_proposalbudgetline`)** — WMKF spend lines + cost-share lines distinguished by `wmkf_category` per the v3 unified-table decision — plus three field updates on the parent `akoya_request` (year count reuses an existing populated field).

**Drain attribution.** Async drain writes are not user-initiated, so `MSCRMCallerID` doesn't impersonate the applicant. Two options were considered:

- **(A) Pass `actingUserSystemId = <WMK app user systemuserid>`** — the "WMK: Research Review App Suite" app user already exists in Dynamics as a real `systemuser` row (per memory `project_dynamics_identity_reconciliation` § "Dynamics CRM Users"). `_withCallerId` accepts this and `modifiedby` reflects the app user. **Pilot path.**
- **(B) Pass `actingUserSystemId = null`** — `_withCallerId` omits the header per `lib/services/dynamics-service.js:166-170`; writes attribute to the OAuth service principal directly. Cleaner audit story ("this row was written by automation, not a user"), but every Dataverse audit row reads as "Application User" with no further differentiation.

**Decision: Option A.** Preserves consistency with the admin-slice attribution model (impersonation everywhere makes the audit trail uniform). Slice 0 records the app-user systemuserid in the Atlas page so the drain implementation reads it from one place.

**Row-per-(line, year) shape (reconciled with `INTAKE_PORTAL_SCHEMA_CHANGES.md` line 22).** A 3-year personnel line in the JSONB becomes **3 child rows** in Dataverse — one per active year. This matches the pre-committed catalog shape and matches Connor's PA template grouping (his cover-doc PA reads `(year, category, description, amount)` rows and assembles a grouped Word document).

| Source JSONB | Target | Per-year unroll |
|---|---|---|
| `budget.personnel[i]` with `year1=80000, year2=80000, year3=80000` (projectYears=3) | 3 rows in `wmkf_proposalbudgetline`, `wmkf_category='Personnel'` | Y1, Y2, Y3 rows each carrying `wmkf_amount` for that year |
| `budget.equipment[i]` | rows in `wmkf_proposalbudgetline`, `wmkf_category='Equipment'` | One per active year with `wmkf_amount > 0`; **empty arrays produce zero rows** (an applicant with no equipment writes no Equipment children) |
| `budget.operations[i]` for `code IN ('consumable-supplies', 'animal-costs', 'travel-symposia', 'contracted-services', 'renovations')` | rows in `wmkf_proposalbudgetline`, `wmkf_category` mapped to catalog enum (see mapping table below) | One per active year |
| `budget.operations[i]` for `code='facilities-overhead'` | rows in `wmkf_proposalbudgetline`, `wmkf_category='Indirect'`, `wmkf_amount=0` always | **Always written** per § Idempotency — preserves the audit semantic that the applicant saw the row |
| `budget.otherSources[i]` | rows in `wmkf_proposalbudgetline`, `wmkf_category IN (WaivedIndirect, WaivedTuition, OtherCostShare)` per the source discriminator | Per-year unroll. **Empty rows (all years 0) are not written**, except `OtherCostShare` rows where `wmkf_description` is non-empty (treated as intentional disclosure) |
| `budget.projectYears` | `akoya_request.wmkf_numberofyearsoffunding` (Picklist; existing field, options 100000000=1 … 100000004=5) | One field write. Pilot maps {1,2,3} → {100000000, 100000001, 100000002} |
| Cumulative totals (derived) | `akoya_request.akoya_request` (WMKF-requested), `akoya_request.wmkf_totalothersources` (cost-share), `akoya_request.akoya_expenses` (total) — see § Aggregate fields | Writer for these three is gated on **Item 6** resolution; drain may not be the writer in the final design |

**Category mapping from JSONB to catalog enum.** The catalog's `wmkf_category` WMKF-spend values are `Personnel / Equipment / Supplies / Travel / Other Direct / Tuition / Indirect` (cost-share values listed in § Aggregate fields). The form's Operations section has six fixed sub-rows; they map as:

| Form row code | `wmkf_category` |
|---|---|
| `consumable-supplies` | `Supplies` |
| `animal-costs` | `Other Direct` |
| `travel-symposia` | `Travel` |
| `contracted-services` | `Other Direct` |
| `renovations` | `Other Direct` |
| `facilities-overhead` | `Indirect` (reserved category — WMKF doesn't pay; always 0) |

Dynamic "Other Operations" rows also map to `Other Direct`. The `Tuition` category (`100000005`) has no Operations sub-row — it is a newly-allowed direct-cost category (see § Validation Rules, "Tuition cap"); the form-side tuition input and its JSONB→category mapping are open form-integration items, blocked on the cap decision. The applicant-facing label collapses 4 categories into one "Other Direct" bucket on the Dataverse side — Connor's cover-doc PA can group by `wmkf_category` for reviewer display, and the applicant-facing `wmkf_description` carries the specific line identity.

The original spec proposed a parent `wmkf_budgetsubmission` table with its own `wmkf_status`. **That table is intentionally dropped** — `akoya_request` already serves as the parent, and the draft/submitted state machine is handled by `intake_drafts` (draft) → `submission_jobs` (in-flight) → externalization (terminal).

### `wmkf_proposalbudgetline` entity fields

Pre-committed catalog shape from `INTAKE_PORTAL_SCHEMA_CHANGES.md` line 22 + three v2-additions (`wmkf_rolecode`, `wmkf_headcount`, `wmkf_effortpct`) flagged for Connor at the 2026-05-15 review.

| Field | Type | Source | Notes |
|---|---|---|---|
| `wmkf_proposalbudgetlineid` | Unique Identifier (PK) | catalog | Auto |
| `wmkf_name` | Text(160) | catalog | Synthesized: `Y{year} — {category}: {description}` |
| `_wmkf_request_value` | Lookup → `akoya_request` | catalog | Parental, cascade delete. Bound via nav-property `@odata.bind` on write — exact bind key (likely `wmkf_Request@odata.bind`) recorded at slice 0 deploy |
| `wmkf_year` | Whole Number (1–10) | catalog | Forward-compatible across program lengths; pilot writes 1/2/3 |
| `wmkf_category` | Choice | catalog + v3 expansion | Numeric option-set values per `lib/services/dynamics-service.js:930` convention. Values (v3 — 10 total, `Tuition` added S178): WMKF-spend categories — `Personnel / Equipment / Supplies / Travel / Other Direct / Tuition / Indirect`; cost-share categories — `WaivedIndirect / WaivedTuition / OtherCostShare`. **WMKF-spend aggregate queries MUST filter `wmkf_category NOT IN (WaivedIndirect, WaivedTuition, OtherCostShare)`** — this is the forever-filter cost of the v3 unified-table decision. Numeric mapping table recorded in Atlas at slice 0 |
| `wmkf_description` | Text(500) | catalog | Line-item description. For fixed rows: the static label ("Principal Investigators", "Consumable Supplies"). For dynamic rows: applicant-entered text |
| `wmkf_amount` | Money (USD) | catalog | Single value per row (this row IS one year) |
| `wmkf_lineorder` | Whole Number | catalog | Display order within `(request, year, category)` |
| `wmkf_rolecode` | Text(60) | **v2 addition** | Stable identifier for fixed rows (`principal-investigators`, `consumable-supplies`, `facilities-overhead`, etc.); null for dynamic rows. Drain uses this for idempotent identification of fixed rows; flagged for Connor 2026-05-15 |
| `wmkf_headcount` | Whole Number | **v2 addition** | Personnel rows only (null otherwise); accepted at 2026-05-14 review. Lives here vs. the roster (now extended `wmkf_apprequestperson` per v3) because budget headcount is an aggregate descriptor ("we want funding for 2 PIs"), distinct from roster's per-person identity |
| `wmkf_effortpct` | Whole Number (Min 0, Max 100) | **v2 addition** | Personnel rows only (null otherwise); accepted at 2026-05-14 review. Same distinction from roster — budget effort is the aggregate funded effort, roster effort is per-person |

Note: the per-year-row shape means `wmkf_headcount` and `wmkf_effortpct` repeat across Y1/Y2/Y3 rows for the same logical personnel line. The drain writes the same value to all year-rows for that line. Reports that want "headcount per personnel line" can `GROUP BY` `(request, category, rolecode, description, lineorder)`.

### Cost-share rows live in `wmkf_proposalbudgetline` (v3 — re-overturns v2)

v2 carved Other Sources into a separate `wmkf_proposalcostshare` entity. v3 (2026-05-14 schema review) returns cost-share to `wmkf_proposalbudgetline` via three new `wmkf_category` enum values. Driver: human-legibility principle. Cost-share rows are identical in shape to budget lines — `(request, year, category, description, amount, lineorder)` — and the existing entity's columns already accommodate them. Required-on-OtherCostShare semantics for `wmkf_description` move from a per-entity drain assertion to a per-row drain assertion (see Idempotency section).

**Forever-filter cost (accepted).** Every aggregate query asking "what is WMKF being asked to fund?" must filter `wmkf_category NOT IN (WaivedIndirect, WaivedTuition, OtherCostShare)`. The $100K-multiple invariant applies to that filtered sum, not the raw sum. Drain validation, reconcile cron, packet-builder PA, and any future read consumer all owe this guard. Atlas page records the exact integer values for the three cost-share categories so the guard reads identically across consumers.

### Aggregate fields on `akoya_request` (v3 — verified via live Dataverse probe 2026-05-14)

Three cached cumulative totals on the parent request. **v3 reuses three existing fields instead of creating new ones** — verified by `EntityDefinitions(LogicalName='akoya_request')/Attributes` probe (577 attributes on entity; 0 collisions on the proposed-new names; 3 functional equivalents already present):

| Field | Type | Definition |
|---|---|---|
| `akoya_request` | Money | Sum of `wmkf_amount` across `wmkf_proposalbudgetline` rows for this request **filtered to WMKF-spend categories** — `wmkf_category NOT IN (WaivedIndirect, WaivedTuition, OtherCostShare)`. All years included. The $100K-multiple invariant applies to this filtered number. Existing AkoyaGO field, DisplayName "Requested Amount" / description "Grant amount requested by applicant" — already in this semantic. **Downstream consumer to patch:** `pages/api/grant-reporting/lookup-grant.js` (resolved S149 — fallback to this field on `akoya_grant` null removed). |
| `wmkf_totalothersources` | Money | Sum of `wmkf_amount` across `wmkf_proposalbudgetline` rows for this request filtered to **cost-share categories** — `wmkf_category IN (WaivedIndirect, WaivedTuition, OtherCostShare)`. **Only net-new field** on `akoya_request` in slice 0. |
| `akoya_expenses` | Money | `akoya_request + wmkf_totalothersources`. Existing AkoyaGO field, DisplayName "Total Project Budget" / description "Total project budget" — already in this semantic. |

Year count uses **existing `wmkf_numberofyearsoffunding`** (Picklist, options 100000000=1 … 100000004=5). The original v2 proposal of a net-new `wmkf_projectyears` field is withdrawn — that label appears nowhere else in v3 and the drain writes `wmkf_numberofyearsoffunding` directly. Pilot writes 1/2/3.

**Why cache:** Connor's PA flows fire on `akoya_request`, AkoyaGO grid views display headline numbers without drilling, and the $100K-multiple business rule is more discoverable as a named parent field than as a child-rollup.

**Per-year aggregates are intentionally skipped for pilot.** Non-breaking add later if a real consumer surfaces.

**Drift hardening (Item 6 — UNRESOLVED).** 2026-05-14 sketch was: PA flow on `wmkf_proposalbudgetline` Create/Update/Delete recomputes aggregates + daily reconcile cron as backstop. Codex review flagged that the sketch violates `INTAKE_PORTAL_DESIGN.md` § "Power Automate boundary" (portal and PA never write the same field). Three viable redesigns deferred to a separate decision; the schema slice should not deploy until Item 6 resolves. Once resolved, this section becomes the consumer-side spec for whichever writer wins.

### Why not write to Dataverse during draft

Patching Dataverse on every autosave would burn Web API quota and hit throttling during peak submission windows. The intake portal explicitly chose Postgres staging to avoid this — see `INTAKE_PORTAL_DESIGN.md` § "Draft staging — Postgres, not Dynamics" for the full reasoning.

### Idempotency + drain step ordering (v2)

v1 stated delete-and-replace "inside a single Dataverse `$batch` request." **Codex review surfaced that `$batch` is not implemented in `dynamics-service.js`** (only individual `createRecord` / `updateRecord` / `deleteRecord` helpers). Until `$batch` lands as a parent-level intake-portal infrastructure investment, the budget drain runs as a sequence of individual Web API calls with **explicit progress markers in `submission_jobs.dynamics_patches`** so retries are safe.

**Per-attempt drain sequence inside the `dynamics_patched` step:**

1. **Recompute aggregates from the payload.** `cumulativeWMKF = sum(rows where category IN (Personnel, Equipment, Supplies, Travel, Other Direct, Tuition, Indirect))`, `cumulativeOther = sum(rows where category IN (WaivedIndirect, WaivedTuition, OtherCostShare))`. Note the `IN` (not `NOT IN`) construction matches the unified-table v3 decision. Server-side hard gate: if `cumulativeWMKF % 100_000 !== 0`, mark the job `status='failed'` (permanent — not a transient retry), audit-log `budget.validation.failed`, notify staff. The client-side $100K-multiple validation is a UX optimization; this is the trust boundary.
2. **Query existing children for this `request_id`** in `wmkf_proposalbudgetline` via `queryRecords` filtered on `_wmkf_request_value` (single entity since v3 unified cost-share). Returns the GUID set to delete.
3. **Delete existing children one-by-one** via `deleteRecord`. After each successful delete, append the GUID to `submission_jobs.dynamics_patches.deletedChildIds`. If the cron tick times out mid-delete, the next tick reads the marker, skips already-deleted GUIDs, and resumes.
4. **Insert new children one-by-one** via `createRecord` with `MSCRMCallerID` = WMK app user systemuserid. After each successful insert, append `{ guid, year, category, rolecode }` to `submission_jobs.dynamics_patches.insertedChildren`. Resumable across cron ticks the same way.
5. **PATCH the three aggregate fields on `akoya_request`** via `updateRecord`. Set `submission_jobs.dynamics_patches.aggregatesUpdated=true` after success.
6. **Advance `submission_jobs.status` → `status_flipped` step.**

**Failure semantics:**

- Network 5xx / 429 → transient; existing `submission_jobs` backoff handles it. The progress markers from steps 3-5 mean the retry resumes mid-sequence, not from scratch.
- Permanent 4xx on a child write (e.g., 400 invalid field) → mark job `failed`, notify staff. The partial state in Dataverse (some children deleted, some inserted, aggregates stale) requires staff intervention via a "force re-drain" admin action.
- $100K-multiple violation → permanent fail per step 1.

**Per-`request_id` advisory lock scope (Codex MOD #2 fix):** the existing Postgres advisory lock from `INTAKE_PORTAL_DESIGN.md` § "Drain cron" is held for the duration of **the entire `dynamics_patched` step**, not per Web API call. This means while the drain is writing budget children for request X, no other cron tick can pick up another job for the same request X. Two requests get parallel writes; one request gets serial writes. Sufficient for pilot scale.

**The atomicity gap (Codex MOD #1 + CRITICAL).** Without `$batch`, there exists a window between "all children written" and "aggregates updated" where `akoya_request.wmkf_total*` fields are stale. This window is bounded by the drain step's wall-clock time (seconds, not minutes — pilot scale is ~30 rows max) and by the advisory lock (no second drain interferes). Consumers reading aggregates during this window get stale values; the next read after step 5 completes sees fresh values. **For pilot, accept the gap.** Phase 1+ items in `docs/INTAKE_PORTAL_DESIGN.md` should track adding `$batch` support to `dynamics-service.js` as a cross-cutting infrastructure investment that benefits all async drain consumers.

**Facilities/Overhead row is always written**, even when amount is 0, for symmetry with the other fixed Operations rows and to preserve audit / future-policy-change semantics. The drain asserts `wmkf_amount === 0` on the `wmkf_rolecode='facilities-overhead'` row before writing as defense-in-depth against a client-side bug.

**Conditional-null enforcement for `wmkf_description` and `wmkf_headcount` / `wmkf_effortpct`:** the drain asserts before each `createRecord`:
- `wmkf_proposalbudgetline.wmkf_description` must be non-null when `wmkf_category='OtherCostShare'` and `wmkf_amount > 0` (v3 unified-table successor to v2's `wmkf_sourcetype` non-null rule).
- `wmkf_proposalbudgetline.wmkf_headcount` and `wmkf_effortpct` must be null unless `wmkf_category='Personnel'`. (Dataverse won't enforce this.)

Violations are payload bugs; treat as permanent failures and notify staff.

---

## React Component Architecture

```
<BudgetFormPage>
├── <BudgetHeader />                        // org name, project title (read-only)
├── <ProjectYearsSelector />                // dropdown, drives column visibility
├── <PersonnelSection activeYears={n} />
│   ├── <PersonnelRow /> (×5 fixed)
│   ├── <DynamicPersonnelRows />
│   └── <SectionSubtotal />
├── <EquipmentSection activeYears={n} />
│   ├── <DynamicEquipmentRows />
│   └── <SectionSubtotal />
├── <OperationsSection activeYears={n} />
│   ├── <OperationsRow /> (×6 fixed)
│   ├── <DynamicOperationsRows />
│   └── <SectionSubtotal />
├── <OtherSourcesSection activeYears={n} />
│   ├── <OtherSourceRow /> (×3 fixed)
│   └── <SectionSubtotal />
├── <BudgetSummaryPanel />                  // live totals + $100K banner
└── <FormActions />                         // Save Draft | Submit
```

State management: React Hook Form + Zod, or Formik. Summary panel derives from form state — no separate state needed. Currency inputs: `react-currency-input-field` for numeric-only formatted entry.

---

## UX Notes

- Year column headers should remain sticky as the applicant scrolls long sections.
- Empty sections are valid — at least one line item across the whole form must be > $0.
- **Save Draft bypasses all validation. Submit enforces all rules.**
- Show the live WMKF cumulative total prominently at all times with a green/red indicator.
- On mobile, use a single-year tab view instead of side-by-side columns.

### Info icon (?) pattern

Use a consistent ℹ️ / ? icon triggering a small popover (not a modal). Implement as a reusable `<InfoPopover text="..." />` component. Confirmed locations:

- **Section level — Salaries & Fringe Benefits:** fringe inclusion rule
- **Row level — % Effort:** how to calculate the dollar request
- **Row level — Facilities / Overhead:** WMKF restriction explanation
- **Section level — Other Sources:** waived costs vs. direct cost share

### "Copy Year 1 → All Years" shortcut

Offer per row (or per section). Copies Year 1 values to Year 2 and Year 3 as-is — no automatic percentage increase (auto-inflation makes hitting the $100K multiple harder). The validation banner will prompt any needed adjustments after copying. Client-side only; "did the applicant use this" state is not persisted.

---

## Decisions locked 2026-05-13 (v2-revised)

v1 had a 7-row table from Justin's morning session. v2 keeps 5 of those as-is, overturns Q1 (Other Sources home), and amends Q5 (idempotency strategy) after Codex review surfaced the `$batch` gap. Walk Connor through the entire table — particularly the v2-overturned rows — at the 2026-05-15 schema review.

| # | Question | v1 Decision | v2 Status |
|---|---|---|---|
| 1 | Other Sources entity | Unified under `wmkf_proposalbudgetline` | **V3 RE-UNIFIED (2026-05-14 review).** Cost-share returns to `wmkf_proposalbudgetline` via three new `wmkf_category` enum values (`WaivedIndirect`, `WaivedTuition`, `OtherCostShare`). Driver: human-legibility principle (fewer obscure child tables). Accepted cost: every WMKF-spend aggregate query needs a `NOT IN` guard against the three cost-share values, forever. |
| 2 | Budget line entity name | `wmkf_proposalbudgetline` | Unchanged — matches `INTAKE_PORTAL_SCHEMA_CHANGES.md` line 22 catalog name. |
| 3 | Aggregate fields on `akoya_request` | Three Currency fields cached | **V3 REVISED.** Live-probe found 3 functional equivalents already exist on `akoya_request` (577 attributes total). Reuse `akoya_request` (WMKF-requested total), `akoya_expenses` (total project cost). Add only `wmkf_totalothersources` (cost-share total). Drain writes to these three. Drift-hardening = Item 6, UNRESOLVED. |
| 4 | `wmkf_projectyears` location | Field on `akoya_request` | **V3 REVISED.** Reuse existing `wmkf_numberofyearsoffunding` Picklist (option-set values 100000000=1, 100000001=2, 100000002=3, 100000003=4, 100000004=5) — verified via live probe; field is sparsely populated (~25 rows have non-null values in current data per the schema sample). Drain writing this field will overwrite any pre-existing value; behavior expected since intake-originated submissions are net-new requests, but Atlas page records the consideration. No new `wmkf_projectyears` field. |
| 5 | Idempotency | Delete-and-replace in one Dataverse `$batch` | **AMENDED.** `$batch` is not implemented in `dynamics-service.js`. Pilot path: sequential delete + insert with explicit progress markers in `submission_jobs.dynamics_patches` so retries are safe across the gap. Atomic `$batch` tracked as Phase 1+ portal-wide infrastructure investment. |
| 6 | Facilities/Overhead row | Always written, drain asserts amount=0 | Unchanged. Note: identification is by `wmkf_rolecode='facilities-overhead'` (the v1 `wmkf_locked` Boolean flag is dropped — mutable field for a policy invariant is weaker than role-code derivation). |
| 7 | `headcount` / `effortpct` types | Whole Number for both | Unchanged. Fields live on `wmkf_proposalbudgetline` (NOT on the roster — which in v3 is the extended `wmkf_apprequestperson`, since v3 dropped the planned `wmkf_proposalroster` entity) because budget headcount/effort are aggregate descriptors per personnel line, distinct from the per-person identity rows the junction holds. |

**v2-introduced decisions (not in the original 7):**

| # | Question | Decision |
|---|---|---|
| 8 | Drain attribution | `MSCRMCallerID` set to the **WMK app user systemuserid** (Option A), not null (Option B). Preserves consistency with admin-slice attribution; audit trail is uniform. |
| 9 | $100K-multiple invariant gate | Drain hard-validates the recomputed cumulative WMKF total at step 1 of `dynamics_patched`. Violation → permanent fail (not transient retry). Client-side validation is UX optimization; this is the trust boundary. |
| 10 | `intake_audit` coverage | Five action types: `budget.draft.autosave`, `budget.submit.enqueued`, `budget.externalize.success`, `budget.externalize.failed`, `budget.validation.failed`. Non-blocking. |
| 11 | Per-(line, year) row cardinality | A 3-year personnel line = 3 rows in Dataverse (one per year). Matches the catalog shape + Connor's PA template grouping by `(year, category)`. |
| 12 | Operations → category enum mapping | 6 form rows collapse to 4 catalog enum values (Supplies / Travel / Other Direct / Indirect). Applicant-specific identity lives in `wmkf_description` and the new `wmkf_rolecode` v2-addition. |
| 13 | `wmkf_rolecode` / `wmkf_headcount` / `wmkf_effortpct` field additions to catalog | Three v2-additions to `wmkf_proposalbudgetline`. **Flagged for Connor 2026-05-15** — extensions to the pre-committed catalog shape need his sign-off. |

Schema deploy (a separate slice) ships under the existing delegated authority, summary-after model. The Atlas page `docs/atlas/dataverse-wmkf-proposalbudgetline.md` (one page, not two — v3 single-table) is created at deploy and records:

- Exact `@odata.bind` keys (likely `wmkf_Request@odata.bind`)
- Numeric option-set values for the full 10-value `wmkf_category` enum, including the three new cost-share values
- The WMK app user systemuserid (drain reads this from one canonical place)
- The category-mapping table from § Externalized layer
- The forever-filter idiom (NOT IN cost-share categories) so every downstream consumer reads it the same way

The existing `docs/atlas/dataverse-wmkf-apprequestperson.md` is amended in slice 0 to record the three new nullable fields (`wmkf_effortpct`, `wmkf_biosketchurl`, `wmkf_lineorder`) and the five-value `wmkf_role` enum.

## Portal-wide infrastructure gaps surfaced by v2 (not budget-scope)

These are not blocking for the budget form's user-facing slice but **block production-grade externalization** and are tracked at the intake-portal level rather than this spec:

1. **`$batch` support in `dynamics-service.js`.** Currently absent; the drain falls back to sequential calls with progress markers. Cross-cutting because every async-drain consumer (budget, roster, attachments) wants atomic multi-write semantics.
2. **`submission_jobs` table not in migration `005_intake_portal.sql`.** Verified 2026-05-14 — migrations 005 created `intake_drafts` + `intake_audit` but NOT `submission_jobs`. The drain has no queue to drain from. **Prerequisite to slice 0** — add migration `009_submission_jobs.sql` before the schema slice deploys.
3. **Item 6 — drain-vs-PA write conflict on aggregate fields.** 2026-05-14 sketch (PA flow recomputes on every child write) violates the `INTAKE_PORTAL_DESIGN.md` § "Power Automate boundary" invariant. Three viable redesigns; resolution deferred. **Blocks schema slice deploy.**
4. **AkoyaGO inline child-row edit hardening.** Inline edits on `wmkf_proposalbudgetline` were Connor's 2026-05-14 driver for asking the system to be "tolerant of inline edits"; the actual answer is whichever Item 6 redesign lands.

Recommend logging these in `docs/INTAKE_PORTAL_DESIGN.md` § "Open questions / open work" so they're tracked at the right scope.
