# Whack-a-Mole Audit — accumulated patch-debt & redesign candidates (2026-07-08, S349)

Method: three parallel read-only agents swept (1) planning/audit docs + atlas,
(2) `.claude-memory/`, (3) agent-wiki topics + `DEVELOPMENT_LOG.md` + `docs/audits/`.
Each hunted the same signal — subsystems patched round after round instead of
redesigned (escalating stage/version counts, re-landing regressions, stacked
workarounds, superseded directions). This doc synthesizes and deduplicates
their findings and records the remediation to-do (tiered).

## The meta-pattern (the docs diagnosed it themselves)

`docs/audits/reviewer-holistic-review-fable-2026-07-08.md` §6 names the
recurring behavioral root cause:

> "You adopt a maximal principle from a vivid single case, encode it fully in
> code and prose, and only then let reality vote." — with **eight documented
> reversals** and a "patch → regression → re-patch loop."

Two structural amplifiers recur across unrelated subsystems:
- **A field/enum carrying two orthogonal axes.** The identity `confirmed`
  sentinel encodes confidence AND human-attestation-source at once, so a
  fallible automated path inherits un-downgradeable human-attestation
  stickiness (Fable §4.1).
- **Load-bearing invariants written in prose, not enforced in code.** The
  `confirmed` invariant "broke without anyone noticing for three sessions"
  because it lived in comments/memory, not a gate.

The stale-state bug fixed this same session (per-loader guards → keying
`ReviewersTab`, commit `f805b5f`) is the same meta-pattern in miniature:
whack-a-mole guards until a structural fix (a key) closed the class.

## Ranked areas

| # | Area | Rounds | Redesign status | Worthiness |
|---|------|--------|-----------------|-----------|
| 1 | Reviewer identity resolution / namesake / `confirmed` sentinel | ~8–12 sessions (S211→S349) | Designed, **not built** (Fable plan; PARKED branch) | HIGH |
| 2 | Reviewer email discovery + persistence | ~5–6 (S235,265,267,306,317,321) | Cron + backfill band-aids | HIGH |
| 3 | Contact dedup / merge / wrong-person-send gating | ~6+ docs | Redesign doc exists; still per-gate tuning | HIGH |
| 4 | Dynamics Explorer hand-transcribed schema | recurring (S139→) | `DYNAMICS_EXPLORER_PATH_A_PLAN.md` (auto-derive) | HIGH |
| 5 | Origination engine (Track B / retrieval-first / web-discovery) | ~6 (S161→253) build→abandon | Direction settled; **deletion pending** | MED-HIGH |
| 6 | Legacy nomenclature in code (reviewer-finder/review-manager/"candidate") | session after session | Rename partly done; route namespaces pending | MED-HIGH |
| 7 | Coverage-tool / gate misses ("each round a one-line miss that aggregates") | many | Parity gate + hook built; TS lever proposed | MEDIUM |
| 8 | Engagement-lifecycle stamp reset | ~5 (S275,277,285,343,347) | Incremental only — no consolidated design | MEDIUM |
| 9 | Stale carryover items across sessions | ~5+ | **No automated gate** | MEDIUM |
| 10 | Dataverse schema-deploy drift (create-only, dup-on-rerun) | S139→S268 | Workaround knowledge only | MEDIUM |
| 11 | Dual reviewer-count model (5-slot vs ledger) | ongoing | Consolidate-on-ledger named | MEDIUM |
| 12 | Akoya cycle-code silent-drop (convention-not-invariant) | recurring | Fail-loud proposed | MEDIUM |

**Not thrash — already healthy / handled (do NOT redesign):**
- **DAL / bypass-strip / Route→Service consolidation** — this IS the redesign
  (disciplined staged paydown). Only open flag: enforcement flips keep
  uncovering latent defects (S331, S341) and "site 33" was deferred twice; the
  tail isn't fully closed (`NOTIFICATION_TRUST_MODEL_PLAN.md`).
- **God-object decompositions** (Discovery S335, DynamicsService S345,
  contact-enrichment S337) — an intentional queue, same behavior-freeze recipe
  each time. Worth only a lessons-learned note on why services reach
  1,700–2,300 lines before decomposition.
