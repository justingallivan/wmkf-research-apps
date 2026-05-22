---
name: Reviewer lifecycle — automate the manual tracking points
description: Reviewer-recruitment lifecycle has timestamp/status fields that are set manually; long-term goal is automated reminders driven by these fields. Originally framed against the Postgres reviewer_suggestions schema; post-W3-W6 cutover the same fields live on Dataverse wmkf_appreviewersuggestion. Design discipline below still applies.
type: project
originSessionId: 223c47bb-55ef-4adb-bab2-c2616bfa5311
---
The reviewer-recruitment lifecycle today has several semi-manual tracking points: email-sent (semi-automated via .eml workflow today), email-opened (not tracked), response-received (manual), review-received (manual via upload). The forward goal is automated reminders and status transitions driven by these fields.

**Why:** Justin flagged this during Session 113 while designing the direct-email-send feature. Sending tens of emails per cycle is small enough to micromanage today, but follow-up cadence (e.g., "reviewer hasn't responded in 14 days → send reminder") is exactly the kind of thing that should be automated, not tracked in someone's head.

**How to apply:**
- **Direct send** turns `materials_sent_at` / `reminder_sent_at` / `thankyou_sent_at` into truthful timestamps (currently set on .eml *generation*, not actual delivery). Already in design.
- **Regarding-link to `akoya_request`** means email history is queryable from CRM directly — `Dynamics emails where _regardingobjectid_value = <requestId>` lists every email touching the proposal. We don't need to duplicate this in our DB.
- **Wave 2 schema design** should consolidate the messy current state (boolean `selected`/`invited`/`accepted` + many timestamps) into a clean state machine: the migration plan already calls this out via `wmkf_review_status` choice (`accepted | materials_sent | under_review | review_received | complete`) + `wmkf_response_type` choice. Designing for cron consumption: any new field should be queryable in a single filter (e.g., "give me all suggestions where `wmkf_review_status = materials_sent` and `materials_sent_at < now() - 7d` and `reminder_count = 0`").
- **Automated reminders** are out of scope for the direct-send work, but worth designing soon — the logic is straightforward (cron query + threshold) but the cadence + content needs Justin's input. Likely a PA flow eventually, with the same prompt-row pattern Connor builds for other backend automation.
- **Response-received** is the only remaining hard-manual step. Two paths: (a) staff click "mark received" in UI when they get the email/upload, or (b) Dynamics Server-Side Sync ingests reply emails and we cron-sync them — feasible since `regardingobjectid` will link replies back to the original.

Keep this in mind when shaping `wmkf_appreviewersuggestion` (Wave 2). Don't add new manual-state fields without thinking about how an automated job would query them.
