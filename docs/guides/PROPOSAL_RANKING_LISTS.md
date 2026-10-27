# How Proposal Ranking combines lists and places the bars

This describes the ranking workflow released for D26. There are two steps: each PD combines their Medical Research (MR) and Science and Engineering (SE) assessments, then the app combines all PDs’ completed rankings when the facilitator reveals them.

## Starting MR and SE lists

Each program initially appears in descending order of its average peer-review rating: Excellent = 5, Very Good = 4, Good = 3, Fair = 2, Poor = 1. Proposals without a usable rating appear last. Equal averages are ordered by request number; the app uses the full average, not its rounded display value.

The two bars initially divide each program into roughly equal A, B and C sections. Extra proposals go into A first, then B: eight proposals start as **3 A / 3 B / 2 C**. These are starting positions for the PD to adjust, not grades assigned by the reviewers.

## Each PD’s combined list

The app combines **A with A, then B with B, then C with C** using that PD’s current program lists.

Within each grade:

1. Pair the first MR proposal with the first SE proposal. Put the one with the higher average peer-review rating first.
2. Do the same for the second MR/SE pair, then the third, and so on. A later pair never jumps ahead of an earlier pair.
3. If one program has more proposals in that grade, append its remaining proposals in their existing order.

For example, if the A lists are **MR1, MR2** and **SE1, SE2, SE3**, the merge orders the MR1/SE1 pair, then the MR2/SE2 pair, then SE3. It does not re-sort all five by reviewer score. Equal scores use request number; an unrated proposal follows a rated one within its pair.

The first bar goes after all the A proposals; the second goes after all the B proposals. **The merged list is not divided into thirds again.** Confidence answers carry over. The PD can then adjust the combined order and bars before selecting **Ready for group discussion**, which confirms that order and marks the PD ready together. Rebuilding the combined list repeats these rules and replaces edits made directly in that list.

## The group list at reveal

Once every PD is ready, the app averages each proposal’s position across the PDs’ final combined lists. **Lower average rank comes first; every PD counts equally.** Equal averages are resolved by the original peer-review ordering, then request number, giving a single ordered list.

The group’s initial bars use the PDs’ grades:

- **Recommended:** starting at the top, include consecutive proposals that every PD graded A. Stop at the first proposal without unanimous A grades.
- **Not recommended:** starting at the bottom, include consecutive proposals that every PD graded C. Stop at the first proposal without unanimous C grades.
- **Alternates:** everything between those two bars.

A unanimous-A proposal farther down the list stays among the Alternates if a non-unanimous proposal is above it. The equivalent applies to a unanimous-C proposal above the bottom block. Either outer section can initially be empty.

These bars are discussion starting points, not budget cutoffs. Confidence, funding history, sentiment and requested dollars do not weight the group ranking or determine its initial bars. The group can adjust the collective order and bars during discussion; the revealed individual inputs remain preserved.

*Source checked October 14, 2026: `lib/services/proposal-ranking/assessments.js` (`defaultBoundaries`, `mergeProgramAssessments`, `calculateRevealedAssessment`) and `calculations.js` (`buildSeedOrder`, `calculateComposite`). Exact request-number ties fall back to the stable request ID.*


## Locking a finished meeting and reopening a past cycle

[VERIFIED via branch source and focused tests, 2026-10-27; not yet deployed.]
After the group reveal, either captured facilitator or a superuser with Proposal
Ranking access can select **Lock meeting** and confirm. The saved group order and
section dividers become read-only for everyone. Resets, reopening preparation and
restarting the walkthrough are blocked by the server as well as the interface.
**Unlock meeting** is available to the same roles and requires confirmation.
Locking does not change proposal statuses in AkoyaGO.

The status identifies the staff actor and time of the latest lock/unlock. The
server retains both actions in the round administration log and keeps an
immutable operation receipt; locking also preserves the final collective revision
in History. Viewing, History and **Export workbook** remain available while locked.
A nonparticipant superuser gains only these lock/unlock actions, not permission to
edit rankings or inspect unrevealed private assessments.

The **Funding cycle** selector includes saved cycles as well as the usual nearby
calendar cycles, so older saved cycles do not disappear as the years advance.
Select the earlier cycle to reopen its saved round; History also links retained
previous runs after a restart. If past-cycle discovery fails, the page reports it
and nearby cycles remain usable; reload to retry discovery.

Ranking records live in Dataverse: `wmkf_proposalrankingcycle` locates the saved
round; `wmkf_proposalrankinground` holds the frozen source snapshot and workflow;
`wmkf_proposalrankinglist` holds assessments, collective work, history and receipts.
Moving to another cycle does not erase them. There is no ranking-specific
Postgres or Blob store. Workbook export produces a portable two-sheet copy of the
saved group recommendation and the revealed individual assessments. Export from
the selected cycle's active revealed round; a superseded run remains viewable in
History but does not gain workbook export through this change.

This describes application retention and retrieval, not a verified Dataverse
backup policy or immutable legal archive. No live records, locks or retention
settings were changed by implementing this feature.
