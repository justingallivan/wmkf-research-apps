# Fuzzy Matching — Owner Answers to the Six Consensus Questions

Date: 2026-08-06 (Session 405)
Answers: Justin (owner), in conversation with Claude (Fable).
Questions: `outputs/fuzzy-matching-consensus-recommendation-2026-08-06.md` §4.
Status: **all six answered.** Decision inputs only — nothing here authorizes
implementation beyond what it explicitly green-lights (the falsification
suite as upcoming session work).

Format note: each answer gives the owner's words **verbatim**, then the
agent's operationalization. The operationalizations were played back to the
owner in conversation and not disputed (the one correction the owner made —
Q2 — is recorded); treat them as agent framing the owner saw, not owner
mandate, and prefer the verbatim text when they diverge.

---

## Q1 — Precision floor for fully-automatic decisions

**Owner, verbatim:** "For 1 we need to think holistically. There are lots of
checkpoints before a payment could be recommended (and essentially zero risk
that someone would be paid). The odds of a wrong person accepting and
delivering an acceptable review are infinitessimal. With respect to
institutions, we strive not to get them wrong, but there are self-correcting
mechanisms. It's important to find the correct person -- they will fix their
institution."

On the agent's concern that suppression-type automation (auto-COI-drop,
dedup collapse) is the non-self-correcting direction: "Point three seems to
be self-limiting. Say we get down to 3 possible institutions, we could
consider all for potential COIs and ask a human to adjudicate that."

**Operationalization (agent):** No near-zero precision floor is required
anywhere. Downstream checkpoints make wrong payment effectively impossible;
wrong-person invites self-correct (the wrong person won't accept and deliver
an acceptable review); institution errors self-correct through the contacted
person. The structural rule replacing the floor: **ambiguity must widen, not
narrow, safety-relevant checks** — COI and similar suppression-type
decisions run against the full plausible institution set (union over the
ambiguity set) and route hits to human adjudication, never resolve to one
guess first. Dedup ambiguity likewise becomes "show both, ask" rather than
"hide one." The consensus doc's catastrophic-error gates (§1 step 6) soften
accordingly: union-and-adjudicate for COI; ordinary confidence thresholds
for the invite path. The binding objective throughout is **never lose the
correct person** (consistent with
`feedback-prioritize-contact-recall-over-identity-precision`).

## Q2 — Review capacity

**Owner, verbatim:** "At this point I have adjudicated about half of the
suggested reviewers, maybe more. And the people were correct. It required a
google search to get the websites and confirm the emails."

Correcting the agent's first read (that current volume is sustainable):
"I didn't say I was happy about it. One option would be to have a link to a
google search for the person and the notional institution."

**Operationalization (agent):** Current volume (~half or more of suggested
reviewers manually adjudicated) is **tolerated, not acceptable as a
target**. Both directions of improvement are wanted: fewer adjudications
(better resolution so more candidates arrive confirmed) AND cheaper ones
(the per-item cost today is an external Google search to find the person's
website and check the email). Identity precision of the suggestions has been
good — "the people were correct" — the labor is evidence-gathering, not
deciding.

- **Near-term affordance (owner's suggestion):** a one-click pre-built
  Google-search link for person + notional institution in the review UI.
  Small independent increment, S395-compatible. Candidate work item; not
  built as of this record.
- **Long-term:** the consensus §3 point 7 review contract — evidence,
  provenance, and dates surfaced inline so external search becomes
  unnecessary.

## Q3 — ROR as canonical institution namespace

**Owner, verbatim:** "It's probably the best option available (Though it did
confuse University of California with Touro University of California)"

**Operationalization (agent):** **YES.** Institution identity = ROR ID from
a pinned local dump; our scorer does all matching. The Touro/UC confusion
was ROR's **search-ranking API**, not its registry data (both records and
their hierarchies are correct) — which is exactly why the consensus makes
ROR the catalogue but never the decision authority ("never trust any
provider's rank 1"). Institutions missing from ROR stay representable as
unresolved strings; CRM/Dataverse Accounts remain a separate namespace,
untouched.

## Q4 — Benchmark investment

**Owner, verbatim:** "The smaller one is a good start. I assume this can be
handled by a less-sophisticated model."

("Fund" in the question meant work time — agent sessions plus small batches
of owner adjudication — not money.)

**Operationalization (agent):** **Falsification suite (150–300 cases)
approved as upcoming session work. Representative 1–2k benchmark parked**,
with the consensus consequence accepted: high-risk automatic actions
(clearing identity gates, suppressing candidates, enabling writes, affecting
payment) stay review-only until it exists — which the Q1/Q2 answers make
cheap to live with. Model routing per the owner's assumption: mechanical
curation (fixture writing, UC-matrix permutations from the ROR hierarchy,
harness wiring, recording incumbent behavior) goes to less-sophisticated
models/delegated agents; the agent proposed keeping the small front-loaded
judgment passes (adversarial case-taxonomy design, labeling genuinely
ambiguous historical cases) on a stronger model or routed to the owner —
proposal not explicitly confirmed, but consistent with "a good start" and
undisputed.

## Q5 — Affiliation representation policy

**Owner, verbatim:** "Show all concurrent affiliations and consider all for
COI. If possible, surface the most recent evidence as best."

**Operationalization (agent):** Candidate surfaces show **all concurrent
affiliations**; **COI screens against all of them**; ordering/emphasis by
**evidence recency** (most recently evidenced affiliation presented as
primary), with the consensus source-priority ladder (directory >
institution-asserted ORCID > verified lab page > self-asserted ORCID >
byline-historical > OpenAlex last-known) breaking recency ties. This makes
the no-end-date staleness question moot in the safe direction: a stale
affiliation stays listed (ranked lower as its evidence ages) and still
counts for COI — over-inclusion produces a human adjudication per Q1, never
a silent miss. Working-as-intended consequence: joint appointments will
occasionally raise COI flags from a secondary affiliation; those surface for
adjudication rather than auto-dropping the candidate.

## Q6 — Contact-attribution semantics

**Owner, verbatim:** "The google searches don't confirm anything. They
provide evidence at a point in time. I don't think there's any way to
confirm the validity of an email absent sending and not getting a bounce
(and that doesn't prove the person actually reads it)."

**Operationalization (agent):** **No binary "verified" flag in the data
contract.** Contact status is a dated evidence ledger, the same shape as
affiliations: a lab-page listing is ownership evidence as of its date; a
send-without-bounce is weak reachability evidence as of that send; a reply
is the strongest evidence of both, also dated. Ownership and reachability
remain distinguishable as evidence **types** (they fail independently), but
neither is ever a confirmed permanent state — the system claims "most recent
evidence, this strong, this old," never "confirmed." The S404 confirm-modal
attestations ("Right person?" / "Email address") are themselves evidence
records: human judgments with a date and source, high ledger priority,
still point-in-time.

---

## Now-live consequences (go/no-go state)

1. **The benchmark gate is open.** Consensus §1 step 0 — the 150–300-case
   falsification suite + UC adversarial matrix — is approved as next work on
   this track. Nothing else in the sequence is unblocked until it exists.
2. **Representative benchmark: parked indefinitely**; high-risk automation
   stays review-only as the accepted steady state.
3. **Candidate small increment (not started, not scheduled):** the
   Google-search link in the review UI (Q2). Fits the S395 small-ship
   discipline; needs owner scheduling like any other work item.
4. Q1/Q5/Q6 answers reshape the decision-model design inputs (union-over-
   ambiguity COI, all-affiliations representation, evidence-ledger contact
   contract) for consensus steps 2, 5, and 6 when those are reached.
