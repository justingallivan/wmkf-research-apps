---
title: Reviewer Holistic Redesign — Adversarial Review Findings Handoff (for Codex)
domain: reviewer-identity
kind: audit
status: active
summary: "Actionable fix brief from the 2026-07-13 adversarial review: caller-activation blocker F1, live containment gap F2, guard-test gaps, sliced remediation."
canonical: false
cataloged: 2026-07-12
owner: product-engineering
related:
  - outputs/reviewer-holistic-redesign-adversarial-review-2026-07-13.md
  - docs/REVIEWER_HOLISTIC_REVIEW_IMPLEMENTATION_PLAN.md
  - lib/services/reviewer-identity-binding-writer.js
  - lib/services/reviewer-identity-binding-contract.js
  - lib/services/reviewer-finder/save-candidates-service.js
---

# Adversarial Review Findings — Implementation Handoff for Codex

Source review: `outputs/reviewer-holistic-redesign-adversarial-review-2026-07-13.md`
(read it before starting; this brief is the actionable subset, not a
replacement). Review verdict: **READY WITH FIXES** — merging `75d26a22` is
safe (all new surfaces are inert; census-verified [VERIFIED via rg census in
the review, review artifact §5.1-5.2]); these fixes gate the **first
production caller** of the binding writer, except F2 which is live behavior
today.

Ground rules for this work, carried over from the plan and review:

- Each fix is its own short-lived slice with one named invariant; no fix may
  activate a runtime caller of the binding writer — that remains owner-gated.
- Do not change the "surface, do not gate" COI posture, the C0.1 partial-save
  response contract (clients depend on exact shapes), or the C0.2 origin
  matrix.
- A test added for a guard must be constructed so it FAILS if the guard is
  deleted (build the complement input; no impl-vs-impl assertions).
- Re-run the caller census before claiming anything is still inert; branch
  state may have moved.

---

## F1 (P1) — Timestamp canonicalization cannot survive a Dataverse round-trip

**Blocker for caller activation. Fix in the writer/contract before any I1.3
work.**

Mechanism (CONFIRMED by direct execution of the real pure functions during
the review):

- [VERIFIED via lib/services/reviewer-identity-binding-contract.js:158-161]
  a bound tuple is accepted only when
  `new Date(Date.parse(boundAt)).toISOString() === boundAt`. `toISOString()`
  always emits milliseconds, so only `….sssZ` strings pass.
- [VERIFIED via lib/services/reviewer-identity-binding-writer.js:76-83]
  `canonicalTimestamp` applies the same rule to event `boundAt` /
  `decision.resolvedAt`; [VERIFIED via writer.js:372-375] the **stored**
  `wmkf_identityresolvedat` read back from Dataverse must pass the same
  millisecond-canonical check or the transition throws
  `invalid_current_state`.
- [ASSUMED — live serialization not yet probed] Dataverse Web API serves
  DateTime attributes second-precision (`2026-07-12T10:00:00Z`). The
  offline half is proven: a stored row in that shape throws
  `invalid_current_state`; the identical row with `.000Z` plans a `refresh`
  (executed against the real modules during the review).

Failure once a caller exists: init-bind writes `….000Z` → Dataverse returns
`…Z` → every later event AND every 412-retry reread throws → that person's
binding is permanently fail-closed. Caller side: plan I1.3 directs
self-report events to use the engagement's stable acceptance timestamp —
itself a Dataverse-read value that would fail `canonicalTimestamp` as
`invalid_event`.

Required fix, in order:

1. **Pin the live serialization first.** Production rows already answer the
   question: `writeIdentityDecision` has persisted `wmkf_identityresolvedat`
   from `new Date().toISOString()` (millisecond) values
   [VERIFIED via lib/services/capture-self-reported-orcid.js:73 and
   lib/dataverse/adapters/researcher.js:321], so a read-only query of any such
   row shows whether sub-seconds survive. Write a tracked read-only
   `scripts/probe-*` script (a draft exists in the review session scratchpad
   as `probe-datetime-roundtrip.mjs`); run it in a sanctioned window; record
   the observed format here and in the plan.
