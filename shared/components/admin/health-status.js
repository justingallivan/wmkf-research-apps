export function StatusBadge({ status }) {
  const colors = {
    ok: 'bg-green-100 text-green-800',
    healthy: 'bg-green-100 text-green-800',
    error: 'bg-red-100 text-red-800',
    unhealthy: 'bg-red-100 text-red-800',
    warning: 'bg-yellow-100 text-yellow-800',
    degraded: 'bg-yellow-100 text-yellow-800',
    skipped: 'bg-gray-100 text-gray-600',
  };
  return (
    <span className={`inline-flex min-h-6 items-center px-2 py-0.5 rounded-full text-xs font-medium ${colors[status] || colors.skipped}`}>
      {status}
    </span>
  );
}

export const SERVICE_LABELS = {
  database: 'Database',
  claude: 'Claude API',
  azureAd: 'Azure AD (SSO)',
  dynamicsCrm: 'Dynamics CRM',
  encryption: 'Encryption Key',
  nextAuthUrl: 'NEXTAUTH_URL',
};

export function getFailingServices(services) {
  if (!services || typeof services !== 'object') return [];
  return Object.entries(services)
    .filter(([, svc]) => svc.status && svc.status !== 'ok' && svc.status !== 'skipped')
    .map(([key, svc]) => ({ key, label: SERVICE_LABELS[key] || key, ...svc }));
}
