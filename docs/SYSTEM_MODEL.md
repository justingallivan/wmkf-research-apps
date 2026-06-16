# WMKF System Model

**Status:** Canonical conceptual model, v2 (synthesized S197, 2026-05-28, after an outside-review
pass by Codex). This is the **architecture/decomposition** layer — the *why* and *how it fits
together*. For the live feature catalog see `docs/SYSTEM_OVERVIEW.md`; for the strategic narrative
see `docs/STRATEGY.md`; for the system-of-record matrix see `docs/APPLICATION_STATE_ATLAS.md` (+
`docs/atlas/`). **Where this doc conflicts with an older doc on the points below, this doc wins** —
but a full reconciliation of stale "pilot"/phasing references across the repo is **still pending**
(see "Drift reconciliation status").

---

## How to read this

The model has one organizing principle, two orthogonal axes, and a small set of layers. Get those
and the rest follows.

- **Organizing principle (the why):** *Automate what is rote; encourage thinking.* (Leadership.)
- **Two orthogonal axes** (do not conflate — v1 did): an **automation axis** and a **storage/state
  axis**.
- **Layers:** an event/state model (the backbone) → platform contracts → domain services →
  capabilities (where value lands) → substrate.

---

## Glossary

Defined because the model leans on these terms structurally (the outside reviewer got lost without
them):

- **AkoyaGO** — the grants-management vendor app on Dynamics 365; staff's current primary CRM UI.
- **GOapply** — AkoyaGO's applicant portal (the thing the intake capability replaces for our scope).
- **Dataverse** — Microsoft's database; WMKF's system of record. **Dynamics 365** is its UI/automation layer.
- **PA (PowerAutomate)** — Microsoft's backend automation engine; flows built by the vendor + Connor.
- **PD** — Program Director (the staff member who owns a grant request).
- **Request** — a grant request record (`akoya_request`); the unit of work a PD acts on.
- **Workbench** — the planned per-request staff surface (`/workbench/[requestId]`) that unifies
  per-request operations (proposal viewer, reviewer lifecycle, analyses, etc.).
- **Reviewer Pool** — a planned request-agnostic surface for browsing/managing the reusable reviewer roster.
- **Executor / Executor contract** — the written spec for "run one prompt"; implemented twice
  (Vercel JS `executePrompt()`; a PA child flow). See `docs/EXECUTOR_CONTRACT.md`.
- **Thin adapter** — the small amount of input-gathering + output-routing code wrapped around a
  shared prompt; what's left of an "app" once the prompt lives in Dataverse.
- **Sidecar entity** — a 1:1 satellite table holding extra fields for a parent record (e.g., the
  reviewer bibliometric sidecar slated for collapse).
- **Mode 1 / Mode 2** — the two interaction modes (orthogonal to where data comes from). **Mode 1**
  is a *declarative task*: a fixed canonical prompt → a defined Dataverse/SharePoint output, governed
  by the Executor contract. **Mode 2** is an *interactive session*: an open-ended chat/agent loop with
  ephemeral output. The mode decides whether the prompt machinery applies at all. See
  "Storage tiers + two interaction modes" below.
- **drain** — moving data *out of* Postgres toward Dataverse (the system of record). Two related
  senses: (1) **drain-only** describes a Postgres table that is no longer authoritative — its rows
  were migrated to Dataverse and the table is kept only as historical/staging (e.g., the reviewer
  tables, `grant_cycles`); (2) the **submission drain** (`/api/cron/drain-submissions`) is the cron
  that advances queued intake `submission_jobs` one state at a time and lands them in Dataverse.
- **slice-0** — the foundational schema increment for the intake-portal pilot: the first set of
  Dataverse schema changes (such as institution membership, roster rollup, and the request-person
  role picklist) that the drain + portal build sits on. Deployed to prod Dataverse 2026-05-22. The
  relevant slice-0 entries are cataloged in `docs/INTAKE_PORTAL_SCHEMA_CHANGES.md` (which also tracks
  later, non-slice-0 schema work).

---

## The organizing principle (the why)

> **Automate what is rote (→ Dataverse). Encourage thinking (→ Postgres / local device).**

This is leadership's mandate and the strategy's "automate the tedious parts, not the judgment."
It is a **values / automation** statement — it answers *do we automate this, and where does the
human sit* — **not** by itself a storage rule. (v1's mistake was overloading it as the storage rule
too; see the two axes below.)

