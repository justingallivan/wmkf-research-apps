import Head from 'next/head';
import Link from 'next/link';
import { useState, useEffect, useMemo } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { useProfile } from '../context/ProfileContext';
import { useAppAccess } from '../context/AppAccessContext';
import { getAuthEnabled } from '../utils/auth-enabled';
import { APP_REGISTRY } from '../config/appRegistry';
import ProfileSelector from './ProfileSelector';

export default function Layout({
  children,
  title = 'Document Processing Suite',
  description = 'AI-powered document processing applications for research, analysis, and automation',
  showNavigation = true,
  maxWidth = '7xl'
}) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [authEnabled, setAuthEnabled] = useState(false);
  const [alertCount, setAlertCount] = useState(0);
  const { data: session, status } = useSession();
  const { currentProfile } = useProfile();
  const { hasAccess, isSuperuser } = useAppAccess();

  // Check if auth is enabled — shared, deduped lookup (one /api/auth/status
  // per page load across RequireAuth + Layout, S398).
  useEffect(() => {
    getAuthEnabled().then(setAuthEnabled);
  }, []);

  // Fetch active alert count for superusers (for nav badge)
  useEffect(() => {
    if (!isSuperuser) return;
    fetch('/api/admin/alerts?summary=true')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data) setAlertCount((data.critical || 0) + (data.error || 0));
      })
      .catch(() => {});
  }, [isSuperuser]);

  const navigationItems = useMemo(() => {
    const items = [{ name: 'Home', href: '/', icon: '🏠' }];

    // Add app links filtered by access
    APP_REGISTRY.forEach(app => {
      if (hasAccess(app.key)) {
        items.push({ name: app.name, href: app.href, icon: app.icon });
      }
    });

    // Guide link — always accessible
    items.push({ name: 'Guide', href: '/guide', icon: '📖' });

    // Admin link only for superusers
    if (isSuperuser) {
      items.push({ name: 'Admin', href: '/admin', icon: '⚙️', badge: alertCount > 0 ? alertCount : null });
    }

    return items;
  }, [hasAccess, isSuperuser, alertCount]);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <Head>
        <title>{title}</title>
        <meta name="description" content={description} />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className={`max-w-${maxWidth} mx-auto px-4`}>
          <div className="flex justify-between items-center py-4">
            {/* Desktop Navigation */}
            {showNavigation && (
              <nav className="hidden md:flex items-center gap-1 flex-wrap flex-1">
                {navigationItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="relative flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-all duration-200"
                  >
                    <span className="text-base">{item.icon}</span>
                    <span>{item.name}</span>
                    {item.badge && (
                      <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full px-1">
                        {item.badge > 99 ? '99+' : item.badge}
                      </span>
                    )}
                  </Link>
                ))}
              </nav>
            )}

            {/* User Menu - Desktop */}
            <div className="hidden md:flex items-center">
              {/* Show ProfileSelector when auth is disabled */}
              {!authEnabled && <ProfileSelector />}

              {/* Show User Menu when auth is enabled and authenticated */}
              {authEnabled && status === 'authenticated' && session?.user ? (
                <div className="relative">
                  <button
                    onClick={() => setShowUserMenu(!showUserMenu)}
                    className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-colors"
                  >
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-semibold"
                      style={{ backgroundColor: currentProfile?.avatarColor || session.user.avatarColor || '#6366f1' }}
                    >
                      {(session.user.name || session.user.email || '?')[0].toUpperCase()}
                    </div>
                    <span className="max-w-[120px] truncate">
                      {currentProfile?.displayName || currentProfile?.name || session.user.name || session.user.email}
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

                  {/* User Dropdown */}
                  {showUserMenu && (
                    <div className="absolute right-0 mt-2 w-64 bg-white rounded-xl shadow-lg border border-gray-200 z-50 overflow-hidden">
                      {/* User Info */}
                      <div className="px-4 py-3 border-b border-gray-100">
                        <div className="text-sm font-medium text-gray-900 truncate">
                          {session.user.name}
                        </div>
                        <div className="text-xs text-gray-500 truncate">
                          {session.user.email}
                        </div>
                      </div>

                      {/* Menu Items */}
                      <div className="py-2">
                        <Link
                          href="/scheduled-emails"
                          onClick={() => setShowUserMenu(false)}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm text-gray-600 hover:bg-gray-50 transition-colors"
                        >
                          <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l9 6 9-6M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                          </svg>
                          <span>Scheduled Emails</span>
                        </Link>
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

                      {/* Sign Out */}
                      <div className="border-t border-gray-100 py-2">
                        <button
                          onClick={() => {
                            setShowUserMenu(false);
                            signOut({ callbackUrl: '/' });
                          }}
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
              ) : authEnabled && status === 'loading' ? (
                <div className="flex items-center gap-2 px-3 py-2 text-sm text-gray-500">
                  <div className="w-3 h-3 rounded-full bg-gray-300 animate-pulse" />
                  <span>Loading...</span>
                </div>
              ) : null}
            </div>

            {/* Mobile: User/Profile + Menu Button */}
            <div className="md:hidden flex items-center gap-2">
              {/* Show ProfileSelector on mobile when auth is disabled */}
              {!authEnabled && <ProfileSelector />}

              {/* Show user avatar on mobile when auth is enabled and authenticated */}
              {authEnabled && status === 'authenticated' && session?.user && (
                <button
                  onClick={() => setShowUserMenu(!showUserMenu)}
                  className="flex items-center gap-2 px-2 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 rounded-lg"
                >
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-white text-sm font-semibold"
                    style={{ backgroundColor: currentProfile?.avatarColor || session.user.avatarColor || '#6366f1' }}
                  >
                    {(session.user.name || session.user.email || '?')[0].toUpperCase()}
                  </div>
                </button>
              )}
              {showNavigation && (
                <button
                  onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                  className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-all duration-200"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={isMobileMenuOpen ? "M6 18L18 6M6 6l12 12" : "M4 6h16M4 12h16M4 18h16"} />
                  </svg>
                </button>
              )}
            </div>
          </div>

          {/* Mobile User Menu (only when auth enabled) */}
          {authEnabled && showUserMenu && status === 'authenticated' && (
            <div className="md:hidden border-t border-gray-200 py-4">
              <div className="px-4 pb-3 border-b border-gray-100 mb-3">
                <div className="text-sm font-medium text-gray-900">{session.user.name}</div>
                <div className="text-xs text-gray-500">{session.user.email}</div>
              </div>
              <Link
                href="/scheduled-emails"
                onClick={() => setShowUserMenu(false)}
                className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-600 hover:bg-gray-50"
              >
                <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l9 6 9-6M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                <span>Scheduled Emails</span>
              </Link>
              <Link
                href="/profile-settings"
                onClick={() => setShowUserMenu(false)}
                className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-600 hover:bg-gray-50"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span>Profile Settings</span>
              </Link>
              <button
                onClick={() => {
                  setShowUserMenu(false);
                  signOut({ callbackUrl: '/' });
                }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                <span>Sign Out</span>
              </button>
            </div>
          )}

          {/* Mobile Navigation */}
          {showNavigation && isMobileMenuOpen && (
            <div className="md:hidden border-t border-gray-200 py-4">
              <nav className="space-y-2">
                {navigationItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="flex items-center gap-3 px-3 py-2 text-base font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-all duration-200"
                    onClick={() => setIsMobileMenuOpen(false)}
                  >
                    <span className="text-lg">{item.icon}</span>
                    <span>{item.name}</span>
                  </Link>
                ))}
              </nav>
            </div>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1">
        <div className={`max-w-${maxWidth} mx-auto px-4`}>
          {children}
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200 mt-auto">
        <div className={`max-w-${maxWidth} mx-auto px-4 py-8`}>
          <div className="text-center">
            <p className="text-gray-600 mb-4">
              Written by <a href="mailto:justingallivan@me.com" className="hover:text-gray-800">Justin Gallivan</a> • Built with Claude AI • Powered by Next.js • Deployed on Vercel
            </p>
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

      {/* Click outside handler for user menu */}
      {showUserMenu && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setShowUserMenu(false)}
        />
      )}
    </div>
  );
}

