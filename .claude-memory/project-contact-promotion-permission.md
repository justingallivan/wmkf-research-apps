---
name: Accepted-reviewer contact promotion and Contact permissions
description: Contact promotion occurs on identity-bearing acceptance, not send; Create+AppendTo work, but the app user has NO DeleteAccess on Contact
type: project
originSessionId: 9ea67012-f70f-47e6-ba56-ded9f73601c4
status: active
scope: reviewer
last_verified: 2026-07-30 — source contract moved promotion from send to every acceptance; Create/AppendTo grant and no-DeleteAccess remain privilege facts from the controlled writes
---

## Recall Rule

Read this when: working on Reviewer Finder/Manager contact promotion, send-emails, smoke-test cleanup, or any "remove a promoted reviewer" feature.

Do:
- Promote every accepted reviewer through `ensureAcceptedReviewerContact`; invitation sends never create or link contacts.
- Preserve fail-closed identity matching: ambiguity, email/ORCID split, and name mismatch remain unlinked for staff review.
- Use ORCID-scoped deterministic Contact IDs (reviewer-ID fallback without a
  valid ORCID) and the atomic Contact-create + ETag-guarded reviewer-link
  changeset so retries converge without orphan Contacts.
- For smoke tests, expect PARTIAL cleanup and re-smoke with a DIFFERENT throwaway email when the orphan contact wasn't hard-deleted.
- Build removal as unlink/deactivate (`wmkf_selected=false`), never hard-delete.

Do not:
- Assume the app can hard-delete a Contact — the role has NO DeleteAccess (`0x80048306` / `unManagedIdsAccessDenied`, verified S213).
- Assume deactivating an orphan unblocks re-use — `contact.findByEmail` matches regardless of statecode.

Ground truth: `lib/services/reviewer-acceptance-drain.js`,
`lib/bill/honorarium-onboard-orchestrator.js`,
`lib/dataverse/adapters/contact.js`, and
`lib/services/review-manager/send-emails-service.js` (explicit no-promotion
boundary). Related: [[project-reviewer-workbench-invite-workflow]].

**Current branch behavior (S389; not yet merged/deployed):** sending an
invitation does not merit promotion.
Every accepted reviewer—including honorarium opt-outs—enters the
identity-aware accepted-contact path; declines do not. Exact email and ORCID
candidate sets are cross-checked with name consistency before linking.
Conflicts preserve the unlinked reviewer and create a durable staff alert.
Genuine no-matches derive one deterministic Contact ID from a valid ORCID
across duplicate reviewer rows, falling back to the global potential-reviewer
ID only when ORCID is unavailable. Contact creation and the `wmkf_contact`
link commit in one Dataverse changeset guarded by the reviewer's ETag.

**Historical permission proof:** the earlier first-outreach implementation was
verified end-to-end on 2026-05-01 with a controlled test recipient;
`_wmkf_contact_value` populated correctly. That proves the app user's Contact
Create + AppendTo permission, not the current lifecycle trigger.

**Why:** Connor granted `AppendTo` on Contact at BusinessUnitLevel to the app user's suite security role on 2026-05-01 (the role is `WMKF Research Review App Suite - Staff` — original notes said "`# WMK: Research Review App Suite` role", but that string is the app USER's display name; see [[project-wave1-closeout-role-tail]]). Prior to that, the create half worked (orphan contacts landed in CRM) but the link half 403'd.

**How to apply:**
- Never restore contact writes to `send-emails-service.js`; its legacy result
  fields remain `contactPromoted:false` and `orcidBackprop:null`.
- Opt-out acceptance calls `ensureAcceptedReviewerContact` directly.
  Non-opt-out acceptance reaches the same helper through
  `ensureHonorariumOnboarding`.
- Tracked permission history remains in
  `docs/archive/PENDING_ADMIN_REQUESTS.md` Section 4 (Done; archived).

**Delete is NOT granted (verified S213, 2026-06-02).** The app user's suite role (`WMKF Research Review App Suite - Staff`) has Create + AppendTo on Contact but **no DeleteAccess** (error `0x80048306` / `unManagedIdsAccessDenied`, 403). Consequences:
- `scripts/smoke-test-candidate.mjs cleanup` deletes the smoke person + suggestion but **cannot delete the promoted contact** — it's left orphaned (Active) in CRM. The script now reports this as PARTIAL cleanup (was previously a misleading "complete"). A sysadmin must delete the leftover contact manually.
- `contact.findByEmail` (`lib/dataverse/adapters/contact.js`) matches on `emailaddress1` **regardless of statecode** — so deactivating the orphan does NOT unblock re-use. The smoke `create` guard refuses any email that already exists as a contact, so **re-smoke with a DIFFERENT throwaway email** unless the orphan is hard-deleted by an admin.
- Same boundary applies to any future "fully remove a promoted reviewer" feature: the app can unlink/deactivate but never hard-delete a Contact. See [[project-reviewer-workbench-invite-workflow]] (S213 added a per-request soft-remove that revokes the link + sets `wmkf_selected=false` — it deliberately never touches the global person/contact).
