# Session 295 Prompt: Pick the next thread (contact-boundary epic is done)

## ⚠️ Top-of-session must-knows

1. **The reviewer↔CRM-contact boundary epic SHIPPED COMPLETE in S294** (13 commits, all
   prod-pushed). Do NOT re-open or re-plan it. Every reviewer correction now either **syncs**
   to the contact (name/title/nickname, overwrite) or **alerts** staff (email, affiliation).
   Full decision record + reversals: `docs/REVIEWER_CONTACT_BOUNDARY_GAP_FINDINGS.md`.
2. **Alert-only is a deliberate owner decision for email + affiliation** — do NOT "upgrade"
   them to contact writes without a new decision. Affiliation specifically REJECTED
   account-resolution (no account name-search precedent; `parentcustomerid` is a COI-weighted
   cross-domain lookup with no write precedent — a wrong-account link is high-harm/low-yield).
3. **The accept path now does several contact writes + alerts.** A real-prod reviewer accept
   fires AkoyaGo plugins + classic workflows + a contact→Business-Central sync + live Bill.com
   — MOCK the data layer in automated tests; real-prod accept is human-supervised, gated on the
   PA owner (Connor). Hazard: memory `project-reviewer-accept-prod-automation`.
4. **Known-red suites (unchanged):** `tests/unit/bill.test.js` and
   `tests/unit/discovery-verification-status.test.js` only. Confirm any red is ONLY these.
5. **Delegating a BUILD to `codex:codex-rescue`:** launch a FRESH agent whose prompt is
   explicitly an implementation/fix ("Implement and APPLY…"). Do NOT frame it "plan only" and
   then resume-to-implement — the read-only sandbox is fixed at launch and a resume can't flip
   it (S294 lost a round-trip to this). Memory: `reference-codex-rescue-plan-task-runs-readonly`.
6. **Staging norm:** stage specific files, never `git add -A` (names-local norm).

## Session 294 Summary

Shipped the **entire reviewer↔CRM-contact boundary epic** in one session — six owner-gated
increments, Codex-implements / Claude-reviews loop throughout, each with my own
lifecycle/provenance trace on the diff before landing. Two build decisions were reversed by
verifying before building (nickname's "no clean target" was wrong → it shipped; affiliation's
account-resolution → downgraded to alert-only). Full suite green except the two known-red
suites at every step; all drift/wiki/fact gates green.

### What Was Completed (all prod-pushed)

1. **Increment 1 — origination match + honorarium split guards** (`35693cf2`). `save-candidates`
   runs `lookupReviewerIdentity` before upsert → `setContactLink` on a confident unique
   ORCID/email match; ambiguous/conflict → save unlinked + `reviewer_contact_match_needs_review`
   alert. `ensureContact` cross-checks ORCID on an email HIT (email→A vs unique ORCID→B →
   `contact_orcid_email_split`, proceeds with email contact, never overwrites `emailaddress1`).
2. **Increment 2a — name/title sync** (`027fe256`). Reviewer self-reported first/last/title
   OVERWRITE `contacts.firstname/lastname/jobtitle` on accept (silent, fail-open).
3. **Gate relaxation + nickname** (`a073dd35`). Dropped the `wmkf_identitystatus` gate (token
   proves identity) for a fail-closed `trusted:true`; added nickname → `contacts.nickname`.
4. **Email alert** (`3ce2607c`). Accept email ≠ contact `emailaddress1` → durable
   `reviewer_contact_email_mismatch` staff alert (NO write).
5. **Affiliation alert** (`fa15ee4b`). Reported affiliation differing from the contact's
   institution (parentcustomerid FormattedValue / `adx_organizationname`) → durable
   `reviewer_contact_affiliation_mismatch` staff alert (NO write). Account-resolution rejected
   after verification.
6. **Memory:** `reference-codex-rescue-plan-task-runs-readonly` (the read-only-sandbox lesson).

