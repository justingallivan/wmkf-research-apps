# Reviewer Finding & Disambiguation — Holistic Review (Fable)

Date: 2026-07-08
Requested by: `docs/REVIEWER_HOLISTIC_REVIEW_FABLE_PROMPT.md`
Method: full reading map covered (six parallel readers over code, design docs,
memories, eval harnesses, git/session history, and system constraints), with the
frame-critical sources read directly by the synthesizing session:
`lib/services/reviewer-identity-resolver.js` (classifier),
`docs/REVIEWER_IDENTITY_STRATEGY_EVALUATION.md`,
`docs/REVIEWER_FINDER_RETRIEVAL_REDESIGN_PLAN.md` Part C,
`docs/REVIEWER_FINDER_ORIGINATION_EXPERIMENT_2026-06-12.md`,
`docs/audits/memory-triage-2026-07-08.md`, and the five core reviewer memories.
All opinions below are mine, held in one mind. No code was changed.

---

## 0. The one-paragraph verdict

You are solving two problems that are real, but you have framed them as one
problem ("build a search-and-verify engine per proposal") when the evidence you
yourselves collected says they are different problems: **finding is a
network-cultivation problem you keep treating as an information-retrieval
problem, and disambiguation is a provenance problem you keep treating as a
confidence problem.** The "surface and inform, human decides" frame is right and
you should keep it — but it has quietly become a license to never finish a
decision, and the failure-severity question you left open has an answer:
**confidently-wrong identity is the root failure**, because both of the other
failures (missed COI, degraded slates) flow downstream from it. Meanwhile, the
single strongest empirical result in the whole record — 78% of the applicants'
own recommended reviewers were surfaced by *neither* origination arm
(`REVIEWER_FINDER_ORIGINATION_EXPERIMENT_2026-06-12.md` §2) — is telling you
that the marginal unit of engineering in retrieval machinery is worth far less
than the same unit spent capturing what humans already know: referrals,
applicant suggestions, and your own reviewer history.

---

## 1. Reframe — are you solving the right problems?

### 1.1 The scale facts that should govern everything

- ~200 Phase-I proposals winnowed to **~28 that actually go to review** per
  cycle (`.claude-memory/project-reviewer-apps-redesign-direction.md:80-84`).
- **3 confirmed reviewers per proposal**, 5 invite slots as decline buffer
  (`.claude-memory/project-reviewer-count-invariant.md`).
- That is ≈ **85–150 reviewer engagements per year**, judged by a PD who — the
  experiment proved — can sniff-test a 20-candidate slate reliably (blind oracle
  calibration 4/5 = 80% agreement with applicant recommendations).
- Against this: **~6,500 LOC** in the core finding/disambiguation surface (plus
  ~80KB in `contact-enrichment/`), **~50 commits and ~40 sessions** of churn on
  these files (git log; `DEVELOPMENT_LOG.md`), and **1,400+ lines** of canonical
  design doc whose primary direction (retrieval-first inversion) is itself
  deferred.

At this scale the human is not a bottleneck to route around — the human is the
best component in the system, cheap, and already in the loop. Every design
decision should be scored by "does this reduce PD tedium or improve what the PD
sees?" — which is exactly what `docs/STRATEGY.md:86` already says ("Automate the
tedious parts, not the judgment… choosing reviewers — that's where staff bring
their expertise"). The reviewer subsystem repeatedly drifted away from its own
strategy sentence, toward machinery that tries to be *right* rather than
machinery that makes the human *fast*.

### 1.2 Finding is network cultivation, not retrieval

The system is architected as a per-proposal search engine: proposal → analyze →
originate → verify → rank → slate. But the durable asset at a foundation running
small-batch cycles for decades is **the reviewer network**: 4,393
`wmkf_potentialreviewer` rows, applicant-recommended names on every request
(`wmkf_potentialreviewer1..5`), accept/decline/quality history accumulating in
`wmkf_appreviewersuggestion` (621 rows), and — per your own reframe — a referral
snowball as "the real convergence engine" (`REVIEWER_FINDER_RETRIEVAL_REDESIGN_PLAN.md`
Part C §8a). `docs/STRATEGY.md` says it too: "good reviewers get called upon
repeatedly."

