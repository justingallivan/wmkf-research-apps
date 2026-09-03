# Session 475 Prompt: Submitted Review DOCX Export to SharePoint

## Session 474 Summary

Session 474 (2026-09-02) reconciled the completed Reviewer Follow-up release and
recorded the owner's next priority: export DOCX versions of submitted reviews
to each request's SharePoint document area. This is a handoff task only; the
export capability is **planned, not built**.

### What Was Completed

1. **Reviewer Follow-up release documentation is reconciled**
   - Runtime merge `acf40fb85a36ab2d481869c706a069abea52c087` remains the
     Production release for organization-wide Reviewer Follow-up visibility and
     lead-PD/superuser-only request mutations.
   - The durable release reconciliation is on `main` in commits `05276137` and
     `35d0c54c`; Ready Production deployment
     `dpl_8gdbmegvhoTiXDK1xPyEjFjYUWAX` carried the documentation-only release.
   - No Vercel CLI update was performed. The CLI was used only for read-only
     deployment verification.

2. **The next task is explicitly bounded**
   - [VERIFIED via `lib/services/review-manager/reviewers-service.js`,
     `lib/services/review-answers.js`, and
     `docs/APPLICATION_STATE_ATLAS.md`] A submitted review is authoritative in
     Dataverse: `wmkf_reviewreceivedat` marks receipt and
     `wmkf_appreviewanswer` stores the point-in-time question/answer snapshot.
   - [VERIFIED via `lib/services/graph-service.js` and the Initial Assessment /
     Pre-Site artifact services] The app already knows how to create a nested
     folder beneath the existing request document root and upload a DOCX.
   - [PLANNED] The new action will create staff-readable DOCX derivatives in
     SharePoint. The DOCX files do not become the review system of record.

3. **Priority was reconciled without dropping existing work**
   - `docs/CURRENT_WORK_QUEUE.md` now places the export task at order 2.
   - Final Writeup persona access proof and deliberate rollout moves to order 3
     and remains the immediate following task.

4. **The Vercel Node 22 ESM runtime incident is closed**
   - [PRODUCTION-PROVED] The `sanitize-html` 2.17.7 upgrade initially caused
     `ERR_REQUIRE_ESM` at module load despite green CI and a Ready deployment.
     The release was reverted, then fixed forward by bundling the ESM dependency
     chain through `transpilePackages`.
   - PR #144 merge `39413e3d` is Production-live; the external-review draft
     probe reaches the expected application 401 rather than a module-load 500.
   - The durable runtime constraint is recorded in
     `.claude-memory/project-vercel-node22-no-require-esm.md`.

### Commits

- `0b395495` - Build organization-wide reviewer follow-up visibility
- `c6dc8de4` - Reconcile reviewer follow-up authorization state
- `a4dfe47f` - Address reviewer authorization review findings
- `fda69558` - Record Claude approval and strengthen review tests
- `0962bc99` - Record reviewer follow-up Preview verification
- `9a59297a` - Revert the production-breaking sanitize-html upgrade
- `39413e3d` - Bundle sanitize-html's ESM dependency chain on Vercel
- `acf40fb8` - Merge organization-wide reviewer follow-up visibility
- `8e23aa95` - Record reviewer follow-up Production release
- `05276137` - Reconcile Reviewer Follow-up release docs
- `35d0c54c` - Keep release docs deployment-stable
- `c763072a` - Document Session 474 and create Session 475 prompt

## Next Items

### Verified Open

#### 1. Export Submitted Reviews as DOCX Files to SharePoint

Build the simplest request-level, authenticated export that produces one Word
document per currently submitted review and files it beneath the request's
existing SharePoint document root.

Start with `/contract-reconcile` because this crosses the submitted-review
producer, Dataverse persistence, staff reader, DOCX renderer, API authorization,
and SharePoint writer. Before implementation, write a concise plan that resolves
the following contracts from current source and live metadata rather than
guessing:

1. **Source and content**
   - Include only reviews whose authoritative parent has
     `wmkf_reviewreceivedat`.
   - Render the immutable snapshot question text and answers in stored order,
     plus only the minimum useful request/reviewer/submission metadata.
   - Re-sanitize rich text at the server boundary and render supported
     formatting safely. Do not call an LLM.

2. **Folder and file ownership**
   - Use the request's existing Dynamics-tracked SharePoint folder and a
     server-owned subfolder. The working recommendation is
     `Artifacts/Submitted Reviews`; confirm it does not collide with a live
     convention before locking it.
   - Use server-generated, SharePoint-safe filenames. Do not accept a folder or
     filename from the browser.
   - Persist stable Graph site/drive/item identity and a source fingerprint in
     the smallest suitable durable registry. Probe the existing Dataverse
     model first; do not assume a new table or overload a field without tracing
     its current consumers.