## The two orthogonal axes

| | **Automation axis** (rote ↔ thinking) | **Record-maturity axis** (storage/state) |
|---|---|---|
| Answers | Do we automate it? Where's the human? | How settled is this artifact? Where does it live? |
| Values | rote → automate, human out of loop · thinking → encourage, human in loop | scratch → draft/staged → workflow-state → accepted record → audit evidence |
| Storage hint | rote tends Dataverse, thinking tends Postgres/local | maturity decides the tier; not a 1:1 with the automation axis |

They're **orthogonal**: an AI summary is *rote output* (automation axis) that lands as a *provisional
draft* (maturity axis); a PD then edits it (*thinking*) and it becomes an *accepted record*. One
artifact moves along both axes independently. Model storage/state on the maturity axis; model
automate-or-not on the rote/thinking axis.

---

## The organizing frame

The Vercel app suite is a **working layer over Dataverse + SharePoint (the source of truth)** —
never a second database. The system is mid **flow-inversion**:

```
Was:    user uploads PDF  →  AI processes  →  user re-uploads to the CRM
Now →:  data already in the CRM  →  AI works on it in place  →  written back
Toward: a backend status-change triggers the AI itself; staff read & refine
```

The **center of gravity is moving frontend → backend.** The frontend doesn't die — it is the
*"encourage thinking"* half of the mandate, and splits into the **Workbench** (daily read/refine)
and **ad hoc / override tools** (the exception case).

**Modularity over pipeline (deliberate):** per `STRATEGY.md`, the grant cycle is in flux, so the
*build* is organized as **modular, recombinable capabilities**, not a rigid lifecycle pipeline. The
**grant lifecycle** (Intake → Screening → Downselect → Reviewer Lifecycle → Decision/Closeout →
Reporting) is the right **stakeholder-facing narrative** (use it in scoping docs) but is *not* the
architectural axis.

---

## The upstream fact: grant phasing

**One applicant submission, entered as Phase I.** All application materials arrive once, at Phase I.
An internal downselect flips a request's status to **"Phase II"** = *advanced into the working
process* (find reviewers, evaluate). **It is not a second submission. There are no Phase II uploads;
it is a status flip only.** Staff work the Phase I materials for the whole lifecycle.

→ This Phase I→II flip is a **first-class event** (next section), and the trigger for the reviewer
lifecycle and the backend automation. The intake UI therefore only ever builds the **Phase I
package** (text fields + document uploads + budget form); there is no Phase II upload surface, ever.

---

## The event / state model (the backbone)

Promoted to a first-class layer (it is *not* a missing implementation detail). Almost everything
hangs off events and state transitions:

- **Lifecycle events:** `proposal-submitted (Phase I)`, `phase-advanced (→ Phase II)`,
  `review-submitted`, `review-closed`, `payout-*`.
- **Reviewer state machine:** `find → invite → onboard(agree-terms · BILL setup · proposal
  distributed · progress tracked) → review-intake → closeout → payout`. **This state machine is the
  core of the reviewer capability — its absence is the main gap, not a sub-feature.**
- **Backend automation** subscribes to lifecycle events to materialize artifacts (below).

---

## Platform contracts (generic, domain-agnostic)

