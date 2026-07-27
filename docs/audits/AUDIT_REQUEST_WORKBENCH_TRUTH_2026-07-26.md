---
title: "Request Workbench truth audit — 2026-07-26"
domain: architecture
kind: audit
status: historical
summary: "Point-in-time, evidence-first audit of the Request Workbench lifecycle, its durable documentation, and the next-phase prerequisites."
canonical: false
fact_consistency: point-in-time
owner: product-engineering
related:
  - pages/workbench/[requestId].js
  - docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md
  - docs/WORKBENCH_REVIEWS_TAB_BUILDOUT_PLAN.md
  - docs/GROUP_B_WRITEUP_SPINE_DESIGN.md
---

# Request Workbench truth audit — 2026-07-26

## Scope and method

This is a bounded domain audit, not a claim that every sentence in the repository was
revalidated. It covers the Request Workbench lifecycle, the review-synthesis path, the
writeup spine, the Awardee workflow, and the durable documents, memories, and wiki pages
that describe them.

The audit established truth from:

- current source and caller/consumer paths;
- code-derived tab counts;
- production Dataverse metadata probes for proposed writeup and existing site-visit fields;
- the live `wmkf_ai_prompt` inventory;
- current tests and operational observations from the reviewer smoke work;
- a whole-repo durable-prose search for restatements and contradictions.

The labels below mean:

- **VERIFIED** — the claim is supported by current code or a named live probe.
- **PARTIAL** — a real implementation exists, but the broader claimed behavior does not.
- **PLANNED** — an intentional design exists without the required implementation.
- **STALE-CONFLICT** — durable prose conflicts with current evidence.
- **UNKNOWN** — an owner decision or external fact is still required.

## Executive finding

The Workbench has ten top-level tabs. Six are implemented and four are placeholders.
That fact was present in a later parenthetical correction, but the then-active build plan
still described six placeholders, Reviews as unbuilt, Awardee as future, and Site Visit as
requiring new Dataverse storage. Those statements are false today.

The underlying failure was structural: the old sweep procedure searched for restatements
after a known fact changed, but it did not first derive truth from code or challenge
semantically incompatible claims. The scalar fact gate also failed to see Markdown-bold
numbers. Both weaknesses were corrected before this audit was used to reconcile the
documents.

## Evidence matrix

| Surface or claim | Producer → persistence → consumer evidence | Verdict | Durable correction |
| --- | --- | --- | --- |
| Workbench shell has ten tabs | `pages/workbench/[requestId].js` `TABS` array; code-derived by `scripts/lib/canonical-facts.js` | **VERIFIED** | Canonical scalar recorded in `docs/CANONICAL_COUNTS.md`. |
| Six tabs are live; four are placeholders | Literal shell dispatch branches render Overview, Proposal, Reviewers, Reviews, Status, and Awardee. Initial Writeup, Pre Site Visit Writeup, Site Visit, and Final Writeup fall through to the placeholder panel. | **VERIFIED** | Old six-placeholder roadmap is retired; current plan owns forward scope. |
| Overview is a complete command center | `OverviewTab.js` renders request context, artifact presence, and reviewer rollup. Smart next-action and writeup lifecycle signals have no complete source. | **PARTIAL** | Describe Overview as v1, not as the finished lifecycle orchestrator. |
| Proposal is live | `ProposalTab.js` consumes request documents/metadata/AI artifacts and supports Field Primer generation. | **VERIFIED** | No remaining build claim. |
| Reviewers is live | `ReviewersTab.js` and the reviewer service/API path support Find, Invite Reviewers, and Track Reviewers, including the external reviewer lifecycle. | **VERIFIED** | Legacy design chronology remains historical only. |
| Reviews still needs a returned-review reader and summarizer re-home | `ReviewsTab.js` already reads structured submitted reviews, supports outstanding/reminder/manual-entry actions, comparison/export, and calls the synthesis route. | **STALE-CONFLICT** | Remove Reviews from the placeholder build sequence. |
| Review synthesis is production-ready | UI → `/api/review-manager/synthesize-reviews` → `synthesizeReviews` → `akoya_request.wmkf_reviewsynthesisjson` exists, but two production attempts returned incomplete JSON and wrote no memo. | **PARTIAL / RED GATE** | Keep the feature marked runtime-unverified until the parked production smoke passes. |
| Review synthesis runs automatically | Repository caller search finds the staff UI as the only route caller; there is no automatic trigger. The service only rejects a zero-submitted selection. | **PLANNED** | Current behavior is manual. Target behavior is automatic only when all invited reviews are in, with an explicit staff early-run override; declined/withdrawn participation semantics remain an owner decision. |
| Synthesis output is visible in an independent AI Synthesis card | The synthesis card is rendered inside the `submitted.length > 0` branch in `ReviewsTab.js`; no submitted review means no card even if stored synthesis exists. | **PARTIAL** | Target plan requires stored output visibility to be independent of generation readiness. |
| Status is live | `StatusTab.js` renders the normalized read-only request status from resolved context. | **VERIFIED** | No remaining build claim. |
| Awardee is future and requires generalizing reviewer `lib/external` first | `AwardeeTab.js`, `/api/workbench/grantee-deliverables/*`, `/external/grantee/[token]`, token handling, uploads, waiver/abstract/caption persistence, and the `wmkf_granteedeliverable` child entity are implemented. | **STALE-CONFLICT** | Awardee is a live end-to-end grantee-deliverables workflow. GAL-trigger automation remains separate and unverified. |
| Initial Writeup is ready to re-home | The shell tab is a placeholder. Legacy `pages/phase-i-writeup.js` remains hidden/routable, but the proposed URL field and new prompt row do not exist. | **PLANNED** | Treat the old page as reusable reference, not a ready Workbench integration. |
| Pre Site Visit Writeup is ready to build from the old Phase II engine | The shell tab is a placeholder. The proposed URL field and `writeup.pre-site-visit` prompt row do not exist. The design says returned reviews are an input, while its generation flow only specifies proposal retrieval. | **PLANNED / CONTRACT GAP** | Decide the authoritative inputs—raw reviews, synthesis, or both—before implementation. |
| Site Visit needs a new Dataverse notes field/entity | Production metadata probes found existing read/write `akoya_sitevisitdate` (`DateTime`) and `akoya_sitevisitnotes` (`Memo`) fields. | **STALE-CONFLICT** | First decide whether those fields satisfy the product contract; do not presume new schema. |
| Final Writeup can be a direct Phase II re-home | The tab is a placeholder and no complete producer/persistence/consumer path exists for site-visit findings. | **PLANNED** | Final Writeup depends on the Site Visit contract and the shared writeup artifact contract. |
| Proposed writeup URL fields exist | Production metadata probes returned 404/absent for `wmkf_ai_initialwriteupurl` and `wmkf_ai_presitevisitwriteupurl`. | **STALE-CONFLICT** if stated as built; otherwise **PLANNED** | The June design remains a proposal, not current schema truth. |
| Proposed writeup prompt rows exist | Live prompt inventory contains `phase-i.summary`, the `phase-ii.*` family, and `review-synthesis.generate`; it does not contain `writeup.initial` or `writeup.pre-site-visit`. | **STALE-CONFLICT** if stated as built; otherwise **PLANNED** | Prompt naming/migration is a design decision and provisioning task. |
| Reviewer Pool shipped with Workbench v1 | No Reviewer Pool app key or dedicated surface exists. Request-scoped saved reviewer data is live. | **PLANNED** | Keep it optional until staff need and deadline priority are established. |
| The whole Workbench needs a broader access model before writeups can ship | The page is currently gated by the `reviewers` app grant; the June Group B decision accepted that grant for the first writeup slice. Leadership/editor access remains a separate future design question. | **PARTIAL** | Do not make executive/editor access an accidental prerequisite for the PD writeup slice. |

