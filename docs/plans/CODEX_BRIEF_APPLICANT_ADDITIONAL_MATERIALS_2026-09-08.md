# Codex planning brief — Applicants submitting additional materials (2026-09-08)

## Where you are

You are in the worktree `/Users/gallivan/Code/WMKF_Apps-codex` on branch
`codex/applicant-additional-materials`, created from `origin/main` at `715601d8`.
Run `/start` first. **Stay on this branch and in this directory.** Claude is working
in the main checkout (`/Users/gallivan/Code/WMKF_Apps`) on the single-page Request
Workbench shell and cycle provenance; do not check out other branches, do not
touch the main checkout, and do not push to `main`.

## Goal

**Planning only. No implementation.** Produce one canonical plan document,
`docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md`, for a feature that lets applicants
submit additional materials after their proposal is in the system (for example,
documents staff request during review). The owner will decide scope from your plan;
build work is a later, separately authorized session.

## Owned surface (the only files you may create or change)

- `docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md` (new; top-level docs frontmatter
  required — copy the shape from `docs/INTAKE_PORTAL_DESIGN.md`: `title`, `domain`,
  `kind: plan`, `status: active`, `summary`, `canonical`, `cataloged`, `owner`,
  `related`).
- `docs/DOCS_CATALOG.md` — regenerated only, via `npm run check:docs-catalog`
  (run `node scripts/generate-docs-catalog.js` if the check tells you to).
- This brief, if you need to append a short "outcome" section at the end.

Nothing else. No code, no tests, no migrations, no env or Vercel changes, no Dataverse
writes, no probes against production Dataverse (read-only probes require the owner
to run them; write the script, hand over the command). Explicitly off limits because
Claude owns them this session: `pages/workbench/**`, `shared/components/workbench/**`,
`lib/services/workbench/**`, `lib/services/final-writeup/**`,
`lib/utils/cycle-code.js`, `pages/workbench/awardees.js`,
`lib/services/grantee-deliverables/**`, `lib/services/cycle-dossier*`.

## Ground truth to establish before writing (label every claim)

Label material state claims `[VERIFIED via <file/doc>]` or `[ASSUMED]`, per
`CLAUDE.md` rule 1. Read `docs/CLAUDE_REMEDIATION_PLAN.md` before any data-layer
planning. Start from:

1. **What applicant-facing intake exists today and its status.**
   `docs/agent-wiki/topics/intake-portal.md` (routing hub), then
   `docs/INTAKE_PORTAL_DESIGN.md` (note: `status: historical` — the June 2026 Phase II
   intake pilot was cancelled and the product build is parked; confirm what parts of
   `pages/api/intake/**`, `lib/services/intake-draft-service.js`, and the private
   intake Blob path are still live and which are dormant), `docs/INTAKE_ATTACH_*.md`
   (the attachment upload chunks, historical), `docs/INTAKE_PORTAL_SCHEMA_CHANGES.md`.
2. **How request documents and SharePoint materials are modeled.**
   `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md`, `docs/atlas/dataverse-wmkf-requestdocument.md`,
   `docs/atlas/dataverse-akoya-request.md`, `docs/REVIEWER_MATERIALS_FOLDER_SPEC.md`
   (which folders reviewers see — additional applicant materials may need to land
   there, or deliberately not).
3. **Existing large-upload and private-storage invariants** (`CLAUDE.md` Universal
   Safety Invariants): private intake Blob uses `INTAKE_BLOB_RW_TOKEN`; grantee-image and
   staff replacement uploads use actor-bound `portal_upload_staging` rows and
   `UPLOADS_BLOB_RW_TOKEN`; mint and finalize routes reauthorize independently; clients
   never choose Blob pathnames. Read `docs/GRANTEE_PORTAL_SPEC.md` for the actor-bound
   upload pattern as the likely template. Virus scanning: see the intake wiki topic.
