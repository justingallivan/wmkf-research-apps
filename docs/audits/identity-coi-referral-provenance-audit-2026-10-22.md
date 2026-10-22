# Identity, COI, exclusion, referral and provenance audit — 2026-10-22

**Bounded source audit; whole-domain verification AUDIT INCOMPLETE.** Sol
investigated the remaining safety contracts, Luna repaired documentation, and
the parent checked source branches and diffs. Only documentation changes are
authorized here. Runtime code, live records, environments, deployments and
worktrees remain unchanged. No live probes, sends, paid calls or pushes.

## Scope and evidence standard

Sweep Mode B / contract-reconcile review. Claims: identity and address authority
at Find promotion; institution screening and exceptions; request-local exclusion;
referral capture/closure; signed receipt versions; acknowledgement provenance;
shared-person field preservation. Entry points are discovery/enrichment,
Find save, manual Add/Refer, decline/respond, referral GET/PATCH and policy
context/accept routes. Persistence is the operational Postgres roster plus
Dataverse person, suggestion and policy fields. Consumers are staff cards,
promotion results, referral lists, invitation gates and later agents.

Owner decisions are invariant: no on-card client COI recheck; Broad/HHMI-only
overlap exemption; request-local applicant exclusion; sparse staff manual add;
foundation exclusion-policy breadth still open; reviewer acknowledgement parity
remains a minor follow-up. Org-open merge/read policy, Finance authority and
existing BILL/reminder/intake holds are unchanged. The prior PI role-source
conflict remains open in the [PI/authorization audit](pi-identity-request-mutation-audit-2026-10-22.md).

Large source files were read in relevant logical regions; edited durable files
require whole reads. Source evidence does not establish current hosted flags,
schema, published policy text or affected record populations.

## Contract and evidence matrix

| Claim | Producer / persistence / consumer | Evidence and contrary check | Status |
|---|---|---|---|
| Human-grounded provenance independently authorizes Find promotion | `reviewer-provenance.js` → Find roster → save/UI | Kind exemption at `:212-218` bypasses only early unresolved rejection; save `:977-990,1215-1251` withholds before writes without ready contact/authority. | Refuted; old selectable/force-null summaries STALE |
| One contact projection supplies every address gate | `reviewer-vetted-email.js:93-208` → save and Find | Independent source/address authority in save `:1255-1359` and UI `reviewer-search-logic.js:70-75`; do not infer research-only permission from identity readiness. | Refuted as a universal guarantee |
| Automated receipts currently mint v4 | `reviewer-candidate-attestation.js` → browser/roster → verifier/save | Constants `:19-20` mint 3, accept 1/2/3; `:223-274` limits contact authority to v3 exact ready projection. No v4 accepted. | STALE current restatements |
| Receipt signs eligibility check completion | Same helper → eligibility projection | `:161-179` binds status, reason and bounded evidence, not `eligibilityCheckStatus`. Immutable roster key is included when provided, not mandatory for every historical token. | Refuted |
| Manual Add/Refer must obey Find's ready-only rule | Manual route/service → person/suggestion → Invite | `manual-reviewer-service.js:156-178,237-267` deliberately permits sparse creation; `REVIEWER_MANUAL_ADD_DESIGN.md` explicitly requires only a name. Separate contract, not a bypass inferred from Find rules. | VERIFIED source/recorded intent |
| Save trusts only client institution flags | Save → payload/reuse target screen → person/suggestion writes | `save-candidates-service.js:652-673,357-427,1117-1211` loads trusted context and recomputes. Read/identity-affiliation failures withhold; accepted manual client edit decision remains distinct. | STALE rationale |
| Broad/HHMI-only overlap is a direct university conflict | Curated matcher → COI decision → save/UI | `deduplication-service.js:30-43,849-902,1227-1243`; shared screen `:59-61` chooses non-exempt over exempt; save `:1185-1206` honors exemption. | Refuted; distinct owner-approved exception |
| All institution exemption outcomes are UI selectable | Matcher → Find selection | Exempt DTO retains `hasInstitutionCOI:true` with `institutionCOIExempt:true`; `isCandidateSelectable` requires no COI marker. Source asymmetry remains; no live outcome tested. | PARTIAL; do not promise promotion |
| Applicant exclusion is a global person judgment | Request/suggestion → save/manual collision guards | `wmkf_applicantdisposition` lives on suggestion junction; excluded wins on existing/race-winner manual rows (`reviewer-suggestion.js:1127-1131,1174-1177`). | Refuted; owner request-local policy preserved |
| Structured excluded ingestion is necessarily shipped | Request producers → excluded junction state | Adapter supports exclusion; bounded runtime-writer scan found recommendation producers, not a current excluded-disposition producer. | UNKNOWN producer coverage; do not promote old future plan to built state |
| Referral closure proves canonical identity | Decline memo → request-local closure list | `decline-referrals-service.js:66-88,103-150` requires referred provenance, selected/handled non-declined row, normalized exact name and exact email if supplied. Name-only closure deliberately lacks person identity proof. | VERIFIED narrower contract |
| Referral dismissal may apply an old index to changed content | GET content version → PATCH → memo | Adapter `:648-741` checks request, declined state, underlying payload version, index and ETag; one 412 reread; same-width mask preserves payload; already-resolved returns before write. | Refuted in bounded source trace |
| Reviewer and grantee acks prove identical provenance | Policy context/respond → acknowledgement fields | Reviewer `respond-service.js:388-418` resolves active versions at accept, adapter `:2147-2153` stores versions/times. Grantee context signs returned version/body hash; token `:186-243`, upload `:214-220`. Neither proves human reading. | VERIFIED distinction; reviewer body-hash parity PLANNED |
| Sticky decision metadata protects every earlier identity-bearing field write | Save → researcher overlay → decision update | Save `:1546-1570` overlays fields before `:1586-1618` checks decision binding. Researcher `:180-211` merges metrics/fills empties; `:399-473` protects decision metadata only. | SOURCE-CONFIRMED ordering gap; actual impact UNKNOWN |

