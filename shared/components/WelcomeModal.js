/**
 * WelcomeModal - Shown to new users on their first login
 *
 * Informs them they have access to the WMKF Akoya Chatbot and
 * directs them to email jgallivan@wmkeck.org for additional access.
 * Dismissal is persisted in localStorage so it only shows once.
 */

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/router';
import Link from 'next/link';

const DISMISSED_KEY = 'welcome_modal_dismissed';

export default function WelcomeModal() {
  const { data: session } = useSession();
  const router = useRouter();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!session?.user?.isNewUser) return;

    // Check if already dismissed
    const profileId = session.user.profileId;
    const dismissedFor = localStorage.getItem(DISMISSED_KEY);
    if (dismissedFor === String(profileId)) return;

    setShow(true);
  }, [session]);

  if (!show) return null;

  const handleDismiss = () => {
    const profileId = session?.user?.profileId;
    if (profileId) {
      localStorage.setItem(DISMISSED_KEY, String(profileId));
    }
    setShow(false);
    router.push('/dynamics-explorer');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 max-w-lg w-full mx-4 p-8">
        <div className="text-center">
          <div className="w-16 h-16 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl">👋</span>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-3">
            Welcome to the Document Processing Suite!
          </h2>
          <p className="text-gray-600 mb-6 leading-relaxed">
            You currently have access to the <strong>WMKF Akoya Chatbot</strong>.
            Check out the{' '}
            <Link href="/guide" className="text-indigo-600 hover:text-indigo-800 underline">
              User Guide
            </Link>{' '}
            to learn how it works. To request access to additional applications, please email{' '}
            <a
              href="mailto:jgallivan@wmkeck.org"
              className="text-indigo-600 hover:text-indigo-800 underline"
            >
              jgallivan@wmkeck.org
            </a>.
          </p>
          <button
            onClick={handleDismiss}
            className="w-full px-6 py-3 bg-gray-900 hover:bg-gray-800 text-white font-semibold rounded-lg transition-colors"
          >
            Get Started
          </button>
        </div>
      </div>
    </div>
  );
}
