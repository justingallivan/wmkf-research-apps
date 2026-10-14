# How Proposal Ranking combines lists and places the bars

This describes the revised ranker being tested for D26. There are two steps: each PD combines their Medical Research (MR) and Science and Engineering (SE) assessments, then the app combines all PDs’ completed rankings when the facilitator reveals them.

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

The first bar goes after all the A proposals; the second goes after all the B proposals. **The merged list is not divided into thirds again.** Confidence answers carry over. The PD can then adjust the combined order and bars before confirming readiness. Rebuilding the combined list repeats these rules and replaces edits made directly in that list.

## The group list at reveal

Once every PD is ready, the app averages each proposal’s position across the PDs’ final combined lists. **Lower average rank comes first; every PD counts equally.** Equal averages are resolved by the original peer-review ordering, then request number, giving a single ordered list.

The group’s initial bars use the PDs’ grades:

- **Recommended:** starting at the top, include consecutive proposals that every PD graded A. Stop at the first proposal without unanimous A grades.
- **Not recommended:** starting at the bottom, include consecutive proposals that every PD graded C. Stop at the first proposal without unanimous C grades.
- **Alternates:** everything between those two bars.

A unanimous-A proposal farther down the list stays among the Alternates if a non-unanimous proposal is above it. The equivalent applies to a unanimous-C proposal above the bottom block. Either outer section can initially be empty.

These bars are discussion starting points, not budget cutoffs. Confidence, funding history, sentiment and requested dollars do not weight the group ranking or determine its initial bars. The group can adjust the collective order and bars during discussion; the revealed individual inputs remain preserved.

*Source checked October 14, 2026: `lib/services/proposal-ranking/assessments.js` (`defaultBoundaries`, `mergeProgramAssessments`, `calculateRevealedAssessment`) and `calculations.js` (`buildSeedOrder`, `calculateComposite`). Exact request-number ties fall back to the stable request ID.*
