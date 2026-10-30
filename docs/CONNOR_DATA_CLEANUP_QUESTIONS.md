---
title: "Questions for Connor — Dynamics data cleanup"
domain: general
kind: plan
status: active
summary: "Running list of Dynamics data-cleanup questions for Connor: fields to fill in or correct so the apps read records correctly. Started 2026-10-29."
canonical: false
owner: product-engineering
related:
  - docs/plans/MEETING_DATE_RETIREMENT_PLAN_2026-10-29.md
  - docs/plans/J27_ALIGNMENT_LOG_2026-10-24.md
  - docs/CONNOR_CONTACT_MERGE_AND_REVIEWER_LINKING.md
  - docs/CURRENT_WORK_QUEUE.md
---

# Questions for Connor — Dynamics data cleanup

Records the apps would read correctly if a field were filled in or corrected.
Justin raises these with Connor; none is urgent unless marked. Add new items at
the end; when one is answered, record the answer and date in place.

| # | Question | Why the apps care | Evidence | Status |
|---|---|---|---|---|
| DC1 | Can the Grant Cycle link (`wmkf_grantcycle`) be filled in on older Research requests that have a June or December meeting date but no link? About 140 requests, mostly 2010–2014 (11–26 a year then; 2–9 a year 2005–2009; 0–5 a year since 2015). The cycle follows from the date (June → J, December → D). | The apps are moving to read a request's cycle only from this link (no meeting-date fallback, owner 2026-10-29). Without the link these requests show "No cycle" on screens that list past cycles (awardees, cycle export, search). | Owner-authorized read-only Production counts, 2026-10-29: link coverage for Research is 54–69% (2005–2009), 69–91% (2010–2014), 97–100% (2015 on). Older Research requests with off-month meeting dates (Jan, Jul, Aug and so on) have no cycle either way and are not part of this ask. `docs/plans/MEETING_DATE_RETIREMENT_PLAN_2026-10-29.md` §7 Q1. | Open; low priority (owner, 2026-10-29) |
| DC2 | Request 1003373 links to J27 but its meeting date is in June 2026 (J26). Which is right? | Once the apps read only the link, it shows under J27. | Alignment log T10 (2026-10-28). Owner, 2026-10-29: not a Research request; Connor is looking at it. | Open; low priority |
| DC3 | Five older Research `Phase I Pending` requests have no Grant Cycle link: 1002797 and 1002822 (D26; believed deactivated test requests, not in AkoyaGO), and 1000211 (D24), 1001975 and 1002162 (J26), which never reached a final Phase I status. Deactivate, close, or link them? | Unlinked requests show as "No cycle"; open old ones can appear in current lists. | Alignment log T10 (Connor reviewing, 2026-10-28). The 2026-10-29 counts found 5 Research requests with a June/December 2026 meeting date and no link, probably these [not matched by number]. | Open (Connor reviewing) |
| DC4 | 108 requests created in 2023 (the data migration) have neither a meeting date nor a Grant Cycle link: 46 Research, 34 SoCal, 28 other. What are they, and should they carry a cycle? | They belong to no cycle on any screen. | Owner-authorized read-only Production counts, 2026-10-29 (counts only; no request numbers pulled). | Open; ask when convenient |
| DC5 | Honorarium requests the apps created since 2026-07-02 carry a meeting date and fiscal year but no Grant Cycle link; GoApply-made honoraria (e.g. #1002764) carry the link. Fill the link on the app-made ones later? | Consistency with GoApply's honoraria; the apps will set the link on new ones. | Owner-authorized read-only Production read, 2026-10-29 (#1003263–#1003274). Owner: no changes to existing honoraria now; staff are working them. | Parked (owner, 2026-10-29) |
| DC6 | Account cleanup that reviewer institution-to-CRM linking waits on. | Reviewer institution typeahead stays parked until it is done. | `docs/CURRENT_WORK_QUEUE.md` ("parked pending Connor/Sarah account cleanup"). | Existing item; see source |
| DC7 | Contact duplicates and reviewer linking. | Reviewer records link to the wrong or duplicate contacts. | `docs/CONNOR_CONTACT_MERGE_AND_REVIEWER_LINKING.md` (2026-06-25). | Existing item; see source |