Source shorthand: `save-candidates-service.js` is
`lib/services/reviewer-finder/save-candidates-service.js`; person adapter is
`lib/dataverse/adapters/researcher.js`; provenance helper is
`lib/utils/reviewer-provenance.js`; shared COI screen is
`lib/services/reviewer-institution-coi-screen.js`; referral service is
`lib/services/workbench/decline-referrals-service.js`; suggestion adapter is
`lib/dataverse/adapters/reviewer-suggestion.js`.

## Important differences preserved

Find retention, automated promotion, staff manual add, canonical identity and
send authority are separate contracts. A referral strengthens origin/ranking;
it does not verify a mailbox or confer permission to send. The referred seed
exception re-reads the person and re-runs exact email/ORCID lookup against the
same target (`save-candidates-service.js:577-613`). Staff confirmation binds
exact server-stored values; it does not validate automated bibliometrics.

The seven provenance kinds are defined in `reviewer-provenance.js:9-19`.
Grounded bonus membership includes cited, proposal-named and referred (`:34-38`).
Kind existence does not establish that every proposed origination lane shipped.
S232 ranking deltas are a dated migration analysis, not a universal present-day
score guarantee. Referrer text owns the first line using the canonical
format/split/parse helpers (`:331-393`); old space-joined text can remain lossy.

Exact normalized applicant/staff exclusion (`reviewer-name-match.js:47-64`)
differs from fuzzy proposal-author exclusion (`discover.js:273-283,339-373`).
Do not consolidate these helpers or reinterpret an applicant exclusion as a
global fitness flag. Foundation policy breadth remains unresolved.

The low-trust contradicted-affiliation Phase C case remains visible and
unsaveable. Broad/HHMI-only overlap is a separate exempt decision; direct
institutional overlap wins. This does not waive all other eligibility,
identity, address or client selection gates. Coauthor checking also preserves
incomplete/failure evidence (`discovery/coauthor-coi.js:77-124`), roster projection
`reviewer-roster-projection.js:442-445`, and Find's incomplete warning. No silent
clean-on-error defect was established in that bounded path.

## Shared-person ordering finding and disconfirmation

The parent independently checked the save overlay preceding decision update and
the adapter branches. `writeIdentityDecision` preserves stored confirmed and
probable metadata, requires overlap/ETag where applicable, and `clearIdentityFields`
abstains. These guarantees remain valid within those operations.

They do not roll back a prior overlay of nonempty incoming metrics or fill-empty
ORCID/Scholar fields. Sol checked whether reuse lookup already enforces stored
anchor overlap: `reviewer-identity-lookup.js:286-344,365-408` checks names, target
identity/contact linkage and exact-key matches, but can fall back from an unmatched
incoming ORCID to an exact-email same-name person without comparing the stored
verified-anchor set. Thus source ordering permits conditional field mutation
before a later `binding_conflict` result. No affected live person, reproducible
incident rate or runtime repair was established. Existing adapter tests focused
only on decision metadata cannot prove the whole save transaction safe.

## Durable-surface dispositions

