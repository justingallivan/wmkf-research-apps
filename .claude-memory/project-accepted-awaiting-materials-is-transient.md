---
name: project-accepted-awaiting-materials-is-transient
description: Owner stance (2026-09-05): reviewers will receive materials immediately on acceptance going forward, so the "accepted, awaiting materials" reviewStatus is transient; no dashboard sub-count for it, and the unsmoked release-materials modal gets real exercise at the next acceptance.
metadata:
  type: project
  status: active
---

On 2026-09-05 (Session 489) the owner said that from the next cycle onward the
proposal materials will be in hand when reviewers accept, so materials are sent
immediately on acceptance. The `reviewStatus === 'accepted'` (no materials yet)
state is therefore expected to be momentary and "uninformative/vestigial".

**Why:** The Session 489 production smoke of the Stage 6B surfaces could not
exercise the release-materials modal because no active request had a reviewer
in that state; the dashboard rollup's "accepted" bucket (invitation outcome) does
not distinguish it from Materials Sent. The owner declined to treat either as a
gap worth building for.

**How to apply:** Do not propose a dashboard "awaiting materials" sub-count or a
Preview seeding exercise for the release-materials smoke. Treat the first real
acceptance in the December 2026 cycle as the natural smoke of that modal; record
it in the 6B3 receipt Promotion section when it happens. See
[[project-workbench-consolidation-rollout]] for the Workbench lifecycle context.
