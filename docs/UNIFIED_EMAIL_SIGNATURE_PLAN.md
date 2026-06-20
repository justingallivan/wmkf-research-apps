# Plan: Unified per-user email signature (profile-settings) (S271)

> **Status: PLAN v2 — Codex review #1 folded; pending Codex review #2 (owner-requested).** Owner wants
> ONE editable signature block per user, edited in the central **Profile Settings** page, consumed by BOTH
> reviewer-invitation and grantee (invite + reminder) emails — unifying today's reviewer-only bespoke
> sender-info UI. Also fixes a live reminder-cron bug. Implementer decided after review #2.
>
> **Revision note:** v1 wrongly said preferences live in Postgres and proposed an `azureactivedirectoryobjectid`
> join; both corrected below per Codex review #1 (storage = Dataverse; join = email via the existing
> identity map). v2 also splits the rollout into two phases (grantee first, reviewer-UI retirement later).

## Why (owner intent, S271)

- The grantee invite/reminder need a signature; titles are NOT in Dataverse, so the signature must come
  from a per-user store with a sensible fallback.
- A PD is leaving mid-cycle; the owner will **reassign the Dataverse PD** (`_wmkf_programdirector_value`)
  on his applications. That already drives dashboards/`canManage`; the signature should resolve from the
  **assigned PD** so the same reassignment cascades to emails too.
- Owner wants the signature **collapsed to one freeform block**, edited in **Profile Settings** (today a
  placeholder-only page), with the reviewer flow's bespoke sender UI **unified** into it.

## Verified current state (S271)

- **Preferences live in Dataverse, NOT Postgres.** [VERIFIED via `lib/services/dataverse-prefs-service.js`
  header + `lib/services/database-service.js:14-19` + `scripts/setup-database.js:254`] `DatabaseService`
  delegates all six pref methods unconditionally to `dataverse-prefs-service.js` → Dataverse
  `wmkf_appuserpreferences`; the Postgres `user_preferences` table was dropped 2026-05-12 (W3–W6 cutover);
  `WAVE1_BACKEND_PREFS=postgres` throws at load. Postgres `user_profiles` holds only the IDENTITY record.
- **The signature block already exists as a pref.** [VERIFIED via `shared/config/reviewerFinderPreferences.js:23,112`]
  `PREFERENCE_KEYS.SENDER_INFO = 'reviewer_finder_sender_info'`, JSON `{ name, email, signature }` where
  `signature` is a freeform multi-line block (default all-empty). Stored per profile via
  `/api/user-preferences` → DataverseService.
- **Identity bridge is EMAIL-based.** [VERIFIED via `lib/services/dataverse-identity-map.js:2,4,49,70,77`]
  `dataverse-identity-map.js` bridges Postgres `user_profile_id` ↔ Dataverse `systemuserid` by matching
  `user_profiles.azure_email eq systemuser.internalemailaddress` (NOT `azureactivedirectoryobjectid` — no
  source reads that field). Exposes `resolveProfileToSystemUser(profileId)` and
  `resolveSystemUserToProfile(systemuserid)`. `dataverse-prefs-service.js` already uses
  `resolveProfileToSystemUser` — so prefs are effectively keyed per systemuser.
- **Edited via reviewer-only UIs:** `shared/components/EmailSettingsPanel.js` + `SettingsModal.js` (Sender
  Name / Email / Signature textarea). [VERIFIED via `shared/context/ProfileContext.js:115,123,142`]
  `ProfileContext` migrates a legacy localStorage `email_sender_info` into `SENDER_INFO` once, sets
  `_legacy_migration_complete`, and returns early on later loads.
- **Reviewer consumption is CLIENT-SUPPLIED today.** [VERIFIED via `pages/workbench/[requestId].js:91`,
  `pages/api/review-manager/render-emails.js:74-75,191`] the workbench reads the logged-in user's
  `SENDER_INFO` in the page and passes `{ signature }` into the render API, which trusts
  `req.body.settings.signature`. render-emails already fetches the request (`akoya_requests`, line 100)
  and has `_wmkf_request_value` per suggestion — so server-side assigned-PD resolution is feasible there.
