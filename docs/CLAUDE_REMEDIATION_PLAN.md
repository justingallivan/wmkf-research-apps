# Ground-Truth Operating Rules

**Origin:** 2026-05-07 (S136), as the "Remediation Plan — Closing the Ground-Truth Gap."
**Status:** Build-out complete — the Atlas, its CI gate, and the CLAUDE.md rules all shipped (see *Build-out status* below). This document is now the canonical home for the ground-truth operating rules it introduced.
**Audience:** future-Claude (and current-Claude when this drifts). Justin can read it, but it is written for the agent to consult before data-layer, migration, or integration work.

CLAUDE.md's Universal Operating Rule #1 ("Probe before planning") points here. Read this before any migration, integration, or data-layer planning.

## The operating rules

These are the enduring output of the effort. They apply every session.

### Probe before plan
Every plan claim about live state carries a label:
- `[VERIFIED <date> via scripts/X.js]` — actually probed (live audit, grep gate, adapter re-read, parity script).
- `[ASSUMED — needs verification]` — a guess; do not act on it without checking.

Never present plan intent as built state. The canonical source for structural live state is the **Application State Atlas** (`docs/APPLICATION_STATE_ATLAS.md` + `docs/atlas/`) — read it first, don't correct it last.

### No "is X the case" without checking
If you can't cite a probe or a recent grep, run one before answering. Default response shape: "Let me check" + a tool call, not "I think X."

### Commit probe scripts
Every probe gets committed to `scripts/` so the result is reproducible by a later session.

### Memory hygiene
At session start, after seeing the index, read the **full** memory entries for any memory whose name matches the work at hand — the index line is not enough. If a domain looks suspiciously sparse in memory for work you know happened, flag the gap rather than assuming none exists. Say plainly what memory you read before answering.

### Adjacent-context survey
Mechanical, not stylistic:
- Citing a file → `ls` its parent directory before treating the citation as authoritative.
- Citing a doc → `ls docs/` for siblings with related names.
- About to claim "X has no Y" → grep for Y in plausible locations first.

### Active doubt on state claims
Treat "the convention is X," "the design landed at Y," or "live state is Z" as a **flag, not a conclusion.** Read independent sources (live entity / schema-as-code / memory entry) before stating a "settled" or "convention" claim. If they conflict, name the conflict and let the user resolve it rather than guessing which is right.

### Stale-page re-probe
Every Atlas page carries a `Last verified` timestamp. If a page is 60+ days stale and you are planning destructive work against the entity it describes, re-run the probe before trusting the page.

## Build-out status (shipped)

The structural remediation this plan called for is done. What remains is upkeep, not construction.

| Phase | Plan | Status |
|---|---|---|
| 1 | Application State Atlas (index + per-entity pages) | **Shipped** — `docs/APPLICATION_STATE_ATLAS.md` + `docs/atlas/` |
| 2 | CI gate so the Atlas can't rot | **Shipped** — `npm run check:atlas` (`scripts/check-application-state-atlas.js`) |
| 3 | Self-rules embedded in CLAUDE.md | **Shipped** — CLAUDE.md "Universal Operating Rules" (#1 Probe before planning) |
| 4 | Reconcile Wave 1/2 migration docs as-built vs. as-planned | **Continuous** — `docs/POSTGRES_TO_DATAVERSE_MIGRATION.md`, `docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md` |

**Acceptance signal (still the bar):** a Codex review of a plan should produce corrections only about the *proposed work* — not about the live state of the existing codebase.

## Origin (historical — S136)

This document began as a self-correction record. Over Session 136 and earlier, the reviewer-migration plan was repeatedly wrong about the live state of the codebase: entity models, row counts, join keys, and which store owned which data. Every plan went through ~3 drafts because the integrated state — how each table connects to each adapter, endpoint, and UI surface — had never been written down. Correction after correction came from probes; none of it was documented, though all of it was derivable from the source. The fix had to be structural (the Atlas + the rules above), not "be more careful."

The detailed round-by-round correction log from S136 is preserved in this file's git history (pre-2026-07-01 revisions). It is kept there rather than inline because its purpose — motivating the rules — is served; the rules themselves are what stay live.
