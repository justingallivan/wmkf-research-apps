# Session 236 Prompt: Reviewer contact/identity/invite hardening is COMPLETE — what's next

## Session 235 Summary

Started from the S234 follow-on plan and **shipped the entire plan to prod** — Slices E, G, and
F — completing the reviewer contact/identity/invite hardening arc that began with the S234
namesake-collapse fix. Every slice ran the full Codex loop (ground → design → Codex review →
implement → Codex post-impl → verify → reconcile docs/memory), and Codex caught a real issue at
nearly every stage. Closed with a features + prod-validation document.

### What Was Completed

1. **Slice E — identity-review gating (SHIPPED, `39e82b9`).** A candidate the system couldn't
   identity-resolve is visible but NOT selectable/savable as a vetted reviewer.
   - **E1** stamps deferred Track-B candidates (beyond top-25 `TRACK_B_IDENTITY_RESOLUTION_LIMIT`)
     `identityStatus:'unresolved'` in `discovery-service.js` → routed to `needs_identity_review`.
   - **E1b** (pre-flight catch, not in the plan): `pruneCandidateForRoster` now persists the 3
     identity markers so the gate survives a Find-roster reload (closed a reload-leak).
   - **E2** Workbench renders that group read-only + excludes it from select-all/save.
   - **E3** `save-candidates` per-row hard-reject (422 on all-unresolved) — load-bearing for the
     standalone Reviewer Finder which has no client grouping.
   - **Codex post-impl:** fixed `provenanceGroupOf` so a positively-resolved BARRED row isn't
     hidden; server gate stays on the explicit-unresolved triple (NOT full provenanceGroupOf —
     proven necessary: the broader gate broke 5 `reviewer-route-identity-gate` tests).

2. **Slice G — invite-confidence + manual-confirm gate (SHIPPED, `4b57472`).** Staff can't
   unknowingly invite a wrong/unverified address.
   - `emailConfidence(person)` helper (`lib/utils/reviewer-invite.js`, pure, 7 unit cases).
   - `my-candidates` stamps `emailSource='manual'` on staff email edits (→ LOW).
   - `render-emails` returns per-draft `emailConfidence`; `InviteEmailModal` shows an amber
     warning + one-click "Confirm & send" naming the unverified addresses.
   - `send-emails` independently re-derives confidence and refuses a LOW recipient unless its id
     is in the request's **`confirmedLowConfidenceIds`** allowlist (recipient-specific, not a
     batch boolean — Codex post-impl #6 blocker). Skip reason `email_unconfirmed`. Scoped to
     `templateType==='invitation'`.

3. **Slice F — faculty-page email recovery, ZERO-SSRF (SHIPPED, `c5a4a0a`).** The automated
   server-side fetch was Codex-reviewed (READY WITH NAMED CHANGES — undici IP-pinning,
   scholarVerifiedEmail-only allowlist, IPv6 private-IP blocklist) but **deliberately NOT built**.
   Instead: `my-candidates` returns `facultyPageUrl`; `CandidatesPanel` shows a "find on faculty
   page →" link on no-email candidates → staff enter the address via the existing Edit
   (→ `emailSource='manual'` → Slice-G confirm). No server fetch, no SSRF surface, no new dep.

4. **Features + prod-validation doc (`b0ebb77`).** `docs/REVIEWER_CONTACT_INVITE_FEATURES_AND_PROD_TESTS.md`
   — every S234+S235 feature + 19 numbered prod tests (T1.1–T5.3).

