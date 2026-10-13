# Proposal Ranking — agreed assessment and recommendation workflow

Updated: 2026-10-13. Revision: 5. Owner: Justin.
Status: **Product workflow agreed; revision-3 UX accepted and implementation authorized 2026-10-13. Branch build awaiting sandbox acceptance.**
The filename is retained for existing links; October 7 is the original design date,
not the date of this revision. This revision incorporates the later October 13
reset/default decisions and resolves revision 4's open product choices. It supersedes
revision 3's workflow and the October 11 branch's combined-meeting approach.

Authority: Justin's October 13 decisions in the current conversation, including the
colleague-reviewed text and the supplied October 11–12 conversation/handoff.
That handoff's Word proposal is prior context, not authority over these newer decisions.
Implementation now proceeds on `codex/proposal-ranking-v2`; this design does not authorize production promotion or legacy-data cleanup.

Implementation evidence and source comparison:
`docs/audits/PROPOSAL_RANKING_WORKFLOW_RECONCILIATION_2026-10-13.md`.
Storage/current-state inventory: `docs/atlas/dataverse-proposal-ranking.md`.
Implementation sequence: `docs/plans/PROPOSAL_RANKING_IMPLEMENTATION_PLAN_2026-10-13.md`.
Existing API versus planned contract changes: `docs/plans/PROPOSAL_RANKING_API_CONTRACT.md`.

## 1. Purpose and end-to-end process

Help PDs prepare independently, discuss difficult choices together, and produce an
ordered quantitative recommendation for leadership and the Board without working
through spreadsheets during the meeting. The exported workbook is an output.
Ranking does not approve grants or write funding decisions into source requests.

**Separate MR/SE preparation → each PD's combined ranking → everyone ready →
facilitator reveal → one collective recommendation → two-sheet workbook.**

## 2. Individual preparation — agreed

Each PD starts with separate Medical Research (MR) and Science & Engineering (SE)
lists. Seed each by the unrounded average external peer-review overall-assessment
score, highest first. Unscored proposals go last. Preserve the existing recognized
saved rating scale and ordinary/nonsynthetic review isolation.

Two movable bar separators initially divide each score-ordered program list roughly
into thirds: top A, middle B, bottom C. These are editable starting placements,
not an assertion that the PD has already endorsed the reviewer-derived grades.

- **A — fund; B — maybe fund; C — don't fund.**
- Every PD responds to every proposal; there are no passes or abstention categories.
- Each proposal also receives **confident / not sure**. This describes certainty
  about the assessment, not a scientific score or a numerical voting weight.
- PDs reorder within grades to express stronger/weaker preferences without plus/minus
  labels or tied positions. Moving a card across a separator changes its grade;
  moving a separator changes the grades of the cards it passes.
- Confidence follows the proposal when its position or grade changes. A confidence
  response must be explicitly supplied before ready; no automatic confident default.
- Rare conflicts are handled through discussion, not coded recusal/excusal controls.
- Sentiment is absent from individual preparation, including the combined PD list.

The initial thirds are not a quota: separators can be moved freely, including empty
sections. Exact remainder placement for short lists is an implementation detail to
specify and test; the agreed product rule is roughly equal initial sections.

## 3. Merge each PD's MR and SE lists — agreed

Merge by grade, A then B then C. Within each grade:

1. Take that PD's first MR and first SE proposal as a pair, then second/second, etc.
2. Within each pair, put the higher external reviewer mean first.
3. Finish the pair before processing the next pair. Never globally sort the merged
   grade by reviewer score: doing so could override the PD's within-program order.
4. Append unmatched proposals from the longer program list, in their existing order,
   at the end of that grade.

Example: MR A order `[MR1 (4.2), MR2 (4.5)]`; SE A order
`[SE1 (4.6), SE2 (4.0), SE3 (4.8)]` becomes
`[SE1, MR1, MR2, SE2, SE3]`. Even SE3's higher reviewer score cannot leap over an
earlier pair. Both within-program orders are preserved by this initial merge.

