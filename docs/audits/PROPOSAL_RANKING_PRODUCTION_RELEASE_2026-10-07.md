# Proposal Ranking Production release and activation

Date: 2026-10-07 (America/Los_Angeles). Owner explicitly approved deployment,
activation and starting the walkthrough after the access/privacy setup.

## Release evidence

[VERIFIED via GitHub and Vercel] PR #457 merged at
`10c079c8652b4184404b4cb8ee8479f370a56c79` after all candidate checks passed.
The candidate `a935ccc64` merged five newer main commits through `79fa22bc0`;
conflicts were limited to handoff documentation and generated canonical counts.
The ranking handoff was retained; incoming main handoff is available via Git.
Work stayed in `codex/proposal-ranking`; no other checkout or local main was touched.

| Step | Deployment | Result |
|---|---|---|
| Previous Production | `dpl_8e1mXo8UtEpfcFeLVp22SVKAuK2S` | READY, commit `79fa22bc01f2b37f21431b364708c576c4fe14cc`; signed-in home worked |
| Privacy guards deployed, ranking disabled | `dpl_8CVM7KUdKhPh2bTHDKdaqVcAA14J` | READY, merge commit above, Production aliases assigned; authenticated ranking GET returned 503 with both readiness flags absent |
| Activation rebuild | `dpl_F5ewaS8DRDhABRVyhrG5XHuSRvwf` | READY, same merge commit; Production aliases assigned; Justin's D26 page shows Round not open |

Live entry: https://applications.wmkeck.org/proposal-ranking
Activation artifact: https://wmkfresearchapps-1szfmrb2h-justin-gallivans-projects.vercel.app
The unconditional generic-reader privacy guards are included in the deployed merge;
activation occurred only after that first deployment was READY.

[VERIFIED via individual Vercel variable readback] Production has
`PROPOSAL_RANKING_ENABLED=on` and `PROPOSAL_RANKING_SCHEMA_READY=on`.
Existing `TEST_REQUEST_ISOLATION`, `SYNTHETIC_REVIEWER_ISOLATION`,
`DATAVERSE_TARGET_INTERLOCK` and `DATAVERSE_DAL_ENFORCEMENT` were all verified `on`;
`DYNAMICS_URL=https://wmkf.crm.dynamics.com`, with no sandbox override present.
Only the two ranking flags were added. A full environment download was rejected
by automatic approval review; the successful alternative read only named nonsecret
flags and the target URL through individual-variable endpoints. No secrets were pulled.

## Source readiness and acceptance boundary

[VERIFIED via full read-only D26 preview builder] The real builder returned
`canOpen=true`, 23 proposals (11 SE / 12 MR), four granted participants, USD for all
amounts, zero missing requested amounts and zero unscored proposals. Geography:
9 East / 14 West / zero unknown. The preview reports **51 outstanding reviewer
assignments** and a warning that other statuses in the cycle are excluded.
Opening freezes the scores then available; this is not proof all reviews are final.
The diagnostic process used local-only readiness flags; hosted flags were verified
separately. No source records or ranking business rows were created or changed.

[VERIFIED via real Microsoft sign-in in Chrome] Justin's Production D26 page shows
“Round not open” and says the facilitator has not opened the round. It exposes no
proposal snapshot or private lists to him at this point. This is the expected
participant state, not a completed end-to-end meeting rehearsal. Active-deployment
runtime logs confirm the authenticated GET returned HTTP 200; an anonymous GET
returned HTTP 307 to the sign-in page. The scoped smoke log contains no error-level
entry. This is a brief smoke observation, not sustained monitoring.

Beth's browser session is required to preview/open as the configured facilitator.
The other PD sessions are needed to verify private drafts, submission, independent
SE/MR composite publication, shared reordering and full-requested budget totals.
No session was impersonated in the browser, no votes were submitted for other staff,
and no facilitator change was made to bypass that boundary. Populated indirect
privacy proof remains open until there are authorized ranking rows. Earlier effective
staff 403/search proof remains in the access/privacy receipt.

## Validation and review

Local required gates and their self-tests ran sequentially: API routes, Atlas,
route-lifecycle auth; types passed. Ranking/Explorer regression: 134 tests/13 suites.
Candidate full CI: 21,357 passed / 169 skipped tests, 1,295 passed / 13 skipped suites;
separate PostgreSQL 16 integration: 129 tests/9 suites passed. Build, lint, repository
gates, CodeQL, Semgrep, Gitleaks and Trivy passed. CI run: 37729872569.
Luna reconnoitered; Sol and one bounded subscription-OAuth Opus source review found
no substantive release blocker. The Opus review emphasized direct staff denial does
not replace the unconditional application-identity Explorer protections; these were
verified in source and deployed before activation. No minor-polish review loop.

## Rollback

Preferred operational rollback: set only `PROPOSAL_RANKING_ENABLED=off` and rebuild
this release, keeping generic-reader privacy guards deployed. For immediate rollback,
`vercel rollback dpl_8CVM7KUdKhPh2bTHDKdaqVcAA14J` selects the verified disabled
ranking deployment with guards intact; also set the project flag off so later builds
stay disabled. Owner Justin is the rollback decision maker; no rollback was executed.
Do not roll back to the pre-ranking deployment once private rows exist: it lacks the
new generic-reader protections. Code rollback does not undo rankings or source data.

Local probe/review/runtime logs in `/private/tmp/ranking-*` are nonportable; this
receipt records their material outcomes. Remaining multi-person acceptance is explicit.
