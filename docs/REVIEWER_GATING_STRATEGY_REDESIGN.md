---
title: "Reviewer Fail-Closed Gating — Strategy Verdict and Redesign"
domain: reviewers
kind: spec
status: active
summary: "Per-gate over-gating verdict + redesign recovering or surfacing all 5 Cause #2 email misses without opening a wrong-person send path."
canonical: false
cataloged: 2026-07-03
owner: product-engineering
related:
  - docs/REVIEWER_GATING_STRATEGY_REVIEW_PROMPT.md
  - docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md
  - docs/RESOLVED_PAGE_EMAIL_TIER_DESIGN.md
  - docs/REVIEWER_CONTACT_LEADS_SPEC.md
  - docs/REVIEWER_EMAIL_PERSIST_FIX_PLAN.md
  - lib/services/contact-enrichment-service.js
  - lib/utils/contact-parser.js
  - lib/utils/reviewer-invite.js
  - pages/api/reviewer-finder/save-candidates.js
  - pages/api/review-manager/send-emails.js
---

# Reviewer Fail-Closed Gating — Strategy Verdict and Redesign

Produced per the brief in `docs/REVIEWER_GATING_STRATEGY_REVIEW_PROMPT.md`. Every
current-behavior claim below was verified against live source this session
(2026-07-03); line numbers are live as of commit `73d017aa`. Guiding principle
applied throughout (per the brief §1): the harm to prevent is **sending** to the
wrong person; the safe default for uncertainty is **surface for one-click staff
confirm**, not silent drop. The send-time confirm gate (Contract 3) is the true
backstop.

## 1. Verdict on the strategy

**The gate *policies* are individually defensible; the system over-gates because two
gates consume the wrong input or fire at the wrong stage, and because the discard
destination (quarantined "rejected leads") is a dead end in practice rather than a
resolution lane.** The architecture is closer to sound than the presenting symptom
suggests: evidence is already collected non-destructively (`tierResults`,
`rejectedEmail`), adjudication already mostly happens once at the end of the
pipeline (`_finalize`), and a staff promotion lane already exists (contact leads
Slice 4). The corner we painted into is narrow and fixable: see §2.

Per-gate answers to the brief's §2 questions — (a) right policy? (b) right
stage/order? (c) right input?

| Gate | (a) policy | (b) stage | (c) input | Verdict |
|---|---|---|---|---|
| Contract 1 — client/server identity asymmetry (`save-candidates.js:60–71`; `ReviewerSearchSection.js:857`) | ✓ | ✓ | ✓ | **Sound; keep.** The asymmetry is deliberate and documented in-code (`save-candidates.js:51–59`): the client hides ungrounded rows; the server hard-rejects only the explicit-unresolved triple because direct callers bypass the client. Not implicated in the email misses. |
| Contract 3 — invite-confidence allowlist (`reviewer-invite.js:94–112`; `send-emails.js:374–392`) | ✓ | ✓ | ✓ | **Sound as the backstop — but the confirm UI is weaker than documented.** `InviteEmailModal.js:233–243` confirms ALL low-confidence recipients with one batch `window.confirm`, not per-recipient. Must be strengthened before routing more volume through it (§3.4). Note: the ladder is binary high/low; no "medium" exists at send time. |
| Contract 6 — OpenAlex verified-domain sourcing (`contact-enrichment-service.js:864–874`) | ✓ | ✓ | ✗ | **Sourcing is fine; single-domain *trust* is the defect.** `verifiedInstitutionDomain` is one eTLD+1 from the OpenAlex author's last-known institution — a real researcher has several valid affiliations, and OpenAlex mis-maps (both observed live, Cause #2 cases 1–2). Fan-out is fully contained: the field's only product-code consumers are the two email guards below (grep-verified this session; never persisted, never read by save or COI). |
| Email guard A — `_validateEmailAgainstVerifiedDomain` (`contact-enrichment-service.js:300–338`) | ✓ | ✓ (runs once, end of pipeline, `:1135`) | ✗ | **Wrong input + wrong discard destination.** Validates against the single Contract-6 domain, ignoring the affiliation signals the pipeline already collected (`candidate.affiliation`, `ce.orcidAffiliation`, `ce.openAlexAffiliation`). On contradiction it nulls the email into a *rejected* lead (`:326–337`) — technically visible, practically a dead end (collapsed behind a "weak/rejected" toggle, `ContactLeads.js`). Redesign §3.1–3.2. |
| Email guard B — `isNameConsistentEmail` hard reject (`contact-parser.js:232–299`; fired at `contact-enrichment-service.js:635`, `:696–711`) | ~ (right for *unanchored* results) | ✗ | ✗ (as a *hard* signal) | **Mis-sequenced and over-weighted.** Fires inline per-tier, BEFORE `verifiedInstitutionDomain` exists (set later in `_finalize` at `:874`) — so the evidence that vindicates a truncated-surname/initials address on the person's own domain is structurally unavailable when the gate fires. The code already states the correct principle for the page tier: domain+page grounding is "the trust gate — NOT isNameConsistentEmail" (`:997–1001`). Generalize it. Redesign §3.3. |
| Contract 7 — resolved-page fetch tier (`contact-enrichment-service.js:1064–1117`, flag-gated) | ✓ | ✓ (in `_finalize`, before guard A) | ✗ | **Right shape, same wrong input.** SSRF-bound to the single `verifiedInstitutionDomain` (`:1068–1069`, `:1081`), so it inherits Contract 6's defect: for Cause #2 cases 1–2 it would refuse the correct page even if enabled. Bind it to the validated domain *set* instead (§3.5). Default-off flag state in prod is an owner decision, unchanged here. |

