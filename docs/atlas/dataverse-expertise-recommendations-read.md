# Atlas: Sandbox expertise recommendations reads

**[BRANCH-BUILT, 2026-11-11]** The new read adapter projects the
Sandbox `wmkf_expertiseprofiles` entity set and the exact linked candidate
rows in `systemusers` for recommendation freshness. The checked-in schema
describes the roster profile fields. The entity registry entry recognizes
the entity set for the guarded adapter. Existing Expertise Finder runtime
and history use their established Postgres tables. This read path applies
no schema, copies no roster records and installs no cutover.

The service enters trusted DAL context after app and scoped staff checks.
The roster adapter requires the registered Sandbox origin and literal
enforcement flags. Its opt-in read path pins the OData origin and entity
for every page, rejects redirects, and refuses incomplete, capped,
malformed or duplicate projections. It uses an exact read for each
candidate User and requires an explicit disabled-state Boolean. The
complete projection produces a reproducible roster fingerprint. A
target mismatch or unverifiable observation withholds the result.

The same route reads only the granted Sandbox Request, exact staff
SystemUser and active expertise app-grant row. The Request's own
active location selects one combined narrative and bibliography PDF on
the registered shared SharePoint site. The scope includes no PI lookup,
Dataverse write, assignment, job admission or generation. The separate
default-off local trial uses the same strict roster and staff reads and
pins the Sandbox prompt version and source location. Its producer
extracts from the same verified combined PDF bytes. An unavailable app
grant observation can withhold a saved response for explicit recovery.
The approved PDF copy was verified in Sandbox Request 1000339. The local
operator trial published one scoped profile and prompt, admitted the
job on shared PostgreSQL, and delivered one content-free failure audit
in Sandbox Dataverse. The response failed domain validation and the job
retained no recommendations. The normal Microsoft OAuth GET showed
only an unavailable/unknown metadata envelope. An available/current
response through the signed route remains unverified.

[Local trial contract](../plans/SHARED_EXECUTOR_TASK_INTERFACES_2026-11-11.md#local-sandbox-recommendations-trial),
[Recommendation read contract](../plans/SHARED_EXECUTOR_TASK_INTERFACES_2026-11-11.md#sandbox-recommendations-read),
[Postgres ledger](postgres-prompt-jobs.md#typed-recommendations-fixture).
