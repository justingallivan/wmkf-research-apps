---
title: Whack-a-Mole Remediation Plan
domain: engineering-process
kind: plan
status: active
summary: "Original code-verified workstream proposal; independent Codex review returned NEEDS REWORK and owner reconciliation is pending before execution."
canonical: false
cataloged: 2026-07-08
owner: engineering-process
related:
  - docs/audits/whack-a-mole-meta-review-fable-2026-07-08.md
  - docs/audits/whack-a-mole-audit-2026-07-08.md
  - docs/audits/whack-a-mole-independent-review-codex-2026-07-09.md
  - docs/CLOSEABLE_CLASS_INVARIANT_MAP.md
  - docs/TYPESCRIPT_OPTION_ASSESSMENT.md
---

# Whack-a-Mole Remediation Plan

> **Independent review added 2026-07-09 — owner decision pending.**
> `docs/audits/whack-a-mole-independent-review-codex-2026-07-09.md` reached
> **NEEDS REWORK**: keep WS0 narrowly; reshape WS1–WS3 around explicit semantic
> state-space contracts and independent test oracles; reject WS4/WS5; defer WS6
> outside this program; keep WS7 as an opportunistic posture. This records a
> later review finding, not owner acceptance or a supersession decision. Do not
> execute the workstream sequence below until the owner reconciles the two
> recommendations.

Written 2026-07-08 (Fable, same session as the meta-review). Implements all
seven items of `docs/audits/whack-a-mole-meta-review-fable-2026-07-08.md` §2,
per owner scope decision (2026-07-08): **all seven, nomenclature rename as a
full build including route namespaces + authz surface.**

Every load-bearing code fact below was verified this session — either read
directly by the authoring session or by one of three read-only sub-agent
sweeps (eval surfaces; rename surface; session/skills machinery). Line numbers
drift; the executing agent must re-confirm each cited anchor before editing.

## How to use this plan

- Each workstream (WS) is sized for roughly one focused session and is
  independently landable. Recommended order: **WS0 → WS1 → WS2 → WS3 → WS4 →
  WS5 → WS7 → WS6** (the rename last — largest blast radius, and its gate
  updates benefit from everything before it).
- `main` auto-deploys. WS0/WS4/WS5 are low-risk and may follow the repo's
  commit-to-main norm; **WS1, WS3, and WS6 change runtime behavior — build on
  a branch and treat the merge as the owner's deploy decision.**
- Run the gate battery relevant to each WS before claiming done (listed
  per-WS); `/contract-reconcile` where flagged.
- The reviewer holistic redesign is now ACTIVE as a separate hybrid program
  (`docs/REVIEWER_HOLISTIC_REVIEW_IMPLEMENTATION_PLAN.md`): do not fold its
  identity/finding work into these workstreams or create overlapping edits
  without explicit coordination. Also do not re-gate COI or rename any `.js`
  file to `.ts` (five gates fail open on rename —
  `docs/TYPESCRIPT_OPTION_ASSESSMENT.md` §0.2, unchanged).

---

## WS0 — Quick win: put the missing gates in CI (S)

**Discrepancy (verified):** `.github/workflows/test.yml` runs a subset of the
`check:*` suite. Absent from CI today: `check:status-enum-parity`,
`check:trust-boundary-guid`, `check:prompt-injection-tagging`,
`check:fact-consistency`, `check:canonical-pointers`, `check:model-registry`,
`check:agent-wiki`, `check:memory-drift`, `check:memory-health`,
`check:drain-table-mentions`, `check:prompt-storage-mentions` [VERIFIED via
sub-agent read of `test.yml` this session]. The prompt-injection gap is the
invariant map's own Tier-A #2 recommendation
(`docs/CLOSEABLE_CLASS_INVARIANT_MAP.md` §3), still open.

**Change:**
1. Add to `test.yml`, each with its self-test where one exists:
   `check:prompt-injection-tagging`, `check:trust-boundary-guid`,
   `check:status-enum-parity`. These three are correctness/security gates that
   currently only fire at session Stop — a push from any other path skips them.