The PD then actively reviews and reorders the combined list to express actual
cross-program preferences. It retains A/B/C separators and confidence; the PD may
revise grades. The combined grade boundaries reflect that PD's merged assessments,
not another automatic division into thirds.

No ties: each proposal has one distinct position. The deterministic fallback discussed
with this decision is reviewer mean descending, then numeric-aware request number
ascending; use request identity only as a final technical fallback. A known score
precedes a missing score; two missing/equal scores use the fallback. These fallback
rules settle otherwise equal ordering, not substantive preference differences.

All preparation is rebuildable. Returning to a program list never silently overwrites
an edited combined list. Editing either program clears readiness and invalidates
combined confirmation. The PD explicitly rebuilds from the current program lists,
reviews the replacement, and reconfirms the combined ranking before marking ready.
The confirmation explains that combined-only ordering and assessment changes will
be replaced by the program assessments. Confidence follows each proposal from the
program preparation used in the rebuild.

## 4. Ready, privacy, and reveal — agreed

Before reveal, preparation is visible only to its PD and the facilitator. Other PDs
cannot inspect it. The facilitator does not edit someone else's private assessments.

A PD can mark ready only after every proposal has a grade, a confidence response,
and a confirmed unique position in that PD's complete combined list, with all saves
confirmed. Before reveal they can reopen preparation; reopening clears readiness.
They must mark ready again after revising.

Once every PD is ready, the facilitator performs **one reveal action per preparation
version**. Reveal:

- Preserves every PD's combined ranking, A/B/C grades, and confidence as immutable
  individual inputs, with the identities and versions that contributed.
- Calculates and exposes the group's starting order and named individual comparisons.
- Starts one shared collective list. There is no separate generate/publish workflow
  for each program and no facilitator rearrangement of a hidden calculated draft.

During normal group work, only the collective order/classification changes. Individual
inputs remain as they were at that reveal. An explicit facilitator reset may reopen
preparation for a new version (§10); it never edits the preserved reveal. Everyone
must mark ready again before another reveal. A second individual assessment round
is available when needed, not a mandatory step. There is no bypass for an unready PD,
including in a dry run. Facilitator status alone adds no vote.

## 5. Calculate the group starting order — agreed

For each proposal, average its position in **every PD's confirmed combined MR/SE list**,
with equal weight per PD. Lower average ranks first. Compare exact rank sums with the
common participant denominator before display rounding.

Resolve equal averages by higher reviewer mean, then numeric-aware request number,
then request identity as the technical last fallback. The list and export have unique
positions even when displayed average values coincide. Do not show shared ranks or
"tied" badges. A/B/C, confidence, geography, funding history, and sentiment do not
weight the calculation. Reviewer mean only seeds preparation and breaks ordering ties.

Averaging separate program ranks or interleaving group program lists is **not** this
calculation: individual cross-program preferences must actually have been recorded.
Preserve the calculated baseline separately from the mutable collective order.

## 6. Group discussion and collective recommendation — agreed

Quickly settle easy A's and definite C's, then focus on uncertain assessments,
divergent preferences, and difficult funding choices. Show individual grades,
confidence, combined ranks, reviewer results, and visible disagreement.

One collective MR/SE list has two movable separators:

1. **Recommend funding** — the proposed slate.
2. **Alternates** — worthwhile proposals below the available budget, in priority order.
3. **Do not recommend** — proposals the group decides against on merit.

Moving a separator reclassifies the proposals it passes. Moving a card across a
separator changes its collective section, not anyone's preserved individual grade.
Requested amounts and cumulative cost update with the visible order. The group sets
the funding boundary; the budget does not automatically grade or select proposals.
Use full requested amounts, one verified currency, and integer minor units. Missing
amounts remain visibly incomplete rather than zero.

