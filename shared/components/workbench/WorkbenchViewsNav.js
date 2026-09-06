import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useRef } from 'react';

const VIEWS = [
  { key: 'requests', label: 'Request list', href: '/workbench' },
  { key: 'initial-assessments', label: 'Initial assessments', href: '/workbench/artifacts' },
  { key: 'reviewer-follow-up', label: 'Reviewer follow-up', href: '/workbench/reviewer-follow-up' },
  { key: 'final-writeups', label: 'Final writeups', href: '/workbench/final-writeups' },
  { key: 'awardees', label: 'Awardees', href: '/workbench/awardees' },
];

function withCycle(href, cycleCode) {
  if (!cycleCode || !['/workbench', '/workbench/artifacts', '/workbench/reviewer-follow-up', '/workbench/awardees'].includes(href)) {
    return href;
  }
  return `${href}?cycleCode=${encodeURIComponent(cycleCode)}`;
}

function inferActiveKey(pathname) {
  if (pathname === '/workbench') return 'requests';
  if (pathname.startsWith('/workbench/artifacts')) return 'initial-assessments';
  if (pathname.startsWith('/workbench/reviewer-follow-up')) return 'reviewer-follow-up';
  if (pathname.startsWith('/workbench/final-writeups')) return 'final-writeups';
  if (pathname.startsWith('/workbench/awardees')) return 'awardees';
  return null;
}

export default function WorkbenchViewsNav({ activeKey, cycleCode, counts = {} }) {
  const router = useRouter();
  const resolvedActiveKey = activeKey || inferActiveKey(router.pathname);
  const scrollerRef = useRef(null);

  useEffect(() => {
    const scroller = scrollerRef.current;
    const activeLink = scroller?.querySelector('[aria-current="page"]');
    if (!scroller || !activeLink || scroller.scrollWidth <= scroller.clientWidth) return;
    scroller.scrollLeft = Math.max(
      0,
      activeLink.offsetLeft - (scroller.clientWidth - activeLink.offsetWidth) / 2,
    );
  }, [resolvedActiveKey]);

  return (
    <nav ref={scrollerRef} aria-label="Workbench views" className="mb-6 overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex min-w-max items-stretch p-1.5">
        {VIEWS.filter((view) => !(view.key === 'initial-assessments' && cycleCode === 'D26')).map((view) => {
          const active = resolvedActiveKey === view.key;
          const count = counts[view.key];
          return (
            <Link
              key={view.key}
              href={withCycle(view.href, cycleCode)}
              aria-current={active ? 'page' : undefined}
              className={`inline-flex min-h-11 items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-1 ${
                active
                  ? 'bg-gray-900 text-white'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              }`}
            >
              {view.label}
              {Number.isFinite(count) && (
                <span
                  className={`inline-flex min-w-6 items-center justify-center rounded-full px-1.5 py-0.5 text-xs tabular-nums ${
                    active ? 'bg-amber-100 text-amber-900' : 'bg-amber-50 text-amber-900'
                  }`}
                >
                  {count}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
