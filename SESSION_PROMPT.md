# Session 425 Prompt: Codex builds Phase A of the manual respond-by nudge

## Session 424 Summary

Two unrelated threads. The first shipped to production: referrer names were being
truncated on save, and the referrer was invisible on the candidate card. The
second started as "why aren't reminders sending?" and ended by finding a
token-resurrection defect, a wrong claim in my own plan, and a broken evidence
chain in my own probe.

### What Was Completed

1. **Fixed referrer-name truncation (PRODUCTION).** The referrer captured in "Add
   or Refer a Reviewer" has no Dataverse field (S249 D1) — it is encoded into the
   match reason as `Referred by {name}.` and reparsed on reload. The clause and
   the note were space-joined, so the decoder could not tell the name's
   terminating period from one inside the name. `Dr. Abby Doyle` round-tripped as
   `Dr` — and that is the field's own placeholder text. The clause now owns line 1
   with a newline terminator; encode/decode is one helper trio in
   `lib/utils/reviewer-provenance.js` and all three producers plus the single
   consumer route through it. Mutation-tested: reverting either half fails the
   suite.

2. **Labeled the referrer on the Invite card (PRODUCTION).** `CandidateRationale`
   splits the stored reason so `Referred by: Mikhail Shapiro` is its own row
   instead of prose inside "Why:". Both halves optional — the production shape is
   a referrer with no note, which would otherwise leave a bare "Why:" label.

3. **Diagnosed why no respond-by reminders have ever sent.** The cron is
   scheduled daily and has never fired: `wmkf_respondreminderenabled` is `null`
   on every request and no UI can set it. Built
   `scripts/probe-respond-reminder-gates.js` (read-only) because the dry-run
   endpoint collapses six skip reasons into one counter. Probe attributes each row
   to the first gate that closes, projects the blast radius with
   `--assume-enabled`, and audits token state independently of the ladder.

4. **Found a token-resurrection defect.** Removing a candidate writes
   `selected=false` + `tokenRevoked=true`; the respond sweep filters on neither,
   and sending mints first — and minting clears the revoked flag. Worse than first
   described: removal ALSO writes `accepted=false, declined=false,
   responsetype=null`, which is exactly the shape the respond sweep selects. It
   manufactures the matching row.

5. **Codex adversarial review; both `[high]` findings confirmed and applied.**
   §2's original defect claim was wrong (I read the caller's docblock instead of
   the `softDelete` implementation — the shipped review-due sender is NOT
   vulnerable), and the scope missed the other `mintAndStore` callers. Codex
   rewrote the plan; reviewing that rewrite surfaced a bug of mine: the probe
   advertised `--output <path>` but parsed only `--output=<path>`, so no artifact
   was ever written and the plan cited a file that never existed.

### Commits

- `310aa7a3` - Stop truncating referrer names that contain a period
- `0f30f370` - Label the referrer on the candidate card instead of burying it in prose
- `6db259d2` - Reconcile the referral-clause docs with the display split
- `23ec5d3e` - Record the recheck marker the staleness guard asks for
- `ddd9755a` - Merge: referrer truncation fix + labeled card
- `48aea0d5` - Correct the staleness-ack memory's drifted line numbers and failure mode
- `70160c46` - Add a read-only probe attributing respond-reminder skips to a specific gate
- `e6b074f7` - Let the reminder probe project the blast radius without arming anything
- `a2c8a4ad` - Report invitation-link state independently of the gate ladder
- `39b2097a` - Fix a probe overclaim: distinguish "no token" from "no expiry bound"
- `2b80a447` - Measure whether revoked reminder targets were removed from their proposals
- `66f9ef41` - Plan the manual respond-by nudge, gated on a removed-candidate fix
- `16c3e8ef` - Split the nudge plan into phases and fix the probe flag that broke its evidence

### Gotchas Worth Carrying

- **Read the implementation, not the caller's docblock.** `my-candidates-service.js`
  describes removal as "wmkf_selected=false + wmkf_externaltokenrevoked=true".
  `softDelete` actually writes six fields. That summary cost a wrong `[high]`-level
  claim in a plan doc, caught only by Codex.
- **A probe that cannot fail closed is not a probe — and neither is one that
  cannot write its evidence.** Two separate defects in the same script: labeling a
  null expiry `never_minted` without reading the hash (conflating "no access" with
  "no expiry bound"), and a `--output` flag that silently never fired.