Initially, place the first separator after the contiguous leading proposals that
every PD graded A, and the second before the contiguous trailing proposals that
every PD graded C. Leave the calculated order unchanged; all proposals between
these bars start as Alternates. Unanimous proposals elsewhere do not jump over
other proposals. With no unanimous-A prefix, the first boundary is 0; with no
unanimous-C suffix, the second is the list length. Confidence does not affect
unanimity. These editable starting recommendations are not funding decisions.

E/W award counts describe the Recommend funding section, with unknown geography
kept distinct. The general target is **two western awards per eastern award by count,
not dollars**, not a hard per-cycle constraint. Merit may justify deviation. Give some
preference to previously unfunded institutions without a points system, automatic
bonus, or requirement to recommend a proposal the group cannot support on merit.

Institutional funding context is **prior award count and most recent award year**.
Prior funding dollars are not part of the agreed card/export design. Distinguish
"no recorded awards" from unavailable/incomplete history and retain provisional
qualifications. Use **qualifying Research awards across all available history**,
with no arbitrary recent-years window, and label that scope. Show the most recent
qualifying award year, not its month/cycle. No qualifying Research awards is not
evidence that the foundation has never funded the institution in any category.
Neither count nor year affects the quantitative ranking.

## 7. Earlier discussion sentiment — agreed

Only group-discussion cards show **Earlier discussion sentiment**, summarizing the
post-presentation staff discussion. Show reception and enthusiasm compactly; expand
to the supporting quotes and any disagreement or uncertainty. This recalls the
same group's earlier reactions, not an independent scientific-merit assessment.

Only accepted, not withdrawn, current analyses may appear. Otherwise show
**Not available**. Do not expose a stale, unaccepted, or withdrawn analysis through
a frozen ranking snapshot. Do not generate sentiment in ranking, write rankings
from sentiment, weight it in averaging, or include it in individual preparation.
The workbook agreed below does not include sentiment or transcript quotations.

[VERIFIED via source] `getDeliberationSentiments` in
`lib/services/post-presentation-materials/discussion-sentiment-reader.js` provides
this accepted/current read contract, returns `current` / `out_of_date` / `none`,
and caps each call at 50 request IDs. It requires live Meeting Tracker access (or
superuser authority), not merely Proposal Ranking access, and runs under trusted
DAL context. Infrastructure failures throw; they are not empty-history results.

[VERIFIED via branch source] Ranking consumes this service through `workflow-service.js` in its authenticated server layer. The contract remains:
respect its additional authorization, and omit data from private-preparation
responses. Handle absent data, access denial, and dependency errors distinctly;
never copy previously seen sentiment into an unauthorized response. No new grant
or authorization bypass is approved. Define currentness rechecks and failure UI
before wiring the consumer; ranking preparation/calculation must not depend on an
optional sentiment result.

## 8. Workbook — agreed initial design, revisitable

One workbook, two sheets:

| Sheet | Contents |
|---|---|
| Collective recommendation | Unique final position, funding section, program, institution, proposal, requested amount, cumulative total, E/W, prior award count, most recent award year. |
| Individual assessments | Each PD's combined position, A/B/C grade, and confidence preserved at reveal, alongside external reviewer scores and enough proposal identity to match the collective sheet. |

Export saved, confirmed data; pending or uncertain edits must not masquerade as the
final recommendation. Preserve collective versus individual provenance. No additional
finalization lock, Board access route, or sentiment export is approved by this design.
The owner may revisit presentation and columns after seeing a sample.

## 9. Existing protections to retain, not new product choices

[VERIFIED via main source] Keep authenticated/session-derived actors, app grants,
roster/facilitator authorization, private/no-store responses, generic-reader privacy
exclusions, app-owned Dataverse writes under DAL context and the target interlock,
complete-source pagination, ETag conflict checks, operation receipts/readback,
and client save serialization and stale-response protection.

The existing eligibility contract (ordinary exact-cycle Phase II Pending SE/MR,
D26 trial cutoff), configured facilitator, and frozen source pool/roster are not
changed by this workflow agreement. Do not reinterpret existing rounds as revision 5
or relabel their per-program votes as combined votes. Existing trial cleanup,
facilitator restoration, grants, migrations, and production release need their own
verified execution plan and authorization. No deletion is authorized here.

