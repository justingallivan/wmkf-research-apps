---
agent_wiki: topic
status: active
last_verified: 2026-07-26
stale_after_days: 60
owner: reviewer-finder
source_files:
  - pages/external/review/[token].js
  - pages/api/external/review/[token]/context.js
  - pages/api/external/review/[token]/proposal.js
  - pages/api/external/review/[token]/respond.js
  - pages/api/external/review/[token]/upload.js
  - pages/api/external/review/[token]/draft.js
  - pages/api/external/review/[token]/submit.js
  - lib/external/build-review-submission.js
  - lib/external/review-multiselect.js
  - lib/external/review-question-fetcher.js
  - lib/external/review-form-schema.js
  - lib/dataverse/adapters/review-answer.js
  - shared/utils/review-matrix.js
  - pages/api/admin/review-questions.js
  - lib/admin/review-question-save.js
  - shared/components/admin/ReviewQuestionsSection.js
  - shared/components/external/ReviewAuthoringForm.js
  - shared/components/external/RichReviewEditor.js
  - shared/components/external/MaterialsView.js
  - lib/external/sanitize-review-html.js
  - lib/services/review-draft-service.js
  - lib/external/review-engagement-state.js
  - pages/api/review-manager/send-emails.js
  - lib/services/review-manager/send-emails-service.js
  - pages/api/review-manager/regenerate-token.js
  - pages/api/review-manager/revoke-token.js
  - pages/api/review-manager/release-settings.js
  - lib/services/reviewer-release-config.js
  - shared/components/reviewers/ReviewerManagePanel.js
  - lib/utils/reviewer-invite.js
  - lib/utils/sharepoint-buckets.js
  - tests/e2e/reviewer-accept.spec.js
canonical_docs:
  - docs/EXTERNAL_REVIEWER_INTAKE_PLAN.md
  - docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md
  - tests/e2e/README.md
  - docs/APPLICATION_STATE_ATLAS.md
