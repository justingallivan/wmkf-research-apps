---
name: project-intake-portal-virus-scan-e2e-deferred
description: Future owner-revived intake pilot needs separately authorized scanner integration verification; parked portal and historical reviewer-path evidence do not authorize a live scan.
metadata:
  type: project
  status: active
  scope: intake
  last_verified: 2026-10-22 source review only; S203 code/test evidence was not re-probed and no deployed intake E2E was run
---

## Recall Rule

Read this when: the owner has revived the parked intake portal for a pilot, it is approaching an owner-approved go-live, or you're touching the intake upload virus-scan path. This note does not revive the portal or authorize a live scan.

Do:
- Run the deployed intake E2E only after the owner explicitly revives the parked portal for a pilot; this E2E is a pre-go-live gate, not a reason to revive the portal.
- Before any deployed diagnostic scan that calls Cloudmersive, obtain explicit authorization naming Cloudmersive and acknowledging possible money or credit use. Ordinary memory/audit authorization and authorization to run an E2E do not by themselves authorize a metered scan.
- Run the irreducible manual EICAR e2e through `/apply` on a deployed env (`VIRUS_SCAN_ENABLED=true` + `CLOUDMERSIVE_API_KEY`) before real applicants: stage `python3 scripts/build-intake-eicar-fixture.py`, upload `/tmp/eicar-test-exe.docx`, confirm HTTP 422 `infected` + blob deleted + `system_alerts` row `type='virus_detection_intake'` + email.
- Expect `ContainsExecutable` to fire and surface as `virusName='embedded executable'`.

Do not:
- Treat the reviewer-path S193 verification as covering the intake path — only the shared scanner half is proven; the live integration (Entra session + three-call dance + Blob + scan) is still unrun.
- Treat historical code/unit results as a fresh deployed integration check; the future pilot still needs its own authorized verification.

Ground truth: `pages/api/intake/draft/attach.js` (lines 430/486/526), `lib/services/cloudmersive-scan.js` (`scanBytes`), `tests/unit/intake-attach-endpoint.test.js:523/565`, `scripts/build-intake-eicar-fixture.py`; related [[project-cloudmersive-advanced-endpoint]], [[project-virus-scanning-it-context]].

S193 verified the virus-scan reject + system_alerts row + email path end-to-end through the **reviewer upload** flow (`/api/review-manager/upload-review` → `lib/services/review-upload.js` → Cloudmersive `/advanced`). The **intake portal upload** path (`/api/intake/draft/attach`) was NOT exercised live because Entra External ID sign-up was rough (per [[project-intake-portal-ui-todo]]) and the test would have required navigating a fake-applicant flow that isn't user-ready.

**Historical S203 verification record (not a fresh test run):**
- Intake infected-branch CODE intact + matches this note: `attach.js:430` `scan_result==='infected'` → blob `delBlobSilent` → awaited attempt to create the `virus_detection_intake` alert (around line 486, routed via `category: 'virus-detection'`) → `jsonError(res, 422, 'infected')` (line 526). Notification failure is caught and logged so rejection still returns; alert persistence is best-effort, not guaranteed before the response. S193's `detectedThreats`/`verifiedFileFormat` metadata present.
- Intake plumbing UNIT-TESTED: `tests/unit/intake-attach-endpoint.test.js:523` (infected → 422 + del + removePending + `draft.attach_infected` audit + `virus_detection_intake` notify) and `:565` (infected + del() throws → `attach_infected_del_failed`, Q3). Green.
- Scanner-half (does `/advanced` flag a wrapped executable) already PROVEN S193 — the scanner is shared between both paths.
- Fixture is now turnkey: `scripts/build-intake-eicar-fixture.py` writes `/tmp/eicar-test-exe.docx` (valid OOXML/ZIP container embedding a native exe under `word/embedded/payload.bin`; trips `ContainsExecutable`).

**Why:** Both paths share `lib/services/cloudmersive-scan.js`'s `scanBytes()`. The remaining functional confidence gap is the live deployed-env integration: real Entra-authed applicant session + three-call upload dance + real Blob + real `/advanced` scan, all wired together. The notification attempt is not a guaranteed durable alert because its failure is caught and logged.

**How to apply (the irreducible manual gate):** Only when the owner revives the parked portal for a future pilot, before going live to real applicants, on a deployed env with `VIRUS_SCAN_ENABLED=true` + `CLOUDMERSIVE_API_KEY`. This is not a J27/GOApply prerequisite. Obtain explicit authorization naming Cloudmersive and possible credit use before running the diagnostic scan:
- `python3 scripts/build-intake-eicar-fixture.py` to stage the fixture.
- Sign in via Entra External as a fake applicant (or a test contact already in the External ID tenant).
- Create a draft, get to the file-upload step, upload `/tmp/eicar-test-exe.docx`.
- Confirm: HTTP 422 with `infected` reason, blob deleted, `system_alerts` row `type='virus_detection_intake'`, email to the `virus-detection` category recipients (configure at /admin → Alert Recipients).
- Per [[project-cloudmersive-advanced-endpoint]], expect `ContainsExecutable` to fire and surface as `virusName='embedded executable'`.

If the test fails (no rejection, no alert), the most likely diagnostic step is checking `attach.js:430` — that's where the `scan_result === 'infected'` branch fires.

Related: [[project-cloudmersive-advanced-endpoint]] (the scanner change S193 made), [[project-virus-scanning-it-context]] (threat-model context).
