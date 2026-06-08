# Session 234 Prompt: Reviewer disambiguation — in-browser eyeball + next Track-B slices

## Session 233 Summary

Started from a user report that reviewer search for request 1002794 (attosecond physics) was
surfacing wrongly-identified / inactive candidates. A live trace (`scripts/trace-reviewer-provenance.mjs`)
revealed the ORCID spine was abstaining on **all 12 Track-A suggestions (0 selectable)** —
including Ursula Keller, who invented the attoclock the proposal is about — so the only selectable
candidates were unverified Track-B (arxiv) authors with wrong-namesake contacts (Smirnova→ITMO,
Chen→gmail). Root-caused, fixed Track A, then designed + shipped Track-B identity (Fix C) via the
Codex loop. Two commits, build + 2110 tests + full gate set green. **Committed, NOT pushed at the
time of writing this prompt** (push happens in this /stop).

### What Was Completed

1. **Track-A spine recovery (Fixes 1/2/A/B).**
   - **Honorific stripping** before OpenAlex/ORCID search (`openalex-service`, `orcid-service`,
     `contact-parser.stripHonorifics` now loops for "Prof. Dr."). "Prof. Ursula Keller" was
     returning the wrong namesake / 0 hits → spine abstained on every titled name.
   - **Topic-score threshold scale-robust**: live OpenAlex `x_concepts[].score` is a 0–1 float;
     the prior `>25` (0–100) filter killed topic matching entirely. Detects scale per record.
   - **Cross-field guard** (`isCrossFieldDiscoveredContamination`) drops bioRxiv-only authors on
     clearly non-biomedical proposals (reads post-dedup `sources[]`).
   - **Honorific-robust `areNamesSimilar`** + restored verified-name dedup → a verified reviewer
     is no longer duplicated by a Track-B literature find.
   - Result on 1002794: **Track-A 0 → 9 selectable**; Keller & Sang `confirmed` proposal-named.

2. **Track-B identity (Fix C — `docs/REVIEWER_TRACK_B_IDENTITY_SPEC.md`).**
   - NEW `lib/services/reviewer-work-author-resolver.js`: resolve the surfacing work in OpenAlex
     (DOI → PMID → arxiv-DOI → title-search; `ids.arxiv` filter probed and confirmed NOT valid →
     uses `10.48550/arXiv.<id>`), match the author in its byline → authorship-grounded ORCID.
     Abstains to needs-review on ambiguity/collision/outage (fail-open).
   - `authorship_grounded` resolver rule; Track-B run through it after dedup, **capped to top-25**
     by relevance (deferred count logged).
   - **ORCID-gated merge**: a discovered author merges into a needs-review proposal-named twin ONLY
     on shared ORCID; upgraded rows move to the **selectable** bucket. No bare-name merges.
   - **Enrichment anchoring** (`contact-enrichment-service` Tier 2): when a candidate carries a
     resolved ORCID, fetch by `getProfile(orcid)` instead of name-searching; Tier 3/4 reject
     contacts that contradict the anchor. **This is the actual wrong-email fix** — the real Olga
     Smirnova now resolves with her correct ORCID, so no ITMO namesake email.

3. **Codex loop + a process lesson.** Codex implemented Fix C and reviewed both directions. It ran
   in an **isolated git worktree off clean HEAD**, so it never saw this session's uncommitted fixes
   and built on a divergent base (re-derived some, missed others, deleted the verified-name dedup).
   Claude reviewed Codex's output (found 2 regressions + a goal-defeating merge-bucket bug + a
   title over-abstention), then **hand-reconciled** both change sets. Lesson saved:
   [[feedback-commit-before-delegating-to-worktree-agent]] — commit/patch before delegating.

### Commits
- `86b8dd4` feat(reviewer): Track-B identity spine + honorific/topic-scale fixes (S233)
- `7df182f` docs(memory): commit/patch before delegating to worktree-isolated Codex

## Potential Next Steps

