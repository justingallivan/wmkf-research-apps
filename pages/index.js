import { useState, useEffect, useMemo } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useSession, signOut } from 'next-auth/react';
import ProfileSelector from '../shared/components/ProfileSelector';
import { APP_REGISTRY } from '../shared/config/appRegistry';
import { useAppAccess } from '../shared/context/AppAccessContext';
import { getAuthEnabled } from '../shared/utils/auth-enabled';

export default function LandingPage() {
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [authEnabled, setAuthEnabled] = useState(false);
  const { data: session } = useSession();
  const { hasAccess } = useAppAccess();

  // Check if auth is enabled — shared, deduped lookup (one /api/auth/status
  // per page load across RequireAuth + Layout + this page, S398).
  useEffect(() => {
    getAuthEnabled().then(setAuthEnabled);
  }, []);

  // Map registry entries to the format AppCard expects, filtered by access
  const apps = useMemo(() =>
    APP_REGISTRY
      .filter(app => hasAccess(app.key))
      .map(app => ({
        id: app.key,
        title: app.name,
        description: app.description,
        icon: app.icon,
        status: 'active',
        categories: app.categories,
        features: app.features,
        path: app.href,
      })),
    [hasAccess]
  );

  const filteredApps = apps.filter(app => {
    if (selectedCategory === 'all') return true;
    return app.categories.includes(selectedCategory);
  });

  return (
      <div className="min-h-screen bg-gray-50">
        <Head>
          <title>Document Processing Suite</title>
          <meta name="description" content="AI-powered document processing applications for research, analysis, and automation" />
          <link rel="icon" href="/favicon.ico" />
        </Head>

        {/* Header Section */}
        <header className="bg-white shadow-sm border-b border-gray-200">
          <div className="max-w-7xl mx-auto px-4 py-8">
            {/* Profile/User Menu */}
            <div className="flex justify-end mb-4">
              {/* Show ProfileSelector when auth is disabled */}
              {!authEnabled && <ProfileSelector />}

              {/* Show User Menu when auth is enabled and authenticated */}
              {authEnabled && session?.user && (
                <div className="relative">
                  <button
                    onClick={() => setShowUserMenu(!showUserMenu)}
                    className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-colors"
                  >
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-semibold"
                      style={{ backgroundColor: session.user.avatarColor || '#6366f1' }}
                    >
                      {(session.user.name || session.user.email || '?')[0].toUpperCase()}
                    </div>
                    <span className="max-w-[120px] truncate hidden sm:inline">
                      {session.user.name || session.user.email}
                    </span>
                    <svg
                      className={`w-4 h-4 text-gray-400 transition-transform ${showUserMenu ? 'rotate-180' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {showUserMenu && (
                    <div className="absolute right-0 mt-2 w-56 bg-white rounded-xl shadow-lg border border-gray-200 z-50 overflow-hidden">
                      <div className="px-4 py-3 border-b border-gray-100">
                        <div className="text-sm font-medium text-gray-900 truncate">{session.user.name}</div>
                        <div className="text-xs text-gray-500 truncate">{session.user.email}</div>
                      </div>
                      <div className="py-2">
                        <Link
                          href="/profile-settings"
                          onClick={() => setShowUserMenu(false)}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm text-gray-600 hover:bg-gray-50 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                          <span>Profile Settings</span>
                        </Link>
                      </div>
                      <div className="border-t border-gray-100 py-2">
                        <button
                          onClick={() => signOut({ callbackUrl: '/' })}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                          </svg>
                          <span>Sign Out</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="text-center">
              <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4">
                Document Processing Suite
              </h1>
              <p className="text-lg md:text-xl text-gray-600 max-w-3xl mx-auto leading-relaxed">
                AI-powered applications for research analysis, document processing, and workflow automation
              </p>
              <Link href="/guide" className="inline-flex items-center gap-2 mt-4 text-sm text-gray-500 hover:text-gray-700 transition-colors">
                <span>📖</span>
                <span>User Guide</span>
              </Link>
            </div>
          </div>
        </header>

        {/* Click outside handler for user menu */}
        {showUserMenu && (
          <div
            className="fixed inset-0 z-40"
            onClick={() => setShowUserMenu(false)}
          />
        )}

      {/* Filter Section */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex justify-center">
            <div className="flex flex-col sm:flex-row gap-2 bg-gray-100 p-2 rounded-lg">
              <button
                className={`px-6 py-3 font-semibold rounded-lg transition-all duration-200 ${
                  selectedCategory === 'all'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
                onClick={() => setSelectedCategory('all')}
              >
                All Apps ({apps.length})
              </button>
              <button
                className={`px-6 py-3 font-semibold rounded-lg transition-all duration-200 ${
                  selectedCategory === 'concepts'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
                onClick={() => setSelectedCategory('concepts')}
              >
                Concepts ({apps.filter(a => a.categories.includes('concepts')).length})
              </button>
              <button
                className={`px-6 py-3 font-semibold rounded-lg transition-all duration-200 ${
                  selectedCategory === 'phase-i'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
                onClick={() => setSelectedCategory('phase-i')}
              >
                Phase I ({apps.filter(a => a.categories.includes('phase-i')).length})
              </button>
              <button
                className={`px-6 py-3 font-semibold rounded-lg transition-all duration-200 ${
                  selectedCategory === 'phase-ii'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
                onClick={() => setSelectedCategory('phase-ii')}
              >
                Phase II ({apps.filter(a => a.categories.includes('phase-ii')).length})
              </button>
              <button
                className={`px-6 py-3 font-semibold rounded-lg transition-all duration-200 ${
                  selectedCategory === 'other'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
                onClick={() => setSelectedCategory('other')}
              >
                Other Tools ({apps.filter(a => a.categories.includes('other')).length})
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-12">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {filteredApps.map((app) => (
            <AppCard key={app.id} app={app} />
          ))}
        </div>
      </main>

        {/* Footer */}
        <footer className="bg-white border-t border-gray-200 mt-auto">
          <div className="max-w-7xl mx-auto px-4 py-8">
            <div className="text-center">
              <p className="text-gray-600 mb-4">Written by <a href="mailto:justingallivan@me.com" className="hover:text-gray-800">Justin Gallivan</a> • Built with Claude AI • Powered by Next.js • Deployed on Vercel</p>
              <div className="flex justify-center items-center gap-4">
                <Link
                  href="/guide"
                  className="text-gray-500 hover:text-gray-700 transition-colors duration-200"
                >
                  Guide
                </Link>
                <span className="text-gray-300">•</span>
                <a
                  href="https://github.com/justingallivan/wmkf-research-apps"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-500 hover:text-gray-700 transition-colors duration-200"
                >
                  GitHub
                </a>
                <span className="text-gray-300">•</span>
                <a
                  href="https://claude.ai"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-500 hover:text-gray-700 transition-colors duration-200"
                >
                  Claude AI
                </a>
              </div>
            </div>
          </div>
        </footer>
      </div>
  );
}

function AppCard({ app }) {
  const isActive = app.status === 'active';
  
  const CardContent = (
    <div className={`
      bg-white border border-gray-200 rounded-xl p-6 shadow-sm
      transition-all duration-200 hover:shadow-md hover:border-gray-300
      ${isActive ? 'cursor-pointer hover:scale-[1.02]' : 'opacity-75'}
      group h-full flex flex-col
    `}>
      {/* Header */}
      <div className="flex items-start gap-4 mb-4">
        <div className="text-3xl flex-shrink-0">{app.icon}</div>
        <div className="flex-1 min-w-0">
          <h3 className="text-xl font-bold text-gray-900 mb-2 group-hover:text-gray-800">
            {app.title}
          </h3>
          <span className={`
            inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold
            ${app.status === 'active' 
              ? 'bg-green-50 text-green-700 border border-green-200' 
              : 'bg-amber-50 text-amber-700 border border-amber-200'
            }
          `}>
            {app.status === 'active' ? '✓ Available' : '⏳ Coming Soon'}
          </span>
        </div>
      </div>
      
      {/* Description */}
      <p className="text-gray-600 text-sm leading-relaxed mb-6 flex-grow group-hover:text-gray-700">
        {app.description}
      </p>

      {/* Action Button */}
      <div className="mt-auto">
        {isActive ? (
          <div className="flex items-center justify-center py-3 px-6 bg-gray-900 hover:bg-gray-800 text-white font-semibold rounded-lg transition-all duration-200">
            <span>Launch App</span>
            <span className="ml-2 group-hover:translate-x-1 transition-transform duration-200">→</span>
          </div>
        ) : (
          <div className="flex items-center justify-center py-3 px-6 bg-gray-100 text-gray-500 font-semibold rounded-lg cursor-not-allowed">
            Coming Soon
          </div>
        )}
      </div>
    </div>
  );

  if (isActive) {
    return (
      <Link href={app.path} className="block h-full">
        {CardContent}
      </Link>
    );
  }

  return CardContent;
}