4. **How applicants are identified and authenticated today.** Applicants are not
   staff; establish whether any applicant identity exists beyond the intake pilot
   (`docs/AUTHENTICATION_SETUP.md`, `docs/agent-wiki/topics/security-auth.md`,
   `docs/API_ROUTE_SECURITY_MATRIX.md` for the token-link pattern used by external
   reviewers in `pages/external/review/[token].js`).
5. **Where staff would ask for and receive the materials.** The per-request Workbench
   page `pages/workbench/[requestId].js` (read-only for you) and its Proposal /
   documents tabs; `docs/REQUEST_WORKBENCH_BUILD_PLAN.md`; the email-template contract
   in memory `project-email-template-token-syntax` and `docs/GRANTEE_PORTAL_SPEC.md`.
6. **J27 workflow context.** `docs/J27_TRANSITION_REGISTER.md` and memory
   `project-j27-doc-capture-evolution` — J27 introduces Initial Assessments before
   advancement; additional materials may be tied to that stage.

## What the plan must contain

- **Problem statement and actors**: who asks (PD, coordinator), who submits
  (applicant PI, institutional contact), who consumes (staff, reviewers, Initial
  Assessment generation).
- **Three candidate approaches, compared**, with a recommendation: for example
  (a) a token-link applicant upload page on the existing external-link pattern,
  (b) reviving the parked intake portal's draft/attach flow for post-submission use,
  (c) staff-mediated upload only (applicant emails, staff uploads via existing
  Workbench replacement upload). State what each reuses and what it must build.
- **Storage and file model**: where bytes land (private Blob staging → SharePoint
  request folder), which `wmkf_requestdocument` shape/kind if any, virus scan, size
  limits, retention, and whether reviewers can see the material (a decision for the
  owner, present both ways).
- **Security contract**: trust boundary for the applicant link, expiry, rate limits,
  reauthorization on finalize, no client-chosen pathnames, no identity from request
  input — mirror the invariants above; list any new API route and its
  `docs/API_ROUTE_SECURITY_MATRIX.md` row shape (do not add the route).
- **Data model**: new tables or Dataverse attributes, if any, as a proposal only
  (no migration). Prefer reuse of `portal_upload_staging` and request documents.
- **Staff workflow**: request → notify applicant → receive → review → attach to the
  proposal record → visible in Workbench; what the email says (voice per memory
  `project-grantee-deliverable-email-voice`).
- **Open owner decisions**, numbered, each with your recommendation.
- **Build slicing**: Tier per `docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md`,
  and a first thin slice that can be smoke-tested on one request.

## Guardrails that have bitten before

- Never fabricate identifiers, field names, GUIDs, table names, or env names. Every
  one you cite must be grepped in source or found in the Atlas; this repo hard-fails
  on fabricated literals (`check:fact-consistency`, `check:doc-symbol-refs`).
- Do not describe plan intent as built state.
- Do not modify shared primitives or any file outside the owned surface.
- Run before finishing: `npm run check:docs-catalog`, `npm run check:doc-symbol-refs`,
  `npm run check:fact-consistency`, `npm run check:build-claim-freshness`,
  `npm run check:agent-invariants`.
- Commit to this branch with a descriptive message and **push the branch**
  (`git push -u origin codex/applicant-additional-materials`). Pushing a feature branch
  is safe and does not deploy. Do not open a PR to `main`; the owner reviews the plan
  first.

## Done looks like

One committed, pushed plan document that passes the four doc gates, with every
state claim labeled, three compared approaches and a recommendation, and a numbered
list of owner decisions. Append a five-line outcome summary to this brief.

## Outcome (2026-09-08)

- Created and owner-reconciled the canonical `docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md` planning artifact.
- Made Site Visit the defining workflow: PC-owned checklist/follow-up, shared applicant contribution, and independent presentation versions.
- Included a first-release read-only briefing room for exact applicant, Pre-Site Writeup, and peer-review versions.
- Chose one canonical SharePoint file plus pinned-version package references, with AkoyaGo folder depth held for immediate signed-in discovery.
- Passed all five named documentation/invariant gates; implementation files and live systems were untouched.
