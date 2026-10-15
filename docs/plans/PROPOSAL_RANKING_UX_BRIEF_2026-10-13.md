# Proposal Ranking — Impeccable shape brief

Date: 2026-10-13. Revision: 3. Status: **ACCEPTED — implementation authorized 2026-10-13.**
Controlling product rules: [design revision 5](PROPOSAL_RANKING_DESIGN_2026-10-07.md).
Build sequence: [implementation plan](PROPOSAL_RANKING_IMPLEMENTATION_PLAN_2026-10-13.md).
Phase 0 was accepted by the owner: “This is better. Let's use this direction and start implementing the updated workflow, including the smooth dragging and resets at every stage.” Branch implementation and remaining acceptance work are tracked in the implementation plan.

## Job, audience and visual authority

PDs independently assess proposals, then work through difficult funding choices as a
group. The owner confirmed **a facilitator sharing one screen, with PDs also following
on their own laptops**. Success means people can identify the proposal, understand
why assessments differ, move it or a boundary deliberately, and see the resulting
funding total without maintaining a spreadsheet.

Mode: **Operate**. Page type: **Workspace / Tool** containing an ordered working list.
Inherit PRODUCT.md and DESIGN.md: desktop first, neutral surfaces, Inter/system type,
left-aligned compact header, dark primary actions, restrained semantic color, shared
buttons and visible keyboard focus. The owner requested a surface-specific use of
semantic grade colors after finding revision 2 busy
and bland; later owner refinements below replace separate confidence symbols with borders. This extends the ranking visual treatment without changing the suite design system.
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

[VERIFIED via retained branch source/history] The October 7–8 work includes institution-first
cards with linked titles, lead PD, program/geography markers, individual reviewer-grade
badges and their mean, visible named PD ranks/average, and bottom-aligned requested and
cumulative amounts. `a2bebba6b` (October 8) adds `@hello-pangea/dnd` 18.0.1; its
DragDropContext/Draggable/Droppable integration remains in the paused branch. Later
October 8 commits refine the cards and remove repeated move buttons. Main still uses
the earlier native dragging; the branch is the reuse reference for smooth sorting.

The owner clarified that these cards captured useful information but their appearance
was not endorsed. Use them as a content checklist, not a fixed visual template. No
ranking-specific Impeccable critique/shape record was found in the inspected artifacts
or handoffs; the earlier app-wide critique is not evidence these cards were reviewed.
The initial October 13 sketches omitted too much information and are superseded by
revision 3's sketches below. Revision 3 is the owner-accepted direction. Earlier revisions remain superseded.

No matching Proposal Ranking surface brief was found by Impeccable context. Its other
surface briefs concern Meeting Tracker and Workbench. DESIGN.md is the visual authority;
the tool reported a stale generated design sidecar, which this task does not repair.

## Direction and screen sketches

**One ordered working list, with the next action and saved state always clear.**
Keep the list full width. Keep comparison evidence visible; expand longer supporting
material such as sentiment quotes and reviewer detail. Do not split
the main group view into three independent columns or introduce a second reordered
view. A/B/C and collective sections share the same physical separator interaction,
with different, explicit section names.

The vector sketches below use invented sample proposals and values, not grant data.
They illustrate hierarchy and states, not pixel specifications or a functional app.

1. [Private preparation sketch](evidence/proposal-ranking-shape/preparation.svg)
2. [Collective discussion sketch](evidence/proposal-ranking-shape/discussion.svg)
3. [Rebuild and reset sketch](evidence/proposal-ranking-shape/reset.svg)
4. [Dragging behavior storyboard](evidence/proposal-ranking-shape/dragging.svg)

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
- After reviewing the combined order, the PD selects **Ready for group discussion**
  once. That action confirms the current combined order and marks the PD ready in
  the same saved transition. It requires complete confidence and confirmed saves;
  later edits require reopening preparation and marking ready again.
- Ready collapses preparation to “Ready for group discussion” with a timestamp and
  **Reopen preparation** in its menu. It does not mean the facilitator has revealed.
- Group discussion before reveal shows only readiness progress/waiting guidance;
  peer assessments and sentiment do not appear there.

Place the active step's primary action above the list and repeat it only at the end
of a long list when useful. One visible saved-state message covers the active list:
**Saving…**, **All changes saved**, or an actionable unsaved/conflict message.

## 2. Card anatomy and separator behavior

### Current card anatomy — owner refinements after the build

