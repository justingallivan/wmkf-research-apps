# Session 360 Prompt: adversarial-review remediation slices (Codex handoff)

## Session 359 Summary

Session 359 executed the requested read-only adversarial review of the reviewer
holistic redesign (range `43220961..75d26a22`), produced the review artifact and
a Codex-facing remediation handoff, and — on the owner's explicit decision —
merged the inert writer branch to `main`.

### What Was Completed

1. **Adversarial review (verdict: READY WITH FIXES)**
   - Full `/start` gate sweep (57 gates green) and `/contract-reconcile`
     Mode-A review across all seven audits; 152/152 focused tests green.
   - Artifact: `outputs/reviewer-holistic-redesign-adversarial-review-2026-07-13.md`
     (gitignored by convention; local only).
   - Independently re-verified: writer/contract/COI-helper/adapter-seam and all
     ten Wave 13 fields are production-inert; C0.1/C0.2 containment claims
     survived attack; adapter ETag/If-Match/typed-412/explicit-null claims
     verified against real `DynamicsService` source.
   - Findings: **F1 (P1)** writer timestamp canonicalization cannot survive a
     Dataverse DateTime round-trip (mechanism CONFIRMED by executing the real
     pure functions: a stored second-precision `boundAt` throws
     `invalid_current_state`; live serialization still `[ASSUMED]` — probe
     blocked by session permissions). **F2 (P2)** unsigned client
     `contactEnrichment.identity` persists as a durable `automated` decision in
     `save-candidates-service.js:895-899` regardless of receipt validity.
     **F3 (P2)** seven reachable writer guards with zero failing-test coverage.
     **F4–F8 (P3)** dead `preserveDecision` branch, circular allowlist
     assertion, receipt negative-test gaps + then-180-day TTL, batch key collisions,
     live-state doc claims without reproducible evidence.

2. **Codex remediation handoff**
   - `docs/REVIEWER_HOLISTIC_REDESIGN_ADVERSARIAL_FINDINGS_HANDOFF.md`:
     evidence-labeled fix specs, per-guard complement-input table, ground
     rules (no writer caller activation; contracts frozen), and suggested
     slices A (F2+F6, live), B (F1 probe→fix + F3/F4/F5, inert),
     C (F7).

3. **Owner-approved merge to `main`**
   - `codex/reviewer-holistic-i1-binding-writer` merged at `4e0ae1bd` and
     pushed. Review basis: all new runtime surfaces census-verified inert, so
     merge = no behavior change. Production behavior remains C0.1/C0.2 as
     promoted in S358.

### Commits

- `a7bb3680` — docs(reviewer): add adversarial review findings handoff for Codex
- `4e0ae1bd` — merge codex/reviewer-holistic-i1-binding-writer to main

## Next Items

### Verified Open

1. **Dispatch the remediation slices to Codex** per
   `docs/REVIEWER_HOLISTIC_REDESIGN_ADVERSARIAL_FINDINGS_HANDOFF.md`.
   Evidence: the handoff doc (committed, on `main`) and the review artifact.
   Slice A (F2 receipt-gate the decision write + F6 attestation negative
   tests) is live-behavior containment and can start immediately on a Tier-2
   branch. Slice B (F1) must start with the live serialization probe.
   Slice C (F7 batch key uniqueness) is independent.

2. **F1 live probe — needs a sanctioned run.**
   Evidence: review artifact §F1; draft script in the S359 scratchpad
   (`probe-datetime-roundtrip.mjs`); production rows already hold
   millisecond-written `wmkf_identityresolvedat` values
   (`lib/dataverse/adapters/researcher.js:321`,
   `capture-self-reported-orcid.js:73`), so one read-only query answers the
   question. The S359 permission classifier blocked live production reads;
   run it as a tracked read-only `scripts/probe-*` script in a session where
   the owner authorizes it.

3. **Operational carryovers (unchanged from S359 prompt; not addressed by the
   review session):**
   - Interlock observation before the deliberate `warn` → `on` flip.
     Evidence: `CLAUDE.md`, `docs/DATAVERSE_TARGET_WRITE_INTERLOCK_PLAN.md` §5.
   - Confirm the first clean Daily Maintenance run after `bd5df78e`
     (email/cron-log evidence, not code).
   - Live spot-check the already-tested `label_conflict` publish guidance.
     Evidence: `tests/unit/policies-section-label-guidance.test.js`.

### Owner Decision Resolved

