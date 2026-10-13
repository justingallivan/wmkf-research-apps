# Proposal Ranking — Impeccable shape brief

Date: 2026-10-13. Status: **DRAFT FOR OWNER CONFIRMATION — no app changes.**
Controlling product rules: [design revision 5](PROPOSAL_RANKING_DESIGN_2026-10-07.md).
Build sequence: [implementation plan](PROPOSAL_RANKING_IMPLEMENTATION_PLAN_2026-10-13.md).
This is phase 0's proposed interaction design, not an implemented or confirmed interface.

## Job, audience and visual authority

PDs independently assess proposals, then work through difficult funding choices as a
group. The owner confirmed **a facilitator sharing one screen, with PDs also following
on their own laptops**. Success means people can identify the proposal, understand
why assessments differ, move it or a boundary deliberately, and see the resulting
funding total without maintaining a spreadsheet.

Mode: **Operate**. Page type: **Workspace / Tool** containing an ordered working list.
Inherit PRODUCT.md and DESIGN.md: desktop first, neutral surfaces, Inter/system type,
left-aligned compact header, dark primary actions, restrained semantic color, shared
buttons and visible keyboard focus. No new visual identity or design-system changes.
This is a focused extension of the existing ranking surface: the agreed single-list,
movable-separator workflow fixes the structure; no unrelated layout tournament is needed.

[VERIFIED via source and local browser, October 13] Main's ProposalRankingApp has
separate program submission/publication and tall proposal cards. The paused branch's
isolated rehearsal renders ranked institution/title cards, program markers, reviewer
grades and requested/cumulative amounts. Inspected its opening preview at localhost
with six fictional proposals and three fictional PDs. It is a branch rehearsal, not
the new workflow or proof of current production behavior. The live route reached a
sign-in page; no authentication or live mutations were performed. The large centered
header and two opening program panels in that rehearsal are evidence, not the proposed
layout: DESIGN.md now calls for a compact left-aligned staff-page header.

No matching Proposal Ranking surface brief was found by Impeccable context. Its other
surface briefs concern Meeting Tracker and Workbench. DESIGN.md is the visual authority;
the tool reported a stale generated design sidecar, which this task does not repair.

## Direction and screen sketches

**One ordered working list, with the next action and saved state always clear.**
Keep the list full width; use inline expansion for supporting evidence. Do not split
the main group view into three independent columns or introduce a second reordered
view. A/B/C and collective sections share the same physical separator interaction,
with different, explicit section names.

The vector sketches below use invented sample proposals and values, not grant data.
They illustrate hierarchy and states, not pixel specifications or a functional app.

1. [Private preparation sketch](evidence/proposal-ranking-shape/preparation.svg)
2. [Collective discussion sketch](evidence/proposal-ranking-shape/discussion.svg)
3. [Rebuild and reset sketch](evidence/proposal-ranking-shape/reset.svg)

## 1. Navigation and progression

Use a compact cycle/round header followed by two main page sections: **My preparation**
and **Group discussion**. A facilitator additionally has **Facilitate**. Put prior runs
and reveals under **History** in the round menu; label every historical view read-only
and provide an obvious return to the current work. Do not show raw version IDs.

My preparation has an ordered step strip: **Programs → Combined list → Ready**.
Within Programs, a single MR/SE segmented control changes the active list. Either
program may be assessed first; preserve its scroll position and current selection.
Completed steps collapse to a compact summary and remain revisitable. Avoid a dashboard
of duplicated lists or a separate submission action for each program.

- On first entry explain once: “Proposals start in reviewer-score order. Move the
  proposals and dividers to make your assessment; answer confidence for each.”
- Show **Confidence answered 4 of 6**, not “4 reviewed”: position and initial grades
  alone do not prove deliberate review. The facilitator sees readiness progress,
  not an invented per-card completion metric.
- **Create combined list** appears after both program lists have saved confidence
  answers for every proposal. This is a proposed UI progression, not a new vote rule.
  Empty programs count as complete and do not require a dummy action.
- Combined shows one MR/SE list. A short expandable “How this list was started”
  explanation describes grade-by-grade pairs and the within-pair reviewer comparison.
  Do not leave the two source lists beside the combined list.
- **Confirm combined order** follows review. Later combined edits clear confirmation.
  Ready requires that confirmation, complete confidence and confirmed saves.
- Ready collapses preparation to “Ready for group discussion” with a timestamp and
  **Reopen preparation** in its menu. It does not mean the facilitator has revealed.
- Group discussion before reveal shows only readiness progress/waiting guidance;
  peer assessments and sentiment do not appear there.

Place the active step's primary action above the list and repeat it only at the end
of a long list when useful. One visible saved-state message covers the active list:
**Saving…**, **All changes saved**, or an actionable unsaved/conflict message.