- **Minting clears revocation.** `setExternalToken` always writes
  `wmkf_externaltokenrevoked: false`. Any send path that mints can resurrect a
  withdrawn reviewer's access.
- **The staleness guard clears on a marker, not on a fix.** Reconciling the prose
  does not stop it re-firing; only a single line carrying both the path and
  `[RECHECKED after … change:` does. Recorded in
  `.claude-memory/reference-staleness-ack-single-line.md`.
- **`scope-claim-reminder` has two false positives** — a `## N. Scope` heading
  parses as a numeric coverage claim, and its own prescribed `TBD count` escape
  text reads as uncertainty. Both recorded in the pilot directive.

## Next Items

### Verified Open

1. **[VERIFIED OPEN] Phase A of the manual respond-by nudge — Codex leads, Claude
   reviews.** Owner directive S424. Scope, design, and verification table are in
   `docs/REVIEWER_MANUAL_RESPOND_NUDGE_BUILD_PLAN.md` §0/§3/§4/§5. Ship the nudge
   plus selected/revoked guards on both manual paths. Do NOT arm
   `respondReminderEnabled`.

2. **[VERIFIED OPEN] Phase B — mint-surface hardening.** Separate change, own
   review. `ensureToken`, `send-emails-service:674`, `regenerate-token-service:93`
   all mint without a selected/revoked check. Pre-existing exposure; the
   resurrection invariant is NOT closed until this lands. Evidence: the
   mint-surface audit table in the plan.

3. **[VERIFIED OPEN] The respond-by cron is unsafe and must not be armed.**
   Removal manufactures the exact row shape it selects. Needs `wmkf_selected` and
   revocation filters before `respondReminderEnabled` is ever exposed or set.
   Evidence: `lib/services/reviewer-reminder-sweep.js:106-113`, `:146-149`.

4. **[VERIFIED OPEN, carried from S423] The merge cascade is still
   non-transactional.** `hardDeleteById` (`reviewer-merge.js:448`) permanently
   deletes colliding loser rows with no compensation.

5. **[VERIFIED OPEN, carried from S423] The slot-binding half of the ETag question
   is unverified.** Needs a controlled sandbox write.

6. **[VERIFIED OPEN, re-checked 2026-08-13 in S423] Repair `computeCanManage`
   rather than delete it.** `shared/components/reviewers/reviewer-modes.js:95-97`.

7. **[PARTLY CLOSED 2026-08-13 (S425)] SharePoint retention/permission evidence.**
   The PnP.PowerShell route is **dead — do not retry it.** It failed twice over:
   the module would not install (Gallery CDN firewalled) and delegated sign-in was
   refused at the tenant consent screen for both `AllSites.FullControl` and
   `AllSites.Read`; a delegated token is capped at the signed-in user's rights
   regardless, and SPO Management Shell passes the same gate. The questions went
   to Dragonfly IT instead, which is the working route.

   **Answered:** version limits (major only, no time limit, keep 500 — the
   platform default); second-stage recycle bin (**exists**, reversing the S413
   "none"; 93 days from original deletion, `dftadmin`-only restore); ordinary-editor
   permissions (**Members hold `Edit`** — they CAN delete files and version
   history, and `Manage Lists` puts the version limit in their reach).

   **Owner context 2026-08-13 that re-scopes two things — read before acting.**
   Board-bound documents are captured in **Diligent**, which timestamps them and
   generates exportable Board Books, so **Diligent is the system of record for
   what the Board received** and the milestone-snapshot work is narrower than the
   docs assumed. And these documents carry **no regulatory retention
   obligation** — Purview was never a compliance gate. What the SharePoint
   deletion exposure still threatens is **mid-cycle work loss and version
   provenance**, not the institutional record.

   **[VERIFIED OPEN] Still needed, in priority order:**
   - **Does the `Request` library inherit site permissions?**
     (`HasUniqueRoleAssignments`). Members contains `Everyone except external
     users`, so `Edit` reaches every licensed internal account at *site* scope —
     this answer decides whether that reaches the governed documents. Connor has
     gone back to IT for it.
   - **Was the site deliberately created with Public privacy?** One field, and it
     explains whether the EEEU grant was a decision or the platform default.
   - **Confirm IT's past tense** — they wrote the group *"had"* Edit and did not
     confirm nothing changed during the check. Connor has asked.
   - **Version policy on `RequestArchive2` / `RequestArchive3`** — only `Request`
     and `RequestArchive1` were read (n=2 of 4), and a proposal can live in any
     of the four.
   - **Purview retention — LOW priority, not a gate.** No regulatory obligation
     applies, so a policy would be a protective mechanism nobody is counting on.
     Needs an M365 compliance admin if ever wanted; Connor and Dragonfly IT are
     both the wrong owner. Do not spend a round-trip on it ahead of inheritance.
   - **Board milestone snapshot producer** — still unbuilt, and now an **owner
     decision, not a build task**: the copy-the-bytes choice stands, but Diligent
     covers the institutional-record case that justified it, so confirm it is
     still worth building before scheduling. Do not treat this as a reversal.

   Draft follow-up questions for Dragonfly are in
   `outputs/sharepoint-followup-questions-for-dragonfly-2026-08-13.md`
   (gitignored, local only).

