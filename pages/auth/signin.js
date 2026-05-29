/**
 * Custom Sign In Page
 *
 * Provides a branded login experience for Microsoft authentication
 */

import { signIn } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

export default function SignIn() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const { error, callbackUrl } = router.query;

  // Applicant callbackUrls (`/apply...`) should never see the staff sign-in
  // UI — auto-dispatch to the External ID provider so OTP starts immediately.
  // If sign-in failed (error present), stop here and surface the message
  // instead of looping the applicant through OAuth again.
  // The callbackUrl arrives as an absolute URL when middleware encoded the
  // current location (`http://localhost:3000/apply`); pull the pathname
  // instead of string-matching the raw value.
  const isApplicantContext = isApplyPath(callbackUrl);
  useEffect(() => {
    if (isApplicantContext && !error) {
      signIn('entra-external', { callbackUrl });
    }
  }, [isApplicantContext, error, callbackUrl]);

  const handleSignIn = () => {
    setIsLoading(true);
    signIn('azure-ad', { callbackUrl: callbackUrl || '/' });
  };

  if (isApplicantContext && !error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Head><title>Signing in — WMKF Apply</title></Head>
        <p className="text-sm text-gray-500">Redirecting to sign-in…</p>
      </div>
    );
  }

  const getErrorMessage = (errorCode) => {
    switch (errorCode) {
      case 'OAuthSignin':
        return 'Error starting the sign in process. Please try again.';
      case 'OAuthCallback':
        return 'Error during the callback from Microsoft. Please try again.';
      case 'OAuthCreateAccount':
        return 'Could not create account. Please contact support.';
      case 'EmailCreateAccount':
        return 'Could not create account with this email.';
      case 'Callback':
        return 'Error during callback. Please try again.';
      case 'OAuthAccountNotLinked':
        return 'This email is linked to another account.';
      case 'AccessDenied':
        return 'Access denied. You may not have permission to access this application.';
      case 'Verification':
        return 'Token has expired or has already been used.';
      default:
        return 'An unexpected error occurred. Please try again.';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center p-4">
      <Head>
        <title>Sign In - Document Processing Suite</title>
      </Head>

      <div className="max-w-md w-full">
        {/* Logo/Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-900 rounded-2xl mb-4">
            <svg
              className="w-8 h-8 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">
            Document Processing Suite
          </h1>
          <p className="text-gray-600 mt-2">
            AI-powered tools for grant review workflows
          </p>
        </div>

        {/* Sign In Card */}
        <div className="bg-white rounded-2xl shadow-xl border border-gray-200 p-8">
          <h2 className="text-xl font-semibold text-gray-900 text-center mb-6">
            Sign in to continue
          </h2>

          {/* Error Message */}
          {error && (
            <div className="mb-6 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                    clipRule="evenodd"
                  />
                </svg>
                <span>{getErrorMessage(error)}</span>
              </div>
            </div>
          )}

          {/* Microsoft Sign In Button */}
          <button
            onClick={handleSignIn}
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-gray-900 hover:bg-gray-800 disabled:bg-gray-400 text-white font-semibold rounded-xl transition-colors"
          >
            {isLoading ? (
              <>
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Signing in...</span>
              </>
            ) : (
              <>
                <svg className="w-5 h-5" viewBox="0 0 21 21" fill="none">
                  <rect width="10" height="10" fill="#f25022" />
                  <rect x="11" width="10" height="10" fill="#7fba00" />
                  <rect y="11" width="10" height="10" fill="#00a4ef" />
                  <rect x="11" y="11" width="10" height="10" fill="#ffb900" />
                </svg>
                <span>Sign in with Microsoft</span>
              </>
            )}
          </button>

          {/* Help Text */}
          <p className="text-center text-sm text-gray-500 mt-6">
            Use your organization Microsoft account to sign in.
          </p>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-gray-400 mt-6">
          By signing in, you agree to the terms of service and privacy policy.
        </p>
      </div>
    </div>
  );
}

// Returns true when the callback target is the applicant portal (any /apply* path),
// whether the value is a raw path or an absolute URL.
function isApplyPath(cb) {
  if (typeof cb !== 'string' || !cb) return false;
  if (cb.startsWith('/apply')) return true;
  try {
    return new URL(cb).pathname.startsWith('/apply');
  } catch {
    return false;
  }
}

// Prevent authenticated users from seeing this page.
//
// Uses the same strict checks as proxy.js (azureId present + not idle)
// to avoid a redirect loop: middleware rejects stale tokens, but getSession()
// treats an empty-but-decodable JWT as a valid session. When the two disagree,
// the browser bounces between /auth/signin and / until it gives up ("Too many
// redirects"). Matching middleware's logic here keeps stale-cookie users on
// the sign-in page so they can re-authenticate.
export async function getServerSideProps(context) {
  const { getToken } = await import('next-auth/jwt');
  const token = await getToken({ req: context.req });

  const IDLE_TIMEOUT_MS = 2 * 60 * 60 * 1000;
  const notIdle = !token?.lastActivity || Date.now() - token.lastActivity < IDLE_TIMEOUT_MS;
  const hasStaffIdentity = !!token?.azureId;
  const hasApplicantIdentity = token?.userType === 'applicant' && !!token?.contactOid;
  const isValid = (hasStaffIdentity || hasApplicantIdentity) && notIdle;

  if (isValid) {
    // Send the user back to where they were headed, defaulting per surface
    // so a stale arrival at /auth/signin lands somewhere sensible.
    const fallback = hasApplicantIdentity ? '/apply' : '/';
    return {
      redirect: {
        destination: context.query.callbackUrl || fallback,
        permanent: false,
      },
    };
  }

  return { props: {} };
}
