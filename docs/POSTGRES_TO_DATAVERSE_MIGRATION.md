# Postgres → Dataverse Migration Map

**Created:** 2026-04-22 (Session 106)
**Status:** **Wave 1 COMPLETE 2026-05-12** (Postgres tables dropped). Wave 2 in progress (per `REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md`). This document remains as historical schema-design context; live state lives in the Atlas.
**Target environment:** Prod (`akoyago.crm.dynamics.com`). Sandbox path was used during Wave 1 staging; Wave 1 cutover to prod 2026-04-24, drop 2026-05-12.

## Read this first: ground truth lives in the Atlas

**This doc was written assuming a researcher-pool design that was NOT what landed.** For live state of any entity/table, the canonical reference is now the Application State Atlas (`docs/APPLICATION_STATE_ATLAS.md`). When this doc and an Atlas page disagree, the Atlas is authoritative.

Specific divergences between this doc and the as-built system (verified 2026-05-07):

- **Naming convention.** This doc proposes `wmkf_app_<name>` (with underscore between `app` and `<name>`). Live deployments use `wmkf_app<name>` (no underscore). Wave 1 entities are deployed as `wmkf_appuserappaccesses`, `wmkf_appuserpreferences`, `wmkf_appsystemsettings`. Wave 2 current live entities include `wmkf_appreviewersuggestion` and `wmkf_appgrantcycle`; historical deployed-and-now-dropped entities included `wmkf_appresearcher` and `wmkf_apppublication`. Treat all `wmkf_app_<name>` references in this doc as the underscored-schema-as-code names; production is the no-underscore variant.
- **Person model (Wave 2 preview).** This doc's "Person model" section described a free-standing researcher pool (`wmkf_app_researcher` accumulated across cycles, optional `wmkf_contact` lookup at promotion). What got built was a **1:1 sidecar** (`wmkf_appresearcher` ↔ `wmkf_potentialreviewer`, scoped to per-proposal slots). **S213: that sidecar was collapsed onto `wmkf_potentialreviewer` and dropped** — bibliometrics now live on the person. See `docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md` (Session 136) for the original design and `docs/archive/APPRESEARCHER_COLLAPSE_PLAN_V2.md` for the collapse.
- **Wave 1 status.** COMPLETE. Flags flipped 2026-05-03; behavioral verification 2026-05-11 confirmed zero prod writes; Postgres tables (`system_settings`, `user_app_access`, `user_preferences`) dropped 2026-05-12 via migration `007_drop_wave1_tables.sql`. Dispatcher services now default to Dataverse (explicit `WAVE1_BACKEND_*=postgres` fails loudly). Recovery via Neon PITR available until 2026-05-19. See `project-wave1-closeout-role-tail.md` for the app-user temp-role tail; role state needs a fresh probe before action.
- **Wave 2 entity list.** This doc mentions `wmkf_app_proposal_search` and `wmkf_app_publication_author` as Wave 2 deliverables. Live state: `wmkf_appproposalsearch` IS deployed — entity-set name uses the unconventional plural `wmkf_appproposalsearchs` (no `e` before `s`), currently 0 rows. The publication-author schema file was `wmkf_app_z_publication_author.json`; its deployed logical name was `wmkf_apppublicationauthor` (no `_z_`). It was deployed empty and **DROPPED S213** alongside `wmkf_apppublication` and `wmkf_appresearcher`.

## Purpose

Every Postgres table in the current system, categorized by migration disposition — **migrate**, **merge**, **stay**, **eliminate** — with proposed Dataverse targets, column mappings, relationship shapes, and ownership decisions. This doc is the schema spec we hand to Connor before any creation code runs.

---

## Verdict summary

27 tables in Vercel Postgres today:

