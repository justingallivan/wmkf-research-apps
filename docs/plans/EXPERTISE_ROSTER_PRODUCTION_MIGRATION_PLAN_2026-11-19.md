# Expertise roster: production migration and Admin editor

**Status: PLANNED — two Claude Opus 5.5 OAuth adversarial reviews completed. Second verdict: READY WITH CHANGES; all earlier findings closed, with two Contact-preservation corrections incorporated below. See [review 1](EXPERTISE_ROSTER_OPUS_5_5_REVIEW_2026-11-19.md) and [review 2 with disposition](EXPERTISE_ROSTER_OPUS_5_5_REVIEW_2_2026-11-19.md). Owner subsequently authorized implementation on November 19; see [build evidence](EXPERTISE_ROSTER_BUILD_2026-11-19.md). Production execution remains pending.**

Owner direction, November 19, 2026: move the small, infrequently used roster from
Postgres to Dataverse and move its editor into Admin. Treat the roster as static
through the migration. Use production only; no sandbox, synchronization, dual
writes, concurrency locks, deployment-drain system, or automated rollback engine.
Backend matching automation and standalone Expertise Finder retirement are separate
later steps, not prerequisites for delivering this migration.

## 1. Deliverable and scope

[PLANNED] Dataverse owns the roster's editable content. Staff maintain it at
**Admin → People & Access → Expertise Roster**, proposed URL
`/admin?workspace=people&view=expertise-roster`. Connor can read the same table
through his existing Dataverse connection. There is no new HTTP roster API for
Power Automate and no additional Claude call in this migration.

The editor supports list/search, category filtering, include-inactive, add, edit,
deactivate, and reactivate. Preserve the existing expertise fields, optional
Contact reference, preferred email, staff User link, and lead-PD eligibility.
Use the existing Admin layout and editor patterns; no general Admin redesign.
Deletion is deactivation, preserving historical references.

[PLANNED] In Dataverse mode, the old Roster tab becomes a link to Admin for authorized
administrators; its legacy roster GET and mutation methods refuse access with a
clear moved-to-Admin response (409), rather than exposing the Admin DTO or User picker.
In Postgres mode, retain today's editor, with admin-only mutations and the cutover
marker enforced; Admin shows that its new editor becomes available at cutover.
This same Postgres-mode editor is the recovery path. There is only one writable
editor in either mode. Single and batch matching and saved matching history remain available in Expertise Finder
until the separate retirement step. Preserve their current behavior using the
new roster source; do not import a new recommendation product as part of this work.

## 2. Evidence and boundaries

| Claim | Evidence | Status |
|---|---|---|
| Current roster CRUD is in Expertise Finder and uses Postgres | `pages/api/expertise-finder/roster.js`; migrations 004, 035, 050 | VERIFIED via source |
| Admin has a People & Access workspace and navigation registry | `pages/admin.js`, `shared/components/admin/workspaces/PeopleWorkspace.js`, `shared/components/admin/AdminWorkspaceNavigation.js` | VERIFIED via source |
| Existing numeric roster IDs are used by feedback and recipient resolution | `lib/services/consultant-feedback-service.js`, `lib/services/site-visit/recipient-directory-service.js` | VERIFIED via source |
| Proposal lists use that recipient directory and store the roster ID in recipient provenance | `lib/services/proposal-lists/list-link-service.js` | VERIFIED via source |
| Last recorded production inventory: 39 roster rows, 7 feedback references, 344 match-history rows; target table absent | `docs/plans/evidence/expertise-migration-status-production-2026-11-18.json` on `origin/codex/expertise-roster-import-2026-11-10` | HISTORICAL probe, November 18; recheck before execution |
| Earlier schema/import/consumer work exists on the parked branch | `git diff --stat main...origin/codex/expertise-roster-import-2026-11-10` | VERIFIED branch work; not proof of deployment or production readiness |
| No competing roster edits need accommodation | Owner instruction in this chat | Accepted operating premise |

No fresh production probe was performed for this plan. Production table state,
row counts, permissions, and the migration ledger are execution-time checks.
Do not read main `.env.local`, self-enable production access flags, or copy
sandbox identities into production. Use the repository's existing authorized
production tooling and target/write interlock when execution is approved.

## 3. Minimal implementation

### Data and identities

