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
identity-evidence disclosure). The five problems below were found on the way and
are deliberately **not** in that branch.

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

### §2.3 Also found [VERIFIED, Codex]

`docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md` **contradicts itself** on whether
`staff_verified` can later be superseded by machine evidence. That is the
canonical contract doc for this gate and must be reconciled regardless of which
option §1 takes. Independent of every proposal here — do it first.

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

### Proposal [PROPOSED] — promote on response, not on send

Defer promotion until the reviewer responds. Accept **or decline** both prove a
human received mail at that address; both should promote.

**Feasibility is good [VERIFIED]:**

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
| 1 | §1 option: 1 / 2 / 3R | Justin | 3R implementation |
| 2 | Response-gated promotion (§4), incl. the CRM-visibility tradeoff | Justin + CRM-facing staff | §4 |
| 3 | Contact provenance attribute(s) (§3) | Justin + Dataverse schema | §3 |
| 4 | Durable vs disposable home for the non-response signal (§5.2) | Justin | §5 |
| 5 | Reconcile the `staff_verified` contradiction in the enforcement contracts doc (§2.3) | — | Nothing; do independently |

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

§2.3 (contracts-doc reconciliation) and §2.2 are cheapest and reopen nothing —
they can proceed independently of every decision below. §4 is the largest
behavioral change but has the clearest feasibility evidence. §1's 3R depends on
the §1.1 attestation rewording. §5.3 is mostly a UI affordance over data that
already exists.

## Verification standard for any implementation

Per `CLAUDE.md`, this crosses caller → persistence → consumer, adds durable
state, and touches a send gate: `/contract-reconcile` is required before any of
it is declared done, and §1/§4 warrant an adversarial pass, given that §1
reopens a decision originally reached by adversarial review.
