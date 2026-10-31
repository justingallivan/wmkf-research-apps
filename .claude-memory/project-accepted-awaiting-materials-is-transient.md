---
name: project-accepted-awaiting-materials-is-transient
description: Materials-on-acceptance is implemented via PR 562; awaiting-materials remains a transient/fallback state, not a separate dashboard project.
metadata:
  type: project
  status: active
last_verified: 2026-10-31 via source and Git ancestry; dated release receipts, no live probe
---

## Recall Rule

Read when planning reviewer dashboard counts, materials delivery or acceptance
recovery. Do not propose another materials-on-acceptance build, an awaiting-materials
sub-count, or a synthetic manual-modal smoke as an open D26 requirement.

## Current implementation boundary

[VERIFIED via source/Git, 2026-10-31] PR #562 (`fcad0ad53`) implements
`releaseMaterialsOnAcceptance` in `lib/services/reviewer-acceptance-drain.js`.
The acceptance drain and manual Release Materials send share one durable
`reviewer_materials_releases` claim per engagement before minting the link.
Successful automatic delivery records the reviewer markers; preparation failures
retry for about 15 minutes before the old confirmation/manual-release fallback
and staff alert. Uncertain sends require the documented staff recovery, not a
blind automatic resend. See `docs/atlas/postgres-reviewer-materials-releases.md`
and `docs/plans/REVIEWER_INVITATION_CALENDAR_BUILD_PLAN_2026-10-29.md`.

Session657 and DEVELOPMENT_LOG record migration 091 applied and Production
release on 2026-10-31. Those are dated operational receipts; this audit did not
probe current configuration or prove a natural J27 acceptance delivery. PR #568
(`166b808e2`) adds the manual-send fresh reviewer check and ETag-bound mint.

Remaining work: observe the first natural J27 acceptance delivery; separately
scope invitation wording / `{{proposalDelivery}}` and old date-field retirement.
Do not turn those follow-ups into a claim that automatic delivery is unbuilt.

## Historical owner decisions — 2026-09-05–06

The owner expected materials to be in hand by acceptance for J27 (June 2027),
with proposals arriving in December 2026 and invitations in 2027. The temporary
accepted-without-materials state was called uninformative/vestigial, so no new
dashboard sub-count was wanted. The manual-modal smoke was closed as a D26
requirement; a replacement reviewer could exercise it naturally. At that dated
checkpoint the automatic send did not exist. The implementation above supersedes
that old status while preserving the owner's product decision.

Hub: `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md`.