| # | Postgres table | Verdict | Dataverse target | Notes |
|---|---|---|---|---|
| 1 | `search_cache` | **Eliminate** | — | Short-lived PubMed/arXiv API cache. Replace with in-memory cache. |
| 2 | `researchers` | **Migrate** | `wmkf_app_researcher` | **Narrowed** to bibliometric pool. Optional lookup to `contact` when promoted. |
| 3 | `publications` | **Migrate** | `wmkf_app_publication` | No more `researcher_id` FK — authorship becomes its own junction. |
| 4 | `researcher_keywords` | **Merge** | `wmkf_app_researcher` columns | Handful of keywords fit as columns on researcher. |
| 5 | `reviewer_suggestions` | **Migrate** | `wmkf_app_reviewer_suggestion` | Points at `contact` (required) + `wmkf_app_researcher` (optional, provenance). |
| 6 | `proposal_searches` | **Migrate** | `wmkf_app_proposal_search` | Per-proposal Claude analysis event log. |
| 7 | `grant_cycles` | **Migrate** | `wmkf_app_grant_cycle` | **Net-new table** — there is no `akoya_grantcycle` entity in Dynamics today. |
| 8 | `user_profiles` | **Merge** | `systemuser` (extend) | Drop our shadow table; use native Dynamics user. |
| 9 | `user_preferences` | **Migrate** | `wmkf_app_user_preference` | Per-user — **only table with User-level Read restriction** (holds secrets). |
| 10 | `retractions` | **Stay** | — | 63K+ rows, GIN-indexed array search. Postgres is the right tool. |
| 11 | `integrity_screenings` | **Migrate** | `wmkf_app_integrity_screening` | Staff-reviewable; low volume. |
| 12 | `screening_dismissals` | **Migrate** | `wmkf_app_screening_dismissal` | Child of `wmkf_app_integrity_screening`. |
| 13 | `dynamics_user_roles` | **Eliminate** | — | Redundant with Dataverse security roles. |
| 14 | `dynamics_restrictions` | **Migrate** | `wmkf_app_dynamics_restriction` | Small, admin-editable config. |
| 15 | `dynamics_query_log` | **Stay** | — | High-volume audit log; Postgres is cheaper/faster for analytics. |
| 16 | `api_usage_log` | **Stay** | — | Very high volume. Dashboards already query it. |
| 17 | `user_app_access` | **Migrate** | `wmkf_app_user_app_access` | Staff-visible; links to `systemuser`. |
| 18 | `system_settings` | **Migrate** | `wmkf_app_system_setting` | Admin-only key/value. |
| 19 | `system_alerts` | **Stay** | — | Time-series, ops-facing. |
| 20 | `health_check_history` | **Stay** | — | Every-15-min sampling; pure time-series. |
| 21 | `maintenance_runs` | **Stay** | — | Cron audit trail. |
| 22 | `dynamics_feedback` | **Migrate** | `wmkf_app_dynamics_feedback` | Staff review this in Dynamics forms. |
| 23 | `expertise_roster` | **Migrate** | `wmkf_app_expertise_roster` | Single table, dual person-lookup (staff → systemuser, consultant/board → contact). |
| 24 | `expertise_matches` | **Migrate** | `wmkf_app_expertise_match` | Per-match event log. Future: child rows per recommendation. |
| 25 | `panel_reviews` | **Migrate** | `wmkf_app_panel_review` | Multi-LLM review runs. |
| 26 | `panel_review_items` | **Migrate** | `wmkf_app_panel_review_item` | Child of `wmkf_app_panel_review`. |

**Totals:** 16 migrate to new custom tables, 2 merge into existing (`systemuser`, `researcher_keywords` into researcher), 2 eliminate, 7 stay in Postgres.

**New table counts:** 16 `wmkf_app_*` tables, plus two junction tables called out in the detail sections below (`wmkf_app_publication_author` for authorship; potential future `wmkf_app_expertise_match_item`).

---

## Person model

The single most important cross-cutting decision. Three Dataverse entities represent people; no crossover.

| Entity | Represents | Populated by |
|---|---|---|
| **`systemuser`** | Keck internal staff — Azure-authenticated | akoyaGO / IT provisioning |
| **`contact`** | External people — applicants, PIs, grantees, invited reviewers, consultants, board members | akoyaGO applicant/grantee flows; our app when a researcher is promoted |
| **`wmkf_app_researcher`** | Bibliometric candidate pool — PubMed/arXiv/ORCID data | Our Reviewer Finder's discovery process |

**Rules:**

- Staff are **always** `systemuser`, never `contact`.
- External people are **always** `contact`. Applicants become contacts when they submit; reviewers become contacts when they're invited.
- `wmkf_app_researcher` is a *bibliometric profile*, not a person-of-relationship. Most researchers in the pool will never become contacts.
- When a researcher is invited to review: match-or-create a `contact` (see **Match-on-promote** below), then link `wmkf_app_researcher.wmkf_contact` to it.
- The same human can have one `wmkf_app_researcher` row (bibliometric) and one `contact` row (relationship) — the link connects them.

### How "previous grantee" surfaces

Not a stored flag. Derivable at query time:

> For a given `contact`, is there an `akoya_request` where `_akoya_applicantid_value` equals this contact AND the request was funded?

