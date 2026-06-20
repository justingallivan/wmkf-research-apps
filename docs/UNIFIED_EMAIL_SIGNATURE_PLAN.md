# Plan: Unified per-user email signature (profile-settings) (S271)

> **Status: PLAN — pending Codex pre-impl review (owner-requested).** Owner wants ONE editable
> signature block per user, stored in Postgres, edited in the central **Profile Settings** page, and
> consumed by BOTH reviewer-invitation and grantee (invite + reminder) emails — replacing today's
> reviewer-only, bespoke sender-info UI. Also fixes a live cron bug.

## Why (owner intent, S271)

- The grantee invite/reminder need a signature; titles are NOT in Dataverse (verified null for all PDs),
  so the signature must come from a per-user store with a sensible fallback.
- A PD is leaving mid-cycle; the plan is to **reassign the Dataverse PD** (`_wmkf_programdirector_value`)
  on his applications. That already drives dashboards/`canManage`; the signature should resolve from the
  **assigned PD** so the same reassignment cascades to emails too.
- Owner wants the signature **collapsed to one freeform block**, edited in **Profile Settings** (today a
  placeholder-only page), and the reviewer flow's bespoke sender UI **unified** into it ("clean solution").

## Verified current state (S271)

- **The signature already exists as a Postgres preference.** `PREFERENCE_KEYS.SENDER_INFO =
  'reviewer_finder_sender_info'` (`shared/config/reviewerFinderPreferences.js`), JSON `{ name, email,
  signature }` where **`signature` is a freeform multi-line block** (default all-empty). Stored per
  profile via `/api/user-preferences` → `DatabaseService` (Postgres `@vercel/postgres`).
- **Edited via reviewer-only UIs:** `shared/components/EmailSettingsPanel.js` + `SettingsModal.js`
  (Sender Name / Sender Email / Signature textarea). `ProfileContext` migrates a legacy localStorage
  `email_sender_info` into the preference on first profile select.
- **Consumed by reviewer invites only:** standalone Reviewer Finder (`EmailGeneratorModal.js`) and the
  workbench reviewer invite (`pages/workbench/[requestId].js:88-110`), resolving `{{signature}}` with the
  fallback chain `signature → name → profile display name`.
- **`profile-settings.js`** manages profiles only (display name, avatar, default/archive) + an "About
  Profiles" info card — NO signature section. Uses `useProfile()` (has `preferences` + `setPreference`).
- **`/api/user-preferences`** accepts any key except the reserved `PROMPT_OVERRIDES`; supports an
  encrypted-keys list. So a new general key needs no allowlist change.
- **Grantee flows do NOT read any signature today.** The invite default (`AwardeeTab` `DEFAULT_BODY`) has
  a literal `[Program Director name]/[title]` placeholder; the reminder cron reads the assigned PD's
  `systemuser` and **requires `title`**.
- **[VERIFIED via probe] `systemuser.title` is null for all 6 assigned PDs** (Connor, Justin, Kevin,
  Jean, Beth, Anneli); `fullname` + `internalemailaddress` are populated. ⇒ **the shipped reminder cron
  would skip every row** (`!pdTitle → skippedNoPd`, `grantee-deliverable-reminders.js:171`). Bug to fix.
- **`user_profiles` (Postgres)** has `azure_id` (Azure AD object id, UNIQUE) + `azure_email`.

## Proposed model

