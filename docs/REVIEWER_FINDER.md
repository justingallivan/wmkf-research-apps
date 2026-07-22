---
title: Reviewer Finder Documentation
domain: reviewer-identity
kind: source-of-truth
status: canonical
summary: Current reviewer discovery, identity/contact enrichment, persistence, and Workbench invitation workflow.
canonical: true
cataloged: 2026-07-22
owner: product-engineering
related:
  - docs/REVIEWER_FINDER_D26_PIPELINE_FLOWCHART.md
  - docs/REVIEWER_FINDER_SERPAPI_MIGRATION_PLAN.md
  - docs/REVIEWER_DATA_MODEL.md
  - shared/components/reviewers/ReviewerInvitePanel.js
  - shared/components/reviewers/InviteEmailModal.js
---

# Reviewer Finder

The Reviewer Finder is the discovery and evidence pipeline behind the Request Workbench reviewer
workflow. It proposes candidates, grounds their identity and expertise, resolves contact evidence,
and saves the selected people and per-request engagements to Dataverse. Staff invite saved candidates
from the Workbench; the current UI does not ask staff to download or forward `.eml` files.

## Current flow

1. **Analyze proposal** — extract proposal metadata and produce a set of named reviewer suggestions.
2. **Verify identity and expertise** — ground suggested names with OpenAlex, ORCID, PubMed, and
   related publication evidence. The former Track-B literature lane that originated additional
   people is archived off (`DiscoveryService.TRACK_B_ENABLED=false`).
3. **Resolve contact evidence** — run the tiered resolver, including identity-anchored PubMed and
   Europe PMC evidence, first-party institution-page parsing, and bounded paid web search. Email
   readiness is evidence-based and fails closed when identity or ownership is ambiguous.
4. **Save to Dataverse** — upsert the global person in `wmkf_potentialreviewer` and the per-request
   engagement in `wmkf_appreviewersuggestion`. Bibliometrics live on the person; there is no
   `wmkf_appresearcher` sidecar.
5. **Invite in the Workbench** — `ReviewerInvitePanel` opens `InviteEmailModal`. The modal calls
   `/api/review-manager/render-emails` to mint secure links and render editable drafts, then calls
   `/api/review-manager/send-emails` to send through Dynamics/Microsoft 365 and advance lifecycle
   state. Candidates without a sendable email remain blocked.
6. **Track response and review** — accepted reviewers move through the external portal, materials,
   review intake, and Workbench closeout lifecycle.

## Candidate evidence shown to staff

- Identity and affiliation confidence, including ambiguity/research-only explanations.
- Expertise/relevance evidence and bibliometrics from grounded sources.
- Email source, confidence/readiness, and first-party ownership evidence where available.
- Faculty/official page, ORCID, Scholar search, and recent-publication links when present.
- Applicant-recommended and staff-manual provenance, kept separate from machine-discovered origin.

The candidate card is an explanation surface, not the final authorization boundary. Server routes
recompute invitation readiness from persisted evidence before rendering or sending.

## Data ownership

| Concern | Current owner |
|---|---|
| Person identity, email, affiliation, bibliometrics | `wmkf_potentialreviewer` |
| Per-request selection, invite/response/review lifecycle | `wmkf_appreviewersuggestion` |
| Canonical CRM contact after promotion | `contact` |
| Search-session roster and history | Postgres `reviewer_find_roster` |
| Invitation templates and campaign configuration | Dataverse settings/cycle records consumed by `render-emails` and `send-emails` |

See `docs/REVIEWER_DATA_MODEL.md` and the entity Atlas pages for field-level ownership.

## Invitation templates and timing

The Workbench invitation modal loads the current invitation template, lets staff edit each rendered
draft, substitutes campaign timing fields, and previews the secure reviewer link before sending.
The server injects the honorarium amount and other authoritative values and rejects unresolved
placeholders or a missing secure-link contract. Invitation state is stamped only by the send path.

Default template management lives in the Workbench email-template surface. Per-send dates can be
adjusted in `InviteEmailModal`; server-side campaign and signature resolution remain authoritative.

## Legacy email-generation route

`POST /api/reviewer-finder/generate-emails` and its service remain in the repository for compatibility
and have auth/isolation coverage. They are **retained legacy code, not the primary UI workflow**.
Do not describe `.eml` download/forward behavior as the current reviewer-invitation process, and do
not remove the route without first verifying external callers and migration obligations.

## Key implementation surfaces

- `shared/components/reviewers/ReviewersTab.js` — Workbench reviewer surface.
- `shared/components/reviewers/ReviewerInvitePanel.js` — saved-candidate invitation list and gates.
- `shared/components/reviewers/InviteEmailModal.js` — preview/edit/send orchestration.
- `pages/api/review-manager/render-emails.js` and
  `lib/services/review-manager/render-emails-service.js` — authoritative draft rendering and token
  minting.
- `pages/api/review-manager/send-emails.js` and
  `lib/services/review-manager/send-emails-service.js` — Dynamics/M365 delivery and lifecycle writes.
- `lib/services/contact-enrichment-service.js` — tier orchestration for contact resolution.
- `lib/utils/reviewer-invite.js` — invitation-readiness trust policy.

## Current limitations and deliberate boundaries

- Google Scholar links are searches unless an exact profile is independently known; OpenAlex owns
  bibliometrics.
- Ambiguous identities and ungrounded/search-only email leads are not automatically sendable.
- Search history can be retained, labeled, or removed independently of selected Dataverse rows.
- Reviewer Pool remains a planned request-agnostic surface; current staff work is request-scoped in
  the Workbench.
