> ★★ **RUN FIRST AT STARTUP (queued S258, 2026-06-14):** hand the saved prompt in
> `docs/CODEX_REVIEW_PROMPT_hook-self-review.md` to a `codex:codex-rescue` agent and relay
> the output verbatim — an independent review of the new pre-commit self-review hook
> (`.claude/hooks/pre-commit-self-review.js`) + its strategy, before relying on it. Then act
> on the findings. *(This banner is carried forward until the review is done.)*

# Session 258 Prompt: Reviewer "hold step" — BUILT (gated); go-live next

> **GIT.** All S257 work is on `main`, pushed. Working tree clean. 23 commits — the full hold-step
> build (chunks 1–8, each Codex-reviewed) + verification hardening. Verify push state at startup.
> **NEW commit guard:** a PreToolUse(Bash) hook now BLOCKS `git commit` on status/enum
> producer↔consumer parity drift (`check:status-enum-parity`). If a commit is blocked, add the new
> value to its consumer (label map / filter bucket / count) — see the error message.

## Session 257 — what happened

Built the **entire reviewer "hold step"** end to end — all 8 chunks from
`docs/REVIEWER_HOLD_STEP_BUILD_PLAN.md` — each with an adversarial Codex review and fixes applied.
Full suite **2472 green**, build clean. **Still a ZERO-BEHAVIOR-CHANGE deploy** — nothing is live
yet (see "go-live switches" below).

### What was completed (chunk → commits)
1. **Schema** — `wmkf_responsetype` option `held=100000004` + `wmkf_heldat` DateTime created **live**
   in Dataverse (idempotent scripts, run by Justin); maps + both select lists. `47c0b1f`, `b6f769e`.
2. **Readiness predicate + view dispatch** — `lib/external/proposal-readiness.js`
   `isProposalReadyForReviewers` (go-live gate, returns `true` for now); `computeEngagementState(s, isReady)`
   adds `hold-invite`/`held` views. `005dc9c`, `514596a`.
3. **`respond.js action:'hold'`** — transition matrix, readiness write-gate (repeat-accept exempt),
   review-received lock, repeat-hold idempotency. `8c7064d`, `d5de119`.
4. **HoldView** component + dispatcher wiring (ask / confirmed). `fd99b7f`, `d068788`.
5. **`.ics` save-the-date** (`calendar-invite.js`, RFC 5545 PUBLISH) + `calendarAttachments` lane;
   `sendAllowsAttachments` denylist→allowlist. `41ba3b62`, `db96ed3`.
6. **Email copy + send wiring** — `hold` + `finalize` templates; first-contact confidence/duplicate
   guards extended to `hold`; finalize held-eligibility gate; unknown-type fail-closed. `28c2db8`, `7fcfed2`.
7. **Tests** — send-emails SSE route harness (materials-strip, degrade, finalize gate, batch). `8488230`, `ec8940e`.
8. **Staff held visibility** — derived `RESPONSE_TYPE_BY_VALUE`; `my-candidates` numeric→string fix;
   finder `held` chip+count; dashboard `held` phase; PI `reviewerHeld`. `8a293d9`, `4cc1c54`.

Plus **verification-posture hardening** (the cadence caught 2 fail-open HIGHs, a guard-order bug, a
false-confidence test, repeated consumer-fan-out misses): new contract-reconcile audits + memories
(`feedback-symbol-consumer-fanout`, `feedback-idempotency-name-the-mechanism`,
`feedback-scrutinize-exemptions-and-fallthrough`) AND a **deterministic control** —
`check:status-enum-parity` + the commit-guard hook. `0bc587e`, `5fc9b77`, `09490d6`, `6863c86`, `b45bac2a`.

## Potential Next Steps

### ★ GO-LIVE — flip the two switches that activate the hold flow
The build is complete and dormant. Two switches turn it on (both deliberately left off):

1. **`isProposalReadyForReviewers(request)`** (`lib/external/proposal-readiness.js`) returns `true`
   today (treat-as-ready ⇒ bypass hold, preserving the current accept flow). Flip it to the real
   **post-QA "release to reviewers" signal** (false until staff release). **[OPEN — Justin/Connor]:**
   identify that signal (or add an explicit staff "release" control). `wmkf_phaseiisubmittedat` is
   RECEIPT, not readiness. **Do NOT flip before the UI trigger below ships** — a not-ready fresh
   reviewer would hit a `hold-invite` view with no way for staff to have sent the hold ask.
