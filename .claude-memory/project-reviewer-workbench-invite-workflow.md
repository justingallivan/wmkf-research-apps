---
name: project-reviewer-workbench-invite-workflow
description: Workbench Reviewers tab = 3 sub-tabs Find → Invite Reviewers → Track Reviewers (collapsed S280 from 5: Find/Candidates/Invite/Track/Completed); invitations + attachment-safety + enrichment-disambiguation rules
metadata:
  type: project
  status: active
  scope: reviewer
  last_verified: 2026-06-26 (tab structure re-checked vs ReviewersTab.js:41-43 — 3 sub-tabs; signature claim 2026-06-04 vs pages/workbench/[requestId].js); rest S213 via memory-content
---

## Recall Rule

Read this when: building or debugging the Workbench Reviewers tab sub-tabs, reviewer invitations/materials, or external enrichment disambiguation.

Do:
- Treat the 3 sub-tabs as Find (discover) → **Invite Reviewers** (saved-candidate roster, where you INVITE pre-accept; tab key `candidates`, `ReviewerInvitePanel`) → **Track Reviewers** (post-acceptance management — materials release through completion, `ReviewerManagePanel`; absorbed the old Invite + Completed sub-tabs, S280).
- Keep outward-send safety SERVER-authoritative: gate attachments on recipient `wmkf_accepted`, not caller `templateType`; guard duplicate sends.
- Disambiguate external enrichment by the affiliation already known (institution in query + keep-biased `institutionConflicts`).

