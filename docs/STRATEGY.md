---
title: "Where We're Headed"
domain: architecture
kind: plan
status: active
summary: "Long-term product direction; current execution priority is owned by CURRENT_WORK_QUEUE.md."
canonical: false
cataloged: 2026-07-02
last_verified: 2026-08-17
owner: product-engineering
related:
  - docs/SYSTEM_MODEL.md
  - docs/CURRENT_WORK_QUEUE.md
  - docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md
  - lib/utils/sharepoint-buckets.js
  - scripts/probe-sharepoint-write.js
---

# Where We're Headed

**Last verified: 2026-08-17.** This document owns long-term direction and principles. The
ordered, current delivery agenda lives in `docs/CURRENT_WORK_QUEUE.md`; this document is not a
backlog.

---

## The Systems

Six systems support WMKF's grant workflow:

1. **Dataverse** — The database that stores WMKF's grant and CRM data: requests, reports, payments, applicants, contacts, programs, and their relationships.

2. **Dynamics 365** — Microsoft's interface for Dataverse. Includes cloud flows, business rules, workflows, and API access. PowerAutomate flows (built by the AkoyaGO vendor and Foundation staff) handle significant behind-the-scenes automation.

3. **AkoyaGO** — A Dynamics 365 app. The primary staff UI for searching, viewing, and editing Dataverse tables. Includes numerous Dynamics customizations for grants management.

4. **GOapply** — AkoyaGO's applicant portal. External website for applicants and grantees to submit proposals and interact with WMKF. Data maps to Dataverse; submitted documents route to SharePoint via Dynamics.

5. **SharePoint** — Cloud document storage. Two primary areas: the AkoyaGO site (where AkoyaGO stores documents, not meant for direct user access) and the WMKF site (shared staff documents with multiple sub-sites).

6. **Vercel App Suite** (this project) — purpose-built tools that summarize proposals, find reviewers, screen applicant integrity, explore CRM data, and more. Originally standalone, they now have expanding connections to the other systems. Applicant-intake foundation infrastructure exists under `/apply/*`, but the product build is parked while WMKF evaluates the GOApply re-engineering; see `docs/SYSTEM_MODEL.md`.

---

## The Problem

The workflow for reviewing applications is high-touch with manual tasks repeated for each application. The app suite simplifies higher-level tasks, but in its current form adds overhead moving documents between SharePoint and the apps.

AkoyaGO, as a Dynamics app, cannot directly display documents stored in SharePoint, requiring users to navigate between two systems for a single record. Information about individual applications lives in two places — Dataverse and SharePoint — with no unified view.

### What the workflow looks like today

```
AkoyaGO → Export PDFs → Upload to apps → AI drafts → Download → Edit → Re-upload to AkoyaGO
```

### What we're building toward

```
App Suite → Select proposal from Dynamics → Collaborate with AI → Save to Dynamics/SharePoint
```

The file shuffling goes away. The thinking doesn't. Staff still work with the material, shape the AI output, and make the calls. The tools just get them there faster and put the results where they belong.

---

## The Direction

The primary goal is to reduce the manual procedural work so staff can focus their time on analytical work. The app suite also has the potential to provide a faster, more unified interface for accessing data and documents — something AkoyaGO doesn't do well.

**Dataverse and SharePoint are the source of truth.** Our apps are a working layer, not a second database. Proposal data, contacts, documents, status — it all lives in Dynamics/SharePoint. We read it, work with it, and put it back. Over time, we reduce the friction that AkoyaGO creates for program directors by giving them cleaner, purpose-built interfaces for the work they actually do.

This is not a plan to replace AkoyaGO. There is significant business logic in PowerAutomate flows and Dynamics customizations, and there may be vendor/licensing dependencies that are not yet fully understood. The guiding principle is to **minimize reliance on AkoyaGO** and build things that would still work if it went away — but that's a long-term possibility, not a near-term goal.

### How the workflow is changing

The app suite started as a bottom-up effort to accelerate individual workflows. Without programmatic access to documents or CRM data, file upload was the only starting point — and the apps had to extract data from proposals that already existed as ground truth in Dataverse. That was a historical contingency.

Now we have read access to Dynamics and SharePoint, and leadership buy-in to use
AI for automation. The target direction inverts the flow: backend triggers may
initiate selected processing from proposal status changes. Staff currently use
the consolidated Request Workbench for reviewer finding/management; broader
Power Automate orchestration remains dependency-bound and must not be described
as shipped.

---

## Principles

**Keep everything in Dynamics.** Avoid creating secondary databases in the apps. Dataverse write access and the Wave 1/Wave 2 organizational-data migrations are complete; reviewer people and request engagements now live in Dataverse. App-operational data — logs, screening history, alerts, panel reviews, intake drafts/audit, and bounded evaluation evidence — remains in Postgres. Long-term organizational data should carry freshness and provenance rather than silently forking CRM truth.
<!-- [STALE-ACCEPTED: lib/dataverse/adapters/researcher.js — the word "researcher" above is prose about researcher profiles/candidates, unrelated to the adapter file; the S348 researcher.js change was comment-only, so nothing here is stale.] -->

