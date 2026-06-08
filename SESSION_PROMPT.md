# Session 235 Prompt: Reviewer contact follow-on (Fix E + invite-confidence + faculty-page recovery)

## Session 234 Summary

Started from a user request to clear non-applicant-suggested reviewers from request 1002794, which
surfaced a deeper bug: reviewer **contact enrichment** was attaching WRONG emails/websites/bibliometrics
via namesake collapse (Smirnova → ITMO email; Chen → a *pianist's* gmail + Van Cliburn page) **even
though identity resolution was correct**. Root-caused, designed, Codex-reviewed (×4), implemented,
live-verified, and **shipped to prod** the anchor-or-abstain contact fix. Then drafted + Codex-reviewed the
follow-on plan and built a reusable smoke battery. All merged to `main` and pushed (auto-deployed).

### What Was Completed

1. **Cleared 1002794 roster** via `scripts/reset-request-reviewers.mjs --roster-only` (9 system-discovered
   rows deleted; 5 applicant suggestions + invite slots kept). Memory pointer added so future "clear/reset
   a request's reviewers" tasks use the script, not hand-rolled SQL.

2. **Contact-enrichment anchoring fix (Fixes A–D + Scholar-verified-domain), SHIPPED.** Reframe: identity
   resolution works; **contact/bibliometric enrichment was the namesake-collapse locus** and the wrong
   fields were persisting. Principle adopted: **identity-confirmed ≠ contact-validated; anchor-or-abstain.**
   - **A**: ORCID/effective-institution threaded into Tier-3 Claude, Tier-4 Serp, AND Scholar via a
     search-only candidate clone (input candidate never mutated → S224 invariant preserved).
   - **B (abstain-only)**: no institution anchor + no ORCID → skip bare-name paid lookup; emit no contact;
     `contactStatus:'unresolved'`; identity/relevance preserved.
   - **C**: per-field persist flags (`emailPersistAllowed`/`websitePersistAllowed`/`affiliationPersistAllowed`)
     enforced in BOTH save paths (`save-candidates` + `saveToDatabase`), surviving `pruneCandidateForRoster`.
   - **D**: `buildIdentityNote` surfaces `authorship_grounded`.
   - **Scholar-verified-domain validation** (`_validateEmailAgainstVerifiedDomain`, in `_finalize`):
     REPLACED a brittle lexical institution-NAME guard that was rejecting Smirnova's REAL email
     `olga.smirnova@mbi-berlin.de` (caught only by a LIVE smoke). Now: boundary-anchored domain match vs the
     Scholar-verified domain → confirm; clear contradiction → drop a search-sourced namesake; trusted
     (ORCID/PubMed) emails never dropped; no verified domain → trust the scoped search.
   - **Live-verified**: Smirnova recovers `@mbi-berlin.de`, Chen abstains, Keller (`phys.ethz.ch`) +
     Travers (`hw.ac.uk`) kept. 4 Codex passes → GO.

3. **Follow-on plan (Codex-reviewed)** `docs/REVIEWER_CONTACT_INVITE_FOLLOWON_PLAN.md` — Fix E + invite
   confidence + faculty-page recovery. Codex corrections folded in (see plan §R).

4. **Smoke battery** `scripts/smoke-reviewer-contact-anchoring.mjs` (`npm run smoke:reviewer-contact`):
   offline decision-matrix + abstain (deterministic) and live ORCID/Serp invariants + best-effort recovery.
   24/24 live, 11/11 offline. **Coverage caveat: only request 1002794's candidates (one field, 4 people);
   PubMed-on/biomedical path and other requests NOT exercised.**

### Commits (all on `main`, pushed)
- `77799eb` memory: reset-request-reviewers pointer
- `6e7dcfb` Fixes A–D · `f14ad11` gatech · `da2451e` Scholar-verified-domain · `440bce9` Codex-3 fixes
- `6a4a5f0` memories (contact-anchoring + SerpAPI-budget/latency)
- `569eb91`/`64ed8e5` follow-on plan + Codex corrections · `9396658` merge · `2cae67c` smoke battery
- (design docs: `a08bb18`, `1613027`)

## Potential Next Steps

### 1. Implement the follow-on plan (Codex-reviewed; sequence is in the plan §5)
- **Slice E (do first)** — deferred Track-B candidates must not be silently selectable: stamp
  `identityStatus:'unresolved'` in discovery; client `toggleAll`/save gate by `provenanceGroupOf`; **server
  422** in `save-candidates` (field-nulling alone is insufficient). PRE-FLIGHT: confirm no legit flow saves
  a needs-review candidate before making it a hard 422.
- **Slice G-opt1 + manual-confirm gate** — closes the `my-candidates.js:436` manual-email bypass (send path
  trusts `wmkf_emailaddress`).
- **Slice F (on-demand, hardened)** — faculty-page email recovery; EXTEND `lib/utils/safe-fetch.js` with
  DNS/private-IP (rebind), max-body, content-type, dynamic per-institution allowlist; regex-not-LLM extract.

### 2. Widen smoke coverage (user-deferred from S234)
Build a smoke that runs the actual `discover` pipeline across SEVERAL requests in different fields and
asserts the invariants (no namesake/generic domains, no false-abstains, persist coherence) on whatever
surfaces — catches field/institution shapes the 4 fixtures can't. Include the **PubMed-on/biomedical path**.

### Housekeeping
- Merged branch `reviewer-contact-anchor-fixes` still exists locally (delete if you want).
- Gitignored Codex worktrees under `~/.codex/worktrees/` are harmless.

## Standing context / guardrails
- **`main` auto-deploys to prod on push. Commit/push only when asked. Stage by explicit path.** `npm run
  build` green before pushing — Codex CANNOT run build/jest; run them yourself.
- **Delegating to Codex = isolated git worktree off HEAD → commit first** ([[feedback-commit-before-delegating-to-worktree-agent]]).
- **SerpAPI ~15k/mo — cost is NOT the constraint; LATENCY is** (a PD won't use it if slower than Googling).
  Reuse anchors already fetched; don't add per-candidate round-trips ([[project-serpapi-budget-latency]]).
- Contact principle: **identity-confirmed ≠ contact-validated; anchor-or-abstain** ([[project-reviewer-contact-enrichment-anchoring]]).
- Keep the Codex loop: spec → review → implement → Claude build+jest+**live smoke**+diff → reconcile → merge.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/REVIEWER_CONTACT_INVITE_FOLLOWON_PLAN.md` | Next slice design (Fix E + invite-confidence + faculty-page), Codex-reviewed. |
| `docs/REVIEWER_IDENTITY_CONTACT_FIX_PLAN.md` (+ `_REVIEW`) | The shipped slice's design + Codex review. |
| `lib/services/contact-enrichment-service.js` | Tiers, abstain, `_validateEmailAgainstVerifiedDomain`, persist flags. |
| `pages/api/reviewer-finder/save-candidates.js` | Field-level persist gate (needs Slice E server 422). |
| `lib/utils/safe-fetch.js` | Existing SSRF wrapper to EXTEND for Slice F. |
| `pages/api/review-manager/send-emails.js` | Invite send (reads `wmkf_emailaddress`; no confidence gate). |
| `scripts/smoke-reviewer-contact-anchoring.mjs` | Smoke battery (`npm run smoke:reviewer-contact`). |

## Testing

```bash
npm run smoke:reviewer-contact            # offline + live battery (24/24 live, 11/11 offline)
npm run smoke:reviewer-contact -- --offline   # deterministic only, no creds/network
npx jest contact-enrichment reviewer identity discovery save provenance --runInBand
npm run build
# full startup gate set: see .claude/skills/start
```
