# Session 405 Prompt: Fuzzy-matching owner answers → benchmark; token-lifecycle redesign queued

> **Handoff, 2026-08-06 (Session 404).** A three-act session: (1) the
> fuzzy-matching reconciliation reached a confirmed Claude×Codex consensus —
> six owner questions now gate the benchmark; (2) an owner-reported production
> bug (invite-preview 503s) was diagnosed as a transient Dataverse blip and
> grew, through four adversarial review rounds, into a shipped hardening of the
> whole invite-email pipeline including send-time token minting; (3) an
> owner-reported UX confusion in the confirm-reviewer modal was fixed. TWO
> production merges (`a9d4e3dd`, `ff06fbb8`), both deployed READY. Full suite
> 6,910 green at handoff. Run `/start` first.

## Session 404 Summary

All 57 `/start` gates were green at start; suite grew 6,860 → 6,910.

### What Was Completed

1. **Fuzzy-matching reconciliation — DONE (was Next Item 1).**
   `outputs/fuzzy-matching-consensus-recommendation-2026-08-06.md` (committed
   `205bba54`): Codex round 1 "CONSENSUS: YES (amended)", round 2 "CONFIRMED".
   Shape: four-decision decomposition (institution/person/affiliation/contact)
   + shared Fellegi–Sunter primitives with decision-specific models and
   fail-closed vetoes; falsification suite (150–300) never calibrates
   production thresholds; institution-first. **Six owner questions pend in its
   §4** (precision floor, review capacity, ROR namespace, benchmark
   investment, affiliation representation, contact-attribution semantics).
   Note: requested Codex model `sol-5.6` was rejected by the account; both
   rounds ran on the CLI default model.
