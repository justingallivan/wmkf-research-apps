# Fuzzy Matching / Identity Resolution — Joint Consensus Recommendation (Claude × Codex)

Date: 2026-08-06 (Session 404)
Status: **consensus reached** — Claude (Fable) endorsed Codex's amended shape in full; Codex declared "CONSENSUS: YES" (round 1) and confirmed against this final document (round 2). Decision work only; **nothing here authorizes implementation, dependency adoption, schema work, or changes to live identity/write gates.**

> **Historical boundary, updated 2026-08-07:** the decomposition, veto, scoring,
> abstention, and benchmark principles below remain research inputs. The local
> ROR dump proposed for live candidate retrieval in step 2 is superseded by the
> owner's server-side ROR API decision. The dump is offline-only. Current build
> authority is `outputs/institution-resolution-handoff-to-codex-2026-08-07.md`.

Inputs reconciled:
- `outputs/fuzzy-matching-independent-research-fable-2026-08-05.md` (Claude, independent)
- `docs/REVIEWER_IDENTITY_AND_INSTITUTION_RESOLUTION_RESEARCH.md` (Codex, 2026-08-04)
- Working draft: `outputs/fuzzy-matching-reconciliation-draft-claude-2026-08-06.md`

---

## 1. The consensus shape

Adopt Codex's **four-decision decomposition** as the problem frame — (a) institution resolution, (b) person identity, (c) current affiliation, (d) contact attribution — and a **shared typed evidence vocabulary plus reusable Fellegi–Sunter scoring primitives** as the mechanism. Explicitly NOT one universal identity score: the four decisions get separate feature models, veto policies, and thresholds built on the shared machinery.

Sequence (each increment independently shippable per the S395 constraint):

0. **Freeze and falsify.** Freeze today's predicate outputs as the incumbent baseline. Build the labeled failure archive + UC-system adversarial matrix as a **150–300-case falsification/regression suite** (Shih's Dana-Farber/Harvard case included; exact row order is an owner nit). Measure candidate retrieval separately from final decisions. This suite selects/rejects approaches and lives on as a regression asset; it is **explicitly not sufficient for production threshold calibration**.
1. **Consolidate normalizers and nickname data seam by seam under characterization tests**, preserving intentional semantic differences as explicit modes. Not characterized as a blanket "pure refactor": the duplicated algorithms already differ in behavior; each consolidation must inventory the caller-specific semantics first. May proceed alongside benchmark expansion once the baseline is frozen.
2. **Institution-resolution vertical slice** against a versioned local ROR dump: candidate union (exact alias/acronym/domain joins + rare-token retrieval), a decision-specific Fellegi–Sunter model, **named non-overridable contradiction vetoes** (fail-closed — additive positive evidence must never outweigh an explicitly designated contradiction), hierarchy policy (parent-on-ambiguity; campus only with campus evidence; multi-org strings → multiple outputs or abstention), three-band output, and a per-decision evidence breakdown. Compared on the frozen suite against the incumbent predicates, ROR (`chosen:true` only), and S2AFF.
3. **Representative benchmark (~1,000–2,000 stratified cases, frozen splits and provider versions) before calibrating production thresholds or enabling ANY high-risk automatic action** (clearing identity gates, suppressing candidates, enabling writes, affecting payment). The owner may defer this investment — but then those actions remain review-only.
4. **Migrate institution consumers lowest-risk-first**, then build **person candidate generation and pair scoring** as a separate model/configuration on the shared primitives. Person work explicitly includes blocking/retrieval with candidate recall measured separately from decision precision — a scorer cannot recover an omitted candidate. Anchor-first (identifiers are strong evidence, never proof); full-forename contradiction and stable-ID conflict are heavy negative evidence or vetoes.
5. **Current affiliation and contact attribution only after person resolution**, as independent, provenance- and time-aware verdicts: dated evidence ledger with source priority (directory > institution-asserted ORCID > verified lab page > self-asserted ORCID > byline-historical > OpenAlex last-known), multiple concurrent affiliations representable, contact ownership distinguished from current reachability.
6. **Decision governance per seam**: owned threshold pairs tied to action risk (display collapse < dedup < COI drop < invite < Dataverse write < payment), decision-specific catastrophic-error gates (zero wrong sibling-campus auto-decisions; zero wrong-person merges reaching invite/payment; no historical-as-current affiliation; no wrong-contact attribution), owner-set resolved-only precision floor, auditable score+evidence logging, and a **verified human-review contract** (see §3).

Standing exclusions (both agents): LLM/embedding matchers are never the primary scorer — optional, separately benchmarked review-band assistance only, must abstain; clustering and cross-request person accumulation deferred until pairwise metrics exist (false merges are the catastrophic direction); CRM/legal Accounts are a different namespace and stay out of scope; never trust any provider's rank 1.

## 2. Where the two documents already agreed