The evidence ranks your candidate sources unambiguously:

| Source | Quality signal |
|---|---|
| Applicant-recommended | 80% PD pick-rate, judged blind (experiment §2) |
| Claude-assisted (Track A) | 65% pick-rate |
| Bare grounded retrieval | 35% pick-rate, deceased/retired/trainee noise |
| Referral capture | called "the real convergence engine" — **unbuilt** |
| Reviewer history / pool reuse | STRATEGY principle — **no first-class support** |

The engineering investment ordering has been almost exactly inverted from this
table. The recall problem the experiment exposed (39/50 applicant picks missed
by both arms) cannot be closed by better retrieval — those names live in humans'
heads and in your own data. It closes by *capturing* them: referral flow at
decline time, applicant suggestions as a first-class arm, past-reviewer surfacing.

So the reframe for finding: **the per-proposal engine is the cold-start
fallback, not the product.** Its bar is "a decent, spread-out toe-hold slate for
fields where the network is thin" — a bar Track A already clears. The product is
the network and its flywheel.

### 1.3 Disambiguation: the lifecycle already contains a perfect disambiguator

Every reviewer who matters — i.e., everyone actually invited — authenticates a
magic link at their own email address and self-reports/corrects their ORCID
within days (PR4, `lib/services/capture-self-reported-orcid.js`). That is
ground truth, and it arrives *for free, for exactly the population that
matters*. Automated disambiguation therefore has a bounded job: **be right
enough, before the human answers, that (a) the outreach email reaches the
intended person, and (b) COI is computed against the right person.** It does not
need to certify anyone. It needs to *not freeze a guess* during the window
between save and accept — after which the human closes the loop.

Framed that way, the design question "should the spine's automated `confirmed`
be downgraded?" answers itself (see §4): an automated pipeline whose output is
constitutionally provisional has no business emitting a status whose semantics
are "a human attested this."

### 1.4 The frame itself: keep it, but stop hiding behind it

"Surface and inform, human decides" is correct at this scale, and the S238/S240
refinements (recall-over-precision; COI surface-not-gate; unverifiable flags are
net-negative) are among the best-reasoned decisions in the record. Two honest
criticisms:

1. **It has become a rationalization for indecision in places where the tool
   *can* decide.** Hard-key facts — a checksummed ORCID match, an exact email
   match, a reviewer's own attestation, ORCID-keyed within-pool dedup (24
   fragmented humans, 23/24 invisible to email matching,
   `.claude-memory/reviewer-identity-fragmentation.md`) — are decisions, not
   suggestions. The tool should commit to them silently, as it already does for
   policy COI hard-drops. "Never silently assert" should be scoped to *soft
   evidence*, not to identity per se.
2. **"Never silently filter" is drifting toward "surface everything," which has
   its own cost.** PD attention is the scarce resource. The under-bar
   candidates, `isRelevant: No` rows, and deferred `needs_identity_review` rows
   are all appended-not-dropped (`discovery-service.js:242-293`,
   `ranking.js:45-47`) — individually defensible, cumulatively a slate that
   grows noisier as each increment adds a new "surfaced, not dropped" category.
   A 20-item slate at 65% pick-rate is already good; recall-maximization inside
   the algorithmic channel has hit diminishing returns.

### 1.5 The severity ranking you asked for

1. **Confidently-wrong identity binding — worst.** It is upstream of everything:
   wrong person → wrong publications shown to the PD, wrong email sent
   externally (reputational), wrong COI computed (can *manufacture* a missed
   conflict or a false one). The S231 Laederach reproduction (fabricated
   forename verified at 100% confidence with the real person's papers attached,
   `.claude-memory/project-reviewer-verify-fail-dangerous.md`) is the archetype.
   This is also the only failure mode the human cannot easily catch, because the
   tool presents corroborating (wrong) evidence.
