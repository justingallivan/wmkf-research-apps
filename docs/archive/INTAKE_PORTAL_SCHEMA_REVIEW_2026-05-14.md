# Intake Portal Schema Review — 2026-05-14

> **Outcome banner (added post-meeting).** This document captures what I *recommended* walking into the 2026-05-14 review. The *decisions* diverged from several recommendations under a "human-legibility over normalization purity" principle that emerged mid-meeting. Authoritative summary of decisions is now in `docs/BUDGET_FORM_SPEC.md` (v3, top status block). Quick map:
>
> - **Item 1 — REVERSED to "unified."** Cost-share returns to `wmkf_proposalbudgetline` via three new `wmkf_category` enum values (`WaivedIndirect`, `WaivedTuition`, `OtherCostShare`). No new `wmkf_proposalcostshare` entity.
> - **Item 2 — accepted as recommended.** All three fields added.
> - **Item 3 — chose path "3D" (not on the menu in this doc).** Extend existing `wmkf_apprequestperson` (S139 junction, 5,561 rows). Add three nullable fields; expand `wmkf_role` enum from 2 → 5 values (add Senior Personnel / Key Personnel / Other). No new `wmkf_proposalroster` entity.
> - **Item 4 — accepted.** Add `wmkf_priordecisionstatus`.
> - **Item 5 — live-probed during the meeting.** 3 of 4 proposed fields already exist on `akoya_request`: reuse `wmkf_numberofyearsoffunding` (Picklist 1–5), `akoya_request` (Money — WMKF requested), `akoya_expenses` (Money — total project cost). Add only `wmkf_totalothersources` (Money) for cost-share total.
> - **Item 6 — UNRESOLVED.** In-meeting decision (PA flow recomputes on child writes) was flagged by Codex review as a direct violation of `INTAKE_PORTAL_DESIGN.md` § "Power Automate boundary" invariant. Deferred to a separate decision; **blocks schema slice deploy.**
> - **Item 7 — accepted, with clarification.** Reviewer packet is one PA-built document (not concatenated files); budget detail surfaces row identity via `wmkf_description` + `wmkf_rolecode`, so no `wmkf_category` enum expansion needed.
> - **Item 8 — moot.** Items 1 + 3 collapsed both naming questions.
>
> The body of this doc below is the pre-meeting agenda — kept for context. Aggregate-field definitions (Item 5) and cost-share rationale (Item 1) are superseded by `BUDGET_FORM_SPEC.md` v3.

**Purpose:** Walk through eight schema decisions that need Connor's sign-off before the pilot schema deploys. Two additional items are FYI / quick-confirm.

**Attendees:** Justin, Connor (plus Claude on-screen if helpful).

**Time budget:** 20–30 minutes. Each item below has a recommendation; if you agree, we move on. If you push back, we discuss the alternative.

**Calendar context:** pilot accepts submissions 2026-06-01. Schema needs to deploy by 2026-05-19 per the prior calendar checkpoints. This review unblocks deploy.

**Background docs:**
- `docs/INTAKE_PORTAL_DESIGN.md` — full design
- `docs/INTAKE_PORTAL_SCHEMA_CHANGES.md` — catalog of schema work in flight
- `docs/BUDGET_FORM_SPEC.md` v2 — budget form spec including the wiring
- `docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md` v4 — membership approval slice

---

## 1. New entity `wmkf_proposalcostshare` — scope nudge

### Context

The budget form has a section called "Other Sources of Funding" with three categories: Waived Indirect Costs, Waived Tuition Costs, Other Cost Share / In-Kind. These represent **institutional contributions** to the project — what the applicant's university is putting in, not what they're asking WMKF to fund.

Earlier today Justin and I decided to unify these into the existing `wmkf_proposalbudgetline` entity with a discriminator. On review, the catalog's `wmkf_category` enum (`Personnel / Equipment / Supplies / Travel / Other Direct / Indirect`) is implicitly the WMKF-spend categories — what the foundation is being asked to fund. Mixing institutional cost-share into that enum changes its semantic meaning and forces every "what is WMKF being asked for" aggregate query to negate cost-share rows out.

### Options

**Option A — Separate `wmkf_proposalcostshare` entity.** New child of `akoya_request`. Shape:

