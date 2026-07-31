---
title: Reviewer Contact Promotion & Address Lifecycle — Problem Statement
domain: reviewer-identity
kind: plan
status: active
summary: "Current reviewer contact-promotion contract plus remaining address-provenance and staleness decisions."
canonical: false
cataloged: 2026-07-30
last_verified: 2026-07-31
owner: product-engineering
related:
  - docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md
  - docs/REVIEWER_IDENTITY_CONTACT_PLAN.md
  - docs/agent-wiki/topics/reviewer-workbench-lifecycle.md
  - docs/agent-wiki/topics/reviewer-identity.md
  - docs/atlas/postgres-reviewer-find-roster.md
  - lib/utils/reviewer-invite.js
  - lib/services/review-manager/send-emails-service.js
  - lib/dataverse/adapters/contact.js
  - lib/dataverse/adapters/researcher.js
  - lib/dataverse/adapters/potential-reviewer.js
  - lib/services/reviewer-contact-reconciliation.js
  - lib/services/reviewer-identity-lookup.js
  - lib/bill/honorarium-onboard-orchestrator.js
  - lib/services/workbench/manual-reviewer-service.js
  - pages/api/workbench/reviewer-roster.js
  - shared/components/reviewers/CandidateEditModal.js
  - shared/components/reviewers/ReviewerSearchSection.js
---

# Reviewer Contact Promotion & Address Lifecycle — Problem Statement

## Status and posture

**ACTIVE CONTRACT + HISTORICAL PROBLEM STATEMENT.** Section 4 is deployed in
production at `824bfcc6` / `dpl_35pUuvT8DowJPHbyBsiJxKGRNMZT`: sending never
creates or links a contact;
every accepted reviewer, including honorarium opt-outs, enters the same
identity-aware promotion path; declines do not promote. Ambiguous email/ORCID
matches, split identities, and namesakes remain unlinked with a durable staff
alert. New contacts use a deterministic primary key derived from valid
canonical ORCID across duplicate reviewer rows, falling back to the reviewer ID
only without ORCID. Post-review hardening atomically commits Contact creation
plus an ETag-guarded reviewer link so concurrent acceptance retries converge
without leaving an orphan Contact.

Production visual verification passed on Request `1002912` on 2026-07-31. An
unresolved candidate remained unselectable in Find while the disclosure showed
unconfirmed identity/contact provenance, the complete retrieved five-paper
collection, and a Scholar name-search link. Owner-authorized normal Find
ingestion also recognized Rotem Sorek and four other applicant referrals as
existing linked reviewers with known email data. This verification did not send
an invitation or exercise identity confirmation, decline, or acceptance.

Sections 1, 2, 3 provenance, and 5 remain proposals unless explicitly marked
resolved. The S388 source trace is retained as historical rationale and is not
the current runtime contract. The current replacement design for the §1/§2
staff-address problem and §5.3 contradiction affordance is
`docs/REVIEWER_ADDRESS_TRUST_AND_CONFLICT_RESOLUTION_PLAN.md` [DRAFT]; the older
options below remain historical reasoning, not the recommended build order.

Origin: S388, a UI-cleanup session on `codex/claude-ui-cleanup` that began with a
Find-tab presentation complaint and traced the send gate through to contact
promotion. The UI fix that prompted it shipped separately (commit `3716d801`,
identity-evidence disclosure; reviewed in §0). The five problems below were found on
the way and are deliberately **not** implemented in that branch.

**Reviewed.** Codex `gpt-5.6-sol` ran an adversarial review over the branch in S388
and returned **needs-attention / NO-SHIP** for §4 as originally drafted. Its findings
are recorded inline — §0 (UI), §4.1 (what changed and why), §4.2 (the then-live defect it
escalated), and the §5.2 downgrade — with each claim re-verified against source
rather than accepted on report. One §4 proposal was withdrawn, several VERIFIED
labels became ASSUMED, and the sequencing changed. **§1 has been reviewed; §3 and §5
have now been reviewed once. S389 decided and implemented the §4 boundary.**

## The thread that connects these

A reviewer address is discovered by machine, sometimes attested by a human,
gated at send, then written into Dataverse as a canonical contact. Trust is
tracked carefully at the start of that path and discarded at the end. One story,
five points:

1. A human attestation cannot reduce send friction (§1)
2. …and permanently forecloses machine improvement of that address (§2)
3. …then the contact write drops all provenance anyway (§3)
4. …and promotion formerly occurred on send; it now occurs on acceptance (§4)
5. …after which nothing re-checks the address as it ages (§5)

**Framing caveat (S388 review).** The one-story framing above is a lens, not a
finding. Codex judged "trust is tracked carefully then discarded at promotion"
**overstated**: promotion already happens at several stages (§4.1), and the
`contacts` row is an engagement record rather than the trust ledger — address
provenance lives on the potential-reviewer row by design. Read §1–§5 as five
separately-scoped problems that happen to share a subject, not as one defect with
five symptoms.

## §0 — The UI change that started this, and its review