2. For the remaining absent gates, decide deliberately and record in the
   workflow file as a comment: memory/doc-hygiene gates
   (`memory-drift`/`memory-health`/`agent-wiki`/`fact-consistency`/…) may
   reasonably stay session-time-only — if so, say so in a one-line comment so
   the absence reads as a decision, not an oversight.

**Verify:** push a branch with a deliberately-unregistered prompt surface (or
run each gate's `--self-test`) and confirm CI goes red; then green on revert.
**Done when:** the three gates run in CI; the exclusion of the rest is
documented in-place.

---

## WS1 — Engagement-stamp field registry (M, branch)

Design: meta-review §4.2. Target file:
`lib/dataverse/adapters/reviewer-suggestion.js`.

**Verified current state** (read directly this session):
- `ENGAGEMENT_STAMP_RESET_ENTRIES` — 12 hand-listed triples (~line 600).
- Three more hand-assembled payloads in the same file: `softDelete`
  (~1380: `selected/accepted/declined/responsetype/reviewstatus/heldat` +
  optional token revoke), `applyStage2aResponse` accept (~1315) and decline
  (~1332) with mirrored cross-clearing.
- `updateLifecycle` (~1183): generic 22-key map; buried side effects
  (excluded-row refusal; complete-transition stamping).
- Tests hand-copy the reset payload as byte-identical 12-field literals:
  `tests/unit/reviewer-adapters-writeback.test.js:22-35` and
  `tests/unit/reviewer-suggestion-disposition.test.js:41-54` [VERIFIED via
  sub-agent].
- Template for the parity gate: `scripts/check-status-enum-parity.js` —
  `checks[]` registry entries with `subset|equal` rules, empty-extraction
  vacuous-pass guard, `--self-test` protocol (`package.json:67-68`)
  [VERIFIED via sub-agent].

**Steps:**
1. **Behavior-freeze first.** Snapshot current payloads: write a temporary
   test asserting the exact literal payloads of `softDelete`, restore/re-add
   reset, accept, decline as produced today. This is the freeze harness; the
   refactor must keep it green.
2. Introduce `ENGAGEMENT_FIELDS` registry in the adapter (or a sibling module
   `lib/dataverse/adapters/reviewer-suggestion-lifecycle.js` if the adapter's
   size warrants): every engagement-semantic column declared once with
   `{ key, phase: 'invitation'|'response'|'review'|'closeout', reset }`.
   Classify all 12 reset fields plus `wmkf_accepted`, `wmkf_declined`,
   `wmkf_responsetype`, `wmkf_reviewstatus`, `wmkf_heldat` (the softDelete
   set). Add `// @ts-check` + a JSDoc phase union so `check:types` enforces
   classification shape (see WS7).
3. Add `resetPhases(...phases)` derivation; re-express:
   - `ENGAGEMENT_STAMP_RESET` / `ENGAGEMENT_STAMP_LIFECYCLE_RESET` ≡
     fresh-start over all phases (keep the exported names during migration);
   - `softDelete`'s clear-set ≡ withdrawal (response-phase reset + its
     non-registry fields);
   - accept/decline cross-clearing ≡ "entering response phase resets response
     phase, then writes the outcome."
   Existing guards (excluded-row refusal, `restore`'s disposition scope check,
   ETag discipline) move nothing.
4. **Totality gate.** New `check:engagement-field-registry` (clone the
   status-enum-parity template + self-test): asserts (a) every stamp-family
   column in `updateLifecycle`'s field map is classified in the registry,
   (b) every registry column appears in the adapter's select/write surface,
   (c) registry-derived fresh-start equals the exported reset shape. Wire into
   `package.json` + `test.yml` + the Stop-hook gate map if applicable.
