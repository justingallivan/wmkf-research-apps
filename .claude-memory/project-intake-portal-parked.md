---
name: project-intake-portal-parked
description: The applicant intake portal build (/apply/*) is PARKED / back-burner as of 2026-07-08 — Connor is re-engineering GOApply for the next cycle; our portal work paused pending whether WMKF adopts it. Not dead; design memories retained for revival.
metadata:
  type: project
  status: active
  scope: intake
  last_verified: 2026-07-08 (S348) — owner decision
---

## Recall Rule

Read this when: about to plan, scope, or build any applicant intake-portal work
(`/apply/*`, `pages/api/intake/*`, the admin UI, institution-typeahead, or the
"skinny GOApply replacement").

Do:
- Treat the intake-portal build as **PARKED / back-burner** (owner decision
  2026-07-08). Do NOT spin up intake-portal build/planning as if it's active work.
- Keep the existing intake design memories as retained-for-revival (they capture
  real design decisions): [[project-intake-portal-skinny-scope]],
  [[project-intake-portal-institution-match]], [[project-intake-portal-ui-todo]],
  [[project-intake-portal-external-id-foundation]],
  [[project-intake-portal-reviewer-capture]].
- If the owner reopens it, resume from those memories + `docs/INTAKE_PORTAL_DESIGN.md`.

Do not:
- Mark the intake design memories stale/closed — the work is paused, not wrong or
  finished. It may revive.
- Re-raise "let's build the intake portal" unprompted (see
  [[feedback-dont-resurface-parked-items]]).

**Why (owner, 2026-07-08):** We had started building an applicant intake portal
(the skinny "external-reviewer-intake-but-for-applicants" model) but switched to the
more-pressing reviewer portal. In the interim Connor began re-engineering the GOApply
portal for the next cycle and is reluctant to let that go. Rather than contest it now,
the owner is putting our intake-portal effort on the back burner, hoping Connor later
agrees to adopt the portal we were building. This is an org/ownership call, not a
technical dead-end.

**Backend that already exists (do not assume nothing shipped):** the
`wmkf_portalmembership` entity + `lib/dataverse/adapters/membership.js` and the
`pages/api/intake/{draft,submit,...}` routes exist. What is NOT built: the staff
admin UI (`pages/apply/admin/` — collaborator approval + submitted-request list)
and the institution-match typeahead. See [[project-intake-portal-skinny-scope]].