- **Standalone Reviewer Finder hard-requires sender name/email.** [VERIFIED via
  `pages/api/reviewer-finder/generate-emails.js:240-241,480-481`] it rejects a missing `settings.senderEmail`
  and the `.eml` From header uses `senderName`/`senderEmail`. So name/email CANNOT be dropped for that flow.
- **Grantee flows read no signature today.** The invite default (`AwardeeTab` `DEFAULT_BODY`) has a literal
  `[Program Director name]/[title]` placeholder; the reminder cron reads the assigned PD's `systemuser`.
- **[VERIFIED via probe] `systemuser.title` is null for all 6 assigned PDs** (Connor, Justin, Kevin, Jean,
  Beth, Anneli); `fullname` + `internalemailaddress` are populated. ⇒ the shipped reminder cron skips
  every row (`!pdTitle → skippedNoPd`, `grantee-deliverable-reminders.js:171`). Bug to fix.
- **Reminder renderer takes pdName/pdTitle.** [VERIFIED via `lib/external/grantee-invite-email.js`]
  `renderGranteeReminderHtml` appends name + title lines — so the fix is a renderer CONTRACT change (accept
  a resolved signature block), not just dropping the cron's title check.
- **`/api/user-preferences`** accepts any key except reserved `PROMPT_OVERRIDES`; `EMAIL_SIGNATURE` is not
  in `ENCRYPTED_PREFERENCE_KEYS`. No allowlist/encryption change needed.

## Proposed model (v2)

1. **One canonical block** — new general key `PREFERENCE_KEYS.EMAIL_SIGNATURE = 'email_signature'`, shape
   `{ signature, name, email }` (`signature` = the freeform block; `name`/`email` retained — the standalone
   reviewer flow still needs them). Stored in Dataverse `wmkf_appuserpreferences` via the existing
   `/api/user-preferences` path (no allowlist/encryption change). **Tolerant reader** prefers
   `EMAIL_SIGNATURE`, falls back to legacy `SENDER_INFO`; an explicit `SENDER_INFO → EMAIL_SIGNATURE`
   copy runs **independent of** `_legacy_migration_complete` (that flag won't populate the new key).
2. **One editor** — add an "Email signature" card to `profile-settings.js` editing the full
   `{ signature, name, email }` shape (textarea + name/email), saved via `setPreference(EMAIL_SIGNATURE)`.
   The bespoke reviewer sender UI stays for now (see phased rollout) but reads/writes the new key.
3. **One shared resolver** `lib/services/email-signature.js`:
   - `resolveSignatureForProfile(preferences)` → block for the logged-in user (standalone Reviewer Finder).
   - `resolveSignatureForRequest(requestId)` (SERVER-SIDE) → assigned PD `_wmkf_programdirector_value` →
     read that **systemuser's** `email_signature` pref directly (prefs are systemuser-keyed; use
     `resolveSystemUserToProfile`/the prefs service), → block.
   - **Fallback chain:** saved `signature` block → PD/user `fullname` (or profile `display_name`); always
     end "W. M. Keck Foundation". **No title line** unless the block sets one.
   - **No-match / multi-match:** `azure_email` is indexed but NOT unique — define deterministic handling
     (first by lowest profile id; if no profile/pref, fall back to `fullname` + default; never throw).