3. **Authorization**
   - The export is a write. Resolve the request and actor server-side and reuse
     the Reviewer Follow-up hard boundary: the request's lead PD or a
     superuser. UI visibility is not authorization.
   - Keep foreign requests read-only for ordinary non-lead users and preserve
     the existing organization-open reviewer read contract.

4. **Retry, concurrency, and partial success**
   - An unchanged rerun must reuse the existing exported item rather than create
     a duplicate. If submitted content has genuinely changed, create a new
     SharePoint version of the same stable item unless the plan finds a stronger
     current contract.
   - Key idempotency to stable review identity plus a deterministic source
     fingerprint, not display names or paths.
   - Return a per-review outcome. One failed upload must not erase successful
     exports or be reported as whole-batch success; retry only missing, failed,
     or changed items.
   - Define the race behavior for two concurrent export requests before wiring
     the UI.

5. **Verification and release**
   - Cover renderer structure and sanitization, filename safety, submitted-only
     selection, lead-PD/superuser authorization, foreign non-lead denial,
     idempotent rerun, changed-content versioning, concurrent calls, Graph
     failure, and mixed batch outcomes.
   - Run the applicable route/security, trust-boundary, documentation/Atlas,
     focused test, and build gates. Any new persistence requires schema-as-code,
     migration/readiness treatment, and Atlas reconciliation.
   - Preview may verify read-only/UI behavior but cannot prove the write against
     its disconnected reviewer sandbox. A controlled Production SharePoint write
     smoke requires a named request and fresh explicit owner authorization; do
     not infer that authorization from this planning handoff.

#### 2. Final Writeup Persona Access Proof and Deliberate Rollout

After the export task, return to `docs/CURRENT_WORK_QUEUE.md` order 3. Prove one
representative Program Coordinator and one representative Leadership user can
open the exact canonical Final Writeup Word item under their normal identities;
then, and only then, deliberately enable and smoke the existing persona lenses.
The production v2 configuration remains exact and the tracked rollout flag
remains false.

### Owner Decision Needed

1. **Controlled Production write target and authorization.**
   Evidence: Preview is read-only and disconnected from the reviewer sandbox.
   After implementation and review are complete, the owner must name the test
   request and explicitly authorize the SharePoint write smoke.

### Verify Before Acting

1. **Durable export identity and folder convention.**
   Evidence currently available: stable Graph identities are the established
   document identity, while `Artifacts/Submitted Reviews` is only the working
   folder recommendation. Trace the current Dataverse fields/consumers and
   probe for folder collisions before adding schema or writing a file.

### Parked

1. Automatic reviewer-reminder scheduling and its campaign-setting prerequisites
   remain held under `docs/REVIEWER_ENGAGEMENT_SPEC.md`.
2. Public/onboarding reviewer-token documentation cleanup remains owner-deferred;
   update source generators before republishing derived artifacts.
3. Mobile-specific Workbench redesign remains lower priority because mobile use
   is expected to be rare; preserve responsive correctness without treating
   mobile polish as current work.
4. Pre-J27 Initial Assessment Production write proof remains owner-deferred.
5. Post-cycle invitation-link strictness and reviewer-cron ledger promotion
   remain parked until the current reviewer cycle ends.

## Key Files Reference

| File | Purpose |
|---|---|
| `docs/CURRENT_WORK_QUEUE.md` | Canonical priority and completion gate |
| `docs/APPLICATION_STATE_ATLAS.md` | Authoritative ownership/read/write map |
| `docs/atlas/dataverse-wmkf-appreviewanswer.md` | Submitted answer-snapshot contract |
| `lib/services/review-manager/reviewers-service.js` | Current submitted-review projection |
| `lib/services/review-answers.js` | Shared answer-snapshot reader |
| `pages/api/review-manager/reviewers.js` | Organization-open read and request-write policy context |
| `lib/services/graph-service.js` | Existing folder creation and SharePoint upload primitives |
| `lib/services/initial-assessment/artifact-service.js` | Existing DOCX render/upload reference |
| `lib/services/pre-site-visit/artifact-service.js` | Existing stable artifact identity and upload reference |
| `shared/config/requestDocument.js` | Existing server-owned artifact folder conventions |
| `docs/FINAL_WRITEUP_PERSONA_CONFIGURATION_PLAN.md` | Following persona-rollout contract |
| `.claude-memory/project-vercel-node22-no-require-esm.md` | Vercel Node 22 ESM loading incident and prevention contract |

## First Action

Run `/contract-reconcile`, trace the current submitted-review and SharePoint
contracts end to end, and produce the concise implementation plan. Do not add a
schema, route, folder, or UI control until the durable identity and partial-batch
contracts have been reviewed.