1. **The prompt contract.** Every *shared* LLM call uses the **same prompt** regardless of who
   initiated it or where output goes. Shared prompts live in Dataverse (`wmkf_ai_prompt`). The
   **Executor contract** is implemented **twice, independently** — Vercel JS `executePrompt()` (the
   reference implementation) and a PA child flow. **Neither calls the other**; both read the prompt
   from Dataverse and call the Claude API directly, kept aligned by the spec + a byte-identical
   conformance test. *(Verified in-repo on the Vercel side at `execute-prompt.js`; the PA
   implementation is Connor's, off-repo, so "neither calls the other" is per-contract, not
   repo-verified.)*
   - *Operational risk (un-hand-waved):* two independent implementations means **release ordering,
     version compatibility, drift detection, and rollback** across runtimes are real concerns. The
     conformance test is the drift detector; release-ordering/rollback ownership is **not yet
     defined** and should be before the PA side ships broadly.
   - *Status:* contract shipped (Vercel). Today **one live route** (`/api/phase-i-dynamics/summarize-v2`)
     reads its prompt from Dataverse via the Executor; the rest still use bundled in-repo prompts —
     which live in **three places** per the A7 surface taxonomy: `shared/config/prompts/`,
     route-local, and service-local (e.g. `panel-review-service.js`). **Prompt migration is a named workstream, not a background detail.**
     Migration is **demand-driven**: a prompt moves to Dataverse when it becomes **shared** (a second
     caller, esp. PA). *(Open fork: does staff-editability* also *force a Dataverse home, or only
     cross-surface sharing? — unresolved.)* (Counts: the canonical **app count is 17**; the A7
     prompt-injection **input-surface registry is 24** — different denominators, don't conflate.)
2. **Identity & access scoping** — who sees what (per-app grants, active-user checks, superuser;
   dual-provider auth for staff vs. applicants). **Applies to documents too** (see resolution).

## Domain services (grant-domain-specific shared services)

3. **Document resolution over SharePoint** — resolves "the *proposal* for request X" to a specific
   file and presents a clean link, instead of dumping the user into a noisy folder. Intended as a
   **stateful domain service**, not a primitive — see "Document resolution: the failure-mode model."
   **Target-state:** today's code is path-based (`GraphService.downloadFileByPath` resolves by
   library/folder/filename); the provenance-tier index below is design, not built.
4. **Per-user personalization** — the layer over shared cores (a PD's preferred reviewer-email
   wording, model choice, settings). Lets "same shared prompt, my email voice, only my records"
   coexist without forking the shared prompt. Prompt resolution is the same shape (below).

---

## Capabilities (where value lands)

