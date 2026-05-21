# Session 170 Prompt: slice-0 deploy ready on Justin go-ahead; Connor field-review + P4 in queue

## Session 169 Summary

Connor was in the room. Walked through both legs of P1-Update verdict-checking against his maker-portal runs. **Net result: slice-0 schema deploy is unblocked at the gate level, pilot recompute mechanism is locked (Option A′ flow-body conditional), and the field-review handout for Connor is ready.** Three commits pushed; nothing left uncommitted except build artifacts + the intentionally-local Connor cover email.

The verdict-checker role mattered. Connor's first writeup labeled the trigger-Filter-rows result as `partial(proxy)`; by literal Step 12 it was a **FAIL** (Step 8 failed → "same results as VERIFIED" precluded). The reclassification + the FAIL routing (per `CORE_GATE.md` Step 12 "FAIL → drain-side fallback, zero schema rework") is what unblocked the schema. A ground-truth correction also landed mid-session via a fresh live-Dataverse probe: `akoya_requeststatus` (String) is a **derived** rollup, source-of-truth lives in `wmkf_phaseistatus` and `wmkf_phaseiistatus` (both Picklists). Connor confirmed the design preference is to filter on source picklist, not derived string.

Connor's second-leg run (Option A′ flow-body conditional, same day) was a clean behavioral PASS on proxy — Step 7′ + Step 9′ both green, firing-rate envelope quantified against ~40K/day per-user PA quota (<1.25% at pilot, 60% deadline-day worst case at full Phase I scale). Hazard (d) discharged for A′ at pilot scale; the audit-trail gap (no run IDs / baseline timestamps in his writeup) gets absorbed into the mandatory P4 real-schema repeat post-deploy. Connor's own analysis recommends A′→B transition before full Phase I rollout, matching the documented A+B hybrid plan in `DISCUSSION.md §0`.

### What Was Completed

1. **P1-Update verdict-check + reclassification (commit `595a27d`).**
   - `docs/INTAKE_PORTAL_ITEM_6_STATUS.md` — rewrote §1–§5 + doc map. Recorded P1-Update FAIL verdict, declared schema deploy unblocked, introduced three-way mechanism decision (Option A rejected / Option A′ pending / Option B fallback), captured the ground-truth correction on the three status fields.
   - `docs/INTAKE_PORTAL_ITEM_6_CONNOR_FLOW_BODY_RERUN.md` — new test handout drafted for Connor's A′ proposal (Steps 7′+9′ + firing-rate quantification).
   - `scripts/probe-akoya-phaseii-status-field.js` — read-only probe that established the `akoya_requeststatus` derived / `wmkf_phaseiistatus` + `wmkf_phaseistatus` source-of-truth picture.

2. **Option A′ PASS on proxy + STATUS.md update (commit `b805b65`).**
   - Synced Connor's filled-in `CONNOR_FLOW_BODY_RERUN.md` from OneDrive into `docs/`.
   - `INTAKE_PORTAL_ITEM_6_STATUS.md` — added `P1′-Update` ✅ row to the precondition table; recorded firing-rate envelope numbers + 🟡 watch-item on the per-user quota; downgraded hazard (d) to discharged-for-pilot; extended deploy sequence from 7 → 10 steps (now covers production A′ flow build + P4 real-schema repeat + A′→B transition planning).

3. **Slice-0 field-review handout for Connor (commit `ef96e48`).**
   - `docs/INTAKE_PORTAL_SLICE0_FIELD_REVIEW.md` — every field/entity that will be created on `--execute`, grouped by entity, pulled verbatim from `lib/dataverse/schema/wave4*/`. Five specific items flagged for Connor's pre-deploy eyes (underscore-in-name on `wmkf_portal_membership`, picklist integer reservations, cost-share label normalization, cascade-delete behavior, two-layer non-negative enforcement).
   - Fact-consistency exemption markers added to two lines in `CONNOR_FLOW_BODY_RERUN.md` where Connor's "300 applications" cites grant-proposal volume (false-positive against the gate's `app-definition-count` pattern that tracks `appRegistry.js`).

### Commits (S169, `main`, all pushed)

- `595a27d` Item 6: P1-Update closed as FAIL; schema deploy unblocked; Option A-prime handout drafted
- `b805b65` Item 6: Option A-prime PASS on proxy; pilot mechanism locked; A-prime to B transition planned for full rollout
- `ef96e48` Slice-0 field-review handout for Connor; fact-consistency exemptions
- (this `/stop`) — Document Session 169 + Session 170 prompt

