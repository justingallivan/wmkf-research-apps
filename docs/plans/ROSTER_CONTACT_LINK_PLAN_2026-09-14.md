---
title: Roster Contact Link — Resolve Board and Consultant Emails from Dataverse Contacts
domain: meeting-tracker
kind: plan
status: proposed
summary: "PROPOSED 2026-09-14; adversarial review 2026-09-14 READY WITH NAMED CHANGES (folded in). Link expertise_roster rows to Dataverse contacts by GUID so the shared recipient directory reads Board/Consultant email from the contact record instead of a hand-maintained Postgres column. Roster row id stays the attendee identity; Dataverse is read-only in this plan. Awaits owner decisions D1–D4 (D2a is the server rule for D2)."
cataloged: 2026-09-14
last_verified: 2026-09-14
owner: product-engineering
related:
  - docs/PC_MEETING_TRACKER_PLAN.md
  - docs/atlas/postgres-infra-tables.md
  - docs/atlas/dataverse-wmkf-sitevisit.md
  - docs/API_ROUTE_SECURITY_MATRIX.md
---

# Roster Contact Link

## 0. Problem

Board members cannot be added to a deliberation session (owner report 2026-09-14). The
picker lists every active Board roster row, but the shared recipient resolver refuses any
row without an email, and no active roster row has one.

| Role type (active rows) | With `preferred_email` | Total |
|---|---|---|
| Board | 0 | 9 |
| Consultant | 0 | 25 |
| Research Program Staff | 0 | 4 |

[VERIFIED via read-only production Postgres query, 2026-09-14, owner-supplied credentials:
`SELECT role_type, COUNT(*), COUNT(preferred_email) FROM expertise_roster WHERE is_active
GROUP BY role_type`; the complement (`preferred_email IS NOT NULL`) returned zero rows for
every role type. Inactive rows were not queried.]

The owner confirms the relevant Board members and several of the most used consultants
already exist as Dataverse contacts with emails. The app never reads those: Board and
Consultant email comes only from `expertise_roster.preferred_email`, added by migration 035
as a "staff-maintained preferred address" for Site Visit correspondence
[VERIFIED via `lib/db/migrations/035_site_visit_logistics.sql:69`,
`lib/services/site-visit/recipient-directory-service.js:24-31,100`].

PR #294 (branch `fix/meeting-tracker-2026-09-14`) makes the failure self-explaining
(named 409, disabled "no email" chips) but adds no emails. This plan removes the second copy.

## 1. Current state [VERIFIED 2026-09-14 via source]

- `expertise_roster` columns: `id, name, preferred_email, role_type, role, affiliation, orcid,
  … , is_active, created_by, updated_by`. No Dataverse contact reference of any kind
  [`scripts/setup-database.js:1400-1419`].
- Writers: `pages/api/expertise-finder/roster.js` (POST/PATCH, `requireAppAccess('expertise-finder')`
  line 38, `allowedFields` list at line 203) and `scripts/seed-expertise-roster.js` (INSERT
  of name/role/expertise columns only, lines 106-110; it does not write `preferred_email`).
  The Expertise Finder editor already has a Preferred Email input
  [`pages/expertise-finder.js:568-576`].
- Directory: `getSiteVisitRecipientDirectory` returns `{ staff, external }`. Staff email is
  joined live from Dataverse `systemusers`; external email is `normalizeSiteVisitEmail(preferred_email)`
  [`recipient-directory-service.js:94-113`]. The strict resolver throws 409 on `!row.email`
  [lines 137-149]. `preferred_email` has exactly these two readers outside the Expertise
  Finder [VERIFIED via `grep -rn preferred_email lib pages shared`].
- Directory consumers (all read `external[].email` as a delivery value, never as identity):
  - Meeting Tracker picker and strict/lenient resolvers [`lib/services/meeting-tracker/attendee-service.js:165-235,306`].
    The picker projects `ref, name, email, affiliation` only.
  - Workbench site-visit recipients route: strips `systemUserId` from staff but returns
    `external` rows as-is [`pages/api/workbench/site-visit/recipients.js:17-20`]; the context
    hook filters on `row?.email` [`shared/components/workbench/useSiteVisitContext.js:43-49`].
  - Site-visit Activity parties: external attendees bind by `addressused: row.email` +
    `unresolvedpartyname`; staff additionally carry `systemUserId`
    [`lib/services/site-visit/logistics-service.js:226-232`].
  - Consultant feedback dropdown reads `id, name, affiliation` only; no email
    [`lib/services/consultant-feedback-service.js:139-146`].
  - Schedule reader and session list: each loads the directory once and resolves attendees
    fail-open (a directory failure empties attendees, never fails the read)
    [`lib/services/meeting-tracker/schedule-reader.js:75-90`,
    `lib/services/meeting-tracker/session-service.js:388-399`].
  - Expertise Finder list/detail display `member.preferred_email` directly
    [`pages/expertise-finder.js:424-425,457-465`]; the roster GET returns `SELECT *`
    [`pages/api/expertise-finder/roster.js:71,116`], so the editor will see the new column
    without touching the directory.