The Find-tab disclosure shipped as `3716d801`. The S388 review raised a [medium]
finding against it: for a row classified as identity-unresolved, the panel shows
affiliation, address, institutions, and publications that all descend from the SAME
retrieval, so they corroborate each other whether or not the right person was
retrieved — a bundle that reads as four facts but is one piece of evidence shown
four ways.

**Owner response (accepted, S388).** The papers break the circle in practice. The
working method is to scan the top line, then open the papers and check them against
the proposal — evidence the retrieval did not produce. A famous namesake surfaces in
the top line but fails the paper check. The disclosure is what makes that check
possible on these rows at all; before it, staff decided from a name and an
LLM-written rationale.

**Changes made in response:** the Dataverse line no longer reads as independent
identity confirmation (it states that the matched key came from the same search
result), and the paper list is marked load-bearing in source and in
`docs/agent-wiki/topics/reviewer-workbench-lifecycle.md` so a future UI tidy-up does
not truncate or collapse the one item that does the work.

**Residual risk, accepted and recorded:** a same-field namesake and a fragmented
cluster of the right person (`docs/agent-wiki/topics/reviewer-identity.md:97`). A
paper-title/relevance check confirms the PERSON, not automatically the ADDRESS.
However, the owner clarified in S390 that staff can open a linked paper and find
the corresponding author's exact address; that explicit check is valid
address-specific evidence. The current modal does not distinguish that action
from merely reviewing the paper list and still stamps `emailSource: 'manual'`.
The replacement plan therefore requires a separate exact-address attestation
instead of inferring one from identity confirmation or string equality.

## Terms

- **`potentialreviewer`** — `akoya_potentialreviewer`, the person row. Reused
  across requests (§2.1).
- **`suggestion`** — `wmkf_appreviewersuggestion`, the per-request engagement row.
- **send tier** — `ready` / `quick_check` / `research_only` / `missing`, the
  server-authoritative send policy from `emailConfidence`
  (`lib/utils/reviewer-invite.js:162-198`).
- **promotion** — creating or linking a `contacts` row and pointing
  `wmkf_contact` at it.

---

## §1 — A staff identity attestation cannot reduce send friction

### Today [VERIFIED]

An identity-unresolved candidate is not selectable in the Find tab. The escape
hatch is "✓ This is the right person → edit & add"
(`shared/components/reviewers/ReviewerSearchSection.js:619-628`), which opens
`CandidateEditModal` in `confirmMode`. That modal requires ticking "I've verified
this is the correct person" and always submits email/website/affiliation — "even
an unchanged field is an explicit 'use this'" (`CandidateEditModal.js:134-150`).
The client then stamps `emailSource: 'manual'`
(`ReviewerSearchSection.js:1525`), and the server independently forces the same
on the authoritative candidate before persisting
(`pages/api/workbench/reviewer-roster.js:293-310`, field at `:296`).

`manual` is a `quick_check` source (`reviewer-invite.js:88`); `ready` is only
`orcid`, `institution_page`, `scholarly_multi` (`reviewer-invite.js:82`). So the
card still reads "⚠ Email needs confirmation" and the staffer must tick a
per-recipient checkbox in `InviteEmailModal` before the first send.

The displayed reason is "Manually entered — not verified against the reviewer's
identity" (`reviewer-invite.js:192`). In this flow **both clauses are false**:
the staffer did not type the address, and identity was just confirmed.

### Why it was built this way

S387 made staff attestation `quick_check` and never `ready`, after an
adversarial review that argued both sides. The rationale
(`reviewer-invite.js:135-150`) is that the quick-check tier "is what keeps a
human in the loop at send time for an address a person had to vouch for," and
that promoting it "would silently remove that recipient's send-time
acknowledgement — and, because the person row is shared across requests, would
remove it everywhere."

### The cost that decision did not weigh

Owner report (S388): adding reviewers is among the largest staff complaints, and
staff often abandon the flow and add reviewers manually. The manual path stamps
`emailSource: 'manual'` too
(`lib/services/workbench/manual-reviewer-service.js:196,207,256`), so it reaches
the **identical** gate — the friction is not avoided, it is relocated to a path
carrying less search-time evidence. Manual add *does* rerun Dataverse identity
lookup (`manual-reviewer-service.js:172-180`), so the evidence gap is narrower
than "no evidence"; publication, COI, and enrichment context are what is lost.

If friction systematically routes staff to a lesser path without changing the
send outcome, it is producing worse decisions, not safer ones.

### Assessment (Codex, S388)

The S387 rationale targets **silent automated overwrite** of a human assertion.
It does not transfer cleanly to an **explicit same-request human attestation**.
It *does* transfer fully to blanket person-scoped promotion, which would extend
one staffer's decision to every future request and every other staffer, none of
whom witnessed it.

The send-time checkbox is a real control mechanically — the server recomputes
confidence and enforces per-recipient IDs at send
(`shared/components/reviewers/InviteEmailModal.js:522`;
`lib/services/review-manager/send-emails-service.js:447`) — but in this flow it
surfaces no evidence the confirm modal did not already capture.

### Options

1. **Provenance-preserving only** — stop stamping `manual` when the address was
   not changed (§2.2). No friction change today; removes the permanent pin.