2. **Missed COI — institutionally worst per incident, but defended in depth.**
   Reviewer self-disclosure (empirically reliable, reviewers over-recuse —
   `.claude-memory/project-reviewer-coi-rely-on-self-disclosure.md`), staff
   dispositive review, and a small community where conflicts are visible. Do
   NOT re-gate COI: your detection precision for inferred conflicts is low, and
   at low precision a gate mostly deletes good reviewers. The current posture
   (hard-act on verifiable policy conflicts, surface factual co-authorship,
   rely on self-disclosure for relationships) is right. The one COI investment
   worth making is the identity-mediated one: COI computed against a *wrong*
   identity is invisible to every defense layer — which is ranking-item 1 again.
3. **Missed good reviewer — least severe per incident.** The 10-year
   retrospective (review is a floor/gate, not a ranker) means a decent slate is
   sufficient; a missed name rarely changes the outcome when 3 reviewers are a
   floor check. It *is* the silent failure, which is why it deserves the
   surface-don't-gate posture — but it does not deserve unbounded engineering.
   The cheap, high-yield recall channels are human ones (referral, applicant
   recs), not algorithmic breadth.

Ranking implication: the design center of gravity should sit on identity
integrity **as provenance discipline** (cheap, structural) — not on more
identity *inference* (expensive, where the reversals live).

---

## 2. Where you over- and under-invest

### Over-invested (effort that doesn't earn its keep)

- **Track B and its merge tail.** A four-source origination engine (~268 LOC
  `literature-search.js` + identity budget + deferred-stamping + shared-ORCID
  merge) archived OFF behind a hard-coded `TRACK_B_ENABLED=false`
  (`lib/services/discovery/constants.js:47`) after measuring **~0 contribution
  to saved panels**; the entire merge/defer/resolve tail of `discover()`
  (`discovery-service.js:249-300`) still executes against a permanently-empty
  list, and the route's second COI pass is correct "only because Track B is
  empty" (route comment). Dormant-but-wired code at this complexity is not an
  option kept open; it is a standing hazard and comprehension tax.
- **Ranking and scoring sophistication.** A points model
  (`lib/utils/relevance-score.js:26-89`), a separate expertise-match heuristic
  with a hand-maintained scientific synonym table biased to the foundation's
  historical biology portfolio (`match-signals.js:56-79`), a ~50-entry
  institution-alias table (`match-signals.js:140-189`) **duplicated** by a
  second independently-maintained list (`deduplication-service.js:422+`), and
  duplicated 5-year-recency implementations. Your own Part C reframe says fine
  ranking precision is relaxable; the PD re-ranks by eye anyway.
- **Provenance plumbing for lanes that don't exist.** Six `provenance.kind`
  values, five seedRoles, `groundingWorkIds`, and a fully-wired cited-reference
  DTO lane with **no producer** (`REVIEWER_FINDER_RETRIEVAL_REDESIGN_PLAN.md`
  §4.5) — shipped ahead of a feature that was then deferred.
- **Mechanisms sized for zero observed cases.** ORCID conflict-policy machinery
  shipped against 0 measured conflicts; a `status_null` category for exactly 1
  row; PR3 wiring designed for an intake form that does not exist and is now
  doubly parked (`REVIEWER_ORCID_BACKPROPAGATION_DESIGN.md` §12; intake PARKED
  S348).
