# Session 294 Prompt: Pick up policy-gated contact-boundary increments

## ⚠️ Top-of-session must-knows

1. **START HERE (Justin's explicit request at S293 close):** the **policy-gated
   reviewer↔CRM-contact boundary increments** are first up. They need owner *decisions*
   before any code — see "Potential Next Steps → 1" for the three increments and the six
   open questions. Justin asked to begin here next time; the likely first move is to lay
   out a concrete proposal for each decision point so he reacts to options, not open
   questions. Source of truth: `docs/REVIEWER_CONTACT_BOUNDARY_GAP_FINDINGS.md` §"Open
   Questions / Policy Decisions" (lines 140-153) + §"Design Stub" (171+).
2. **Push is NOT held anymore.** Everything this session is committed AND pushed to prod;
   both deploys are live. (The S292 push-hold is fully cleared — do not carry it forward.)
3. **The `wmkfresearch.vercel.app` issue is RESOLVED — do not resurface it as parked.** It
   was the deprecation-tail CSRF behavior (Origin≠`NEXTAUTH_URL`→403 on POSTs), not a bug;
   fixed by a host-redirect, **live-verified in prod**. See Session 293 Summary.
4. **Known-red test suites (unchanged):** `tests/unit/bill.test.js` and
   `tests/unit/discovery-verification-status.test.js` only. Confirm any red is ONLY these.
5. **Staging norm:** stage specific files, never `git add -A` (names-local norm). The old
   `scripts/probe-rabinowitz-conflict.js` is now GONE (no longer in the tree).

## Session 293 Summary

Cleared a red startup gate, shipped the contactDuplicateRisk staff-visibility increment,
shipped P2 reviewer-merge hardening (items 1 & 2; item 3 dropped on evidence), and
diagnosed + fixed + **live-verified** the `wmkfresearch.vercel.app` old-bookmark problem.
Heavy Codex-implements / Claude-reviews loop throughout; everything pushed to prod.

### What Was Completed

1. **Red `check:memory-router` gate fixed** (`fb0657f8`). `reference-codex-rescue-pkill-overstep.md`
   was missing `status: active` in frontmatter; added it.

2. **`contactDuplicateRisk` → durable `system_alerts`** (`3cd7b5f9`; S293 next-step #2 DONE).
   The ambiguous-ORCID branch of honorarium `ensureContact` now writes a `warning`
   `system_alerts` row (type `contact_duplicate_risk`, category `reviewers`, deduped
   one-per-reviewer via `autoResolveKey`) that surfaces on the /admin alerts dashboard,
   on top of the existing `console.warn`. Best-effort/fail-open (never blocks the
   honorarium). `notify` injected via deps (bound wrapper). +2 tests (payload + fail-open).
   Reconciled the "log-only/deferred" claims in the findings doc, the reviewer-identity
   wiki topic, and this prompt's gotchas.

3. **P2 reviewer-merge hardening, items 1 & 2** (`2ceb1f7b`; Codex-implemented, Claude-reviewed).
   - **Item 1:** mid-merge Dataverse 409/412 → retryable `409 merge_retryable_replan`, with
     an ASYMMETRIC map — Steps 3-4 (field/suggestion writes) become retryable 409, but
     **Step 6 email move stays `500 merge_email_move_failed`** so the modal's Option-B
     orphan-tear recovery (which keys on a confirm 500) still fires. Step 7 deactivate left
     unwrapped→500 (benign; retry re-plans clean).
   - **Item 2:** `projectMergePlanForClient` trims `suggestionId`/`requestId`/`etag`/
     `requestIds` from the client-facing plan, returns `repointCount`/`collisionCount`.
   - **Item 3 (merge breadcrumb) DROPPED on evidence:** the service principal 403s on
     annotation/note writes (`lib/services/dynamics-service.js:766-771`); native Dataverse
     field audit already covers traceability. Only reopen if a durable merge-linkage record
     is wanted via Postgres/alert (low ROI) — NOT via Dataverse notes.

4. **Legacy-host redirect — diagnosed, fixed, LIVE-VERIFIED** (`3db7d579`; Codex-implemented,
   Claude-reviewed, multiple Codex review passes folded). Root cause of the
   "old bookmark → can't load the proposal" report: `wmkfresearch.vercel.app` page loads
   work (GETs) but every reviewer-finder POST 403s on the Origin/CSRF check
   (`lib/utils/auth.js validateOrigin`, Origin≠`NEXTAUTH_URL`=`applications.wmkeck.org`).
   Fix: a host-conditioned entry in `next.config.js redirects()` (no new middleware) that
   **307**-redirects page navigations (`/api/*` excluded) to the branded host; runs before
   the `proxy.js` withAuth gate. Pure `shouldRedirectToCanonical` helper + 11 tests via
   Next's real `getPathMatch`/`prepareDestination`. **Prod-verified via curl:** old host
   `/` → `307 → https://applications.wmkeck.org/`, and `/workbench/123?tab=foo` preserved
   path+query.

### Commits (all pushed to prod; both code deploys live)
- `fb0657f8` - Add missing status: active to codex-rescue-pkill memory (memory-router gate)
- `3cd7b5f9` - Surface contactDuplicateRisk via durable system_alerts (staff-visible)
- `2ceb1f7b` - Harden reviewer-merge: retryable-409 for mid-merge conflicts + trim plan response
- `3db7d579` - Redirect legacy wmkfresearch.vercel.app host -> applications.wmkeck.org

## Potential Next Steps

### 1. Policy-gated contact-boundary increments (START HERE — needs owner decisions)
Three increments, all scoped/designed but NOT built, gated on owner risk-tolerance calls
(`docs/REVIEWER_CONTACT_BOUNDARY_GAP_FINDINGS.md`). Why gated (doc line 212): *"wrong-contact
auto-link is worse than a duplicate — name-only matching is unsafe without staff confirmation."*

The increments:
- **Origination-time contact match** — `save-candidates` does NO CRM-contact lookup today
  (keys on potentialreviewer email only), so duplicates can originate pre-honorarium.
- **Reviewer→contact field sync** — corrected name/email/affiliation don't flow back to the
  linked CRM contact.
- **Email-hit + ORCID-conflict gap** — the shipped honorarium fix only runs ORCID on email
  *miss*; an email matching one contact while ORCID points at a different contact isn't caught.

The decisions (doc §Open Questions, lines 142-153): auto-link vs. surface-for-staff; which
keys are safe to auto-link on; who owns truth on a reviewer-vs-CRM conflict (reviewer/PD/CRM
staff/field-by-field); one-way vs. bidirectional vs. review-task sync; ambiguous match →
block / save-unlinked-with-warning / require staff resolution before invite; honorarium →
refuse-to-create vs. today's create+flag. (Two are already answered in spirit: ambiguous
honorarium = create+flag-never-block; manual affiliation edit = no COI re-check.)
**Suggested first move:** draft a concrete proposal per decision point for Justin to react to.

### 2. Long-stale carryovers (VERIFY-FIRST or retire — do NOT assume open)
- S288: record real-replay human sign-off in `docs/MODEL_CHANGE_STRATEGY.md` (reviewer-finder
  already pinned to `claude-opus-4-8` in prod); Admin Models visual smoke.
- S285/S286: request `1002788` test-data triage; E2E of Restore Removed Candidates + PD
  identity override; reviewer-portal review-upload design decision.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/REVIEWER_CONTACT_BOUNDARY_GAP_FINDINGS.md` | Contact-boundary findings; §Open Questions (140-153) + §Design Stub (171+) drive next-step #1. |
| `lib/bill/honorarium-onboard-orchestrator.js` | `ensureContact` ORCID fallback + `contactDuplicateRisk` → `system_alerts`. |
| `lib/services/reviewer-merge.js` | Merge service; `classifyDataverseMergeConflict`/`retryableReplanError`/`emailMoveError` (Item 1), `projectMergePlanForClient` (Item 2). |
| `pages/api/reviewer-finder/merge-candidates.js` | Merge route error map (`merge_retryable_replan`→409, `merge_email_move_failed`→500). |
| `shared/components/reviewers/CandidateEditModal.js` | Merge UI; Option-B tear recovery keys on confirm 500 — do NOT break it. |
| `next.config.js` + `lib/utils/legacy-host-redirect.js` | Legacy-host 307 redirect + pure `shouldRedirectToCanonical`. |

## Testing

```bash
# Full suite — expect ONLY the two known-red suites:
npm test
# Merge + redirect units:
npx jest tests/unit/reviewer-merge-service.test.js tests/unit/reviewer-merge-route.test.js tests/unit/legacy-host-redirect.test.js
```

## Gotchas / Continuity

- The merge email-move step MUST keep returning 500 (not the retryable 409) — the modal's
  Option-B orphan-tear recovery depends on that signal. Asymmetry is intentional.
- `wmkfresearch.vercel.app` redirect is a **307** (`permanent: false`) on purpose — avoids
  baking a permanent cached redirect into staff browsers. `/api/*` is excluded by design
  (redirecting API POSTs wouldn't help; it self-heals on next page navigation).
- Heavy Codex-implements / Claude-reviews loop this session; relay Codex output verbatim.
