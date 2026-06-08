# Session 233 Prompt: Reviewer identity spine — next slices (selectable proposal-named, biomedical path, stratum-3 shadow-run)

## Session 232 Summary

Started by validating the S229/S231 work, hit a **production incident** (a Frankenstein
reviewer on request 1002794), and that drove the whole session: a candidate-wire-shape
migration, an incident hardening pass, and the first slice of the OpenAlex+ORCID identity
spine. Five commits, all pushed; build + 498 reviewer/identity tests + gates green throughout.
Codex built each slice; Claude reviewed and caught a live-only bug + a fabricated email.

### What Was Completed

1. **Provenance-DTO migration (`9882eec`).** `provenance.{kind,sources,seedRole,groundingWorkIds}`
   across `/discover`, roster (`reviewer-roster-store`), save, and the Workbench UI. The axis is
   groundedness, not "did Claude touch it." "Claude-suggested" is no longer a category — a verified
   Claude suggestion is `literature_retrieved`; an unverified one is `barred_parametric`. The 25-pt
   ranking bonus re-scoped to `cited_reference`/`proposal_named` only → verified-Claude candidates
   drop exactly 30 pts (measured), **ordering preserved** (uniform shift). See
   `docs/REVIEWER_PROVENANCE_MODEL.md`.

2. **§5.1 namesake-laundering + ungated-contact hardening (`53206b7`).** The 1002794 "Robert Sang"
   case: a Claude-suggested attosecond physicist PubMed-matched to an unrelated Kenyan entomologist,
   given that wrong affiliation + an unrelated LinkedIn. Fixes: Track-A PubMed verification now
   **honors the source toggle** (the user deselected PubMed; it was ignored); **profile/website-URL
   name-gate** (`contact-parser.isUsefulWebsiteUrl(url, name)`); `proposal_named` source preserved;
   coarse cross-field namesake guard; verification-incoherence −15 ranking down-weight. Also gated the
   applicant-recommended path (`enrich-recommended`).

3. **OpenAlex+ORCID identity spine — first slice (`0ac4728`, `60e0ef2`).** Constrained-select-or-abstain
   verifier on the **PubMed-skip path only**. NEW `lib/services/openalex-service.js` (author search,
   safeFetch, env-only polite-pool `OPENALEX_POLITE_MAILTO`) + NEW `lib/services/reviewer-identity-evidence.js`
   (top-N → affiliation/topic select or abstain; ORCID-employment corroboration; source-outage → abstain)
   + resolver anchor rules (`confirmed` = strong-aff + ORCID-employment + topic; `probable` requires
   affiliation; topic-only → unresolved). `confirmed`/`probable` → `verified[]` (selectable, ORCID
   attached); `ambiguous`/abstain → `unverified[]` needs-review. **Plain-language identity note** on each
   card (what corroborated, why not confirmed). Shadow-eval: confident-wrong **29%→0** (Robert Sang
   recovers to the real Griffith physicist; namesakes/fabrications abstain). Spec: `docs/REVIEWER_ORCID_SPINE_SPEC.md`.

4. **Review catches (the value of the loop).** Claude caught a **live-only bug** Codex shipped: OpenAlex
   `last_known_institution` (singular) is deprecated → live API returns `last_known_institutions` (plural),
   so every record had a null institution → spine over-abstained. Tests passed because the fixture used the
   wrong shape. Fixed + corrected fixture + regression test. Also caught a **fabricated polite-pool email**
   (`apps@wmkeck.org`) that shipped to prod (`60e0ef2` made it env-only; lesson in
   `[[feedback-no-fabricated-placeholder-values]]`).

5. **Ops:** cleared the 1002794 Find-roster (non-applicant surfaced candidates) twice via
   `reset-request-reviewers --roster-only --execute`, preserving the 5 applicant-recommended Dataverse rows.

### Commits
- `9882eec` provenance-DTO migration (retrieval-redesign step 1)
- `53206b7` §5.1 namesake-laundering + ungated-contact hardening (fixes 7-11)
- `0ac4728` OpenAlex+ORCID identity spine for Track-A (PubMed-off path)
- `60e0ef2` OpenAlex polite-pool email env-only (drop fabricated default)
- `b00986e` memory: no fabricated placeholder external values (S232 lesson)

## Potential Next Steps

### 1. In-browser eyeball of the spine (the one human-only check left)
Run a physics request (1002794) with **PubMed deselected** + Microsoft sign-in (`.env.local` has Azure
auth; `npm run dev`). Confirm spine-`probable` candidates render **selectable** with the identity note at
the card bottom, and the "Needs identity review" grouping looks right. Tests + smoke can't cover the UI path.

