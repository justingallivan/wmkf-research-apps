---
title: Reviewer Contact Promotion & Address Lifecycle — Problem Statement
domain: reviewer-identity
kind: plan
status: active
summary: "Problem statement only — nothing here is built. Five linked defects in how a reviewer address earns trust, becomes a canonical contact, and ages."
canonical: false
cataloged: 2026-07-30
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

**PROBLEM STATEMENT — NOTHING HERE IS BUILT.** Every "today" claim is
`[VERIFIED]` against source read in session 388 at the cited line, on tree
`8a34a057`. Every proposal is `[PROPOSED]`: no implementation, no migration, no
owner sign-off. Nothing here may be cited as existing behavior.

Origin: S388, a UI-cleanup session on `codex/claude-ui-cleanup` that began with a
Find-tab presentation complaint and traced the send gate through to contact
promotion. The UI fix that prompted it shipped separately (commit `3716d801`,
identity-evidence disclosure; reviewed in §0). The five problems below were found on
the way and are deliberately **not** implemented in that branch.

**Reviewed.** Codex `gpt-5.6-sol` ran an adversarial review over the branch in S388
and returned **needs-attention / NO-SHIP** for §4 as originally drafted. Its findings
are recorded inline — §0 (UI), §4.1 (what changed and why), §4.2 (a live defect it
escalated), and the §5.2 downgrade — with each claim re-verified against source
rather than accepted on report. One §4 proposal was withdrawn, several VERIFIED
labels became ASSUMED, and the sequencing changed. **§1 has been reviewed; §3 and §5
have now been reviewed once; nothing here has owner sign-off.**

## The thread that connects these

A reviewer address is discovered by machine, sometimes attested by a human,
gated at send, then written into Dataverse as a canonical contact. Trust is
tracked carefully at the start of that path and discarded at the end. One story,
five points:

1. A human attestation cannot reduce send friction (§1)
2. …and permanently forecloses machine improvement of that address (§2)
3. …then the contact write drops all provenance anyway (§3)
4. …and promotion is triggered by send success rather than evidence of delivery (§4)
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

**Residual risk, accepted and recorded:** a same-field namesake; a fragmented
cluster of the right person (`docs/agent-wiki/topics/reviewer-identity.md:97`); and
— the one that matters for this document — **the paper check confirms the PERSON,
never the ADDRESS**, which came from a single work's affiliation string. The confirm
modal nevertheless stamps `emailSource: 'manual'`, recording an address assertion
the staffer did not make. That is an independent argument for §2.2.

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

### Open decision

Which of 1 / 2 / 3R, and whether 3R's waiver expires by time, by request, or
both. **Owner decision required** — this reopens an item recorded under "Do Not
Reopen Without New Decision."

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

### §2.2 Proposal [PROPOSED]

Do not rewrite the email source when the confirm modal returns an address
identical to the stored one. Keep the machine source (e.g. `pubmed`), also
`quick_check`, so **today's friction is unchanged** — but the address stays
eligible for automatic promotion later.

Narrowest available change, and it does not reopen the S387 decision: it does
not weaken a human assertion, it declines to *record* one where the human
asserted nothing about the address.

### Open decision

Whether "unchanged" is judged client-side or re-verified server-side. Codex
recommends server-side: the client value is caller-supplied and the comparison
decides a provenance write.

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

`contactAdapter.findOrCreateByEmail` (`lib/dataverse/adapters/contact.js:65-75`)
writes exactly three fields: `emailaddress1`, `firstname`, `lastname`.

The tier system is maintained on the `potentialreviewer` row up to the send and
then dropped. The resulting `contacts` row is indistinguishable from one created
from a verified institutional page. Nothing downstream can tell that an address
was a staff guess that never received a reply.

### §3.1 The wrong-contact-link hazard [VERIFIED]

`findOrCreateByEmail` calls `findByEmail` first and **links the existing contact
if one is found** (`contact.js:67-68`). If an attested address is wrong but
belongs to a real person already in the CRM, the potential reviewer is linked to
**that person's** contact. No new record is created; nothing signals the merge.

Worse than creating a bad contact, and most likely precisely in the
staff-attested case where the address was inferred. Note that
`findByEmailCandidates` and `resolveForBackprop` already select `top: 2` because,
per the adapter's own comment, "the 7 measured ambiguous cases prove email isn't
1:1" (`contact.js:196-207`) — the ambiguity is known and measured, and
`findOrCreateByEmail` does not consult it.

