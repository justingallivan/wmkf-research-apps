# Session 249 Prompt: reviewer-finder corrected posture SHIPPED; Field Primer built (v1 + grounded v2); Track B archived

> **GIT.** All S248 work is on `main` and pushed except the final `/sweep` commit `86d58e7`
> (push it first thing if it's still local: `git push origin main`). 13 commits this session
> (`fb61461..86d58e7`).
>
> **NUMBERING NOTE.** This session's artifacts (commits, docs, agent-wiki) are tagged **"S248"**.
> The prompt that started it was titled "Session 247" — a one-off counter bump; treat "S248"
> as *this* session everywhere. (Not worth rewriting the committed docs; flagging so the tag
> reads cleanly.)

## Session 248 — what happened

A long session that (1) reconciled the reviewer-finder **strategic direction**, (2) **built the
Field Primer feature end-to-end** (v1 + grounded v2), (3) **archived Track B**, and (4) ran
**three Codex adversarial passes + a `/sweep`** to harden it all.

### What was completed

1. **Corrected posture for reviewer-finder origination (the framing win).** The S231
   retrieval-first redesign **overcorrected**: it conflated a real verify-path bug (forename
   hallucination laundering — since fixed) with an unmeasured "replace Claude as generator"
   theory. S246 measured it; **Claude is the origination engine**. Captured as **"Genesis &
   corrected posture (READ FIRST)"** at the top of `docs/agent-wiki/topics/reviewer-origination.md`,
   plus a new `docs/REVIEWER_FINDER_D26_PIPELINE_FLOWCHART.md` (the canonical D26 picture).
2. **Track B (DB keyword→author origination) ARCHIVED OFF.** Confirmed it cost ~27s latency
   (A/B isolation) and contributed ~0 to saved panels. `DiscoveryService.TRACK_B_ENABLED = false`
   gates the four DB-search blocks; **code left intact + dormant** (flip the constant to re-enable).
   Code-level switch by design (NOT `searchPubmed` — that routes Track-A verify; NOT a user toggle).
   Storage-shed record in the agent-wiki reviewer-origination topic.
3. **Field Primer — BUILT (v1 + v2).** A standalone, staff-facing overview of a proposal's
   research field (sub-areas/methods/frontiers/communities/venues/**named experts**/placement).
   Decoupled from reviewer candidates (output `kind:'none'`, no save path) — which is why it may
   name experts.
   - **v1:** Executor prompt `field-primer.generate` seeded to Dataverse `wmkf_ai_prompts`
     (sonnet — **opus tier rejects `temperature`**), service `lib/services/field-primer-service.js`,
     route `POST /api/field-primer/generate`, CLI `scripts/generate-field-primer.mjs` (`--request <id>`
     pulls the real SharePoint PDF; `--text <file>`). Knowledge-only.
   - **v2 expert grounding** (`groundPrimerExperts`): resolves each named expert against OpenAlex —
     `confirmed` / `corrected` (SUGGESTED, needsVerification) / `unverified`. Consensus field anchor
     (≥2 confirmers) so one wrong match can't poison it; corrections require corroboration
     (**shared first initial** — the hallucination class preserves it — OR matching affiliation);
     off-field exact matches flagged namesakes; honorific-strip on the initial. Caught the real
     "Oksana → Olga Zhaxybayeva" hallucination live.
4. **Recall + latency findings (direction-independent).** Recall lever = **single deeper draw,
   count 12→15** (Claude is consistent at temp 0.3, so extra draws are wasted). Verify-loop
   profiled at ~43s/15 (NOT the latency bottleneck; Track B was). Profilers committed:
   `scripts/profile-reviewer-verify.mjs`, `scripts/profile-trackb-ab.mjs`.
5. **Three Codex adversarial passes — all resolved.** Pass 1 (HIGH namesake-poisoning block +
   Track-B doc contradiction) → Pass 2 (MEDIUM) → Pass 3 (LOW/non-blocking). Hardening converged;
   the residual is accepted-by-design (no save path, all `needsVerification`). Then **`/sweep`**
   reconciled "Track B archived" across paraphrase sites the literal term missed (`REVIEWER_FINDER.md`
   "Database Discovery").

### Commits (13)
`f2a8e17` D26 flowchart + corrected posture · `f603f0e` Claude-engine/Track-B-off revision ·
`36860fc` recall 12→15 + verify profile · `6cf7d92` Track B ~27s A/B · `1471fd1` field-primer v1 ·
`a49c7de` CLI --request · `1241a5a` name caveat + v2 capture · `97e1f28` v2 grounding ·
`cce758a` grounding hardening (Codex #1) · `31ad105` Track B archived · `b64e53b` corroboration (Codex #2) ·
`55844f6` honorific/stopwords (Codex #3) · `86d58e7` /sweep Track-B paraphrases.

## Potential Next Steps

### 1. Field Primer follow-ups
- **Web-grounded literature search** for the field map/frontiers (next-cycle increment).
- **Per-candidate full-author fetch** for *reliable* affiliation/ORCID corroboration — the genuinely
  deeper grounding fix (OpenAlex *search* often returns null institution). Closes the residual MEDIUM.
- **UI** (CLI-only today); optional proposal-personnel cross-check; A7-gate hardening to verify the
  seed's `untrusted` declaration (not just marker strings).

### 2. Direction-independent reviewer-finder ships (the experiment says invest HERE)
- **Recall sampling** (count 12→15 build). **Referral capture**. **SerpAPI → free-stack**.
- **Identity-resolution recall hardening** (field-aware + ORCID-anchored) — the weak link, per the
  Christina/Zhaxybayeva namesake-collision worked example (`agent-wiki/topics/reviewer-identity.md`).

### 3. Carryover (verify-before-acting)
- Reviewer COI **Chunk 2b** (retire `POTENTIAL_CONCERNS`) — ⚠ destructive, deferred.
- Minor: the analyze prompt still emits Stage-1 `searchQueries` that the gated Track B ignores —
  dead output, trimmable.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/REVIEWER_FINDER_D26_PIPELINE_FLOWCHART.md` | Canonical D26 picture (exists/build/archived) |
| `docs/agent-wiki/topics/reviewer-origination.md` | "Genesis & corrected posture (READ FIRST)" + Track B storage-shed |
| `lib/services/field-primer-service.js` | `generateFieldPrimer` + `groundPrimerExperts` + `renderPrimerMarkdown` |
| `scripts/seed-field-primer-prompt.js` | Seeds `field-primer.generate` to Dataverse (re-run to reset to code baseline) |
| `scripts/generate-field-primer.mjs` | CLI (`--request <id>` / `--text <file>`) → markdown in gitignored `tmp/` |
| `lib/services/discovery-service.js` | `TRACK_B_ENABLED = false` archive switch (line ~51) |

## Gotchas
- **opus tier rejects `temperature`** ("deprecated for this model") — the field-primer row uses sonnet.
- **Field-primer prompt is admin-editable** (`/admin` → Prompt Templates → `field-primer.generate`);
  once edited there the Dataverse row diverges from `shared/config/prompts/field-primer.js` (re-seed to reset).
- **Track B code is dormant, not dead** — don't "clean up" its functions as dead code without flipping the switch.
- **Grounding is name-PLAUSIBILITY, not identity proof** — a ✓ means a real author of that name in the field;
  corrections are SUGGESTED ("verify same person"). The deeper full-record fetch is the real identity check.
- `tmp/field-primer-*.md` contain real proposal content + named experts — gitignored, keep local.
- Reviewer-finder is currently access-locked to Justin only.