2. **Relabel only** — a distinct source meaning "staff confirmed the person and
   accepted the found address," still `quick_check`, with an accurate reason.
3. **Blanket promotion to `ready`** — removes the second check globally.
   Rejected by the S388 assessment: person-scoped, unbounded in time, inherits
   every failure mode in §1.1.
4. **Variant 3R (Codex recommendation, not yet decided)** — a **request-scoped,
   time-boxed** waiver: do not rewrite the global email source; reword the
   attestation to cover person *and* address; require server-side
   re-verification that the address is unchanged, plus corroborating evidence
   (existing scholarly/affiliation source, or a fresh Dataverse exact match);
   scope the waiver to that suggestion; expire it (~30 days); otherwise fall
   back to the checkbox.

### §1.1 Failure modes any option must survive

- Wrong-person confirmation.
- Correct person, wrong address — **the current checkbox says "correct person"
  and never mentions the address**. Under 3R, rewording is a prerequisite, not a
  nicety.
- Stale or reassigned address: `emailConfidence` tracks provenance, not
  deliverability.
- A typo in an edited address is currently indistinguishable from an unchanged
  machine-sourced one.
- Cross-request authorization: a person-scoped waiver silently applies for
  staffers who never saw the evidence.

### Superseded decision frame [HISTORICAL]

The 1 / 2 / 3R choice above is no longer the recommended implementation frame.
The owner subsequently chose person-scoped trust, no calendar expiry,
contradiction-driven review, and verification on the Find card. The replacement
design in `docs/REVIEWER_ADDRESS_TRUST_AND_CONFLICT_RESOLUTION_PLAN.md` keeps
legacy source-only `staff_verified` rows at `quick_check`, makes new readiness
depend on a durable exact-address attestation bundle, and requires an accessible
remedy for every warning or block. Its storage and rollout recommendations
remain draft decisions requiring owner approval before runtime work.

---

## §2 — A human assertion permanently forecloses machine improvement

### §2.1 Today [VERIFIED]

`emailSourceUpgradeAllowed` (`reviewer-invite.js:151`) returns false whenever the
**stored** source is human-asserted (`manual` / `staff_verified`), so an
automated writer may never upgrade it regardless of the new evidence's tier. The
adapter enforces this at `lib/dataverse/adapters/researcher.js:238-243`, whose
preconditions comment (`:214-237`) states the reasoning directly: upgrading a
human assertion "would delete that recipient's send-time acknowledgement across
every request sharing this person row, including the one where a staffer vouched
for the address."

Person rows are shared across requests rather than created per request:
`potential-reviewer.upsertByEmail` reuses an existing row when the email matches
(`lib/dataverse/adapters/potential-reviewer.js:295-303`).

Because `confirmMode` stamps `manual` even on an unchanged address (§1),
confirming a machine-found address pins it at `quick_check` **permanently and
globally**. Concretely: an address found in PubMed and matched in Dataverse by
exact email, then confirmed by a staffer, can never later be promoted to `ready`
by an ORCID record or institutional page carrying the same address.

Nuance [VERIFIED]: terminal against *upgrades*, not immutable — `manual` and
`search_contested` overwrite unconditionally as explicit safety assertions
(`researcher.js:203-208`). A human still supersedes a human.

### §2.2 Earlier proposal [SUPERSEDED]

The earlier proposal was to preserve the machine source whenever the modal
returned an unchanged address. It is superseded because changed/unchanged does
not express what staff verified. A newly typed corresponding-author address can
be explicitly verified, while an unchanged machine value is not verified merely
because nobody edited it. The replacement plan makes the explicit, server-bound
exact-address attestation authoritative and treats string equality only as an
integrity check, never as evidence.

### §2.3 Also found — RESOLVED in S388 [VERIFIED]

Codex found that `docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md` contradicted
itself on whether `staff_verified` can later be superseded by machine evidence.
Confirmed and fixed in this session.

The stale side was the attestation bullet, which claimed "a later
`scholarly_multi` corroboration of the same address DOES supersede it to `ready`"
and cited `tests/unit/my-candidates-verify-address.test.js` as asserting it. The
correct side was the doc's own **Source PRECEDENCE (S387)** paragraph. Source and
tests agree with the latter: `my-candidates-verify-address.test.js:297-313`
carries an explicit `CORRECTED` note recording that a second adversarial review
reversed the original decision, and asserts
`emailSourceUpgradeAllowed('scholarly_multi', 'staff_verified') === false`. S387
updated the test file and the precedence paragraph but missed the earlier bullet,
which then cited a test that refutes it.

The bullet now states the terminal rule and points at the precedence section.
A fan-out over `docs/` and `.claude-memory/` found no other surface repeating the
stale claim: `agent-wiki/topics/external-reviewer-portal.md:82` and
`REVIEWER_IDENTITY_CONTACT_PLAN.md:111` describe only the promotion *into*
`quick_check`, which is accurate.

---

## §3 — Provenance is discarded at the moment it becomes canonical

### Today [VERIFIED]