**Contact-link preservation (owner-confirmed November 19):** copy every existing
`dataverse_contact_id` to the migrated profile's Contact reference, retaining the
exact same production Contact GUID. Do not rematch by name/email, replace the
Contact, or clear the link during category changes or deactivation. Unlinked people
remain unlinked. Report any invalid/conflicting link or linked row proposed for
exclusion before cutover; resolve it explicitly rather than silently dropping it.

Required changes to the parked importer/contract before reuse:
- Set `wmkf_contactguid` directly from the source `dataverse_contact_id` (the same
  lowercase canonical GUID, or null). Per-target mappings must not override or null
  it. A mapping mismatch or exclusion of a linked source row is a blocking dry-run
  error before any import writes, not the parked importer's warning.
- Remove the Staff ⇒ no-Contact restriction from both the import planner and shared
  roster contract. Staff may retain a Contact reference alongside a staff User link.
  Category changes must never require clearing an existing Contact. Include a
  linked Consultant → Staff case in importer and Admin-editor tests.

Reuse the earlier `wmkf_expertiseprofile` schema and useful importer/adapter pieces
after checking them against current main. Carry all existing roster content,
including inactive people and email behavior; keep audit provenance in the private
source export where native Dataverse audit fields cannot represent the original.
The parked schema reserves each linked Contact across active and inactive profiles;
keep that rule explicit in the editor, map conflicts to a readable 409, and allow
an administrator to clear the old link before reassignment. Optional Contact
references must stay optional: do not create Contacts for Board members. Preserve linked-contact email resolution; missing/inactive linked Contacts
must not silently fall back to a manual address.

Reuse the small numeric identity/binding bridge from the parked branch (not yet on
main) to preserve references from
Postgres feedback and saved recipient selections. It stores IDs, not a synchronized
copy of roster content. Retarget the feedback foreign key only after every referenced
numeric ID exists in the bridge. New people added in Admin receive a numeric mapping
as well as a Dataverse profile; test this path, not only the imported records.

Carry forward the owner's recorded mappings from the November 9 handoff: Justin
and Jean active/lead eligible; Beth active/not lead eligible; John E. Sader changes
to Research Program Staff, active/lead eligible; Kevin inactive; Amy Rowat staged
inactive with no User link or lead eligibility. Verify production GUIDs at import.
Store lead-PD eligibility for the later automation
step; this migration does not promise to change the standalone matcher's current
role-based recommendation policy. Its existing prompt treats Research Program Staff
as PD candidates; the new eligibility flag is not yet enforced by that matcher.
Exclude placeholder ID 35 from selectable profiles while preserving its referenced
numeric identity and feedback. The excluded author's display is explicitly
“Unavailable consultant”; do not delete or reassign that feedback. Other inactive
migrated people retain their historical names and affiliations.

Initially all roster creation/maintenance goes through Admin. Connor's connection
reads profiles; direct Dynamics-created profiles are not part of this release,
because existing application consumers also need the numeric mapping. Grant Connor's
flow identity read-only table privileges and inspect its effective permissions. If
its existing identity already has broader rights, resolve that access choice before
handoff; do not assume a read-only role removes permissions granted elsewhere.

### Editor and authorization

Extract the roster form/list into an Admin component. Add an Admin-owned API/service
entry point for CRUD and any Contact/User lookup needed by the editor. Apply the
existing `requireSuperuser` server guard, authenticated actor attribution, normal
request validation, and trusted DAL context. Hiding the old tab is not authorization.
Admin editing must work without an `expertise-finder` app grant. Disable legacy
mutation routes or apply the same admin guard and delegate to the same service;
never leave an app-grant-only write path. Consumer read routes keep their own
existing access policies, so ordinary meeting/feedback users still work. Inventory
current editors and confirm intended maintainers have Admin access; do not silently
grant superuser privileges as part of the move. `requireSuperuser` supplies a profile
ID, not a Dataverse actor ID: resolve the trusted session's mapped system-user ID
for impersonated saves and refuse missing identity, with no service-user fallback.

Confirm Dataverse permissions for the app's actual read/write identity and, where
writes impersonate the administrator, that user's permissions too. Preserve current
fail-closed behavior rather than falling back to a more privileged identity.

### App consumers

