/**
 * RequireAppAccess - Page-level access guard
 *
 * Wraps an app page to block access if the user doesn't have the required app grant.
 * Shows a spinner while loading, then an "Access Not Available" message if denied.
 */

import { useAppAccess } from '../context/AppAccessContext';
import Link from 'next/link';

export default function RequireAppAccess({ appKey, children }) {
  const { hasAccess, isLoading, error, refreshAccess } = useAppAccess();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-gray-200 border-t-gray-600 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // The access check failed (timeout/network) rather than the user lacking the
  // grant. Offer a Retry instead of a dead spinner or a misleading
  // "Access Not Available". (Self-heal also re-attempts on tab focus.)
  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="max-w-md w-full mx-4">
          <div className="bg-white rounded-2xl shadow-xl border border-gray-200 p-8 text-center">
            <h1 className="text-2xl font-bold text-gray-900 mb-2">
              Couldn’t verify access
            </h1>
            <p className="text-gray-600 mb-6">
              We couldn’t reach the access service. Check your connection and try again.
            </p>
            <div className="flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => refreshAccess()}
                className="inline-flex items-center justify-center px-6 py-3 bg-gray-900 hover:bg-gray-800 text-white font-semibold rounded-lg transition-colors"
              >
                Retry
              </button>
              <Link
                href="/"
                className="inline-flex items-center justify-center px-6 py-3 bg-white hover:bg-gray-50 text-gray-900 font-semibold rounded-lg border border-gray-300 transition-colors"
              >
                Return Home
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!hasAccess(appKey)) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="max-w-md w-full mx-4">
          <div className="bg-white rounded-2xl shadow-xl border border-gray-200 p-8 text-center">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg
                className="w-8 h-8 text-gray-400"
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
              Access Not Available
            </h1>
            <p className="text-gray-600 mb-6">
              You do not currently have access to this application. Please contact your administrator for assistance.
            </p>
            <Link
              href="/"
              className="inline-flex items-center justify-center px-6 py-3 bg-gray-900 hover:bg-gray-800 text-white font-semibold rounded-lg transition-colors"
            >
              Return Home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return children;
}
