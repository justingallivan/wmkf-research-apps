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

**Clarified 2026-09-06 (S490):** this is an AUTOMATION to be built, not a PD
promptness promise. Desired flow: all review materials are in hand at the time
of the request to review; upon acceptance AND onboarding, the system sends the
reviewer an email with a link to the review materials (the proposal) with no PD
action. Nothing does this today [VERIFIED S490: the acceptance job/drain handles
honorarium onboarding and bookkeeping only; materials go out solely via the
PD-driven `ReleaseMaterialsModal` → send-emails `materials` template]. Once
built, the manual modal becomes the exception/fallback path and its production
smoke is no longer a gating item; the smoke that matters is the automated send.

**Why:** The Session 489 production smoke of the Stage 6B surfaces could not
exercise the release-materials modal because no active request had a reviewer
in that state; the dashboard rollup's "accepted" bucket (invitation outcome) does
not distinguish it from Materials Sent. The owner declined to treat either as a
gap worth building for.

**How to apply:** Do not propose a dashboard "awaiting materials" sub-count or a
Preview seeding exercise for the release-materials smoke. The automated
materials-on-acceptance send is the next lifecycle build (not yet planned as of
S490); plan it before the December 2026 cycle's first acceptance. If it ships,
smoke the automated send; if it does not, the first real acceptance is the
natural smoke of the manual modal — record either in the 6B3 receipt. See
[[project-workbench-consolidation-rollout]] for the Workbench lifecycle context.