1. **One canonical block** — new general key `PREFERENCE_KEYS.EMAIL_SIGNATURE = 'email_signature'`, shape
   `{ signature, name, email }` (`signature` = the freeform block, e.g. "Justin Gallivan\nSenior Program
   Director\nW. M. Keck Foundation"; `name`/`email` retained for the reviewer flow's sender identity).
   **Tolerant reader** falls back to the legacy `reviewer_finder_sender_info`; a one-time migration copies
   legacy → new on read/save. No `/api/user-preferences` allowlist change needed.
2. **One editor** — add an "Email signature" card to `profile-settings.js` (textarea for the block; saved
   via `setPreference(EMAIL_SIGNATURE)`). Remove the sender-info section from `EmailSettingsPanel`/
   `SettingsModal` (or replace with a "manage in Profile Settings" link). Central location, single editor.
3. **One shared resolver** `lib/services/email-signature.js`:
   - `resolveSignatureForProfile(preferences | profileId)` → block (logged-in user; standalone Reviewer Finder).
   - `resolveSignatureForRequest(requestId)` → resolves the **assigned PD** (`_wmkf_programdirector_value`
     → `systemuser` → `azureactivedirectoryobjectid`) → that PD's `user_profiles` row (by `azure_id`, else
     `azure_email` ↔ `internalemailaddress`) → their `email_signature` block.
   - **Fallback chain** (both): saved `signature` block → PD/user `fullname` (or profile `display_name`)
     → `display_name`; always end with "W. M. Keck Foundation". **No title line** unless the block sets
     one (titles aren't in Dataverse).
   All email surfaces build the signature through this — so reviewer/grantee/reminder all match.
4. **Resolution decision (CONFIRMED owner S271):** request-scoped emails (grantee invite, grantee
   reminder, workbench reviewer invite) resolve from the **assigned PD's profile** → reassigning the
   Dataverse PD cascades to the signature + (for the cron) the sender. Standalone Reviewer Finder uses the
   **logged-in user's** profile.

## Work breakdown

1. Add `EMAIL_SIGNATURE` key + `DEFAULT_VALUES` + tolerant read/migration off `reviewer_finder_sender_info`.
2. `lib/services/email-signature.js` — the two resolvers + fallback chain (the assigned-PD→profile join
   is the one new bit; share the PD-systemuser read with the cron).
3. Profile-settings "Email signature" card (textarea + save + load).
4. Grantee invite auto-fill (`AwardeeTab`): `[Name]` (PI), `[title]` (award), `COB [date]` (send+14d), and
   the signature block from the assigned PD's profile — when the tab loads, guarded against clobbering
   staff edits.
5. **Fix the reminder cron**: drop the `!pdTitle` requirement; build the signature via the resolver
   (assigned PD's profile → fallback); invite + reminder use the same signature construction.
6. Point reviewer surfaces (`EmailGeneratorModal`, workbench reviewer invite) at the resolver/new key
   (tolerant); retire the bespoke sender UI section.
7. Tests (resolver fallback + assigned-PD join + tolerant legacy read; profile-settings save; cron
   no-title; invite auto-fill), docs, gates.

## Migration / cutover

- New key + tolerant read means a straight cutover: readers prefer `email_signature`, fall back to
  `reviewer_finder_sender_info`; writers (profile-settings save) write the new key (and may clear/copy the
  legacy one). Retire the legacy key after telemetry shows no remaining reads. No DB schema change
  (key/value preference store).

## Risks / for Codex to scrutinize

- **Assigned-PD → Postgres-profile join reliability.** Is `systemuser.azureactivedirectoryobjectid`
  populated, and does it equal `user_profiles.azure_id`? What if a PD has no linked profile, or two
  profiles match? Define the deterministic fallback (fullname + default) and the multi-match rule.
- **Cron sender vs. signature consistency.** The cron sends *as* the assigned PD (impersonation) and must
  now also *sign* as the assigned PD — confirm both derive from the same resolved PD; no silent mismatch.
- **Invite From vs. signature.** The manual invite sends from the logged-in sender's mailbox but would
  sign as the assigned PD. Usually identical; flag the divergence case (admin sends on a PD's behalf).
- **Don't break the reviewer flow.** `{{signature}}` resolution + the legacy fallback must keep working
  through the cutover; the localStorage→preference migration in `ProfileContext` must not regress.
- **Tolerant-reader removal.** Name the telemetry/condition for retiring the legacy key (don't leave a
  permanent dual-read).
- **Encrypted-keys list / write path.** Confirm the new key is NOT in `ENCRYPTED_PREFERENCE_KEYS` (it's
  not a secret) and that `/api/user-preferences` accepts it without an allowlist change.
- **Scope check:** is unifying the reviewer flow in the same pass worth the blast radius, or should grantee
  consume the new key first and the reviewer-UI retirement follow as a second step?