**Keep things modular.** The grant cycle is changing and we don't know exactly what it'll look like yet. Each app and service should work independently so we can rearrange them as the process takes shape. Don't build a rigid pipeline for a process that's still being defined.

**Automate the tedious parts, not the judgment.** Document management, data entry, composing drafts, status updates — that's what should be automatic. Reading and reviewing proposals, finalizing recommendation materials, choosing reviewers — that's where staff bring their expertise.

**Create a unified view of data and documents.** From the user's perspective, data and documents should be part of a single record, despite being stored in Dataverse and SharePoint separately. This is something AkoyaGO cannot do natively.

**Preserve cycle-wide editorial work.** The per-request Workbench is not the
only useful view. Allison, all PDs, and designated staff proofreaders need a
staff-wide cycle Editor Dashboard that lists the governed artifacts, tracks
personal review progress, and opens the same canonical SharePoint Word files
directly. Explicit app and SharePoint permissions still govern access. It is an
index and workflow surface, not a second editor or document store.

**Build for where we're going, not where we've been.** The new grant cycle and the new tools should shape each other. Don't replicate the old process in code — build capabilities that serve whatever comes next.

---

## What We Have

| What | How | Status |
|------|-----|--------|
| Read CRM data | `DynamicsService` — OData queries, Dataverse Search | Working |
| Read SharePoint documents | `GraphService` — file listing, download, full-text search; multi-library walk via `lib/utils/sharepoint-buckets.js` | Working |
| **Write to SharePoint** | `Sites.Selected` + write role on akoyaGO site (granted 2026-04-15) | **Working** — verified end-to-end via `scripts/probe-sharepoint-write.js` 2026-05-01 |
| **Write to Dynamics** | App registration `prvUpdate` on `akoya_request`, `prvCreate`/`prvUpdate` on `wmkf_ai_run` | **Working** — granted/verified 2026-04-14; impersonation via `MSCRMCallerID` available behind `DYNAMICS_IMPERSONATION_ENABLED` flag |
| Send CRM-tracked email | `DynamicsService.createAndSendEmail()` | Working |
| AI proposal processing | Claude integration across [12](CANONICAL_COUNTS.md#app-definition-count) apps | Working |
| Reviewer discovery | Multi-database search + AI ranking | Working |
| Email generation | `.eml` files + direct Dynamics sending | Working |
| Review management | Workbench Reviewers tab + external-reviewer magic-link surface (`/external/review/[token]/*`) | Working |
| CRM chat interface | Dynamics Explorer with agentic tool use | Working |
| Auth + access control | Dual-provider NextAuth (`azure-ad` staff + `entra-external` applicants) + per-app grants + middleware gate | Working |
| Dynamics request linking | `request_number` on reviewer/proposal tables; reviewer-finder cutover to Dataverse-native `wmkf_apprequestperson` junction (S139) | Done |
| User feedback logging | Thumbs up/down + auto-detection on Dynamics Explorer | Working |
| Operational monitoring | Health checks, log analysis, maintenance cron, alerts, secret-expiration tracking, spend monitoring | Working |
| Executor AI audit trail | `wmkf_ai_run` child entity — Executor-backed calls attempt append-only model/prompt/status logging; direct LLM paths such as VRP, Integrity, and Dynamics Explorer use other persistence/telemetry | Working for Executor consumers |
| Backend prompt store | `wmkf_ai_prompt` Dataverse table — current rows are read directly by the Executor; bundled prompts and direct-service prompts also exist outside this store | Working, not universal |
| Executor contract | `lib/services/execute-prompt.js` — Vercel implementation is live; Power Automate progress is external/dependency-bound and requires owner confirmation | Vercel done; PA unverified |
<!-- [STALE-ACCEPTED: lib/services/execute-prompt.js — S344 added the additive, backward-compatible assertSystemIncludes option; the "Vercel done" Executor-contract status here is unchanged.] -->


## Current execution

The ordered agenda is maintained in `docs/CURRENT_WORK_QUEUE.md`. The near-term sequence is:

1. close the partially successful human-in-the-loop Initial Assessment pilot.
   Its 2026-08-10 target was a deliberately early **internal buffer, not an
   external commitment** (owner, 2026-08-10 / S412); it passed unmet because the
   administrator evidence is still outstanding with Connor, and that is expected
   rather than slippage. Proposal intake around 2026-08-18 is the unchanged
   external date. The controlled
   Request `1002788` rehearsal generated and registered the canonical
   SharePoint artifact, exposed that same item in Workbench and the cycle
   locator, created native version history, and proved exact-input no-duplicate
   retry. It also exposed whole-package SharePoint hash drift in
   interrupted-finalization recovery and a missing AI-run request lookup. The
   deployed runtime now uses normalized governed-DOCX hashing and supplies the
   request GUID to the Executor; tests include the actual pilot packages.
   Request `1003109` production-proved the canonical proposal, exact-input
   reuse, a new linked run, and interrupted-finalization recovery using the
   same registry row, AI run, SharePoint item, and version. An attributed
   substantive edit then passed on that same stable item through both
   consumers. Response-only Graph-current refresh by stable identity is
   deployed and live-verified in both consumers on Request `1003109` via
   production deployment `dpl_HhiYXVFAtsGMwjU9UDcKz22AfvR2`. A disposable
   production-library audit also proved previous-version inspection/restore
   and signed-in first-stage recycle recovery. Next obtain administrator
   evidence for version limits, second-stage recovery, retention, and editor
   least privilege, and build Workbench history/admin restore plus milestone
   snapshots;
2. complete the signed-in smoke of the deployed Pre-Site client recovery path. Request
   `1002379` created one Ready/Draft row, completed governed v3 AI run, current
   request pointer, and stable Word item from the exact narrative-only source;
   an exact Ready retry reused all four. The first long browser request lost its
   response after durable server completion. **[DEPLOYED TO PRODUCTION
   2026-08-17; SIGNED-IN FEATURE SMOKE OPEN]** the tab discovers current/pending
   status and performs bounded
   GET polling without a blind POST retry. Production template v2 fixed
   Recommendation-cell spacing under a new generation identity and produced a
   Ready artifact, but Word Online exposed a width-sensitive
   Recommendation-label alignment defect. **[INFERRED FROM SCREENSHOT + OOXML
   WIDTH]** implicit wrapping was the remaining layout variable. **[DEPLOYED TO
   PRODUCTION 2026-08-17; SIGNED-IN FEATURE SMOKE OPEN]** template v3 uses an
   explicit no-wrap label, and the compact panel exposes Edit, Download, and
   confirmation-guarded Regenerate actions; their signed-in smoke remains open; and
3. continue the approved Workbench lifecycle: map the Site Visit dossier and
   narrow applicant-material upload, then create Final from an exact Pre-Site
   row/version/hash. The full Editor Dashboard remains later reuse.

The owner-authorized 2026-07-27 Request `1002788` smoke closed as a bounded
v2 failure with no partial memo write. On 2026-07-28, governed prompt v3 became
the sole current row and the controlled post-fix smoke persisted valid
synthesis on the first semantic attempt with complete audit evidence; its
synthetic review was then restored exactly.

The 2026-07-26 evidence-first audit found six live Workbench tabs and four placeholders,
retired the contradictory forward roadmap, and separated shipped behavior from proposed
writeup fields/prompts. See `docs/audits/AUDIT_REQUEST_WORKBENCH_TRUTH_2026-07-26.md`
and `docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md`.

Power Automate automation, the general applicant-intake product, automated BILL
onboarding, and broader reviewer cleanup have separate dependency or owner
gates. The planned narrow Site Visit Materials Upload is part of the Workbench
lifecycle contract and does not reopen general intake. None of the other parked
programs are implied next steps.

---

## The Grant Cycle Redesign

The cycle is changing — concepts, phases, evaluation methods are all in flux. That's actually helpful. We're not locked into replicating the old process. We can:

- Build capabilities (proposal picker, AI processing, email integration) that work regardless of the cycle structure
- Try new approaches quickly since everything is modular
- Let what's technically possible inform how the new cycle is designed

---

## Vendor and Licensing Considerations

AkoyaGO's vendor provides a license for Dynamics/Dataverse. While WMKF owns its data and could migrate to another Dynamics instance, the extent of dependency on AkoyaGO-specific workflows and business logic is not fully understood. This will be clarified over time as the contract relationship evolves. In the meantime, the principle is: build things that minimize reliance on AkoyaGO, with the understanding that it might eventually go away.

---

## IT Dependencies

The table below is the **2026-05-08 dependency snapshot**, retained for context rather than current
priority. Re-probe external state before relying on it; current work priority is in
`docs/CURRENT_WORK_QUEUE.md`.

| What | Who | Status |
|------|-----|--------|
| `Sites.Selected` read + write role on akoyaGO site | Azure AD Admin | **Granted** (write 2026-04-15; verified end-to-end 2026-05-01) |
| Email Sender role in Dynamics | Dynamics Admin | Done |
| Conditional access licensing | IT | Done |
| Dynamics write permissions (`prvUpdate` on `akoya_request`, `prvCreate`/`prvUpdate` on `wmkf_ai_run`) | Dynamics Admin | **Granted** 2026-04-14 (no `prvDelete` — append-only by design) |
| Dynamics Delegate role on app user (impersonation) | Dynamics Admin (Connor) | **Granted** 2026-05-06; impersonation re-smoke PASS |
| `prvCreateNote` on `annotation` | Dynamics Admin | **Not granted** — don't design notes-on-records flows without going back to IT |
| Entra External ID tenant for applicant intake | IT | **Provisioned** S129 (tenant `04a1406b...`) |
| No outstanding admin asks as of 2026-05-08 (Mail.Send retired in S142 — system-alert emails now use the Dynamics transport) | | |
