/**
 * Staff compose page for proposal list links
 * (docs/plans/J27_PROPOSAL_LIST_EMAILS_PLAN_2026-11-18.md).
 *
 * Staff choose a cycle, give a Board member a personal list link, choose the
 * proposals to highlight for that person, and copy or preview the link. A
 * `test` list holds Factory test requests only and always belongs to the
 * signed-in staff member. Every mutation is re-checked by the server; this
 * page only mirrors those rules.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { Button, Card, PageHeader } from '../Layout';
import { requestJson } from '../../utils/api-request';
import { conventionalCycles } from '../../../lib/utils/cycle-code';

const API = '/api/workbench/proposal-lists';
const KIND_LABEL = { ordinary: 'Scored proposals', test: 'Test requests (for checking the page)' };

function formatDay(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' });
}

function CopyLinkButton({ url }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? 'Copied' : 'Copy link'}
    </Button>
  );
}

function ListEditor({ linkId, onChanged }) {
  const [detail, setDetail] = useState(null);
  const [highlighted, setHighlighted] = useState(new Set());
  const [own, setOwn] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  const adopt = useCallback((data) => {
    setDetail(data);
    setHighlighted(new Set(data.items.filter((item) => item.highlighted).map((item) => item.requestId)));
    setOwn(new Set(data.items.filter((item) => item.ownInstitution).map((item) => item.requestId)));
  }, []);

  useEffect(() => {
    let cancelled = false;
    requestJson(`${API}?linkId=${encodeURIComponent(linkId)}`)
      .then((data) => { if (!cancelled) adopt(data); })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [linkId, adopt]);

  const sections = useMemo(() => {
    const map = new Map();
    for (const item of detail?.items || []) {
      if (!map.has(item.section)) map.set(item.section, []);
      map.get(item.section).push(item);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [detail]);

  const toggle = (set, setter, id) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    setter(next);
    setSaved(false);
  };

  const run = async (body, after) => {
    setBusy(true);
    setError(null);
    try {
      const data = await requestJson(API, { method: 'POST', body: { ...body, linkId } });
      after(data);
      onChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (error && !detail) return <p className="mt-3 text-sm text-red-700">{error}</p>;
  if (!detail) return <p className="mt-3 text-sm text-gray-500">Loading the list…</p>;

  return (
    <div className="mt-4 border-t border-gray-200 pt-4">
      <p className="text-sm text-gray-700">
        Tick <span className="font-medium">Highlight</span> for the proposals you want {detail.link.recipientName}’s view on.
        They appear at the top of the page. Every other proposal stays available below.
        Tick <span className="font-medium">Own institution</span> to mark a proposal from this person’s institution.
      </p>
      <div className="mt-3 space-y-2">
        {sections.map(([name, items]) => (
          <details key={name} className="rounded-lg border border-gray-200">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-gray-900">
              {name} <span className="font-normal text-gray-500">({items.length})</span>
            </summary>
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-1 font-medium">Highlight</th>
                  <th className="px-3 py-1 font-medium">Own institution</th>
                  <th className="px-3 py-1 font-medium">Proposal</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.requestId} className="border-t border-gray-100 align-top">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label={`Highlight ${item.title}`}
                        checked={highlighted.has(item.requestId)}
                        onChange={() => toggle(highlighted, setHighlighted, item.requestId)}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label={`Own institution: ${item.title}`}
                        checked={own.has(item.requestId)}
                        onChange={() => toggle(own, setOwn, item.requestId)}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <span className="font-medium text-gray-900">{item.title}</span>
                      <span className="block text-gray-600">
                        {[item.requestNumber, item.institution, item.projectLeader, item.subsection].filter(Boolean).join(' · ')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        ))}
      </div>
      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          loading={busy}
          onClick={() => run(
            { action: 'marks', highlightedRequestIds: [...highlighted], ownInstitutionRequestIds: [...own] },
            (data) => { adopt(data); setSaved(true); },
          )}
        >
          Save marks
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={() => run({ action: 'rebuild' }, (data) => { adopt(data); setSaved(false); })}
        >
          Refresh proposals from the cycle
        </Button>
        {saved && <span className="text-sm text-green-700">Saved.</span>}
      </div>
      <p className="mt-2 text-xs text-gray-500">
        Refreshing re-reads the cycle’s proposals. The link stays the same and your saved marks are kept.
      </p>
    </div>
  );
}

export default function ProposalLists() {
  const router = useRouter();
  const cycles = useMemo(() => conventionalCycles(), []);
  const queryCycle = typeof router.query.cycle === 'string' && /^[JD]\d{2}$/.test(router.query.cycle) ? router.query.cycle : null;
  const [pickedCycle, setPickedCycle] = useState(null);
  const cycle = pickedCycle ?? queryCycle ?? '';
  const [kind, setKind] = useState('ordinary');
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [rosterId, setRosterId] = useState('');
  const [openLinkId, setOpenLinkId] = useState(null);
  const [confirmRevoke, setConfirmRevoke] = useState(null);

  // Only the newest read may paint: a slower answer for a cycle or list type
  // the page has already left is dropped.
  const readSeq = useRef(0);
  const load = useCallback(async (signal) => {
    if (!cycle) return;
    const seq = ++readSeq.current;
    setError(null);
    try {
      const data = await requestJson(`${API}?cycle=${encodeURIComponent(cycle)}&kind=${encodeURIComponent(kind)}`, { signal });
      if (seq === readSeq.current) setOverview(data.overview);
    } catch (e) {
      if (e?.name === 'AbortError' || seq !== readSeq.current) return;
      setOverview(null);
      setError(e.message);
    }
  }, [cycle, kind]);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // A create, revoke or mark save can finish after staff have moved to another
  // cycle or list type. Its follow-up read must be for what the page shows now,
  // not for the selection the action started under.
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; }, [load]);
  const reloadCurrent = useCallback(() => loadRef.current(), []);

  // A new cycle or list type starts from a clean page before its read lands.
  const resetFor = (apply) => {
    setOverview(null);
    setError(null);
    setOpenLinkId(null);
    setConfirmRevoke(null);
    setRosterId('');
    apply();
  };

  const post = async (body) => {
    setBusy(true);
    setError(null);
    try {
      const data = await requestJson(API, { method: 'POST', body });
      await reloadCurrent();
      return data;
    } catch (e) {
      setError(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const linkedEmails = new Set((overview?.links || []).map((link) => link.recipientEmail));
  const available = (overview?.recipients || []).filter((row) => row.email && !linkedEmails.has(row.email));
  const noEmail = (overview?.recipients || []).filter((row) => !row.email);
  const selfHasLink = overview?.self?.email && linkedEmails.has(overview.self.email);
  const until = formatDay(overview?.expiresAt);

  return (
    <div className="space-y-6">
      <PageHeader title="Proposal lists" subtitle="Personal links to the scored proposals for Program Chairs and Board members." />
      <Card hover={false}>
        <p className="text-sm text-gray-700">
          Give a Board member a personal link to a page listing every scored proposal in a cycle.
          Proposals staff ticked for that person during Scoring start out highlighted.
          Each title opens that proposal’s staff version. No login is needed, so treat a link like the proposals themselves.
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-4">
          <label className="text-sm font-medium text-gray-800">
            Cycle
            <select
              className="mt-1 block rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
              value={cycle}
              onChange={(e) => resetFor(() => setPickedCycle(e.target.value))}
            >
              <option value="">Choose a cycle</option>
              {[...new Set([...(queryCycle ? [queryCycle] : []), ...cycles])].map((code) => (
                <option key={code} value={code}>{code}</option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium text-gray-800">
            List
            <select
              className="mt-1 block rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
              value={kind}
              onChange={(e) => resetFor(() => setKind(e.target.value))}
            >
              {Object.entries(KIND_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </div>
        {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
      </Card>

      {cycle && overview && (
        <>
          {overview.sectionSource?.placeholder && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              Sections on the page are a stand-in. {overview.sectionSource.label}
            </div>
          )}
          <Card hover={false}>
            <h2 className="text-base font-semibold text-gray-900">New list</h2>
            {!overview.meetingDate ? (
              <p className="mt-2 text-sm text-gray-700">
                {cycle} has no Board meeting date. Links end on the Board meeting date, so set it on the cycle calendar first.
              </p>
            ) : (
              <>
                <p className="mt-1 text-sm text-gray-600">Links for {cycle} stay active through {until}, the Board meeting date.</p>
                {kind === 'test' ? (
                  <div className="mt-3">
                    <p className="text-sm text-gray-700">
                      A test list holds test requests only and is addressed to you{overview.self?.email ? ` (${overview.self.email})` : ''}.
                    </p>
                    <Button className="mt-3" size="sm" loading={busy} disabled={Boolean(selfHasLink)} onClick={() => post({ action: 'create', cycle, kind })}>
                      {selfHasLink ? 'You already have a test list' : 'Create my test list'}
                    </Button>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-wrap items-end gap-3">
                    <label className="text-sm font-medium text-gray-800">
                      Board member
                      <select
                        className="mt-1 block rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
                        value={rosterId}
                        onChange={(e) => setRosterId(e.target.value)}
                      >
                        <option value="">Choose a Board member</option>
                        {available.map((row) => <option key={row.rosterId} value={row.rosterId}>{row.name}</option>)}
                      </select>
                    </label>
                    <Button
                      size="sm"
                      loading={busy}
                      disabled={!rosterId}
                      onClick={async () => { if (await post({ action: 'create', cycle, kind, rosterId: Number(rosterId) })) setRosterId(''); }}
                    >
                      Create list
                    </Button>
                  </div>
                )}
                {kind === 'ordinary' && noEmail.length > 0 && (
                  <p className="mt-3 text-xs text-gray-500">
                    No email address on the roster, so not offered: {noEmail.map((row) => row.name).join(', ')}.
                  </p>
                )}
              </>
            )}
          </Card>

          <Card hover={false}>
            <h2 className="text-base font-semibold text-gray-900">Lists for {cycle}</h2>
            {overview.links.length === 0 && <p className="mt-2 text-sm text-gray-600">No lists yet.</p>}
            <ul className="mt-2 divide-y divide-gray-100">
              {overview.links.map((link) => (
                <li key={link.id} className="py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-gray-900">{link.recipientName}</p>
                      <p className="text-sm text-gray-600">
                        {link.recipientEmail} · {link.itemCount} proposal{link.itemCount === 1 ? '' : 's'} · {link.highlightedCount} highlighted
                      </p>
                      <p className="text-sm text-gray-600">
                        {link.expired ? 'Link has ended' : `Active through ${formatDay(link.expiresAt)}`}
                      </p>
                      {link.unreadable && (
                        <p className="mt-1 text-sm text-amber-800">
                          This link can no longer be copied. Switch it off and create a new list.
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {link.url && <CopyLinkButton url={link.url} />}
                      {link.url && (
                        <a
                          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-800"
                          href={link.url}
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          Open the page
                        </a>
                      )}
                      <Button variant="secondary" size="sm" onClick={() => setOpenLinkId(openLinkId === link.id ? null : link.id)}>
                        {openLinkId === link.id ? 'Close' : 'Choose highlights'}
                      </Button>
                      <Button variant="link" disabled={busy} onClick={() => setConfirmRevoke(link.id)}>Switch off</Button>
                    </div>
                  </div>
                  {confirmRevoke === link.id && (
                    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                      <p>
                        Switch off {link.recipientName}’s link? The page and every proposal on it stop opening for them.
                        This cannot be undone; you would create a new list with a new link.
                      </p>
                      <div className="mt-2 flex gap-2">
                        <Button
                          variant="danger"
                          size="sm"
                          loading={busy}
                          onClick={async () => {
                            await post({ action: 'revoke', linkId: link.id });
                            setConfirmRevoke(null);
                            if (openLinkId === link.id) setOpenLinkId(null);
                          }}
                        >
                          Switch off link
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => setConfirmRevoke(null)}>Keep link</Button>
                      </div>
                    </div>
                  )}
                  {openLinkId === link.id && <ListEditor key={link.id} linkId={link.id} onChanged={reloadCurrent} />}
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
      {cycle && !overview && !error && <p className="text-sm text-gray-500">Loading…</p>}
    </div>
  );
}