2. **Invite-preview 503 incident (owner's boss, Request #1003000) — RESOLVED.**
   Diagnosis: `requireAppAccess`'s fail-closed 503 when its Dataverse
   app-grant lookup throws (superusers bypass it — why Justin never saw it).
   Prod probe was clean; her retry later succeeded → transient blip, closed.
3. **Invite pipeline hardening shipped (merge `a9d4e3dd`, deployed READY).**
   Eight commits on `fix/invite-preview-error-retry`: preview-failure banners
   with ↻ Retry in BOTH email modals (`shared/components/reviewers/
   render-preview-failure.js` shared wording, "No emails have been sent —
   retrying is safe"); owner-VERBATIM 503 copy in `lib/utils/auth.js` ("I'm
   having trouble accessing the server…" — do not wordsmith, see
   `feedback-user-facing-error-copy-voice`); 403 names the app via
   `appDisplayName`; single-flight rendering + modal-session epoch guards;
   **send-time token minting** — previews are read-only (JWT-shaped non-live
   placeholder; `send-emails-service.js` verifies any real legacy/edited JWT
   then mints/substitutes the authoritative token as the last await before
   dispatch); 45s AbortController render timeout so a hung fetch can't wedge
   the modal. Process: plan v1→v4 with four `/codex:adversarial-review`
   rounds; full record in `outputs/plan-manage-panel-preview-retry-2026-08-06.md`.
4. **Confirm-reviewer modal coherence (merge `ff06fbb8`, deployed READY).**
   Owner report: twin "I verified…" checkboxes, ORCID engineer-speak, twin URL
   fields. Fixed in `CandidateEditModal`: "Email address" / "Right person?"
   headers, plain ORCID-drop explanation, Evidence-link↔Website cross-fill.
   Verdicts and stored URLs stay separate by design (identity ≠ contact
   attribution). Owner decision: research-only manual-copy link stays degraded
   fail-closed ("send from own mailbox" NOT a priority).
5. **Memory/wiki:** new `feedback-user-facing-error-copy-voice` (3 rounds of
   copy correction distilled); big S404 block in
   `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md`; consensus status
   reconciled into `strategy-roadmap.md` and
   `project-reviewer-card-simplification-direction`.

### Commits (chronological)
`205bba54` consensus doc · `bc03c688` parking · `b0948437` Retry banner ·
`482dfd3c`/`ad0ba71a`/`aae3a09e`/`23f15e1d` 503/403 copy iterations ·
`302bb785` plan v3 build · `d040a7a3` send-time mint (v4) · `a836f4d4`
adjudication · `8b66beb3` render abort · `a9d4e3dd` MERGE 1 · `ffd19eca`
modal coherence · `ff06fbb8` MERGE 2 · `b5aaa5e2` stale-quote reconcile.

## Next Items

### Owner Decision Needed (gates the reviewer roadmap)

1. ~~**Answer the six fuzzy-matching questions**~~ — **DONE S405
   (2026-08-06)**: all six answered, owner-verbatim record in
   `outputs/fuzzy-matching-owner-answers-2026-08-06.md`. Falsification suite
   approved as next work on this track; representative benchmark parked
   (high-risk automation stays review-only). Benchmark item below is
   unblocked.
2. **postcss moderate advisory** (Dependabot 62; likely needs a `next`
   upgrade). [Carried; still open on the repo's security tab.]
3. **Increment E — ProfileProvider double-fetch**
   (`shared/context/ProfileContext.js:456-489`). [ASSUMED ~0.5–1s tail; carried.]
4. **Columbia enrichment contaminant** ("EKA University of Applied Sciences",
   S400, unexplained). [Carried.]

### Verified Open

1. **Benchmark: adversarial matrix + failure archive — BUILT S405, NOT
   EXECUTED** (owner: "build the falsification suite but don't execute").
   `benchmarks/fuzzy-matching-falsification/`: 166 cases (120 generated UC
   adversarial matrix — full matrix 335 via `--full` — + 46 curated from
   documented failures), schema lint green, jest picks up nothing there.
   `run.js` refuses to run without adapters and is syntax-checked but
   unverified by execution. NOT done: incumbent baseline freeze, comparator
   runs — needs a separate owner go. Two `label_status: assumed` cases need
   owner adjudication (Yubin Zhou namesake; EKA contaminant handling) — see
   the suite README.
2. **Token-lifecycle redesign** (per-suggestion lease/generation OR multiple
   concurrently-valid tokens). Founding requirement = final Codex review
   finding (mint→dispatch non-atomicity) + its test list; owner accepted
   shipping with the residual documented. Evidence:
   `outputs/plan-manage-panel-preview-retry-2026-08-06.md` final adjudication
   entry. Unscheduled — needs its own plan + review when picked up.
3. **S399 finding 4 — silent no-op invite button.** [Carried; VERIFIED still
   open at directive `docs/REVIEWER_WORKFLOW_STABILIZATION_DIRECTIVE.md:404`
   as of S403; not touched this session — the S404 invite-modal work was the
   preview/render path, not this button's no-op.]
4. **Repair-request reason code ambiguity** (`conflictRecordUnavailable` files
   under `address_conflict_pending`). [Carried from S403; small fix, offered
   and not taken up.]
5. **Invite-panel split copy** (small UX polish, optional). [Carried.]
6. **S402 optional hardening** (author-check fail-open corner; co-PI/stored-
   name endpoint paths untested). [Carried, non-blocking.]

### Verify Before Acting

1. **Behavioral validation, owner's next real usage — now TWO unreported
   checks:** (a) post-send rows show Invited with no reload (S401); (b) a
   re-found engaged person collapses into "Already handled" (S401). Check (c)
   — unverified-suggestion confirm affordances (S402) — was EXERCISED tonight
   (the boss used the confirm modal for Yael David/MSKCC and it worked well
   enough to critique its copy); treat (c) as informally validated.
2. **The S404 invite pipeline is freshly deployed.** If invites misbehave this
   week, read `outputs/plan-manage-panel-preview-retry-2026-08-06.md` first —
   especially the deploy-transition note (drafts rendered pre-deploy fail
   `external_link_expectation_missing` until re-previewed) and the accepted
   latest-link-wins residual (do NOT re-report the mint→dispatch window as a
   bug; it's adjudicated).
3. **Any matching/normalizer work**: read
   `feedback-latency-plan-scope-accretion-postmortem` FIRST (S395 shape).
4. **Any comparison-fix work**: directive §S399 addendum + workbench hazard;
   fail-closed posture deliberate (`project-reviewer-verify-fail-dangerous`).

### Parked

1. **Card redesign build** — after owner answers + benchmark
   (`project-reviewer-card-simplification-direction`).
2. **Excluded-reviewers intake Phases A/B** — awaiting Justin×Connor
   reconciliation. [Carried.]
3. **Candidate B (exclusion-parse cache)** — largely obsoleted if structured
   intake ships. [Carried.]

### Do Not Reopen Without New Decision

1. **Mint→dispatch non-atomicity** — owner adjudicated 2026-08-06: ship with
   residual; fix belongs to the token-lifecycle redesign (Verified Open #2).
2. **Research-only manual-copy link** — stays degraded fail-closed; owner:
   "send from own mailbox" not a priority.
3. Merging the two attestation checkboxes or the two URL fields in
   `CandidateEditModal` — verdicts/facts are separate by design (consensus §1).
4. Reverted warm-reconciliation range `5b6757df..7072d52a`; reverted
   byline-core fallback (`e2342f92`); request `1002903` mutation work;
   S400 onSent/SSE race (disproven); selectively-clickable warning badges;
   client-side institution-COI verdicts. [All carried.]

## Key Files Reference

| File | Purpose |
|------|---------|
| `outputs/fuzzy-matching-consensus-recommendation-2026-08-06.md` | Joint consensus; §4 = the six owner questions |
| `outputs/plan-manage-panel-preview-retry-2026-08-06.md` | v1→v4 plan + reviews + final adjudication (token residual) |
| `lib/services/review-manager/send-emails-service.js` | Send-time token authority gate (mint at dispatch) |
| `lib/services/review-manager/render-emails-service.js` | Read-only previews; `externalLinkExpected` stamp |
| `lib/external/token-lifecycle.js` | `SEND_TIME_TOKEN_PLACEHOLDER_JWT`, mintAndStore |
| `lib/utils/auth.js` | Owner-verbatim 503; `appDisplayName` 403 |
| `shared/components/reviewers/render-preview-failure.js` | Shared preview-failure wording (exported strings owner-locked) |
| `shared/components/reviewers/CandidateEditModal.js` | Confirm-reviewer modal (S404 coherence pass) |
| `.claude-memory/feedback-user-facing-error-copy-voice.md` | Error-copy voice lesson (3 owner rounds) |

## Testing

```bash
npm run check:types
npx jest --testPathPatterns "invite-preview|manage-panel-preview|token-authority|candidate-edit-modal"
npx jest                                # full suite, 6,910
```