### Commits (all on `main`, pushed; main auto-deploys to prod)
- Slice E: `59c945e` · `bac7bb8` (Codex post-impl) · `39e82b9` (merge)
- Slice G: `706f9c6` (design) · `8ce1957` · `0b8c8ca` (Codex post-impl #6) · `4b57472` (merge)
- Slice F: `f6b5bd4` · `c5a4a0a` (merge)
- Docs: `b0ebb77` (features + prod-tests)

## Potential Next Steps

### 1. Run the prod-validation tests (recommended first)
`docs/REVIEWER_CONTACT_INVITE_FEATURES_AND_PROD_TESTS.md` has 20 concrete tests. Highest-value:
T2.1/T2.2 (Slice E gating + reload), T3.2–T3.5 (invite-confidence, incl. the recipient-specific
allowlist), T4.1/T4.2 (faculty-page link). Use a **test request + throwaway recipient** for any
send. Quickest signal: `npm run smoke:reviewer-contact` (live).

### 2. Widen the contact-anchoring smoke (user-deferred since S234)
Current smoke only exercises request 1002794's 4 candidates / one field. Build a smoke that runs
the real `discover` pipeline across several requests in different fields (incl. the
PubMed-on/biomedical path) and asserts the invariants.

### 3. Deferred / optional
- **Slice F automated fetch** — only if the zero-SSRF link proves insufficient. The Codex-verified
  SSRF mechanism is preserved in `docs/REVIEWER_FACULTY_PAGE_RECOVERY_DESIGN.md` §4/Q1. Do NOT add
  a server-side external-page fetch without it.
- **Slice G-opt2** — a send-time audit field (`wmkf_emailconfirmed`), only if an auditable
  "email was confidence-gated at send" record becomes a hard requirement (Dataverse schema change).

### 4. Broader direction still pending (from S231/S232, NOT this arc)
The reviewer-finder RETRIEVAL REDESIGN (demote Claude generator → field-routed retrieval; the
OpenAlex+ORCID spine is scoped to PubMed-off only; biomedical path + stratum-3 shadow-run still
pending before broader cutover). See `[[project-reviewer-finder-retrieval-redesign]]` and
`docs/REVIEWER_FINDER_RETRIEVAL_REDESIGN_PLAN.md`.

## Standing context / guardrails
- **`main` auto-deploys to prod on push. Commit/push only when asked. Stage by explicit path.**
  `npm run build` green before pushing — Codex CANNOT run build/jest; run them yourself.
- **Delegating to Codex = isolated git worktree off HEAD → commit first**
  ([[feedback-commit-before-delegating-to-worktree-agent]]).
- Contact principle: **identity-confirmed ≠ contact-validated; anchor-or-abstain**
  ([[project-reviewer-contact-enrichment-anchoring]]).
- Keep the Codex loop: spec → design review → implement → Claude build+jest+smoke+diff →
  post-impl review → reconcile → merge. It earned its keep every slice this arc.
- Housekeeping: merged S234 branch `reviewer-contact-anchor-fixes` still exists locally (deletable).

## Key Files Reference

| File | Purpose |
|------|---------|
| `lib/utils/reviewer-invite.js` | `emailConfidence(person)` + invite-gating helpers (Slice G). |
| `pages/api/review-manager/send-emails.js` | Server invite-confidence gate (`confirmedLowConfidenceIds`). |
| `pages/api/review-manager/render-emails.js` | Stamps per-draft `emailConfidence`. |
| `shared/components/reviewers/InviteEmailModal.js` | Warning + one-click "Confirm & send". |
| `pages/api/reviewer-finder/my-candidates.js` | Manual `emailSource='manual'` stamp + `facultyPageUrl` DTO. |
| `shared/components/reviewers/CandidatesPanel.js` | "find on faculty page →" link (Slice F). |
| `lib/services/discovery-service.js` | E1 deferred-candidate stamp. |
| `lib/utils/reviewer-provenance.js` | `provenanceGroupOf` (identity-review group). |
| `pages/api/reviewer-finder/save-candidates.js` | E3 server hard-reject. |
| `shared/components/reviewers/reviewer-search-logic.js` | E1b roster-marker persistence. |
| `docs/REVIEWER_CONTACT_INVITE_FEATURES_AND_PROD_TESTS.md` | Features + 20 prod tests. |
| `docs/REVIEWER_CONTACT_INVITE_FOLLOWON_PLAN.md` | The (now fully shipped) E/G/F plan. |

## Testing

```bash
npm run smoke:reviewer-contact                 # live + offline contact-anchoring battery
npm run smoke:reviewer-contact -- --offline    # deterministic only (11 checks)
npx jest reviewer contact provenance discovery identity roster invite save --runInBand
npm run build
# full startup gate set: see .claude/skills/start
```