- Precedent for "reference-only, resolve live": the Site Visit distribution picker stores
  Contact GUIDs in an app setting and resolves name/email from `contactAdapter.getByIds`
  (≤50 GUIDs per call, `statecode === 0`, `emailaddress1`)
  [`lib/services/site-visit/curated-recipient-service.js:1-9,139-190`; `lib/dataverse/adapters/contact.js:87-104`].
- Contact adapter already offers `getByIds`, `searchDirectoryByName` (partial-name picker
  search, bounded), `searchByName` (identity-ranked), and `findByOrcidCandidates`
  (exact `wmkf_orcid`; active first, then a historical fallback; returns `{ one }`,
  `{ ambiguous }`, `{ ambiguous, inactiveOnly }`, or `{ none }`)
  [`contact.js:87,235,283,187-210,44-59`]. Client-supplied GUIDs are
  validated with `isGuid` from `lib/utils/guid.js` before reaching any selector
  [`guid.js:1-30`].

## 2. Recommendation

**Add a nullable `dataverse_contact_id` to `expertise_roster` and resolve email from the
linked contact.** The roster row id stays the attendee identity, so every saved session and
site-visit attendee map, the `staff` / `roster` ref kinds, D24 agenda recipients, and the
409 / disabled-chip behavior from PR #294 are untouched. Dataverse is **read-only** in this
plan; no contact is created or modified.

Rejected alternatives:
- *Replace roster refs with contact refs (`kind: 'contact'`) in attendee maps.* Changes the
  persisted attendee-ref schema, both editors, the lenient/strict resolvers, and the
  site-visit party binding for a problem that a foreign key solves. Not worth it now.
- *Keep `preferred_email` and just populate it.* Unblocks Thursday's meeting (still the
  recommended interim step, §3 slice 0) but leaves a second copy staff must keep current.

### 2.1 Target model

| Concern | Authority |
|---|---|
| Who is on the roster, role type, active flag, affiliation, expertise fields | Postgres `expertise_roster` (unchanged) |
| Attendee identity in saved session / site-visit maps | `expertise_roster.id` (unchanged) |
| Email for a **linked** row | Dataverse `contact.emailaddress1`, only while `statecode = 0` |
| Email for an **unlinked** row | `expertise_roster.preferred_email` (existing behavior) |

Directory resolution (`getSiteVisitRecipientDirectory`):
1. `listRoster` also selects `dataverse_contact_id`.
2. Linked GUIDs are fetched with `contactAdapter.getByIds`, chunked at `CONTACT_BATCH_MAX_IDS`
   (38 active rows today; chunk anyway), in parallel with the existing staff/system-user read.
3. For a linked row: contact found and active → `email = normalizeSiteVisitEmail(emailaddress1)`;
   contact missing, inactive, or without a usable email → `email = null`. **No fallback to
   `preferred_email` for a linked row**: that would reintroduce a stale second copy, and
   `null` already produces the named 409 and the disabled chip.
4. External rows carry a boolean `linked` (never the GUID; no directory consumer needs it,
   the editor reads the roster GET). Both meeting-tracker picker projections build objects
   with explicit fields (`attendee-service.js:207-224,299-315`), so `linked` must be **added**
   to both and pinned in the picker test; the workbench recipients route passes `external`
   through as-is, acceptable for a boolean, pinned by a new route test
   (`tests/unit/workbench-site-visit-recipients-route.test.js`; none exists today).
