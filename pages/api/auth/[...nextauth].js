/**
 * NextAuth.js API Route - dual-provider authentication
 *
 * Two distinct identity surfaces share this NextAuth instance:
 *
 * 1. Staff (`azure-ad` provider) — organizational Entra ID tenant. Sessions
 *    carry `azureId`/`profileId`/`dynamicsSystemuserId` and are gated by
 *    `requireAuth*` helpers + `dynamics_user_roles` + per-app grants.
 *
 * 2. Applicants (`entra-external` provider) — separate Entra External ID
 *    tenant (`wmkeckapply.ciamlogin.com`), email OTP only. Sessions carry
 *    `contactOid`/`contactEmail` and are routed exclusively to `/apply/*`.
 *    No staff-side profile linking, no `dynamics_user_roles` lookup, no
 *    `user_app_access`.
 *
 * Sessions self-identify with `userType: 'staff' | 'applicant'`. Middleware
 * enforces non-crossing — a staff session hitting `/apply/*` (or vice versa)
 * is bounced to the correct sign-in page rather than silently allowed.
 *
 * Environment variables required:
 * - NEXTAUTH_URL, NEXTAUTH_SECRET (shared)
 * - AZURE_AD_CLIENT_ID / AZURE_AD_CLIENT_SECRET / AZURE_AD_TENANT_ID (staff)
 * - EXTERNAL_AZURE_AD_CLIENT_ID / EXTERNAL_AZURE_AD_CLIENT_SECRET / EXTERNAL_AZURE_AD_TENANT_ID (applicants)
 */

import NextAuth from 'next-auth';
import AzureADProvider from 'next-auth/providers/azure-ad';
import { sql } from '@vercel/postgres';
import { DEFAULT_APP_GRANTS } from '../../../shared/config/appRegistry';
import NotificationService from '../../../lib/services/notification-service';
import { grantApps } from '../../../lib/services/app-access-service';
import { reconcileProfile } from '../../../lib/services/dynamics-identity-service';
import { withDalContext } from '../../../lib/dataverse/core/context';

// Entra External ID tenant uses the CIAM endpoint family, not the regular
// `login.microsoftonline.com` family. The well-known doc anchors discovery
// of all the OAuth endpoints + JWKS for token validation.
const EXTERNAL_TENANT_SUBDOMAIN = 'wmkeckapply';
const EXTERNAL_WELL_KNOWN = process.env.EXTERNAL_AZURE_AD_TENANT_ID
  ? `https://${EXTERNAL_TENANT_SUBDOMAIN}.ciamlogin.com/${process.env.EXTERNAL_AZURE_AD_TENANT_ID}/v2.0/.well-known/openid-configuration`
  : null;