- **Resolved by retirement / do-not-relitigate:** 4 PDF-app sunset (S344, chose
  retire over re-scope), git auto-gc (moved off cloud path), Bill.com known-red
  tests (explicitly don't-chase), instruction-architecture (redesigned S226+).

## The headline

Areas 1–3 and 5–6 are facets of one mega-subsystem: reviewer
**finding → identity → contact → gating**, re-attacked ~8+ ways over ~5 months.
`docs/REVIEWER_FINDER_RESCUE_DOSSIER.md` says it plainly — "we are worried we
are running in circles… tell us if there's a materially simpler approach we've
talked ourselves out of." **The redesign is already written**
(`docs/REVIEWER_HOLISTIC_REVIEW_IMPLEMENTATION_PLAN.md`, PARKED for a dedicated
branch build + head-to-head vs main — see
`.claude-memory/project-reviewer-holistic-redesign-parallel-build.md`). These
areas are tracked THERE; they are not duplicated below.

---

## Remediation to-do

### Next-up (bounded, high-confidence — pull from these first; ~2–3 sessions of work)

1. **Carryover-freshness gate (#9).** The only recurring class with no
   automated guard: stale SESSION_PROMPT "next steps" propagate across sessions
   and get nearly acted on (`.claude-memory/feedback-verify-before-destructive-carryover.md`,
   `feedback-verify-additive-carryover-not-just-destructive.md`). Build a small
   check that flags carryover items whose cited evidence (path/commit/flag) no
   longer matches live state. Smallest, clearest win.
2. **Finish the code-level nomenclature rename (#6).** Docs/memory sweeps keep
   unwinding the same stale claims because route paths + authz keys still carry
   `reviewer-finder`/`review-manager`/"candidate"
   (`.claude-memory/feedback-rename-code-not-just-docs.md`,
   `project-nomenclature-and-app-sunset-sweep.md`). Rename the code
   (route-namespace consolidation is the remaining durable step) so the sweep
   stops re-deriving stale facts from live code.
3. **Akoya cycle-code fail-loud (#12).** `.claude-memory/akoya-temporal-axis-encodings.md`:
   off-month meeting dates silently drop from Jxx/Dxx cohorting. Make the
   uncohortable case fail loud instead of silently dropping. Small, bounded.

> Note: the identity `binding-source` field (the #1 two-axis fix) is real and
> high-value, but it is **P0/P1 of the PARKED reviewer holistic plan** — do it
> as part of that branch build, not as a standalone here, unless the owner
> chooses to pull it forward as an isolated safety fix.

### Backlog (future sessions — bigger builds or lower priority)

4. **Dynamics Explorer auto-derived schema (#4).** Stop hand-transcribing
   `DYNAMICS_SCHEMA_ANNOTATION.md`; execute `DYNAMICS_EXPLORER_PATH_A_PLAN.md`
   (auto-derive from live metadata). Root cause is hand-maintenance → drift →
   frequent failures. Real build.
5. **Idempotent / reconcile-aware Dataverse deploy tool (#10).**
   `apply-dataverse-schema.js` is create-only and dup-on-rerun; retires several
   recurring deploy gotchas (`.claude-memory/project-dataverse-schema-deploy-gotchas.md`).
6. **Engagement-lifecycle stamp state machine (#8).** Replace the accreting
   `ENGAGEMENT_STAMP_RESET` lists (S343/S347) with a single source of truth for
   the suggestion lifecycle. Real blast radius — design first.
7. **Consolidate the dual reviewer-count model (#11).** Make the lifecycle
   ledger the source of truth; retire the 5-slot count as a display artifact
   (`.claude-memory/project-reviewer-count-invariant.md`).
8. **Coverage-tool / TypeScript-adoption decision (#7).** Decide the structural
   lever (`docs/TYPESCRIPT_OPTION_ASSESSMENT.md`, `INVARIANT_MAP_ORCHESTRATION_BRIEF.md`)
   that would stop the "each round a one-line miss that aggregates" pattern
   (`docs/CLAUDE_COVERAGE_LESSONS.md`). Likely informed by the Fable meta-review.
9. **Close the DAL tail (watch, not redesign).** Finish "site 33"
   (`NOTIFICATION_TRUST_MODEL_PLAN.md`); note that enforcement flips keep
   uncovering latent defects, so treat each flip as a probe point.
10. **Lessons-learned note:** why services reach 1,700–2,300 lines before
    decomposition (a paragraph in the decomposition playbook, not a build).

### Meta (highest leverage — the Fable review scopes this)

The cheapest durable win across ALL of the above is preventing the *class*:
an eval-first discipline for identity-like logic, converting load-bearing prose
invariants into gates, and the carryover-freshness gate (#1 above). This is the
subject of `docs/WHACK_A_MOLE_META_REVIEW_FABLE_PROMPT.md` — run that FIRST; it
may reprioritize the backlog and propose better framings than the point-fixes
listed here.

## Sources

Full evidence with per-claim citations is in the three agent reports (S349
research fan-out). Primary anchors: `docs/audits/reviewer-holistic-review-fable-2026-07-08.md`
(§2, §4.1, §5, §6); `docs/REVIEWER_FINDER_RESCUE_DOSSIER.md`;
`docs/agent-wiki/topics/{reviewer-identity,reviewer-workbench-lifecycle,reviewer-origination}.md`;
`DEVELOPMENT_LOG.md`; and the `.claude-memory/` files cited inline above.