### Proposal [PROPOSED]

Carry provenance onto the contact at promotion — at minimum the source tier and
whether delivery was ever confirmed — so a staff-attested address is labelled
where it becomes canonical.

### Open decisions

- Which attribute(s) on `contacts`, and whether strictly additive.
- Whether `findOrCreateByEmail` should refuse or flag an ambiguous/unexpected
  email match rather than silently linking (§3.1).

---

## §4 — Promotion is triggered by send success, not delivery

### Today [VERIFIED]

Contact promotion runs inside the per-recipient send loop, immediately **after**
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
needs a Dynamics-side check, not a source read]**. What is certain: no code here
consumes such a signal.

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

### The genuine tradeoff — needs a human answer, not a code answer

An invited-but-unresponsive reviewer would no longer exist as a `contacts` row.
If staff look people up in the CRM contact list to see who has been approached,
that view disappears for exactly the population this change aims to keep out of
it. The information is not lost — the reviewer and suggestion rows retain name,
address, and invite timestamp (§5.1) — but it moves somewhere staff may not be
looking.

**Check with CRM-facing staff before committing.**

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

### §4.3 The promotion-site map — and why §4 is smaller than it looks [VERIFIED]

Codex required a complete map of promotion sites before §4 could be scoped.
Building it changed the conclusion. Four doors are live today:

| # | Where | Behavior | Code |
| --- | --- | --- | --- |
| 1 | Candidate save | links a CONFIDENT existing contact match; ambiguous/conflict deliberately left unlinked + staff alert | `save-candidates-service.js:1084-1088`, `:1098-1121` |
| 2 | Manual add | can link an existing contact before any invitation | `manual-reviewer-service.js:264` |
| 3 | Invitation send | `findOrCreateByEmail` + `setContactLink`, email-only, no identity check | `send-emails-service.js:573-596` |
| 4 | **Accept drain** | `ensureContact` (find-or-create + link) then `patchContactAddress`, gated `if (!optedOut)` | `reviewer-acceptance-drain.js:442-446`; `lib/bill/honorarium-onboard-orchestrator.js:86,108` |

**The map is complete, by disconfirming query.** `wmkf_contact` can only be pointed
by `potentialReviewer.setContactLink`, so enumerating its callers bounds the set.
Runtime callers are exactly the four above (`honorarium-onboard-orchestrator.js:369`,
`send-emails-service.js:590`, `save-candidates-service.js:1088`,
`manual-reviewer-service.js:264`); likewise `findOrCreateByEmail`, whose only runtime
callers are doors 3 and 4 (`send-emails-service.js:585`,
`honorarium-onboard-orchestrator.js:352`). Deliberately excluded, and NOT doors:
`scripts/pr4-e2e.js:120-121` and `scripts/pr4-e2e-setup.js:98-100` (E2E fixtures, not
runtime), and `lib/services/contact-bridge-service.js:156-170`, which creates contacts
for PORTAL-LOGIN identity keyed on `wmkf_portaloid` and never sets `wmkf_contact`.

**Precedent for the idempotency gap.** That same portal path gates contact creation
on an ACTIVE ALTERNATE KEY (`contact-bridge-service.js:160`, `ensureAltKeyActive`)
expressly so "parallel first-time bridge calls could each create a duplicate contact
for the same OID" cannot happen. That is structurally the fix
`BILL_CHUNK_4_DESIGN.md:209` named as the only airtight answer for the reviewer
find-or-create race and then scoped out. **The pattern is already built and running
in this repo on `wmkf_portaloid`** — so §4.1's duplicate-contact prerequisite has a
working in-house model to copy rather than a design to invent.

**Door 4 is already the change §4.1 proposed.** The honorarium orchestrator promotes
the contact and writes the reviewer's self-supplied mailing address at accept, and it
does so BEFORE the capture-only deferral short-circuit
(`honorarium-onboard-orchestrator.js:114-133`) — so it runs today even with
`HONORARIUM_ONBOARDING_DEFERRED=true` and BILL tabled. It seldom has anything to do
only because door 3 already created the link at invitation time, leaving
`ensureContact` an existing `_wmkf_contact_value` to return.

So §4 is not "build accept-time promotion." It is **"remove door 3 and let door 4
create new contacts,"** which is a far smaller and better-evidenced change than the
original framing, and it partly answers the NO-SHIP: the accept-side machinery exists
and is running in production.

Still to decide before implementing:

- **Opt-out accepts never reach door 4** (`reviewer-acceptance-drain.js:442`). With
  door 3 removed they would hold no contact. Probably correct — an opt-out reviewer
  has no payment relationship — but it must be a decision, not a side effect.
- **Doors 1 and 2 need their own policy.** They LINK pre-existing contacts rather
  than creating new ones, which is a materially different act; §4.1's create/link
  split applies here.
- **Door 4 inherits §3.1.** `ensureContact` resolves by email and lets an email match
  win even when ORCID identifies a different contact
  (`honorarium-onboard-orchestrator.js:256-290`), so moving volume onto it without
  the §4.2 identity-aware fix would relocate the wrong-contact hazard, not remove it.
- **Idempotency.** `docs/BILL_CHUNK_4_DESIGN.md:209` (historical/tabled, cited here
  only as a recorded observation, not as authority) names an `emailaddress1`
  alternate key as the only airtight fix for the find-or-create race, and explicitly
  scoped it out. It remains unbuilt and is the real answer to §4.1's duplicate-contact
  concern.

### §4.2 §3.1 is a LIVE defect, not a future risk [VERIFIED]

The same review escalated §3.1 to *do this first*, and verifying it here made it
sharper than §3.1 originally stated. Save-time screening deliberately leaves an
ambiguous or conflicting contact match **unlinked** and raises a staff alert stamped
`policyDecision: 'save_unlinked_staff_review'`
(`save-candidates-service.js:1098-1121`). Send-time promotion then discards that
decision entirely: it calls email-only `findOrCreateByEmail` and links whatever
comes back (`send-emails-service.js:573-597`), with no name, ORCID, or ambiguity
check (`contact.js:65-75`). A later accept can then overwrite that contact's
name/title (`lib/services/reviewer-acceptance-drain.js:479-488`).

So the system makes a careful decision not to link, and then links anyway one step
later. **This exists in production today and is independent of every proposal in
this document.** Recommended fix: route send-time promotion through the
ambiguity-aware resolver, require name/ORCID consistency, preserve the unlinked
state otherwise, and add a regression test where save rejects a contact match and
send later encounters the same address.

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

### Proposal [PROPOSED]

Treat a search-time `email_mismatch` against a linked contact as a first-class
staff prompt: show stored versus found with both provenances, and offer an
explicit update. Adjudication stays with the staffer; no auto-write.

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
| 0 | **Fix the live §4.2 defect** — send-time promotion overrides save's deliberate do-not-link decision | — | Nothing; it is a current-behavior bug |
| 1 | §1 option: 1 / 2 / 3R | Justin | 3R implementation |
| 2 | Promotion on identity-bearing ACCEPT (§4.1), incl. the promotion-site map and CRM-visibility tradeoff | Justin + CRM-facing staff | §4 |
| 3 | Contact provenance attribute(s) (§3) | Justin + Dataverse schema | §3 |
| 4 | Durable vs disposable home for the non-response signal (§5.2) | Justin | §5 |
| 5 | ~~Reconcile the `staff_verified` contradiction in the enforcement contracts doc~~ | — | **Done in S388 (§2.3)** |

## Blast radius (Codex estimate, 3R only)

`CandidateEditModal.js`, `ReviewerSearchSection.js`,
`pages/api/workbench/reviewer-roster.js`, `reviewer-roster-store.js`,
`reviewer-manual-confirmation.js`, `reviewer-vetted-email.js`,
`save-candidates-service.js`, `render-emails-service.js`,
`send-emails-service.js`, `InviteEmailModal.js`, ~6 test files, and
`docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md`. **[ASSUMED — an estimate, not a
traced call graph.]**

§3, §4, and §5 are each independently scoped and add to this.

## Sequencing suggestion

**Revised after the S388 review.** §4.2 goes first — it is a live defect in current
behavior, not a proposal, and the review escalated it independently. §2.3 is already
done. §2.2 is the cheapest remaining proposal and reopens nothing. §4 is no longer
"the clearest feasibility evidence" — that claim was withdrawn in §4.1; it now needs
a promotion-site map and an idempotency design before it can be scoped. §1's 3R
still depends on the §1.1 attestation rewording. §5.3 remains mostly a UI affordance
over data that already exists.

## Verification standard for any implementation

Per `CLAUDE.md`, this crosses caller → persistence → consumer, adds durable
state, and touches a send gate: `/contract-reconcile` is required before any of
it is declared done, and §1/§4 warrant an adversarial pass, given that §1
reopens a decision originally reached by adversarial review.