Acceptance promotion builds the Contact body through
`contactAdapter.acceptedReviewerContactPayload`, then atomically submits the
deterministic Contact create and ETag-guarded reviewer link in one Dataverse
changeset. The acceptance helper then captures mailing address/phone and
fill-only ORCID. No contact attribute records the reviewer's prior email
provenance or send tier, so the provenance problem remains.

### §3.1 The wrong-contact-link hazard [RESOLVED for acceptance promotion]

The accepted-contact path now queries `findByEmailCandidates` and
`findByOrcidCandidates` together before linking. Multiple matches, email/ORCID
splits, and name mismatches produce
`accepted_reviewer_contact_identity_review`, preserve the unlinked state, and
terminate the deterministic job rather than guessing. Pre-existing links must
also pass active-state, name, and email/ORCID validation before Contact
mutation. A genuine no-match uses an ORCID-scoped deterministic Contact ID
across duplicate reviewer rows, with reviewer-ID fallback only when no valid
ORCID exists. Contact creation and the reviewer lookup link are one atomic
Dataverse changeset guarded by the reviewer's ETag, preventing create-then-link
orphans.

`findOrCreateByEmail` remains a general adapter primitive for other bounded
callers, but neither invitation send nor accepted-reviewer promotion uses its
email-only linking behavior.

### Proposal [PROPOSED]

Carry provenance onto the contact at promotion — at minimum the source tier and
whether delivery was ever confirmed — so a staff-attested address is labelled
where it becomes canonical.

### Open decisions

- Which attribute(s) on `contacts`, and whether strictly additive.
- Whether other remaining `findOrCreateByEmail` callers need the same
  identity-aware policy; acceptance promotion is already fail-closed.

---

## §4 — Contact promotion follows acceptance, never send

### Owner decision and implementation [IMPLEMENTED, S389]

Successfully sending an invitation does **not** merit promotion to `contacts`.
Door 3 in §4.3 is removed. Invitation and non-response history remains on the
reviewer/suggestion records; it does not require a canonical contact.

Every identity-bearing acceptance now promotes, including honorarium opt-outs.
Declines do not promote. The acceptance drain performs durable ORCID capture
first, then promotes through `ensureAcceptedReviewerContact`; non-opt-outs
continue into honorarium capture, while opt-outs stop after ordinary
accepted-reviewer follow-up.

### Current runtime [VERIFIED]

`send-emails-service.js` retains the legacy `contactPromoted` and
`orcidBackprop` response keys for consumer compatibility, but always emits
`false` / `null` and calls no contact adapter. The acceptance drain calls
`ensureAcceptedReviewerContact` for opt-outs and
`ensureHonorariumOnboarding`—which calls the same helper—for non-opt-outs.

Promotion is identity-aware and fail-closed. Contact lookup errors retry;
deterministic identity conflicts alert staff and terminate without retry churn.
Generic `setContactLink` failures abort before honorarium creation. A concurrent
link to another contact uses the reviewer row's live link as authoritative.

### Historical S388 baseline [HISTORICAL]

Contact promotion ran inside the per-recipient send loop, immediately **after**
`createAndSendEmail` returns
(`lib/services/review-manager/send-emails-service.js:573-596`), gated only on
`person && !person._wmkf_contact_value`. It is wrapped in a try/catch whose
comment reads "Failures are non-fatal — the email already shipped."
`backPropReviewerOrcidToContact` follows (`~:605`). Capture mode skips both.

A message accepted by the transport and later bounced still mints or links a
contact. **No bounce or delivery-failure handling exists in this repo**: greps
over `lib/services/review-manager`, `lib/services/reviewer-finder`, and
`pages/api/external` found none. Whether Dynamics records an NDR natively via
server-side sync is a platform-configuration question **[ASSUMED — not verified;
needs a Dynamics-side check, not a source read]**. This paragraph describes the
pre-S389 baseline; no code in this repo consumed such a signal then.

### Proposal [SUPERSEDED by the S388 adversarial review — see §4.1]

~~Defer promotion until the reviewer responds. Accept **or decline** both prove a
human received mail at that address; both should promote.~~

**Withdrawn as written.** A response proves possession of a suggestion-bound
token, not that the intended person received it, and **decline is the worst case
to promote on** — it frequently means "you have the wrong person." Current code
deliberately creates no contact on decline
(`lib/services/external-review/respond-service.js:307-309`). The surviving idea is
narrower and is stated in §4.1.

**Feasibility notes — all [ASSUMED], downgraded from VERIFIED in S388:**

- **The send does not need a contact.** To-recipients are unresolved activity
  parties carrying only `addressused` (`lib/services/dynamics/email.js:94-97`);
  only the *sender* party requires a record reference (`:87-92`).
- **The lazy-promotion pattern already exists and is proven.** `ensureContact`
  (`lib/bill/honorarium-onboard-orchestrator.js:242-260`) returns an existing
  link or resolves-by-email and creates. The honoraria path already assumes a
  reviewer may arrive with no contact.
- **"Promote-on-accept" is already a named, documented pattern here.**
  `docs/BILL_CHUNK_4_DESIGN.md:64` describes exactly this for the honoraria
  path — absent link → `findOrCreateByEmail` then `setContactLink` — and notes
  it is "the exact primitive" the send path uses. §4 therefore does not invent a
  mechanism; it applies an existing one to the invitation path.