The owner refined the accepted direction in the October 13 built-interface review.
These specifications supersede the earlier sketches where they differ:

- Neutral cards; vertically centered drag handle, with rank, institution and requested
  amount aligned on the top-row baseline. Linked project title sits below institution.
- Click the understated rank number for Move to position; no separate ellipsis menu.
- PD names centered over equally spaced 32 px grade tiles. Lead PD is first with a
  prominent underline; remaining PDs are alphabetical by first name. No Lead PD line.
- Solid tile borders mean confident; dashed borders mean uncertain. Remove check/question
  marks and move initial individual ranks and starting mean into Initial ranks details.
- Peer reviews occupy the center, with their label matching PD-name type and top edge.
  Reviewer and PD tiles have equal outer dimensions and share one aligned tile row.
- PD A/B/C tiles use green/yellow/red. Reviewer E/G/P use corresponding colors, with
  VG/F interpolated. Letters and accessible names retain meaning without color.
- Neutral MR/SE and E/W tiles occupy the right of that same row.
- No request numbers, peer-review mean/scored count, PD Grades/At reveal label, Grades
  differ badge, amber card background/border or per-card cumulative funding.
- Footer items share a baseline: Initial ranks disclosure, prior Research awards
  disclosure, earlier discussion and the recommendation badge at lower right.
- Research history summarizes count/latest year; expand for total qualifying Research
  funding in USD and scope. Missing/provisional coverage remains explicit.

Private preparation keeps explicit Confident / Not sure controls with an unanswered
state. Group confidence comes from the preserved reveal. Long names/titles and review
rows wrap rather than silently dropping information. Color and borders have accessible
text equivalents. The surrounding section owns grade; no second editable grade store.

### Smooth movement and accessible alternatives

Keep the branch's smooth sortable-card behavior and `@hello-pangea/dnd` 18.0.1 as the
reuse baseline, rather than reverting to main's native drag behavior or choosing a
new animation package. Verify its installed keyboard behavior, interactive-child
handling and reduced-motion treatment when implementing. This shape pass names the
existing dependency; it does not claim the new mixed card/divider list already works.

Use one clear drag handle in the rank gutter. Links, radios, menus and disclosures
remain independently usable. During a move the lifted card retains its width, other
cards smoothly make space, and the insertion position/target section remain visible.
Do not animate the list back to an old order when a save returns. Confirm saves quietly;
a failed/conflicting save keeps its explicit recovery state, not a misleading success.
Respect reduced-motion preferences with immediate or minimized displacement while
retaining placement feedback. Motion communicates destination, not decoration.

Retain keyboard dragging and cancellation from the package where verified. Expose **Move
to position…** by clicking the rank number as a discoverable non-drag alternative; do not restore
always-visible Up/Down buttons on every card. For bars, **Set boundary after position…**
provides the equivalent control. Section moves explicitly choose top or bottom so
placement is never guessed. Preserve focus and announce resulting position/section.
Test auto-scroll and focus with long lists. Card movement and bar movement must share
a coherent placement model while preserving the different grade-change semantics below.

A card crossing a divider changes its section while other proposals retain their
sections. Moving a divider reclassifies the proposals it passes. Persist order and
both boundaries together. Confidence stays with its proposal. Prevent the bars from
crossing; permit empty sections. Do not drag within a search-filtered subset: use
**Find proposal** to jump to/highlight a card in the full ordered list instead of
hiding proposals and making the boundary ambiguous.

## 3. Shared-screen discussion and laptop behavior

After reveal, open **Group discussion** with one collective order. The movable
**Recommended** divider prominently shows the requested total, recommendation count
and E/W counts. Missing amounts display **Total incomplete**. Do not repeat cumulative
funding on cards or display an E/W target anywhere on the page.

Group cards show the neutral compact anatomy above. Named PD grades remain visible;
solid/dashed borders carry confidence, and Initial ranks expands the preserved combined
positions and starting mean. The large rank means the current collective position.

The footer's Research disclosure exposes count/year/total and qualifying scope; the
optional authorized Earlier discussion summary expands supporting discussion evidence.
Neither history nor sentiment affects numerical ranking. The Research total is deployed
in the dedicated test Preview at `d1b206185`, not Production; old snapshots lacking the
field remain unavailable. Allow content-driven height and verify long-list shared-screen
readability. The owner has now authorized 12 realistic fictional sandbox proposals to
make that rehearsal more representative; provisioning and saved-round readback passed,
with Justin’s hosted two-program display and retained-history navigation verified.

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