| Field | Type | Notes |
|---|---|---|
| `wmkf_proposalcostshareid` | PK | |
| `wmkf_name` | Text(160) | Synthesized: `Y{year} — {sourcetype}: {description}` |
| `_wmkf_request_value` | Lookup → `akoya_request` | Parental, cascade delete |
| `wmkf_year` | Whole Number (1–10) | Pilot writes 1/2/3 |
| `wmkf_sourcetype` | Choice | `WaivedIndirect / WaivedTuition / OtherCostShare` |
| `wmkf_description` | Text(500) | Required when `wmkf_sourcetype = OtherCostShare` and amount > 0 |
| `wmkf_amount` | Money (USD) | |
| `wmkf_lineorder` | Whole Number | Display order |

**Option B — Stay unified.** Add `WaivedIndirect / WaivedTuition / OtherCostShare` to the existing `wmkf_proposalbudgetline.wmkf_category` enum. Every cost-share row carries `wmkf_amount` like a budget line but is semantically different from a WMKF-spend line.

### Recommendation

**Option A — separate entity.**

### Rationale

1. Conceptually different from WMKF-spend lines. Reports and PA flows asking "what is WMKF being asked to fund?" can filter on `wmkf_proposalbudgetline` rows alone. Unified would force negation logic in every aggregate forever.
2. The existing `wmkf_category` enum stays clean and matches the cover-doc PA's grouping logic.
3. Cost is one more entity to create — small at pilot scale; bigger gain is the durable semantic separation.
4. Scope nudge: morning Item 1D scoped pilot to budget + roster. Adding cost-share makes it budget + roster + cost-share. Confirm this is acceptable; if not, fall back to Option B.

---

## 2. Three field additions to `wmkf_proposalbudgetline`

### Context

The catalog shape (`INTAKE_PORTAL_SCHEMA_CHANGES.md` line 22) is the row-per-year denormalization: `(request, year, category, description, amount, lineorder)`. The budget form has three attributes the catalog doesn't yet capture:

- **A stable identifier for fixed rows.** The form has fixed rows like "Principal Investigators", "Consumable Supplies", "Facilities / Overhead". Without a stable code, the drain has to match on display text — fragile if a label changes.
- **Headcount** (personnel only). The form asks "how many PIs?" — distinct from the description and the dollar amount.
- **% Effort** (personnel only). The form asks "what % of the PI's time?" — used for reviewer context, separate from the dollar amount which already includes salary + fringe.

### Options

**Option A — Add all three fields to `wmkf_proposalbudgetline`.**

| Field | Type | Populated when |
|---|---|---|
| `wmkf_rolecode` | Text(60) | Fixed rows only (e.g., `principal-investigators`, `consumable-supplies`, `facilities-overhead`); null for dynamic rows |
| `wmkf_headcount` | Whole Number | `wmkf_category = Personnel`; null otherwise |
| `wmkf_effortpct` | Whole Number (Min 0, Max 100) | `wmkf_category = Personnel`; null otherwise |

**Option B — Move headcount + effortpct to `wmkf_proposalroster` instead.** Keep them with the per-person roster records.

**Option C — Skip the role code; rely on description text matching for fixed-row identity.**

### Recommendation

**Option A — add all three to `wmkf_proposalbudgetline`.**

### Rationale

1. Role code: drain idempotency is fragile without it. Cost is one column.
2. Headcount + effortpct: distinct from the roster entity's semantic. The roster is per-person identity ("Dr. Erika Espinosa-Ortiz, PI, 25% effort, biosketch on file"). The budget headcount is an aggregate descriptor ("we're requesting funding for 2 PIs at 25% each"). They're different views of related data.
3. Repeats across Y1/Y2/Y3 rows for the same logical personnel line — drain writes the same value to all three. Reports wanting "headcount per personnel line" can `GROUP BY (request, category, rolecode, lineorder)`.
4. If you prefer headcount/effort on the roster, fine — the form just hides them from the budget section. Decide before slice 0 deploy.

---

## 3. `wmkf_proposalroster` shape — needs a sketch

### Context

Item 1D this morning scoped pilot to budget + roster as real child entities. The catalog has `wmkf_proposalbudgetline` sketched but says `wmkf_proposalroster` is **not yet sketched** — "to be drafted alongside `wmkf_proposalbudgetline` for Connor's 2026-05-15 review."

Working assumptions from the catalog:
- 1:N parental from `akoya_request`
- Per-row contact lookup + role choice + percent effort + optional biosketch attachment reference

### Options

**Option A — Minimal pilot shape.** One row per person:

| Field | Type | Notes |
|---|---|---|
| `wmkf_proposalrosterid` | PK | |
| `wmkf_name` | Text(160) | Synthesized |
| `_wmkf_request_value` | Lookup → `akoya_request` | Parental, cascade delete |
| `_wmkf_contact_value` | Lookup → `contact` | The roster member |
| `wmkf_role` | Choice | `PI / Co-PI / Senior Personnel / Key Personnel / Other` |
| `wmkf_effortpct` | Whole Number (0–100) | Per-person committed effort |
| `wmkf_biosketchurl` | Text(500) | Pointer to biosketch in SharePoint |
| `wmkf_lineorder` | Whole Number | Display order |

**Option B — Inline biosketch.** Same as A but the biosketch lives as a Dataverse file attachment on the row, not a SharePoint URL.

**Option C — Use existing `wmkf_apprequestperson`** junction (memory mentions this exists) instead of a new entity, if its role taxonomy is close enough.

### Recommendation

**Option A** if `wmkf_apprequestperson` doesn't have the shape we need; **Option C** if it does. Connor's call — he knows that entity's current usage.

### Rationale

1. Option A is the minimum viable shape per the catalog's working assumptions.
2. Biosketch as URL (Option A) sidesteps storing PDFs in Dataverse — SharePoint already holds them via the intake portal's attachment flow.
3. Option C is preferred if `wmkf_apprequestperson` already serves an overlapping purpose; we don't want two roster entities. Connor knows.

---

## 4. `wmkf_priordecisionstatus` field on `wmkf_portal_membership`

### Context

The membership approval slice (`/apply/admin/memberships`) handles re-applications: an applicant who was previously rejected or revoked re-applies, and the staff member needs to see "this applicant was rejected on 2026-05-01 for reason X" before deciding again.

Without persisting the prior decision status, the only way to infer it is from `wmkf_rejectionreason` (null vs. non-null), which can't distinguish "previously revoked with no reason given" from "previously approved and then re-requested."

### Option

Add one choice field to `wmkf_portal_membership`:

| Field | Type | Values |
|---|---|---|
| `wmkf_priordecisionstatus` | Choice | `null` (no prior decision) \| `Rejected` \| `Revoked` \| `Approved` |

The applicant-side upsert snapshots the prior status into this field before flipping `wmkf_approvalstatus` back to `Requested`. The admin slice's approve/reject clears the field back to null after the new decision.

### Recommendation

**Add it.** No alternative considered — inference from rejection reason is fragile.

### Rationale

One additional choice field. Future-compatible: same field powers any post-pilot history view we might build.

---

## 5. Live-verify four field additions to `akoya_request`

### Context

The budget form spec adds four fields to `akoya_request`:

| Field | Type | Purpose |
|---|---|---|
| `wmkf_projectyears` | Whole Number | 1 / 2 / 3 — drives form column visibility |
| `wmkf_totalwmkfrequested` | Currency | Cached aggregate; sum of all budget-line amounts. $100K-multiple invariant applies |
| `wmkf_totalothersources` | Currency | Cached aggregate; sum of cost-share amounts |
| `wmkf_totalprojectcost` | Currency | Sum of the above two |

### The ask

Connor live-verifies that none of these collide with existing `akoya_request` attributes in the production org. The Atlas page for `akoya_request` documents key/sample-probed fields, but the entity has 364 fields and the Atlas isn't exhaustive — so absence from the Atlas doesn't prove absence in the org.

### Recommendation

**Connor runs `Get-CrmEntityAttributes` (or equivalent) for `akoya_request` and confirms.** If there's a collision, we rename; cost is low.

### Rationale

Cheap pre-deploy sanity check that prevents a deploy-time conflict. Five minutes of his time.

### ✅ RESOLVED — `[VERIFIED via probe]` 2026-05-18 (S163), done in-house, no Connor needed

This is a **read-only metadata GET**, not a Connor/PowerShell dependency. Closed by `scripts/probe-slice0-attr-collision.mjs` (client_credentials → `EntityDefinitions/Attributes`, no writes):

- **Net-new surface is ONE field, not three.** Of the three fields tabled above, only **`wmkf_totalothersources`** is net-new on `akoya_request`; `wmkf_totalwmkfrequested`/`wmkf_totalprojectcost` reuse existing AkoyaGO fields (`akoya_request` = WMKF requested, `akoya_expenses` = total project cost) per `wave4-existing/akoya_request-intake-aggregates.json` `_comment`. The "three fields" framing here is stale relative to the final spec.
- **`akoya_request`** — **577** live attributes (the "364 fields" estimate above was itself an undercount; the live probe is authoritative): `wmkf_totalothersources` → **clear**.
- **`wmkf_apprequestperson`** — 35 live attributes; the slice-0 roster fields `wmkf_effortpct` / `wmkf_biosketchurl` / `wmkf_lineorder` → **all clear** (this existing-entity surface was not in the original ask but carries the identical silent-no-op risk under creation-only `apply-dataverse-schema.js`).

