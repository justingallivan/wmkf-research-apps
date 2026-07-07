// @ts-check
/**
 * Branded actor identity for Dataverse write attribution (Invariant-Map #10,
 * "identity-provenance spoof"; docs/TYPESCRIPT_OPTION_ASSESSMENT.md §5 Phase 1).
 *
 * ─────────────────────────── DESIGN DECISION (owner-vetoable here) ───────────
 * This module is the Phase-1 answer to the ambiguity flagged when Phase 0
 * shipped: WHICH value is the branded actor, and WHERE is it minted. The call
 * made by the implementing agent (acting as owner-proxy) — veto by editing this
 * file:
 *
 *   1. BRAND `session.user.dynamicsSystemuserId` (the Dataverse systemuser GUID),
 *      NOT the Postgres `profileId`.
 *      WHY: #10 concerns the *write actor*. This GUID is the value that reaches
 *      the Dataverse write boundary as `actingUserSystemId` → the MSCRMCallerID
 *      header, stamping createdby/modifiedby/audit history. `profileId` is the
 *      Postgres app-identity used for access gating (a different concern, and an
 *      integer never interpolated into a write). The spoofable, attribution-
 *      bearing actor on writes is the systemuser GUID, so that is what gets a
 *      compiler-enforced provenance brand.
 *
 *   2. MINT ONLY HERE, via `actorRefFromSession(session)` — the sole sanctioned
 *      cast to `ActorRef`, mirroring how `isGuid` is the sole mint of `Guid`.
 *      A raw `string` (e.g. `req.body.actingUserSystemId`) therefore cannot
 *      type-check into a write signature that requires `ActorRef`: the identity
 *      must have come from the authenticated session, not from request input.
 *      This is the compile-time form of the CLAUDE.md invariant "Never accept
 *      user/profile identity from request input when authenticated context
 *      supplies it."
 *
 *   3. WHY A DEDICATED MODULE, not `@ts-check` on `lib/utils/auth.js`:
 *      Putting the whole auth resolver file under strict checkJs surfaces ~31
 *      annotation errors plus a real `getServerSession` next-auth overload cast
 *      on the single most security-sensitive file in the repo — exactly the
 *      "risky auth change" this program was told to avoid. A one-function module
 *      is the sole mint with ZERO change to auth logic; `lib/utils/auth.js`
 *      re-exports `actorRefFromSession` so the mint is still discoverable on the
 *      auth-resolver surface. (Same rationale that keeps `isGuid` in `guid.js`,
 *      not inlined into every route.)
 *
 * SCOPE of the requirement (Phase 1, deliberately narrow): the brand is required
 * on the non-frozen write-service boundary annotated this session
 * (`setTriageStatus.callerSystemId`). The frozen Phase-0 `DynamicsService` write
 * methods keep `string` actingUserSystemId params — and because
 * `ActorRef = string & {brand}`, an `ActorRef` flows into them unchanged, so no
 * frozen file is touched. Broadening the requirement to the other ~30 route→
 * service actor hand-offs is a follow-on (each route would need `@ts-check`).
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * A Dataverse systemuser GUID that PROVABLY originated from an authenticated
 * session (minted by {@link actorRefFromSession}). The brand is a compile-time-
 * only phantom; at runtime an ActorRef is a plain GUID string.
 *
 * @typedef {string & {__brand: 'ActorRef'}} ActorRef
 */

/**
 * Mint the branded write-actor identity from an authenticated session — the
 * ONLY sanctioned way to obtain an `ActorRef`. Returns `null` when the session
 * has no linked Dataverse systemuser (unattended/external-token flows), matching
 * the pre-existing `session?.user?.dynamicsSystemuserId || null` idiom every
 * write route uses today; callers pass the result straight through as
 * `actingUserSystemId` (null → attribute to the service principal).
 *
 * @param {{ user?: { dynamicsSystemuserId?: string | null } | null } | null | undefined} session
 *   The authenticated session from `getSession` / `requireAppAccess(...).session`.
 * @returns {ActorRef | null}
 */
export function actorRefFromSession(session) {
  const id = session?.user?.dynamicsSystemuserId;
  // The sole cast to ActorRef in the codebase. `id` is trusted because it was
  // written into the session by the NextAuth callback from the user's own
  // user_profiles row (pages/api/auth/[...nextauth].js), never from request input.
  return id ? /** @type {ActorRef} */ (id) : null;
}