## Document disposition

| Durable surface | Disposition |
| --- | --- |
| `docs/REQUEST_WORKBENCH_BUILD_PLAN.md` | Reclassified as historical implementation chronology. Its stale forward-scope section no longer owns current work. |
| `docs/REQUEST_WORKBENCH_SCOPING.md` | Remains historical rationale; current routing now points to this audit and the near-term plan. |
| `docs/GROUP_B_WRITEUP_SPINE_DESIGN.md` | Reclassified as a historical design proposal. Its proposed fields, prompt rows, D26 pilot timing, and input contract are not implementation truth. |
| `docs/WORKBENCH_REVIEWS_TAB_BUILDOUT_PLAN.md` | Remains the current detailed Reviews/synthesis implementation record, including the red production gate and owner-approved target lifecycle. |
| `.claude-memory/project-awardee-onboarding.md` | Reconciled to the shipped grantee portal and child-entity implementation; only GAL-trigger automation remains unknown. |
| `.claude-memory/project-reviewer-apps-redesign-direction.md` | Current-state routing moved to this audit and the new plan; its long session chronology remains historical context. |
| `docs/agent-wiki/topics/strategy-roadmap.md` | Current roadmap routing updated; the June Group B design is no longer presented as an active D26 pilot. |

## What remains genuinely unknown

1. The fixed dates and minimum operational outcome required at each deadline.
2. For synthesis completion, which invitation states count in “all invited reviews are in”
   (especially declined, withdrew, released, and revoked).
3. Whether Pre Site Visit Writeup consumes raw structured reviews, the stored synthesis, or both.
4. The canonical writeup artifact contract: file naming, SharePoint destination, pointer storage,
   regeneration/overwrite behavior, and version history.
5. Whether the existing site-visit fields are sufficient, and who owns editing them.
6. Which audience needs Initial, Pre Site Visit, Site Visit, and Final Writeup by which deadline.
7. Whether leadership needs a separate editorial dashboard in the near term.

## Falsification result

The revised fact gate now fails on the old bolded “6 placeholder tabs” claims, and its
self-test contains bold/code-wrapped stale-number fixtures. The repository cannot return
to green until the conflicting active roadmap is structurally retired or corrected. This
is the intended behavior: reconciliation is now forced by evidence, not recorded as a
successful sweep while contradictory active prose remains.