5. Point the two test files at the registry (import, don't restate). Delete
   the freeze harness from step 1 or keep it as the regression fixture.
6. External writers (send-emails-service inline invite stamping, reminder /
   thank-you sweeps' fire-once markers, withdraw-sufficient) are NOT
   refactored in this WS — they are transition *writers*, not reset lists.
   Add a pointer comment at the registry: any new stamp column must be
   classified here, and the gate enforces it.

**Verify:** freeze harness green through the refactor; `npm test`;
`check:engagement-field-registry --self-test` proves an unclassified synthetic
column fails; `/contract-reconcile` (durable-state surface); drive
remove → restore → re-invite on a preview deploy.
**Done when:** no hand-listed stamp payload remains in the adapter or tests;
the gate is in CI; adding a fake column without classification goes red.

---

## WS2 — Offline fixture evals for judgment surfaces (S–M)

**Reshaped from "wire the evals into CI" — verified blocker:** both harnesses
(`scripts/eval-orcid-spine-sweep.mjs`, `scripts/eval-orcid-spine-constrained.mjs`)
require `CLAUDE_API_KEY`, Dynamics + Graph/SharePoint credentials, and live
OpenAlex/ORCID; ground truth is a cross-source proxy, output is console-only,
and neither is in `package.json` or CI [VERIFIED via sub-agent read of both
scripts]. They cannot run in CI as-is and should stay what they are: manual
live probes.

**What CI gets instead — a fixture corpus over the pure judgment functions:**

1. **Identity promotion grammar:** unit fixtures for
   `classifySpineEvidence` (`lib/services/reviewer-identity-resolver.js`) —
   encode the known regression cases as fixtures first: the S231 fabricated-
   forename case, the S236 Keller/Sang forename-polarity regression, one case
   per branch of the 8-branch grammar. (If the parked holistic redesign later
   replaces the resolver, the fixtures ARE the head-to-head spec — they
   transfer.)
2. **Name matching:** fixtures over the four parallel normalizers [VERIFIED
   via sub-agent]: `discovery/name-matching.js`,
   `reviewer-identity-evidence.js:287-330` (`forenameFullyAgrees`/
   `forenamesContradict`), `lib/utils/reviewer-name-match.js`
   (`normalizeReviewerName`), `lib/utils/name-normalization.js`
   (`normalizeName`). Same input table run against all four, with the
   *expected divergences* asserted explicitly (e.g. digit-stripping in
   `normalizeReviewerName` is load-bearing for the roster index — the S312
   trap). The table documents which semantics are intentional; a future
   consolidation (holistic §4.2) has its spec ready-made.
3. **Akoya cohorting:** fixtures for `meetingDateToCycleCode` /
   `parseCycleCode` / `cycleCodeToOdataFilter` (`lib/utils/cycle-code.js`),
   including the off-month case — updated by WS3 when fail-loud lands.
4. **The rule, made durable:** add one line to the update-trigger section of
   `docs/agent-wiki/topics/reviewer-identity.md` and to the fixture file
   header: *no new promotion rule, heuristic branch, or threshold change
   without a failing fixture in this corpus first.* (No new CLAUDE.md rule —
   the fixture-file header is read exactly when someone edits the grammar.)

These are plain Jest tests (`tests/unit/judgment-fixtures/…`), so they enter
CI through the existing `npm run test:ci` with zero workflow changes.

**Verify:** mutation check — flip one branch polarity in
`classifySpineEvidence` locally and confirm a fixture fails.
**Done when:** the corpus covers items 1–3, runs in `test:ci`, and the
mutation check goes red.

---

## WS3 — Prose-invariant triage sweep + Akoya fail-loud (S–M, branch, timeboxed)

**Part A — Akoya cycle-code fail-loud (the concrete instance, do first).**
Verified: `lib/utils/cycle-code.js:32` returns `null` for any non-June/Dec
meeting month, header codifies it, `parseCycleCode` only accepts
`^([JD])(\d{2})$`, so an off-month proposal is silently uncohortable in both
directions; ~19 references across ~15 lib files call it (suggestion adapter
`findByPD`/`findAcceptedByPD`, `reviewer-finder/*-service`,
`review-manager/*-service`, `workbench/*-service`)
[VERIFIED via sub-agent; memory `akoya-temporal-axis-encodings.md:35`].

Design (per the memory's own recommendation): introduce an explicit
`UNCLASSIFIED` sentinel rather than `null`, so callers must decide.
1. Audit all ~19 call sites first; classify each as (a) filter-building
   (`cycleCodeToOdataFilter` path — must surface unclassified, not silently
   exclude), (b) display (render "Unclassified cycle"), (c) grouping (bucket
   under an explicit Unclassified cohort).
2. Change `meetingDateToCycleCode` to return the sentinel (or throw with a
   `{ allowUnclassified }` opt — pick after the caller audit says which is
   least invasive; prefer the sentinel: a throw in a list-rendering path is a
   new 500 surface).
3. Fixture in WS2's corpus: off-month date → sentinel, and one caller-level
   test that an unclassified proposal is *visible* in the PD surface rather
   than dropped.

**Part B — the triage sweep (timebox: the rest of one session).**
Corpus: the Operating-Notes/hazard bullets of the agent-wiki topics + the
Always-Read-Guardrails memory files (`.claude-memory/MEMORY.md` header
section). For each load-bearing never/always/only claim, classify:
- **(a) already enforced** → append `enforced-by: <path>` to the bullet;
- **(b) enforceable cheaply** → write the assert/test now (Akoya above is the
  first (b));
- **(c) advisory** → mark it `advisory` explicitly.
Output: the annotations themselves plus a short table in this doc's tail
(claim / class / enforcement pointer). Do not build a standalone invariant
registry document (meta-review §5.1).

**Go-forward rule** (one edit): add to
`.claude/skills/contract-reconcile/SKILL.md` Step 5's output contract: a
load-bearing invariant stated in prose during the work must name its
enforcement (assert/test/gate) or be labeled advisory.

**Verify:** `npm test`; for Part A run `check:atlas`/`check:doc-symbol-refs`
after doc annotations; drive one off-month proposal through the workbench list
on preview.
**Done when:** Part A ships fail-visible behavior with fixtures; every swept
bullet carries `enforced-by:` or `advisory`.

---

## WS4 — Carryover items carry their own probe (S)

**Verified current state** [sub-agent]: `SESSION_PROMPT.md` already buckets
carryover (`Verified Open` / `Owner Decision Needed` / `Parked` / `Verify
Before Acting` / `Do Not Reopen…`) and items already carry an informal
`Evidence:` line citing files/commits. `/stop` SKILL.md Step 3 mandates
verifying next-steps before writing; `/start` Step 5 covers only destructive
carryover; **no validator of SESSION_PROMPT exists** — it appears in drift
gates only as a generic scanned file; the session-lifecycle hook
(`.claude/hooks/session-lifecycle.js:23`) maps SESSION_PROMPT edits to
`check:fact-consistency` only.

**Change — formalize the existing convention into a runnable one:**
1. Convention: each `Verified Open` item gains a `Probe:` line — one shell
   command (rg/test/ls) plus expected outcome, e.g.
   `Probe: rg -l "TRACK_B_ENABLED" lib/services/discovery/constants.js → 1 file (still present ⇒ item live)`.
   `Owner Decision` / `Parked` items are exempt (they wait on a human, not on
   repo state).
2. New `scripts/check-carryover-freshness.js` + self-test: parses
   `SESSION_PROMPT.md`'s `### Verified Open` section; flags (a) items with no
   `Probe:` line, (b) probes that error, (c) probes whose actual outcome
   mismatches the expected marker. Read-only, no network; allow an explicit
   `Probe: none — <reason>` escape so prose-only items are a decision, not a
   gap. Add `check:carryover-freshness` to `package.json`; wire into the
   session-lifecycle hook's SESSION_PROMPT entry and the Stop-time battery
   (NOT CI — SESSION_PROMPT is session state; a red probe should block the
   *handoff*, not unrelated pushes).
3. Update `/stop` SKILL.md Step 3 and its embedded template: next-step items
   are written with `Probe:` lines; run the check before finishing. Update
   `/start` Step 4: run the check first; stale-probed items are read as
   unverified regardless of bucket.

**Verify:** self-test with fixtures (missing probe / failing probe / passing
probe / `none —` escape); run against the live SESSION_PROMPT and fix its
items to conform.
**Done when:** the check runs at Stop via the hook, the skills reference it,
and the live SESSION_PROMPT passes.

---

## WS5 — Two-axis audit question in /contract-reconcile (S)

**Verified anchors** [sub-agent]: audits live in
`.claude/skills/contract-reconcile/SKILL.md` under `## Step 4 — Run the seven
audits…` (numbered 1–7); the count "seven" is restated in the heading AND the
frontmatter description (line 3) — both must change (this plan's own
"one source of truth means zero other restatements" rule). The path-scoped
rule file `.claude/rules/dataverse-dynamics.md` is 12 lines with a `paths:`
frontmatter covering `lib/dataverse/**`.

**Change:**
1. Add audit **8. Axis-overload** to Step 4: *"For any status/enum/flag field
   this change adds or guards: does any guard, reset, or stickiness rule need
   to know WHO/WHY/HOW the value was set? If yes, that is a second axis —
   add a source/provenance column; do not overload the enum. (Archetype: the
   identity `confirmed` sentinel, meta-review §2.5.)"* Update "seven"→"eight"
   in the heading and frontmatter description.
2. Append one sentence to `.claude/rules/dataverse-dynamics.md`: "A field
   whose guards must know who or why it was set carries two axes — split
   provenance into its own column instead of overloading the status enum."
3. Run `npm run check:agent-invariants` and `check:instruction-architecture`
   (instruction-file work).

**Done when:** both edits land and the instruction gates pass. (Honest label
from the meta-review stands: this is a remembered heuristic riding auto-firing
machinery, not closure by construction.)

---

## WS6 — Nomenclature rename, full build (L, branch, phased)

**Owner decision 2026-07-08: full build, including route namespaces + authz
surface.** This REVERSES the currently-documented policy: `appRegistry.js`'s
`ROUTE_NAMESPACE_LIFECYCLE` / `APP_LIFECYCLE_REGISTRY` mark the legacy
namespaces `migrationDecision: 'LEAVE+DOCUMENT'` with explicit "Do not rename
the path" notes [VERIFIED via sub-agent]. Reversing that decision in the
registry + its governing docs (`docs/NOMENCLATURE_AND_APP_LIFECYCLE_STRATEGY.md`,
`docs/NOMENCLATURE_GLOSSARY.md`) is Phase 6.0, not an afterthought — otherwise
every drift gate and future session will read the rename as a violation.

**Verified surface** (sub-agent sweep; re-verify counts before editing):
- Routes: `pages/api/reviewer-finder/` 13 files; `pages/api/review-manager/`
  16; canonical successor `pages/api/workbench/` 23. No legacy page-level
  routes exist. `pages/api/field-primer/` is cross-cutting and flagged
  do-not-rename (`appRegistry.js:352-358`) — LEAVE.
- Services: `lib/services/reviewer-finder/` 7 files;
  `lib/services/review-manager/` 12. `check-route-service-boundary.js` pairs
  `pages/api/<domain>/` ↔ `lib/services/<domain>/`, so route and service dirs
  must move together.
- Client URLs: `/api/reviewer-finder/…` 20 occurrences / 9 files;
  `/api/review-manager/…` 31 / 11 files; mostly
  `shared/components/reviewers/*`.
- Authz: `requireAppAccess` keys — `'reviewers'` 65 calls,
  `'reviewer-finder'` 19, `'review-manager'` 18; every legacy-keyed call
  ALREADY also accepts `'reviewers'` (variadic OR). Legacy keys exist only in
  `APP_LIFECYCLE_REGISTRY`, not in the active APP_REGISTRY (12 apps).
- Gates: `check-route-lifecycle-auth.js` reads `guardAppKeys` from
  `ROUTE_NAMESPACE_LIFECYCLE` and fail-closed asserts per-route
  `requireAppAccess` args; its self-test hardcodes
  `'reviewer-finder','reviewers'`. `check-api-route-security-matrix.js` and
  `check-route-service-boundary.js` are filesystem-driven (follow a rename,
  but the matrix must be regenerated).
- **Persisted-data keys — SCOPE OUT (keep stable):** Dataverse preference/
  setting keys `reviewer_finder_*` (5 keys,
  `shared/config/reviewerFinderPreferences.js:22-52`), prompt-name keys
  `reviewer-finder.analyze` / `.score-candidates` /
  `.remove-candidate-entirely`, and `baseConfig.js:38`'s model-routing key
  `'reviewer-finder'`. These are stored data; renaming them is a user-data
  migration for zero user-visible gain. Keep them, with a comment at each
  definition: "legacy stored key — do not rename without a data migration."
  If the owner later wants them migrated, that is its own plan.
- Redirect precedent: `next.config.js` `redirects()` already hosts
  `/proposal-summarizer` → `/phase-ii-writeup`. API redirects are lossy for
  POST bodies — all callers are in-repo, so **update callers; do not rely on
  redirects for /api/**. (Optional: temporary 308s for GET-only external
  tooling, else none.)
- Docs/memory restatement scale (for Phase 6.4 sizing): `reviewer-finder` in
  155 docs files + 47 memory files; `review-manager` 85 + 22.

**Target naming** (confirm with owner at branch-open if any doubt): fold both
legacy namespaces into the canonical `workbench` domain —
`pages/api/reviewer-finder/*` + `pages/api/review-manager/*` →
`pages/api/workbench/*` (flat or grouped, executing agent's call after
checking for filename collisions with the existing 23), services likewise into
`lib/services/workbench/`; all guards become `requireAppAccess(req, res,
'reviewers')`.

**Phases (one branch, commit per phase):**
- **6.0 Decision reversal:** update `ROUTE_NAMESPACE_LIFECYCLE` +
  `APP_LIFECYCLE_REGISTRY` entries (status: migrated, date, pointer to this
  plan §WS6), the two governing nomenclature docs, and
  `check-route-lifecycle-auth` expectations + self-test in the SAME commit
  (the gate and registry are one contract — the invariant map's "second
  hand-authored declaration" lesson).
- **6.1 Grant-data preflight (probe, no code):** verify via a live probe that
  every user holding a `reviewer-finder`/`review-manager` grant row also holds
  `reviewers` (the variadic guard means routes stay accessible either way, but
  confirm before dropping keys so no user loses access). Script it:
  `scripts/probe-legacy-app-grants.mjs`, dry-run output only.
- **6.2 Move routes + services + callers:** `git mv` the 13 + 16 legacy route
  handlers and 7 + 12 service modules into the workbench namespaces; update the ~20 client files'
  URL strings; drop legacy keys from the 37 `requireAppAccess` calls
  (→ `'reviewers'`). Update the non-gating scripts that hardcode paths
  (`smoke-review-manager.js`, `debug-reviewer-finder.js`,
  `test-reviewer-finder.js`, `validate-reviewer-analyze.mjs`, seeds).
  `tsconfig.check.json`'s include list names
  `pages/api/reviewer-finder/cycle-material.js` — update the path there too
  [VERIFIED via sub-agent: it is in the include list].
- **6.3 Gates re-baseline:** regenerate/re-run `check:api-route-security-matrix`,
  `check:route-service-boundary`, `check:route-lifecycle-auth` (+self-tests),
  full `npm test` + `npm run build`.
- **6.4 Docs/memory sweep:** run `/sweep` for the fact-level rename across the
  155+85 docs and 47+22 memory files — reconcile *live* claims; historical
  session narratives stay historical (durable-docs rule). Update the
  agent-wiki topics' `source_files` lists and the Atlas pages that name moved
  paths.
- **6.5 Grep-zero gate (the done criterion, committed as the guard):** new
  `check:legacy-nomenclature` + self-test: asserts zero occurrences of
  `reviewer-finder` / `review-manager` in live-code scopes (`pages/`, `lib/`,
  `shared/`, `scripts/` minus an explicit allowlist for the scoped-out stored
  keys of 6.0's registry entries and `_archived/`). Wire into CI. "candidate"
  is NOT in the gate (see below).
- **6.6 Preview-deploy drive:** exercise find → save → invite → track →
  reviews on a preview deploy before merge; merge is the owner's deploy.

**"candidate" scope (deliberately narrower):** verified internal-only — zero
`wmkf_*candidate*` Dataverse columns; the backing table is
`reviewersuggestion` [VERIFIED via sub-agent grep of the complement]. But 127
files use the word, mostly as harmless internal vocabulary. Full eradication
is churn without a closed class. Scope: rename only the *route filenames*
being moved anyway in 6.2 (`my-candidates`, `save-candidates`,
`merge-candidates`, `export-candidates`) and their exported service names;
leave component-local variables alone. Record the vocabulary decision in
`docs/NOMENCLATURE_GLOSSARY.md`.

**Rollback:** phases 6.2+ are one branch; abandon = delete branch. After
merge, rollback = revert commits (no data migration involved — that is exactly
why stored keys were scoped out).

**Done when:** `check:legacy-nomenclature` is green in CI, the lifecycle-auth
gate + matrix are re-baselined, preview drive passes, and the sweep left no
live-claim drift (`check:doc-symbol-refs`, `check:fact-consistency`,
`check:build-claim-freshness` green).

---

## WS7 — checkJs extension posture (S per instance)

**Verified anchors** [sub-agent]: `tsconfig.check.json` — `allowJs: true`,
`checkJs: false` (per-file `// @ts-check` opt-in), `strict`, `noEmit`,
10-file include list; `check:types` = `tsc -p tsconfig.check.json`
(`package.json:71`), already in CI.

**Change (rides WS1 and future registries; not a standalone session):**
1. WS1's registry module gets `// @ts-check`, a JSDoc union typedef for
   `phase`, and `Record<string, EngagementFieldDef>` typing; add the module to
   the `include` list.
2. Standing rule, recorded here: any new classification registry or
   enum-consuming derivation added under this plan gets the same treatment at
   birth. No `.ts` renames (constraint unchanged until the five fail-open
   gates are AST-hardened — `docs/TYPESCRIPT_OPTION_ASSESSMENT.md` §3b).

**Done when:** WS1's module compiles under `check:types` and a deliberately
missing classification key fails the compile or the WS1 gate.

---

## Sequencing and sizing summary

| WS | What | Size | Risk | Branch? |
|---|---|---|---|---|
| 0 | Missing gates → CI | S | low | main-ok |
| 1 | Stamp registry + parity gate | M | med (runtime behavior-freeze) | branch |
| 2 | Judgment fixture corpus | S–M | low (tests only) | main-ok |
| 3 | Akoya fail-loud + invariant sweep | S–M | med (behavior change, ~19 call sites) | branch |
| 4 | Carryover probes + check | S | low | main-ok |
| 5 | Contract-reconcile audit 8 + rule line | S | low | main-ok |
| 7 | checkJs on registries | S | low | rides WS1 |
| 6 | Nomenclature rename | L | high (auth gate + 29 routes + docs mass) | branch, phased |

## Standing constraints for the executing agent

- Re-verify every cited line number before editing (`main` auto-deploys;
  anchors drift).
- Behavior-freeze before refactor (WS1, WS3, WS6.2): snapshot current outputs
  as tests first.
- A gate change and its self-test land in the same commit; a registry and the
  gate that reads it are one contract — never edit one alone (WS6.0, WS1.4).
- `/contract-reconcile` on WS1 (durable state), WS3 Part A (partial-success
  semantics at ~19 call sites), WS6.2 (cross-layer).
- Timebox WS3 Part B and WS6.4 (support work; check in at ~30 min / two
  commits per CLAUDE.md rule 3).
- Nothing here owns the ACTIVE reviewer holistic redesign; if a WS collides
  with it (e.g. resolver edits), coordinate with that hybrid program first.
  The fixture corpus (WS2) remains the only pre-authorized overlap.
