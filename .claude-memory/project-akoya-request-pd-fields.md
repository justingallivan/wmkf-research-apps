---
name: akoya_request — Program Director fields
description: Which fields on akoya_request hold the program director, secondary PD, coordinator, and meeting date — used to filter "my proposals" for the authenticated user
type: project
originSessionId: 8d412c2f-d6c6-4080-a43c-79e0e04e9653
---
**Lead PD (the one who assigns reviewers):** `wmkf_programdirector` — Lookup → `systemuser`. This is the field to filter on for "proposals I'm responsible for."

**Secondary PD:** `wmkf_programdirector2` — Lookup → `systemuser`. Exists but does NOT assign reviewers; each proposal has exactly one lead PD that does. Don't include in reviewer-finder filters by default.

**Program Coordinator:** `wmkf_programcoordinator` — Lookup → `systemuser`. Operational support, not the reviewer-assignment owner.

**Meeting Date:** `wmkf_meetingdate` — DateTime. Drives cycle code derivation (June → `J{YY}`, December → `D{YY}`).

**`ownerid` is NOT the program director.** On real prod data (request 1002379), `ownerid` was `# BCO akoyaGO Integration` (a service account from the import pipeline). Always filter on `_wmkf_programdirector_value`.

**Pre-existing reviewer slots:** `wmkf_potentialreviewer1` through `wmkf_potentialreviewer5` — five lookup slots → `wmkf_potentialreviewers`. Connor's pre-existing pattern. Separate from our `wmkf_appreviewersuggestion` lifecycle ledger (which can hold many candidates per request before staff narrows to 5).

**Filter pattern for "my proposals in cycle Jxx":**
```
_wmkf_programdirector_value eq {systemuserId}
  and wmkf_meetingdate ge '2026-06-01'
  and wmkf_meetingdate lt '2026-07-01'
```

**Sample request used to validate this:** 1002379 (St. Jude / Christoph Gorgulla; PD = Justin Gallivan; Meeting Date 2026-06-04 → J26).
