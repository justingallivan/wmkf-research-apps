---
name: Contact promotion verified working
description: Reviewer Finder's contact-promotion path is fully working as of 2026-05-01 after AppendTo grant
type: project
originSessionId: 9ea67012-f70f-47e6-ba56-ded9f73601c4
---
The Reviewer Finder / Review Manager send-emails flow promotes recipients to CRM contacts on first outreach (find-or-create by email, then `setContactLink` on the `wmkf_potentialreviewer`). **Verified end-to-end on 2026-05-01** with a test send to `justingallivan@me.com` — `_wmkf_contact_value` populated correctly.

**Why:** Connor granted `AppendTo` on Contact at BusinessUnitLevel to the `# WMK: Research Review App Suite` security role on 2026-05-01. Prior to that, the create half worked (orphan contacts landed in CRM) but the link half 403'd.

**How to apply:**
- Promotion runs inline in `pages/api/review-manager/send-emails.js` (~line 247) only for the rows actually emailed in a given send and only when `_wmkf_contact_value` is null. Existing orphan rows from the pre-grant period will get linked the next time they're sent to (find-by-email reuses the orphan contact — no duplicates).
- Tracked in `docs/archive/PENDING_ADMIN_REQUESTS.md` Section 4 (marked Done; doc archived).
