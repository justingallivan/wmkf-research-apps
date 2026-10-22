---
name: project-preview-rehearsal-venue-limits
description: Historical browser rehearsal observations for Vercel Preview and localhost, plus source-backed local token-signing rules and a StrictMode mounted-guard hazard
metadata:
  type: project
  status: active
  last_verified: 2026-10-22 source-only review; current Vercel environment, interlock configuration, and local secret presence were not re-probed. Dated rehearsal observations below are not current environment state.
  originSessionId: a5cf6aac-de71-42f1-8c9f-0450c4232296
---

## Recall Rule

Read this before planning an owner click-through of reviewer, external-token,
or email surfaces on a branch preview or on `npm run dev`. The table records
dated rehearsal observations, not current environment state; verify present
configuration and source behavior before selecting a venue.

## Historical rehearsal record (2026-09-20, Client Request Layer Stage 4/5b)

The following reflected source, environment-list, and owner click-through
evidence from that rehearsal date only. It does not establish present Preview,
Production, or local environment configuration.

| Surface | Vercel preview | localhost `npm run dev` |
|---|---|---|
| Workbench reviewer manage controls (invite, remind, release, closeout, due date) | HIDDEN — `pages/workbench/[requestId].js` sets `previewReadOnly` when `VERCEL_ENV === 'preview'`; `ReviewersTab`/`ReviewsTab` gate on it | shown; writes fail closed via the target interlock with a visible refusal |
| External token pages (`/external/{review,grantee,materials,briefing}/[token]`) | at that rehearsal, verified only tokens minted with the PREVIEW `EXTERNAL_LINK_SECRET`, which differed from Production's (`invalid_signature` on a Production link) | at that rehearsal, `.env.local` had no `EXTERNAL_LINK_SECRET` |
| Deliberation briefing page | off unless `DELIBERATION_BRIEFING_SCHEMA_READY=on` is set at preview scope (production-only by default) | off for the same reason |
| Any email send (test-email, reminders, release, pre-site distribution) | denied — sends are Dynamics email-activity writes, so the target interlock refuses them from preview and local alike | same |
| Postgres-backed writes (briefing link rows) | ALLOWED — the interlock covers Dataverse only | allowed |

Consequences: exercise external token pages with tokens minted locally under a
throwaway local key and disposable/non-production records. Choose the data target
separately under `docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md`: the
Dataverse target interlock and explicit production-read controls still govern
access and writes; the signing key grants neither. Do not copy the production
signing secret for local testing. Minting a reviewer link may involve Dataverse
writes, so the configured target and interlock still determine whether it is
allowed.

The rehearsal used branch-scoped Preview values for `NEXTAUTH_URL` (CSRF origin
matched the alias), owner-authorized `DATAVERSE_ALLOW_PROD_READS=yes`, and
`DELIBERATION_BRIEFING_SCHEMA_READY=on`. That experiment later removed its
branch-scoped values and restored the alias; it is not a current environment or
rollback instruction. See
[[project-vercel-cli-deploy-preview-auth]] for the Entra callback/alias rule.

## Source-backed local token rule

`lib/services/external-token.js` accepts an `EXTERNAL_LINK_SECRET` of at least
32 characters. A throwaway local key can sign and verify locally minted tokens;
it need not match Preview or Production. Use disposable/non-production records
for local exercises. Signing-key configuration does not authorize or make
Production data access or writes safe. Choose the target separately under
`docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md`; the configured target,
explicit production-read controls, and Dataverse write interlock govern those
operations. Do not copy the Production signing secret for local testing.

## StrictMode mounted-guard hazard

`reactStrictMode: true` (`next.config.js`) double-invokes effects in dev.
A `useEffect(() => () => { mountedRef.current = false; }, [])` cleanup-only
guard flips false at mount and never back, so every post-await guard skips
and a `finally` that clears a spinner never runs — the dialog looks hung with
a 200 in the server log and a clean console. Fix: set `mountedRef.current =
true` in the effect body. Fixed 2026-09-20 in `ReleaseEmailModal`,
`CampaignConfigModal`, `pages/dataverse-bulk-export.js` (`1ce5587c9`); a
`React.StrictMode`-wrapped test is the discriminating pin.

## Historical Test Request Factory form rehearsal (2026-10-02)

Owner click-through, CLI, and log evidence from that rehearsal only; these are
not current deployment or cleanup instructions. Re-check current release
strategy and controls before another rehearsal.

- At that rehearsal, branch-scoped Preview variables were used; values were
  piped on stdin because `!`-prefixed commands could not answer prompts. Removing
  those variables did not disarm a deployment that had already been built.
- A branch pushed at a commit Vercel had already built produced no Preview
  build; an empty commit was pushed after the variables were set.
- Sign-in used the registered alias with a branch-scoped `NEXTAUTH_URL` set to
  the alias origin. The prior alias target was recorded and then restored.
- At that rehearsal, the form wrote to the sandbox org and `ledger` database,
  while source lookup read Production Dataverse. Production reads required
  owner-authorized `DATAVERSE_ALLOW_PROD_READS=yes`; Preview's Dynamics
  credentials could read Production and its interlock mode was `on` at that time.
- The sandbox refused create without the GoVerify bypass, which the form did
  not offer, so that Preview rehearsal ended at `create_request`. This records
  the 2026-10-02 result, not the present sandbox or release state.
- The rehearsal recorded that its Blob store was created unconnected and its
  token added under the name read by code. It also noted that default-prefix
  connection adds `BLOB_STORE_ID` / `BLOB_WEBHOOK_PUBLIC_KEY`, and that the CLI
  could not delete a Blob store for an agent while `vercel blob empty-store`
  accepted no store id. No present store target or cleanup behavior is asserted.