### 2. Make `proposal_named` + `applicant_suggested` SELECTABLE-with-a-flag
The physics flow still strands proposal-named peers (Keller/Smirnova/Sang) as not-selectable when they
don't reach probable. They're grounded by the *proposal*, not PubMed — should be selectable with a
"verify identity before outreach" flag. Discussed S232, NOT built. Also: reword the **hardcoded UI header**
`"PubMed couldn't confirm these"` (`ReviewerSearchSection.js:1060`) to reflect the real reason.

### 3. Spine — biomedical path + stratum-3 shadow-run (before any broader cutover)
The spine is PubMed-off-only. Extend ORCID/OpenAlex cross-source corroboration to the **biomedical/PubMed-ON**
path; run the **stratum-3 shadow-run** (early-career / genuinely-no-ORCID tail, ground-truthed via
cited-reference authorship) — that tail is untested. Keep §5.1 fix-10 as backstop until cleared.
Consider whether strong-affiliation + ORCID-employment alone should reach `confirmed` (OpenAlex `x_concepts`
is often empty → many right-person matches land `probable`, not `confirmed`; both selectable).

### 4. Cited-reference lane (plan §4.5 / §7 step 5) — the next big retrieval slice
Primary candidate origin for question-driven proposals. Prereq: hypothesis-builder adapter (§7 step 4).

### 5. Manual reviewer add (`docs/REVIEWER_MANUAL_ADD_DESIGN.md` — reviewed, approved direction)
Phase 1 (new `manual-reviewer` route + UI) is independent and shippable. **Phase 2 (generalize
`enrich-recommended`) must wait** — it collides with the in-flight spine changes to `verifyClaudeSuggestions`.
Fully spec the `STAFF_MANUAL` provenance-kind touch-points (group + ranking-bonus decision) before building.

## Standing context / guardrails
- **`main` auto-deploys to prod on push. Commit/push only when asked.** Stage by explicit path (not `-A`).
  `npm run build` green before pushing — **but Codex CANNOT run `npm run build`** (Turbopack hangs in its
  sandbox); brief Codex with `node -c` + `jest` only and run the production build yourself locally.
- **`ORCID_CLIENT_ID/SECRET` are load-bearing for the spine** (employment corroboration → probable/confirmed).
  Present in `.env.local` + Vercel. Absent → spine fails safe to needs-review (logs a one-time warning).
- **`OPENALEX_POLITE_MAILTO`** = `alerts@wmkeck.org`, set as a non-sensitive Vercel env var; no email literal
  in source. Unset (local) → common pool.
- Codex review loop caught real defects again (a live-only bug + a fabricated email). Keep the loop:
  spec → Codex review → Codex build → Claude review (build + tests + **live smoke** + diff) → merge.
- Probe scripts: `node --import ./scripts/lib/use-extensionless.mjs <script>`; Dataverse needs
  `enterDynamicsBypassForScript(label)`.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/REVIEWER_ORCID_SPINE_SPEC.md` | The spine design (read first for §3 work). |
| `docs/REVIEWER_PROVENANCE_MODEL.md` | What "Claude-suggested" means now; the provenance DTO. |
| `docs/REVIEWER_FINDER_RETRIEVAL_REDESIGN_PLAN.md` | The whole redesign; §4.5 cited-ref lane, §5.1 case, §7 sequencing. |
| `lib/services/reviewer-identity-evidence.js` | Constrained-select-or-abstain spine adapter (shipped). |
| `lib/services/openalex-service.js` | OpenAlex author search (shipped). |
| `lib/services/reviewer-identity-resolver.js` | Pure classifier + new spine anchor rules (shipped). |
| `scripts/eval-orcid-spine-constrained.mjs` | Shadow-run harness (extend for stratum-3). |
| `scripts/reset-request-reviewers.mjs` | Per-request reviewer-state reset (`--roster-only` = clear non-applicant surfaced). |
| `docs/REVIEWER_MANUAL_ADD_DESIGN.md` | Manual-add feature design (reviewed; build Phase 1). |

## Testing

```bash
npx jest reviewer discovery analyze pubmed verification provenance contact orcid identity openalex
node --import ./scripts/lib/use-extensionless.mjs scripts/eval-orcid-spine-constrained.mjs --requests 1002794,1002896,1002959
# spine live smoke: evaluate a suggestion against real OpenAlex/ORCID (needs .env.local creds)
# full startup gate set: see .claude/skills/start
```