Numbering dropped (v1's `2+3`/no-`4` was confusing inherited cruft).

- **Applicant Intake** (`/apply/*`) — the front door. One Phase I submission: text fields +
  document uploads + a budget form. *Auth/attach/draft-drain shipped; form schema + child-record
  creation in flight.* Build for next cycle; **testable sooner.**
- **Reviewer Lifecycle → Request Workbench + Reviewer Pool** — *the core work for a while.* The
  **workflow** (the reviewer state machine above) realized through the **surface**: a per-request
  Workbench plus a request-agnostic Reviewer Pool. **BILL.com is a first-class set of workflow
  states**, not a "bookend" — vendor setup, payment eligibility, failed payouts, reconciliation,
  tax/compliance, and human exceptions are real states (see `docs/BILL_HONORARIUM_INTEGRATION_DESIGN.md`;
  banking PII stays at BILL, never Dataverse). *Most activities have built pieces scattered across
  three surfaces (staff Reviewer Finder, staff Review Manager, reviewer-facing token flow); the
  connective state machine + unifying UI are missing; the finding engine works but is
  workflow-incompatible with a bad UI → needs rework.*
- **CRM Access & Power Tools** — the unified data/document view AkoyaGO can't give: NL CRM chat
  (Dynamics Explorer), bulk export + find/fix, staff-expertise matching. *(Acknowledged as a broad
  bucket; revisit if it needs splitting.)*

**Not a capability — "Backend Automation."** It has no surface of its own; it *produces* artifacts
that surface inside the capabilities above. It is a **dependency / collaboration workstream**, built
mostly in PowerAutomate by Connor, sharing only the prompt contract with the Vercel suite. Central
to sequencing; not a thing a user "uses."

**Legacy apps are dissolving.** Most app surfaces are *a summarization prompt + a thin adapter*.
As backend triggers land, a prompt's primary caller flips from the Vercel UI to PA, and the
user-facing app demotes from daily-driver to ad-hoc/override. The app isn't rewritten — it's
re-weighted. Some are retired outright by the cycle change. **Sorting rule = the automation axis:**
*"output we'll want for many proposals, the same way each time"* → backend (and its prompt migrates
to Dataverse); *turn-by-turn judgment* → stays user-facing (Mode 2).

---

## Storage tiers + two interaction modes

**Storage tiers:**
- **Dataverse** — canonical/shared/settled organizational truth (rote outputs, shared prompts).
- **Postgres (on Vercel)** — (a) **staging** for data bound for Dataverse but not yet clean;
  (b) **custom user functions** (a PD's experimental personal prompt); (c) **permanent
  app-operational** data (logs, audit, alerts). A Postgres artifact that proves broadly useful is
  **promoted** to Dataverse (cleaned, then shared). *(Promotion governance — who approves, schema
  normalization, history migration — is under-specified; define when built.)*
- **In-repo bundled** — built-in default prompts (single-surface, not yet shared).

**Prompt resolution — TARGET/conceptual layering** (no single current code path implements it):
`Postgres per-user override → Dataverse canonical/shared → in-repo bundled default`.
*Current reality:* the Executor (`execute-prompt.js:215`) reads Dataverse and **throws if no current
prompt row exists — there is no bundled fallback in that path**. A bundled fallback exists only in the
*legacy* `prompt-resolver.js` (gated by `PROMPT_RESOLVER_STRICT`), and the **Postgres per-user override
tier is not built**. The three-tier order above is the intended end-state, not today's behavior.

**Two interaction modes** (orthogonal to origin/destination; the mode decides whether the prompt
machinery even applies):

| | **Mode 1 — Declarative task** | **Mode 2 — Interactive session** |
|---|---|---|
| Shape | fixed prompt → defined output | open-ended chat / agent loop |
| "Prompt" | canonical, shared, Dataverse, cached, audited | whatever the user types — no canonical prompt |
| Output | Dataverse field / SharePoint doc (org memory) | ephemeral — in-app transcript / export / download |
| Examples | proposal summary, Phase I writeup, integrity screen | "consult LLM on this proposal"; NL CRM chat; Phase II "ask questions" |
| Governed by | Executor contract, prompt migration, dual-caller | context assembly + ephemerality only |

**"Consult LLM" (Mode 2 exemplar + de-risking first slice — target-state):** in the Workbench the
proposal is already linked; a PD clicks "consult LLM" → a chat opens with the proposal auto-attached
(from the document index — *which isn't built yet; see the target-state banner under "Document
resolution"*) → ephemeral output (transcript/export/download, *not* Dataverse). Low-dependency (no
state machine, no payments, no prompt migration) but exercises the highest-value plumbing (linked
docs → in-context LLM) end-to-end. Also doubles as the document-correction surface (below).

---

## Document resolution: the failure-mode model

> **Target-state design, NOT current implementation.** Today resolution is path-based
> (`GraphService.downloadFileByPath` resolves by library/folder/filename; `sharepoint-buckets.js`
> returns `{library, folder, source}`). The provenance-tier index, driveItem-ID pointers, and
> tier-gated automation below are the *intended* design — none is built yet.

Resolution should be a **stateful domain service**. Every resolution carries a **provenance tier**, and the
*tier — not the file — gates how it may be used*:

| Tier | Origin | Safe for |
|---|---|---|
| **Corrected** | a human explicitly re-pointed (request, role) → file | everything; overrides all; audited |
| **Authoritative** | backend recorded `request + role + pointer + provenance` when it filed the artifact | Mode-1 automation |
| **Heuristic** | legacy filename/folder-shape guess | **Mode 2 only** (human in loop); never silently feeds Mode 1 |
| **Unresolved / missing** | nothing matched | **hard stop** — not an empty input |

**Two structural moves delete whole failure classes:**
1. **Pointer = stable Graph `driveItem` ID + (library, role), never a path/filename** → kills
   renamed/moved docs and most stale links (rename/move keeps the ID; deletion → 404 → demote +
   flag). *(Verify whether `GraphService` currently keys on IDs vs. paths; if paths, that's the
   first fix.)*
2. **Resolution returns a set with confidence** — `{pointer, role, tier, confidence, alternatives[],
   version}` — so **duplicates** and **false positives** are *explicit*, not silently picked.

**Failure modes → handling:**
- **Heuristic false positives** (the nightmare: confidently-wrong file feeding an LLM) → heuristic
  tier can't reach Mode 1; Mode 2 shows alternatives + "is this right?".
- **Duplicates** (applicant v1/v2; raw vs PA-merged; live vs archive copy) → one canonical per
  (request, role), rest tagged `supplementary`; heuristic surfaces ambiguity.
- **Permissions mismatches** → (a) document links respect access scoping (a PD only gets links for
  in-scope requests); (b) app's own missing rights on a library = **fail-loud**, not silent "no proposal."
- **Missing proposals** → distinguish "indexed-and-absent" from "not-yet-indexed"; either way
  `unresolved` → hard stop for automation. (Empty ≠ "proceed without a proposal.")
- **Stale links** → ID-based pointers + validate-on-fetch; 404 → demote + re-resolve + flag.
- **Wrong-request attachment** (real file, wrong request — number/institution collision) → only a
  human catches it; must be correctable.
- **Version drift** (resubmission, edited writeup) → "current version" marker; Mode-1 artifacts
  record which version they used so a change can trigger re-run.
- **Multi-document roles** ("supplementary materials" is inherently many) → index can't assume 1:1.

**The hard rule:** Mode-1 automation requires `authoritative` or `corrected`. Heuristic or missing →
**block and flag for a human.** Never let a guessed document become a Dataverse-written artifact.

**Self-healing loop:** the Mode-2 consult surface *is* the provenance-correction workflow. A PD who
notices the wrong/old PDF re-points it inline → audited → **upgrades the tier** (heuristic →
corrected) → future Mode-1 automation on that request becomes safe. **Human attention upgrades
provenance maturity** — the same promotion pattern as Postgres→Dataverse and scratch→record. The
legacy corpus hardens through use.

---

## Substrate (enabling, not capabilities)

- **Data-model consolidation** ("keep everything in Dynamics"): multi-wave Postgres→Dataverse
  migration; remaining cleanup includes the reviewer bibliometric **sidecar collapse**
  (`docs/APPRESEARCHER_COLLAPSE_PLAN.md`). This sits *under* the Reviewer capability, so its real
  gate is **"the reviewer Workbench has stabilized," not the (defunct) intake pilot.**
- **Auth & security:** dual-provider auth, prompt-injection hardening (shipped), virus scanning.
- **System-of-record matrix:** already exists — the **Application State Atlas** (per-entity
  source-of-truth / read-paths / write-paths). Use it; don't restate it here.

## Stakeholders

PDs, applicants, reviewers, Connor (PA/CRM), and the vendor are well-represented. **Under-represented
and owning real decisions:** **finance/accounting** (payouts, reconciliation), **compliance/security**
(records, audit, access), **grants operations**, **admins**, and **leadership** (the rote/thinking
mandate). A stakeholder pass is owed, especially around BILL payout and records/audit.

---

## The simplifying realizations this model is built on

1. **An app = (a prompt in Dataverse) × (a thin adapter).** App surfaces → *N prompts + a few adapter
   shapes* (Workbench tab · PA trigger · ad hoc standalone).
2. **The workflow and the surface are one initiative** (reviewer lifecycle = Workbench v1), with the
   **state machine as backbone**.
3. **Backend automation is a dependency, not a capability**, and runs mostly off-platform (PA),
   sharing only the prompt contract.
4. **Documents + search + provenance are one shared index** (written by the backend, read by the UI
   and search), with **provenance tiers** gating use.
5. **Two axes, not one:** automate-or-not (rote/thinking) is independent of how-settled
   (record-maturity). Storage location follows maturity; automation follows rote/thinking.

---

## Drift reconciliation status

A drift-audit workflow + grep inventory drove the cleanup (S197). **Done:**
- The stale **"mid-June 2026 Phase II Research pilot"** cluster is reconciled across the high-impact
  current-state surfaces (CLAUDE.md, MEMORY.md, STRATEGY.md, SESSION_PROMPT.md, the intake memories,
  the atlas page, BUDGET_FORM_SPEC, REVIEWER_POSTGRES plan). `INTAKE_PORTAL_DESIGN.md` carries an
  authoritative SUPERSEDED banner (its 56KB body is a record of the cancelled pilot, not rewritten —
  pending the next-cycle form redesign). The dual-meaning hazard was respected: the live J26
  reviewer peer-review "mid-June 2026" deadline refs and the 142 live `Phase II Pending` status refs
  were left untouched.
- The earlier no-judgment drift findings (dropped-Wave-1-table pointers, reviewer pre-cutover
  framing, Next-16 `middleware.js`→`proxy.js` / Edge→Node renames, stale `execute-prompt.js` line
  pointers) are fixed.

**Residual (intentional):** dated/historical snapshots (e.g., REVIEWER_POSTGRES schedule rows, a
Connor Q&A record) and the `phase-ii-research-2026-06` form-module *path* references (a real built
artifact — see "Open / deferred").

**Still open:** a glossary propagating the term definitions to kill the jargon-legibility gap.

## Open / deferred

- Staff-editability vs. cross-surface-sharing as the prompt→Dataverse trigger (fork, unresolved).
- Promotion governance (Postgres→Dataverse).
- Executor release-ordering / rollback ownership across runtimes.
- The dependency/**sequencing** pass (the original goal) — do after persist + drift reconcile.