If dashboards need it faster, denormalize into `contact.wmkf_is_past_grantee` (boolean, refreshed by a PA flow when grant status changes). Start derived; only denormalize when the pain is real.

### Walk-through — John Smith's life

| Event | What gets written |
|---|---|
| **2022:** John submits Phase I as PI | `contact` John Smith (akoyaGO applicant flow); `akoya_request` with `applicantid → John's contact` |
| **2023:** Grant funded | `akoya_request.statuscode = funded` — John is now inferably a past grantee |
| **2024:** Reviewer Finder surfaces John from PubMed | `wmkf_app_researcher` row created if absent; match-on-promote finds existing `contact`, links them |
| **2024:** Staff invite John to review a different proposal | `wmkf_app_reviewer_suggestion` row with `wmkf_reviewer_contact → John's contact`, `wmkf_researcher_source → John's researcher` |
| **2026:** Staff invite John again for a new proposal | New `wmkf_app_reviewer_suggestion` row, same contact |

One human, one `contact` row, any number of reviewer suggestions across cycles.

---

## Cross-cutting decisions

### Naming convention

- **Publisher prefix** stays `wmkf_` (Dataverse system-managed; can't be changed for a publisher that's already in use).
- **Custom table names** use `wmkf_app_<name>`. The `app_` namespace signals "this table belongs to the Research Review App Suite" and distinguishes our artifacts from other Keck custom work.
- **Custom column names on our own tables** use plain `wmkf_<name>` — the table already identifies the scope.
- **Existing columns on vendor tables** (e.g., `akoya_request.wmkf_ai_summary`, `wmkf_ai_run`) — **leave as-is**. Connor created these under the previous convention. Not worth the disruption to rename.

### Drop our shadow user table

Today: every per-user table carries `user_profile_id INTEGER` → `user_profiles.id`. Our `user_profiles` table shadows `systemuser`, linked via `azure_id`.

In Dataverse: everything resolves to `systemuser` directly via `ownerid` (the out-of-box owner field on every user-owned table). Per-user filtering becomes `_ownerid_value eq <systemuser guid>` instead of a join.

### Grant cycles — net-new table, not an extension

There is no `akoya_grantcycle` entity in Dynamics today. Cycle identity is carried *on each `akoya_request`* via:

| Field on `akoya_request` | Type | Purpose |
|---|---|---|
| `wmkf_meetingdate` | Date | **Ground truth — board meeting date.** |
| `akoya_fiscalyear` | Text | Cycle label. Verified 2026-04-22: uses long format `"June 2026"`, `"December 2026"` (not short codes). |
| `akoya_decisiondate` | Date | When the decision was recorded. |