| Surface group | Classification | Action |
|---|---|---|
| Identity wiki, enforcement summaries and provenance model | STALE | Reconcile retention/promotion, independent address authority, seven kinds and scoped safeguards |
| Current receipt claims in service catalog, two Atlas pages, lifecycle wiki and promotion plan | STALE | Mint v3/accept 1-3; no signed check-completion guarantee; preserve dated feature-branch record separately |
| Referral capture design/memory | STALE mixed current/history | Preserve approved D1-D5 chronology and sparse manual flow; explain distinct Find promotion/closure |
| Manual-affiliation rationale, COI policy omission, sticky-metadata wording, excluded-pool tail | STALE or incomplete | Preserve owner decisions; repair current scope and temporal assumptions |
| Active contact-leads spec, old gating redesign and D26 flowchart | STALE current framing | Reconcile operative claim or establish explicit historical boundary with current routing |
| Historical referral-seeding design and S213/S214-S219 identity records | HISTORICAL | Retain dated evidence; do not revive old force-null or remediation instructions |
| Acknowledgement parity memory | AGREE mechanism; STALE overstatement of human viewing | Sign returned content/version; retain minor planned reviewer parity |
| Incidental v4 plan-version and unrelated source hits | UNRELATED | No global text substitution |

Searches covered docs, memories, wiki, root/session instructions, rules/skills,
source, scripts and tests using raw identity/disposition/source/acknowledgement
fields plus semantic opposites. These are grouped dispositions, not an exact
per-sentence census. Unread or untraced readers remain in the backlog below.

## Prioritized next work

1. **P1 — shared-person field/decision continuity.** Add a focused disjoint-anchor
   save test with a reused exact-email person, existing metrics and empty identity
   fields. Assert all fields, not only status. Trace sibling enrichment and
   persistence writers; design a binding-aware write boundary before runtime
   repair. Do not erase stored evidence or infer population remediation authority.
2. **P1 — existing PI role conflict.** Resolve the prior audit's officer-as-PI
   fallback and unresolved-contact-name consumer through a separately reviewed
   runtime change; no fix occurs here.
3. **P1 — manual and exemption scope.** Establish intended institutional screening
   for the explicitly sparse manual path and the Broad/HHMI UI/server asymmetry.
   Preserve owner decisions; no silent new client recheck, blanket waiver or
   retrospective rejection.
4. **P1 — finish consumer proof.** Full discovery seed/collision flow, Find
   partial-save and transport recovery, send/materials eligibility closure, and
   all raw acknowledgement/provenance field readers remain only partially traced.
   Confirm excluded-disposition producer coverage before declaring it absent.
5. **P1 — action-specific read-only exceptions.** Awardee Preview/Copy/Export
   remains the next separate backlog area after these safety findings.
6. **P2 — acknowledgement parity.** Retain the owner's minor priority. A future
   render-bound reviewer token/body-hash change requires schema, Atlas, consumer
   and failure-path review. No schema work is authorized by this documentation pass.

Recommendation evidence: current source prerequisites and contrary branches were
read; no new race reproduction or live population probe was run. Runtime verdict:
**NEEDS NAMED TEST/DESIGN WORK**, not an implemented repair.

## Parent review and checks

The parent reviewed all 18 agent-edited durable files, the linked audit updates
and generated catalog diff. Sol challenged both the identity/COI and
referral/provenance repair sets. Review caught and corrected an invented
exclusion symbol, missing deceased-selection condition, optional roster-key
overstatement, overbroad source/address and shared-person guarantees, a missed
human-viewing claim, and historical/current design mixing. Historical ranking
terms and approved referral decisions were retained rather than silently
rewritten into later behavior. Large catalog, Atlas and lifecycle targets were
whole-read by their editing agent in nontruncated chunks; source review remains
bounded to the named branches.

Eleven existing focused test suites passed, **470 tests**:
`reviewer-candidate-attestation`, `reviewer-provenance`, `save-candidates-service`,
`reviewer-route-identity-gate`, the decline-referrals service/utils/endpoint,
institution-COI precision/history, researcher confirmed-stickiness and
reviewer-suggestion disposition. These tests use controlled fixtures; they do
not establish live schema, deployed behavior, real affected records or closure
of the newly identified write-ordering gap. No new tests or runtime files changed.

Agent-invariants, memory-router, fact-consistency, canonical-pointers,
doc-symbol-refs, build-claim-freshness, agent-wiki, harness-framing,
doc-currency and Atlas checks and their applicable self-tests passed. All
fixture-writing gate/self-test work ran serially. The existing memory-router
MaxListeners warning remains advisory. Docs-catalog initially rejected three
overlong summaries and the stale generated catalog; summaries were shortened,
the catalog regenerated, and the gate then passed. `git diff --check` passed.

Targeted final searches found no remaining reviewed current v4 receipt claims,
invented exclusion symbol or exact-human-viewing guarantee in repaired targets.
The historical branch-v4 note and unrelated template/prompt version references
remain; no global keyword suppression or checker change was used. This is not
an assertion that every other document or raw-field consumer was reconciled.

The unrelated critique, `output/` and owner-review-burden memory remain untouched.
Work is local only; no push or deployment. Verdict: documentary repairs checked
within the named scope; **runtime findings remain open; whole-domain and
live-state verification AUDIT INCOMPLETE**.