4. **Resolution placement (Codex #3):** request-scoped signature resolution happens **server-side**:
   - grantee invite (`send-invite`) + reminder cron + the reviewer **render-emails** route resolve from the
     request's **assigned PD** (keyed by request id), NOT from client-supplied `settings.signature`.
   - standalone Reviewer Finder stays on the **logged-in user's** profile block.

## Codex review #1 — folded (binding for implementation)

1. **#1 Storage = Dataverse, not Postgres.** All "preference" reads/writes go through the Dataverse path;
   Postgres is identity-only. (Corrected throughout.)
2. **#2 Join via the existing identity map (email), not `azureactivedirectoryobjectid`.** Use
   `resolveSystemUserToProfile(systemuserid)` / read prefs by the PD's systemuserid; email join is
   non-unique → deterministic multi-match rule + no-match fallback.
3. **#3 Move request-scoped resolution server-side.** render-emails (and grantee send-invite/cron) resolve
   the assigned-PD signature on the server keyed by request id; do not trust client `settings.signature`
   for request-scoped sends.
4. **#4 Keep name/email; phase the reviewer-UI retirement.** Standalone reviewer flow hard-requires
   `senderEmail`; Profile Settings edits the full `{name,email,signature}` and the bespoke UI is retired
   only in Phase 2, after the standalone send-identity path is confirmed.
5. **#5 Explicit `SENDER_INFO → EMAIL_SIGNATURE` migration/tolerant reader** independent of
   `_legacy_migration_complete`.
6. **#6 Reminder renderer contract change:** `renderGranteeReminderHtml`/`buildGranteeReminderBodyText`
   accept a resolved signature block; remove `pdTitle` from the reminder contract.
7. **#7 From-vs-signature divergence:** decide per phase (below) — Phase 1 documents the divergence; a
   later option is assigned-PD impersonation for the manual grantee invite.
8. **#8 No encrypted-key/allowlist change** — add `EMAIL_SIGNATURE` to `PREFERENCE_KEYS`/defaults only.

## Phased rollout (Codex #4 scope)

- **Phase 1 (fixes the owner's immediate need + the cron bug):** add `EMAIL_SIGNATURE` + tolerant
  reader/migration; Profile Settings editor (full shape); shared resolver; grantee invite auto-fill
  (`[Name]`/`[title]`/`COB [date]` + assigned-PD signature) and reminder-cron fix (renderer contract +
  drop title requirement). Reviewer flow keeps reading the (now-unified) key via its existing UI.
- **Phase 2 (reviewer unification):** move render-emails to server-side assigned-PD resolution; retire the
  bespoke sender UI in favor of Profile Settings; redesign the standalone send-identity if needed; then
  retire the legacy `SENDER_INFO` key after telemetry shows no remaining reads.

## Work breakdown (Phase 1 unless noted)

1. `EMAIL_SIGNATURE` key + `DEFAULT_VALUES` + tolerant read + explicit `SENDER_INFO→EMAIL_SIGNATURE` copy.
2. `lib/services/email-signature.js` — `resolveSignatureForProfile` + `resolveSignatureForRequest` (server,
   assigned-PD via identity map; deterministic no-match/multi-match) + fallback chain.
3. Profile-settings "Email signature" card (signature textarea + name/email; save/load via `EMAIL_SIGNATURE`).
4. Grantee invite auto-fill (`AwardeeTab`): `[Name]` (PI), `[title]` (award), `COB [date]` (send+14d), and
   the assigned-PD signature — on load, guarded against clobbering staff edits.
5. Reminder cron + renderer: change `renderGranteeReminderHtml`/text to accept a resolved signature block;
   drop the cron `!pdTitle` skip; invite + reminder use the same resolver → identical signature.
6. **(Phase 2)** render-emails server-side assigned-PD resolution; retire bespoke reviewer sender UI;
   standalone send-identity; retire legacy key.
7. Tests (resolver fallback + email-join no-match/multi-match + tolerant legacy read; profile-settings
   save; cron no-title + renderer contract; invite auto-fill), docs, gates.

## Risks / for Codex review #2 to scrutinize

- **Pref read by systemuserid for the assigned PD** — confirm `dataverse-prefs-service` can read another
  user's prefs by systemuserid (not just the caller's), and the auth/restriction context that requires.
- **Email-join determinism** — multi-match (non-unique `azure_email`) + no-linked-profile fallback; ensure
  it never throws and degrades to `fullname` + default.
- **render-emails migration (Phase 2)** — moving off client `settings.signature` without breaking the
  existing reviewer-invite contract / InviteEmailModal.
- **Tolerant-reader + the `_legacy_migration_complete` interaction** — the new copy must run even when the
  old migration already marked complete; name the retirement condition for the legacy key.
- **From-vs-signature** — Phase 1 divergence acceptance vs. assigned-PD impersonation for manual invites.
- **Scope** — is Phase 1 the right cut, or should anything from Phase 2 move earlier/later?
