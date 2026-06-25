# Session 289 Prompt: Reviewer-finder demo polish + close model pre-flip evidence

## Session 288 Summary

Short, demo-focused session. Closed the one outstanding pre-flip *evidence* gap
from S287 (a real-proposal reviewer-finder replay) and made the live analyze log
self-evidencing by echoing the resolved Claude model. Justin ran a few in-app
reviewer-finder tests and they looked good.

### What Was Completed

1. **Real-proposal replay evidence (closes S287 next-step #1)**
   - Ran `scripts/validate-reviewer-analyze.mjs` from this local (non-sandboxed)
     terminal — Codex could not, because it forbids transmitting private proposal
     text to Anthropic. Justin had approved the transmission in S287.
   - Request `1002836` ("Laboratory earthquakes on complex fault systems"),
     proposal file `Phase I::ProjectDescription.pdf` (10,618 chars extracted).
   - Result: status `completed`; configured `claude-opus-4-8` → actual
     `claude-opus-4-8`; **no fallback**; `end_turn`; attempt 1; parse success;
     proposal-info present; **12/12** requested reviewers; **0** validation issues;
     0 COI/conflict words in reasoning; prompt `reviewer-finder.analyze` dataverse
     v1, no override. All 12 are real, independent, well-matched domain experts
     (Marone, Johnson, Reches, McLaskey, Lockner, Kaneko, Ben-Zion, Brodsky,
     M. Thomas, Cappa, van der Elst, Candela); no duplicates/placeholders; reasoning
     topical and specific to the proposal objectives.
   - Side effects: no reviewer/grant/Blob writes; one `api_usage_log` telemetry row.
   - **Artifact kept OUTSIDE the repo** (contains private proposal-derived data,
     matching S287's handling): `/private/tmp/wmkf-model-replays/1002836-claude-opus-4-8.json`.
     It is NOT committed and must not be.
   - `humanReview.pass` in the artifact is still `null` — reserved for Justin's
     sign-off (see Next Step #1).

2. **Echo resolved Claude model in reviewer-finder live log**
   - `lib/services/claude-reviewer-service.js`: added one `onProgress` event
     (`status: 'model_resolved'`, `Model: <id>`) right after the "Prompt source:"
     line and before the multi-minute Claude call, so the streamed analyze log
     shows the model up front during demos. A 529 fallback swap, if it happens, is
     still reported separately by the existing `fallback` event. The analyze API
     route already forwards every service progress event to the SSE stream, so no
     route change was needed.
   - All 41 reviewer-service/route tests pass; lint clean.

### Commits

- `71ef5a50` - Echo resolved Claude model in reviewer-finder live log

(The replay produced no commit — its artifact is intentionally outside the repo.)

## Potential Next Steps

### 1. Record the real-replay evidence / human sign-off (offered, not yet done)
Justin has eyeballed reviewer-finder output in-app this session. To formally close
the pre-flip checklist, either: (a) set `humanReview.pass = true` with notes in the
private artifact, and/or (b) record in `docs/MODEL_CHANGE_STRATEGY.md` that the
real-replay requirement was satisfied on 2026-06-24 (request 1002836, opus-4-8,
12/12, no fallback, 0 issues), pointing to the private artifact path WITHOUT
committing proposal data. Note: `reviewer-finder` is already pinned to
`claude-opus-4-8` in prod, so this validates the current production model on real
input rather than gating an actual flip. For a future high-risk flip/unpin, the
runbook still wants 2-3 proposals covering sparse/dense/edge-case text.

### 2. Logged-in Admin Models visual smoke (carried from S287, still open)
Unauthenticated health is good. With an authenticated browser, confirm the
effective `reviewer-finder` row in `/admin` Models shows `claude-opus-4-8` with
`cap ok` / `price ok`.

### 3. Historical carryovers from S285/S286 (UNVERIFIED — probe current state first)
Do not act on these until probing live state; they have ridden forward several
sessions without re-verification:
- request `1002788` test-data triage / status revert;
- E2E verification of Restore Removed Candidates and PD identity override;
- reviewer-portal review-upload design decision;
- optional auto-on-award abstract cron.

## Key Files Reference

| File | Purpose |
|------|---------|
| `lib/services/claude-reviewer-service.js` | Reviewer-finder analyze; now emits `model_resolved` progress event before the Claude call. |
| `pages/api/reviewer-finder/analyze.js` | SSE route; forwards all service progress events to the browser log. |
| `scripts/validate-reviewer-analyze.mjs` | Reviewer-finder replay harness (`--list-files`, `--json-out`). |
| `docs/MODEL_PREFLIP_REPLAY_RUNBOOK.md` | How to run and judge a reviewer-finder model replay artifact. |
| `docs/MODEL_CHANGE_STRATEGY.md` | Model-change strategy; phases 0-8 done; pre-flip checklist real-replay now has an artifact (human sign-off pending). |
| `lib/services/model-resolver.js` | Tier resolution + `resolveModelWithCapabilities()`. |
| `lib/services/llm-client.js` | Capability-shaped Claude transport; 529 fallback; deprecated-param retry safety net. |

## Testing / Verification From S288

```bash
npx eslint lib/services/claude-reviewer-service.js
npx jest tests/unit/claude-reviewer-service.test.js tests/unit/reviewer-analyze-route.test.js tests/unit/reviewer-finder-a7.test.js tests/unit/reviewer-route-identity-gate.test.js --runInBand

# Re-run a real replay from a non-sandboxed terminal (writes artifact OUTSIDE repo):
node --import ./scripts/lib/use-extensionless.mjs scripts/validate-reviewer-analyze.mjs \
  --request 1002836 --list-files
node --import ./scripts/lib/use-extensionless.mjs scripts/validate-reviewer-analyze.mjs \
  --request 1002836 \
  --file-key "akoya_request::1002836_AF594C797B42F11188B5000D3A3065B8/Phase I::ProjectDescription.pdf" \
  --reviewer-count 12 --temperature 0.3 \
  --json-out /private/tmp/wmkf-model-replays/1002836-claude-opus-4-8.json
```

Known recurring local noise unchanged: the two known-red suites
`tests/unit/bill.test.js` and `tests/unit/discovery-verification-status.test.js`.

## Gotchas / Continuity

- The `71ef5a50` model-echo change is now committed; pushing this session deploys
  it to Vercel production. Justin confirmed in-app tests looked OK before /stop.
- The real-replay artifact lives at `/private/tmp/wmkf-model-replays/` and is
  machine-local + non-committed. To reproduce on another machine, re-run the
  harness there (it transmits private proposal text to Anthropic — only do this on
  a non-sandboxed terminal with approval).
- `reviewer-finder` stays pinned to concrete `claude-opus-4-8` until a real replay
  artifact + human review support any tier advance or unpin.
- Broad feature work immediately before the colleague demo is likely higher risk
  than reward unless there is a known user-facing defect.
