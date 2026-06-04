---
name: project-dynamics-email
description: "Dynamics email activity sending — bound action pattern, sender party requirement, and service methods"
metadata: 
  node_type: memory
  type: project
  originSessionId: 17893605-3207-451d-8190-118bbacd8141
  status: active
  scope: dynamics
  last_verified: Session 77 via memory-content (not re-probed 2026-06-04)
---

## Recall Rule

Read this when: sending Dynamics email activities or wiring `SendEmail`.

Do:
- Call `SendEmail` as a bound action: `emails({id})/Microsoft.Dynamics.CRM.SendEmail` with `{ IssueSend: true }`.
- Include `partyid_systemuser@odata.bind` on the sender party; resolve the systemuser via `resolveSystemUser(email)`.
- Reuse the `dynamics-service.js` methods (`createEmailActivity`, `sendEmail`, `createAndSendEmail`, etc.) rather than reinventing.

Do not:
- Use `addressused` alone for the sender ("Invalid sender party" error).
- Expect to control the CRM tracking-token subject prefix — it's an org-wide Server-Side Sync setting, not our code.

Ground truth: `dynamics-service.js` email methods; test surfaces `/test-email`, `scripts/test-dynamics-email.js`. Durable API pattern. See [[project-dynamics-ai-writeback]] (sender-party binding gotcha).

Email sending is WORKING (as of Session 77).

- `SendEmail` is a **bound action**: `emails({id})/Microsoft.Dynamics.CRM.SendEmail` with `{ IssueSend: true }`
- Sender party **must** include `partyid_systemuser@odata.bind` — plain `addressused` alone causes "Invalid sender party" error
- `resolveSystemUser(email)` looks up `systemuserid` by `internalemailaddress`
- CRM tracking token (e.g., `CRM:0309001`) prepended to subject by Dynamics Server-Side Sync (org-wide setting, not our code)

**Service methods** in `dynamics-service.js`: `resolveSystemUser`, `createEmailActivity`, `addEmailAttachment`, `sendEmail`, `createAndSendEmail`

**Test surfaces:**
- Client: `/test-email` page + `/api/test-email` endpoint
- Script: `scripts/test-dynamics-email.js`
