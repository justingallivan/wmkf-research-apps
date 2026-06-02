---
name: Contact promotion verified working
description: Reviewer Finder's contact-promotion path works (Create+AppendTo, 2026-05-01); app user has NO DeleteAccess on Contact
type: project
originSessionId: 9ea67012-f70f-47e6-ba56-ded9f73601c4
---
The Reviewer Finder / Review Manager send-emails flow promotes recipients to CRM contacts on first outreach (find-or-create by email, then `setContactLink` on the `wmkf_potentialreviewer`). **Verified end-to-end on 2026-05-01** with a test send to `justingallivan@me.com` — `_wmkf_contact_value` populated correctly.

**Why:** Connor granted `AppendTo` on Contact at BusinessUnitLevel to the `# WMK: Research Review App Suite` security role on 2026-05-01. Prior to that, the create half worked (orphan contacts landed in CRM) but the link half 403'd.

**How to apply:**
- Promotion runs inline in `pages/api/review-manager/send-emails.js` (~line 247) only for the rows actually emailed in a given send and only when `_wmkf_contact_value` is null. Existing orphan rows from the pre-grant period will get linked the next time they're sent to (find-by-email reuses the orphan contact — no duplicates).
- Tracked in `docs/archive/PENDING_ADMIN_REQUESTS.md` Section 4 (marked Done; doc archived).

**Delete is NOT granted (verified S213, 2026-06-02).** The `# WMK: Research Review App Suite` role has Create + AppendTo on Contact but **no DeleteAccess** (error `0x80048306` / `unManagedIdsAccessDenied`, 403). Consequences:
- `scripts/smoke-test-candidate.mjs cleanup` deletes the smoke person + suggestion but **cannot delete the promoted contact** — it's left orphaned (Active) in CRM. The script now reports this as PARTIAL cleanup (was previously a misleading "complete"). A sysadmin must delete the leftover contact manually.
- `contact.findByEmail` (`lib/dataverse/adapters/contact.js`) matches on `emailaddress1` **regardless of statecode** — so deactivating the orphan does NOT unblock re-use. The smoke `create` guard refuses any email that already exists as a contact, so **re-smoke with a DIFFERENT throwaway email** unless the orphan is hard-deleted by an admin.
- Same boundary applies to any future "fully remove a promoted reviewer" feature: the app can unlink/deactivate but never hard-delete a Contact. See [[project-reviewer-workbench-invite-workflow]] (S213 added a per-request soft-remove that revokes the link + sets `wmkf_selected=false` — it deliberately never touches the global person/contact).