Adjacent contracts (assess-only per the brief §5) — verified live this session:

- **Contract 2** (exempt-kind contact force-null, `save-candidates.js:83–86`, applied `:238`): fires by design on unverified cited/PI-named/referred rows and *can* null a correct email — but it is the intended anchor-or-abstain posture with two working recovery paths (PD identity confirm; validated referred-seed anchor). Not implicated in the five Cause #2 cases (all were enrichment-path). **No redesign.**
- **Contract 4** (structured-PI, `proposal-pi-identity.js:125+`): confirmed fail-open, augment-only; cannot drop an email or candidate. **No redesign.**
- **Contract 5** (institution-COI hard drop, `save-candidates.js:208–218`; `deduplication-service.js:278–288`, `:351–360`): consumes a *different* input from the email guards (lexical affiliation-NAME match, not the domain field) — but it derives that name from the same OpenAlex last-known-institution resolution, so **an OpenAlex affiliation mis-map can wrongly hard-drop an entire correct candidate** (the candidate-level analog of Cause #2 case 2). Not implicated in the five email cases; flagged as a residual risk and follow-up (§5). **No redesign here.**
- **Contract 8** (work-grounding rescue, `reviewer-identity-evidence.js:212–285`): confirmed purely additive (every branch promotes-an-abstain or abstains; `:271` never promotes on partial evidence). **No redesign.**

## 2. The corner

One architectural decision trades recall for a safety property we largely already
get elsewhere:

**Single-source affiliation trust feeding silent hard discards.** OpenAlex
last-known-institution — a noisy, single-valued signal — is treated as ground truth
at two hard-consequence points (email guard A's contradiction null; the fetch
tier's SSRF allowlist), while the pipeline's *other* affiliation evidence
(discovery affiliation, ORCID affiliation) sits unused beside it on the same
object. The safety property the null buys (namesake-collapse protection) is
already substantially provided by: the identity-anchor requirement before paid
search runs (`contact-enrichment-service.js:584–586`), the anchor-contradiction
reject (`:603`, `:683`), and — decisively — the send-time confidence gate. So the
marginal safety of *silently dropping* (vs. surfacing-contested) is small, and the
recall cost is measured: 4 of the 5 Cause #2 misses.

A second, smaller corner: **a hard gate firing before its evidence exists** (guard
B inline per-tier, domain known only at `_finalize`). The "collect-all-then-
adjudicate" architecture the brief hypothesizes is in fact *mostly built* — tier
evidence is preserved non-destructively (`rejectedEmail`, `tierResults`) and
`_finalize` is the single adjudication exit. Inline rejection carries one real
safety property worth keeping: a name-mismatched tier-3 email must not block
tier 4 from finding a better one (the inline null enables the tier-4 retry at
`:671`). The fix is therefore not to move collection — it is to add a final
re-adjudication of preserved rejects at `_finalize`, where the full evidence
set exists. No safety property is lost.

What is explicitly NOT a corner: the leads quarantine (Slices 1–5) was the right
compensating-control skeleton — it just files *plausibly-correct* emails in the
same "rejected" drawer as true wrong-person contacts, with no confidence
distinction and weak placement in the staff workflow.

## 3. Concrete redesign

Ordered by leverage; each loosening names its compensating control. The shared
mechanism is one new email state:

**"Contested" email state (new).** An email the guards would previously null is
instead *kept and persisted* with `emailSource` stamped `search_contested` (plus
`contactStatusReason` recording which guard contested it and why). Fail-closed by
construction at every downstream boundary:

- Send time: `search_contested` is not in `HIGH_TRUST_EMAIL_SOURCES` nor
  `ANCHORED_SEARCH_EMAIL_SOURCES` (`reviewer-invite.js:82–84`), so `emailConfidence`
  returns LOW *today, with zero code change* ("Unrecognized address source" →
  `reviewer-invite.js:110`). Add an explicit branch with a human-readable reason
  ("Found by search but contradicts the candidate's OpenAlex institution — confirm
  before sending"), but the default is already refuse-without-confirm.
- Save time: `contactFieldAllowed` (`save-candidates.js:37–43`) honors
  `emailPersistAllowed=true`, which the contested path sets; `contactStatus` stays
  null (not `'unresolved'`), so the row saves with the email attached.
- UI: the contested email renders in the contact slot with an amber "confirm before
  invite" pill (reusing the Contract-2 pill pattern), NOT buried in the
  rejected-leads toggle.

Identity-anchor contradictions (`identity_anchor_contradiction` — the whole search
result is a different person) are **excluded** from the contested lane and remain
rejected leads: there the evidence says wrong-person, and surfacing it as
near-invitable would invite rubber-stamping.

### 3.1 Guard A input: validate against the affiliation-signal *set*

`_validateEmailAgainstVerifiedDomain` gains a vindication step before it contests.
On a mismatch with `verifiedInstitutionDomain`, resolve domains for the candidate's
*other* affiliation signals — `candidate.affiliation` (discovery), `ce.orcidAffiliation`
— via `OpenAlexService` institution search (free; lazy: only on contradiction, ≤2
lookups), and accept the email if its domain label-boundary-matches ANY of the set,
using the existing `_normalizeDomain`/relatedness logic (`:302–311`).

- Case 1 (dual affiliation: OpenAlex pinned `hhmi.org`, email `…@princeton.edu`,
  discovery affiliation Princeton) → vindicated → **recovered**, source stays
  `claude_search`/`serp_search` (HIGH at send only on a confirmed/probable identity,
  unchanged Contract-3 semantics).
- Case 2 (OpenAlex mis-map to `calu.edu`, email `…@seas.upenn.edu`, discovery
  affiliation UPenn) → vindicated → **recovered**.
- Still-contradicted after the set check → **contested state** (§3 mechanism), not
  null. Compensating control: LOW at send → per-recipient confirm (§3.4); the lead
  trail is still recorded for audit.

Direction-of-risk note: a vindication signal can only *keep* an email that today is
dropped; it never rejects anything the current guard accepts. The failure mode of a
bad vindication (e.g. OpenAlex resolving the discovery-affiliation string to the
namesake's institution) yields a contested-or-kept search email that still cannot be
sent without a confirmed identity or staff confirm — the same protection the
`olga.smirnova` keep-bias case relies on today (`:294–299`).

### 3.2 Guard A consequence: contest, don't null

Even with §3.1, some correct emails will fail the set check (institution not in
OpenAlex, new affiliation). Change the contradiction consequence from
null-plus-rejected-lead (`:326–337`) to the contested state. The wrong-person harm
is unchanged — contested cannot send without confirm — while staff see the
best-guess address in one click instead of re-finding it by hand.

### 3.3 Guard B: domain grounding trumps the local-part heuristic; re-adjudicate at `_finalize`

Keep the inline per-tier null exactly as-is (it enables the tier-4 retry and the
`rejectedEmail` capture, `:709–711`). Add one step in `_finalize`, after
`_attachOpenAlexMetrics` and the §3.1 domain-set construction: if no email
survived and a tier carries `emailRejectedReason='name_mismatch'` with a preserved
`rejectedEmail` whose domain matches the validated domain set → promote it to the
**contested state** (zero new network; the value is already on the object).

- Cases 3–4 (truncated surname / initials+number on the person's own institutional
  domain) → **surfaced-for-confirm**.
- Deliberately NOT auto-recovered to full trust: a same-domain email with a
  non-matching local part can genuinely be a colleague/admin at the same
  institution — the domain proves the institution, not the person. This is exactly
  what the one-click confirm lane is for. (Contrast `_selectGroundedEmail`, which
  earns full `institution_page` trust only with page-level name adjacency or
  owner-slug proof, `:988–1024` — that stronger evidence standard is untouched.)
- A name-mismatch reject whose domain matches NOTHING stays a rejected lead
  (unchanged): with no grounding at all, the current posture is right.

### 3.4 Contract 3 UI: per-recipient confirm (mandatory compensating control)

`InviteEmailModal.js:233–243` currently acknowledges every LOW recipient with one
batch `window.confirm`. Before Phases 2–3 route more volume into the LOW lane,
replace it with a per-recipient checkbox list (name, email, and the specific
`emailConfidence.reason`), send button disabled until each is individually ticked.
The server contract (`confirmedLowConfidenceIds` as a per-suggestion allowlist,
recomputed server-side, `send-emails.js:374–392`) already supports this — it is a
UI-only change, and it converts the brief's "one-click staff confirm" from a batch
rubber-stamp into an actual per-person adjudication.

### 3.5 Contract 7: bind the fetch tier to the validated domain set

`_attachEmailFromResolvedPage` swaps its single `verifiedInstitutionDomain` bound
(`:1068–1069`, `:1081`) for the §3.1 domain set — still a strict allowlist into the
unchanged `safeFetchInstitutionPage` SSRF mechanism (HTTPS-only, exact-or-subdomain
host, private-IP block, IP-pinning dispatcher), just allowing N verified
institutional domains instead of 1. With the flag ON, case 5 (captured faculty page
never fetched) → fetched → page-grounded `institution_page` email (HIGH, by the
existing `_selectGroundedEmail` evidence standard) → **recovered**. Whether to
enable `REVIEWER_PAGE_EMAIL_TIER_ENABLED` in prod remains the owner's call (its
current prod value is unread — treat as unknown); with the flag OFF, case 5 keeps
today's manual lane (faculty-page link + staff entry). Structurally the tier stays
an opt-in tier — page-grounding-as-core-adjudication is not needed once §3.1–3.3
land, and keeping the fetch behind the flag preserves the zero-SSRF default.

## 4. Migration / rollout

Incremental, each phase shippable alone, always behind the unchanged send-time
backstop:

1. **Phase 0 — plumbing (no behavior change).** `search_contested` recognized by
   `emailConfidence` with an explicit LOW reason; contested-state fields threaded
   through save (`save-candidates.js` contact gating) and roster DTO
   (`pruneCandidateForRoster` — note it currently drops `verifiedInstitutionDomain`,
   `reviewer-search-logic.js:~250`; the contested marker must survive the roster
   round-trip). Unit tests: contested is LOW at send; contested persists; contested
   never enters `HIGH_TRUST_EMAIL_SOURCES`.
2. **Phase 1 — §3.4 per-recipient confirm UI.** Ships first: it hardens the lane
   everything else routes into.
3. **Phase 2 — §3.1 + §3.2** (domain-set vindication; contest-don't-null).
4. **Phase 3 — §3.3** (name-mismatch re-adjudication at `_finalize`).
5. **Phase 4 — §3.5** (fetch tier domain-set bound); flag enablement as a separate
   owner decision.

**Measure:** re-run `scripts/probe-no-email-breakdown.mjs 120` after Phases 2–3 —
target: the `verified_domain_contradiction` and `name_mismatch` buckets drop to ~0
with the recovered/contested split logged; watch the confirm-lane volume (staff
confirms per send batch) and any wrong-person invite report (expected: none — the
send gate is unchanged or stronger). Gates/tests to add: unit coverage per phase
above; extend `tests/unit/reviewer-route-identity-gate.test.js` for contested-state
save semantics; extend `tests/unit/contact-leads-slice2a.test.js` for the
contested-vs-rejected lead split.

**Docs to reconcile when shipped** (per `.claude/rules/durable-docs.md`):
`docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md` (guards A/B + Contract 7 text),
`docs/REVIEWER_CONTACT_LEADS_SPEC.md`, `docs/RESOLVED_PAGE_EMAIL_TIER_DESIGN.md`,
`docs/agent-wiki/topics/reviewer-identity.md`.

## 5. Non-goals and residual risks

**Non-goals (deliberately unchanged):**
- Contracts 1, 2, 4, 8 — verified sound (§1); the client/server asymmetry and the
  exempt-kind force-null are earning their keep.
- The send-time gate's *policy* (Contract 3) — only its UI granularity changes.
- The identity resolver, anchor requirements for paid search, and the
  anchor-contradiction reject — these are the namesake protections proper.
- `_selectGroundedEmail`'s evidence standard for full `institution_page` trust.
- The zero-SSRF default posture of Contract 7 (flag stays; owner decides).

**Residual risks:**
- **Same-institution wrong person.** A contested email on the right domain can
  still be a colleague's; the per-recipient confirm (with the reason shown) is the
  control, and staff attention is its limit. Mitigated by §3.4's per-person
  friction; watch confirm-lane volume so it stays a considered act.
- **Contract 5 COI mis-drop (flagged, out of scope).** An OpenAlex affiliation
  mis-map can wrongly hard-drop a correct *candidate* via the lexical COI match —
  the candidate-level analog of Cause #2 case 2, with no lead trail at all.
  Deserves its own probe + follow-up.
- **Vindication false-positives** (§3.1 direction-of-risk note): bounded by the
  send gate; a wrongly-vindicated email still needs a confirmed identity or staff
  confirm to send.
- **Case 5 with the flag off** stays manual — an accepted recall gap until the
  owner enables the tier.

## 6. Pass/fail walkthrough (the five Cause #2 cases)

| # | Case | Proposed-pipeline outcome |
|---|---|---|
| 1 | Correct `…@princeton.edu`; OpenAlex pinned other real affiliation (`hhmi.org`) | §3.1 domain-set vindication (discovery/ORCID affiliation → `princeton.edu`) → **recovered** (search source; HIGH at send iff identity confirmed/probable, else LOW→confirm) |
| 2 | Correct `…@seas.upenn.edu`; OpenAlex mis-mapped to `calu.edu` | §3.1 vindication (discovery affiliation → `upenn.edu`; label-boundary subdomain match) → **recovered** |
| 3 | Truncated-surname local part on the correct med-center domain | §3.3 `_finalize` re-adjudication: domain ∈ validated set → **surfaced-for-confirm** (contested, LOW, per-recipient confirm) |
| 4 | Initials+number local part on correct `columbia.edu` | Same as 3 → **surfaced-for-confirm** |
| 5 | No email extracted; captured faculty page never fetched | §3.5 with flag ON → fetched, page-grounded → **recovered** (`institution_page`, HIGH). Flag OFF → today's manual lane (link + staff entry), surfaced but not one-click — recorded as the accepted gap |

**No new send path:** every recovery either keeps a search source (send-gated on
confirmed/probable identity exactly as today), lands in the contested state (LOW →
per-recipient confirm), or earns `institution_page` under the unchanged
page-grounding evidence standard. Nothing added bypasses `emailConfidence` or the
`confirmedLowConfidenceIds` allowlist; the confirm lane itself gets *stronger*
(§3.4).
