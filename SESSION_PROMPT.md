# Session 183 Prompt: Cloudmersive (real this time) + loose-end cleanup

## Session 182 Summary

**Net code change: zero.** The session attempted to build a prompt-injection
defense layer, shipped it, then reverted the commit after discovering the
codebase already had a comprehensive, CI-gated injection-defense system
(A7, sessions 173-177) that my initial investigation missed. Two memory
entries written to prevent recurrence.

### What Was Completed

1. **Threat-model + design conversation (`docs/PROMPT_INJECTION_DEFENSE_PLAN.md`,
   later deleted).**
   - Researched prompt-injection attack class via Medium article on PDF
     hidden-text vectors.
   - Three iterations of the plan (v1 three-tier defense → v2 Tier-1 only
     → v3 prompt-hygiene only) with two Codex review rounds.
   - Threat sizing settled on: closed-set submitters, multi-week
     multi-person human review, AI as decision-support not decision-maker,
     compliance attestation. Concluded baseline prompt hygiene was the
     right scope.

2. **Built then reverted parallel injection-defense system (commit
   `04706f3` → revert `abe861e`).**
   - New utility `lib/utils/prompt-injection-guard.js` with
     `wrapDocumentContent` (XML wrapper + entity-encoded body +
     nonce-suffixed close tag), shared preamble, file-loader integration.
   - 9 new unit tests, 824/824 passing.
   - **Reverted because:** the codebase already has `wrapUntrustedContent`
     + `buildUntrustedContentPreamble` + `validateAiJson` in
     `lib/utils/ai-payload-boundary.js` and `lib/utils/ai-output-schema.js`,
     CI-gated by `npm run check:prompt-injection-tagging` with all 24
     LLM-input surfaces migrated. My new code was duplicating A7 with a
     weaker design and double-wrapping content in two routes that
     already had A7 coverage (`phase-i-dynamics/summarize.js`,
     `grant-reporting/extract.js`).
   - Live-test inspection (Justin saw the "Proposal text bounded at
     17,422 characters" message in the Phase I Writeup UI) surfaced the
     duplication — that message comes from the existing A7 system, not
     my new code.

3. **Root cause + memory writes (commit `62335d7`).**
   - Missed A7 because: (a) no memory entry pointed to it; (b)
     `docs/security-audit/` wasn't in my top-level `ls docs/`; (c) I
     grepped for article-jargon terms (white-on-white, OCR, canary)
     instead of general-purpose terms (untrusted, sentinel, boundary).
   - `project-a7-prompt-injection-hardening.md` — canonical pointer to
     the A7 plan + primitives + CI gate. New "Security Infrastructure"
     section in MEMORY.md.
   - `feedback-grep-general-codebase-terms.md` — root-cause lesson:
     "does the codebase have X" requires grepping general-purpose terms
     (what the prior implementer would have used), not source-material
     jargon. One empty grep is not proof; cross-check `docs/` subdirs +
     `package.json` gates + `git log`.

### Commits

- `04706f3` — Prompt-injection hygiene: wrap applicant document content (S182)
  **[REVERTED]**
- `abe861e` — Revert "Prompt-injection hygiene: wrap applicant document content (S182)"
- `62335d7` — Memory: A7 injection-hardening pointer + grep-general-terms lesson (S182)
- (this) — Document Session 182 and create Session 183 prompt

### What stayed at S181 levels

- Unit test count: 815 (the 9 guard tests went with the revert).
- All CI gates green: `check:atlas`, `check:atlas:self-test`,
  `check:api-routes`, `check:fact-consistency`,
  `check:prompt-injection-tagging` (24 migrated, 0 pending).

## Potential Next Steps

The S182-original carryover is unchanged; the injection-defense detour
ate the session but produced no working changes. Cloudmersive in
particular is still the realistic next-build item.

### 1. Cloudmersive virus-scan integration (carry from S181/S182)

Intake portal attach endpoint (`/api/intake/draft/attach`) is not yet
built; per `docs/INTAKE_PORTAL_DESIGN.md:521-545` and
`docs/INTAKE_PORTAL_DRAIN_PLAN.md:40`, Cloudmersive scans run
synchronously at attach time, fail-closed. Drain-error-classifier
already has a `cloudmersive` branch (`lib/utils/drain-error-classifier.js`,
exercised at `tests/unit/drain-error-classifier.test.js:101-103`).
Still missing:
- Cloudmersive account + key minting.
- `lib/services/cloudmersive-scan.js` (POST `/virus/scan/file`).
- Wire into `/api/intake/draft/attach` (endpoint TBD).
- EICAR smoke per `INTAKE_PORTAL_DESIGN.md:606`.

Note: A7 already covers the *prompt-injection* angle on applicant
content. Cloudmersive is the *binary-malware* layer — orthogonal, both
needed.

### 2. Connor Q1-Q4 email (still parked since S180)

Drafted at `docs/INTAKE_PORTAL_CONNOR_Q1_Q4_DRAFT.md`. Q1 unblocks
`status_flipped` handler; Q2 unblocks persons handler; Q3 unblocks
pilot view filters; Q4 unblocks Connor's recompute PA flow.

### 3. Verify `contact.wmkf_portaloid` alt-key Active in prod

S179 deployment was `Pending → Active` over a few minutes. Re-probe
before pilot opens:
```bash
node -e "
const { DynamicsService } = require('./lib/services/dynamics-service');
DynamicsService.getEntityKey('contact', 'wmkf_portaloid').then(k =>
  console.log('Status:', k?.EntityKeyIndexStatus || 'NOT FOUND'));
"
```

### 4. Other intake portal pieces

- `/api/intake/draft/*` autosave endpoint
- `/api/intake/jobs/[id]` polling endpoint for applicant status
- `/apply` UI itself
- `status_flipped` drain handler (after Connor Q1)
- Persons handler + contact resolution (after Connor Q2)

### 5. Loose ends from S181 (still parked)

- `DAILY_SPEND_ALERT_CENTS` calibration ($10 may be low for June batches).
- 1h cache write column split (only needed if we ever start using 1h
  caching).

### 6. Carryover (parked, dates not yet hit)

- Wave 1 elevation revert on prod app user.
- W6 reviewer Postgres DROP — fires ≥ 2026-07-01.
- Archive intake meeting agenda — fires ≥ 2026-05-27 (4 days out).

### 7. Codex round (only after substantive new code)

Don't run reviews back-to-back without new substantive surface. S182
produced no surviving code, so the meter is unchanged from S181's
"after Cloudmersive lands" guidance.

## Key Files Reference

### Memory entries added this session

| File | Purpose |
|---|---|
| `.claude-memory/project-a7-prompt-injection-hardening.md` | Canonical pointer to A7 — read before any injection-related design |
| `.claude-memory/feedback-grep-general-codebase-terms.md` | Root-cause lesson: grep general terms not domain jargon when checking codebase coverage |
| `.claude-memory/MEMORY.md` | New "Security Infrastructure" section added |

### Don't re-read this session's reverted artifacts

| File | Status |
|---|---|
| `docs/PROMPT_INJECTION_DEFENSE_PLAN.md` | Deleted in revert. Reasoning chain preserved in commit history (`04706f3` → `abe861e`). Don't recreate — A7 plan is canonical. |
| `lib/utils/prompt-injection-guard.js` | Deleted in revert. Use `wrapUntrustedContent` from `lib/utils/ai-payload-boundary.js` instead. |
| `shared/config/prompts/_injection-guard-preamble.js` | Deleted in revert. Use `buildUntrustedContentPreamble` from same module. |

### Canonical injection-defense pointers (existing infrastructure)

| File | Purpose |
|---|---|
| `docs/security-audit/A7_PROMPT_INJECTION_PLAN.md` | The plan + inventory of 24 surfaces + part ordering + status |
| `lib/utils/ai-payload-boundary.js` | `wrapUntrustedContent`, `buildUntrustedContentPreamble`, `buildBoundedTextPayload` |
| `lib/utils/ai-output-schema.js` | `validateAiJson` for every JSON output sink |
| `scripts/check-prompt-injection-tagging.js` | Positive-coverage registry CI gate |

## Testing

```bash
# All gates green pre-stop:
npm run check:atlas             # 30 PG / 32 DV ✓
npm run check:atlas:self-test   # 12/12 patterns ✓
npm run check:api-routes        # 90 routes ✓
npm run check:fact-consistency  # ✓
npm run check:prompt-injection-tagging  # 24 migrated, 0 pending ✓

# Full unit suite (back to S181 baseline after revert):
npx jest tests/unit             # 815 ✓ / 0 failures
```

## Open Items (architectural, non-blocking)

Unchanged from S182 start. The injection-defense detour produced no
surviving change to this section.

- **Connor Q1-Q4 email** — drafted, not yet sent. Same status as S180-S182 start.
- **Cloudmersive account** — not yet set up; env var `CLOUDMERSIVE_API_KEY`
  slot exists in design doc, not in Vercel yet.
- **`ANTHROPIC_ADMIN_API_KEY`** — set in Vercel (S181). First monthly
  drift cron fires Jun 1 @ 11:00 UTC.
- **Auto-reload** — ON for the work Anthropic org.