### 1. In-browser eyeball of 1002794 (the one human-only check)
Run the physics request with **PubMed deselected** + Microsoft sign-in (`.env.local` Azure auth;
`npm run dev`). Confirm the 9 recovered Track-A reviewers render **selectable** with identity notes,
the Track-B `confirmed` authors (e.g. Smirnova, Kheifets) show with correct ORCID/affiliation, and
abstainers (Lu) sit in "Needs identity review". Tests + trace can't cover the rendered UI.
Note: proposal-named Smirnova also appears in needs-review (no ORCID there → §8 correctly won't
merge); confirm the duplicate reads acceptably or decide whether to suppress the redundant row.

### 2. Cross-field guard: source-level → per-candidate topic-level
Fix B currently drops bioRxiv-ONLY authors by source. The work-resolver now yields per-candidate
topics — upgrade the guard to a topic match against the proposal area (catches cross-field PubMed
authors too, not just bioRxiv). Labeled out-of-scope in the spec §11.

### 3. Biomedical / PubMed-ON spine slice
Track-A spine + Track-B resolver are non-biomedical-leaning. Extend ORCID/OpenAlex corroboration to
the PubMed-ON path; keep §5.1 fix-10 as backstop until a stratum-3 shadow-run clears it.

### 4. Cited-reference lane (plan §4.5 / §7 step 5)
Still open from S232/S233. Primary candidate origin for question-driven proposals; prereq is the
hypothesis-builder adapter.

### 5. Manual reviewer add (`docs/REVIEWER_MANUAL_ADD_DESIGN.md`)
Phase 1 (new route + UI) independent and shippable. Phase 2 (generalize `enrich-recommended`) must
wait — it collides with the spine/enrichment changes just landed.

### Housekeeping
- The Codex worktree `~/.codex/worktrees/63e5/WMKF_Apps` still holds the pre-reconcile copy
  (gitignored, harmless) — remove if you want a clean `git worktree list`.

## Standing context / guardrails
- **`main` auto-deploys to prod on push. Commit/push only when asked. Stage by explicit path
  (not `-A`).** `npm run build` green before pushing — **Codex CANNOT run `npm run build`**
  (Turbopack hangs in its sandbox) and `npx jest` may EPERM there too; run build + jest yourself.
- **Delegating to Codex/app = isolated git worktree.** Commit or hand a patch first — uncommitted
  edits don't travel ([[feedback-commit-before-delegating-to-worktree-agent]]).
- **`ORCID_CLIENT_ID/SECRET`** load-bearing for the spine + Track-B + enrichment anchoring.
  **`OPENALEX_POLITE_MAILTO`** = non-sensitive Vercel env var; never a literal in source.
- Keep the Codex loop: spec → Codex review → Codex build → Claude review (build + tests + **live
  smoke/trace** + diff) → reconcile → merge.
- Probe scripts: `node --import ./scripts/lib/use-extensionless.mjs <script>`; Dataverse needs
  `enterDynamicsBypassForScript(label)`.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/REVIEWER_TRACK_B_IDENTITY_SPEC.md` | Fix C design (work→author, merge gate, anchoring). |
| `docs/REVIEWER_ORCID_SPINE_SPEC.md` | Track-A spine design. |
| `lib/services/reviewer-work-author-resolver.js` | Track-B work→author identity resolver (shipped). |
| `lib/services/openalex-service.js` | Author + work lookups; honorific strip; scale-robust topics. |
| `lib/services/discovery-service.js` | Tracks A/B, dedup, cross-field guard, Track-B identity + merge. |
| `lib/services/contact-enrichment-service.js` | Tiered contact lookup + ORCID anchoring (Tier 2/3/4). |
| `scripts/trace-reviewer-provenance.mjs` | Per-candidate track/provenance/disposition trace (reusable). |
| `scripts/eval-orcid-spine-constrained.mjs` | Spine shadow-run harness. |

## Testing

```bash
npx jest reviewer discovery analyze pubmed verification provenance contact orcid identity openalex dedup track-b work-author
npm run build
node --import ./scripts/lib/use-extensionless.mjs scripts/trace-reviewer-provenance.mjs --request 1002794
# full startup gate set: see .claude/skills/start
```
