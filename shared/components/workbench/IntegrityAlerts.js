import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAppAccess } from '../../context/AppAccessContext';
import { requestEnvelope } from '../../utils/api-request';

export default function IntegrityAlerts() {
  const { hasAccess } = useAppAccess();
  return hasAccess('integrity-screener') === true ? <LeadPdAlerts /> : null;
}

function LeadPdAlerts() {
  const [alerts, setAlerts] = useState([]);

  useEffect(() => {
    let active = true;
    let pending;
    async function refresh() {
      pending?.abort();
      const controller = new AbortController();
      pending = controller;
      try {
        const { ok, data } = await requestEnvelope('/api/workbench/integrity-alerts', {
          signal: controller.signal, tolerantBody: true,
        });
        if (active && !controller.signal.aborted && ok && Array.isArray(data?.alerts)) setAlerts(data.alerts);
      } catch {
        // Keep any previously loaded alerts during a transient connection failure.
      }
    }
    refresh();
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, 60_000);
    window.addEventListener('focus', refresh);
    return () => {
      active = false;
      pending?.abort();
      clearInterval(interval);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  if (!alerts.length) return null;
  return (
    <section aria-labelledby="integrity-alerts-heading" className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
      <h2 id="integrity-alerts-heading" className="text-base font-semibold">Integrity findings to review</h2>
      <ul className="mt-2 space-y-1">
        {alerts.map(({ requestId, number, title }) => (
          <li key={requestId}>
            <Link className="font-medium underline underline-offset-2"
              href={`/workbench/${encodeURIComponent(requestId)}?tab=initial-assessment&section=integrity`}>
              {number ? `#${number} · ` : ''}{title || 'Open integrity findings'}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