## Potential Next Steps

### A. SLICE-0 SCHEMA DEPLOY — ready on Justin's go-ahead (destructive carryover, still pre-flight verify)
Schema deploy gate is closed. Sequence per STATUS.md §5 steps 1–6:
1. Re-run `node scripts/probe-apprequestperson-role-data.js` + `node scripts/probe-slice0-attr-collision.mjs` (must be CLEAR at deploy time, not just historically).
2. Grep live callers of slice-0 surfaces; confirm none load-bearing.
3. `node scripts/apply-dataverse-schema.js --target=prod --wave=4 --execute`
4. `node scripts/extend-apprequestperson-role-picklist.mjs`
5. `node scripts/setup-database.js` (V30 `submission_jobs`)
6. Re-run `npm run check:atlas` + 3 P0 gates.

**Justin's explicit in-session go-ahead required; nothing autonomous.** Confirm Connor has reviewed `docs/INTAKE_PORTAL_SLICE0_FIELD_REVIEW.md` before pulling the trigger — five flagged items might surface a rename or integer-shift request.

### B. CONNOR P4 — after schema deploys
Per STATUS.md §5 steps 7–9. Connor builds the production A′ flow against the now-real `wmkf_proposalbudgetline` (mirrors his proxy flow shape), then re-runs Steps 7′+9′ on real schema with the **full Step 11 artifact set** (run IDs, baseline timestamps, raw trigger-output snippets — the items his proxy writeup omitted). Verdict-check role same as S169. On PASS, A′ flow goes live for pilot. On FAIL, route to Option B alone (`$batch` drain hardening).

### C. CONNOR FIELD-REVIEW RESPONSE — keep an eye out
`docs/INTAKE_PORTAL_SLICE0_FIELD_REVIEW.md` is in his court. Five items flagged at the bottom — if he wants any of them changed (especially the picklist integer reservations or the `wmkf_portal_membership` underscore-in-name), it must happen BEFORE `--execute`. Post-deploy changes are expensive: third-party consumers (PAs, drain guards, packet builder) will start hardcoding the reserved integers.

### D. ENV-0 — Other-Mac memory propagation still unverified
Unchanged from S168/S169. On the other Mac, run the verification + recreate-as-symlink snippet from `.claude-memory/project_memory_two_stores_propagation.md`. Filesystem-local, not a repo artifact.

### E. A′→B transition planning (post-pilot infrastructure, no deadline)
Per Connor's S169 firing-rate analysis + `DISCUSSION.md §0` A+B hybrid plan. Option B (`$batch` + change sets in `lib/services/dynamics-service.js`) becomes the recompute mechanism before broader Phase I rollout. Justin/Vercel-side work. No deadline; trigger is "before scaling beyond pilot."

### F. Adjacent doc-drift gates / CANONICAL_COUNTS follow-ups / Track B Power Tools floor — UNCHANGED from S168
Don't pre-emptively build; register new scalars only when drift is observed.

## Calendar Checkpoints (soft — report factually, not "overdue")
- **2026-05-19** slice-0 deploy target — missed. **2026-05-26** dry-run / Connor field-review window. **2026-05-30** go/no-go. **2026-06-01** pilot opens. **≥2026-07-01** post-pilot drain-table drop. **Post-J26-archive** (no fixed date) — optional `wmkf_proposalurl`/`wmkf_proposalpassword` column drop.

## Gotchas (current)

