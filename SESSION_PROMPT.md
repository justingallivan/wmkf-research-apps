# Session 401 Prompt: Reviewer workflow product fixes (post-S400 queue)

> **Handoff, 2026-08-04 (Session 400).** Production is healthy and carries the
> S400 identity-verdict overhaul (merged `5e7379a1`, smoke-verified same day).
> The S399 enrichment identity-verdict investigation is CLOSED with production
> operand evidence; the warm-incident residual-data damage was found and
> resolved. Three new product findings from the owner's evening usage are the
> primary queue. Run `/start` first.

## Session 400 Summary

Full arc: two red gates fixed → identity-verdict attribution closed via
temporary production operand trace (Codex-verified) → fix branch built,
adversarially reviewed (one HIGH found and remediated by reduction), merged,
deployed, smoke-verified → warm-incident residual data damage discovered,
bounded, and resolved via fresh search → three new product findings triaged
with code-level evidence.

### What Was Completed

1. **Identity-verdict attribution CLOSED (evidence-first).** Local probes +
   one owner-triggered production run with a temporary `[verdict-trace]`
   (added `1a3c34ec`, removed byte-exact `7ed02548`) captured all five
   compared operand pairs on request 1002903. Verdicts were genuine checker
   `false` returns on raw PubMed byline evidence vs clean listed institutions
   — resolver abstained (OpenAlex healthy), no throw, no cache replay, no
   legacy carry-over. 4 of 5 are byline false mismatches; the 5th (Yubin
   Zhou: Northwestern byline vs listed Texas A&M) is likely a correct flag
   (namesake bleed, 50% verification confidence). Codex independently
   verified. Evidence: `outputs/s400-institution-checker-probe-findings.md`
   + `outputs/s400-verdict-trace-capture-2026-08-04.log` (gitignored).
2. **Verdict overhaul SHIPPED to production (merge `5e7379a1`).** Honest
   verdict copy with contradiction provenance (`compared`/`comparison_error`/
   `prior_flag`; a decided contradiction names both compared strings; an
   error never reads as a mismatch claim); permanent compact
   `[institution-verdict]` log per candidate; success-path DTO writes the
   reconciled verdict; banner attributes applicant-listed institutions to the
   applicant + no fabricated "PubMed shows"; applicant-enrichment cache v4
   (pre-fix rows re-enrich once). Review chain: author adversarial pass →
   Codex adversarial review (REQUEST CHANGES: HIGH — the borrowed
   `normalizeAffiliationForComparison` aggregation-key extractor collapses
   comma-qualified sibling institutions into false CONSISTENTs at a Dataverse
   write gate) → increment A REVERTED (`b5b5fe08`), copy nits fixed → Codex
   re-review (needs-attention; finding 2 fixed = cache bump `50ed9469`,
   finding 1 recorded as follow-up) → merged, smoke green (five
   `[institution-verdict]` lines in prod logs, zero errors). Branch deleted.
3. **Warm-incident residual data damage found + resolved.** Owner noticed
   Shapiro's missing coauthor-COI flag; probes bounded the damage to exactly
   10 rows on request 1002903 (warm stage-plan keys +
   `coauthorCheckStatus: "not_applicable"` + zeroed COI; three complement
   checks confirmed no other request affected). One owner-triggered fresh
   Find search replaced the rows; Shapiro + 6 others flag again. Recorded in
   `docs/REVIEWER_FIND_WARM_RECONCILIATION_INCIDENT_2026-08-03.md` §"S400
   addendum" with the revert-checklist lesson.