Route roster reads through the Dataverse adapter/projection in the editor, single
and batch matching, consultant eligibility and historical feedback hydration,
feedback attachment names, Site Visit/meeting recipients, and proposal-list recipients.
A Dataverse read error is an error/unavailable state, not an empty roster or silent
fallback to stale Postgres content. Keep existing match-history records in Postgres.
Add `withDalContext` around the single-match route's authenticated work: unlike the
batch route, its current SQL roster read has no Dataverse context. Verify with a
route test using the real DAL/context and mocked HTTP/model transport, not a mocked
roster service alone. Distinguish excluded ID 35 from a roster service outage:
failed historical hydration must propagate an unavailable status, including the
external briefing's existing `{ status: 'unavailable', items: [] }` path.
Adapt the roster projection to the existing matching contract wherever possible;
only change prompt/ID validation if that contract actually requires it.

Do not merge the parked branch wholesale. Omit sandbox/rehearsal infrastructure,
concurrency machinery, unrelated authentication/upload changes, and expanded
recommendation-output features. Runtime work goes on a new feature branch based on
current main; this planning change is documentation only.

## 4. Production cutover — one operator

1. **Prepare:** finish the bounded code change and focused tests; record the previous
   deployment and rollback command. Recheck the production roster, table metadata,
   referenced IDs, owner mappings, and migration ledger. Explicitly check John
   E. Sader's (ID 1) Contact link and duplicate Contact links across active AND
   inactive rows. Inventory references to
   changed IDs 1, 13, and 35 in feedback (including shared briefing entries), Site
   Visit identity maps, meeting attendee maps, and proposal-list provenance. Record
   deliberate eligibility changes; repair any affected editable attendee selection
   through the normal UI before acceptance, never guess or silently reassign it.
   Use a free migration number;
   do not assume the parked branch's number is still available. Prepare the private
   export and the exact expected imports/exclusions before production execution.
2. **Provision:** create/verify Expertise Profiles and required keys/permissions in
   production; apply the small bridge migration through `scripts/apply-migrations.js`.
   Deploy the new code with its roster backend setting still on Postgres. Only the
   empty bridge migration is available to the runner at this point; the FK change
   is a separate numbered migration introduced/applied at step 5. Run the migration
   runner by absolute path from an env-file-free directory with explicitly supplied
   authorized production configuration; it otherwise reads cwd `.env.local`. Inspect
   all pending migrations first, since it applies every unapplied file.
3. **Import:** run the one-shot importer against the saved export with stable creation
   keys. It reports success/failure per source ID. On a partial failure, keep the app
   on Postgres, fix the failed rows, and resume without duplicating successful ones.
   The first production binding activates the legacy write marker, so Postgres-mode
   roster reads remain available but edits refuse until completion or rollback.
   Explain this short import window in the UI; no concurrency coordination is needed.
   Change the reused marker message to point to Admin, not Expertise Finder.
4. **Compare:** verify every expected field, active/category value, Contact/User link,
   numeric mapping, and feedback reference, accounting explicitly for overrides and
   exclusions, and check the source still matches the export. Include changed saved
   recipients and the shared visibility of excluded ID 35 in the comparison.
   Do not switch on a count-only comparison or partial import success.
5. **Switch:** introduce/apply the separate feedback-FK migration; its SQL must
   refuse if any referenced ID is absent from the bridge. Keep the manifest and
   fresh-install schema aligned, and record the inverse SQL for rollback. Then set
   `EXPERTISE_ROSTER_BACKEND=dataverse`, and
   redeploy once. All roster edits now go through Admin to Dataverse. Legacy Postgres
   seed/contact-link scripts must refuse roster writes after cutover. Keep the old
   roster data intact for recovery; it is no longer the editable source of truth.
6. **Accept:** complete the focused checks below and have Connor read the table using
   his actual production connection. No email sends or paid matching runs are needed
   to prove the storage/editor move; the real-context test verifies matching input/
   output parity except for the recorded owner overrides.

## 5. Acceptance and recovery

Acceptance checks:

- Compare every source roster ID → Contact GUID pair with the imported mapping:
  no existing link is lost or changed. Confirm the Admin editor shows the same
  linked Contact and ordinary edits/deactivation/reactivation retain that link.
  Linked-contact email resolution continues to use that Contact's current email.
- Admin list/add/edit/deactivate/reactivate persists after reload; inactive people
  remain findable. A non-admin cannot mutate via either new or legacy routes, and an
  admin without Expertise Finder access can edit and use identity pickers.