- **Most consumers already tolerate a null link** —
  `reviewer-identity-lookup.js:340` (`|| null`),
  `applicant-known-reviewer.js:80` (`contactLinked: !!…`),
  `alert-reviewer-affiliation-mismatch.js:72`, `reviewer-merge.js:227`
  (conditional), `remove-candidate-service.js:428` (conditional delete). The
  portal token path selects `_wmkf_contact_value`
  (`lib/external/verify-suggestion-token.js:98`) but is keyed on the suggestion.
- **Precedent for keeping corrections off the contact:** S143 stores engagement
  contact corrections on the suggestion row (`wmkf_reviewerfirstname`/
  `wmkf_reviewerlastname`, `verify-suggestion-token.js:37-43`).
- **Simplification:** `remove-candidate-service.js:428` currently deletes a
  contact it created; deferral makes that path far rarer.

**Consequences to accept:**

- ORCID back-propagation moves to the same trigger.
- Contacts already created under the current rule stay canonical. Identifying
  which came from never-answered invitations is a **separate read-only
  investigation**. No deletion is proposed here.

### Accepted tradeoff

An invited-but-unresponsive reviewer would no longer exist as a `contacts` row.
If staff look people up in the CRM contact list to see who has been approached,
that view disappears for exactly the population this change aims to keep out of
it. The information is not lost — the reviewer and suggestion rows retain name,
address, and invite timestamp (§5.1) — but it moves somewhere staff may not be
looking.

The owner accepted this tradeoff in S389: invitation alone is not sufficient
evidence to create or link a canonical contact.

### §4.1 What the S388 adversarial review changed

Reviewed by Codex `gpt-5.6-sol` against the branch diff. Verdict:
**needs-attention / NO-SHIP** for §4 as originally written. Findings, each
re-verified here against source:

- **Send is not the only promotion door [VERIFIED].** A confident contact match is
  linked during candidate save
  (`lib/services/reviewer-finder/save-candidates-service.js:1084-1088`), and manual
  add can link before any invitation
  (`lib/services/workbench/manual-reviewer-service.js:262-273`). Removing the send
  hook therefore produces a MIXED policy, not the clean boundary that was this
  proposal's main selling point. **Any rewrite must start from a complete map of
  promotion sites**, treating "link a pre-existing CRM contact" and "create a new
  contact" as separate policies.
- **The honoraria precedent is narrower than §4 claimed.** It runs only for
  accepted reviewers who did not opt out
  (`lib/services/reviewer-acceptance-drain.js:441-454`), and lets an email match win
  even when ORCID uniquely identifies a different contact, warning afterward
  (`lib/bill/honorarium-onboard-orchestrator.js:256-290`). Accept has a durable
  retry job; decline has no equivalent post-commit queue, so promotion in the
  decline handler would tear either side of the response CAS. "Lazy promotion is
  proven" → **[ASSUMED]**.
- **Duplicate-contact races are unhandled.** `findOrCreateByEmail` is an unguarded
  check-then-create (`lib/dataverse/adapters/contact.js:65-75`); `setContactLink`
  guards the reviewer pointer only after creation
  (`lib/dataverse/adapters/potential-reviewer.js:419-444`). Concurrent responses for
  a shared reviewer can mint competing contacts and orphan the loser. An idempotency
  design is a prerequisite for moving the trigger at all.
- **`docs/BILL_CHUNK_4_DESIGN.md` is a TABLED plan** (owner, S388) and is not
  authority for current behavior. An earlier revision of this document cited it as
  precedent; that citation is withdrawn. Its `:209` records the duplicate-contact
  race above, so it did not support the claim it was cited for.

**What survives, and is stronger than the original.** Promotion should follow an
**identity-bearing accept**, not "a response." At accept the reviewer supplies their
own mailing address and phone through the token-authenticated portal
(`lib/external/required-address.js:11` — `line1`, `city`, `postalCode`, `country`,
`phone`), and honorarium onboarding confirms an email
(`lib/bill/honorarium-onboard-orchestrator.js:246`). That is first-party contact
data from the person — a materially better trust event than send success or a bare
response, and the natural place for an address to EARN verified status (§5.3's first
open decision). Promotion at that point must still resolve identity rather than
matching on email alone (§3.1).

**Do not promote on decline.** Treat decline as engagement history on the suggestion
row, where it already lives (§5.1).

### §4.3 Current promotion-site map [VERIFIED]

Codex required a complete map of promotion sites before §4 could be scoped.
Four potential doors remain in source history, but only three are live:

| # | Where | Behavior | Code |
| --- | --- | --- | --- |
| 1 | Candidate save | links a CONFIDENT existing contact match; ambiguous/conflict deliberately left unlinked + staff alert | `save-candidates-service.js:1084-1088`, `:1098-1121` |
| 2 | Manual add | can link an existing contact before any invitation | `manual-reviewer-service.js:264` |
| 3 | Invitation send | **No promotion.** Legacy response fields remain `false` / `null`. | `send-emails-service.js` |
| 4 | **Accept drain** | Every accept promotes through `ensureAcceptedReviewerContact`; ambiguous/conflicting matches remain unlinked; non-opt-outs then continue into honorarium capture | `reviewer-acceptance-drain.js`; `honorarium-onboard-orchestrator.js` |