4. **Codex research docs cherry-picked to main** (`97e433bc`, authored in the
   owner's exploration worktree): reviewer identity/institution-resolution
   research + strategy evaluation.
5. **Three new product findings triaged with code evidence** (see Verified
   Open below): re-discovery vs engagement reconciliation, post-send refresh
   bug, unverified-card rescue dead end.

### Commits (session, chronological)
- `97bc5005` docs: fix red drain-table and harness-framing gates
- `1a3c34ec` chore: TEMP S400 verdict-operand trace
- `01c12ee9` docs: SESSION_PROMPT line-shift marker
- `7ed02548` chore: remove S400 verdict trace (attribution closed)
- branch `fix/enrichment-identity-verdict` (11 commits, merged `5e7379a1`,
  deleted): increments A–E + A revert + copy fixes + cache bump + docs pass
- `5a733032` / `d39a01c7` docs: containment-first follow-up design
- `97e433bc` docs: reviewer identity resolution research (cherry-pick)
- (this handoff commit) docs: incident addendum + Session 401 prompt

## Next Items

### Verified Open (owner-prioritized, from S400 evening usage)

1. **Re-discovery vs engagement reconciliation (owner proposal, agreed).**
   Evidence: Kwong invite confusion 2026-08-04 — a fresh search re-surfaces
   already-invited/declined people as fully invitable cards; the invite panel
   then splits the selection ("Send invitation (2)" + "release 1") with no
   explanation, and `send-emails-service.js:494` server-guards duplicates
   (`already_invited`). Design sketch: at the post-search roster merge,
   project engagement (`reviewerEngagementProjection`) onto re-discovered
   matches and render a collapsed "re-discovered — already invited (pending)"
   card class. Tier 1–2, branch.
2. **Post-send refresh bug (client-only, class confirmed).** Evidence: after
   send, invited candidates still showed invitable; a page reload showed all
   promoted reviewers correctly in the Invite tab (server stamps landed).
   `afterSent` → `onRefresh` → `refreshAll` is wired
   (`ReviewerInvitePanel.js:333`, `ReviewersTab.js:432`) — suspect onSent
   timing vs SSE `complete` / refetch race. Tier 1–2, small.
3. **Unverified-suggestion cards have no rescue affordance.** Evidence:
   request 1003046, Yamuna Krishnan — the "Unverified suggestions" section
   renders `CandidateCard readOnly` with NO handlers
   (`ReviewerSearchSection.js:2927`), while the identity-review section wires
   the confirm-identity escape hatch (`:2811`, gated by
   `canConfirmForPromotion`). Fix: plumb the same confirm + exclude
   affordances into the unverified render site (modal + server path already
   exist; keep bibliometrics dropped server-side on manual confirm). Tier
   1–2.
4. **Comparison fix (containment-first) + structured verdict DTO.** Evidence:
   directive §S399 addendum per-finding status; acceptance tests pinned in
   `tests/unit/enrich-recommended-institution-evidence.test.js` (four
   captured pairs flip to true, all eight sibling attacks stay false).
   Candidate 1: word-boundary containment (covers 4/4 captured rows,
   probe-verified; West Texas A&M is its pinned adversarial case); fallback:
   conservative segment-whole extractor. Ships WITH the structured verdict
   `{status, source}` through DTO→roster→card (Codex re-review finding 1: the
   banner boolean can't distinguish comparison error from contradiction).
   NEVER reuse a lossy aggregation-key extractor at this seam (S400 HIGH).

### Verified Open (carried)

1. **S399 finding 4 — silent no-op invite button** (directive addendum:
   OPEN). Not addressed by the S400 branch.
2. **Blob-cache hazard watch (passive).**

### Owner Decision Needed (carried)

1. **postcss moderate advisory** (Dependabot 62) — likely needs a `next`
   upgrade; tier deliberately if approved.
2. **Increment E — ProfileProvider double-fetch**
   (`shared/context/ProfileContext.js:456-489`). [ASSUMED ~0.5–1s tail].
3. **Latency secondary candidates from D0** (only if owner wants more).
4. **Columbia enrichment contaminant**: S400 capture showed
   "EKA University of Applied Sciences" in Konofagou's resolvedInstitutions —
   unexplained; worth a look at orcid/openAlexAffiliation sources if identity
   work continues.

### Parked (carried)

1. **Candidate B (exclusion-parse cache)** — largely obsoleted if structured
   intake ships.
2. **Excluded-reviewers intake Phases A/B** — awaiting Justin×Connor
   reconciliation (`docs/EXCLUDED_REVIEWERS_STRUCTURED_INTAKE_PLAN.md` §6).

### Verify Before Acting

1. **Any comparison-fix work**: read the directive §S399 addendum status
   block + the wiki workbench topic hazard first; the fail-closed posture is
   deliberate (`project-reviewer-verify-fail-dangerous`); false negatives
   tolerable at this seam, false positives are not (Dataverse write gate).
2. **Claim-evidence pilot**: the S400 `/stop` report returned "local state
   could not be read" — no observation row was added; check whether the
   pilot state issue recurs.

### Do Not Reopen Without New Decision

1. Reverted warm-reconciliation range `5b6757df..7072d52a` — never
   merge/cherry-pick. Residual-data coda now in the incident doc.
2. The reverted byline-core fallback (`e2342f92`, reverted `b5b5fe08`) — do
   not restore; the containment-first follow-up supersedes it.
3. Request `1002903` mutation work — read-only absent new exact owner
   authorization (page views + owner-triggered enrichment/search/invite runs
   are fine — S397–400 protocol).

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/REVIEWER_WORKFLOW_STABILIZATION_DIRECTIVE.md` §S399 addendum | Per-finding status + containment-first follow-up spec |
| `tests/unit/enrich-recommended-institution-evidence.test.js` | Pinned acceptance spec + sibling attacks for the comparison fix |
| `lib/services/workbench/enrich-recommended-service.js` | Verdict seam (provenance, log, DTO) — post-merge shape |
| `shared/components/reviewers/ReviewerInvitePanel.js:305-333` | Invite/pending split, afterSent refresh |
| `lib/services/review-manager/send-emails-service.js:490-495` | already_invited duplicate guard |
| `shared/components/reviewers/ReviewerSearchSection.js:2779-2811,2927` | Rescue affordance gating vs unverified dead end |
| `docs/REVIEWER_FIND_WARM_RECONCILIATION_INCIDENT_2026-08-03.md` §S400 addendum | Residual-data finding + revert-checklist lesson |
| `docs/REVIEWER_IDENTITY_AND_INSTITUTION_RESOLUTION_RESEARCH.md` | Codex research (docs-only; nothing implemented) |
| `outputs/s400-*` (gitignored) | Probe findings + verbatim production operand capture |

## Testing

```bash
npm run check:types
npx jest --testPathPatterns "enrich-recommended|mismatch-banner|reviewer-search-logic"
npx jest                                # full suite, 6,820
```