No rename needed. Collision check is **off the slice-0 critical path**. Re-run the probe at deploy time (point-in-time, like the role-data probe).

---

## 6. Does AkoyaGO surface inline edit on `wmkf_proposalbudgetline` rows?

### Context

The budget form caches three cumulative totals on `akoya_request` (`wmkf_totalwmkfrequested`, `wmkf_totalothersources`, `wmkf_totalprojectcost`). The drain cron is the only normal-operation writer to budget children, so the aggregates stay consistent **if the drain is the only writer.**

If AkoyaGO surfaces an inline edit grid on `wmkf_proposalbudgetline` rows directly (the way some Dynamics solutions surface child sub-grids on the parent form), then a staff member editing a child amount in AkoyaGO would silently invalidate the cached aggregates on the parent.

### Options

**Option A — Drain is the only writer (AkoyaGO has no inline-edit grid).** Pilot is fine; we add a daily reconcile cron as defense-in-depth.

**Option B — AkoyaGO does surface inline edits.** We need a Dataverse business rule or plug-in that recomputes the aggregates on any child-row write — adds complexity, but keeps the cache consistent.

### Recommendation

**Connor confirms which is true.** Recommendation depends on his answer.

### Rationale

This is the one item where pilot correctness genuinely depends on his confirmation. If Option B is real, we add ~half a day of plug-in work; if Option A, we ship the daily reconcile cron as a backstop and move on.

---

## 7. Cover-doc PA template — does category collapse lose detail?

### Context

The form's Operations section has six fixed sub-rows: Consumable Supplies, Animal Costs, Travel/Symposia, Contracted Services, Renovations, Facilities/Overhead. The catalog's `wmkf_category` enum has six values: Personnel, Equipment, Supplies, Travel, Other Direct, Indirect.

The mapping the spec proposes:

| Form row | `wmkf_category` |
|---|---|
| Consumable Supplies | Supplies |
| Animal Costs | Other Direct |
| Travel / Symposia | Travel |
| Contracted Services | Other Direct |
| Renovations | Other Direct |
| Facilities / Overhead | Indirect (always 0) |

Three form rows (`Animal Costs`, `Contracted Services`, `Renovations`) plus dynamic "Other Operations" rows all collapse to `Other Direct`. The applicant-specific identity is preserved in `wmkf_description` and the new `wmkf_rolecode`.

The catalog notes that Connor's cover-doc PA "reads the rows + populates a Word template grouped by year + category."

### The question

Does the cover-doc PA's reviewer-facing display group **by category alone**, or does it surface `wmkf_description` / `wmkf_rolecode` so reviewers see "Animal Costs: $15,000" rather than "Other Direct: $X total"?

### Options

**Option A — PA surfaces description/rolecode.** Category collapse is fine; the spec ships as-is.

**Option B — PA groups by category alone.** Category collapse loses reviewer-facing detail. Two fixes: (1) expand the catalog's `wmkf_category` enum to add Animal Costs / Contracted Services / Renovations as their own values, or (2) Connor's PA template starts using description/rolecode.

### Recommendation

**Option A** preferred; **Option B with the enum expansion** if the PA can't be reworked.

### Rationale

Enum expansion is reversible but adds three category values. Reworking the PA to use description is more flexible long-term but is Connor's effort. His call based on PA complexity.

---

## 8. Naming picks

### Context

Two naming questions are open from the catalog:

- `wmkf_proposalcostshare` (proposed) vs alternatives — `wmkf_costshare`, `wmkf_othersources`, `wmkf_institutionalcontribution`
- `wmkf_proposalroster` vs `wmkf_personnel`

### Options for cost-share entity

- `wmkf_proposalcostshare` — mirrors `wmkf_proposalbudgetline` prefix convention
- `wmkf_costshare` — shorter
- `wmkf_othersources` — matches the form section name
- `wmkf_institutionalcontribution` — most semantically precise

### Options for roster entity

- `wmkf_proposalroster` — mirrors `wmkf_proposalbudgetline` prefix
- `wmkf_personnel` — shorter, less specific

