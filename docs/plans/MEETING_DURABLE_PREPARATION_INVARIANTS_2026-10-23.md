# Durable meeting preparation guardrails

Implementation continuation of the approved Meeting Coordination plan. Owner: Codex; branch `codex/session-start-20261023`. No production writes or deployment authorized. Reuse the existing Postgres queue/cron and child artifact workers; no new integration or framework.

| Invariant | Surfaces | Verification |
|---|---|---|
| Source review is saved before processing and source publication has durable intent | Preparation API/store source step, existing correction publication receipt | Crash before/after source publication resumes exact receipt; stale correction version refuses |
| Success survives partial failure and browser departure | Preparation/step rows, worker, status API/panel | Mixed-success steps persist; duplicate start returns same preparation; only unfinished steps retry |
| Unknown paid calls never automatically repeat | Summary ownership, parent step attempt, shared reservation and expiry/read guards | Older than six minutes and fourteen days, legacy POST and maintenance races cannot dispatch |
| Coordinator may explicitly abandon unknown attempt | Recovery API/store and old completion fence | Required duplicate-charge warning/version; old completion cannot revive abandoned attempt |
| Ready edited drafts are retained | Shared summary reservation | Exact draft/version replacement only; blocked step reports conflict identity |
| Actor and request remain eligible | Worker reauthorization, request/visit and input identity checks | Changed app grant, visit, source or media refuses side effects |
| Board approval remains separate | Sticky enrollment and existing edition policy | Preparation never changes active edition; internal output never enters external allowlist |
| Historical acknowledgements remain truthful | Additive nullable provenance fields and all Meeting Tracker call sites | No fabricated acknowledgement; separate admin pilot unchanged |
| New durable surfaces are reviewable | Migration/manifest, Atlas, route matrix, tests | Actual SQL under isolated local PostgreSQL; scoped gates and independent review |

The durable parent stores references, versions, fingerprints and sanitized codes only. Summary text stays in its existing fourteen-day draft store. Unknown ownership tombstones survive that text expiry; no automatic deletion of unresolved attempts. No schema or paid model operation is exercised against Production during implementation.