### Owner Decision Needed

1. **Expose the campaign-settings reminder toggles at all?** Deferred this session
   in favor of the manual nudge. Arming them is unsafe until Phase B and the cron
   filters land. Evidence: plan §0, §3 "Out".

2. **Execute the phantom co-PI remediation?** Unchanged from S423/S424.

3. **Should `merge-candidates` remain organization-open?** Unchanged.

### Verify Before Acting

1. **The production scale figures in the nudge plan are `[ASSUMED]`.** The probe
   never wrote its artifact (`--output` bug, fixed `16c3e8ef`); the numbers came
   from session stdout. Re-run to re-measure — `outputs/` is gitignored, so the
   artifact is local-only.

2. **`tokenAudit.unselectedButStillMatched` was added but never read.** The probe
   now measures whether revoked rows are removed candidates vs staff cutoffs; that
   reading is pending. The Phase A fix does not depend on it.

3. **Requests 1002146 / 1002379 are last cycle and must never be nudged.**
   Currently blocked only incidentally (null offset). Both show `no_token`, so no
   accept-today hole. Confirmed S424.

4. **The probe's gate ladder is a hand-kept copy** of `sweepRespondReminders`. If
   that sweep changes, re-verify the annotations or delete the probe.

### Parked

1. Per-reason `skipped` counters in the cron sweep. Would make the dry-run
   endpoint self-diagnosing; deferred with the rest of the cron work.
2. Sticky per-user reminder defaults (`INVITE_TIMING` extension). Superseded by
   the manual-nudge direction.
3. Excel export still carries the full match-reason blob including the referral
   clause. No data lost; differs from the card now.
4. Invite-tab surfacing of needs-merge alerts; exact activity ledger; staff review
   before grantee co-PI display; bespoke per-invitation due date. All carried.

### Do Not Reopen Without New Decision

1. **Arming `respondReminderEnabled` before Phase B.** Would email removed
   reviewers and restore their revoked links.
2. **Deleting `computeCanManage`.** Repair the fail-open branch instead.
3. **Removing the Step 7 pre-deactivate re-check in the merge.**
4. **Changing application code for the phantom co-PI.**
5. **Reinstating a block on any `respondBy` condition in the invitation timeline.**
6. **Re-encoding the referrer as a space-joined match-reason prefix.** The line-1
   contract exists because the space form is genuinely ambiguous.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/REVIEWER_MANUAL_RESPOND_NUDGE_BUILD_PLAN.md` | Phase A/B split, mint-surface audit, decision contracts |
| `scripts/probe-respond-reminder-gates.js` | Read-only gate attribution, blast-radius projection, token audit |
| `lib/services/reviewer-reminder-sweep.js` | Both sweeps; `sendOneReminder` claim-before-send at `:283-294` |
| `lib/services/reviewer-manual-reminder.js` | Shipped manual review-due sender; eligibility at `:74-89` |
| `lib/dataverse/adapters/reviewer-suggestion.js` | `setExternalToken` `:209-217` (clears revocation); `softDelete` `:1951-1959` |
| `lib/utils/reviewer-provenance.js` | Referral clause encode/decode/split trio |
| `shared/components/reviewers/ReviewerInvitePanel.js` | `CandidateRationale`; also renders `removedCandidates` |

## Testing

```bash
npx jest tests/unit                                   # 584 suites / 7461 tests
npm run check:types

# Read-only. HAND TO THE USER — do not run it yourself.
DATAVERSE_ALLOW_PROD_READS=yes node scripts/probe-respond-reminder-gates.js \
  --target=prod --assume-enabled --output outputs/respond-reminder-gates.json
```
