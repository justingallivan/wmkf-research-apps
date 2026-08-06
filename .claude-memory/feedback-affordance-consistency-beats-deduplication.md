---
name: Consistent affordances beat selective de-duplication
description: If a class of UI element is made clickable, make the WHOLE class clickable — an affordance that is sometimes live and sometimes inert is worse than one that is occasionally redundant.
type: feedback
status: active
scope: reviewer
last_verified: 2026-08-06 via owner direction in S403 (candidate-card warning badges, commit e58d2d5)
---

## Recall Rule

Read this when: adding, removing, or conditionally gating a click/tap affordance on a
class of UI elements (status badges, pills, chips, banners) — especially when the
motivation is "this one is redundant with a nearby button".

Do:
- Apply the affordance to the entire class. Users learn "warnings are clickable" in
  seconds; every exception costs that trust and makes the whole class feel unreliable.
- Solve perceived clutter by removing or demoting the control that is actually
  **misleading**, not by making the rule conditional.
- Keep the fail-closed exception separate and principled: a control may be inert when
  its remedy genuinely cannot run (read-only, unresolved prerequisite, missing record).
  That is not an inconsistency — it is the affordance honestly reporting that no action
  exists. Never render a live-looking control whose handler is unavailable.

Do not:
- Revert part of a consistency change to reduce duplication. In S403 the assistant
  proposed making two of six clickable warning badges inert again because their remedy
  button was already prominent; the owner rejected it: *"That seems like bad design.
  Sometimes warning bubbles are functional, sometimes they aren't?"*

**Why:** the S403 candidate-card work made six warnings route to their remedy. On the
identity-unresolved card that produced two doors to the same modal, which read as
clutter. The correct diagnosis was not "too many doors" but "one of the doors is a
trap" — `⚑ Create repair request` sat in the action row looking like the address fix
while being unable to resolve anything, which is what caused a needless repair ticket
to be filed against request 1003046.

**How to apply:** when a surface feels crowded, ask which control is *lying about what
it does* before asking which is redundant. See [[project-reviewer-card-simplification-direction]]
for the resulting redesign and [[project-reviewer-verify-fail-dangerous]] for the
fail-closed boundary this rule must not erode.
