# Reviewer ORCID Back-Propagation Design (S216)

**Status:** DESIGN — pre-implementation. Awaiting Codex pre-impl review.
**Author:** S216. **Depends on:** S214/S215 identity resolver + ORCID backfill
(`docs/REVIEWER_IDENTITY_RESOLVER_PHASE2_DESIGN.md`, memory
`project-reviewer-identity-resolution-phase1`).

## 1. Problem & goal

The S215 backfill wrote authoritative ORCIDs to **1,533** `wmkf_potentialreviewers`
rows. The S216 cross-store probes (`scripts/probe-orcid-cross-store-matches.js`,
`probe-orcid-contact-direct-join.js`, `probe-contact-orcid-provenance.js`) measured
ORCID's *current* cross-store power as modest because the **far side of each join is
ORCID-sparse**: only 18 reviewer ORCIDs appear in `contact`, and `contact`'s 423
ORCID values are a largely-disjoint GOapply *applicant* population (52% are PIs via
`wmkf_projectleader`).

**De-fragmentation is therefore a FLOW problem, not a one-shot collapse**
(memory `reviewer-identity-fragmentation`). This design makes the reviewer-pool
ORCIDs **flow onto their matched `contact` rows** so `contact.wmkf_orcid` becomes a
durable cross-store join key over time — without creating or polluting contacts.

