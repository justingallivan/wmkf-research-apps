# Meeting Tracker hosted rehearsal — partial, no production sign-off

[VERIFIED via owner authorization, Vercel CLI, fresh Neon bootstrap, Blob hash check and sandbox probes, 2026-10-23 America/Los_Angeles] Source candidate: `f96529e0d` on `codex/session-start-20261023`. No production deployment, configuration, migration or business-data writes. The user separately approved metered rehearsal services and storing required application credentials as encrypted variables in the new Preview project. Automatic credential-transfer rejection was resolved by that explicit approval before transfer.

## Isolated resources and tested results

| Surface | Evidence / result |
|---|---|
| New Preview project | `wmkf-meeting-rehearsal-20261023`, `prj_Or9GhMbRSulLI47ZuAeqxSb2ZRxg` |
| Final deployment | [Preview](https://wmkf-meeting-rehearsal-20261023-omjp2i3y0.vercel.app), `dpl_6FF3LYKUesK1onSpu8RRWgWLK6z2`; Ready, Webpack build passed |
| Packaging | Committed candidate archive; explicit Next.js framework; scheduled jobs removed only in operator package; local env excluded; encrypted Preview env; all new access flags limited to one synthetic request GUID |
| Fresh test database | `meeting_coord_rehearsal_20261023` on existing test endpoint `ep-aged-dew-b7gtigyy-pooler.c-13.us-east-1.aws.neon.tech`; 88 migrations bootstrapped; no writes to the shared `/neondb` or production database |
| Staff test identity | Owner identity verified in sandbox, isolated profile ID 2 (normal map reserves/skips ID 1); short-lived signed test session accepted with HTTP 200; actual Azure sign-in/callback was not exercised |
| Durable worker | Final Preview authenticated `/api/cron/drain-meeting-material-preparations`: HTTP 200, `{"ok":true,"outcome":"idle","worked":0}`; exercises empty database-backed queue, not job execution |
| Worker denial | Same final Preview route without cron secret: HTTP 401 `Unauthorized` |
| Staff denial | Initial Ready Preview dashboard without staff session redirected to sign-in (HTTP 307) |
| Missing binding | Final Preview preparation GET for failed synthetic request: HTTP 503, `meeting_transcription_binding_unavailable`; no fabricated binding accepted |
| Private storage | New private store `store_Q4GFCvXEuzRiQbhY`, `meeting-coord-rehearsal-20261023`; pinned FFmpeg archive copied after SHA-256 verification |
| Video tool | Public provisioning URL returned HTTP 404. Existing immutable private archive read without modification; SHA-256 `14020417ff8ef01470e8cb771355e65c37aff62b80fb0be41eeb7611d1360902`, 151144252 bytes; exact verified bytes copied to isolated store. No different FFmpeg build substituted |

Initial new-project autodetection failed before a successful explicit Next.js Preview build. The first attempt also demonstrated that Preview cannot use `--skip-domain`; final deployments explicitly used the Preview environment. One failed first attempt was classified Production by Vercel's empty-project default, but never built or became ready and used only the new rehearsal project; it is not a deployment to the application’s production project.

## Blocking fixture result

[VERIFIED via sandbox POST and exact-ID GET] Target exclusively `https://orgd9e66399.crm.dynamics.com`. One synthetic request was attempted with marker `wmkf_istestrequest=true`, its own run GUID, and both applicant reminder flags false:

- Request ID: `818ed04d-6ff8-4972-b27a-d422283c0640`.
- Run ID: `ede33492-041f-4ce6-a696-0ab03bd8a242`.
- POST failed HTTP 400, Dataverse error `0x80040265`: “The remote server returned an error: (500) Internal Server Error.”
- Exact-ID readback returned HTTP 404. No request remained and visit creation was never attempted. No blind retry.
- Sandbox Shared Admin Program Coordinator setting was absent. No shared assignment was changed.

[UNKNOWN] The precise failing downstream component was not established. The repository's Factory has a paired sandbox-only GoVerify workflow suspension/restoration procedure, but its existence does not prove the root cause of this particular error. Shared sandbox workflow changes were not made during concurrent agent work. The failure is a fixture-provisioning blocker, not a demonstrated Meeting Tracker application defect.

## Unverified release paths and next action

[PLANNED] Coordinate sandbox fixture provisioning with the other agent, establish a verified isolated synthetic request/visit and an agreed test Coordinator without disturbing shared settings, then finish: transcript review and saved boundary; close/reopen durable preparation; partial failure and selective retry; edited summary preservation; approval through both external readers; old approved materials during corrections; replacement and withdrawal; exact manual audio/video correspondence and retained cuts; cleanup. Genuine Zoom import remains separate from the synthetic-media allowance. No real email delivery is authorized or claimed. No AssemblyAI, summary-provider generation or paid Sandbox execution occurred in this partial run. Empty queue success does not establish those paths or scheduling.

The new Preview project/database/private store are retained for continuation; feature admission is pinned to the nonexistent synthetic request and scheduled jobs are absent. No test jobs or sandbox business fixtures require deletion. The isolated FFmpeg archive occupies storage. Machine-local protected resource journal: `/private/tmp/wmkf-meeting-hosted-resources.json`; credential files remain outside Git. Do not delete resources owned by the other agent or reuse shared test-project configuration.

## Contract and durable-fact reconciliation

Contract-reconcile Mode B: hosted entry → signed staff / cron authentication → isolated Postgres empty lease scan → idle response was exercised. Caller → request/visit binding → preparation → provider/media → retained edition → external reader remains incomplete because fixture creation failed. Claims of hosted end-to-end success are explicitly withheld.

Sweep Mode A scope: change from “hosted rehearsal planned” to “partial hosted evidence with fixture blocker.” Authoritative evidence is the resource journal, CLI deployment/build receipts, API response files and exact sandbox readback. Current release checklist and manual pairing review conclusion updated; historical review-phase claims about no hosted execution remain historical. Session resume pointer updated from parked design to the owner-authorized branch work. This is a bounded rehearsal-status update, not a whole-repository truth audit.

**Verdict: NOT READY FOR PRODUCTION SIGN-OFF.** Local implementation evidence remains valid within its recorded scope. Complete the hosted workflow before recommending promotion. No new product-design decision is identified.