- 🟢 **Slice-0 schema deploy is unblocked at gate level (S169).** Both P1-Update (FAIL) and P1′-Update (PASS-on-proxy) closed. Three-way mechanism picture: Option A rejected, Option A′ locked for pilot, Option B for broader rollout. `--execute` still requires Justin go-ahead + deploy-time probe re-runs.
- 🟢 **Ground-truth correction landed S169:** `akoya_requeststatus` (String) is a **derived** rollup; source-of-truth is `wmkf_phaseistatus` / `wmkf_phaseiistatus` (Picklists). Filter on source picklist. Probe at `scripts/probe-akoya-phaseii-status-field.js`.
- 🟡 **PA flow run quota = ~40K/day PER USER on Connor's connector.** S169 firing-rate analysis: pilot <1.25%; full 300-proposal-scale deadline-day worst case 60%. Throttling = queueing, not silent drop. Re-quantify before broader rollout if other automations live under the same account.
- 🟡 **S163 Codex `SAFE-WITH-CONDITIONS`** on Select-columns=blank was conditioned on trigger-level Filter rows scoping. Option A′ moves scoping to flow body; the validation does NOT transitively cover A′'s firing footprint. `blank` is still fine operationally; the Codex validation needs refresh if the A′ design materially shifts (e.g. dropping the parent fetch).
- 🔴 **Connor field-review on `SLICE0_FIELD_REVIEW.md` is a pre-deploy gate.** Confirm he has eyes on it before `--execute`. Five flagged items at the bottom (underscore-name, picklist integers, cost-share labels, cascade-delete, two-layer non-negative).
- 🔴 **Audit-trail gap on Connor's A′ proxy run** (no run IDs / baseline timestamps / raw trigger-output snippets in his writeup) — gets absorbed into mandatory P4 real-schema repeat post-deploy. P4 must collect the full Step 11 artifact set on real `wmkf_proposalbudgetline`.
- 🔴 **Verdict-checker discipline matters.** S169 had two instances where Connor's self-labeled verdict needed reclassification by literal rubric (`partial(proxy)` → FAIL; "Option A still viable" → A′ as redesigned mechanism). Don't soften.
- 🟢 **All other S168 gotchas still hold:** AGENTS.md symlink, slice-0 destructive-carryover classification, Codex CLI defaults, drain-table + prompt-storage gates, akoya_aka institution field, Review Manager template localStorage, memory two-stores resolved on THIS Mac via symlink.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/INTAKE_PORTAL_ITEM_6_STATUS.md` | Canonical slice-0 status — rewritten S169 to reflect FAIL on Option A + PASS on A′ |
| `docs/INTAKE_PORTAL_ITEM_6_CONNOR_FLOW_BODY_RERUN.md` | S169 Option A′ handout — now contains Connor's filled-in PASS result |
| `docs/INTAKE_PORTAL_SLICE0_FIELD_REVIEW.md` | NEW S169 — pre-deploy field-review handout for Connor; 5 items flagged at bottom |
| `scripts/probe-akoya-phaseii-status-field.js` | NEW S169 — read-only probe that established the three-status-field ground truth |
| `lib/dataverse/schema/wave4/wmkf_proposalbudgetline.json` | Slice-0 spec — DO NOT re-author |
| `lib/dataverse/schema/wave4/wmkf_portal_membership.json` | Slice-0 spec — DO NOT re-author |
| `lib/dataverse/schema/wave4-existing/wmkf_apprequestperson-roster-fields.json` | Slice-0 roster field additions |
| `lib/dataverse/schema/wave4-existing/akoya_request-intake-aggregates.json` | `wmkf_totalothersources` addition |
| `scripts/extend-apprequestperson-role-picklist.mjs` | `wmkf_role` enum 2→5 extension (ships standalone) |
| `docs/INTAKE_PORTAL_ITEM_6_CONNOR_CORE_GATE.md` | Original test handout — now history for the FAILed Option A mechanism |

## Testing

```bash
# 13 sequential gates (run in order, never parallel):
npm run check:atlas && npm run check:atlas:self-test && \
npm run check:doc-currency && npm run check:doc-currency:self-test && \
npm run check:api-routes && \
npm run check:fact-consistency:self-test && npm run check:fact-consistency && \
npm run check:canonical-pointers:self-test && npm run check:canonical-pointers && \
npm run check:drain-table-mentions:self-test && npm run check:drain-table-mentions && \
npm run check:prompt-storage-mentions:self-test && npm run check:prompt-storage-mentions

# Quick invariants:
test -L AGENTS.md && readlink AGENTS.md     # must be: CLAUDE.md
git rev-parse HEAD && git status --porcelain # iCloud .git-corruption tripwire

# At slice-0 deploy time (BOTH must be CLEAR):
node scripts/probe-apprequestperson-role-data.js && node scripts/probe-slice0-attr-collision.mjs

# Ground-truth status fields (re-run anytime to confirm):
node scripts/probe-akoya-phaseii-status-field.js

# Memory symlink check (on each Mac):
readlink "$HOME/.claude/projects/-Users-gallivan-Library-Mobile-Documents-com-apple-CloudDocs-Documents-Programming-Claude-Projects-WMKF-Apps/memory"
# Expect: <repo>/.claude-memory ; if empty → recreate per memory entry.

# Advisory (red by design):
npm run check:memory-drift:no-write
```