- Existing feedback, including inactive/excluded authors, still opens. Its attachments
  retain correct author handling. A newly added consultant can be selected and saved.
- Meeting/Site Visit recipient selections resolve the same numeric identities and
  email rules except the documented owner overrides. Re-save affected attendee lists
  after explicit repair where needed; changing a person from Consultant to Staff can
  invalidate an old roster-kind attendee even though the numeric identity survives.
  Proposal-list recipients still populate; existing links stay intact.
- Single/batch matching receives the expected roster and validates results; saved
  history remains readable. Test unavailable Dataverse responses explicitly.
- Connor's production Dataverse connection reads the expected fields and its
  effective table permissions are read-only.
- Test identity binding failure after a profile save: the UI reports failure and retry repairs the
  mapping without creating a second person.

Use focused unit/integration tests with fixtures and one bounded production editor/
consumer acceptance pass. Use a clearly named test profile for create/edit checks,
then deactivate it. No sandbox environment or real matching-model charge is required.
Run relevant route, DAL, GUID, Atlas, migration, type, and documentation gates; keep
gates and their self-tests sequential. Update Atlas, route-security matrix, service
catalog, credential-setting documentation, and fresh-install schema with implementation.

Recovery, including a partial import: keep the current setting until the source is
ready. Compare the expected final import roster plus any post-cutover edits with
Postgres and manually reconcile all affected IDs first, not only edits since cutover.
Preserve John's category, Kevin's and ID 35's inactive/nonselectable state, Amy's
staged record, and any later additions with the same numeric IDs. Retain User links/
lead eligibility in the private export where legacy Postgres cannot express them.
If Dataverse cannot be read, use the import report and recorded acceptance edits;
resolve unknown edits before reopening the old store. Verify references, then restore
the old feedback FK if changed, switch to the tested Postgres-mode deployment, and
finally clear production bindings/the write marker to restore edits. Use the same
order when backing out a partial import. Include the inverse FK SQL and sequence
check in the short rollback runbook. A setting change alone is not rollback. Keep
Dataverse records for diagnosis; no automated reconciliation or table drops. A later
re-import reuses the original export dataset ID/creation keys, or explicitly resolves
retained profiles first; do not generate a new dataset identity and collide with them.

## 6. Separate later work

**Backend automation:** after this migration, separately agree with Connor on the
eligible groups, prompt additions, outputs/destination, and execution point in his
existing proposal-processing flow. Reuse the roster via Dataverse and avoid a second
Claude call. This plan neither implements nor enables automated matching/assignments.

**Expertise Finder retirement:** after the backend replacement is accepted, separately
inventory live routes/callers, navigation, app grants, prompts, history access, and
scripts. Preserve a usable home for existing history before removing the app. Admin
roster maintenance and shared consumers must remain independent. Removal is
unverified-until-checked and requires a separate implementation decision.

## 7. Review and documentation reconciliation

Claude Opus 5.5 reviewed the initial draft and then the revised Contact-preserving
plan through the owner's Claude Code OAuth session, read-only. Both CLI responses
confirm `claude-opus-5-5`. Review 2 closed all prior findings and returned READY WITH
CHANGES for two exact-preservation conflicts in parked code; the required importer
and category-rule changes are now explicit above. Its stated readiness condition
was inclusion of those corrections. Both verbatim reports and author dispositions
are saved alongside this plan. Those are historical planning reviews. Subsequent
implementation review and verification are tracked separately in
`EXPERTISE_ROSTER_BUILD_2026-11-19.md`. No API-key agent session, Ultrareview or live
production probe was used for the planning task.

Sweep Mode A: the changed fact is owner direction, not deployed storage. This plan
supersedes the Postgres-plus-HTTP proposal in
`EXPERTISE_ROSTER_POWER_AUTOMATE_PLAN_2026-11-19.md` and the earlier sandbox prerequisites
for this roster migration. The November 9 handoff remains explicitly historical;
parked branch code/evidence remains preserved. `SESSION_PROMPT.md` points here.
Current-source Atlas descriptions remain accurate until migration actually occurs.
The historical production inventory remains dated, not promoted to a live claim.

Contract review scope: whole-flow, partial import success, durable identity/reference
preservation, authorization, helper semantics and consumer fan-out are in scope.
Concurrent edits and deployment draining are N/A by owner direction. Standard UI
load/save error handling still applies; do not add a concurrency subsystem.
