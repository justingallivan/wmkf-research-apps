# Memory Pending/Finished-Work Triage - Batch A - 2026-07-02

Status: Batch A complete.

## Invariants

- Closed migration memories must not look like pending carryover from their filenames or wikilinks.
- Active guardrails that prevent stale rebuild work should stay active, even if their filenames use words like shipped or abandoned.
- Truly open policy decisions may keep pending in the filename when the body clearly identifies the unresolved owner decision.

## Classifications

| Memory | Classification | Action |
|---|---|---|
| W6 reviewer-finder Postgres table drop | `CLOSE_HISTORICAL` | Renamed to `project-w6-table-drop-closed.md`; updated references to the closed route. |
| Wave 1 Postgres to Dataverse closeout plus role tail | `ACTIVE_NEEDS_PROBE` | Renamed to `project-wave1-closeout-role-tail.md`; migration is closed, but app-user temp-role state needs a fresh probe before action. |
| Dynamics feedback admin surface | `KEEP_ACTIVE` | Left active; it is a useful anti-rebuild guardrail for stale audit carryover. |
| Reviewer web-discovery abandoned path | `KEEP_ACTIVE` | Left active; it prevents reintroducing unsafe ungrounded reviewer discovery. |
| Applicant exclusion policy | `KEEP_ACTIVE` | Left active; the policy question is still explicitly open and owner-dependent. |

## Verification Notes

- Each Batch A memory file was read in full before classification.
- Direct references were grepped before rename decisions.
- No memory content was deleted in this batch; two files were renamed to clearer routes.
