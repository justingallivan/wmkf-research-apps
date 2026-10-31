# Atlas: `reviewer_materials_releases` (Postgres — materials release claim)

**Status:** [PLANNED — on branch `claude/reviewer-materials-on-accept`, not
merged, not applied anywhere.] Migration
`091_reviewer_materials_releases.sql`. Production `schema_migrations` must be
checked (owner-run) before merge.

## Purpose

One row per reviewer engagement (`suggestion_id`) that records who is sending
that reviewer the review materials and how far the send got. Automatic release
on acceptance (alignment log D46, D49) and manual release from the Review
Manager both claim this row before minting the reviewer's link, so a reviewer
never gets two materials emails from the two paths. Plan:
`docs/plans/REVIEWER_INVITATION_CALENDAR_BUILD_PLAN_2026-10-29.md` §3.3 and its
build notes.

## Source of truth

- Schema: `lib/db/migrations/091_reviewer_materials_releases.sql`. Fresh
  installs apply it through the numbered migrations [VERIFIED via
  `scripts/lib/fresh-database-bootstrap.js:9-10,62` reading the manifest].
- Writer: `lib/services/reviewer-engagement/materials-release-store.js`, the
  only write path.
  - `claimMaterialsRelease` — `INSERT … ON CONFLICT (suggestion_id) DO NOTHING
    RETURNING`: the first insert owns the release; a refused claim returns the
    owning row.
  - `markMaterialsLinkMinted` — `claimed → link_minted`, only under the live
    lease.
  - `markMaterialsSent` — `link_minted → sent` after confirmed delivery; token
    match only, so a receipt is kept even if the lease ran out mid-send.
  - `recordMaterialsRelease` — `sent → recorded` once the suggestion markers
    (`wmkf_materialssentat`, status `materials_sent`) are written; no lease, so
    any retry can finish the bookkeeping without resending.
  - `markMaterialsReleaseStopped` — `uncertain` (the email may have left) or
    `failed` (it did not).
  - `reclaimMaterialsRelease` — staff "Send materials again": a stopped
    release, or one abandoned at `claimed` / `link_minted` past its lease,
    goes back to `claimed` under a new lease and `attempts + 1`. Never touches
    `sent` or `recorded`.
  - `retakeFailedMaterialsRelease` — a normal manual send retakes a `failed`
    release (definitely not sent) the same way; `uncertain` and abandoned rows
    are not retaken.
  - `closeSentMaterialsRelease` — staff "Mark as delivered": `sent → recorded`
    with `error_code = staff_marked_delivered` and the staff profile, used only
    when the reviewer row cannot take the bookkeeping.
- `listStuckMaterialsReleases` — rows needing staff: `uncertain` / `failed`,
  `claimed` / `link_minted` past the lease, or `sent` unrecorded for 30
  minutes. Every acceptance-drain run (every 2 minutes) re-raises one
  deduplicated alert per row (`reviewer-materials-release:<suggestion>`), so the
  row, not a job's retry budget, carries the staff obligation.
- Readers and writers (on branch): the acceptance job's `release_materials`
  step (`lib/services/reviewer-acceptance-drain.js`), and the manual materials
  send (`lib/services/review-manager/send-emails-service.js`,
  `claimManualMaterialsRelease` and the helpers beside it). The manual send
  claims as `source = 'manual'` with the staff profile just before its mint;
  an existing row refuses (`materials_already_sent` for `sent` / `recorded`,
  else `materials_release_in_progress`), and a claim that cannot be checked
  fails closed with nothing minted. After its own `recordDeliveredEmail` it
  moves the row to `recorded` and resolves the release alert. A `failed` row
  is retaken by any normal send; `uncertain` or abandoned rows are reclaimed
  only when the request names the reviewer in `recoverMaterialsReleaseIds`
  (the Release Materials "Send again" button), after the delivered-marker
  gates pass. Refusals carry `materialsRecoveryAction` (`send_again` /
  `mark_delivered`).
- Staff "Mark as delivered": `POST /api/review-manager/materials-release-delivered`
  → `lib/services/reviewer-engagement/mark-materials-delivered.js`. A `sent`
  row only: tries `recordDeliveredEmail` then `recordMaterialsRelease`; when
  the reviewer row cannot take it, `closeSentMaterialsRelease`. Sends nothing.
- Drain stuck loop (`alertStuckMaterialsReleases`): for a `sent` row of any
  source, first retries the bookkeeping from the persisted `sent_at` (binding
  check on the request only; the row stores no reviewer id), records the row
  and resolves the alert; only if that fails does it raise the alert.
- Alert key: `materialsReleaseAlertKey` in the store is the one spelling used
  by both writers.

## Columns

| Column | Meaning |
|---|---|
| `suggestion_id` | Primary key; the `wmkf_appreviewersuggestion` row. |
| `request_id` | The request the engagement belongs to. |
| `source` | The original claimant: `acceptance` (job-driven) or `manual` (staff). Unchanged when staff later retake or reclaim the row; `actor_profile_id` then names the staff member. |
| `state` | `claimed`, `link_minted`, `sent`, `recorded`, `uncertain`, `failed`. |
| `job_id` | `reviewer_acceptance_jobs.id`; required exactly when `source = 'acceptance'`. No foreign key: the operator smoke cleanup deletes completed jobs [VERIFIED via `scripts/smoke-reviewer-binding.js:391`]; no application path deletes them. |
| `actor_profile_id` | Staff profile: required for `manual`; set on a staff resend. |
| `lease_token`, `lease_until` | Ownership of an in-flight send; cleared at `recorded` and when stopped. |
| `attempts` | 1 on claim; +1 per staff resend. |
| `error_code` | Short code for `uncertain` / `failed`; cleared on a confirmed send or resend. On a `recorded` row, `staff_marked_delivered` marks a staff close (reviewer markers not written). |
| `claimed_at`, `link_minted_at`, `sent_at`, `recorded_at`, `updated_at` | Transition times. |

Constraints: `sent` and `recorded` need `sent_at`; `recorded` needs
`recorded_at`; `manual` rows need an actor.

## Lifecycle and retention

No cleanup job: one small row per accepted reviewer engagement, kept as the
receipt that materials went out. A `recorded` row with `error_code =
staff_marked_delivered` is a staff close: the email went out but the reviewer
markers were not written. A stuck `uncertain` or abandoned row needs staff
("Send again"); a `failed` row is retaken by the next normal send; a `sent`
row is recorded automatically by the drain, or closed by staff ("Mark as
delivered").

## Tests

`tests/integration/reviewer-materials-release-store.pg.test.js` (real
Postgres in CI): concurrent automatic and manual claims, the happy path,
expired leases, staff reclaim, and the table constraints.