5. The strict resolver's remedy copy branches on `linked`
   (`assertAttendeeEmailsOnFile`, `lib/services/meeting-tracker/attendee-service.js:165-180`,
   remedy string at line 173, and its JSDoc at 158-164, both of which say "preferred email on
   the Expertise Finder roster", which D1 makes wrong for a linked row): linked → "their
   Dataverse contact is inactive, missing, or has no email; fix or relink the contact, or
   unlink the roster row". Same hint on the disabled chip `title` (`NO_EMAIL_HINT` in
   `SessionEditor.js:64` and `SiteVisitEditor.js:73`). Both editors also render one
   section-level paragraph of the same constant when any row lacks an email
   (`SessionEditor.js:490`, `SiteVisitEditor.js:248`); with two possible causes in one
   section that constant cannot be right, so the paragraph becomes cause-neutral ("Greyed
   names have no email on file; hover a name for the reason.") and the per-chip `title`
   carries the cause. Grep for "Expertise Finder roster" finds no other copy surface.
6. `getContactsByIds` is called only when at least one row is linked
   (`ids.length ? getContactsByIds(ids) : Promise.resolve([])`, the pattern at
   `curated-recipient-service.js:145-150`). Only `tests/unit/site-visit-recipient-directory.test.js:26-33`
   fakes `listRoster` and needs the new function; `tests/unit/meeting-tracker-attendees.test.js`
   fakes the whole directory and instead needs `linked` rows to exercise the remedy branch.

Failure modes: the directory already fails when Dataverse `systemusers` is unreachable, so
the contact read adds no new outage class. A capped/oversized read is impossible by
construction (chunked exact-GUID filter).

### 2.2 Owner decisions needed

- **D1 Precedence when a row has both a link and a `preferred_email`.** Recommendation: the
  link wins and `preferred_email` is ignored for that row (§2.1 step 3).
- **D2 Whether `preferred_email` becomes read-only in the editor once a row is linked.**
  Recommendation: yes, shown greyed with "from Dataverse contact"; unlinking re-enables it.
- **D3 Unlinked consultants.** 25 active consultants exist and only "several" have contacts
  (owner, 2026-09-14). Recommendation: leave unlinked rows on the manual column
  indefinitely; the editor shows "Not linked" so staff can link when a contact appears. No
  requirement to create contacts.
- **D4 Linked row whose contact is inactive, missing, or email-less** (for example a CRM
  duplicate merge deactivates the contact the roster points at, the day before a session).
  Recommendation: the row resolves to no email (§2.1 step 3); the 409 and the chip hint name
  the Dataverse cause (step 5); the editor shows the same warning beside the link with an
  Unlink button, and unlinking restores the manual column. No silent fallback.
- **D2a Server rule for D2.** The Expertise Finder editor PATCHes the whole row on every
  save (`pages/expertise-finder.js:295-307` spreads `member` into the form and sends it), and
  the PATCH pre-read selects `id` only (`roster.js:197`), so a rule of "reject any request
  containing `preferred_email` for a linked row" would 400 every save. The rule must be
  value-based and keyed on the row's **resulting** link state: pre-read
  `id, dataverse_contact_id, preferred_email`; resulting link = submitted
  `dataverse_contact_id` when the body contains it, else stored. When the resulting state is
  linked, a submitted `preferred_email` that normalizes non-null (`normalizePreferredEmail`,
  `roster.js:26-35`; stored values are already normalized by every write path) and differs
  from the stored value → 400; an unchanged value is accepted; an empty value (the editor
  sends `""` when cleared and `null` when untouched on a null row, `pages/expertise-finder.js:549-553,571-576`;
  both normalize to null) is accepted and writes null. The editor reaches that branch on
  every save of a linked row whose manual copy is already null (a null-to-null write) and
  when a user clears the field and picks a contact in the same save; D2 therefore greys the
  field as soon as a contact is chosen in-form, and D4's unlink restores whatever manual
  value is stored, possibly empty, after which the unlinked-row 409 remedy applies.
  Same-request combinations: link + new email → 400; link + the row's unchanged existing
  email → accepted (the common case, because the editor always resubmits the whole row);
  unlink + email → accepted (resulting state unlinked, manual column active again); on POST,
  a `preferred_email` that normalizes non-null together with a link → 400 (the add form's
  default is `""`, `pages/expertise-finder.js:542`, which normalizes to null and is accepted).

## 3. Build slices

| Slice | Tier | Content |
|---|---|---|
| **0 Interim unblock** | data only | Owner enters the 9 Board preferred emails in the Expertise Finder before 2026-09-17. Reversible. Whether slice 3 later auto-links these rows depends on the Board rows carrying real ORCIDs [ASSUMED; both insert paths default to the `'N/A'` placeholder, `roster.js:170` and `scripts/seed-expertise-roster.js:112`, and PATCH allows `orcid` at `roster.js:204` and writes the raw value at `:215-217`]; if not, Board links are made by owner confirmation or in the slice 2 editor. |
| **1 Column + directory** | 1 | Migration `049_expertise_roster_contact_link.sql`: `ADD COLUMN dataverse_contact_id UUID NULL`, partial unique index `WHERE dataverse_contact_id IS NOT NULL` (introduces a one-roster-row-per-contact invariant; today one-person-one-row is a seed-only convention, `scripts/seed-expertise-roster.js:95-97`, and the editor POST has no name dedupe), column comment. Manifest entry **and** the fresh-install DDL in `scripts/setup-database.js:1399-1419` (no gate checks column parity; `preferred_email` lives in both). `listRoster` select; `getSiteVisitRecipientDirectory` resolution per §2.1 steps 1–6 with `getContactsByIds` injected via `DEFAULT_DEPENDENCIES`. `roster.js` PATCH/POST: `dataverse_contact_id` in `allowedFields`, guard `value === null || isGuid(value)` else 400 with message (today a bad value would hit the UUID cast and surface as the generic 500 at `roster.js:253-257`), unique-index violation 23505 → 409 naming the roster row already linked, `null` to unlink; D2a server rule if D2 is adopted (pre-read gains `dataverse_contact_id, preferred_email`; rule keyed on resulting link state). Remedy-copy branch in `assertAttendeeEmailsOnFile` plus its JSDoc and both editors' chip hint; `linked` added to both picker projections. Tests: linked-active, linked-inactive, linked-missing, unlinked, mixed batch >50, no-linked-rows skips the contact read, picker emits `linked`, new workbench route shape test, PATCH 400/409 and every D2a combination including link + unchanged email → accepted. |
| **2 Link UI** | 1 | Expertise Finder editor: "Dataverse contact" field with a bounded name search and a Clear button. New route `GET /api/expertise-finder/contact-search?q=` → new service `lib/services/expertise-finder/roster-contact-link-service.js` wrapping `searchDirectoryByName` (route never touches the adapter; `check:route-service-boundary`). Returns `contactId, fullname, emailaddress1 (normalized), active`. Matrix row (`check:api-routes` requires one per route file; the new file also shifts the route-count fact in `CANONICAL_COUNTS`). `/api/expertise-finder` is not a `ROUTE_NAMESPACE_LIFECYCLE` namespace [`shared/config/appRegistry.js:349-372`], so plain `requireAppAccess('expertise-finder')` applies. Note: `check:trust-boundary-guid` fires only when tainted input reaches a Dataverse selector (`scripts/check-trust-boundary-guid.js:21-36`); the roster PATCH writes Postgres, so the gate is silent there and `isGuid` is required for clean 400s and for `getByIds`'s own GUID guard, not for the gate. Editor list/detail (`pages/expertise-finder.js:424-425,457-465`) show "from Dataverse contact" for linked rows instead of the manual column. |
| **3 Backfill** | 0 (script, dry-run default) | `scripts/link-roster-contacts.js`: for each active Board/Consultant row without a link, (a) exact `findByOrcidCandidates(orcid)` when the roster ORCID is valid, else (b) `searchByName(name)` accepting only a single ranked candidate that is active and has an email. Prints a proposal table; `--apply` auto-writes **ORCID matches only**, and only when `findByOrcidCandidates` returns `{ one: true }` (an `ambiguous` or `inactiveOnly` result is reported, never written). Name-only candidates are listed for per-row owner confirmation (`--confirm <rosterId>=<contactId>`), because `rankNameRows`/`namesMatch` accept a single-letter first-initial prefix (`lib/utils/contact-parser.js:641-668`), so a lone ranked candidate can be the wrong person with the same surname; abstention on ambiguity does not cover a false-unique match. The roster's `'N/A'` ORCID placeholder normalizes to `malformed` and is skipped safely. **The owner runs it** (`feedback-never-self-authorize-prod-dataverse-reads`). Do not predict how middle-initial names ("James S. Economou") rank; the dry run shows it. |
| **4 Reconcile** | 0 | Atlas `postgres-infra-tables.md` roster entry (+ column; its "zero preferred-email values before staff population" claim becomes historical), `dataverse-wmkf-sitevisit.md` §directory, matrix rows for `/api/meeting-tracker/recipients`, `/api/workbench/site-visit/recipients`, `/api/expertise-finder/roster`, PC plan §5 attendee line, `docs/agent-wiki/topics/dataverse-dynamics.md`. Run `/sweep` for the "preferred email is the only Board email source" fact. |

Slices 1–2 land on one fresh branch from `main` with PR and deliberate promotion; slice 3 is
run once by the owner after 1 deploys; slice 4 rides with 1–2.

## 4. Contract reconcile (Mode A, plan review) — 2026-09-14

**Surface:** roster→directory→attendee resolution gains a Dataverse contact hop.
**Entry points:** Expertise Finder editor + roster API (write), meeting-tracker recipients and
workbench site-visit recipients routes (read), backfill script.
**Persistence:** Postgres `expertise_roster` (new column). Dataverse read-only.
**Consumers:** §1 list. **Prior findings verified:** none (new plan).

### Findings

1. **CONFIRMED — Identity does not change, so persisted attendee maps need no migration.**
   Evidence: `attendee-service.js:52-62` (refs are `staff:profileId` / `roster:rosterId` only);
   `logistics-service.js:226-232` (external party carries email + name, no roster key).
   Residual risk: none.
2. **CONFIRMED — Every consumer reads `email` as a delivery value and tolerates `null`.**
   Evidence: `attendee-service.js:137-140,165-183` (lenient → issue, strict → named 409);
   `useSiteVisitContext.js:47` (`.filter((row) => row?.email)`);
   `shared/components/meeting-tracker/SessionAgendaPanel.js:87-93` (`disabled={!email}`).
   Residual risk: none.
3. **CONFIRMED — Chunking is required by contract, not just prudence.**
   Evidence: `contact.js:91-93` throws above 50 IDs. Slice 1 must chunk and the test must
   include >50 linked rows.
4. **CONFIRMED — The seed script cannot violate the partial unique index.**
   Evidence: `scripts/seed-expertise-roster.js:106-110` inserts no email or contact column.
   The index itself is [PLANNED].
5. **CONFIRMED, superseded — The workbench recipients route passes `external` through as-is.**
   Evidence: `pages/api/workbench/site-visit/recipients.js:19-20` strips `systemUserId` from
   staff only. Resolved by not putting the GUID on directory rows at all (§2.1 step 4,
   boolean `linked`); the route test pins the shape.
6. **New issue, LOW — Site-visit external parties still bind by email string.** A linked
   Board member could instead bind as a `partyid` contact on the Activity. Out of scope
   here; recorded as follow-up F1 so the plan does not imply it.

### Audits

- Whole-flow: hops 1–9 traced above; the backfill script is the only writer outside the
  roster API and is dry-run by default.
- Partial success: directory resolution is per-row (a missing contact nulls one row, never
  fails the directory). Backfill `--apply` reports per-row outcomes.
- Async/stale: no new client effects; the two existing directory loads already have
  cancel guards (`useSiteVisitContext.js:41,58`; `SessionEditor.js:312,322` `current` flag).
- Helper extraction: none.
- Durable surface: migration 049 + manifest (`check:migrations-manifest`), Atlas
  (`check:atlas`), matrix rows (`check:api-routes`), doc-symbol refs. New route count shifts
  `CANONICAL_COUNTS` (`check:fact-consistency`), verify at build.
- Doc reconcile: slice 4 via `/sweep`.
- Symbol fan-out: `preferred_email` readers are exactly `recipient-directory-service.js:27,100`
  outside the Expertise Finder [VERIFIED via grep]; both change in slice 1.

### Recommendation evidence

| Recommendation | Current prerequisite | Available at execution point | Evidence tested | Disconfirming check | Status |
|---|---|---|---|---|---|
| Link by GUID, resolve live via `getByIds` | adapter `getByIds`, `statecode`, `emailaddress1` in `FIELD_SELECT` | yes, `contact.js:31,87-104`; same pattern live in `curated-recipient-service.js:139-190` | pattern is production-proved for the distribution picker (Atlas `dataverse-wmkf-sitevisit.md`) | a contact with no `emailaddress1` → row nulls, 409 names it (PR #294) | VERIFIED |
| Keep roster id as identity | refs contain only `rosterId` | yes | `attendee-service.js:52-62` | any consumer keyed on email as identity? site-visit party uses email as delivery value only (`logistics-service.js:226-232`) | VERIFIED |
| Backfill by ORCID then unique name | `findByOrcidCandidates`, `searchByName` | yes, `contact.js:187,235` | NOT TESTED against production names | dry run must show ≥1 ambiguous case handled by abstention | ASSUMED |

### Verdict

**READY WITH NAMED CHANGES** once D1–D4 are decided. Named changes: chunked `getByIds`
with a >50 test (finding 3); boolean `linked` instead of a GUID on directory rows
(finding 5); the two `preferred_email` readers updated together.

### Adversarial review — 2026-09-14 (fresh agent, refuting pass)

Verdict **READY WITH NAMED CHANGES**; all nine changes are folded into §1–§3 above:
D4 and the remedy-copy branch (CRM-merge scenario); `linked` boolean replaces `contactId`;
`scripts/setup-database.js` DDL; conditional `getContactsByIds` plus test-fake additions;
roster PATCH 400/409 mapping, `allowedFields`, D2 server rule; backfill auto-writes ORCID
matches only; `check:trust-boundary-guid` claim corrected; `schedule-reader.js` consumer and
the one-person-one-row invariant recorded; editor list/detail display in slice 2. The
reviewer confirmed every [VERIFIED] citation in §1 and §4 against source, and that no
consumer joins email back to a roster row (`logistics-service.js:197-199,266-282` and
`SessionAgendaPanel.js:22-26,86-92` dedupe by email as a delivery value only).

**Second refuting pass (same day, on the folded revision)**: READY WITH NAMED CHANGES, all
folded: the D2 server rule is now value-based (D2a; the editor sends the whole row);
`linked` must be added to both explicit picker projections (§2.1 step 4); remedy-copy
citation corrected to `attendee-service.js:165-180` and the JSDoc added as a copy surface;
test-fake sentence corrected; `session-service.js:388-399` added to consumers;
`findByOrcidCandidates` result shape corrected and `--apply` gated on `{ one }`; the unique
index "introduces" rather than "encodes" the invariant; `null || isGuid` guard; a new
workbench route test named; slice 0 carries the Board-ORCID [ASSUMED] caveat.

**Third scoped pass (same day, on the second fold)**: READY WITH NAMED CHANGES, no design
rework; folded: D2a pre-read adds `preferred_email` and the rule keys on the resulting link
state (the "unlink + email" case was contradicted by the earlier wording); the section-level
no-email paragraph in both editors is named as a copy surface and made cause-neutral; the
remedy string names all three D4 causes; `listRoster` fake citation corrected; the seed's
`'N/A'` ORCID default added to the slice 0 caveat. Confirmed: the ORCID lookup cannot return
`{ one }` for an inactive contact (`contact.js:49-62`); the editor is the only roster
client and always PATCHes the whole row.

**Fourth scoped pass (same day, on the third fold)**: READY WITH NAMED CHANGES, all wording:
added the "link + unchanged existing email → accepted" combination (the common editor case)
and its test; stated the empty-value clearing semantics and the POST phrasing; "fix or relink"
covers the missing-contact cause; seed citation `:112` and "insert paths". Confirmed: every
`preferred_email` writer normalizes (column and normalizer share commit `ffaa293b`); no
third render of the section hint; the editor is the only roster client.

**Fifth scoped pass (same day, on the fourth fold)**: READY WITH NAMED CHANGES, wording with
one implementation consequence, folded: the POST clause says "normalizes non-null" (the add
form submits `""`); the empty-value branch is reachable from the editor, so the false
"non-editor client only" claim is replaced with the two editor paths and the in-form D2
greying; ORCID PATCH citation split into allowlist and write lines.

## 5. Out of scope / follow-ups

- **F1** Bind linked external site-visit attendees as `partyid` contacts instead of
  `addressused` strings (finding 6). Separate plan; touches the sandbox-proved party
  replacement path.
- **F2** Writing back to Dataverse (creating contacts for unlinked consultants). Not needed;
  D3 keeps them on the manual column.
- **F3** Roster hygiene: an active Consultant row named "TBD: Neurodegeneration specialist"
  appears in the consultant-feedback dropdown as a person [VERIFIED via the §0 query].
- **F4** The session editor copy "The fixed staff list is selected for new sessions" sits
  beside a "Default attendees are not configured" notice. Pre-existing; not touched.
