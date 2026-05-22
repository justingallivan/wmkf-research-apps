---
name: project-dynamics-email
description: "Dynamics email activity sending — bound action pattern, sender party requirement, and service methods"
metadata: 
  node_type: memory
  type: project
  originSessionId: 17893605-3207-451d-8190-118bbacd8141
---

Email sending is WORKING (as of Session 77).

- `SendEmail` is a **bound action**: `emails({id})/Microsoft.Dynamics.CRM.SendEmail` with `{ IssueSend: true }`
- Sender party **must** include `partyid_systemuser@odata.bind` — plain `addressused` alone causes "Invalid sender party" error
- `resolveSystemUser(email)` looks up `systemuserid` by `internalemailaddress`
- CRM tracking token (e.g., `CRM:0309001`) prepended to subject by Dynamics Server-Side Sync (org-wide setting, not our code)

**Service methods** in `dynamics-service.js`: `resolveSystemUser`, `createEmailActivity`, `addEmailAttachment`, `sendEmail`, `createAndSendEmail`

**Test surfaces:**
- Client: `/test-email` page + `/api/test-email` endpoint
- Script: `scripts/test-dynamics-email.js`