Independently reached by both: Fellegi–Sunter additive evidence weights with term-frequency/rarity adjustment and graded agreement levels; three-band decisions with abstention as the design center; ROR as canonical catalogue but never decision authority (Codex proved it live: Touro outranking the UC system; `UCSD` affiliation-match returning nothing); S2AFF as institution baseline and S2AND as person-disambiguation reference; ~90–97% state-of-the-art precision ⇒ review band is mandatory; hierarchy policy (parent never silently becomes campus); identifiers as anchors not proof; identity-confirmed ≠ contact-validated; benchmark-before-build with precision-first (F0.5) metrics for anything gate-clearing; negative evidence as first-class; the existing PD confirm flow as the natural review band.

## 3. Material points settled during reconciliation

1. **Calibration boundary (Codex correction, accepted):** the falsification suite cannot calibrate production thresholds; calibration requires the representative benchmark. Until then, high-risk actions stay review-only.
2. **Shared machinery ≠ one model (Codex correction, accepted):** "one ledger / one scorer" means one evidence vocabulary and one scoring engine, with four decision-specific models. Affiliation and contact are downstream decisions, not extra person-matching fields.
3. **Hard vetoes (Codex addition, accepted):** owner-approved contradictions block resolution outright rather than merely subtracting weight, so correlated positive evidence cannot launder a known conflict. (Consistent with the repo's existing anchor-conflict veto and fail-closed posture.)
4. **Consolidation discipline (Codex caveat, accepted):** characterization tests + explicit modes, no assumption that every duplicate is deletable.
5. **Institution before person (both):** matches the observed failure concentration (S399/S400, Shih) and produces the normalized affiliation evidence person/affiliation decisions need. Material sequencing choice, not a nit.
6. **Internal code inventory (Claude contribution, retained):** the quantified duplication diagnosis (14 person-name normalizer definitions / 8 distinct; 11 institution / 6 distinct; two independent nickname maps; ~25 boolean predicates) is what justifies step 1 existing at all.
7. **Review contract is a build item (Codex addition, accepted):** the PD affordance is not assumed sufficient until it shows candidates, evidence, contradictions, provenance, and dates; captures the reviewer's decision; and leaves unresolved cases retryable.
8. **Logging needs privacy/retention policy (Codex addition, accepted):** evidence contains names, emails, affiliations, provider data; access, redaction, retention, and audit boundaries must be defined before rollout.

## 4. Open questions for the owner (decision inputs, not blockers to accepting the shape)

> **Status update 2026-08-06 (S405): all six ANSWERED** — see
> `outputs/fuzzy-matching-owner-answers-2026-08-06.md` (owner-verbatim record).
> The questions below are preserved verbatim as the text Codex confirmed in
> round 2; do not edit them in place.

1. **Precision floor** for fully-automatic decisions (auto-collapse, auto-COI-drop, auto-link). Both agents' prior: ~zero tolerance for sibling-campus and person-merge errors that can reach an invite or payment; abstain-and-review is always the fallback.
2. **Review capacity**: acceptable human-review volume per search/cycle before bands must be re-tuned.
3. **ROR as canonical namespace** for research-institution identity (distinct from CRM/legal Accounts). Step 2 assumes yes.
4. **Benchmark investment**: falsification suite now (a few dozen hours of curation); when to fund the representative 1–2k-case benchmark — noting the consensus consequence that high-risk automation stays review-only until it exists.
5. **Affiliation representation policy** (new, from Codex): how multiple concurrent affiliations and "current" are represented — joint appointments, sabbaticals, missing end dates cannot be reduced to one winner without product policy.
6. **Contact-attribution semantics** (new, from Codex): does "contact verified" mean ownership only, current reachability, or separate verdicts? Affects the data contract and UI.

## 5. Nits deliberately left to the owner (no agent argument)

- Whether Shih is literally benchmark row one.
- Exact Phase 1/Phase 2 case counts.
- Band vocabulary: `resolved/review/unresolved` vs `resolved/ambiguous/no-match`.
- Jaro–Winkler implemented locally (~60 lines) vs a small dependency.
- Exact ordering of the illustrative seam-risk ladder.

## 6. Downstream consequences (already decided by the owner, restated for context)

Per `project-reviewer-card-simplification-direction`: the candidate-card redesign (status band / Details disclosure / footer split) follows this matching decision — the card's status band should render the scorer's three-band verdict, not a hand-assembled precedence chain. The containment-first comparison fix is expected to be absorbed as a property of the shared institution scorer unless the benchmark shows the case is common and urgent, in which case a stopgap ship is explicitly acceptable.

## 7. Process record

- Round 1 (2026-08-06): Claude draft → Codex response: ENDORSE on sequencing, three COUNTER-PROPOSE amendments (calibration boundary, consolidation discipline, decision-specific models + vetoes), eight material additions, five nits, "CONSENSUS: YES (amended shape)". Claude accepted all amendments.
- Round 2 (2026-08-06): Codex read this document and confirmed it as the joint position.
- Model note: the requested `--model sol-5.6` was rejected by the Codex account ("not supported when using Codex with a ChatGPT account"); both rounds ran on the Codex CLI default model.