watch_paths:
  - pages/external/review/**
  - pages/api/external/review/**
  - pages/api/review-manager/**
  - shared/components/external/**
  - shared/components/reviewers/**
  - tests/e2e/**
  - playwright.config.js
  - .github/workflows/e2e.yml
update_triggers:
  - external reviewer accept / decline / upload flow changes
  - review token issuance, regeneration, or revocation changes
  - reviewer-accept E2E harness or its mocks change
  - SharePoint file-bucket routing for review materials changes
---

# External Reviewer Portal

Use this page before work on the token-authed external reviewer surface: the
accept/decline flow, the materials/upload views, review-token lifecycle, the
Playwright E2E harness, and the live prod automation that an accept triggers.

## Ground Rules

- The external surface is **token-authed**, not user-authed: `pages/external/review/[token].js`
  + `pages/api/external/review/[token]/*` resolve a reviewer from an opaque token,
  not from a session identity. Preserve fail-closed token validation; never accept
  a reviewer/contact identity from request input.
- Token issuance/rotation lives in `pages/api/review-manager/` (`send-emails`,
  `regenerate-token`, `revoke-token`). A revoked/regenerated token must invalidate
  the old link.
- Review materials and uploaded files route through SharePoint buckets
  (`lib/utils/sharepoint-buckets.js`); confirm the bucket model in
  `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md` before changing file paths.
- Invitation address gating is enforced in `send-emails.js` via
  `lib/utils/reviewer-invite.js`: quick-check recipients require per-recipient
  acknowledgement, while research-only addresses are never invitation-sendable —
  see the [Reviewer Identity](reviewer-identity.md) page for the full gate semantics.

## Operating Notes

- **Invitation email actions are view hints, never GET mutations (2026-07-24).**
  The paired invitation buttons use the same signed portal token with
  `?action=accept` or `?action=decline`. On a fresh `stage2a` engagement, accept
  opens the existing Stage 2a form and decline opens the existing decline form,
  including its optional referral field. For `accepted-pre-materials`, only the
  decline hint is honored: it opens that same form for self-service withdrawal.
  Accepted→declined remains a POST mutation and is server-locked after materials
  release or review receipt. Other non-`stage2a` views ignore action hints.
  The query string itself performs no write; the existing response POST remains
  the only mutation boundary, which protects against email-link scanner fetches.
- **Accepted reviewer self-withdrawal (2026-07-24).** Before materials release,
  the accepted confirmation view and acceptance email link to the existing
  decline reason/referral form. The response service atomically flips the
  suggestion to declined and deletes its exact `_wmkf_honorariumrequest_value`
  `akoya_request`; it then cancels non-running acceptance jobs and notifies the
  assigned PD with reason/referrals. A leased acceptance worker re-checks after
  honorarium creation and compensates by deleting any late-created linked
  honorarium before it can send confirmation/quota side effects.
- **The stage2b "submit your review" surface is now in-browser authoring, not file upload (S301, Phase 2).**
  `MaterialsView` renders `ReviewAuthoringForm` (controlled) with the staff-editable
  Dataverse question set across `string`, single-choice `picklist`, fixed-option
  `multiselect`, and `richtext` fields. The active target seed has 11 numbered
  questions — 2 rating radios, 1 checkbox multiselect, and 8 `RichReviewEditor`
  (tiptap) narrative answers — plus the affiliation field; the exact target set
  was published to production on 2026-07-26. The form autosaves to
  Postgres `review_drafts` via the `GET/PUT /api/external/review/[token]/draft` route
  (`ReviewDraftService`). Reviewer HTML is UNTRUSTED: the draft PUT server-sanitizes
  every rich-text answer with `lib/external/sanitize-review-html.js` (DOM-free
  `sanitize-html`, never DOMPurify+jsdom) before persisting, and the staff render must
  re-sanitize. The file-upload route/infra (`upload.js`, `review-upload.js`) is RETAINED
  server-side but no longer surfaced in the UI (plan §7). **Final submit is LIVE (S302,
  Phase 3):** the wired Submit button POSTs to `pages/api/external/review/[token]/submit.js`,
  which finality-prechecks (409 if `wmkf_reviewreceivedat` set), server-sanitizes + validates
  (`lib/external/build-review-submission.js`: `validateReviewSubmission` + the single producer
  `buildReviewSubmission`), then writes ONE atomic `DynamicsService.executeChangeset`: the
  `wmkf_appreviewanswer` snapshot rows upserted by the **`_wmkf_appreviewersuggestion_value=<guid>`**
  alternate-key form (NOT the bare logical name — memory `reference-dataverse-altkey-lookup-upsert-url`)
  + the parent affiliation/receivedat PATCH guarded fail-closed by `If-Match`. The
  snapshots are the sole structured home for the two ratings, categorical
  selections, and narratives. Submit is
  FINAL — the form locks read-only, and both `/draft` PUT and the reviewer-token `upload.js` 409
  post-submit (P0-1). The engagement gate is the shared pure helper
  `lib/external/review-engagement-state.js::computeEngagementState`.
  **Phase 4 (read-back):** `/api/review-manager/reviewers` attaches the re-sanitized `answers[]`
  snapshot per submitted reviewer (keyed child read on `wmkf_appreviewanswers`), rendered by
  `ReviewsTab`. **Phase 5 (draft lifecycle):** the `review_drafts` scratchpad is deleted on submit,
  on token **revoke/regenerate** (`revoke-token.js`/`regenerate-token.js` — NOT `mintAndStore`,
  which runs on benign resends), and GC'd at 90d by the maintenance cron. The hidden-not-deleted
  file-upload path: memory `project-reviewer-upload-dormant-not-deleted`.
  **The whole epic (Phases 0–5) is COMPLETE (S302).**
  Full plan: `docs/REVIEWER_REVIEW_FORM_AUTHORING_BUILD_PLAN.md`.
- **Staff-side upload + "mark received" surfaces removed from the Track Reviewers panel (S347).**
  `ReviewerManagePanel`'s ⋮ menu no longer offers **"Staff upload (override)"** (file upload →
  `/api/review-manager/upload-review`, was `UploadReviewModal` + `ReviewFormFields`) or **"Mark
  received (no file)"** (`/api/review-manager/mark-received-no-file`). These were PDF-email-era
  holdovers — a modern review is structured `wmkf_appreviewanswer` data via `/submit`, not a file,
  and `ReviewFormFields` only renders picklist/string (no rich-text). **Routes + services are
  RETAINED unchanged** for a planned dedicated staff "manual review rescue" tool that must mirror
  the full `ReviewAuthoringForm` (incl. rich-text). The legacy `ReviewFormFields.js` renderer
  (string+picklist only, no rich-text) was orphaned by this removal and **deleted (S347)**.
  Memory `project-reviewer-upload-dormant-not-deleted`.
- **The review question SET is staff-editable (Dataverse `wmkf_reviewquestion`), not hardcoded — Phases A+B+C LIVE (S303–S304).**
  `lib/external/review-question-fetcher.js::getActiveQuestionSet()` (cached, single-flight,
  **fail-closed** — context/draft/submit 500 if the set can't load) is the runtime source. The
  reviewer routes read it: `context.js` attaches `questions` + `questionSetVersion` (stage2b only);
  `ReviewAuthoringForm` renders from `data.questions` as a prop (no static import); `submit.js`
  echoes `setVersion` back and 409s `set_changed` if the staff set changed mid-edit (client shows a
  distinct reload prompt **and flushes the latest draft first** so in-debounce edits survive the reload —
  Codex Phase B P1-B). The version hash (`questionSetVersion`) covers `label`/`hint` too, not just
  structure: the submit snapshot persists `questionText = field.label`, so a wording edit MUST invalidate
  an in-flight session or the answer is recorded against text the reviewer never saw (Codex Phase B P1-A).
  Draft load reconciles type-aware — a draft value whose shape ≠ the current field type is discarded. `lib/external/review-form-schema.js` is RETAINED as the field-shape +
  seed + helper source (`reviewParentColumnByKey` affiliation binding, rating label
  decoders, and active target set). All four write boundaries — portal submit,
  staff manual entry, legacy upload, and mark-received-no-file — resolve the
  authoritative live question set before validation. (The staff
  `ReviewFormFields` upload surface that also used the static default was **removed from
  `ReviewerManagePanel` in S347** — see the staff-side removal note below; `ReviewFormFields.js`
  was then deleted (S347) as orphaned.) **Phase C (S304): superuser editor** at `/admin` →
  `ReviewQuestionsSection` → `pages/api/admin/review-questions.js`: add/edit/drag-reorder/remove the set;
  the route diffs by row id (`lib/admin/review-question-save.js`) and applies ONE atomic
  `executeChangeset` (create/update/soft-delete), enforces key-immutability + `questionSetVersion`
  optimistic-lock (409 `set_changed`), audits to Postgres `review_question_audit` (pending→final,
  hard-abort if audit down), and calls `invalidate()`. Concurrency-hardened (Codex Phase C P1s):
  `baseVersion` is required + each update/delete carries the row's `_etag` as `If-Match` (412 → 409
  reload); set capped at 100; the three protected core rows
  (`affiliation`/`riskLevel`/`overallAssessment`) cannot be removed (server 400).
  Plan: `docs/STAFF_EDITABLE_REVIEW_QUESTIONS_BUILD_PLAN.md`.
- **Fixed-option multiselect is implemented and its exact target configuration is active in production (S376, 2026-07-26).**
  The review-question path supports exactly `picklist` (single-choice radios),
  `multiselect` (native checkbox fieldset), `richtext`, and `string`. The browser
  sends numeric arrays only; `lib/external/review-multiselect.js` validates against
  live options, deduplicates, orders by live option order, and constructs the sole
  stored `{value,label}` snapshot plus joined text. Every writer uses that
  canonicalizer. Readers parse `wmkf_answervalues` defensively only for multiselect
  rows; corrupt categorical storage marks that row unreadable without suppressing
  another rating or narrative. Matrix/report outputs keep categorical tallies
  separate from numeric averages and sort tally identities deterministically by
  stored value then label.
  **PRE-DEPLOYMENT GATE CLEARED 2026-07-26:** wave 15 is applied to production;
  exact metadata and entity-set select readback passed via
  `scripts/probe-review-answer-multiselect-field.mjs`. Compatible code was then
  promoted at `5282cee8` and is live in production deployment
  `dpl_7sfTLrMafYPKp7mnYdrEVjs9HmW5`. The prior set remained active through the
  backward-compatible `review-synthesis.generate` v2 publication, which completed
  through the audited admin route on 2026-07-26 without changing that legacy
  set. The audited full-set publication then activated the exact target at
  version `347a37e820f73890`, retained `affiliation`, and retired the eleven
  prior-only rows under request `3d0c7160-3a09-4d96-ab9f-36ebe63e0e7a`.
  The first controlled Request #1002788 portal smoke passed context, sanitized
  draft reload, submit/readback, categorical consumers, finality, and cleanup
  without sending email. The overall release gate remains red because two
  current-v2 synthesis executions returned incomplete JSON. Synthesis
  resolution, staff-writer success coverage, rollback/republish, final smoke,
  and reviewer exposure remain separate release gates. Known-fixture disposition cleared
  2026-07-26 via audited alerts `361`/`362`, with both CRM contacts and an
  initially unclassified Tim Newhouse/St. Jude PDF preserved. The owner later
  identified that PDF as another test artifact from the retired reviewer-PDF
  experiment, not a genuine review. It remains preserved; test classification is
  not deletion authority.
  Hand-writing a `checkbox` type remains invalid; the supported name is exactly
  `multiselect`. Canonical contract:
  `docs/REVIEW_FORM_MULTISELECT_BUILD_PLAN.md`; active memory:
  `project-review-form-checkbox-questions`.
- **Write paths resolve the question set uncached (S375).** `getAuthoritativeQuestionSet()`
  is used by portal submit, staff manual entry, legacy upload, and mark-received-no-file,
  because the module-local cache (5-min TTL, process-local `invalidate()`) let a stale
  instance agree with a stale client `setVersion` and commit rows against a retired
  question set. Reads stay cached deliberately — a stale render self-corrects when the
  write boundary returns `set_changed`.
- **Prod accept triggers a live automation chain — keep automated tests mocked/fenced.**
  A reviewer accept CREATEs a honorarium `akoya_request`, which fires AkoyaGo plugins
  + classic workflows + a live Bill.com payment flow + a contact→Business-Central sync.
  **MOCK the data layer** for automated tests; a real-prod accept is a human-supervised
  one-off gated on the Power-Automate owner (Connor) confirming the honorarium/payment
  flows won't act. Read-only probe: `scripts/probe-dataverse-automation.js`. Full
  detail: memory `project-reviewer-accept-prod-automation`.
- **Accept now writes reviewer self-reported identity onto the linked CRM contact (2026-06-27).**
  On accept, `respond.js` syncs corrected first/last/title/nickname → `contacts.firstname/lastname/
  jobtitle/nickname` (OVERWRITE, reviewer-self-report-wins, silent; `lib/services/sync-reviewer-name-title-to-contact.js`,
  fail-closed `trusted:true`), and raises staff alerts (NO write) when the accept email differs from
  `contacts.emailaddress1` (`reviewer_contact_email_mismatch`; `lib/services/alert-reviewer-email-mismatch.js`)
  or the reported affiliation differs from the contact's institution (`reviewer_contact_affiliation_mismatch`;
  `lib/services/alert-reviewer-affiliation-mismatch.js`).
  These contact writes feed the same Business-Central sync as above — mock the data layer in tests.
- **Board-writeup identity is REQUIRED at accept (S308).** The Stage 2a accept form collects three
  required fields — academic rank, primary department, main institution (`BoardIdentityCard` in
  `Stage2aView`) — sent as a dedicated `boardIdentity` payload object (NOT `contactEdits`, which is
  engagement-scoped + allowlisted). `respond.js` re-validates them on the fresh-accept (`!isAcceptRepeat`)
  path: trimmed-non-empty, else 400 `board_identity_required` + `fields`. On success they're captured to
  the PERSON record (`wmkf_academicrank`/`wmkf_primarydepartment`/`wmkf_maininstitution`) via
  `lib/services/capture-self-reported-reviewer-identity.js` — non-fatal post-commit (ORCID-twin pattern)
  BUT with no suggestion-row fallback, so a failure fires a `board_identity_capture_failed` admin alert,
  and the workbench edit (`CandidateEditModal`) ships alongside so staff can repair. Prefill seeds
  department/institution from the person's enrichment fields (`wmkf_department`/`wmkf_primaryaffiliation`);
  rank starts blank. Person-level, one canonical current value — board write-ups freeze it (no per-request
  snapshot). Repeat/legacy accepts skip the gate (back-compat). Full trace: `docs/REVIEWER_STAGE2A_IDENTITY_CAPTURE_BUILD_PLAN.md`.
- **Accept form simplified to remove duplicate fields (2026-06-30, S309).** The contact card no
  longer shows **Display preference** (nickname), **Title**, or **Affiliation** as inputs — they
  duplicated the board-identity card (Title≈Academic rank, Affiliation≈Main institution) and confused
  reviewers. The contact card now shows only first/last/email/ORCID. On submit, `Stage2aView`
  (`buildSubmitContactEdits`) DERIVES the `contactEdits` `title` ← **academic rank** and
  `affiliation` ← **main institution**, so the existing server paths are unchanged: `wmkf_reviewertitle`
  (→ CRM `jobtitle` via the sync above) gets the rank, and `wmkf_revieweraffiliation` (→ the
  `reviewer_contact_affiliation_mismatch` COI alert) gets the institution. Nickname is no longer
  collected here (the CRM `nickname` field is untouched, not blanked). Net: Academic rank now feeds
  the CRM job title; Main institution now feeds the COI mismatch check.
  Full decision record: `docs/REVIEWER_CONTACT_BOUNDARY_GAP_FINDINGS.md` §"Increment 2a".
- **Host hazard (S326): staff sign-in does not exist on the external hosts.**
  `reviews.wmkeck.org` / `grantees.` / `submissions.` are token-access external
  hosts — not Azure sign-in redirect URIs; their `/auth/signin` page is a dead
  end by design (owner-stated S326). Any staff-UI browser drive/E2E/manual check
  (workbench, admin) must use `https://applications.wmkeck.org`. Four S326
  browser-drive attempts were lost misreading this as a session problem. Detail:
  `.claude-memory/project-branded-domains.md`. Also S326: zero reviews have ever
  been submitted through the portal (built ahead of the D26 cycle), so populated
  review-consumption UI needs a staged submission — the S308 token procedure
  below is the recipe.
- **Smoke-testing the prod accept form (S308 procedure).** To get a working
  magic link for a test reviewer WITHOUT sending an email: hit `POST /api/review-manager/
  regenerate-token { suggestionId }` from an authenticated STAFF session — it mints the
  token *in prod* (where the real `EXTERNAL_LINK_SECRET` lives) and returns `{ url }`, the
  `reviews.wmkeck.org/external/review/<jwt>` link. `REVIEWER_EMAIL_DELIVERY_MODE=capture`
  is hard-blocked in Vercel production (`send-emails.js:778`), so this prod-mint route is
  for accept/decline-link smoke only, not for rehearsing a send. Loading the
  link is read-only (stamps first-access); a real ACCEPT fires the honorarium automation
  (creates an `akoya_request`), so for UI checks opt out of the honorarium and stop before
  accept. Revoke when done via `POST /api/review-manager/revoke-token { suggestionId }`
  (or the Invite-tab "X", which soft-deletes + revokes).
  **Local capture-mode invite testing is now unblocked (S346).** The earlier claim that
  local minting always fails was about a FRESH clone with no local secret at all —
  `EXTERNAL_LINK_SECRET` is a purely internal HMAC key (sign+verify both happen in the
  same process, per `lib/services/external-token.js` header; never shared with an
  external party), so any 32+ char throwaway string works for local-only testing. Set one
  in `.env.local` (`openssl rand -hex 32` or similar) and restart `next dev`; combined with
  `REVIEWER_EMAIL_DELIVERY_MODE=capture` (not prod-blocked locally), the full
  preview→render→mint→capture-send→portal-view pipeline now runs end-to-end on
  `localhost:3000`. See memory `project-local-dev-auth-setup` for the full local-auth
  checklist this session had to rediscover.
- **E2E harness runs against a real build, not `next dev`.** The Playwright
  reviewer-portal harness (`tests/e2e/`, `npm run test:e2e`) mocks the data layer and
  runs against `next build --webpack && next start` — NOT `next dev`. It is CI-gated
  by `.github/workflows/e2e.yml`. Setup + mock conventions: `tests/e2e/README.md` and
  memory `project-e2e-playwright-harness`.
- **External reviewers get scoped file access.** Confirm the access path and
  expiry model before widening what an external token can read; see memory
  `project-external-reviewer-file-access` and `project-sharepoint-integration`.
- **Accept/decline links are durable, signed surfaces.** Changes to link
  generation or response handling need an in-flight invitation compatibility check;
  see memory `project-reviewer-accept-decline-links`.
- **Design direction — reviewer-materials selection: exact folder/file contract today, move to explicit attach-and-verify (decided S312, NOT yet built).**
  The one file a reviewer receives is
  `Reviewer Materials/Proposal_{Request#}.pdf`, built by Connor's PowerAutomate
  flow. Both folder and request-bound filename are enforced (see
  `listReviewerMaterials` in `lib/external/reviewer-materials.js` → `getRequestSharePointBuckets` +
  `isReviewerProposalFile`; the staff-side
  `/api/review-manager/materials-preflight` missing-proposal warning reuses the same
  function/filter so the two surfaces cannot disagree). Other files in that
  folder are internal and remain invisible; specifically,
  `Research Phase I Application_<timestamp>.pdf` contains more information than
  WMKF sends reviewers and must never be exposed. No Dataverse link entity or outbound-file pointer field
  exists — the suggestion's `wmkf_reviewfilename` is the *inbound* review upload,
  `wmkf_materialssentat` is a timestamp, not a file ref. Gap: the folder-drop is
  invisible to staff (no in-app confirmation the file was staged), request-wide (no
  per-reviewer scoping). Near-term direction (option 2): a staff "attach reviewer
  materials" action in the workbench backed by a Dataverse link entity
  (request/suggestion → SharePoint file reference), surfacing a queryable
  "materials attached ✓" state; keep the live folder-walk as a transition fallback —
  it re-resolves files on each load, so it tolerates re-uploads, whereas a stored
  driveItemId can go stale. Future: once the intake/submission portal (see
  `topics/intake-portal.md`) owns the submitted file, the link entry points directly
  at the WMKF-owned file, retiring the folder + PA-flow dependency entirely. Do not
  cite a link table/field as built until this ships.

- **Materials/release email is portal-link-only by default (S327).** The materials
  template's `{{externalLink}}` placeholder (seeded body,
  `lib/seed/email-defaults/reviewer-templates.js`) is rendered server-side by
  `pages/api/review-manager/render-emails.js` into the reviewer's tokenized
  portal link for every send, regardless of the setting below — so a reviewer
  can always reach the proposal via their secure link even with no attachment.
  A single admin-configurable boolean, `reviewer.release.attach_proposal_email`
  (`wmkf_appsystemsettings`, default `false`, read/write via
  `pages/api/review-manager/release-settings.js` and
  `lib/services/reviewer-release-config.js`), controls whether
  `ReviewerManagePanel`'s EmailModal *additionally* offers the SharePoint
  proposal auto-attach (Blob upload from `pages/api/reviewer-finder/load-proposal.js`)
  and the manual attachment file picker, and whether `attachmentUrls` are sent
  to `send-emails.js` at all. The panel GETs the setting fresh every time the
  modal opens (no build-time constant); the admin panel's "Reviewer Release
  Attachments" section (superuser-gated) is the only write path.

## Durable Memory

- File access and SharePoint: `project-external-reviewer-file-access`, `project-sharepoint-integration`.
- Accept/decline links and prod automation: `project-reviewer-accept-decline-links`, `project-reviewer-accept-prod-automation`.
- E2E harness: `project-e2e-playwright-harness`.

## Standard Probe

```bash
rg -n "regenerateToken|revokeToken|reviewToken|emailConfidence|akoya_request|honorarium" lib pages tests docs
```

Then read the relevant `pages/api/external/review/[token]/*` route and its
review-manager counterpart in full before changing token or file behavior.