// Page Header Component for consistent page titles
export function PageHeader({ title, subtitle, icon, children }) {
  return (
    <div className="bg-white shadow-sm border-b border-gray-200 -mx-4 mb-8">
      <div className="px-4 py-8">
        <div className="text-center">
          <div className="flex justify-center items-center gap-3 mb-4">
            {icon && <span className="text-4xl">{icon}</span>}
            <h1 className="text-3xl md:text-4xl font-bold text-gray-900">
              {title}
            </h1>
          </div>
          {subtitle && (
            <p className="text-lg text-gray-600 max-w-3xl mx-auto leading-relaxed">
              {subtitle}
            </p>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}

// Card Component for consistent card styling
export function Card({
  children,
  className = '',
  hover = true,
  padding = 'p-6'
}) {
  return (
    <div className={`
      bg-white border border-gray-200 rounded-xl shadow-sm
      ${hover ? 'transition-all duration-200 hover:shadow-md hover:border-gray-300' : ''}
      ${padding} ${className}
    `}>
      {children}
    </div>
  );
}

// Button Component for consistent styling
export function Button({
  children,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  className = '',
  ...props
}) {
  const baseClasses = 'inline-flex items-center justify-center font-semibold rounded-lg transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2';

  const variants = {
    primary: 'bg-gray-900 hover:bg-gray-800 text-white focus:ring-gray-500',
    secondary: 'bg-gray-100 hover:bg-gray-200 text-gray-900 focus:ring-gray-300',
    outline: 'border border-gray-300 hover:border-gray-400 text-gray-700 bg-white hover:bg-gray-50 focus:ring-gray-300',
    danger: 'bg-red-600 hover:bg-red-700 text-white focus:ring-red-500'
  };

  const sizes = {
    sm: 'px-3 py-2 text-sm',
    md: 'px-6 py-3 text-base',
    lg: 'px-8 py-4 text-lg'
  };

  const disabledClasses = 'opacity-50 cursor-not-allowed hover:bg-gray-400';

  return (
    <button
      className={`
        ${baseClasses}
        ${variants[variant]}
        ${sizes[size]}
        ${disabled || loading ? disabledClasses : ''}
        ${className}
      `}
      disabled={disabled || loading}
      {...props}
    >
      {loading && (
        <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2" />
      )}
      {children}
    </button>
  );
}
