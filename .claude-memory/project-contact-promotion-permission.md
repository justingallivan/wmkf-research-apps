---
name: Contact promotion verified working
description: Reviewer Finder's contact-promotion path works (Create+AppendTo, 2026-05-01); app user has NO DeleteAccess on Contact
type: project
originSessionId: 9ea67012-f70f-47e6-ba56-ded9f73601c4
status: active
scope: reviewer
last_verified: 2026-07-12 — app user still holds the suite role "WMKF Research Review App Suite - Staff" via probe-app-user-roles.js (that has been the role's name since its 2026-04-24 creation; "# WMK: Research Review App Suite" is the app USER's display name, not a former role name — see [[project-wave1-closeout-role-tail]]); the Create/AppendTo grant + no-DeleteAccess are privilege-level facts derived from a write 403 (S213), not re-probeable read-only
---

## Recall Rule

Read this when: working on Reviewer Finder/Manager contact promotion, send-emails, smoke-test cleanup, or any "remove a promoted reviewer" feature.

Do:
- Rely on find-or-create-by-email + `setContactLink` for promotion (Create + AppendTo are granted, verified 2026-05-01).
- For smoke tests, expect PARTIAL cleanup and re-smoke with a DIFFERENT throwaway email when the orphan contact wasn't hard-deleted.
- Build removal as unlink/deactivate (`wmkf_selected=false`), never hard-delete.

Do not:
- Assume the app can hard-delete a Contact — the role has NO DeleteAccess (`0x80048306` / `unManagedIdsAccessDenied`, verified S213).
- Assume deactivating an orphan unblocks re-use — `contact.findByEmail` matches regardless of statecode.

Ground truth: `lib/services/review-manager/send-emails-service.js` (promotion logic), `lib/dataverse/adapters/contact.js`, `scripts/smoke-test-candidate.mjs`. Related: [[project-reviewer-workbench-invite-workflow]].

The Reviewer Finder / Review Manager send-emails flow promotes recipients to CRM contacts on first outreach (find-or-create by email, then `setContactLink` on the `wmkf_potentialreviewer`). **Verified end-to-end on 2026-05-01** with a test send to `justingallivan@me.com` — `_wmkf_contact_value` populated correctly.

**Why:** Connor granted `AppendTo` on Contact at BusinessUnitLevel to the app user's suite security role on 2026-05-01 (the role is `WMKF Research Review App Suite - Staff` — original notes said "`# WMK: Research Review App Suite` role", but that string is the app USER's display name; see [[project-wave1-closeout-role-tail]]). Prior to that, the create half worked (orphan contacts landed in CRM) but the link half 403'd.

**How to apply:**
- Promotion runs in `lib/services/review-manager/send-emails-service.js` (look for `findOrCreateByEmail` + `setContactLink`; the `pages/api/review-manager/send-emails.js` route is now a thin wrapper — logic moved into the service, S348-verified) only for the rows actually emailed in a given send and only when `_wmkf_contact_value` is null. Existing orphan rows from the pre-grant period will get linked the next time they're sent to (find-by-email reuses the orphan contact — no duplicates).
- Tracked in `docs/archive/PENDING_ADMIN_REQUESTS.md` Section 4 (marked Done; doc archived).

**Delete is NOT granted (verified S213, 2026-06-02).** The app user's suite role (`WMKF Research Review App Suite - Staff`) has Create + AppendTo on Contact but **no DeleteAccess** (error `0x80048306` / `unManagedIdsAccessDenied`, 403). Consequences:
- `scripts/smoke-test-candidate.mjs cleanup` deletes the smoke person + suggestion but **cannot delete the promoted contact** — it's left orphaned (Active) in CRM. The script now reports this as PARTIAL cleanup (was previously a misleading "complete"). A sysadmin must delete the leftover contact manually.
- `contact.findByEmail` (`lib/dataverse/adapters/contact.js`) matches on `emailaddress1` **regardless of statecode** — so deactivating the orphan does NOT unblock re-use. The smoke `create` guard refuses any email that already exists as a contact, so **re-smoke with a DIFFERENT throwaway email** unless the orphan is hard-deleted by an admin.
- Same boundary applies to any future "fully remove a promoted reviewer" feature: the app can unlink/deactivate but never hard-delete a Contact. See [[project-reviewer-workbench-invite-workflow]] (S213 added a per-request soft-remove that revokes the link + sets `wmkf_selected=false` — it deliberately never touches the global person/contact).
