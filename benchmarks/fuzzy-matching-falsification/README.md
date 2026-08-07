# Fuzzy-Matching Falsification Suite (consensus §1 step 0)

Built S405 (2026-08-06) per the owner's decision: **build the falsification
suite but don't execute.** Charter:
`outputs/fuzzy-matching-consensus-recommendation-2026-08-06.md` §1 step 0;
owner answers in `outputs/fuzzy-matching-owner-answers-2026-08-06.md`.

## Status — read before touching

- **BUILT S405; INCUMBENT BASELINE FROZEN same session** (owner authorized
  execution: "use sonnet to execute the suite", 2026-08-06). The incumbent
  production predicates were run against all cases via
  `adapters-incumbent.js` — results and analysis in
  `baseline/incumbent-2026-08-06.{results.jsonl,md}`. Headline: 89 pass /
  64 fail (60 real + 4 judge naming artifacts) / 12 skipped; zero
  wrong-entity resolutions — the incumbent is "safe but blind" (blanket
  abstention). No S400 drift. Comparator runs (ROR `chosen:true`, S2AFF)
  have NOT happened; threshold calibration remains out of scope for this
  suite entirely.
- `run.js` has now executed once; three harness fixes were made during that
  run (see its inline comments and the baseline report). Known sharp edge:
  target-name judging is exact-string — compare normalized names or ROR ids
  in future runs. `validate-cases.js` (schema lint) passes.
- Executions hit live keyed OpenAlex: load env with
  `set -a; . .env.local; set +a` (grep/cut extraction glues quotes onto the
  key and silently breaks every call — see the baseline report's discarded
  runs).
- Jest does not pick this directory up (`testMatch` covers only `tests/`,
  `shared/**/__tests__`, `pages/**/__tests__`; verified via
  `npx jest --listTests`). Keep it that way — no `*.test.js` names here.

## What this suite is

The 150–300-case falsification/regression asset the Claude×Codex consensus
requires before any matching build: known real failures frozen as fixtures
plus a UC-system adversarial matrix. It **selects/rejects approaches**; it is
**explicitly not sufficient for production threshold calibration** (that
needs the representative benchmark, which the owner has parked — high-risk
automation stays review-only).

## Contents and denominators

166 cases across six files (regenerate counts with `node validate-cases.js`):

| File | Cases | What it covers |
|---|---|---|
| `cases/institution-uc-matrix.jsonl` | 120 | Generated UC adversarial matrix (below) |
| `cases/institution-byline-normalization.jsonl` | 14 | The S400 probe + production capture: decorated-byline false mismatches (request 1002903), incl. the 4 false + 1 genuine production operands, + 2 positive controls the incumbent gets right |
| `cases/institution-hierarchy.jsonl` | 7 | Dana-Farber/HMS/Harvard (Shih shape), VUMC↔Vanderbilt, LBNL, UC San Diego Health, Broad, multi-org strings |
| `cases/person-identity.jsonl` | 11 | Tsai/Nakano, Noe/Clementi, Laederach forename veto, Zhou namesake bleed, Kwong re-discovery collapse + anchor-conflict veto, nickname one-to-many, diacritic class, common-name insufficiency |
| `cases/contact-attribution.jsonl` | 8 | Smirnova/Chen namesake contacts, Shih address conflict, the domain-abbreviation keep-biased hazard, verified-domain match/contradiction, evidence decay |
| `cases/affiliation-current.jsonl` | 6 | Historical-vs-current, joint appointment (Q5), stale-no-end-date, EKA contaminant, weak-source conflict, visiting role |

Origin split: 26 real (documented in repo sources, cited per-case) /
140 synthetic (policy-derived; the UC matrix and shape-from-real-case
fixtures). Every case carries `source` provenance and a `label_status`.

**UC matrix sampling (no silent caps):** the tracked file is the DEFAULT
emission — 2 siblings per campus (cyclic neighbors) for the three
substitution families. The full 9-sibling cross product is **335 cases**;
regenerate with `node generate-uc-matrix.js --full` when a run wants
exhaustive coverage. The generator is deterministic — same table, same bytes.

`ror_id` is null everywhere by design: populating it belongs to the
pinned-ROR-dump work (consensus step 2); guessing IDs would fabricate values.

## Case schema

One JSON object per line. Common fields: `id`, `decision`
(institution|person|affiliation|contact|authorship), `kind` (routes to an
adapter — see `ADAPTER_BY_KIND` in `run.js`), `family`, `origin`
(real|synthetic), `source` (provenance citation), `label_status`
(verified|assumed), `input` (decision-specific), `expected` (always has
`outcome`: resolved|review|unresolved; plus per-kind assertions —
`consistent`, `match`, `attach`, `current`, `must_not_resolve_to` as a hard
veto list), optional `documented_incumbent` (what the old code demonstrably
did, from cited docs — recorded provenance, NOT an executed baseline), and
`note`.

Labels follow the Codex Phase-0 discipline: per-decision labels, never one
collapsed "correct candidate"; abstention (`review`/`unresolved`) is a
first-class correct answer. PII discipline: no real email addresses in
tracked fixtures — structural `<placeholders>` or reserved example domains
only (`validate-cases.js` enforces this).

## Owner-adjudication list (label_status: assumed)

Ground truth never established; expected labels are design-intent `review`:

1. **person-005 / inst-byline-012 — Yubin Zhou** (request 1002903): is the
   Northwestern Feinberg byline his (recent move/joint role) or a namesake's?
   S400 left it open; verification confidence was 50%.
2. **affil-004 — EKA University of Applied Sciences** contaminant on the
   Columbia candidate: origin untraced (carried SESSION_PROMPT item). Also a
   product question: is quarantine-for-review (vs silent drop) the right
   handling for provenance-less affiliations?

## Executing later (not now)

`runSuite(adapters)` in `run.js` takes one adapter set per system under test
and refuses to run with none wired. The first authorized execution should:
freeze the incumbent predicates as baseline, run comparators (ROR
`chosen:true` only, S2AFF, local exact-alias baseline), and record results —
per the consensus §1 step 0 and the comparator/metric lists in
`docs/REVIEWER_IDENTITY_AND_INSTITUTION_RESOLUTION_RESEARCH.md`.
