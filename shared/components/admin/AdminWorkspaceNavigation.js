import Link from 'next/link';
import { Card } from '../Layout';
import DataverseFieldInfoButton from './DataverseFieldInfoButton';

export const ADMIN_WORKSPACES = Object.freeze([
  {
    key: 'overview',
    label: 'Overview',
    title: 'Administration overview',
    description: 'Current exceptions and direct routes to the work that needs attention.',
    defaultView: 'summary',
    views: [{ key: 'summary', label: 'Summary' }],
  },
  {
    key: 'operations',
    label: 'Operations',
    title: 'System operations',
    description: 'Service health, incidents, maintenance, credentials, notifications, and product feedback.',
    defaultView: 'health',
    views: [
      { key: 'health', label: 'Health' },
      { key: 'incidents', label: 'Incidents' },
      { key: 'jobs', label: 'Jobs & retention' },
      { key: 'credentials', label: 'Credentials' },
      { key: 'notifications', label: 'Notifications' },
      { key: 'feedback', label: 'Feedback & quality' },
      { key: 'dynamics-safeguards', label: 'Dynamics safeguards' },
    ],
  },
  {
    key: 'workflows',
    label: 'Workflows',
    title: 'Grant workflow configuration',
    description: 'Settings organized around external review, Final Writeups, Site Visits, and governed workflow content.',
    defaultView: 'external-review',
    views: [
      { key: 'external-review', label: 'External review' },
      { key: 'review-form', label: 'Review form' },
      { key: 'final-writeups', label: 'Final Writeups' },
      { key: 'site-visits', label: 'Site Visits' },
      { key: 'governance', label: 'Messages & policies' },
    ],
  },
  {
    key: 'ai',
    label: 'AI',
    title: 'AI administration',
    description: 'Usage, model routing, versioned prompts, and execution budgets.',
    defaultView: 'usage',
    views: [
      { key: 'usage', label: 'Usage' },
      { key: 'models', label: 'Models' },
      { key: 'prompts', label: 'Prompts & budgets' },
    ],
  },
  {
    key: 'people',
    label: 'People & Access',
    title: 'People and access',
    description: 'Internal roles, application access, account lifecycle, and Dataverse identity linkage.',
    defaultView: 'roles',
    views: [
      { key: 'roles', label: 'Users & roles' },
      { key: 'app-access', label: 'App access' },
      { key: 'identity', label: 'Identity linkage' },
    ],
  },
]);

const WORKSPACE_BY_KEY = new Map(ADMIN_WORKSPACES.map((workspace) => [workspace.key, workspace]));

export const LEGACY_ADMIN_HASH_LOCATIONS = Object.freeze({
  '#system-alerts': { workspace: 'operations', view: 'incidents' },
  '#final-writeup-matrix-audiences': { workspace: 'workflows', view: 'final-writeups' },
});

export function resolveAdminLocation(rawWorkspace, rawView) {
  const workspace = WORKSPACE_BY_KEY.get(rawWorkspace) || WORKSPACE_BY_KEY.get('overview');
  const view = workspace.views.some((candidate) => candidate.key === rawView)
    ? rawView
    : workspace.defaultView;
  return { workspace, view };
}

export function adminLocationForHash(hash) {
  return LEGACY_ADMIN_HASH_LOCATIONS[hash] || null;
}

export function adminHref(workspaceKey, viewKey) {
  const { workspace, view } = resolveAdminLocation(workspaceKey, viewKey);
  if (workspace.key === 'overview') return '/admin';
  const params = new URLSearchParams({ workspace: workspace.key, view });
  return `/admin?${params.toString()}`;
}

export function AdminWorkspaceNavigation({ activeWorkspace }) {
  return (
    <nav aria-label="Admin workspaces" className="border-b border-gray-200">
      <div className="flex min-w-max gap-6 overflow-x-auto">
        {ADMIN_WORKSPACES.map((workspace) => {
          const active = workspace.key === activeWorkspace;
          return (
            <Link
              key={workspace.key}
              href={adminHref(workspace.key, workspace.defaultView)}
              scroll={false}
              aria-current={active ? 'page' : undefined}
              className={`min-h-11 border-b-2 px-1 py-3 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2 ${
                active
                  ? 'border-gray-900 text-gray-950'
                  : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-900'
              }`}
            >
              {workspace.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export function AdminViewNavigation({ workspace, activeView }) {
  if (workspace.views.length < 2) return null;
  return (
    <nav aria-label={`${workspace.label} sections`} className="overflow-x-auto">
      <div className="flex min-w-max gap-2">
        {workspace.views.map((view) => {
          const active = view.key === activeView;
          return (
            <Link
              key={view.key}
              href={adminHref(workspace.key, view.key)}
              scroll={false}
              aria-current={active ? 'page' : undefined}
              className={`inline-flex min-h-11 items-center rounded-lg px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2 ${
                active
                  ? 'bg-gray-900 text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-100 hover:text-gray-950'
              }`}
            >
              {view.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export function AdminWorkspaceHeader({ workspace }) {
  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight text-gray-950 sm:text-3xl">
        {workspace.title}
      </h1>
      <p className="mt-2 text-sm leading-6 text-gray-600 sm:text-base">
        {workspace.description}
      </p>
    </div>
  );
}

export function SettingScopeBadge({ children }) {
  if (!children) return null;
  return (
    <span className="inline-flex min-h-6 items-center rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-semibold text-gray-600">
      {children}
    </span>
  );
}

export function AdminEditorPanel({
  id,
  title,
  description,
  scope,
  dataverseFields = [],
  children,
}) {
  return (
    <div id={id} className="scroll-mt-6">
      <Card hover={false} padding="p-0">
        <section aria-labelledby={`${id}-title`}>
          <div className="flex flex-col gap-3 border-b border-gray-200 px-5 py-5 sm:flex-row sm:items-start sm:justify-between sm:px-6">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id={`${id}-title`} className="text-lg font-semibold text-gray-950">{title}</h2>
                <SettingScopeBadge>{scope}</SettingScopeBadge>
              </div>
              {description && <p className="mt-1 max-w-3xl text-sm leading-6 text-gray-600">{description}</p>}
            </div>
            <DataverseFieldInfoButton items={dataverseFields} />
          </div>
          <div className="px-5 py-5 sm:px-6">{children}</div>
        </section>
      </Card>
    </div>
  );
}