## Acceptance and implementation consequence

The owner accepted revision 3 and explicitly requested app implementation, smooth
dragging and resets at every stage on October 13. No ranking, merge, privacy or
reset policy changed. The four sketches remain the visual/interaction reference.

[VERIFIED via branch source and local browser] `codex/proposal-ranking-v2` now
implements the mixed card/divider list with `@hello-pangea/dnd`, grade/confidence
tiles, visible named comparisons and contextual resets. A local four-proposal
rehearsal exercised keyboard movement, collective reset, reopened preparation and
390px layout. This is synthetic UI evidence, not saved Dataverse acceptance.
The later saved sandbox rehearsal passed 13 service-persona checks, followed by
a saved-D98 browser walkthrough with four trusted personas in normal Chrome.
That supersedes the earlier port-3136 browser block; independent-SSO acceptance
remains open. Browser testing found and fixed private-list rendering after reopen
and SE selection after confidence saves. A second reveal retained disagreement and
the unanimous cutoff; full restart then returned all four to Preparing with confidence
cleared and reveal disabled. Keyboard dragging persisted, but automated pointer movement
did not produce an observed saved drop. The user later confirmed basic pointer
movement/save (“It moves and saves”); 100-card pointer autoscroll/drop is now user-confirmed in the memory-only fixture. Retained D98 cards have numeric reviewer-distribution keys
and cannot establish reviewer-badge visual acceptance; future fixture generation
uses labels without rewriting the retained snapshot. The implementation plan and
`docs/audits/PROPOSAL_RANKING_V2_SANDBOX_REHEARSAL_2026-10-13.md` record the bounded
proof and remaining other-staff sign-in and live-sentiment checks. Justin real SSO and hosted opening passed.
A separate memory-only 100-proposal/12-PD fixture passed rendering, Find 100, keyboard
100→99 movement, Refresh retention and collective reset; saved maximum-capacity
transactions remain unverified. DESIGN.md and the suite design system remain unchanged.

## Current dedicated Preview and richer rehearsal

[VERIFIED via deployment receipt and hosted browser] Source `d1b206185` is deployed
in dedicated READY Preview `dpl_GCjqpVkTNncxSC2kRzByGLbbspyq` at
`https://wmkf-meeting-transcription-test-h2yh5pkf4.vercel.app`, with stable alias
`https://wmkf-meeting-transcription-test.vercel.app`. The compact card refinements
and expandable total Research funding are included. The release passed 179 ranking
tests and Justin's Microsoft SSO/updated-interface check. This is sandbox deployment,
not Production promotion or independent acceptance by the other three PDs.

[VERIFIED via provisioning logs, READY Preview and saved-round readback] The enriched
rehearsal is deployed from `591c3e98e7f24e699f7f83260a16ab1b1a929167` in Preview
`dpl_BcJwMnCKWAQp9RueY2F4hDNjdPb6` at
`https://wmkf-meeting-transcription-test-9qilqb16b.vercel.app`; the stable test alias
points to this deployment. New round `ea3496d5-c105-4e97-95c0-6b13a2e3f2ef` contains
12 realistic fictional proposals (six MR, six SE) and 36 saved synthetic reviews,
three per proposal, with all four PDs in private preparation and nobody ready.
Fictional institutions, geography, award histories and explicitly labelled sample
discussions use a strict dedicated-test projection; they are not real awards or
accepted human discussion analyses. The 182 ranking tests in 20 suites, scoped lint,
types and DAL/reviewer-boundary/script-writer/API/status gate/self-test pairs passed.
[VERIFIED via hosted browser] Signed-in Justin saw six proposals in each program,
distinct institutions/project titles and three review tiles per card, including
E/E/VG and divergent E/G/F. Both programs remained at 0/6 confidence answers.
History opened the original run read-only, and Open replacement run returned to
the enriched round. Anonymous `/api/proposal-ranking` returned 401. No PD assessment
data changed and no live group reveal occurred in this check; other staff sign-ins
and a full group walkthrough remain pending.

The atomic operator upgrade preserved old round `f48741f0-4560-471d-b51f-ef93db48c152`,
its exact frozen snapshot hash and lists, with previous/superseded links. This was a
fresh source-pool replacement, not a normal UI reset. The commit succeeded once;
a readback DTO typo was repaired and exact-hash/link verification completed without
replaying the mutation (`/private/tmp/ranking-rich-round-receipt.json`). Normal resets
continue to retain the current frozen pool. Production is unchanged.