### Non-goals (explicit scope fences)
- **No contact creation.** The ~1,350 reviewers with no existing contact match stay
  unmatched. Creating contacts = registry pollution (fragmentation memory: "de-dupe +
  curation, not creation"). Out of scope.
- **No auto-promotion.** Back-propagation must NOT set the reviewer→contact link
  (`wmkf_Contact` / `_wmkf_contact_value`). That pointer means "staff engaged this
  reviewer" (set only in `send-emails.js` outreach). Sharing an email ≠ engagement.
  ORCID flows to the contact field; the pointer stays unset until real outreach.
- **No bibliometric propagation.** `contact` has only `wmkf_orcid` (no `wmkf_orcidurl`,
  no identity-status fields). We write the bare iD only; no new contact schema.
- **No writes to `akoya_request`.** Honorarium rows carry no ORCID field; the reviewer
  person lives in the linked `contact`, covered by contact back-prop.
- **No reviewer-side import.** We do NOT pull GOapply applicant ORCIDs into the reviewer
  pool here (applicants ≠ reviewers, mostly). Possible future, separate design.

## 2. Eligibility gate (correctness-critical)

Only propagate a reviewer ORCID when the resolver verdict on that row is trustworthy:

> **Eligible iff** `wmkf_orcid` is present AND `wmkf_identitystatus ∈ {confirmed, probable}`.

Rationale: the S214/S215 persistence gate already blocks ungated ORCID writes and the
S214 remediation *cleared* wrong-match ORCIDs (Noe→Clementi). But reading
`wmkf_identitystatus` rather than trusting field-presence is defensive against any
pre-gate legacy value still sitting on a row. The status field is on the same row
(written by `researcher.writeIdentityDecision`, S214).

## 3. Matching: reviewer → contact

For each eligible reviewer, resolve the target contact in this precedence:

1. **Already linked** — `_wmkf_contact_value` set → use that contactid directly
   (0 today; the runtime path below creates these going forward).
2. **Email match** — `contact.emailaddress1 == wmkf_emailaddress` (case-insensitive,
   trimmed). 183 today. If email matches **>1 contact → ambiguous, skip + log**
   (duplicate contacts; do not guess).
3. No contact → skip (non-goal: no creation).

ORCID normalization (shared with the probes): extract the canonical
`\d{4}-\d{4}-\d{4}-\d{3}[\dX]` iD; compare case-insensitively.

## 4. Conflict policy on the target contact (correctness-critical)

Per matched contact, branch on its **current** `contact.wmkf_orcid` (re-read
immediately before write — see §6 TOCTOU):

| Contact ORCID state | Action |
|---|---|
| empty / null | **WRITE** the reviewer's ORCID (the happy path) |
| same iD (normalized) | no-op |
| **different valid iD** | **DO NOT overwrite** — log conflict. Two authoritative-but-different ORCIDs for one email is a real identity problem; the applicant self-reported theirs at GOapply intake, ours is resolver-derived. Surface, never clobber. |
| **malformed** (one of the 14) | skip + log for manual cleanup. Never auto-overwrite (could be a typo of a real iD). |

We **only ever fill an empty contact ORCID.** This makes the operation safe and
idempotent and respects GOapply as an authoritative self-report source.

## 5. Two mechanisms

### PR1 — Runtime forward-flow (the durable fix)
At contact promotion in `pages/api/review-manager/send-emails.js` (the
`findOrCreateByEmail` → `setContactLink` block, ~L300-312):
- Add `wmkf_orcid,wmkf_identitystatus` to the `person` select (currently L145 lacks
  both).
- After the contact is found/created and linked, if the reviewer is **eligible (§2)**,
  call a new `contactAdapter.setOrcidIfAbsent(contactId, orcid, { actingUserSystemId })`.
  Non-fatal (same try/catch posture as promotion — the email already shipped).
- `setOrcidIfAbsent` re-reads the contact's current `wmkf_orcid` and applies §4
  (writes only when empty; conflict/malformed → return a status, no throw).

Audit the workbench paths too: `pages/api/workbench/enrich-recommended.js` and the
Candidates invite path. If either promotes (sets `wmkf_Contact`), wire the same hook.
(Confirm during impl — they may route through `send-emails` already.)

### PR2 — One-shot historical backfill (the existing 183)
New `scripts/backfill-contact-orcid.js`, mirroring `backfill-orcid-identity.js`'s
resumable two-phase shape:
- `--resolve` (read-only): for every eligible reviewer, resolve target contact (§3),
  classify against current contact ORCID (§4), emit `scripts/.contact-orcid-backfill.jsonl`
  (gitignored — person data) with `{reviewerId, email, orcid, status, contactId,
  action: write|noop|conflict|ambiguous|nocontact}`.
- `--summary`: tally the JSONL without writing.
- `--apply`: write only `action==='write'` rows via `setOrcidIfAbsent` (re-reads → still
  safe if state changed since `--resolve`). Resumable checkpoint (gitignored).
- Writes through `bypassDynamicsRestrictions('backfill-contact-orcid', …)` with the
  same gated adapter path production uses.

## 6. Safety / idempotency
- **TOCTOU**: `setOrcidIfAbsent` re-reads the contact's `wmkf_orcid` at call time and
  only writes when still empty. Single-operator backfill + non-concurrent runtime
  promotion make races near-impossible, but the re-read makes a stale `--resolve`
  snapshot harmless (real-fix posture, not design-note — memory `feedback-real-fix-not-design-note`).
- **Idempotent**: re-running either mechanism is a no-op once written (same-iD branch).
- **Reversible**: only ever fills empty fields; never overwrites. A bad write is a
  cleared field, not lost data. No schema change to roll back.
- ORCID is 19 chars — no field-cap concern.

## 7. Verification / metrics
- Pre/post `count(contacts where wmkf_orcid ne null)` — expect **+~183 − conflicts −
  ambiguous**.
- Re-run `scripts/probe-orcid-contact-direct-join.js` — direct-join overlap should rise
  from 18 toward ~183+.
- Backfill JSONL tallies: written / noop / conflict / ambiguous / nocontact.
- Unit tests: `setOrcidIfAbsent` (all four §4 branches); promotion-hook eligibility
  gate (skips `unresolved`/missing-status, writes on `probable`/`confirmed`); ambiguous
  multi-contact skip.

## 8. Open decisions for review
1. **Auto-promotion** — current design says NO (keep `wmkf_Contact` = engagement).
   Confirm; the alternative (set the pointer during back-prop) makes the join O(1) but
   muddies promotion semantics.
2. **Conflict surfacing** — log-only for the pilot, or write conflicts to a review
   queue / alert? Default: log + JSONL; revisit if conflict count is non-trivial.
3. **Optional `contact.wmkf_orcidsource`** — a provenance marker to distinguish
   reviewer-resolved from GOapply-self-reported ORCIDs. Deferred (schema-minimization),
   but cheap if wanted.

## 9. Phasing
- **PR1**: `contactAdapter.setOrcidIfAbsent` + send-emails promotion hook + person-select
  fields + unit tests.
- **PR2**: `backfill-contact-orcid.js` (resolve/summary/apply) + metrics; run it.
- **PR3 (later, separate)**: carry ORCID through the intake portal applicant-suggested
  reviewer capture so the flow closes at intake, not just at outreach.