## 10. Resets and rebuilds at every stage — agreed

Resets support a complete PD walkthrough, including ready, revealed, collective-editing,
and exported stages. Keep them available initially; restrictions may be considered
later. Do not silently restrict them to rounds carrying the old branch's dry-run flag.
Export does not lock the workflow. Every reset requires a clear scope/impact confirmation.

| Reset | Who and when | Result |
|---|---|---|
| Reset own program preparation | The PD, during private preparation (reopen own ready state first) | Restore the selected MR or SE reviewer-score seed and initial thirds; clear its confidence answers, readiness and combined confirmation. Other program work stays intact. |
| Rebuild own combined list | The PD, during private preparation | Replace combined work using current MR/SE grades, pairwise merge and confidence; require review and confirmation again. Do not silently regenerate on a program edit. |
| Reopen own ready preparation | The PD, before reveal | Clear own readiness; retain saved work for revision or reset. |
| Reopen individual preparation after reveal | Facilitator | Preserve the previous revealed inputs and group work as history; create a new private preparation version from the latest revealed individual assessments and their source program lists. Clear every PD's readiness; require everyone ready and a new reveal. |
| Reset collective recommendation | Facilitator, after reveal, including after export | Preserve the replaced group revision; restore that reveal's calculated order and unanimous-A/C initial bars. Keep its individual inputs unchanged. |
| Restart the complete walkthrough | Facilitator, at any stage | Preserve the previous run as history; start fresh score-seeded MR/SE lists with thirds, unanswered confidence, no combined confirmations and nobody ready. No active collective recommendation until a new reveal. |

Implementation uses versioned records and recorded reset outcomes, not deletion of
prior reveals. Shared resets are facilitator controls; being a facilitator does not
allow editing another PD's assessments. The old reveal cannot be made unseen, but
new private edits remain hidden from other PDs until the next reveal. Show historical
versions clearly as read-only; exclude them from the current ready count/calculation.
A previously downloaded workbook remains a dated artifact, not a live view.

Resets change ranking work only. They do not edit reviewer scores, source proposals,
awards/history, or sentiment analyses. The implementation plan specifies a repeatable
restart from the existing frozen source pool; refreshing source data is a separate
preview/open operation, not a silent reset side effect.

## 11. Implementation plan and engineering checks

The product decisions are settled. The implementation plan is
`docs/plans/PROPOSAL_RANKING_IMPLEMENTATION_PLAN_2026-10-13.md`; its storage/action
names are engineering proposals, not claims of provisioned schema or approved release.

Before enabling new rounds, implement versioned assessments and resets, atomic
all-PD reveal, consistent two-sheet export and old-round readers. Test deterministic
thirds for short lists, empty grade sections, program-to-combined invalidation,
reset/reveal/save races and immutable history. Preserve Research-history availability
qualifications and sentiment access/currentness. No additional product decision is
required to begin an authorized build; schema capacity and release readiness still
require implementation-time verification.

## 12. Verification and release boundary

[PLANNED] Before a later implementation is called ready, cover: initial thirds;
pair ordering with alternating winners/unequal program lengths/equal or missing
scores; every proposal exactly once; confidence completeness; strict unique ranks;
privacy before each reveal; ready/reopen/reveal/reset races; immutable revealed inputs;
every reset before/after ready, reveal, collective edits and export;
no overwrite by retry/late response; collective separator totals and E/W counts;
unknown/provisional history; accepted/current/withdrawn/access-denied sentiment;
and both workbook sheets from confirmed data. Exercise separate identities and
conflicting browser sessions. Run relevant gates with their self-tests sequentially.

Current source tests and old production receipts validate their dated implementations,
not this new workflow. The owner has authorized app implementation on the accepted
UX direction. Branch merge, deployment, source-data changes and legacy-round cleanup
remain separate release work. Current branch evidence and outstanding checks are in
the implementation plan.