> **What door 4 is, operationally (owner, S388).** Despite living under `lib/bill/`,
> this path is **honorarium payment-information collection only**. The apps do **not**
> refer reviewers to BILL.com in any way. A reviewer who accepts and does not opt out
> of an honorarium supplies their contact and mailing details so they can be paid —
> which makes that submission **reviewer-supplied ground truth about their own contact
> information**, the strongest evidence any part of this system ever receives. Read
> every "BILL" name on this path as vestigial naming around a tabled integration
> (`docs/BILL_CHUNK_4_DESIGN.md`, historical), not as an active referral.

**The map is complete, by disconfirming query.** `wmkf_contact` can only be pointed
by `potentialReviewer.setContactLink`, so enumerating its callers bounds the set.
Runtime promotion callers are candidate save, manual add, and the accepted-contact
helper. Deliberately excluded, and NOT doors:
`scripts/pr4-e2e.js:120-121` and `scripts/pr4-e2e-setup.js:98-100` (E2E fixtures, not
runtime), and `lib/services/contact-bridge-service.js:156-170`, which creates contacts
for PORTAL-LOGIN identity keyed on `wmkf_portaloid` and never sets `wmkf_contact`.

**Idempotency is now enforced without an email alternate key.** Genuine new
accepted-reviewer contacts receive a UUIDv5 primary key derived from canonical
ORCID across duplicate reviewer rows, with the global potential-reviewer ID as
fallback when no valid ORCID exists. `claimNewAcceptedReviewerContact` submits
the Contact create and ETag-guarded reviewer link in one atomic Dataverse
changeset, then reconciles exact IDs after an unknown outcome. This prevents the
prior check-then-create/link race without asserting that email is globally
unique or leaving an orphan Contact on a losing link race.

Still to decide outside the implemented §4 boundary:

- **Doors 1 and 2 need their own policy.** They LINK pre-existing contacts rather
  than creating new ones, which is a materially different act; §4.1's create/link
  split applies here.

### §4.2 Send overriding save's do-not-link decision [RESOLVED, S389]

The same review escalated §3.1 to *do this first*, and verifying it made the
historical defect sharper than §3.1 originally stated. Save-time screening leaves an
ambiguous or conflicting contact match **unlinked** and raises a staff alert stamped
`policyDecision: 'save_unlinked_staff_review'`
(`save-candidates-service.js:1098-1121`). Before S389, send-time promotion then
discarded that decision entirely: it called email-only `findOrCreateByEmail` and
linked whatever came back, with no name, ORCID, or ambiguity check. A later
accept could then overwrite that contact's name/title.

That was the production defect at the S388 baseline. S389 removed all send-time
contact creation/linking, so a save-time ambiguous/unlinked decision survives the
send. Regression coverage constructs an unlinked reviewer with an ORCID, performs a
successful invitation send, and proves the contact create/link/back-prop functions
are not called.

Acceptance does not reintroduce the bypass: it independently checks email
ambiguity, ORCID ambiguity, email/ORCID splits, and name consistency before
linking. Conflicts remain unlinked with a durable staff-review alert.

---

## §5 — Nothing re-checks an address as it ages

### §5.1 Non-response is already recorded [VERIFIED]

`wmkf_invited`, `wmkf_emailsentat`, `wmkf_responsereceivedat`, and
`wmkf_responsetype` are all registered fields
(`lib/dataverse/core/entity-registry.js:112,115,116,129`), alongside
`wmkf_declined`. "Invited on X, never replied" is derivable **today, with no new
storage**, and it lives on the reviewer and suggestion rows — *not* on the
contact.

This resolves a concern raised against §4: deferring promotion loses no
contacted-but-unresponsive history, because the contact was never where that
history lived. The gap is that nothing surfaces or acts on the state.

**Trap for any implementer [VERIFIED, S388].** Do NOT read
`wmkf_responsereceivedat` as "a response arrived." The no-response sweep stamps it
with the SWEEP time alongside `wmkf_responsetype = no_response`
(`lib/services/reviewer-suggestion-sweep.js:93-96`), so a non-responder carries a
populated received-at timestamp that no human ever generated. The sweep only runs
after the parent request's meeting date plus a grace window (`:73-77`), and skips
rows whose request has no meeting date (`:75`). `wmkf_responsetype` is the field
that distinguishes a real response from a swept one; the timestamp is not.

### §5.2 Where this class of data belongs

The Postgres/Dataverse boundary is settled and written down. Migration 018
(S219) drained the canonical reviewer tables out of Postgres and into Dataverse.
Historical, all five dropped by that migration and none live today: `researcher_keywords`, `publications`, `reviewer_suggestions`, `proposal_searches`, `researchers` (`lib/db/migrations/018_drop_reviewer_finder_postgres_tables.sql:83-87`).
The live source of truth is `wmkf_potentialreviewer` /
`wmkf_appreviewersuggestion`. Migration 020's header states the rule:
Postgres holds "OPERATIONAL, pre-save, per-request working state … the same
class as `search_cache`"; the canonical pool stays in Dataverse
(`lib/db/migrations/020_reviewer_find_roster.sql:15-23`).