2. **Normalize at the boundary, keep fail-closed for garbage.** If sub-seconds
   are dropped: accept second-precision ISO UTC on the read side
   (`loadCurrentState` / tuple validation / stored `resolvedAt` check) by
   canonicalizing once on load, and relax event-side `canonicalTimestamp` to
   the same rule, while still rejecting non-ISO/non-UTC/unparseable values.
   Replay-identity comparisons (`cur.boundAt === event.boundAt` at
   writer.js:332, equal-time checks at writer.js:362-380) must compare the
   **normalized** values so a replayed event is a no-op, not a collision.
3. **Add the missing fixture class:** at least one writer test whose stored
   row uses second-precision timestamps end-to-end (load → plan → patch), and
   one asserting replay-noop across the precision boundary.

Invariant to name for the slice: *"the writer can reread and recompute from
its own committed state after a real Dataverse round-trip."*

## F2 (P2) — Unsigned client `identity` object persists as the durable resolver decision

**Live behavior today; fix independently of the writer.**

- [VERIFIED via lib/services/reviewer-finder/save-candidates-service.js:895-899]
  when `!pdConfirmed && identity`, the service calls
  `researcherAdapter.writeIdentityDecision(potentialReviewerId, identity,
  { identityOrigin: 'automated' })` where `identity =
  candidate.contactEnrichment.identity` (client payload, service:724).
- [VERIFIED via service:581-584, 733-738] the server-signed receipt
  (`automatedIdentityReceipt.valid`) gates only ORCID/Scholar/metrics
  persistence; it is never consulted for the decision write. The in-file
  comment (service:578-580) and `docs/agent-wiki/topics/reviewer-identity.md`
  claim unsigned client identity is deny-only — the code contradicts that.
- Impact: a forged `status:'probable'` + fabricated
  `evidenceSummary`/`anchors` persists onto the person (capped at `probable`
  and sticky-`confirmed` protected
  [VERIFIED via lib/dataverse/adapters/researcher.js C0.2 region]), and live
  surfaces treat `probable` as trusted
  [VERIFIED via caller census: lib/services/reviewer-invite.js:84,
  lib/services/discovery-service.js:272,283,
  lib/utils/reviewer-provenance.js:244].
- No test pins the current behavior:
  [VERIFIED via tests/unit/save-candidates-service.test.js:30 + rg]
  `writeIdentityDecision` is mocked with zero expectations in the unit and
  route suites.

Required fix: gate the decision write on
`automatedIdentityReceipt.valid || validatedSeedAnchor` (the same voucher set
that already loosens field persistence). This matches the enrich-contacts
comment's own intent ("a mint failure degrades to a safe contact/name-only
save" [VERIFIED via pages/api/reviewer-finder/enrich-contacts.js:187-196
comment]). Add tests: (a) unsigned/invalid-receipt candidate → **no**
`writeIdentityDecision` call; (b) valid receipt → decision written with
`identityOrigin: 'automated'`; (c) receipt-invalid path still persists
name/contact per existing gates. The other five `writeIdentityDecision` call
sites are server-computed and must not change
[VERIFIED via range diff: contact-enrichment/persistence.js:129,
enrich-recommended-service.js:393, capture-self-reported-orcid.js:80, both
backfill scripts].

Invariant: *"no durable identity decision is written from a client payload the
server did not sign or independently validate."*

## F3 (P2) — Reachable writer guards with zero failing-test coverage

[VERIFIED via test-audit grep of
tests/unit/reviewer-identity-binding-writer.test.js — zero references to each
guard string.] Add one focused test per guard. Each test must construct the
complement input that reaches the guard (verify by temporarily inverting the
guard locally — the test must fail):

| Guard | Site (writer.js) | Complement input to construct |
|---|---|---|
| `human_event_identity_collision` | 365 | same human source, equal `boundAt`, **different** anchor |
| `automated_event_identity_collision` | 380 | same automated source, equal `resolvedAt`, **different** anchor |
| `automated_init_requires_replacement_bundle` | 321 | unbound row + automated event with `fieldMode:'partial'` |
| `automated_rebind_requires_replacement_bundle` | 394 | automated binding, newer timestamp, different anchor, `fieldMode:'partial'` |
| `automated_field_conflicts_with_human_lineage` | 432-437 | automated same-anchor refresh over a field with `staff_manual` lineage — test BOTH branches (different value → blocked; equal value → lineage preserved, no overwrite) |
| `legacy_classification_required` (lineage-without-binding) | 264-266 | unbound row with non-null `wmkf_identityfieldlineagejson` |
| `version_exhausted` | 338/355/368/402 | current `bindingVersion` = `IDENTITY_BINDING_VERSION_MAX` |