We create `wmkf_app_grant_cycle` as a net-new table keyed to the fiscal year string via an **alternate key**. Joined to requests by text match — no new lookup column added to `akoya_request` (don't modify the vendor table for a soft relationship the string match handles cleanly).

**Operational rules:**

- The app **never** writes to `akoya_fiscalyear` or `wmkf_meetingdate`. Those belong to akoyaGO's business process.
- Our cycle rows' `wmkf_meeting_date` is a denormalized copy; truth is on the request.
- "List all cycles" = query `wmkf_app_grant_cycle` filtered on `wmkf_is_active`. Don't scan requests for distinct fiscal years.
- "Which cycle is this request in?" = read `akoya_fiscalyear` off the request, use it as the alt-key lookup into our cycle table if cycle metadata is needed.

### Ownership vs. visibility

In Dataverse these are **orthogonal**:

| Concept | What it controls |
|---|---|
| **Ownership type** (`UserOwned` / `OrganizationOwned`) | Schema-level — whether rows have an `ownerid` column at all |
| **Access level** in a security role (User / Business Unit / Org) | Runtime — how wide a user's Read/Write/Delete privilege reaches |

akoyaGO's convention is that **all staff see all business data**. We match that: staff security role grants **Organization**-level Read on every one of our tables. But `UserOwned` tables still carry `ownerid` — for provenance ("who ran this match") not privacy.

| Table | Ownership type | Why |
|---|---|---|
| `wmkf_app_reviewer_suggestion`, `wmkf_app_proposal_search`, `wmkf_app_integrity_screening`, `wmkf_app_expertise_match`, `wmkf_app_panel_review`, `wmkf_app_panel_review_item`, `wmkf_app_screening_dismissal` | `UserOwned` | `ownerid` = the staff member who created the record. Visible to all staff via org-level Read. |
| `wmkf_app_researcher`, `wmkf_app_publication`, `wmkf_app_publication_author`, `wmkf_app_grant_cycle`, `wmkf_app_expertise_roster`, `wmkf_app_user_app_access`, `wmkf_app_system_setting`, `wmkf_app_dynamics_restriction`, `wmkf_app_dynamics_feedback` | `OrganizationOwned` | Shared reference data; no meaningful per-user owner. |
| **`wmkf_app_user_preference`** | `UserOwned` **+ User-level Read** | **Exception** — holds encrypted secrets. Each staff member sees only their own row. |

### Choice columns

VARCHAR enums become Dataverse **Choice** columns:

| Source column | Values | Dataverse choice |
|---|---|---|
| `reviewer_suggestions.review_status` | accepted, materials_sent, under_review, review_received, complete | `wmkf_review_status` |
| `reviewer_suggestions.response_type` | accepted, declined, no_response | `wmkf_response_type` |
| `integrity_screenings.screening_type` | applicant, reviewer, panel | `wmkf_screening_type` |
| `integrity_screenings.status` | pending, reviewed, cleared, flagged | `wmkf_screening_status` |
| `expertise_roster.role_type` | staff, consultant, board | `wmkf_role_type` |
| `panel_reviews.status` | pending, running, complete, error | `wmkf_panel_status` |
| `dynamics_feedback.feedback_type` | thumbs_up, thumbs_down, auto_detected | `wmkf_feedback_type` |

Default to local (per-table) choices unless we see clear reuse across tables.

### JSONB → Dataverse

Dataverse has no JSONB. Three strategies:

1. **Multi-line text** (default) — works when < 1 MB and we're storing-not-querying.
2. **Child table** — when the JSON is a repeating structure we query into.
3. **Postgres-backed reference** — for very large blobs; store a Postgres row-id on the Dataverse record, hydrate on demand.

Most current JSONB columns are audit payloads — option 1 is fine. Flag for option 2 noted in the Wave 4 preview (`expertise_matches.match_results`).

### Relationship pattern

- User-scoped rows point to `systemuser` via the built-in `ownerid`.
- Proposal-scoped rows have a custom many-to-one lookup `wmkf_request → akoya_request`.
- Grant-cycle-scoped rows use the soft text join via `akoya_fiscalyear`.
- Person references use `wmkf_systemuser` (→ systemuser) or `wmkf_contact` (→ contact) or both for the roster (one populated per row).

---

## Match-on-promote and retroactive reconciliation

When a researcher is invited to review (promoted from pool → active contact), we must avoid creating a duplicate contact if one already exists.

### Match-on-promote (required at invitation time)

Match keys against `contact`, in order:

1. **ORCID** — exact match on `contact.wmkf_orcid`. Highest confidence. **akoyaGO tracks ORCID on contact today** with ~24% population per the schema annotation — meaningful coverage, especially for previously-invited reviewers and past PIs.
2. **Email** — exact match on `contact.emailaddress1`, normalized (lowercase, strip `+tag`). Broader coverage than ORCID; slightly lower confidence (shared addresses, role mailboxes).
3. **Name + affiliation** — fuzzy. Requires human confirmation ("is this the same person?") before linking.

If no match: create a new `contact`. Link `wmkf_app_researcher.wmkf_contact` to the new or existing contact.

ORCID + email together give us two high-confidence exact-match paths covering a majority of real-world cases. The fuzzy-name path is only the tail.

### Retroactive reconciliation (background job)

One-time (then periodic) pass over all `wmkf_app_researcher` rows with null `wmkf_contact`:

- For each, attempt ORCID match against `contact.wmkf_orcid`, then email against `contact.emailaddress1`.
- Populate `wmkf_app_researcher.wmkf_contact` when confident.
- Skip fuzzy name matches without confirmation — those wait until a human touches them.

Low priority relative to initial migration, but high-value once built: "does this researcher have any foundation history?" becomes a single-query lookup for every future match Reviewer Finder surfaces. With ORCID-on-contact already populated at 24%, we'll get immediate hits on the first-pass run.

See also: `docs/DYNAMICS_IDENTITY_RECONCILIATION_PLAN.md` — parallel work for `systemuser` side of this problem.

---

## Solution strategy (Plan B)

**Named unmanaged solution from day 1, scripted creation via Dataverse Web API, managed export for prod.**

1. **Create solution `ResearchReviewAppSuite`** in sandbox on day one. Publisher: existing `wmkf_` prefix publisher. All custom artifacts live in this solution from the first table onward.
2. **Schema defined as code in this repo.** YAML or JSON files per table, under `lib/dataverse/schema/` (or similar). Describes tables, columns, choices, relationships, alternate keys.
3. **Scripted creation** (`scripts/apply-dataverse-schema.js`). Reads schema files, calls Dataverse Web API, idempotent (checks existence, creates or updates). Runs against `DYNAMICS_SANDBOX_URL` by default; prod requires an explicit flag.
4. **Managed export for prod.** Export `ResearchReviewAppSuite` from sandbox via maker-portal or API. Hand to Connor (or import ourselves if the app user is registered in prod with sufficient role).
5. **No `pac` / Power Platform CLI dependency.** Keeps tooling unified with how we work elsewhere.

The scripted-creation approach also gives us git-diffable schema, review-before-merge, and zero-drift between repo and environment.

---

## Priority waves

Migration doesn't happen all at once. Wave 1 is fully specified below; later waves get detail passes when their turn comes.

### Wave 1 — User + access foundation ✅ shipped 2026-04-24

`systemuser` (extend), `wmkf_app_user_preference`, `wmkf_app_user_app_access`, `wmkf_app_system_setting`

Why first: everything downstream looks back at `systemuser`. Get ownership and access-grant plumbing working before any data table moves.

**Status (refreshed 2026-05-12):** CLOSED. Prod cutover 2026-04-24, flags flipped to `dataverse` 2026-05-03 (after a 6-day silent-fallback gotcha — see `project-wave1-closeout-role-tail.md`), Postgres tables dropped 2026-05-12 via `lib/db/migrations/007_drop_wave1_tables.sql`. Live entity sets: `wmkf_appsystemsettings`, `wmkf_appuserpreferences`, `wmkf_appuserappaccesses`. Dispatcher services default to Dataverse; explicit `WAVE1_BACKEND_*=postgres` fails loudly. Neon PITR recovery window until 2026-05-19.

**Single deferred tail item:**
- Remove temp role elevations per `docs/WAVE1_REVERT_TEMP_ELEVATIONS.md` only after rerunning the role probe in that doc; current temp-role state is not repo-verifiable from this historical migration map.

### Wave 2 — Reviewer Finder core
`wmkf_app_researcher`, `wmkf_app_publication`, `wmkf_app_publication_author`, `wmkf_app_proposal_search`, `wmkf_app_reviewer_suggestion`, `wmkf_app_grant_cycle`

Why second: richest schema, exercises every cross-cutting pattern (choices, lookups, junctions, alt keys, person model). Previewed in detail below.

### Wave 3 — Integrity Screener
`wmkf_app_integrity_screening`, `wmkf_app_screening_dismissal`

(Retractions stays in Postgres.)

### Wave 4 — Expertise Finder + Virtual Panel
`wmkf_app_expertise_roster`, `wmkf_app_expertise_match`, `wmkf_app_panel_review`, `wmkf_app_panel_review_item`

Previewed at the end.

### Wave 5 — Admin / app-config
`wmkf_app_dynamics_restriction`, `wmkf_app_dynamics_feedback`

---

## Wave 1 — full spec

### `systemuser` (extend)

Add these columns to existing `systemuser`. All optional.

| Column | Type | Postgres source |
|---|---|---|
| `wmkf_app_avatar_color` | Text (7) | `user_profiles.avatar_color` |
| `wmkf_app_needs_linking` | Yes/No | `user_profiles.needs_linking` |

Fields that DON'T migrate (superseded by native `systemuser` columns):
- `name`, `display_name` → `systemuser.fullname`, `domainname`
- `azure_id`, `azure_email` → `systemuser.azureactivedirectoryobjectid`, `internalemailaddress`
- `is_default`, `is_active` → `systemuser.isdisabled`
- `created_at`, `last_login_at`, `last_used_at` → `systemuser.createdon`, `lastaccessedtime`

### `wmkf_app_user_preference`

Ownership: `UserOwned`. **Access: User-level Read only** — each staff member sees only their own preferences. Exception to the org-wide visibility rule.

| Column | Type | Notes |
|---|---|---|
| `wmkf_preference_key` | Text (100) | Alt-key with `ownerid` |
| `wmkf_preference_value` | Multi-line text | Encrypted blob when `wmkf_is_encrypted = true` |
| `wmkf_is_encrypted` | Yes/No | |
| `ownerid` | Lookup → systemuser | Built-in |
| `createdon`, `modifiedon` | DateTime | Built-in |

### `wmkf_app_user_app_access`

Ownership: `OrganizationOwned`. Org-level Read for all staff.

| Column | Type | Notes |
|---|---|---|
| `wmkf_user` | Lookup → systemuser | The user being granted |
| `wmkf_app_key` | Text (100) | e.g. `batch-phase-i-summaries` (matches `appRegistry.js`) |
| `wmkf_granted_by` | Lookup → systemuser | Distinct from the "admin who created the row"; explicit for clarity |
| `createdon` | DateTime | Built-in |

Alternate key: (`wmkf_user`, `wmkf_app_key`) — enforces one row per user-app pair.

### `wmkf_app_system_setting`

Ownership: `OrganizationOwned`. Org-level Read.

| Column | Type | Notes |
|---|---|---|
| `wmkf_setting_key` | Text (255) | Primary name; unique |
| `wmkf_setting_value` | Multi-line text | |
| `wmkf_updated_by` | Lookup → systemuser | |
| `createdon`, `modifiedon` | DateTime | Built-in |

---

## Wave 2 — preview spec

### `wmkf_app_researcher`

Ownership: `OrganizationOwned`. Org-level Read.

| Column | Type | Postgres source |
|---|---|---|
| `wmkf_name` | Text (255) | `researchers.name` (primary name attribute) |
| `wmkf_normalized_name` | Text (255) | `researchers.normalized_name` |
| `wmkf_primary_affiliation` | Text (500) | |
| `wmkf_department` | Text (255) | |
| `wmkf_email` | Text (255) | |
| `wmkf_orcid` | Text (50) | Alt-key candidate |
| `wmkf_google_scholar_id` | Text (100) | |
| `wmkf_google_scholar_url` | Text (500) | |
| `wmkf_orcid_url` | Text (255) | |
| `wmkf_h_index`, `wmkf_i10_index`, `wmkf_total_citations` | Whole number | |
| `wmkf_faculty_page_url`, `wmkf_website` | Text (500) | |
| `wmkf_notes` | Multi-line text | Conflicts, preferences |
| `wmkf_keywords` | Multi-line text | Merged from `researcher_keywords` — space- or comma-separated |
| `wmkf_metrics_updated_at`, `wmkf_last_checked`, `wmkf_contact_enriched_at` | DateTime | |
| `wmkf_email_source`, `wmkf_contact_enrichment_source` | Text (100) | |
| **`wmkf_contact`** | Lookup → contact (nullable) | **Populated when promoted to foundation contact** |

No `researcher_keywords` table — keywords merge into the researcher row as a text column. If that doesn't scale, we can break out later.

### `wmkf_app_publication`

Ownership: `OrganizationOwned`. Org-level Read. **No `researcher_id` FK** — authorship is its own junction.

| Column | Type | Postgres source |
|---|---|---|
| `wmkf_title` | Multi-line text | Primary name attribute (long titles don't fit single-line) |
| `wmkf_authors_raw` | Multi-line text | `publications.authors[]` joined as text — preserves full list for display |
| `wmkf_journal` | Text (500) | |
| `wmkf_doi` | Text (100) | Alt-key |
| `wmkf_pmid`, `wmkf_pmcid`, `wmkf_arxiv_id` | Text | |
| `wmkf_publication_date` | Date | |
| `wmkf_year` | Whole number | |
| `wmkf_citations` | Whole number | |
| `wmkf_abstract` | Multi-line text | |
| `wmkf_source` | Text (50) | "pubmed", "arxiv", etc. |
| `wmkf_url` | Text (500) | |

### `wmkf_app_publication_author` (junction)

Ownership: `OrganizationOwned`. Org-level Read. Solves the "publication has many authors" M:N correctly.

| Column | Type | Notes |
|---|---|---|
| `wmkf_publication` | Lookup → wmkf_app_publication | |
| `wmkf_researcher` | Lookup → wmkf_app_researcher | |
| `wmkf_author_position` | Whole number | 1 = first author, etc. |

Alternate key: (`wmkf_publication`, `wmkf_author_position`).

The full author list is preserved as text on `wmkf_app_publication.wmkf_authors_raw`; junction rows only exist for authors we actually track as researchers.

### `wmkf_app_grant_cycle`

Ownership: `OrganizationOwned`. Org-level Read.

| Column | Type | Notes |
|---|---|---|
| `wmkf_fiscal_year_code` | Text (50) | **Alternate key.** Matches `akoya_request.akoya_fiscalyear` — e.g., `"June 2026"` |
| `wmkf_meeting_date` | Date | Denormalized copy of `wmkf_meetingdate` on requests in this cycle |
| `wmkf_display_name` | Text (255) | Primary name attribute; e.g., `"June 2026 Board Meeting"` |
| `wmkf_summary_pages` | Text (50) | Max pages for reviewer summaries (e.g., `"2"`) |
| `wmkf_review_return_deadline` | Date | When reviewers must submit |
| `wmkf_review_template_url`, `wmkf_review_template_filename` | Text | Vercel Blob URL + filename |
| `wmkf_additional_attachments` | Multi-line text | JSON-as-text |
| `wmkf_is_active` | Yes/No | |

### `wmkf_app_proposal_search`

Ownership: `UserOwned`. Org-level Read (staff see everyone's searches).

| Column | Type | Notes |
|---|---|---|
| `wmkf_proposal_title` | Multi-line text | |
| `wmkf_proposal_hash` | Text (64) | For dedupe on repeated searches |
| `wmkf_author_institution` | Text (255) | |
| `wmkf_request` | Lookup → akoya_request (nullable) | Hard link when the proposal is a known request |
| `wmkf_request_number` | Text (20) | Soft ref when hard link isn't available |
| `wmkf_grant_cycle_code` | Text (50) | Soft ref; looks up `wmkf_app_grant_cycle` via alt key |
| `wmkf_claude_suggestions` | Multi-line text | JSON |
| `wmkf_search_queries` | Multi-line text | JSON |
| `wmkf_verified_count`, `wmkf_discovered_count` | Whole number | |
| `wmkf_summary_blob_url` | Text (500) | |
| `ownerid` | Lookup → systemuser | Built-in |

### `wmkf_app_reviewer_suggestion`

Ownership: `UserOwned`. Org-level Read. The big junction — one row per (reviewer, proposal, cycle) candidate.

| Column | Type | Notes |
|---|---|---|
| `wmkf_reviewer_contact` | Lookup → contact | **Required.** The person being invited. |
| `wmkf_researcher_source` | Lookup → wmkf_app_researcher | Optional — the bibliometric row that surfaced the candidate |
| `wmkf_request` | Lookup → akoya_request | The proposal |
| `wmkf_grant_cycle_code` | Text (50) | Soft ref to cycle; derivable from request but cached for query speed |
| `wmkf_program_area` | Text (100) | |
| `wmkf_relevance_score` | Float | |
| `wmkf_match_reason` | Multi-line text | |
| `wmkf_sources` | Text (500) | Comma-separated (PubMed, ORCID, etc.) |
| `wmkf_review_status` | Choice | `accepted \| materials_sent \| under_review \| review_received \| complete` |
| `wmkf_response_type` | Choice | `accepted \| declined \| no_response` |
| `wmkf_selected`, `wmkf_invited`, `wmkf_accepted`, `wmkf_declined` | Yes/No | Legacy flags; may consolidate into `wmkf_response_type` later |
| `wmkf_email_sent_at`, `wmkf_email_opened_at`, `wmkf_response_received_at`, `wmkf_materials_sent_at`, `wmkf_reminder_sent_at`, `wmkf_review_received_at`, `wmkf_thankyou_sent_at` | DateTime | Outreach lifecycle tracking |
| `wmkf_reminder_count` | Whole number | |
| `wmkf_review_blob_url`, `wmkf_review_filename` | Text | Where the completed review lives |
| `wmkf_proposal_url`, `wmkf_proposal_password` | Text | Shared per-proposal access materials |
| `wmkf_notes` | Multi-line text | |
| `ownerid` | Lookup → systemuser | The staff member who suggested/owns the row |

Alternate key: (`wmkf_reviewer_contact`, `wmkf_request`) — one suggestion per person-proposal pair.

This table replaces all the Postgres columns that duplicated proposal data (`proposal_title`, `proposal_abstract`, `proposal_authors`, `proposal_institution`, `request_number`, `proposal_id`) — they come from the `wmkf_request` lookup now.

---

## Wave 4 preview — expertise roster

### `wmkf_app_expertise_roster`

Ownership: `OrganizationOwned`. Org-level Read. **Single table, dual person-lookup.**

| Column | Type | Notes |
|---|---|---|
| `wmkf_role_type` | Choice | `staff \| consultant \| board` |
| `wmkf_systemuser` | Lookup → systemuser | Populated **iff** `wmkf_role_type = staff` |
| `wmkf_contact` | Lookup → contact | Populated **iff** `wmkf_role_type ∈ {consultant, board}` |
| `wmkf_primary_fields`, `wmkf_keywords`, `wmkf_subfields_specialties`, `wmkf_methods_techniques`, `wmkf_distinctions`, `wmkf_expertise` | Multi-line text | Identical shape across all three role types — enables uniform matching |
| `wmkf_keck_affiliation`, `wmkf_keck_affiliation_details` | Text / Multi-line text | |
| `wmkf_is_active` | Yes/No | |

**Business rule:** exactly one of `wmkf_systemuser` / `wmkf_contact` populated, determined by `wmkf_role_type`. Enforced by Dataverse business rule or app-layer check.

The parallel shape across role types is deliberate — the matching algorithm returns three recommendation lists (staff lead / consultant helpers / board interests) from the same expertise columns.

---

## Data migration approach (post-schema)

Once schemas exist in sandbox for a wave:

1. **One-way sync script** — reads from Postgres, writes to Dataverse Web API. Idempotent (uses alternate keys to detect existing rows, UPSERTs). Doesn't delete from Postgres yet.
2. **Dual-read validation** — for ~1 week, new API routes read from Dataverse but fall back to Postgres on miss. Log any divergence.
3. **Cutover** — API routes read/write Dataverse only. Postgres tables marked read-only.
4. **Decommission** — Postgres tables dropped (with a final backup blob dump).

---

## Open questions

1. **Match-on-promote: fuzzy name threshold.** ORCID/email are exact. For name+affiliation, what similarity score triggers "likely match, ask human" vs "probably not, ignore"? Need a prototype + real data to calibrate.
2. **Publication-author coverage.** Do we want junction rows for *every* known author in our researcher table, or only when the author-researcher link is actively surfaced? The former is more correct; the latter saves storage for researchers we may never invite.
3. **Cost of `wmkf_app_panel_review_item` in Dataverse.** 15–20 child items per panel run × hundreds of proposals/year = a few thousand rows annually. Not huge, but worth a reality-check before committing.
4. **Business rule enforcement vs. app-layer enforcement** for the "exactly one of systemuser/contact populated" constraint on the roster. Business rules are native but harder to test; app-layer is easier but bypassable via direct API calls.
5. **Retention on stay-in-Postgres tables.** `api_usage_log`, `dynamics_query_log`, `health_check_history`, `maintenance_runs` need explicit retention policies (90 days? 365?). Already have cleanup crons.

---

## Future enhancements (not in scope for initial migration)

1. **Role field on `contact`.** Wave 4's dual-lookup roster handles staff/consultant/board via `wmkf_role_type` on the roster row. Native role/category on `contact` itself would make "list all consultants" / "list all board members" a one-query view without going through the roster table. Check existing akoyaGO contact customizations first; may already exist.
2. **Explode `expertise_matches.match_results` JSONB into child rows.** Once we're generating three-way recommendations (staff leads / consultant helpers / board interests), storing each recommendation as a `wmkf_app_expertise_match_item` child row enables queries like "show me everywhere board member Alice was recommended across proposals." Defer until 3-way recommendations ship.
3. **`wmkf_is_past_grantee` denormalized boolean on `contact`.** Derivable today via `akoya_request` query; only denormalize if the derived-query cost becomes visible.
4. **PA flow: keep `wmkf_app_grant_cycle.wmkf_meeting_date` in sync** with per-request `wmkf_meetingdate` changes. Drift is unlikely but possible if the board moves a meeting date.

---

## Related docs

- `docs/RETROSPECTIVE_ANALYSIS_PLAN.md` — division of labor (PA vs. apps); generic BYO-prompt app may produce tables that land here
- `docs/PROMPT_STORAGE_DESIGN.md` — `wmkf_ai_prompt` (the prompt-template table Connor built; the originally-proposed `wmkf_prompt_template` name was renamed before shipping; precursor to this migration, now live)
- `docs/BACKEND_AUTOMATION_PLAN.md` — PA flows read/write Dataverse; this migration makes our web apps play by the same rules
- `docs/DYNAMICS_IDENTITY_RECONCILIATION_PLAN.md` — parallel work on `systemuser` side of the person-reconciliation problem
- `docs/DYNAMICS_SCHEMA_ANNOTATION.md` — field annotations for `akoya_request`, including the fiscal-year / meeting-date fields this doc depends on
- `scripts/probe-sandbox-schema-perms.js` — confirms app can create/modify tables in sandbox
- `scripts/discover-dynamics-envs.js` — lists Dataverse environments the app can reach
- `scripts/probe-fiscal-year-format.js` — confirms real-world fiscal year format ("June 2026") against production requests