Applied here: invite-and-response outcome is per-request engagement state and
already sits canonically in Dataverse. Derived operational signal computed from
it (a non-response tally used to rank) could fit Postgres.

**Downgraded in S388 [ASSUMED].** "Non-response is reviewer-quality evidence" is
not safe as stated. The `no_response` classification is stamped by a cron only
after the request meeting date, and it writes `wmkf_responsereceivedat` with the
SWEEP time even though no response occurred
(`lib/services/reviewer-suggestion-sweep.js:43-96`). That outcome cannot separate a
bad address, spam filtering, leave, or genuine unreliability. Derive non-response
counts from the canonical engagement rows; treat any Postgres value as a
rebuildable ranking cache only. Do not persist a person-level reliability score, and
do not lower an address tier on non-response, until dispatch semantics and
exclusions are defined.

**Caution:** the S369 owner goal in
`.claude-memory/project-reviewer-reliability-data.md` is for **durable** evidence
of reviewer quality. Non-response is a reliability signal in that family;
storing it in the tier designated as disposable would put durable evidence in
the wrong place. Separate "how often did this person not reply" (durable →
Dataverse) from "scratch for the current search" (→ Postgres).

Note `lib/db/migrations/002_contact_enrichment.sql` added an `email_verified_at`
column to `researchers` — a table dropped by migration 018. That column is
historical; do not cite it as an existing verification timestamp.

### §5.3 The staleness check is already computed [VERIFIED]

`lib/services/reviewer-contact-reconciliation.js` runs during search, read-only,
and attaches `contactEnrichment.dataverseContactEvidence` to each candidate. Its
header is emphatic that it "never writes, exposes Dataverse record IDs, changes
candidate identity/contact fields, or grants save authority."

Its conflict vocabulary is the staleness vocabulary
(`lib/services/reviewer-identity-lookup.js`):

- `email_mismatch` (`:302-303`) — carries `{ contactId, typedEmail, contactEmail }`.
  **Precise trigger:** `evaluateKey` runs once per key, ORCID first (`:371`) then
  email (`:407`). In the email pass the contact was matched *by* that address, so
  the comparison is trivially equal; the conflict is meaningful in the **ORCID
  pass** — the same person (by ORCID) whose stored contact address differs from
  the address in hand. That is exactly the moved-professor signal.
- `orcid_email_split` (`:308-312`) — the reviewer already points at a different
  contact than the one this address resolves to.
- `contact_linked_elsewhere` (`:316-320`, `:349-352`) — the contact is already
  linked to a different reviewer row.

Institution records are collected alongside, which is how a changed affiliation
surfaces.

Two things are missing, and neither is plumbing:

- **No adjudication.** It reports disagreement; it never decides which value is
  newer.
- **No staff affordance** to act on a mismatch.

**Sibling precedent:** `alert-reviewer-affiliation-mismatch.js` performs this
comparison for *accepted* reviewers and deliberately only alerts, reasoning that
"free-text affiliation names have variants, acronyms, and AKAs that are not safe
to auto-resolve" (`:1-10`). That judgment transfers to institutions but **not**
to email addresses, which are exact-comparable — so an address mismatch is a far
better candidate for a decisive staff prompt than an affiliation mismatch is.

### Replacement design [DRAFT]

`docs/REVIEWER_ADDRESS_TRUST_AND_CONFLICT_RESOLUTION_PLAN.md` broadens this into
a total remedy contract. `email_mismatch` offers “use found,” “keep stored,” and
“different people”; identity/contact splits offer a verified-address path that
keeps the Contact unlinked plus a durable repair request; timeouts offer retry;
duplicate owners deep-link to merge. Unknown codes fail closed with retry and a
repair request rather than a dead warning. Address adjudication remains a staff
decision and never creates or links a Contact.

### §5.4 The ground truth is collected and never written back [VERIFIED]

This is the most actionable finding in the document, and it closes the loop on §1.

Every accepted reviewer now enters accepted-contact promotion, including honorarium
opt-outs. Non-opt-outs also submit mailing/payment details; opt-outs may provide only
the ordinary contact edits carried by acceptance. In both cases acceptance is
first-party engagement evidence, but the amount of newly supplied address evidence
differs. It remains stronger identity evidence than a successful send.

The accept path already does a great deal with it:

- captures a self-reported ORCID and stamps `wmkf_identitystatus: 'confirmed'` when
  it persists (`lib/services/reviewer-acceptance-drain.js:53-56,432-439`)
- syncs reviewer name/title onto the contact (`syncReviewerNameTitleToContact`, `:392`)
- writes any supplied mailing address onto the contact through
  `ensureAcceptedReviewerContact`
- runs an email-mismatch alert (`alertReviewerEmailMismatch`, `:393`)