- **Broad-web identity enrichment.** `serp-contact-service.js` (608 LOC) +
  `contact-enrichment/tiers.js` (23KB) doing first-hit extraction with fallback
  query ladders — which your own strategy eval names "the dead end"
  (`REVIEWER_IDENTITY_STRATEGY_EVALUATION.md` §5: "For unanchored names,
  improving query wording does not change the core risk").
- **Design-doc mass as a product.** The canonical mechanics doc still reads
  retrieval-first while the posture docs reverse it; the strategy eval had to
  correct `REVIEWER_TRACK_B_IDENTITY_SPEC.md` describing built work as unbuilt;
  the resolution plan needed a supersession banner. The docs now generate their
  own reconciliation workload (this very audit cycle is part of that cost).

### Under-invested (the neglected gaps)

- **Referral capture.** Named the real convergence engine in your own reframe;
  still pending. This is the single highest-leverage unbuilt feature in either
  half.
- **Applicant-recommended reviewers as a first-class citizen.** The best source
  you have (80% blind pick-rate, already in Dataverse) appears as experiment
  ground truth and an enrichment path — not as the celebrated top of the slate
  with one-click COI-checked invite. (The Part C "friends-of-PI exclusion"
  concern is real but is a *labeling* requirement — provenance-tagged and
  COI-checked like anything else — not a reason to bury the channel.)
- **Reviewer history / pool reuse.** No first-class "you used this person in
  D25, they delivered on time, rated useful" surface, even though the pool and
  suggestion ledger already hold the raw material and STRATEGY names repeat use
  as the norm. At ~85 engagements/year, five cycles of history is a better
  ranker than any bibliometric score.
- **Outcome capture.** The origination experiment had to substitute a sniff
  test because accept/decline/review-quality outcomes aren't systematically
  joined back to origination provenance. Every future direction decision will
  hit the same wall until the ~150 invitations/year write their outcomes back
  against `wmkf_sources`/provenance — trivial volume, high decision value.
- **The eval harnesses as a regression suite.** `eval-orcid-spine-sweep.mjs` and
  the constrained eval are the best engineering artifacts in this subsystem
  (they produced the only numbers that ever settled an argument: 29%
  cross-source conflict; 39→0 confidently-wrong at 33% abstain). They are
  run-once probes, not a harness the next promotion rule must pass. The S236
  forename-polarity regression (Keller/Sang demoted same-session) is exactly
  the class of error a frozen eval set catches before ship.
- **Stratum 3.** The spine's own cutover gate — early-career/no-ORCID names —
  is marked "TODO before cutover" while the slice is marked implemented
  (`REVIEWER_ORCID_SPINE_SPEC.md` §10). The 93% ORCID-coverage figure comes
  from a senior-skewed sample; the tail where ORCID-anchoring fails silently is
  precisely the population you haven't measured.

---

## 3. Recommended direction — finding

**Keep Claude-assisted origination as the spine.** The experiment settled this
for the operating regime you're actually in, and the edge-hardening that
survived (forename gate, recency ranking, provenance tags) is worth keeping.
Do not revive the retrieval-first inversion; formally retire it (see §5).

Then move the investment to the flywheel, in this order:

1. **Referral capture (build now).** Decline→suggest→iterate is where good
   slates actually converge per your own analysis, and every referred name
   arrives pre-disambiguated by the referrer ("my colleague X at Y") — it
   short-circuits both of your hard problems at once. This is the only item on
   any roadmap that improves finding *and* disambiguation *and* recall
   simultaneously.
2. **Elevate applicant-recommended + pool-history candidates to the top of the
   Find tab**, provenance-labeled, COI-checked, with prior-engagement history
   inline. The algorithmic slate renders below as the discovery layer.
3. **Write outcomes back.** Persist invited/accepted/declined/review-delivered
   (+ the existing PD selection signal) against candidate provenance. ~150
   rows/year. After one cycle you'll know each channel's real accept-yield —
   ending the era of deciding direction by sniff test.
4. **Recall sampling stays** (multiple analyze draws) — cheap, direction-
   independent breadth, already validated as the right lever for undersampling.
5. **Freeze ranking.** Grouping (grounded / applicant / past-reviewer /
   algorithmic) plus recency is enough; the PD does the rest. Delete the
   synonym/alias heuristics as they rot rather than maintaining them (the spine
   provides structured affiliation matching where it matters).

What the two-axis spread principle becomes: not machinery — a display-level
check ("this slate is all one community") if it becomes visible in practice,
per Part C §3's own "sanity check, not a gate" narrowing.

---

## 4. Recommended direction — disambiguation

### 4.1 The `confirmed` question, head-on

Current facts (all verified this session):

- `classifySpineEvidence` returns `confirmed` on two automated branches
  (`reviewer-identity-resolver.js:261,279`).
- `confirmed` was designed as a reserved *human-attestation* sentinel; the
  adapter guards make a stored `confirmed` immune to downgrade and to field
  clears (`researcher.js:240-250,280-283`), and
  `capture-self-reported-orcid.js:12-17` still asserts the now-false invariant.
- **Mitigating nuance the triage finding doesn't state:** today, every
  `writeIdentityDecision` caller gets its decision from the *enrichment-path*
  `resolveIdentity` (via `contact-enrichment/tiers.js:384`), which cannot emit
  `confirmed` — so the spine's automated `confirmed` currently lives at
  candidate/UI level (`track-b-identity.js:66-82` maps it to
  `verificationConfidence: 0.95`; `discovery/verification.js:91`), not in
  Dataverse. The un-correctable-automated-binding is a **landmine, not (yet) a
  live wound**.
- **The sharper latent bug:** `writeIdentityDecision` lets any *incoming*
  `confirmed` overwrite a stored `confirmed` unconditionally
  (`researcher.js:238-239`). The day an automated `confirmed` reaches the
  adapter — one refactor away, since the resolver already emits it — it will
  silently **clobber reviewer self-attestations**, the highest-trust data you
  have. That is the failure mode PR4's Codex hardening was built to prevent,
  reintroduced from the other direction.

**Is the confidence-status model right? No — and downgrading the spine's
`confirmed` to `probable` is a patch, not the fix.** The root defect is a type
error: one enum is carrying two orthogonal axes —

- **Evidence strength** (how sure is the automation): unresolved / ambiguous /
  probable / high.
- **Binding provenance** (who asserted it): automated / staff-confirmed /
  reviewer-self-attested.

Every symptom in the record is this conflation surfacing: the spine reasonably
wants to say "high confidence" and the only word available means "a human said
so"; the sticky guard wants to protect *attestations* and can only key on a
*status*; the S285 PD override had to route around the enum entirely
(`pdIdentityConfirmed` skipping the resolver rather than writing a status).

**Recommendation:**

- *Immediately (one-line-scale, before any refactor):* change resolver `:261`
  and `:279` to emit `probable`. The spine's own eval showed `probable` +
  constrained-select-or-abstain already achieves the operational goal (0
  confidently-wrong); `mayPersistIdentity` treats confirmed and probable
  identically (`resolver:390`), so nothing downstream loses capability — only
  the UI's 0.95 badge inflation and the sentinel collision go away. Add the
  missing guard in `writeIdentityDecision` so `confirmed` writes are accepted
  only from the attestation paths (or verify provenance server-side), closing
  the `researcher.js:238-239` hole.
- *Structurally (the real fix, small):* add a **binding-source field**
  (`self_reported | staff_confirmed | automated`) next to `wmkf_identitystatus`,
  key the sticky/clear guards on *source*, and let status mean confidence only.
  This dissolves the sentinel model instead of re-patching it, gives the PD
  override a legitimate home, and makes "self-report beats resolver guess" a
  rule about sources rather than an emergent property of enum collisions.

### 4.2 The rest of disambiguation

- **Keep the spine's core discipline — constrained-select-or-abstain.** It is
  the one identity mechanism with clean empirical wins (39 confidently-wrong →
  0, at 33% abstain, `REVIEWER_ORCID_SPINE_SPEC.md` §2). A 33% abstain rate at
  your scale is ~7 names per proposal for a human to eyeball — cheap. Abstention
  is a feature; resist every future pressure to "resolve more."
- **Design the pipeline as provisional-until-attested.** The magic-link
  self-report is the identity checkpoint the lifecycle gives you for free
  (§1.3). Automated resolution's contract: pick the right email, compute COI
  against the best-evidence identity, badge honestly, and *hold everything
  loosely* until accept/decline. After attestation, the binding is the
  reviewer's own — which the sticky guards already implement, once they key on
  provenance.
- **Freeze the promotion grammar.** `classifySpineEvidence` has 8 branches with
  per-branch forename-gate polarity (`!== true` vs `=== true`) that took a
  same-session regression to tune, and the S235/S236 docs spend pages
  reconstructing which branches are live for which caller. Adopt a hard rule:
  **no new anchor type or promotion branch without a failing case in a frozen
  eval set first** (extend `eval-orcid-spine-sweep.mjs` into a fixture-based
  regression run). The grammar is at the complexity ceiling where each new rule
  costs more correctness than it buys.
- **Consolidate the three name-comparison implementations**
  (`discovery/name-matching.js`, `reviewer-identity-evidence.js:288-330`, the
  work-author-resolver's parser path) into one module with the eval set as its
  spec. Three parallel forename semantics is how the next Keller/Sang regression
  happens.
- **Run the stratum-3 eval before trusting the spine any further** — or accept
  and document that early-career/no-ORCID names always abstain to the human.
  Either is fine; the current state (gate marked TODO, slice marked
  implemented) is neither.
- **Buy-vs-build check you asked for:** there is nothing to buy here. Commercial
  reviewer-finding tools (Prophy, Global Campus, publisher stacks) optimize
  journal-scale throughput, not conflict-aware small-batch curation against a
  private CRM, and author-disambiguation-as-a-service would still leave the
  binding-to-Dataverse problem — which is the actual hard part — untouched.
  OpenAlex/ORCID/PubMed as free substrates remain correct. The right "buy" is
  what you already did: lean on ORCID's registry and the reviewers' own
  attestations instead of inference.

---

## 5. Stop doing

1. **Delete Track B** — `literature-search.js`, the `discover()` merge/defer
   tail (`discovery-service.js:249-300`), `TRACK_B_ENABLED` and its four dead
   branches. Its query generation was already removed (S253); the "dormant"
   framing is fiction. Git preserves it if the multilane future ever arrives.
2. **Formally retire the retrieval-first inversion.** Mark
   `REVIEWER_FINDER_RETRIEVAL_REDESIGN_PLAN.md` Part A §4/§7 superseded-by-
   experiment, pointing at the S246 result and the wiki posture. Stop paying
   the drift tax of a canonical doc that contradicts the operating direction.
3. **Stop broad-web identity inference.** Cut the SerpAPI/Scholar fallback
   ladders in contact enrichment to the minimum that finds a *contact point*
   for an already-anchored identity; never let web search create or upgrade an
   identity (your own eval's verdict, `REVIEWER_IDENTITY_STRATEGY_EVALUATION.md`
   §5, Final).
4. **Stop adding promotion rules and heuristic gates one namesake at a time**
   without a prior failing eval-set case (§4.2). This converts the recurring
   patch→regression→re-patch loop into a test-first loop.
5. **Stop building for unobserved cases.** No more conflict machinery for 0
   conflicts, categories for 1 row, or wiring for unbuilt forms. The probe-first
   habit exists and works (S216, S239) — make it mandatory for *mechanisms*,
   not just claims.
6. **Retire the duplicated heuristics**: one institution-alias source (or none —
   prefer the spine's structured matching), one recency implementation, one
   name-comparison module. Delete the hand-tuned synonym table rather than
   maintaining a biology-biased list into physics cycles.
7. **Stop writing thousand-line design docs per increment.** The reviewer
   domain's doc corpus now needs supersession banners, reconciliation sessions,
   and audits of its own memories. For a two-person decision loop at this
   scale, a decision record (what changed, why, what evidence) beats a
   canonical architecture per feature — the eval scripts and their numbers were
   worth more than any of the plans.

---

## 6. The pattern — the recurring mistake in how you reason

Across the eight documented reversals (Perplexity ship→abandon;
institution-match design→reverse ×2; identity-gate ship→remove same day; COI
surface-everything→retire; forename gate overcorrect→re-fix same session;
OpenAlex "disqualified"→corrected probe; sticky-`confirmed` invariant silently
broken), the same failure shape recurs:

**You adopt a maximal principle from a vivid single case, encode it fully in
code and prose, and only then let reality vote.** "Never hide a concern" (S229)
came from one COI scare and was reversed by the PD's actual behavior.
"Anchor-or-abstain" hardened into `forenameAgrees !== false` off one fabricated
name and demoted real reviewers the same session. The institution-match plan was
written twice before anyone checked whether account-search-by-name had any
precedent. Notably, **the eval harness was the fix every single time it was
used** — the sniff test settled origination in a day, the spine sweep turned a
39-case failure mode into 0, the corrected probe un-disqualified OpenAlex — and
it was *never the default first step*.

Three specific disciplines follow:

1. **Evidence before mechanism, always.** The 10-case sniff test cost an
   afternoon and settled what 1,400 lines of plan could not. Invert the current
   ratio: probe/eval first, then the smallest mechanism the numbers justify.
   (This is `docs/CLAUDE_REMEDIATION_PLAN.md`'s probe-before-planning rule —
   applied to *design*, not just state claims.)
2. **Invariants live in code or they don't live.** "The resolver never emits
   `confirmed`" was prose in comments and memory; the S232 spine broke it
   without anyone noticing for three sessions, and a stale copy still sits in
   `capture-self-reported-orcid.js:14`. At this repo's velocity — many agents,
   many sessions — any invariant worth having must be an assertion, a test, or
   a type, never a sentence.
3. **Watch for principle-oscillation.** The record swings between
   over-trust-the-machine (verify on ≥3 papers, no forename check) and
   over-distrust (hard-fail initial-only records), between surface-everything
   and flag-nothing-unverifiable. The stable point each time turned out to be
   the same shape: *commit on hard keys, abstain on soft evidence, let the
   human close the loop*. That is your actual, empirically-earned design
   principle. Write it down once, and measure every future proposal against it
   instead of re-deriving it through another reversal.

---

## Appendix — primary evidence index

- Scale: `.claude-memory/project-reviewer-apps-redesign-direction.md:80-84`;
  `.claude-memory/project-reviewer-count-invariant.md`
- Experiment: `docs/REVIEWER_FINDER_ORIGINATION_EXPERIMENT_2026-06-12.md` §2–§4
- Spine evals: `docs/REVIEWER_ORCID_SPINE_SPEC.md` §2, §10;
  `scripts/eval-orcid-spine-sweep.mjs` (proxy ground truth, self-declared)
- Classifier: `lib/services/reviewer-identity-resolver.js:231-304` (8 branches;
  `confirmed` at :261, :279; `mayPersistIdentity` :390)
- Sticky guards + overwrite hole: `lib/dataverse/adapters/researcher.js:224-287`
  (:238-239 incoming-confirmed unconditional overwrite)
- Persistence reachability: all `writeIdentityDecision` callers route through
  enrichment-path `resolveIdentity` (`lib/services/contact-enrichment/tiers.js:384`),
  capped at `probable`; spine `confirmed` surfaces via
  `lib/services/discovery/track-b-identity.js:66-82` (0.95) and
  `lib/services/discovery/verification.js:91`
- Dead Track B: `lib/services/discovery/constants.js:47`;
  `lib/services/discovery-service.js:249-300`
- Frame docs: `docs/REVIEWER_FINDER_RETRIEVAL_REDESIGN_PLAN.md` Part C §0–§8;
  `.claude-memory/project-reviewer-recall-over-precision.md`;
  `.claude-memory/project-reviewer-coi-rely-on-self-disclosure.md`;
  `docs/STRATEGY.md:86`
- Reversal record: `docs/REVIEWER_CONTACT_BOUNDARY_GAP_FINDINGS.md` §Increment 2a;
  `docs/audits/memory-triage-2026-07-08.md` finding #1; git log (~50 commits);
  `DEVELOPMENT_LOG.md` (~40 sessions)