1. **Receipt TTL (F6): 14 days.** Owner decision on 2026-07-13. The
   `codex/reviewer-attestation-ttl-14d` Tier-2 branch changes the signed receipt
   lifetime and adds absent/wrong-secret/expired negative coverage.

### Owner Decision Needed

1. **Design-intent confirmations (review §6):**
   `reviewer-merge.js:236` merge protection and
   `CandidateEditModal.js:573` confirmed-only affordance both exclude
   automated-`probable` records (the post-C0.2 automated ceiling). Confirm
   intended or open a follow-up.
2. **First production caller and legacy transition strategy (unchanged, now
   additionally gated on F1).** Evidence: implementation plan I1/I2; review
   artifact §7. No caller migration is authorized; F1 must be resolved first.
3. **Reviewer-institution → CRM linking brief** (unchanged owner coordination
   item; do not infer an implementation request).
4. **Address-based reviewer onboarding scope** (unchanged;
   `.claude-memory/project-honorarium-payment-landscape.md`).

### Parked

1. **Runtime reader/writer migration, suggestion COI currency, action-policy
   activation.** Evidence: plan I2; review confirmed zero production
   references to all ten Wave 13 fields. Re-open only after F1–F3 land and
   the owner gate is explicit.
2. **Track-B/heuristic cleanup.** Evidence: plan D1. Unchanged gates.

### Verify Before Acting

1. **Branch deletion:** `codex/reviewer-holistic-i1-binding-writer` is merged
   (`4e0ae1bd`); before deleting the local branch, confirm no unmerged work
   (`git branch --contains` / `git log main..codex/...` empty).
2. Re-run the production-caller census before any claim that the writer or
   Wave 13 fields are still inert — Slice work will change this.
3. Re-probe live Wave 13 metadata/value state before any backfill or caller
   activation; never infer legacy provenance from `wmkf_identitystatus` (F8:
   convert the plan/Atlas live-state claims to dated `[VERIFIED via <command>]`
   at the next schema-adjacent session).
4. The review artifact lives in gitignored `outputs/` on this machine only —
   copy or re-derive from the docs handoff if working from the other Mac.

### Do Not Reopen Without New Decision

1. Do not activate runtime behavior merely because Wave 13 schema is deployed.
2. Do not infer self-report or staff attestation from legacy `confirmed` rows.
3. Do not delete Track B or old readers/writers before the plan's evaluation,
   pilot, promotion, and observation gates.
4. Do not change the established "surface, do not gate" COI policy as part of
   identity-binding work.
5. BILL API integration remains tabled by owner decision.
6. Wave-1 temporary elevations remain intentionally retained.
7. C0.1/C0.2 promoted slices survived adversarial verification — do not reopen
   their containment design without a new finding.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/REVIEWER_HOLISTIC_REDESIGN_ADVERSARIAL_FINDINGS_HANDOFF.md` | Codex remediation brief (F1–F8, slices, ground rules) |
| `outputs/reviewer-holistic-redesign-adversarial-review-2026-07-13.md` | Full review artifact (local, gitignored) |
| `docs/REVIEWER_HOLISTIC_REVIEW_IMPLEMENTATION_PLAN.md` | Active hybrid plan and phase gates |
| `lib/services/reviewer-identity-binding-writer.js` | Inert writer — F1/F3/F4 fix surface |
| `lib/services/reviewer-identity-binding-contract.js` | Pure contract — F1/F5 fix surface |
| `lib/services/reviewer-finder/save-candidates-service.js` | F2 fix surface (decision write at :895-899) |
| `lib/services/reviewer-candidate-attestation.js` | F6 fix surface (receipt verify + TTL) |
| `lib/utils/reviewer-save-key.js` | F7 fix surface (batch key uniqueness) |
| `scripts/preflight-reviewer-identity-binding-fields.mjs` | F8 rerun target (`--target=prod`) |

## Testing

```bash
# Slice A (F2/F6)
npx jest tests/unit/save-candidates-service.test.js \
  tests/integration/save-candidates-route.test.js \
  tests/unit/reviewer-candidate-attestation.test.js

# Slice B (F1/F3/F4/F5)
npx jest tests/unit/reviewer-identity-binding-contract.test.js \
  tests/unit/reviewer-identity-binding-adapter.test.js \
  tests/unit/reviewer-identity-binding-writer.test.js

# Slice C (F7)
npx jest tests/unit/reviewer-save-key.test.js \
  tests/unit/reviewer-search-section-save-stale.test.js
```
