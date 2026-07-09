# Whack-a-Mole Meta-Review (Fable) — preventing the class, not the instances

Date: 2026-07-08
Requested by: `docs/WHACK_A_MOLE_META_REVIEW_FABLE_PROMPT.md`
Inputs read directly this session: `docs/audits/whack-a-mole-audit-2026-07-08.md`;
`docs/audits/reviewer-holistic-review-fable-2026-07-08.md` (full, esp. §5–§6);
`docs/CLAUDE_COVERAGE_LESSONS.md`; `docs/TYPESCRIPT_OPTION_ASSESSMENT.md`;
`docs/CLOSEABLE_CLASS_INVARIANT_MAP.md` + its orchestration brief;
`docs/agent-wiki/topics/reviewer-workbench-lifecycle.md`;
`lib/dataverse/adapters/reviewer-suggestion.js` (the stamp-reset machinery,
lifecycle writers, softDelete/restore — read at lines ~560–1445 this session);
the `check:*` gate census (31 gates in `package.json`); `.claude/rules/`;
`.claude-memory/MEMORY.md`. The reviewer finding/identity engine is treated as
one data point per the prompt, not re-reviewed. No code changed.

---

## 1. Verdict on the framing

**The audit's meta-pattern is right, but it names three things where there is
one.** The behavioral cause ("adopt a maximal principle from a vivid single
case, encode it fully in code and prose, then let reality vote") and the two
amplifiers (two-axis enum; prose invariants) are real. But put them next to the
invariant map's headline ("a locally-correct chokepoint that misses a sibling
sink reads as closed while the class stays open" — subset-of-sinks, the COI
trap) and next to `CLAUDE_COVERAGE_LESSONS.md`'s whole reason for existing
("each round is a one-line miss, but they aggregate"), and they collapse into
a single structural class:

> **A hand-maintained enumeration standing in for a set that is actually
> defined somewhere else, with nothing checking totality.**

Every recurring instance fits:

