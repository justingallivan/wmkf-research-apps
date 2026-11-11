# Confirmed roster import decisions — November 9, 2026

Owner-confirmed decisions, not changes to Production records.
The original temporary GUID receipt was lost. Current verified sandbox mappings
and approval evidence are private under
`/Users/gallivan/.local/share/wmkf-roster/full-import-20261110`.
Raw source export remains unchanged. These overrides must be applied explicitly by
the planner/executor through explicit `roleType`, `exclude`, and `newProfiles` mapping
entries. They were applied in the full sandbox import on November 10, including
Amy allocated local ID 40 and excluded ID 35 retained without a profile. Full field
parity and stable replay passed; see `FULL_IMPORT_REHEARSAL_2026-11-10.md`.

| Existing roster ID | Decision |
|---|---|
| 1 — John E. Sader | Same person as John Sader; retain ID/history, change Consultant to Research Program Staff, link verified `jsader@wmkeck.org` User, active and lead eligible |
| 11 — Beth L. Pruitt | Confirmed Beth Pruitt User link; active, lead eligibility off for now |
| 12 — Justin Gallivan | Confirmed User link; active and lead eligible |
| 14 — Jean J. Kim | Confirmed Jean Kim User link; active and lead eligible |
| 13 — Kevin Moses | Retired; inactive and not lead eligible |
| 35 — TBD specialist | Exclude from migrated profile roster at owner's instruction; preserve numeric identity for existing feedback reference, with unavailable historical attribution |

Amy Rowat is a new Research Program Staff profile, starting December 2026. Stage
inactive, without User link and without lead eligibility. Do not allocate a guessed
legacy ID or create an account. Account access/activation comes later.

[VERIFIED via scripts/verify-roster-owner-mappings.cjs] John has exactly one enabled
account at the supplied email in each environment. Production and sandbox GUIDs differ;
use the target-specific receipt, never copy the Production GUID into sandbox.

[VERIFIED via live read-only Postgres query] Feedback record 1 references roster ID 35.
The owner was informed and reiterated removal. Excluding the profile while retaining
its numeric bridge identity avoids deleting or reassigning feedback. No Production
profile or feedback has been deleted by this task. Historical feedback should show
unavailable identity according to the accepted consumer contract.

Keep the remaining roster entries editable with a visible Active/Inactive control,
a way to include inactive entries in the list, and reactivation. Inactive profiles
are excluded from new matching and new recipient/author selection, while historical
references remain resolvable. Other retirements can be decided through the editor.
The ten Production Contact links remain preserved in the raw export. Five exact-email
sandbox counterparts were verified. Justin approved null sandbox Contact links for
IDs 9, 10, 24, 30 and 39 for this rehearsal; no guessed links or Contacts were created.
Four approved staff User links were reverified enabled in sandbox. Production
cutover still requires its own final export and target-specific mapping review.