Do not:
- Persist search results before "Save" (they're ephemeral browser state) or add a paper-list field to the person record.
- Conflate **Invite Reviewers** (pre-acceptance invitations) with materials release — releasing the proposal to ALREADY-accepted reviewers now lives in **Track Reviewers** (it absorbed the old "Invite"/release + "Completed" sub-tabs, S280).
- Put reviewer email templates in browser-localStorage — they're per-user in Dataverse `wmkf_appuserpreferences`.

Ground truth: `docs/REQUEST_WORKBENCH_BUILD_PLAN.md` §Phase 3, `lib/utils/reviewer-invite.js`, `serp-contact-service.js`, `shared/components/reviewers/email-template-store.js`, [[project-d26-reviewer-inputs-probe]], [[project-excluded-reviewers-often-in-pool]].

The Request Workbench Reviewers tab (tier-3) has **3 sub-tabs** (collapsed S280 from the 5 of S211–212; `ReviewersTab.js:41-43`):
**Find** (discover/enrich via `ReviewerSearchSection` + applicant ingestion) → **Invite Reviewers** (`ReviewerInvitePanel` — the saved-candidate roster from `my-candidates?requestId=`, where you INVITE pre-acceptance; tab key `candidates`) → **Track Reviewers** (`ReviewerManagePanel`, post-acceptance management — materials release through completion, `reviewers.js?proposalId=` which is `wmkf_accepted===true` only; absorbed the old Invite + Completed sub-tabs). Legacy `?sub=invite`/`?sub=completed` deep-links normalize to `track` (`ReviewersTab.js:63`).

- **The old "Invite" tab is gone (S280).** It used to send review *materials* to ALREADY-accepted reviewers (NOT pre-acceptance inviting) — a confusing name. That release action folded into **Track Reviewers**; pre-acceptance inviting is now the clearly-named **Invite Reviewers** tab.
- **Invitations** = `InviteEmailModal` → `render-emails`/`send-emails` `templateType:'invitation'` → real Dynamics email with an accept/decline magic link (`{{externalLink}}`), sets `wmkf_invited`+`emailSentAt`, NO `reviewstatus` bump. Reviewer accepts via `/external/review/[token]` → `wmkf_accepted=true` → flows into the accepted set shown in **Track Reviewers**.
- **Lifecycle of search results: EPHEMERAL until "Save".** analyze→discover→enrich live in browser state only; nothing persists until "Save … as candidates" writes `wmkf_appreviewersuggestion`. This was the "reviewers disappeared" confusion (S211).
- **Papers are intentionally NOT persisted (S212 decision, user-confirmed).** The recent-paper list is a live disambiguation / promote-to-candidate aid only; once saved, the durable record is metrics + a **Google Scholar link** (persisted `wmkf_googlescholarurl`, or a `buildScholarSearchUrl` fallback in `lib/utils/scholar-url.js`) that pulls papers on demand. Do NOT add a paper-list field to the person record (S213: bibliometrics live on `wmkf_potentialreviewers`; the `wmkf_appresearcher` sidecar was dropped).
- **Invite Reviewers tab shows persisted candidate detail (S212).** `ReviewerInvitePanel` (renamed from `CandidatesPanel` S291; tab key `candidates`) renders the saved rationale (`wmkf_matchreason` → "Why:"), h-index/citations, expertise keywords, and Scholar/website/ORCID links — so a PD inviting in rounds can refresh memory without re-searching. `my-candidates` maps these off the person row `wmkf_potentialreviewers` (S213: bibliometrics folded onto the person; the `wmkf_appresearcher` sidecar was dropped).
- **"Applicant-suggested" badge** (green) marks applicant-recommended rows (`wmkf_applicantdisposition===recommended`) on BOTH Find and Invite Reviewers tabs — wording deliberately identical across the two.

- **Per-user email templates + invite timing (S212).** All four reviewer email templates (invitation/materials/followup/thankyou) are per-user in Dataverse `wmkf_appuserpreferences` under key `reviewer_email_templates`, via `shared/components/reviewers/email-template-store.js` (defaults + load/save) — OFF browser-localStorage. Edited from "✎ Email templates" on the Reviewers tab; InviteEmailModal + ReviewerManagePanel both source from the store. Distinct from the legacy single-template `reviewer_finder_email_template` key (standalone Finder). The invitation also has a review TIMELINE (respond-by / proposal-delivery / review-due) entered in the invite modal, sticky per-user under `reviewer_invite_timing`, interpolated CLIENT-SIDE via `{{respondBy}}`/`{{proposalDelivery}}`/`{{reviewDue}}` tokens (render-emails leaves them; blank date drops its line). Two-phase-cycle artifact — retiring after this last cycle.
- **Per-user invite signature IS wired (verified 2026-06-04, S217 follow-on).** `pages/workbench/[requestId].js` (~L88-100) resolves `settings.signature` from the per-user `PREFERENCE_KEYS.SENDER_INFO` preference (`reviewer_finder_sender_info`), parsing `sender.signature || sender.name`, falling back to `session.user.profileName`. The signed-in MS account is always the actual sender; this only fills the `{{signature}}` template placeholder. Consumed by ReviewersTab/ReviewerInvitePanel/InviteEmailModal/ReviewerManagePanel. (Earlier "not yet wired" note was stale.)

**Two durable design principles (learned the hard way, S211–212):**
1. **Outward-send safety must be SERVER-authoritative, not caller-controlled.** `send-emails` gates proposal-material attachments on the recipient's `wmkf_accepted` state (`recipientMayReceiveAttachments`), NOT the caller's `templateType` — so a mislabeled/pre-acceptance send can't leak materials. Apply this shape to any future send/attach path. Also `shouldSkipDuplicateInvitation` prevents re-click double-sends. Helpers in `lib/utils/reviewer-invite.js`.
2. **Name-based external enrichment matches the WRONG same-named person.** Always disambiguate by the affiliation we already have. SerpAPI Scholar lookup pulled a Harvard podiatrist for an OSU physicist (request 1002794). Fix: institution in the query + keep-biased `institutionConflicts` guard (`serp-contact-service.js`); skip persisting a mismatched profile. See [[project-d26-reviewer-inputs-probe]], [[project-excluded-reviewers-often-in-pool]].

Full detail: `docs/REQUEST_WORKBENCH_BUILD_PLAN.md` §Phase 3 + the S211/S212 bullets.
