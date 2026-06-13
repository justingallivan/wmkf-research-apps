# Session 250 Prompt: direction-independent reviewer-finder — 3 of 4 shipped (recall 12→15, identity rescue, referral capture); SerpAPI→free-stack is the carryover

> **GIT.** All S249 work is on `main`, pushed (`b65196c..cb0dee8`, 6 commits).
> Working tree clean at handoff.

## Session 249 — what happened

Worked **item 2 from the S248 next-steps** ("direction-independent reviewer-finder
ships — the experiment says invest HERE"). Justin picked **all four** sub-workstreams,
**depth-first**. Shipped **3 of 4**, each committed, tested, gates-green, and (for the
two safety-critical ones) **Codex-reviewed to convergence**. SerpAPI→free-stack is the
clean carryover.

### What was completed

1. **Recall sampling 12→15 — SHIPPED (`b65196c`).** The recall lever per the D26
   flowchart §2: a single deeper draw (Claude is consistent at temp 0.3, so extra draws
   are wasted). Introduced **one** `DEFAULT_REVIEWER_COUNT` constant in
   `shared/config/reviewerFinderPreferences.js`, replacing **10 scattered `12` literals**
   (prompt module, composer, service, analyze route, both UI sliders). Default-contract
   tests added; D26 flowchart + agent-wiki + S244 evidence-doc §6 reconciled.
   - ⚠ **One open item:** the **padding-ceiling live check** — confirm on a real D26
     proposal that count=15 returns *real* names, not fabricated padding (S231 saw 1003063
     pad to 17). The downstream gates (placeholder/forename/identity) catch padding, so 15
     is safe to ship; the live check is the **prerequisite before raising the default
     above 15** (flagged in flowchart §2). Needs API key + a real proposal.

2. **Identity work-grounding rescue — SHIPPED + Codex-reviewed (`6e5146e`, fix `f026fba`).**
   The corrected-posture weak link. Field-aware *ranking* was already shipped (S236); the
   remaining loss was the **abstain** of a correct low-footprint researcher whose coarse
   OpenAlex `x_concepts` miss the field text + Claude gave no institution.
   `rescueByWorkGrounding` (`reviewer-identity-evidence.js`) re-tests her actual recent
   **work titles** (`getWorksByAuthor`), forename-gated, with her **own ORCID works list**
   (new `ORCIDService.getWorks`) as a merge-immune veto/corroborator. **Purely additive**
   (only rescues prior abstains), `probable` ceiling, exactly-one-or-abstain. Codex caught
   2 real bugs (collision-blind-spot-past-the-cap HIGH; single-generic-token MEDIUM) —
   both fixed + regression-tested.

3. **Referral capture — SHIPPED (full incl. UI) + Codex-reviewed (`7b5f5f6`, fix `b09c698`, docs `cb0dee8`).**
   "Add or Refer a Reviewer". The hard part (free-text→identity, abstain-or-confirm) was
   already built in the S236 manual-add path; referral capture is a thin layer: a new
   `referred` provenance kind (grounded-rank bonus + selectable-with-verify like
   `proposal_named`), `referredBy` stored in the durable match reason (no new Dataverse
   field) **and** as a `referred` `wmkf_sources` token so it survives a `my-candidates`
   reload, + a "Referred by" field on the manual-add card. Codex caught the **durability
   HIGH** (referral degraded to `staff_manual` on reload) — fixed in both the persist
   (`ensureStaffManualCandidate` `sources` param) and reconstruct (`my-candidates` parses
   the referrer back) halves. Design: `docs/REVIEWER_FINDER_REFERRAL_CAPTURE_DESIGN.md`.

### Commits (6)
`b65196c` recall 12→15 · `6e5146e` identity rescue · `f026fba` rescue Codex fixes ·
`7b5f5f6` referral capture · `b09c698` referral Codex/durability fixes ·
`cb0dee8` referral docs reconcile.

## Potential Next Steps

### 1. SerpAPI → free-stack migration (#4 — the carryover, not started)
The remaining item-2 workstream. $150/mo, the largest single expense; value eroded.
Per memory `project-serpapi-capability-erosion` ~4 of 6 uses are replaceable by free
alternatives. **Scope it first** (read `project-serpapi-budget-latency` +
`project-serpapi-capability-erosion` + the 6 enrichment use-sites in
`lib/services/contact-enrichment-service.js`) — which uses move to which free source,
in what order, and the latency impact — before touching code. A real migration; worth
its own focused session.

### 2. Smaller follow-ups from the shipped work
- **Recall:** run the padding-ceiling live check (above) before raising count >15.
- **Identity:** the deeper **ORCID-works-anchored origination corpus** (resolve ORCID-work
  DOIs → OpenAlex for co-authors/aggregation) — the larger increment beyond the rescue.
- **Referral:** no `my-candidates` endpoint test file exists; the referrer-reconstruction
  regex is covered only indirectly (provenance re-derivation test). Optional: add a
  `my-candidates` test that asserts a `referred`-sourced row reconstructs `referredBy`.

### 3. Carryover (verify-before-acting — unchanged from S248)
- Reviewer COI **Chunk 2b** (retire `POTENTIAL_CONCERNS`) — ⚠ destructive, deferred.
- Trim the analyze prompt's dead Stage-1 `searchQueries` (Track B is off).

## Key Files Reference

| File | Purpose |
|------|---------|
| `shared/config/reviewerFinderPreferences.js` | `DEFAULT_REVIEWER_COUNT = 15` (single source of truth) |
| `lib/services/reviewer-identity-evidence.js` | `rescueByWorkGrounding` + `fetchOrcidWorks` (identity rescue) |
| `lib/services/orcid-service.js` | new `getWorks(orcid)` — ORCID self-asserted works titles |
| `lib/utils/reviewer-provenance.js` | `REFERRED` kind (grounded-rank + exempt-selectable) |
| `pages/api/workbench/manual-reviewer.js` | `referredBy` → match reason + `referred` source token |
| `pages/api/reviewer-finder/my-candidates.js` | reconstructs `referredBy` from the match reason on reload |
| `docs/REVIEWER_FINDER_D26_PIPELINE_FLOWCHART.md` | canonical pipeline picture (RS/IDFIX/REF status updated) |
| `docs/REVIEWER_FINDER_REFERRAL_CAPTURE_DESIGN.md` | referral design + decisions (D1–D5) |

## Gotchas
- **`grep`/`rg` output is corrupting identifiers + digits** this session (e.g.
  `provenanceGroupOf`→`n`, `manualAdded`→`ned`, `:126`→`:n6`). Use the **Read tool** for
  file *content* and exact line numbers; trust grep only for *which files* match. See
  `project-rtk-grep-output-corruption`.
- **`temperature` is rejected by opus-tier 4.7/4.8 + Fable 5** (400) — removed along with
  `top_p`/`top_k`; steer via `output_config.effort`. Reviewer-finder runs on the **sonnet**
  tier (Sonnet 4.6, accepts temperature), so its "reviewer diversity" slider **is live**.
  It would only break if `CLAUDE_MODEL_REVIEWER_FINDER` were set to an opus-4.7+/Fable id
  (a guard worth adding if reviewer-finder ever moves to opus).
- **Referral durability:** the `referred` kind survives reload only because BOTH halves
  are in place — `wmkf_sources` carries `referred` AND `my-candidates` parses the
  "Referred by {name}." match-reason prefix. Don't remove either half.
- **Identity rescue is `probable`-ceiling + forename-gated by design** — a rescued match
  is selectable-with-verify (Slice-G invite gate), never auto-trusted. Don't "upgrade" it
  to confirmed without independent ORCID-employment corroboration.
- Reviewer-finder is currently access-locked to Justin only.
