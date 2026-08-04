/**
 * RequireAuth - Authentication guard component
 *
 * Wraps pages that require authentication. Shows loading state while
 * checking session, redirects to signin if unauthenticated.
 *
 * Also handles profile linking for first-time Azure logins.
 *
 * The public status endpoint mirrors the shared server enforcement policy.
 * Production-mode deployments fail closed; local development can still opt
 * out when the policy says authentication is disabled.
 */

import { useSession, signIn } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import ProfileLinkingDialog from './ProfileLinkingDialog';
import { getAuthEnabled } from '../utils/auth-enabled';

export default function RequireAuth({ children }) {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [showLinkingDialog, setShowLinkingDialog] = useState(false);
  // Start as false on both server and client — avoids hydration mismatch
  // and prevents loading-state flicker. Auth UI appears after the fetch.
  const [authEnabled, setAuthEnabled] = useState(false);

  // Check auth status on mount (client-side). Shared, deduped lookup —
  // Layout mounts on the same page load and needs the same answer (S398).
  useEffect(() => {
    getAuthEnabled().then(setAuthEnabled);
  }, []);

  useEffect(() => {
    // Check if user needs to link to an existing profile
    if (status === 'authenticated' && session?.user?.needsLinking) {
      setShowLinkingDialog(true);
    }
  }, [status, session?.user?.needsLinking]);

  // Never wrap NextAuth's own pages — they handle auth state themselves.
  // (In practice pages/_app.js already excludes /auth/* from RequireAuth;
  // this is belt-and-suspenders. Placed after all hooks so hook order is
  // unconditional — see react-hooks/rules-of-hooks.)
  if (router.pathname.startsWith('/auth/')) {
    return children;
  }

  // If auth is not enabled, just render children
  if (!authEnabled) {
    return children;
  }

  // While the session is still resolving, KEEP children mounted. Children
  // already render before any auth check completes (the !authEnabled branch
  // above — designed no-flicker behavior), so this widens nothing; server
  // routes and the fail-closed RequireAppAccess/AppAccessContext guards stay
  // authoritative. Swapping to a spinner here unmounted the provider subtree
  // mid-flight (authEnabled flips true while useSession() is 'loading'),
  // discarding the in-flight /api/app-access result and re-fetching it on
  // remount — measured at ~0.3-0.4s per warm page load, ~2s when app-access
  // ran slow, S398. The 'unauthenticated' branch below still replaces
  // children with the sign-in screen once the session actually resolves.
  if (status === 'loading') {
    return children;
  }

  // Not authenticated - redirect to signin
  if (status === 'unauthenticated') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="max-w-md w-full mx-4">
          <div className="bg-white rounded-2xl shadow-xl border border-gray-200 p-8 text-center">
            <div className="w-16 h-16 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg
                className="w-8 h-8 text-indigo-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">
              Sign In Required
            </h1>
            <p className="text-gray-600 mb-6">
              Please sign in with your Microsoft account to access the Document Processing Suite.
            </p>
            <button
              onClick={() => signIn('azure-ad')}
              className="w-full flex items-center justify-center gap-3 px-6 py-3 bg-gray-900 hover:bg-gray-800 text-white font-semibold rounded-lg transition-colors"
            >
              <svg className="w-5 h-5" viewBox="0 0 21 21" fill="none">
                <rect width="10" height="10" fill="#f25022" />
                <rect x="11" width="10" height="10" fill="#7fba00" />
                <rect y="11" width="10" height="10" fill="#ffb900" />
              </svg>
              Sign in with Microsoft
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Authenticated but needs to link to existing profile
  if (showLinkingDialog) {
    return (
      <ProfileLinkingDialog
        session={session}
        onLinked={() => setShowLinkingDialog(false)}
      />
    );
  }

  // Authenticated and profile linked - render children
  return children;
}
