# Bounded Executive Summary Sandbox live trial — November 16, 2026

[VERIFIED via hosted HTTP, isolated PostgreSQL and Sandbox Dataverse readbacks]
Owner authorized configuration and one bounded live test, retaining the feature
branch and excluding Production deployment. **Passed**, with original blank Summary
restored and same-key replay proved unable to refill it.

## Exact scope and result

- Branch: `codex/executive-summary-generation-2026-11-16`; build `ac7cac093`,
  real-PDF correction `6d6a7c724`. No main merge/push or Production deployment.
- Ready Preview: `dpl_2ZAUCQ6eD7GhHptTZxjsa7cgddgk`,
  `https://wmkfresearchapps-ad6zvrmhv-justin-gallivans-projects.vercel.app`.
  CLI clean-source export, deployment-only overrides, no aliases. Initial Preview
  `dpl_Gw3NoyqAA5q3pEGKiDU69tfYpMoL` was superseded before any job admission.
- Sandbox: `https://orgd9e66399.crm.dynamics.com`; marked TEST Request **1000389**,
  `a92c0f69-90ec-4c24-bc19-f26a0bfc18b6`. Original Summary null; original Short Title
  preserved. No production Request was read or written by the test.
- Job `ccd99f2b-8d9f-4203-b296-f18ad90d6950`, task
  `9a11433d-646d-4dc3-96e5-e1027aa96ef7`, idempotency key
  `6b154270-c56d-4475-b062-4f257ba68e5e`.
- Admission 18:31:59 UTC; sequential stages `snapshot_saved`, `target_captured`,
  `validated`, `audit_delivered`, `published`; final status **succeeded**, version
  16 at 18:52:59 UTC. The verification read attempted during final publication
  correctly refused incomplete side-effect counts; post-completion verification passed.
- Exactly one attempt `05d56197-8db4-4b5e-af12-786f5d83f587`, model
  `claude-sonnet-4-6`, complete usage 1,380 input / 272 output tokens, zero cache
  tokens. One delivered audit `11a769ed-f844-43a3-b465-c49aee311c59`, independently
  read back with completed status `682090000`; one applied publication.
- Dataverse Summary exactly matched the hash-verified retained result: 192 words.
  Synthetic-content inspection covered hypothesis, innovation, experimental approach,
  outcomes, risks and conditional impact; no real-applicant quality approval implied.
- Same-key replay returned 200 / same job / version 16 before and after restoration.
  Conditional restoration used the current concrete ETag and exact generated-value
  comparison. Final readback confirmed null Summary, unchanged Short Title and the
  two prior Short Title job receipts unchanged. Attempt/publication counts stayed one.
- Missing/invalid tokens returned 401; authenticated absent-job lookup 404;
  unenrolled Request submission 403. Responses were `private, no-store`, with no
  model/source content in status. Protected Preview access used short-lived Vercel
  OIDC, without disabling protection or creating a new share link.

## Configuration and retained fixtures

Summary pilot `ff774f17-bbe0-4bc7-ab7b-9989dd85fc17`, event
`ec8cf7c8-32b4-42d9-af4d-c903f15f098c`, expires **2026-11-18 19:30 UTC**.
The existing Sandbox Entra app/role was reused; no new credential was issued.
Other trial policies were empty/off in this new deployment. Existing deployments,
aliases and project environment settings were not changed.

Summary prompt v1 `ed745833-e8e1-f111-84ea-70a8a59af221` and profile
`proposal-staff-trial` revision 1 were published in Sandbox using the existing
November 11 candidate wording. Prompt hash
`c43abb92f1a12d2b0002997d513e6b272a0754071e7c0d0b54d0902f599014f9`;
profile hash `355da5efaa225e162d870bb946b54bcd1a5269320566dbfaa3350b9b66afaf6c`.
Temperature zero; output token budget 1536. No Methodology task published or run.

