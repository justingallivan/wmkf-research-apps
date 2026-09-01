---
title: "Where We're Headed"
domain: architecture
kind: plan
status: active
summary: "Long-term product direction; current execution priority is owned by CURRENT_WORK_QUEUE.md."
canonical: false
cataloged: 2026-07-02
last_verified: 2026-08-31
owner: product-engineering
related:
  - docs/SYSTEM_MODEL.md
  - docs/CURRENT_WORK_QUEUE.md
  - docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md
  - lib/utils/sharepoint-buckets.js
  - scripts/probe-sharepoint-write.js
---

# Where We're Headed

**Last verified: 2026-08-31.** This document owns long-term direction and principles. The
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

The ordered agenda is maintained in `docs/CURRENT_WORK_QUEUE.md`. As of
2026-08-30, the owner selected Final Writeup infrastructure as the next delivery
priority. The target is an underlying, superuser-testable path by 2026-09-04,
not broad staff rollout: same-item Final lineage, explicit transition
attribution, acknowledgement persistence, and dashboard data. As of 2026-08-31,
the ordinary-staff dashboard/focused-review foundation is Production-deployed
through PR #140 (`ce229778`) with bounded reads and external-Word actions. Its
separate acknowledgement readiness value is exact `on` in Production. The
signed-in dashboard/Final read path and responsible-PD exclusion passed on
Request `1002788`. An eligible colleague's first POST reached Dataverse but
failed on the previously missing acknowledgement Create privilege and persisted
no row. The dedicated `WMKF Final Writeup Reviewer` role is now directly
assigned and its six requested Global privileges are effective for all 11
confirmed audience members. The colleague's post-role retry succeeded, appeared
in review history, and independent Production readback proved exactly one
complete acknowledgement row. Program-audience configuration is now
Production-live; persona-specific work is next.
Every edit/review action opens the canonical SharePoint Word document in its
own browser window/tab (or desktop Word through Microsoft's supported option);
the application will not embed or recreate Word editing.

The global role-eligible audience is all PDs, PCs, the CSO, and the President.
The reviewer set shown for a request is separately configurable by its broad
Grant Program. The full
coordinator matrix is included as neutral tracking: blank does not mean failure,
there is no required count, due date, compliance score, or leadership order,
and later edits produce **Updated since review** without erasing the recorded
acknowledgement. The neutral acknowledgement-role rollout is complete for the
confirmed 11-person audience. **[PRODUCTION-LIVE + SIGNED-IN READ SMOKE PASSED
2026-08-31]** commit `52575761` and Ready deployment
`dpl_Frc6fAonyFFYwiWyFJCzzE3UNune` ship the superuser Final Writeups index with
the complete matrix from that exact role roster. Signed-in Production DOM proof
showed the exact 11-person roster and correct Request `1002788` states/actions
with zero browser-console errors. It provides direct review/Word links and
neutral Responsible PD / Not reviewed / Reviewed / Updated states.
**[PRODUCTION-LIVE + SIGNED-IN READ/WRITE PROVED 2026-08-31]** Commit
`5573bca3` is live in Ready deployment `dpl_5DNuc2BV76RihwuWu8ZFYBgxBXE7`.
The program-audience Admin editor stores stable broad Grant Program GUID →
reviewer GUID configuration. The published Research audience contains nine
current reviewer-role members and excludes owner-confirmed Southern California
staff Anneli Stone and Saskia Pallais. Signed-in Admin publication/readback
survived reload; Request `1002788` rendered under Research with exactly those
nine columns and zero browser-console errors. Southern California remains
explicitly unconfigured pending its complete audience. The reviewed persona
plan extends the same versioned Final Writeup setting and existing Admin editor
with GUID-only, multi-valued PD, PC, Leadership, and explicit no-lens staffing
assignments: Allison Keller is President; Beth Pruitt is CSO and also a
responsible PD on some requests. The source still contains the superseded,
disabled team prototype, but no team exists and no elevated team privilege is
required by the selected path. V2 implementation/migration, representative
PC/leadership Word-access proof, and persona-specific queues remain gated; the
source rollout flag is false. Initial Assessment
restore/Board writes remain separately owner-gated.

**Recently completed:** the Staff Deliberations workspace/history UX, curated
Site Visit materials-recipient menu, and Graph-search/Operational Events error
reliability are Production-live. The recipient directory is capped at 50 active
staff/existing Contact references, never creates or edits Contacts, never
auto-adds anyone to an email draft, and signals when a one-request search has
more than 50 matches. See `SESSION_PROMPT.md` Session 468 and
`DEVELOPMENT_LOG.md` for the release record.

Power Automate automation, the general applicant-intake product, automated BILL
onboarding, the post-cycle reviewer-reminders ledger, invitation-link
strictness, and broader reviewer cleanup retain their dependency, cycle, or
owner gates. None is an implied next step.

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