## 2. Card anatomy and separator behavior

Private card, in reading order:

1. Unique position, institution, proposal title/link, request number and MR/SE marker.
2. Reviewer mean and number of scored reviews; requested amount and E/W as compact
   metadata. Use the full words East/West in accessible labels, not an ambiguous E.
3. **Confidence in my assessment:** two radio choices, **Confident / Not sure**.
   Neither is selected initially. Do not use one checkbox whose unchecked state
   could mean either unanswered or not sure.
4. A quiet **Move…** control; reviewer distribution/supporting context starts collapsed.
   Keep funding history, if shown in private preparation, secondary and unweighted;
   sentiment is absent. Do not add per-card notes, scores or extra workflow fields.

Show the grade as text derived from its section, not an independently editable grade
field. A and C are judgments, not green success and red error states. Prefer neutral
section labels and restrained divider emphasis; reserve amber for actual uncertainty
or unsaved/conflicting work. Do not conflate reviewer ratings with the PD's A/B/C.

Two full-width movable divider bars sit in the list: **End of A · Fund** and
**End of B · Maybe fund**. The C section follows. Group bars instead read
**End of Recommend funding** and **End of Alternates**. Section headings show names
and counts, including empty sections. Top and bottom remain valid destinations.

Drag handles are distinct from links/radios/disclosures. Show the insertion position
and destination grade while dragging; announce the result with position and section.
Retain the existing accessible movement alternative: Move… provides up/down and an
explicit destination position/section. For bars, **Set boundary after position…**
provides a non-drag alternative. Section moves explicitly choose top or bottom of the
section so placement is never guessed. Keyboard users can cancel without changes,
retain focus on the moved item and hear the resulting rank/grade.

A card crossing a divider changes its section while other proposals retain their
sections. Moving a divider reclassifies the proposals it passes. Persist order and
both boundaries together. Confidence stays with its proposal. Prevent the bars from
crossing; permit empty sections. Do not drag within a search-filtered subset: use
**Find proposal** to jump to/highlight a card in the full ordered list instead of
hiding proposals and making the boundary ambiguous.

## 3. Shared-screen discussion and laptop behavior

After reveal, open **Group discussion** with one collective order and a compact
persistent summary: **Recommend funding: count · requested total · West/East/Unknown**.
Place cumulative requested cost at each card and at the funding boundary. The tally
updates as cards/bars move, marked Saving until confirmed. Missing amounts display
**Total incomplete**, never an apparently exact slate total. No new budget-setting
form or automatic cutoff is introduced. Show the soft 2W:1E award-count target as
context, not a quota meter that turns red when the group disagrees with it.

Collapsed group card retains proposal identity, current position/program, requested
and cumulative amount, reviewer result, a compact A/B/C count and not-sure count,
and a plainly labelled rank range. Show Research award count/latest year as a quiet
line with unavailable/provisional qualifiers. Show the current authorized earlier
sentiment summary briefly; expand its supporting quotes/disagreement/uncertainty.
Do not make sentiment a colored overall proposal score.

Expand **PD assessments** inline to show a table: PD name, individual combined rank,
A/B/C, Confident/Not sure. Those inputs carry the “At reveal” label and no edit controls.
Highlight differing grades visibly; present rank range directly rather than inventing
a new divergence threshold in this shape pass. A score distribution disclosure stays
separate from individual PD assessments. Expanded content pushes following cards down
without hiding the list in a modal. Avoid automatically opening every detail panel.

The facilitator shares this same group view; no special presentation mode is required.
PDs may independently scroll and expand evidence on their laptops. Opening a card,
scrolling or searching on one device never forces another device to follow it. Keep
collective edit permissions as agreed; do not silently make the group facilitator-only.
Coordinate who moves proposals verbally. Shared edits remain subject to server conflict
checks; do not add locking, cursor presence or WebSockets in this UX pass.

Display **Last refreshed [time] · Refresh**. Refresh on returning to the tab when safe;
never replace unsaved local work. This first design does not promise live synchronized
scrolling or instantaneous updates. The shared screen is the discussion reference;
laptop users refresh to see confirmed group changes. If an update conflicts with local
work, explain it and offer the saved order before another deliberate edit. Never silently
replay an old drag onto a newer collective order. Use the existing implementation plan's
sentiment refresh/currentness rules; reopening private preparation removes sentiment.

Export remains available from the current saved group view with **Export workbook**.
It uses the matching revealed inputs, includes human-readable provenance, and does not
lock the group. A pending/uncertain save shows why export is temporarily unavailable.

## 4. Facilitator workspace, rebuilds and resets

Facilitate begins with one readiness row per PD. Private assessment inspection is an
explicit read-only disclosure with a warning: **Private preparation — visible to you
and this PD. Do not share this view before reveal.** Do not render every private list
expanded at the top of the facilitator page. Group discussion remains safe to share
before reveal: only progress, never facilitator-only content.