### Recommendation

**`wmkf_proposalcostshare`** and **`wmkf_proposalroster`** for consistency with `wmkf_proposalbudgetline`.

### Rationale

The `wmkf_proposal*` prefix groups intake-related child entities together in Dataverse's entity browser. Consistency aids discoverability long-term.

---

## FYI 1 — Drain attribution target

### Context

The submission drain cron writes to Dataverse asynchronously. `MSCRMCallerID` impersonation is how we attribute writes to a specific identity in the Dataverse audit log. Two options were considered:

- **Option A** — drain writes attribute to the existing "WMK: Research Review App Suite" app user systemuserid via `MSCRMCallerID`. Audit log shows "WMK Research Review App Suite" as the modifier.
- **Option B** — drain writes attribute to the OAuth service principal directly (no `MSCRMCallerID` header). Audit log shows "Application User" as the modifier, less differentiation.

### Decision

**We picked Option A.** Connor can object if he'd rather see a dedicated "Intake Portal Drain" app user created for the audit segregation, but the WMK Research Review app user is already in place and adding another is overhead.

---

## FYI 2 — `$batch` is not implemented in our Dataverse service

### Context

The ideal idempotency story for the drain would be: in one Dataverse `$batch` request, delete all existing budget children for this request, insert the new ones, update the parent aggregates. Atomic across all three.

`$batch` is not currently implemented in `lib/services/dynamics-service.js` — only individual `createRecord`, `updateRecord`, `deleteRecord` helpers exist.

### Pilot workaround

The drain runs as a sequence of individual Web API calls with **explicit progress markers** in `submission_jobs.dynamics_patches`:

1. Recompute aggregates from payload; hard-validate $100K-multiple (fail permanently if violated).
2. Query existing children.
3. Delete one-by-one, marker after each.
4. Insert one-by-one, marker after each.
5. PATCH aggregates on `akoya_request`.

Retries resume from the last marker. Per-`request_id` advisory lock prevents two drains interleaving on the same request.

### Trade-off

There's a brief window between "children written" and "aggregates updated" where the cached totals are stale. Bounded by the drain's wall-clock time **plus any 429-backoff retries** — under transient failure this can stretch from seconds to hours.

### Phase 1+ work

Adding `$batch` to `dynamics-service.js` is portal-wide infrastructure work (benefits every async-drain consumer, not just budget). Tracked separately; doesn't block pilot.

### Flagging now

So you're not surprised if you watch the drain in production and see two-step writes instead of atomic ones.

---

## Already settled — not asks

For clarity, these are decisions made this morning or this afternoon. We don't need to re-litigate them at this meeting unless you want to push back.

- **Item 1A — `wmkf_portal_membership` shape** signed off this morning.
- **Item 1B — Phase II Pending PA flows origin-agnostic** — your statement; verification at the 2026-05-26 dry-run. Flow-list email turnaround target was today; awaiting your response.
- **Item 1C — PA-built reviewer packet on `'Phase II Pending'` flip** — you own the build.
- **Item 1D — Pilot scope = budget + roster real entities.** Item 1 above is a scope nudge to add cost-share.
- **Budget-form name:** `wmkf_proposalbudgetline` (catalog matches).
- **Aggregate fields on `akoya_request`:** three Currency fields cached on the parent — Item 5 above is the live-collision verification ask.
- **`wmkf_projectyears` lives on `akoya_request`**, not a separate cycle/opportunity entity.
- **Idempotency strategy:** delete-and-replace with progress markers (see FYI 2).
- **Facilities/Overhead row always written, identified by `wmkf_rolecode='facilities-overhead'`.**
- **Headcount / Effort types:** Whole Number for both.
- **`$100K`-multiple invariant** enforced at submit + drain time.
- **`intake_audit` events** cover autosave, submit-enqueue, externalize success/fail, validation fail.
- **Numeric option-set values** for `wmkf_category` and `wmkf_sourcetype` — we pick at slice 0 deploy, Atlas records them.

---

## What happens after this meeting

If we get sign-off on items 1–8, the schema deploy slice can ship by 2026-05-19 (calendar-checkpoint target). That unblocks:
- Membership approval slice build (`INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md` v4 already drafted)
- Budget-form skeleton build (UI structure ready; wiring ready)
- 2026-05-26 dry-run target

If sign-off is partial — e.g., we discover a problem on Item 1 and need a second cost-share-entity sketch — we slip the schema deploy by a few days and tighten the calendar.
