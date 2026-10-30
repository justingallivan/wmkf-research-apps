---
name: akoya_request — Program Director fields
description: Which fields on akoya_request hold the program director, secondary PD, coordinator, and meeting date — used to filter "my proposals" for the authenticated user
type: project
originSessionId: 8d412c2f-d6c6-4080-a43c-79e0e04e9653
status: active
scope: dynamics
last_verified: 2026-07-27 via docs/atlas/dataverse-akoya-request.md and current request-reader source; sample 1002379 remains dated evidence
---

## Recall Rule

Read this when: you need to filter `akoya_request` rows by program director, secondary PD, coordinator, or meeting date (e.g. "my proposals in cycle Jxx").

Do:
- Filter on `_wmkf_programdirector_value` for "proposals I'm responsible for" — this is the lead PD that assigns reviewers.
- Take the cycle from the request's Grant Cycle link, never the meeting date (meeting-date retirement step 2): filter with `linkedCycleFilter(code)` and read with `linkedCycleExpand()` / `linkedCycleCode(row)` from `lib/dataverse/adapters/operations-grant-cycle.js`. See [[akoya-temporal-axis-encodings]].

Do not:
- Use `ownerid` as the program director — it's a service account (`# BCO akoyaGO Integration`).
- Include `wmkf_programdirector2` in reviewer-finder filters — it does not assign reviewers.
- Confuse the five `wmkf_potentialreviewer1..5` lookup slots with the `wmkf_appreviewersuggestion` lifecycle ledger.

Ground truth: validated against prod request 1002379 (St. Jude / Christoph Gorgulla); `akoya_request` Dynamics schema. See `docs/atlas/` Dynamics entity pages for live schema.

**Lead PD (the one who assigns reviewers):** `wmkf_programdirector` — Lookup → `systemuser`. This is the field to filter on for "proposals I'm responsible for."

**Secondary PD:** `wmkf_programdirector2` — Lookup → `systemuser`. Exists but does NOT assign reviewers; each proposal has exactly one lead PD that does. Don't include in reviewer-finder filters by default.

**Program Coordinator:** `wmkf_programcoordinator` — Lookup → `systemuser`. Operational support, not the reviewer-assignment owner.

**Meeting Date:** `wmkf_meetingdate` — DateTime. No longer the cycle source in app code; the Grant Cycle link `wmkf_grantcycle` is (owner, 2026-10-29).

**`ownerid` is NOT the program director.** On real prod data (request 1002379), `ownerid` was `# BCO akoyaGO Integration` (a service account from the import pipeline). Always filter on `_wmkf_programdirector_value`.

**Pre-existing reviewer slots:** `wmkf_potentialreviewer1` through `wmkf_potentialreviewer5` — five lookup slots → `wmkf_potentialreviewers`. Connor's pre-existing pattern. Separate from our `wmkf_appreviewersuggestion` lifecycle ledger (which can hold many candidates per request before staff narrows to 5).

**Filter pattern for "my proposals in cycle Jxx":**
```
_wmkf_programdirector_value eq {systemuserId}
  and wmkf_GrantCycle/wmkf_cyclecode eq 'J26'
```

**Sample request used to validate this:** 1002379 (St. Jude / Christoph Gorgulla; PD = Justin Gallivan; Meeting Date 2026-06-04 → J26).