When all are ready, **Reveal group starting order** explains that named assessments
will become visible and the calculated collective list will be created. A reveal
failure keeps the prior stage and does not show a partly populated collective view.
After reveal, facilitator administration sits in the round menu; it does not compete
with the discussion list.

Personal resets live in the relevant program/combined menu. Shared resets live in
facilitator round controls. Use specific verbs, not one ambiguous “Reset” button:

| Action | Confirmation copy / resulting focus |
|---|---|
| Reset MR preparation | “Restore reviewer-score order and the starting A/B/C dividers for MR? MR confidence answers will be cleared. Your combined list will need rebuilding. SE is unchanged.” Focus MR heading after success. |
| Rebuild combined list | “Replace your combined order, grades and confidence with your current MR and SE assessments? Changes made only in the combined list will be replaced. You will review it and mark ready again.” Focus combined heading. |
| Reopen preparation after reveal | “Start a new private preparation version from the revealed individual work? Everyone must mark ready again. This reveal and the group's saved order remain in history.” Return to readiness overview; PDs see their preparation. |
| Reset collective recommendation | “Restore the calculated order and starting recommendation dividers from this reveal? The current group revision will remain in history. Individual assessments stay unchanged.” Focus group heading. |
| Restart walkthrough | “Start again with the same proposals and reviewer scores? Preparation will return to reviewer-score order and starting thirds, with confidence unanswered and nobody ready. The previous run stays in history.” Focus new preparation/start overview. |

If program work changes after a combined list exists, show a persistent inline notice:
**“Your combined list was built before your latest program changes.”** Keep the old
combined list visible read-only for reference with **Rebuild combined list** and
**Return to programs**. Do not silently rebuild, offer a misleading Ready action,
or imply that the earlier combined-only changes will survive rebuilding.

Use normal confirmation dialogs with Cancel and the explicitly named action; no typed
magic word. No claim of one-click undo when the plan provides retained history instead.
Close a dialog only on confirmed success; uncertain outcomes switch to checking status.
All-stage resets remain available as agreed, including after export; ordinary pending
save and authority checks still apply. Old downloaded workbooks cannot be revoked.

## 5. States, ranges and accessibility acceptance

| Case | Proposed response |
|---|---|
| Loading | Keep cycle/title/stage identity; skeletons in the affected list. No fabricated proposal rows or confidence defaults. |
| Empty program/section | Explain no proposals; leave empty grade/collective sections and boundary targets visible. No fake cards. |
| Not ready | State the concrete requirement: unanswered confidence, combined review, or unconfirmed saves; jump to the affected item/step. |
| Save conflict/uncertainty | Persistent local message and explicit recovery; keep local work identifiable, pause ready/export/reset until resolved. No transient success toast. |
| Lost access | Clear private assessments/quotes, preserve non-sensitive page identity, explain access changed. No hidden peer content in the response. |
| Missing reviewer score/history/sentiment | Label the missing value distinctly. History zero means no recorded qualifying Research awards; sentiment dependency errors and denied access differ from no available analysis. |
| Long title/list | Wrap identity; no truncation of the only title. Find jumps within the full list, preserve scroll/focus, keep controls and totals reachable. |
| Narrow screen or zoom | Stack card metadata and assessment rows; no fixed sidebar or whole-page horizontal scroll. Keyboard movement remains available. |
| Reopened/history view | Clear current/private or historical/read-only label; old reveal never masquerades as current votes. |

Shape stress cases (synthetic, not production counts): 0, 1, 2, 6, 24 and 60 proposals;
unequal program lengths; four PDs with wider-name/extra-column stress; long institution
and proposal titles; all A/all C/no unanimous blocks; no reviewer score; unknown E/W;
missing amount; mixed confidence; stale combined draft; peer update during movement.
The actual supported maximum is still an engineering capacity test in the build plan.

Accessibility scope is this surface: labelled radio groups and controls, non-color
section/status meaning, keyboard and non-drag movement, retained focus, polite result
announcements, sensible heading order, contrast verification and usable zoom. This
brief does not invent a suite-wide conformance certification. Measure the built UI
in the scheduled critique/audit; sketches do not prove accessibility.

## Confirmation and implementation consequence

Proposed decisions to confirm together: single active preparation list, compact stage
navigation, inline group evidence, same group view for the projector/laptops with
independent browsing and explicit refresh, and contextual named reset actions.
No scoring, merge, reveal, history-scope or reset policy has been changed.

After confirmation, link this brief as phase 0's accepted output and proceed only when
app implementation is requested. Until then it stays a draft; do not write a direction
contract, replace DESIGN.md, or change runtime code. Later critique/audit reviews the
actual built surface once, fixes one batch and confirms once, per the implementation plan.