- `ENGAGEMENT_STAMP_RESET` hand-lists the stamp columns that exist on the
  entity (audit #8) — grew S343, S347, will grow again.
- Coverage-tool pattern lists hand-enumerate the call shapes that exist in the
  code (audit #7 — every lesson A–F in COVERAGE_LESSONS is this).
- Chokepoint sink sets hand-enumerate the writes that exist (map §2 lesson 1 —
  3 of 7 COI writes, DynamicsService but not `client.js`).
- The `confirmed` sentinel (amplifier A) is the *axis* version: one enum
  hand-carries two meanings, so guards key on the wrong one — the field's
  semantics are enumerated in prose instead of carried as data.
- Prose invariants (amplifier B) are the degenerate case: an enumeration of
  obligations whose checking mechanism is "someone remembers."
- Doc restatements (holistic §5.7's supersession-banner churn) are prose
  copies of one fact — hand-enumerated restatements needing reconciliation.
- Stale carryover items (audit #9) are enumerated claims about live state with
  no re-verification mechanism attached.

The behavioral cause is the **generator** — it mints new mechanism faster than
evidence justifies. The unchecked enumerations are the **decay mode** — why
each mechanism then costs a patch per session. Two levers address the two
halves, and almost everything else in the remediation backlog is an instance:

1. **Enumerations become derived, or totality-checked.** Where a list must
   mirror a set defined elsewhere, either derive it (best) or gate parity
   (`check:status-enum-parity` already does exactly this for label maps — the
   pattern exists in-repo and works; generalize it). §4's worked example shows
   the derived form.
2. **Judgment surfaces get frozen fixture evals in CI, and no new branch
   without a failing fixture first.** The holistic review's most striking
   empirical observation: *the eval harness was the fix every single time it
   was used, and it was never the default first step* (§6). This converts
   patch→regression→re-patch into test-first by process, and it fires itself
   because CI runs it.

**One correction to the audit's emphasis.** The team is not over-indexed on
gates; the gates that exist fire and earn their keep (the coverage self-test
discipline, the LAW-mode boundary gates). The gap the invariant map's
completeness critic exposed is at invariant *birth*: three real classes had no
gate at all because nobody ever named them as code — "is there a gate?" is a
census of what was already decided to defend, not of what needs defending. So
the cheap systemic move is not "more gates," it is a birth rule: **a
load-bearing "never / always / only" sentence must be born with its assert,
test, or gate — or it does not exist** (holistic §6.2 says this; make it
operational, §3 item 3).

**Pressure-test of the audit's "healthy debt" judgments — confirmed, with one
sharpening.** DAL staged paydown and the god-object decompositions are genuine
staged work, not thrash; do not redesign. But note *why* enforcement flips
keep uncovering latent defects (S331, S341): each flip is a totality probe
over a sink set that was hand-enumerated — the same class again. The fix is
already written (map Tier-A #1, the `client.js` tail); finishing it is how
that tail stops surprising you. And the "why do services reach 1,700–2,300
lines" lessons-note the audit wants has a one-line answer: increments never
pay extraction cost and nothing trips a wire; if a wire is wanted, a warn-only
line-count check on `lib/services/` is the entire build — but this is
optional, the decomposition queue is working without it.

---

## 2. The prioritized list

| # | Change | Class it closes | Cost | Closes by construction? |
|---|---|---|---|---|
| 1 | Engagement-lifecycle field registry + transition-derived payloads + totality gate | Hand-listed stamp resets (#8) and the registry pattern for every future field family | M | Yes |
| 2 | Frozen fixture evals in CI for judgment surfaces; no new branch without a failing fixture | Heuristic patch→regression→re-patch (the generator) | S–M | Yes (CI-enforced process) |
| 3 | Invariant-birth rule + one bounded prose-invariant triage sweep | Amplifier B — prose invariants that break unnoticed | S–M (timeboxed) | Partially (sweep is one-time; birth rule is discipline + review) |
| 4 | Carryover items carry their own probe | Stale carryover (#9) | S | Yes |
| 5 | Two-axis field check added to `/contract-reconcile` + one line in the Dataverse rule | Amplifier A — the next `confirmed`-style sentinel | S | No — design-time heuristic; accepted ceremony, piggybacks an auto-firing skill |
| 6 | Nomenclature rename finished with a grep-zero done criterion | Recurring stale-fact re-derivation (#6) | S–M | Yes (the probe is the criterion) |
| 7 | Extend the `check:types` branded/exhaustive core opportunistically; reaffirm no `.ts` renames | Enum non-exhaustiveness where registries land | S per instance | Yes where applied |

### 2.1 The engagement-stamp registry (do this first — it is also the template)

Full design in §4. It is ranked first not because #8 is the worst area but
because it is the **cheapest complete demonstration of the pattern** the rest
of the codebase should copy, on a surface with real recurrence (S275, S277,
S285, S343, S347) and bounded blast radius.

### 2.2 Frozen fixture evals for judgment surfaces

**The class:** heuristic/judgment logic (identity promotion grammar, name
matching, gating thresholds, Akoya cycle cohorting) tuned one vivid case at a
time, regressing a neighbor each tune (Keller/Sang demoted the same session
the forename gate hardened — holistic §6).

**The change:** (a) convert `eval-orcid-spine-sweep.mjs` and the constrained
eval from run-once probes into fixture-based regression suites wired into CI
(they already exist; the work is freezing fixtures + a `check:` entry).
(b) Adopt the rule from holistic §4.2 repo-wide for judgment surfaces: **no
new promotion rule, heuristic branch, or threshold change without a failing
fixture in the frozen set first.** (c) When the parked reviewer redesign
branch builds, its head-to-head-vs-main comparison should run on these same
fixtures — the harness pays twice.

**Scope honestly:** this is TDD, scoped to the surfaces where the record
proves tuning-by-anecdote fails. Do not blanket-mandate it for CRUD plumbing;
that would be ceremony.

**Verified-by:** the suite is in CI and red-gates; the next namesake incident
produces a fixture-first commit (observable in git history); no
same-session heuristic reversal recurs.

### 2.3 Invariant-birth rule + one triage sweep

**The class:** "the resolver never emits `confirmed`" lived in comments and
memory, broke for three sessions, and a stale copy still sits in
`capture-self-reported-orcid.js` (holistic §4.1). The wiki's "Operating Notes"
sections and the `feedback-*` memory corpus hold more of these.

**The change, two parts:**

- **Birth rule (go-forward):** when a session writes a load-bearing
  never/always/only sentence into a comment, wiki hazard note, or memory, the
  same commit must carry its enforcement — a runtime assert at the chokepoint,
  a test, or a gate — or explicitly label the sentence *advisory*. This
  belongs in the review posture (`/contract-reconcile` audit list and the
  existing `feedback-enforcement-hierarchy` lesson), not as a new grep gate:
  a gate that pattern-matches the word "invariant" in prose would be exactly
  the won't-fire-itself ceremony the prompt warns about.
- **One bounded sweep (backlog, timeboxed to a session):** triage the existing
  corpus — the wiki topics' Operating Notes/hazard bullets and the
  Always-Read-Guardrails memory files — into: (a) already enforced (cite the
  enforcing code), (b) worth an assert/test now (write it), (c) explicitly
  advisory (mark it). The Akoya cycle-code fail-loud item (audit next-up #3)
  is simply the first (b) of this sweep — do it there, not as a standalone.

**Verified-by:** each load-bearing prose invariant carries an `enforced-by:`
pointer or an `advisory` label; the next silently-broken-invariant incident
count is zero over ~10 sessions.

### 2.4 Carryover items carry their own probe

**The class:** stale SESSION_PROMPT next-steps propagate and nearly get acted
on (audit next-up #1). The audit proposes "a check that flags carryover items
whose cited evidence no longer matches live state" — as stated, that is a
prose-understanding problem and the gate would not reliably fire.

**The reshape (closes by construction instead):** change the *convention*, not
build a parser. Each carryover item in SESSION_PROMPT gets a machine-runnable
evidence line — a one-line probe command (grep/test/path-exists) plus expected
result — and the freshness check simply re-runs the probes. An item without a
probe line is flagged at write time by the check; a failing probe marks the
item stale. `/stop` (which writes the handoff) enforces the convention at the
source. This converts "verify the carryover" from judgment into execution.

**Verified-by:** the check's self-test includes a deliberately-stale fixture;
the next destructive-carryover near-miss (the class behind two feedback
memories) does not recur.

### 2.5 Two-axis field check

**The class:** one field carrying confidence AND attestation-source made a
fallible automated path inherit un-downgradeable human stickiness (amplifier
A). The next instance will look different (a status that also encodes *who*,
a timestamp that also encodes *why*).

**The change:** add one audit question to `/contract-reconcile`'s list (it
already auto-fires on new tables/migrations/durable state): *"Does any guard,
reset, or stickiness rule on this field need to know who/why/how the value was
set? If yes, that is a second axis — add the column, don't overload the
enum."* Mirror the sentence in `.claude/rules/dataverse-dynamics.md` (loaded
exactly when adapter files are read). Honest label: this is a remembered
heuristic, not construction — but it rides mechanisms that already fire
automatically, so the marginal ceremony is one sentence read in context. The
actual `binding-source` split for identity stays where the audit put it: P0/P1
of the parked holistic plan, not a standalone.

### 2.6 Nomenclature rename, finished

Endorse audit next-up #2 unchanged, with one addition that makes it stick: the
done criterion is a **probe, committed as the guard** — the sweep's own grep
(`reviewer-finder|review-manager|candidate` in the agreed live-code scopes)
returns zero, and that grep joins the drift-gate family so regression is
caught, not re-swept. Rename work without the probe-as-criterion is how the
same stale claims got re-derived session after session.

### 2.7 TypeScript posture

Nothing to relitigate: the S342 `check:types` outcome (scoped `checkJs`,
branded `Guid`/`ActorRef`, facade-covered, no renames) is the right call and
already shipped. The meta-review adds one connection: **when a registry lands
(§4), give it the `@ts-check` treatment** — a `@typedef` union over the
transition names and `Record<Field, Classification>` typing makes the
compiler enforce registry exhaustiveness the same way `reviewer-rollup.js`
got enum exhaustiveness. Reaffirm: no `.ts` file renames until the five
fail-open gates are AST-hardened (TS assessment §3b) — that constraint is
still live.

---

## 3. What this reprioritizes in the audit's to-do

- **Next-up #1 (carryover gate):** keep, but build the §2.4 probe-convention
  version, not a prose validator.
- **Next-up #2 (nomenclature):** keep, add the grep-zero-as-committed-gate
  criterion (§2.6).
- **Next-up #3 (Akoya fail-loud):** keep, but execute as the first item of the
  §2.3 invariant sweep rather than a standalone — same session, same pattern.
- **Backlog #6 (stamp state machine):** promote to first structural build —
  §4 is the design. It was ranked "design first"; the design is now done
  enough to estimate honestly (M, no schema change).
- **Backlog #8 (coverage/TS decision):** resolved — the decision was already
  made and shipped (S342); what remains is the §2.7 opportunistic-extension
  posture, not a decision.
- **Backlog #4/#5 (Dynamics schema auto-derive; idempotent deploy):** keep as
  ranked. Both are instances of lever 1 (hand-transcription → derivation) and
  genuinely real builds; nothing here changes their order.
- **Backlog #7 (dual count model):** keep; note it is the "one source of
  truth means zero other restatements" lesson (map §2.4) applied to a number.
- **Backlog #10 (lessons note on service size):** write the one-liner from §1
  and close it.

---

## 4. Worked example — engagement-lifecycle stamps

### 4.1 What is actually there (read this session)

`lib/dataverse/adapters/reviewer-suggestion.js` holds, today:

- `ENGAGEMENT_STAMP_RESET_ENTRIES` (line ~600): a frozen hand-list of 12
  `[column, lifecycleKey, resetValue]` triples, applied on restore and on
  staff-manual re-add of a removed row.
- `softDelete` (~1380): its **own** hand-list (`selected/accepted/declined/
  responsetype/reviewstatus/heldat` + optional token revoke) — deliberately
  different semantics ("withdrawal, not reset-to-never-contacted") expressed
  as a second literal payload.
- `applyStage2aResponse` (~1284): accept and decline each hand-assemble their
  payloads, including cross-clearing the other outcome's fields.
- `updateLifecycle` (~1183): a generic 22-key field map [VERIFIED via
  `reviewer-suggestion.js:1185-1208`] any caller can write any subset through,
  with two special-cased side effects buried inside (excluded-row refusal;
  complete-transition close-out stamping).
- Outside the adapter [per `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md`,
  read this session]: the send-emails service
  (`lib/services/review-manager/send-emails-service.js` [VERIFIED present via
  grep this session]) stamps invite fields inline per-recipient (S340); the
  reminder/thank-you sweeps claim their fire-once markers;
  `withdraw-sufficient` writes its stamp + clears one marker. A stamp-field
  grep across `lib/services` + `pages/api` + `shared/components` returns 16
  touching files [VERIFIED via grep this session] — the field family's
  consumer surface, which is why per-transition semantics must live in one
  place.

The recurrence mechanism is now visible: **the stamp field set is defined by
the entity schema, but its reset/transition semantics are re-enumerated in at
least four hand-lists inside the adapter alone [VERIFIED via the four payload
sites listed above] plus the external callers.** Every new stamp column (the
S275 engagement build provisioned a 9-field wave across `akoya_request` and
the suggestion entity [per the workbench-lifecycle wiki]) obligates every list
that should mention it, and nothing checks that it was mentioned. S343 was "the reset list was missing the invitation stamps";
S347 was more of the same. The list "keeps growing as new edge cases surface"
because *growth is the only mechanism it has*.

### 4.2 The structural fix — registry + derived transitions

No schema change, one adapter refactor, behavior-frozen. Three parts:

**(1) One field registry.** Every engagement-semantic column is declared once
with its lifecycle classification:

```js
// The single source of truth for engagement-field semantics. A field family
// member NOT declared here fails the parity check below.
const ENGAGEMENT_FIELDS = Object.freeze({
  wmkf_invited:                { key: 'invited',               phase: 'invitation', reset: false },
  wmkf_emailsentat:            { key: 'emailSentAt',           phase: 'invitation', reset: null  },
  wmkf_respondremindersentat:  { key: 'respondReminderSentAt', phase: 'invitation', reset: null  },
  wmkf_accepted:               { key: 'accepted',              phase: 'response',   reset: false },
  wmkf_declined:               { key: 'declined',              phase: 'response',   reset: false },
  wmkf_responsetype:           { key: 'responseType',          phase: 'response',   reset: null  },
  wmkf_responsereceivedat:     { key: 'responseReceivedAt',    phase: 'response',   reset: null  },
  wmkf_materialssentat:        { key: 'materialsSentAt',       phase: 'review',     reset: null  },
  wmkf_remindersentat:         { key: 'reminderSentAt',        phase: 'review',     reset: null  },
  wmkf_remindercount:          { key: 'reminderCount',         phase: 'review',     reset: null  },
  wmkf_reviewreceivedat:       { key: 'reviewReceivedAt',      phase: 'review',     reset: null  },
  wmkf_reviewstatus:           { key: 'reviewStatus',          phase: 'review',     reset: null  },
  wmkf_proposalfirstaccessed:  { key: 'proposalFirstAccessed', phase: 'review',     reset: null  },
  wmkf_thankyousentat:         { key: 'thankYouSentAt',        phase: 'closeout',   reset: null  },
  wmkf_completedat:            { key: 'completedAt',           phase: 'closeout',   reset: null  },
  wmkf_withdrawnsufficientat:  { key: 'withdrawnSufficientAt', phase: 'closeout',   reset: null  },
  // ...heldat, selected, etc., each classified once
});
```

**(2) Transitions derive their payloads.** The named operations the system
actually performs stop hand-listing fields and instead select by
classification:

```js
const resetPhases = (...phases) => Object.fromEntries(
  Object.entries(ENGAGEMENT_FIELDS)
    .filter(([, f]) => phases.includes(f.phase))
    .map(([col, f]) => [col, f.reset]),
);

// remove (soft-delete): a WITHDRAWAL — clear response/disposition, keep
// contact-history stamps (invitation phase) intact. Today's hand-list, derived.
const REMOVE_PAYLOAD = { wmkf_selected: false, ...resetPhases('response'), wmkf_reviewstatus: null, wmkf_heldat: null };

// restore / re-add of a removed row: a FRESH START — every engagement phase.
const FRESH_START_PAYLOAD = { ...resetPhases('invitation', 'response', 'review', 'closeout') };
```

"What to reset when a candidate is re-added" stops being a question anyone
answers from memory: **adding a column to the registry with its phase answers
it automatically for every transition, current and future.** The
accept/decline cross-clearing in `applyStage2aResponse` becomes "entering
`response` phase resets the `response` phase first, then writes the outcome" —
one rule instead of two mirrored hand-lists.

**(3) A totality check makes the registry law.** A unit test (or a
`check:engagement-field-registry` sibling of `check:status-enum-parity`)
asserts three parities: every column in `updateLifecycle`'s field map that
belongs to the stamp family is classified in the registry; every registry
column exists in the adapter's select/write surfaces; and the legacy
`ENGAGEMENT_STAMP_RESET` shape (kept during migration) equals
`FRESH_START_PAYLOAD`. Then a future session adding `wmkf_newstampat` to the
entity **cannot ship without classifying it** — the failure is at CI time, not
at S3xx-plus-4 when a re-added reviewer surfaces with a stale stamp. With
`@ts-check` on the module (§2.7), `phase` becomes a checked union and the
derivation exhaustive.

What this deliberately does **not** do: no generic state-machine framework, no
new table, no event sourcing, no change to who may call which transition. The
existing guards (excluded-row refusal, disposition scope check in `restore`,
ETag discipline) stay exactly where they are. Estimated cost M: one adapter
refactor + the parity check + migrating the two test files that currently
restate the reset list (`reviewer-adapters-writeback.test.js`,
`reviewer-suggestion-disposition.test.js` — they hand-copy the payload today,
which is the same disease in the test layer; they should import the registry).

### 4.3 The generalized rule (the reusable lesson)

> **When several operations each hand-list members of the same field family,
> replace the lists with one classification registry, derive each operation's
> payload from the classifications, and add a check that the registry is total
> over the live field set.** Hand-listing members of a set defined elsewhere
> is the bug — whether the "members" are stamp columns, chokepoint sinks,
> coverage-tool call shapes, or enum labels. Derive when you can, gate parity
> when you can't derive, and never leave totality to memory.

Existing in-repo precedents to point future sessions at: the S339 COI
*discovery recorder* (declaration became a total function of adapter rows
fetched — the invariant-map brief's own template), `check:status-enum-parity`
(gated parity), and the S342 branded-`Guid` core (compiler-checked totality).
The registry is the same move at the field-family altitude.

---

## 5. What NOT to do

1. **No invariant-registry mega-document.** The enforcement lives in asserts,
   tests, and gates (§2.3); a prose catalog of invariants would itself be an
   unchecked enumeration needing reconciliation — the disease as the cure.
2. **No new CLAUDE.md rules or standalone skills for any of this.** The root
   file is already dense and its own docs say mutable catalogues don't belong
   there. Everything above lands in code, CI, one `/contract-reconcile`
   question, and one line in an existing path-scoped rule.
3. **Do not re-gate COI, and do not add identity-inference machinery.** The
   holistic review settled both (§1.5, §4); the audit already respects this.
4. **Do not relitigate DAL or the decomposition queue.** Healthy staged
   paydown, confirmed (§1). Finish the map's Tier-A #1 tail; treat each
   enforcement flip as a probe point, as the audit says.
5. **Do not build the carryover gate as a prose validator** — reshape the
   convention instead (§2.4). A gate that needs NLP judgment to fire is a gate
   that won't fire.
6. **No blanket TDD mandate and no `.ts` renames.** Fixture-first applies to
   judgment surfaces (§2.2); the rename hazard (five fail-open gates) is
   unchanged (§2.7).
7. **Leave alone:** the growing-but-gated doc-drift surface (the gates carry
   it; shrink inputs by preferring decision records over canonical
   architecture docs per holistic §5.7, rather than adding checkers); the
   4-PDF-app retirement, git-gc, Bill.com known-reds (do-not-relitigate, per
   the audit); Track B deletion and origination retirement (tracked in the
   parked holistic plan, not here).
8. **Do not treat this review as another maximal principle.** The two levers
   earn adoption the same way everything else should: §4 ships and the next
   stamp-field addition is measurably free; the eval suite ships and the next
   heuristic change is fixture-first. If either fails to pay within a couple
   of sessions of contact with reality, that is reality voting — cut it.