**But nothing on that path writes `emailSource` / `wmkf_emailsource`.** Established by
disconfirming query rather than by absence of grep hits: `wmkf_emailsource` is written
in exactly two adapters — `potential-reviewer.js:163,263,372,490,533` and
`researcher.js:180,242` — so reaching one of those functions is necessary to change
provenance. The accept path imports the potential-reviewer adapter but calls only
`getById` (read) and `setContactLink` (writes `wmkf_contact` alone); its single
`.create(` is `requests.create`, the honorarium `akoya_request`
(`honorarium-onboard-orchestrator.js:207`), a different entity. No provenance writer
is reachable from accept. The reviewer's own `contactEdits.email` flows into the
contact and the deferred payment payload
(`honorarium-onboard-orchestrator.js:246,414`) and stops there.

**Consequence.** The address provenance tier is unchanged by the strongest evidence
the system can obtain. A reviewer personally confirms their address to get paid, and
the next cycle that address is still `quick_check` — or permanently pinned there if a
staffer used the confirm modal (§2.1) — so staff tick the acknowledgement box again
for an address its owner verified. **This is the mechanism that would make §1's
friction self-limiting, and the data for it is already being collected.**

### Proposal [PROPOSED]

Introduce a `reviewer_confirmed` address source, ranked `ready`, written only when the
reviewer themselves submits or confirms the address through the token-authenticated
accept flow. It is the one source that should outrank a staff assertion, because it
comes from the address's owner rather than a third party — which means §2.1's
human-assertion terminality needs an explicit carve-out for it, not a silent
exception.

### Open decisions

- Does it require an EXPLICIT confirm affordance ("this is my correct email"), or does
  submitting the honorarium form imply it? Today the email is prefilled and merely
  passed through, so implicit consent is thin evidence — an explicit tick is cheap and
  much more defensible.
- Does `reviewer_confirmed` decay? An address confirmed three years ago is not a
  current address (§5's whole premise).
- What happens when `alertReviewerEmailMismatch` fires — reviewer-supplied disagrees
  with stored? Almost certainly the reviewer wins, but that must be decided, and it is
  the natural place to hang the write-back.
- Does the same logic extend to the mailing address and phone, or is email the only
  field that feeds a gate?

### Open decisions

- Does an accept/decline response count as delivery proof strong enough to raise
  an address's tier — making §4's trigger also §1's evidence? This is the most
  promising route to letting an attested address *earn* verified status through
  use rather than staying pinned forever.
- Does non-response after N invitations lower an address's tier or flag it?
- Does staleness re-checking apply only to reviewers resurfaced by a new search
  (cheap, no new job), or run periodically (needs a scheduled job)?

---

## Cross-cutting decisions

| # | Decision | Owner | Blocking |
| --- | --- | --- | --- |
| 0 | **Remove send-time contact promotion** — invitation success does not merit creation/linking | **Implemented, S389** | Done |
| 1 | Exact-address staff attestation, person-scoped trust-until-contradicted state, and no-dead-end remedy contract | Justin | Draft recommendations P1–P4 in `REVIEWER_ADDRESS_TRUST_AND_CONFLICT_RESOLUTION_PLAN.md` |
| 2 | Acceptance-time promotion scope (§4.1): every identity-bearing accept, including honorarium opt-outs | **Implemented, S389** | Done |
| 3 | Contact provenance attribute(s) (§3) | Justin + Dataverse schema | §3 |
| 4 | Durable vs disposable home for the non-response signal (§5.2) | Justin | §5 |
| 6 | **`reviewer_confirmed` address source (§5.4)** — write the reviewer's own confirmation back to provenance; needs an explicit carve-out from §2.1 terminality | Justin | §5.4 |
| 5 | ~~Reconcile the `staff_verified` contradiction in the enforcement contracts doc~~ | — | **Done in S388 (§2.3)** |

## Historical blast-radius estimate (superseded 3R design)

`CandidateEditModal.js`, `ReviewerSearchSection.js`,
`pages/api/workbench/reviewer-roster.js`, `reviewer-roster-store.js`,
`reviewer-manual-confirmation.js`, `reviewer-vetted-email.js`,
`save-candidates-service.js`, `render-emails-service.js`,
`send-emails-service.js`, `InviteEmailModal.js`, ~6 test files, and
`docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md`. **[ASSUMED — an estimate, not a
traced call graph.]**

§3, §4, and §5 are each independently scoped and add to this.

## Sequencing suggestion

**Current after S390.** §4.2, the acceptance scope, identity-aware matching, and
idempotent new-contact creation are implemented. §2.3 is also done. Do not build
the older §2.2 unchanged-address shortcut or §1's 3R waiver. Review and approve
`docs/REVIEWER_ADDRESS_TRUST_AND_CONFLICT_RESOLUTION_PLAN.md` first; its order is
additive schema/readers, shared remedy contracts, working UI actions, durable
conflict enforcement, and only then exact-bundle `staff_verified` readiness.

## Verification standard for any implementation

Per `CLAUDE.md`, this crosses caller → persistence → consumer, adds durable
state, and touches a send gate: `/contract-reconcile` is required before any of
it is declared done, and §1/§4 warrant an adversarial pass, given that §1
reopens a decision originally reached by adversarial review.