The existing isolated `pa-prompt-sandbox` Neon database was reused. Its identity
hash was `b318c52894cf1405fd4af799541a7505c54e2e103f162768f3c2fce626dbad48`;
68 constraints matched the retained schema proof. This inherited schema-only
branch has no migration 097 tracking row: actual schema parity and live service
behavior were verified, not a nonexistent migration receipt. No migration ran.
The two prior jobs/attempts/publications were retained unchanged.

Created and retained synthetic PI Contact `a341c0b2-205d-4dd7-9c6b-b01ea91ebc36`
(named Summary Trial Synthetic Investigator, no email), linked through
`wmkf_ProjectLeader`. Original PI was null; this fixture link remains deliberately.
Uploaded a fabricated one-page 2,319-byte optical-imaging narrative to the existing
shared SharePoint site `appriver3651007194.sharepoint.com/sites/akoyaGO`, under only
`1000389_A92C0F6990EC4C24BC19F26A0BFC18B6/Submission-Documents/Project-Narrative_1000389.pdf`.
The SharePoint site itself is shared, not a separate Sandbox site. SHA-256
`3088cfd23d204f851663718dba615a8d22179d532b8d0d91543315efbcf33801` matched downloaded
bytes. The PDF, test PI, prompt/profile and permanent ledger receipts remain for
inspection. No real applicant narrative was uploaded or used.

The hosted drain configuration is 240 seconds; lease 300 seconds; Executor budget
210 seconds from tick entry. There is no cron schedule. Source/response content
expires **November 17 at 18:31:58.521 UTC**, other content **November 23 at that time**.
Physical expiry cleanup is still due through the exact-scope drain; no automatic
cleanup or receipt deletion is claimed. Retain the valid policy for scoped cleanup
after expiration. Fixture deletion/PI restoration is separate future cleanup.

## PDF correction and evidence limits

Preflight exposed PDF.js Buffer slicing/aliasing under the shared loader's full
dependency graph: correct downloaded bytes failed with `Invalid PDF structure`.
Passing an owned `Uint8Array` fixes it. A real synthetic-PDF subprocess regression
fails with the old Buffer path and passes with the correction; 44 focused tests,
types and lint passed. Fresh independent source review found no blocker. The
corrected hosted build reached Ready and extracted the same real fixture successfully.

This is backend HTTP/service acceptance with synthetic input. It does not prove
Connor's actual Power Automate submit/poll flow, intake upload-completion signal,
readiness/failure notifications, Akoya form hiding, staff browser readback of this
machine result, representative applicant quality, forced-timeout recovery, or
unattended scheduling. Production remains refused by the policy. The full inherited
branch delta requires release review before any promotion.

Operational helpers are `scripts/prepare-summary-sandbox-trial.cjs`,
`scripts/run-summary-sandbox-http.cjs`, and `scripts/verify-summary-sandbox-trial.cjs`.
They are dated, exact-fixture operators, not reusable enrollment tooling. Do not
rerun setup or remove intent fences to repeat the completed job. Private source,
credentials and receipts remain under `/private/tmp/wmkf-summary-live-20261116`
(mode 0700; sensitive files 0600). They are not committed and will not survive a
move to another Mac. Tracked evidence above is content-free apart from synthetic
fixture description; private credential files must never be shared as receipts.

## Changed-fact reconciliation

Sweep Mode A: bounded Summary activation/delivery changed from local-only to
Sandbox-proved. Authority is the hosted job plus ledger and Dataverse readback,
not plan intent. Submit → source/Executor → attempt/audit/publication → field/status
was exercised. Runbook, field/worker plans, shared architecture, PA handoff, ledger
Atlas and session notes now distinguish this trial from Production and historical
Short Title/editor trials. Credentials guidance now records the deployment-only activation; route declarations
retain the default-off, exact-Sandbox contract. Earlier dated build receipts retain their
historical scope. Disconfirming check: replay after restoring null did not refill
it, increment the job version or create another attempt/publication. Remaining
external flow/UI/quality uncertainties are enumerated above.