2. **Staff UI trigger** to send `templateType:'hold'` / `'finalize'`. The send path + copy are ready;
   `shared/components/reviewers/InviteEmailModal.js` hardcodes `templateType:'invitation'`. Needs a
   staff affordance (a mode/toggle) to send the hold ask + the finalize nudge.

Sequence: build the UI trigger → flip the predicate. Until both, the flow is inert (no caller sends
`hold`; readiness is always true). Recommend a Codex review of the go-live wiring.

### Housekeeping
- **Atlas:** the reviewer page that enumerates `wmkf_responsetype` values should gain `held`
  (the picklist value is live in Dataverse). Run `npm run check:atlas` after.
- **`deriveWorkRemaining` 'held' phase** is in the dashboard API + `STAGE_META` chip; confirm with
  Justin whether held deserves its own workbench column (UI polish, not a blocker).

### Deferred / externally-blocked (do NOT lead with these; verify before acting)
- Recall padding-ceiling live check before raising count >15 (needs API key + a real proposal).
- SerpAPI Hobby-tier downgrade eval (Justin, out-of-repo billing dashboard).
- `score-candidates` prod prompt reseed — only if you edit its template (unchanged since S254).
- `affiliationHistory` producers — COI-inert dead code, deferred (`project-deferred-code-cleanup`).

## Parked — do NOT surface in startup summaries
> User-recall-only. Do not echo into `/start`'s Potential Next Steps or any unprompted output; act
> only when the named un-park trigger fires. See `feedback-dont-resurface-parked-items`.
- **PubPeer migration off SerpAPI** — contingent on a sanctioned-API reply from PubPeer (Justin
  emailed them S251; suspects no reply). Context + un-park trigger:
  `docs/agent-wiki/topics/integrity-screener.md` and `project-serpapi-capability-erosion`.

## ⚠ Continuity guardrails (still live)
- **Hold step is BUILT but DORMANT.** Don't mistake "built" for "live": `isProposalReadyForReviewers`
  returns `true`, nothing sends `templateType:'hold'`, so `hold-invite`/`held` views are unreachable
  in prod. Full design + decisions: `project-reviewer-hold-step-decouple`; surfaces +
  per-chunk Codex outcomes: `docs/REVIEWER_HOLD_STEP_BUILD_PLAN.md`.
- **`held` lifecycle facts:** `wmkf_heldat` is written ONLY by the hold response path (not
  `updateLifecycle`); `RESPONSE_TYPE_BY_VALUE` is a DERIVED inverse of `RESPONSE_TYPE_MAP` (don't
  hand-edit it). The no_response timeout sweep correctly skips held (responsetype non-null).
- **COI Chunk 2 fully shipped (2a S240 + 2b S254).** `docs/REVIEWER_FINDER_COI_CHUNK2_DESIGN.md` is
  HISTORICAL. Current COI policy: `project-reviewer-coi-rely-on-self-disclosure`.
- **`POTENTIAL_CONCERNS` parser terminator is intentional** — do NOT remove.
- Memory router stays **hub-link form**; `grep`/`rg` may corrupt identifiers+digits
  (`project-rtk-grep-output-corruption`) — use Read for exact content.

## Key Files Reference (hold step — all BUILT this session)

| File | Role |
|------|------|
| `docs/REVIEWER_HOLD_STEP_BUILD_PLAN.md` | the plan with per-chunk status + Codex outcomes |
| `lib/external/proposal-readiness.js` | `isProposalReadyForReviewers` — the go-live switch (#1) |
| `shared/components/reviewers/InviteEmailModal.js` | hardcodes `'invitation'` — the go-live UI trigger (#2) |
| `pages/api/external/review/[token]/respond.js` | `action:'hold'` + readiness write-gate + transition matrix |
| `pages/api/external/review/[token]/context.js` | `computeEngagementState(s, isReady)` view dispatch |
| `shared/components/external/HoldView.js` | the hold ask / confirmed portal views |
| `lib/external/calendar-invite.js` | `.ics` PUBLISH save-the-date builder |
| `pages/api/review-manager/send-emails.js` | calendarAttachments lane + hold/finalize lifecycle |
| `lib/dataverse/adapters/reviewer-suggestion.js` | `RESPONSE_TYPE_MAP.held`, derived `RESPONSE_TYPE_BY_VALUE`, hold write |
| `scripts/check-status-enum-parity.js` + `.claude/hooks/enum-parity-commit-guard.js` | the new commit-blocking parity control |

## Testing
```bash
npx jest --testPathPatterns "reviewer|external|respond|hold|calendar|engagement"  # hold-step suites
npm test && npm run lint && npm run build   # full suite (2472 green at S257)
npm run check:status-enum-parity            # the new parity gate (also blocks commits)
```