export const authOptions = {
  providers: [
    AzureADProvider({
      clientId: process.env.AZURE_AD_CLIENT_ID,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET,
      tenantId: process.env.AZURE_AD_TENANT_ID,
      authorization: {
        params: {
          scope: 'openid email profile User.Read',
        },
      },
    }),
    // Applicant provider — only registered when all three External ID env
    // vars are present, so a staff-only deployment doesn't need them set.
    // Partial config (e.g. tenant + client_id but no secret) would register
    // the provider and fail at sign-in time; gate on the full triple instead.
    ...(EXTERNAL_WELL_KNOWN
      && process.env.EXTERNAL_AZURE_AD_CLIENT_ID
      && process.env.EXTERNAL_AZURE_AD_CLIENT_SECRET
      ? [
          {
            id: 'entra-external',
            name: 'WMKF Apply',
            type: 'oauth',
            wellKnown: EXTERNAL_WELL_KNOWN,
            clientId: process.env.EXTERNAL_AZURE_AD_CLIENT_ID,
            clientSecret: process.env.EXTERNAL_AZURE_AD_CLIENT_SECRET,
            authorization: { params: { scope: 'openid profile email offline_access' } },
            idToken: true,
            checks: ['pkce', 'state'],
            profile(profile) {
              // The token claim shape: `oid` is the External ID object ID,
              // stable across email changes. Email is fallback bootstrap key
              // only (see docs/INTAKE_PORTAL_DESIGN.md "Email change handling").
              return {
                id: profile.oid || profile.sub,
                email: profile.email || profile.preferred_username,
                name: profile.name,
              };
            },
          },
        ]
      : []),
  ],

  callbacks: {
    /**
     * signIn callback - runs after successful auth
     *
     * Staff (`azure-ad`): creates or links a `user_profiles` row, grants
     * default apps, fires Dynamics identity reconciliation. All side effects
     * stay on this branch.
     *
     * Applicant (`entra-external`): no DB write. Identity → Dynamics contact
     * mapping happens lazily on the first authenticated `/apply` write,
     * keyed off `contactOid`. Sign-in itself is just OAuth completion.
     */
    async signIn({ user, account, profile }) {
      if (account?.provider === 'entra-external') {
        // Applicants: no provisioning step. The external tenant has already
        // verified identity (OTP); we just accept the result.
        return true;
      }

      if (account?.provider === 'azure-ad') {
        try {
          const azureId = profile?.oid || user.id;
          const azureEmail = user.email?.toLowerCase();
          const displayName = user.name || profile?.name || azureEmail;

          if (!azureEmail) {
            console.error('No email returned from Azure AD');
            return false;
          }

          // Check if a profile with this Azure ID already exists
          const existingByAzureId = await sql`
            SELECT id, name, display_name, azure_email, needs_linking
            FROM user_profiles
            WHERE azure_id = ${azureId} AND is_active = true
          `;

          if (existingByAzureId.rows.length > 0) {
            // User already linked, update last login
            const profile = existingByAzureId.rows[0];
            await sql`
              UPDATE user_profiles
              SET last_login_at = CURRENT_TIMESTAMP, last_used_at = CURRENT_TIMESTAMP
              WHERE id = ${profile.id}
            `;
            return true;
          }

          // Check if there are unlinked profiles whose email matches the caller.
          // Only enter the linking flow when at least one profile is actually
          // linkable (the link-profile API requires email match).
          const unlinkedProfiles = await sql`
            SELECT id FROM user_profiles
            WHERE azure_id IS NULL AND is_active = true
              AND azure_email = ${azureEmail}
          `;

          if (unlinkedProfiles.rows.length > 0) {
            // Mark this user as needing to link to an existing profile
            // Create a temporary profile that will be updated or deleted after linking
            const tempResult = await sql`
              INSERT INTO user_profiles (name, display_name, azure_id, azure_email, is_active, needs_linking)
              VALUES (${azureEmail}, ${displayName}, ${azureId}, ${azureEmail}, true, true)
              ON CONFLICT (azure_id) DO UPDATE
              SET last_login_at = CURRENT_TIMESTAMP, last_used_at = CURRENT_TIMESTAMP
              RETURNING id
            `;

            // Grant default apps to new user
            if (tempResult.rows[0]?.id) {
              await grantDefaultApps(tempResult.rows[0].id);
              // Fire-and-forget new user notification
              NotificationService.notifyNewUser({ id: tempResult.rows[0].id, name: displayName, azure_email: azureEmail }).catch(() => {});
              // Fire-and-forget Dynamics identity link
              withDalContext('staff-signin-reconcile', () =>
                reconcileProfile(tempResult.rows[0].id, { silent: true })
              ).catch(() => {});
            }

            return true;
          }

          // No existing profiles - create new one
          const newResult = await sql`
            INSERT INTO user_profiles (name, display_name, azure_id, azure_email, is_default, needs_linking)
            VALUES (${azureEmail}, ${displayName}, ${azureId}, ${azureEmail}, true, false)
            ON CONFLICT (azure_id) DO UPDATE
            SET last_login_at = CURRENT_TIMESTAMP, last_used_at = CURRENT_TIMESTAMP
            RETURNING id
          `;

          // Grant default apps to new user
          if (newResult.rows[0]?.id) {
            await grantDefaultApps(newResult.rows[0].id);
            // Fire-and-forget new user notification
            NotificationService.notifyNewUser({ id: newResult.rows[0].id, name: displayName, azure_email: azureEmail }).catch(() => {});
            // Fire-and-forget Dynamics identity link
            withDalContext('staff-signin-reconcile', () =>
              reconcileProfile(newResult.rows[0].id, { silent: true })
            ).catch(() => {});
          }

          return true;
        } catch (error) {
          console.error('Error in signIn callback:', error);
          // Fail closed: if we can't verify identity against the DB, block sign-in.
          // The DB being down already breaks all app functionality, and /auth/error
          // gives the user a clear message. Profile linking cannot happen safely
          // without a working database.
          return false;
        }
      }
      return true;
    },

    /**
     * jwt callback - adds identity claims to the JWT
     *
     * Branches by provider on fresh sign-in:
     *   - `azure-ad`     → staff: stash azureId, look up linked profile row.
     *   - `entra-external` → applicant: stash contactOid + email. No DB lookup.
     *
     * Idle timeout (2 h) applies to both surfaces — staff JWTs are cleared
     * by missing `azureId`, applicant JWTs by missing `contactOid`.
     */
    async jwt({ token, user, account, profile }) {
      const IDLE_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours

      if (account?.provider === 'entra-external') {
        // Fresh applicant sign-in
        token.userType = 'applicant';
        token.contactOid = profile?.oid || profile?.sub || user?.id;
        token.contactEmail = (user?.email || profile?.email || profile?.preferred_username || '').toLowerCase();
        token.contactName = user?.name || profile?.name || null;
        token.lastActivity = Date.now();
        return token;
      }

      if (account?.provider === 'azure-ad') {
        // Fresh staff sign-in
        token.userType = 'staff';
        token.azureId = profile?.oid || user?.id;
        token.azureEmail = user?.email?.toLowerCase();
        token.lastActivity = Date.now();
      } else if (token.lastActivity) {
        // Subsequent request — check idle timeout (both surfaces)
        if (Date.now() - token.lastActivity > IDLE_TIMEOUT_MS) {
          return {};
        }
        token.lastActivity = Date.now();
      }

      // Applicant tokens never touch the staff DB. Bail early.
      if (token.userType === 'applicant') return token;

      // Staff: look up the linked profile ID
      if (token.azureId) {
        try {
          const result = await sql`
            SELECT id, name, display_name, avatar_color, needs_linking, last_login_at, dynamics_systemuser_id
            FROM user_profiles
            WHERE azure_id = ${token.azureId} AND is_active = true
            LIMIT 1
          `;

          if (result.rows.length > 0) {
            token.profileId = result.rows[0].id;
            token.profileName = result.rows[0].display_name || result.rows[0].name;
            token.avatarColor = result.rows[0].avatar_color;
            token.needsLinking = result.rows[0].needs_linking;
            token.isNewUser = !result.rows[0].last_login_at;
            token.dynamicsSystemuserId = result.rows[0].dynamics_systemuser_id || null;
          }
        } catch (error) {
          console.error('Error looking up profile in jwt callback:', error);
        }
      }

      return token;
    },

    /**
     * session callback - exposes identity claims to the client
     *
     * Both surfaces set `session.user.userType` so consumers can branch
     * without inspecting which fields are populated. Staff fields are
     * undefined on applicant sessions and vice versa.
     */
    async session({ session, token }) {
      if (!session.user) return session;

      session.user.userType = token.userType || (token.azureId ? 'staff' : null);

      if (session.user.userType === 'applicant') {
        session.user.contactOid = token.contactOid || null;
        session.user.contactEmail = token.contactEmail || null;
        session.user.contactName = token.contactName || null;
        return session;
      }

      // Staff
      session.user.azureId = token.azureId;
      session.user.azureEmail = token.azureEmail;
      session.user.profileId = token.profileId;
      session.user.profileName = token.profileName;
      session.user.avatarColor = token.avatarColor;
      session.user.needsLinking = token.needsLinking;
      session.user.isNewUser = token.isNewUser;
      session.user.dynamicsSystemuserId = token.dynamicsSystemuserId || null;
      return session;
    },
  },

  pages: {
    signIn: '/auth/signin',
    error: '/auth/error',
  },

  session: {
    strategy: 'jwt',
    maxAge: 8 * 60 * 60, // 8 hours
  },

  // Debug mode in development
  debug: process.env.NODE_ENV === 'development',
};

/**
 * Grant default apps to a newly created user profile
 */
async function grantDefaultApps(profileId) {
  try {
    await grantApps(profileId, DEFAULT_APP_GRANTS, null);
  } catch (error) {
    console.error('Error granting default apps:', error);
    // Non-fatal — user can still sign in
  }
}

export default NextAuth(authOptions);
