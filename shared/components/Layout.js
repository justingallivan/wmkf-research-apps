import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useState, useEffect, useMemo } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { useProfile } from '../context/ProfileContext';
import { requestEnvelope } from '../utils/api-request';
import { useAppAccess } from '../context/AppAccessContext';
import { getAuthEnabled } from '../utils/auth-enabled';
import { APP_REGISTRY } from '../config/appRegistry';
import ProfileSelector from './ProfileSelector';

// Literal class strings so Tailwind generates them (an interpolated
// `max-w-${maxWidth}` is dropped at build time). The header always uses the
// shell width; only <main> narrows (DESIGN.md "The One Shell Rule").
const SHELL_WIDTH_CLASS = 'max-w-7xl';
const MAIN_WIDTH_CLASSES = {
  '4xl': 'max-w-4xl',
  '6xl': 'max-w-6xl',
  '7xl': 'max-w-7xl',
};

// Apps shown as top-level nav items; every other accessible app goes in Tools.
const PRIMARY_APP_KEYS = ['reviewers', 'meeting-tracker'];

function isCurrentPath(pathname, href) {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

function ChevronIcon({ open, className = 'w-4 h-4 text-gray-400' }) {
  return (
    <svg
      className={`${className} transition-transform ${open ? 'rotate-180' : ''}`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function navLinkClass(current) {
  return `relative inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors duration-200 ${
    current
      ? 'text-gray-900 underline decoration-2 underline-offset-8'
      : 'text-gray-600 hover:text-gray-900'
  }`;
}

export default function Layout({
  children,
  title = 'Document Processing Suite',
  description = 'AI-powered document processing applications for research, analysis, and automation',
  showNavigation = true,
  maxWidth = '7xl'
}) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  // One open dropdown at a time: null | 'user' | 'tools'.
  const [openMenu, setOpenMenu] = useState(null);
  const showUserMenu = openMenu === 'user';
  const showToolsMenu = openMenu === 'tools';
  const toggleMenu = (name) => setOpenMenu((current) => (current === name ? null : name));
  const closeMenus = () => setOpenMenu(null);
  const router = useRouter();
  const pathname = router?.pathname || '';
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
    requestEnvelope('/api/admin/alerts?summary=true', { tolerantBody: true })
      .then(({ ok, data }) => {
        if (ok) setAlertCount((data.critical || 0) + (data.error || 0));
      })
      .catch(() => {});
  }, [isSuperuser]);

  // Escape closes any open dropdown.
  useEffect(() => {
    if (!openMenu) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpenMenu(null);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [openMenu]);

  const { primaryItems, toolItems, trailingItems } = useMemo(() => {
    const accessible = APP_REGISTRY.filter(app => hasAccess(app.key));
    const primary = [{ name: 'Home', href: '/' }];
    PRIMARY_APP_KEYS.forEach(key => {
      const app = accessible.find(entry => entry.key === key);
      if (app) primary.push({ name: app.name, href: app.href });
    });

    const tools = accessible
      .filter(app => !PRIMARY_APP_KEYS.includes(app.key))
      .map(app => ({ name: app.name, href: app.href }));
    if (isSuperuser) tools.push({ name: 'Cycle Dossier', href: '/cycle-dossier' });

    const trailing = [{ name: 'Guide', href: '/guide' }];
    if (isSuperuser) {
      trailing.push({ name: 'Admin', href: '/admin', badge: alertCount > 0 ? alertCount : null });
    }

    return { primaryItems: primary, toolItems: tools, trailingItems: trailing };
  }, [hasAccess, isSuperuser, alertCount]);

  const toolsCurrent = toolItems.some(item => isCurrentPath(pathname, item.href));
  const mainWidthClass = MAIN_WIDTH_CLASSES[maxWidth] || SHELL_WIDTH_CLASS;

  const renderNavLink = (item) => {
    const current = isCurrentPath(pathname, item.href);
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={current ? 'page' : undefined}
        className={navLinkClass(current)}
      >
        <span>{item.name}</span>
        {item.badge && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full px-1">
            {item.badge > 99 ? '99+' : item.badge}
          </span>
        )}
      </Link>
    );
  };

  const renderMobileLink = (item, indent = false) => {
    const current = isCurrentPath(pathname, item.href);
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={current ? 'page' : undefined}
        className={`flex items-center justify-between ${indent ? 'pl-6 pr-3' : 'px-3'} py-2 text-base font-medium rounded-lg hover:bg-gray-50 transition-colors duration-200 ${
          current ? 'text-gray-900 bg-gray-50' : 'text-gray-600 hover:text-gray-900'
        }`}
        onClick={() => setIsMobileMenuOpen(false)}
      >
        <span>{item.name}</span>
        {item.badge && (
          <span className="min-w-[18px] h-[18px] flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full px-1">
            {item.badge > 99 ? '99+' : item.badge}
          </span>
        )}
      </Link>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <Head>
        <title>{title}</title>
        <meta name="description" content={description} />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className={`${SHELL_WIDTH_CLASS} mx-auto px-4`}>
          <div className="flex justify-between items-center gap-4 py-3">
            {/* Desktop Navigation */}
            {showNavigation && (
              <nav aria-label="Main" className="hidden md:flex items-center gap-1 flex-1 min-w-0">
                {primaryItems.map(renderNavLink)}
                {toolItems.length > 0 && (
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => toggleMenu('tools')}
                      aria-haspopup="menu"
                      aria-expanded={showToolsMenu}
                      className={navLinkClass(toolsCurrent)}
                    >
                      <span>Tools</span>
                      <ChevronIcon open={showToolsMenu} />
                    </button>
                    {showToolsMenu && (
                      <div role="menu" className="absolute left-0 mt-2 w-72 bg-white rounded-xl shadow-lg border border-gray-200 z-50 py-2">
                        {toolItems.map((item) => {
                          const current = isCurrentPath(pathname, item.href);
                          return (
                            <Link
                              key={item.href}
                              href={item.href}
                              role="menuitem"
                              aria-current={current ? 'page' : undefined}
                              onClick={closeMenus}
                              className={`block px-4 py-2 text-sm transition-colors hover:bg-gray-50 ${
                                current ? 'font-semibold text-gray-900 bg-gray-50' : 'text-gray-600 hover:text-gray-900'
                              }`}
                            >
                              {item.name}
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
                {trailingItems.map(renderNavLink)}
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
                    onClick={() => toggleMenu('user')}
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
                    <ChevronIcon open={showUserMenu} />
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
                          href="/profile-settings"
                          onClick={closeMenus}
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
                            closeMenus();
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
                  onClick={() => toggleMenu('user')}
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
            <div className="md:hidden relative z-50 bg-white border-t border-gray-200 py-4">
              <div className="px-4 pb-3 border-b border-gray-100 mb-3">
                <div className="text-sm font-medium text-gray-900">{session.user.name}</div>
                <div className="text-xs text-gray-500">{session.user.email}</div>
              </div>
              <Link
                href="/profile-settings"
                onClick={closeMenus}
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
                  closeMenus();
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
              <nav aria-label="Main" className="space-y-1">
                {primaryItems.map((item) => renderMobileLink(item))}
                {toolItems.length > 0 && (
                  <div className="pt-2">
                    <div className="px-3 pb-1 text-sm font-semibold text-gray-500">Tools</div>
                    {toolItems.map((item) => renderMobileLink(item, true))}
                  </div>
                )}
                <div className="pt-2">
                  {trailingItems.map((item) => renderMobileLink(item))}
                </div>
              </nav>
            </div>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 pb-12">
        <div className={`${mainWidthClass} mx-auto px-4`}>
          {children}
        </div>
      </main>

      {/* Click outside handler for the open dropdown */}
      {openMenu && (
        <div
          className="fixed inset-0 z-40"
          onClick={closeMenus}
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
