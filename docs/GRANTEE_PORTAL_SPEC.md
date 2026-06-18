# Grantee Deliverables Portal — Spec Stub

Status: **PROPOSED — capture for a future spec session (S267 intake).** This is a
requirements seed, not an implementation record or an approved design. Everything below is
intent to be refined; nothing here is built. Label any state claim `[VERIFIED]`/`[ASSUMED]`
when this becomes a real spec.

## Purpose

At the **last stages of a grant cycle**, collect a small set of publication/impact deliverables
from **recent grantees** by emailing them Claude-drafted documents to edit and approve, then
capturing their returned materials into Dataverse. Reuses the external **reviewer-portal**
primitives (magic-link, token lifecycle, M365 email, SharePoint upload, fail-closed external
auth) rather than building a new portal from scratch.

## Flow (intended)

1. **Trigger:** a workbench action during cycle wrap-up (analogous to where reviewer flows live).
   The workbench enumerates the cycle's eligible grantees from Dynamics grant/award records.
2. **Draft:** Claude drafts **two documents** per grantee (document types TBD — see Open
   Questions) via the existing prompt/Executor pipeline, sourced from the proposal + outcomes.
3. **Invite:** email each grantee (PD mailbox via Dynamics 365 / M365) a magic-link to a
   `/external/grantee/...` portal, with the two drafts attached or linked, asking them to
   **edit and approve**. Reuse the "Start …" button + copy-paste fallback link (`19bd446e`).
4. **Collect:** in the portal the grantee returns:
   - the **two edited documents** (file uploads),
   - one **graphical-abstract image** (file upload),
   - an **image caption** (free text),
   - a **consent** acknowledgement (checkbox).
5. **Store:** results land in **Dataverse** (structured: caption text, consent boolean +
   timestamp/who, status, file references) with the **binary files in SharePoint** (mix of both,
   mirroring the reviewer return-upload pattern). Virus-scan uploads on intake.
6. **Cadence:** **once per cycle**, with an optional **reminder email** for non-responders.

## Reused reviewer-portal primitives

| Primitive | Source | Grantee-portal use |
|---|---|---|
| Magic-link external portal | `pages/external/review/*` | `pages/external/grantee/*` analog |
| Token lifecycle (issue/validate/expire) | `lib/external/token-lifecycle.js` | per-grantee, once-per-cycle + reminder |
| M365 email send (PD mailbox) | `pages/api/review-manager/send-emails.js` (Dynamics email activities) | "Submit your materials" invite + reminder |
| Action-button + fallback link email render | `19bd446e`, `InviteEmailModal.js` | grantee invite email |
| SharePoint upload / return | reviewer return-upload flow + intake virus scan | edited docs + graphical-abstract image |
| Claude doc generation | Executor / prompt pipeline | drafting the two documents |
| Fail-closed external auth | external portal auth | grantee token gate |
| E2E email-capture rehearsal harness | Codex S267 E2E work (`tests/e2e/reviewer-*`) | grantee-flow E2E |

## New work (the spec's real surface)

- **Eligibility/identity:** which Dynamics entity + recency window defines "recent grantees" for
  a cycle; how the workbench lists them; per-grantee contact resolution.
- **Dataverse schema:** new fields/entity for grantee deliverables (caption, consent bool +
  audit, status, file refs) — schema-as-code + migration + Atlas page.
- **SharePoint:** library/folder convention for returned docs + image.
- **Consent:** exact text + what is consented to (publication/use of materials); audit trail
  (who/when/IP) — likely legally meaningful, get it right.
- **Image handling:** accepted formats/size, the graphical abstract; scan + store.
- **Edit/approve loop:** does staff review the returned edited docs before final acceptance?
- **Reuse vs fork:** how much reviewer portal/token/upload code is genuinely shared vs needs a
  parallel grantee variant (avoid copy-paste drift; prefer shared helpers).

## Open Questions (resolve at spec time)

1. What ARE the two documents (e.g. lay/impact summary, press piece, annual-report narrative)?
   What's the drafting prompt + source material?
2. "Mix of both" storage — confirm the split: structured fields in Dataverse, binaries in
   SharePoint with Dataverse pointers? Or some materials fully in Dataverse?
3. Does the consent gate the use of the OTHER returned materials (image/docs) for publication?
4. Reminder cadence + deadline: how many reminders, what window, who's notified on non-response.
5. Is the edited-doc return a true round-trip edit (they modify our draft) or a fresh upload?
6. Does this share the reviewer portal's exact pages/token table, or a parallel grantee schema?

## Pointers

- Reviewer portal / external token / SharePoint: `docs/agent-wiki/topics/external-reviewer-portal.md`
- Intake upload / virus scan: `docs/agent-wiki/topics/intake-portal.md`
- Prompt/Executor: `docs/EXECUTOR_CONTRACT.md`
- Dataverse schema-as-code: `lib/dataverse/schema/`, `docs/APPLICATION_STATE_ATLAS.md`