### Commits (newest first)
- `6c03cc8b` / `fa15ee4b` - affiliation alert + doc reconcile
- `4986de69` / `3ce2607c` - email alert + doc reconcile
- `cb5e3d97` / `a073dd35` - gate relaxation + nickname + doc reconcile
- `661b40ca` - codex read-only-sandbox memory
- `caf80748` / `027fe256` / `63ac0cab` - Increment 2a (reconcile / impl / decisions)
- `67e6f614` / `35693cf2` / `d16c5a95` - Increment 1 (reconcile / impl / decisions)

## Potential Next Steps

### 1. PD-override-correction sync (the contact-boundary epic's one genuinely-open tail)
[VERIFIED OPEN — not started] PD identity-override corrections land on
`wmkf_potentialreviewers`/`wmkf_appresearcher` via `save-candidates` (the `pdConfirmed` path),
NOT the accept path, so the S294 sync/alert work does NOT cover them. Syncing/alerting these to
the linked contact is a separate trigger (different file, different timing — there may be no
contact link yet at save time). Needs its own owner decisions (sync vs alert; which fields).
Logical continuation if you want to keep closing the boundary.

### 2. Long-stale carryovers — VERIFY-FIRST, do NOT assume open (untouched since before S294)
- S288: record model real-replay human sign-off in `docs/MODEL_CHANGE_STRATEGY.md`
  (reviewer-finder already pinned to `claude-opus-4-8` in prod); Admin Models visual smoke.
- S285/S286: request `1002788` test-data triage; E2E of Restore Removed Candidates + PD identity
  override; reviewer-portal review-upload design decision.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/REVIEWER_CONTACT_BOUNDARY_GAP_FINDINGS.md` | Full epic decision record (all 6 increments, the two reversals, §Policy Decisions + §Increment 2a). |
| `lib/services/sync-reviewer-name-title-to-contact.js` | name/title/nickname OVERWRITE sync; fail-closed `trusted:true`. |
| `lib/services/alert-reviewer-email-mismatch.js` | `reviewer_contact_email_mismatch` (no write). |
| `lib/services/alert-reviewer-affiliation-mismatch.js` | `reviewer_contact_affiliation_mismatch`; reads contact institution via processed `_parentcustomerid_value_formatted` (annotation) → `adx_organizationname` fallback. |
| `lib/dataverse/adapters/contact.js` | `updateIdentityFields` (overwrite name/title/nickname); `normalizeEmail` (now exported). |
| `pages/api/external/review/[token]/respond.js` | Accept-path orchestration of the ORCID capture + all four sync/alert calls (each in a fail-open try/catch). |

## Testing

```bash
# Full suite — expect ONLY the two known-red suites:
npm test
# The S294 contact-boundary units:
npx jest tests/unit/sync-reviewer-name-title-to-contact.test.js \
  tests/unit/contact-update-identity-fields.test.js \
  tests/unit/alert-reviewer-email-mismatch.test.js \
  tests/unit/alert-reviewer-affiliation-mismatch.test.js \
  tests/unit/reviewer-route-identity-gate.test.js \
  tests/unit/honorarium-onboard-orchestrator.test.js
```

## Gotchas / Continuity

- Any NEW caller of `syncReviewerNameTitleToContact` MUST pass `trusted: true` — it's fail-closed
  (returns `{skipped:'untrusted'}` otherwise). The accept path is the only sanctioned caller.
- The affiliation alert reads the contact institution from the **processed**
  `_parentcustomerid_value_formatted` key (DynamicsService.processAnnotations strips the raw
  `@OData…FormattedValue` and appends `_formatted`). `context.js:335` reads the RAW key — that's
  effectively dead code there (latent, lowest-priority prefill); NOT fixed in S294 (out of scope).
- Email + affiliation are ALERT-ONLY by owner decision. Don't convert to writes without a decision.
- Heavy Codex-implements / Claude-reviews loop; relay Codex output verbatim.
