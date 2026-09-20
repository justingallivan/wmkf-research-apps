---
name: project-preview-rehearsal-venue-limits
description: What a Tier 2 browser rehearsal can and cannot exercise on the Vercel preview vs localhost (manage controls hidden on preview, preview link secret differs from production, briefing flag preview-off, localhost lacks the link secret, Dynamics email sends interlocked everywhere) and the StrictMode mounted-guard hazard found during one.
metadata:
  type: project
  status: active
  originSessionId: a5cf6aac-de71-42f1-8c9f-0450c4232296
---

## Recall Rule

Read this before planning an owner click-through of reviewer, external-token,
or email surfaces on a branch preview or on `npm run dev`. Pick the venue per
surface from the table below instead of discovering each limit live.

## Facts (2026-09-20, Client Request Layer Stage 4/5b rehearsal)

`[VERIFIED via source + vercel env ls + owner click-through]`

| Surface | Vercel preview | localhost `npm run dev` |
|---|---|---|
| Workbench reviewer manage controls (invite, remind, release, closeout, due date) | HIDDEN — `pages/workbench/[requestId].js` sets `previewReadOnly` when `VERCEL_ENV === 'preview'`; `ReviewersTab`/`ReviewsTab` gate on it | shown; writes fail closed via the target interlock with a visible refusal |
| External token pages (`/external/{review,grantee,materials,briefing}/[token]`) | verify only tokens minted with the PREVIEW `EXTERNAL_LINK_SECRET`, which differs from production's (both set separately; `invalid_signature` on a prod link) | cannot verify at all — `.env.local` has no `EXTERNAL_LINK_SECRET` |
| Deliberation briefing page | off unless `DELIBERATION_BRIEFING_SCHEMA_READY=on` is set at preview scope (production-only by default) | off for the same reason |
| Any email send (test-email, reminders, release, pre-site distribution) | denied — sends are Dynamics email-activity writes, so the target interlock refuses them from preview and local alike | same |
| Postgres-backed writes (briefing link rows) | ALLOWED — the interlock covers Dataverse only | allowed |

Consequences: reviewer/external token pages need production-minted links AND
production's secret, so they are effectively not browser-testable outside
production; record them test-covered or decide explicitly to copy the secret.
Minting a reviewer link requires a Dataverse write (production only).

Branch-scoped preview env used for the rehearsal (rollback = `vercel env rm
<name> preview feature/client-request-layer`; alias `vercel alias rm
wmkfresearchapps-preview.vercel.app`): `NEXTAUTH_URL` (CSRF origin must match
the alias), `DATAVERSE_ALLOW_PROD_READS=yes` (owner-authorized),
`DELIBERATION_BRIEFING_SCHEMA_READY=on`. See
[[project-vercel-cli-deploy-preview-auth]] for the Entra callback/alias rule.

## StrictMode mounted-guard hazard

`reactStrictMode: true` (`next.config.js`) double-invokes effects in dev.
A `useEffect(() => () => { mountedRef.current = false; }, [])` cleanup-only
guard flips false at mount and never back, so every post-await guard skips
and a `finally` that clears a spinner never runs — the dialog looks hung with
a 200 in the server log and a clean console. Fix: set `mountedRef.current =
true` in the effect body. Fixed 2026-09-20 in `ReleaseEmailModal`,
`CampaignConfigModal`, `pages/dataverse-bulk-export.js` (`1ce5587c9`); a
`React.StrictMode`-wrapped test is the discriminating pin.