## F4 (P3) — Dead `preserveDecision` branch

[VERIFIED via writer.js:469 + single-occurrence grep] `transition.preserveDecision`
is read but never set — every non-noop transition overwrites all six decision
fields with the event's. Decide the intended semantics (should a same-person
refresh preserve stored `wmkf_identityevidence*`?) **before** the first
caller, then either delete the flag or implement + test it. Do not leave the
name promising behavior that does not exist.

## F5 (P3) — Circular allowlist assertion

[VERIFIED via tests/unit/reviewer-identity-binding-contract.test.js:36]
the test asserts `IDENTITY_LINEAGE_FIELDS` equals `RESOLVER_SOURCED_FIELDS` —
two implementation-owned constants; dropping a field from both stays green.
Fix: assert the seven field names as literals in the test, and make
`reviewer-identity-resolver.js` import the contract constant (the contract's
own comment at `reviewer-identity-binding-contract.js:16-18` says this is the
intent).

## F6 (P3) — Attestation receipt gaps

[VERIFIED via lib/services/reviewer-candidate-attestation.js:16, 109-116 and
its test file] add negative tests for wrong-secret (tampered/re-signed
token), expired token, and absent token — `receipt.valid` is the sole
loosener for resolver-field persistence, and none of the failure
classifications are asserted. Separately, propose shortening `TTL_SECONDS`
(currently 180 days) — re-enrichment mints a fresh receipt, so a much shorter
TTL shrinks the replay window at no workflow cost. TTL change is an owner
call; present it, don't just land it.

## F7 (P3) — Batch key collisions not rejected

[VERIFIED via service:534-541 (no per-batch key-uniqueness check) and
shared/components/reviewers/reviewer-search-logic.js `candidateWasSaved`
(key-set membership)] two same-key rows (duplicate `clientCandidateId`, or
identical name+email+orcid+affiliation) can graduate each other when only one
saved. Fix: reject the *second* occurrence of a duplicate `candidateKey` in
one request as `invalid_candidate` (per-row error; siblings unaffected; keep
the response contract byte-compatible otherwise). Add a two-same-key-rows
test.

## F8 (P3) — Live-state claims need reproducible evidence

Plan/Atlas/inventory/memory state "0 ABSENT / 10 EXACT / 0 DIVERGENT",
"zero rows populated", and deployment IDs as settled facts with no checked-in
artifact [ASSUMED — the claims are plausible but rest on non-reproducible
out-of-band probes]. At the next schema-adjacent session: run
`node scripts/preflight-reviewer-identity-binding-fields.mjs --target=prod`,
record the dated output, and convert those claims to
`[VERIFIED <date> via <command>]` per house style. Reconcile all restatements
in one pass (`/sweep`), don't append.

## Owner-confirmation items (present, do not decide)

- [VERIFIED via lib/services/reviewer-merge.js:236] merge protection covers
  stored `confirmed` only — automated-`probable` records (the post-C0.2
  ceiling for automated writes) get no merge protection. Confirm intended.
- [VERIFIED via shared/components/reviewers/CandidateEditModal.js:573]
  confirmed-only UI affordance excludes automated-`probable`. Confirm
  intended.
- Dead exports `IDENTITY_DECISION_ORIGIN` (researcher.js) and
  `identityAttestationProjection` (attestation service): keep-or-remove is
  cosmetic; fold into whichever slice touches those files.

## Suggested slicing and verification

1. **Slice A (live containment):** F2 (+F6 tests). Tier-2 branch; scoped
   suites: `save-candidates-service`, `save-candidates-route`,
   `reviewer-candidate-attestation`; then full `npm test`, `check:types`,
   `/contract-reconcile` before promotion.
2. **Slice B (writer correctness, inert):** F1 probe → F1 fix + F3 + F4 + F5.
   Still no production caller. Scoped suites: the three binding test files;
   full suite + types.
3. **Slice C (save hygiene):** F7. Scoped: save-key + service + route +
   search-section suites.
4. **F8** rides whichever session next touches schema/docs.

Every slice: author-adversarial pass first (attack your own guards before
review), run relevant red gates sequentially with self-tests, and keep
`SESSION_PROMPT.md`/plan/memory reconciled with what actually landed.
