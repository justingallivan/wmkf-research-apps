import { useEffect, useRef, useState } from 'react';
import { Button } from '../Layout';
import { requestJson } from '../../utils/api-request';

const endpoint = '/api/workbench/offramp';
const MAX = 2000;
const read = requestId => requestJson(endpoint + '?requestId=' + encodeURIComponent(requestId));

/**
 * Offramp status and justification on the Staff Deliberations tab (D69, D70).
 * The Workbench keys this by request ID. Renders nothing where the route is
 * switched off (404). `onStatusChange` reloads the request page after the
 * Phase II Status changes.
 */
export default function OfframpControl({ requestId, onStatusChange = null }) {
  const [record, setRecord] = useState(null);
  const [hidden, setHidden] = useState(false);
  const [draft, setDraftState] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  // Saved justification that changed under an unsaved draft; Save waits until staff choose.
  const [conflictText, setConflictText] = useState(null);
  const generation = useRef(0);
  // The draft as typed, and the saved text it was started from (null before the first read).
  // Refs, so a refresh that lands after an await compares against the latest values.
  const draftRef = useRef('');
  const baselineRef = useRef(null);

  function setDraft(value) {
    draftRef.current = value;
    setDraftState(value);
  }

  /**
   * Take a fresh read, whatever caused it. An untouched draft follows the saved
   * text. An edited draft is kept; if the saved text moved away from what the
   * draft started from (and from the draft), staff must choose before Save,
   * because the new version would otherwise let Save overwrite unseen text.
   */
  function adopt(updated) {
    const baseline = baselineRef.current;
    const mine = draftRef.current.trim();
    setRecord(updated);
    if (baseline === null || mine === baseline) setDraft(updated.justification);
    else if (updated.justification !== baseline && updated.justification !== mine) setConflictText(updated.justification);
    baselineRef.current = updated.justification;
  }

  async function load() {
    const current = ++generation.current;
    setBusy(true);
    try {
      const result = await read(requestId);
      if (generation.current !== current) return;
      adopt(result);
    } catch (failure) {
      if (generation.current !== current) return;
      if (failure.status === 404 && !record) setHidden(true);
      else setError(failure.message);
    } finally {
      if (generation.current === current) setBusy(false);
    }
  }

  useEffect(() => {
    load();
    return () => { generation.current += 1; };
    // Mount once for the keyed request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function post(body, doneMessage) {
    if (busy || !record?.version || (body.action === 'justification' && conflictText !== null)) return;
    const current = ++generation.current;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await requestJson(endpoint, { method: 'POST', body: { requestId, version: record.version, ...body } });
      if (generation.current !== current) return;
      setNotice(doneMessage);
      setConfirming(false);
      // The write consumed the version; read the new one before allowing another save.
      setRecord(previous => ({ ...previous, version: null }));
      if (body.action === 'justification') {
        // Our text is now the saved baseline; a different readback means another save landed after ours.
        setDraft(body.justification);
        baselineRef.current = body.justification;
      }
      const updated = await read(requestId);
      if (generation.current !== current) return;
      if (body.action === 'justification' && updated.justification !== body.justification) {
        setNotice('');
        setRecord(updated);
        setConflictText(updated.justification);
        baselineRef.current = updated.justification;
      } else adopt(updated);
      if (body.action !== 'justification') onStatusChange?.();
    } catch (failure) {
      if (generation.current !== current) return;
      setError(failure.message);
      setConfirming(false);
      if (failure.status === 409) {
        try {
          const updated = await read(requestId);
          if (generation.current === current) adopt(updated);
        } catch {
          if (generation.current === current) setRecord(previous => ({ ...previous, version: null }));
        }
      }
    } finally {
      if (generation.current === current) setBusy(false);
    }
  }

  if (hidden) return null;

  const trimmed = draft.trim();
  return (
    <section aria-labelledby="offramp-heading" className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
      <h3 id="offramp-heading" className="text-base font-semibold text-gray-900">Offramp</h3>
      {!record && busy && <p className="mt-2 text-sm text-gray-600" role="status">Loading offramp status…</p>}
      {record && (
        <div className="mt-2 space-y-3 text-sm">
          <p className="text-gray-700">
            Phase II Status: <span className="font-medium text-gray-900">{record.statusLabel || 'none'}</span>
          </p>
          {record.canOfframp && !confirming && (
            <Button size="sm" type="button" disabled={busy || !record.version} onClick={() => setConfirming(true)}>
              Mark as offramped
            </Button>
          )}
          {record.canOfframp && confirming && (
            <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-amber-900">
                An offramped request is not presented. Invitations, presentation scheduling and group review stop.
              </p>
              <Button size="sm" type="button" loading={busy} onClick={() => post({ action: 'offramp' }, 'Marked as offramped.')}>
                Confirm offramp
              </Button>
              {' '}
              <Button size="sm" type="button" variant="secondary" disabled={busy} onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          )}
          {record.canUndo && (
            <div>
              <Button size="sm" type="button" variant="secondary" loading={busy} disabled={!record.version}
                onClick={() => post({ action: 'undo' }, 'Offramp undone.')}>
                Undo offramp
              </Button>
              <p className="mt-1 text-gray-600">Phase II Status returns to {record.undoRestores}.</p>
            </div>
          )}
          {record.offramped && !record.canUndo && (
            <p className="text-gray-600">The earlier Phase II Status cannot be restored here. Change it in AkoyaGO.</p>
          )}
          {!record.offramped && !record.canOfframp && (
            <p className="text-gray-600">This request already has a Phase II outcome, so it cannot be offramped here.</p>
          )}
          {record.showJustification && (
            <form className="space-y-2" onSubmit={event => {
              event.preventDefault();
              if (trimmed !== record.justification) post({ action: 'justification', justification: trimmed }, 'Justification saved.');
            }}>
              <label htmlFor="offramp-justification" className="font-medium text-gray-900">Offramp justification</label>
              <p id="offramp-justification-guidance" className="text-gray-600">
                A short reason for the offramp, for example the reviews received.
              </p>
              <textarea id="offramp-justification" aria-describedby="offramp-justification-guidance"
                className="w-full rounded-lg border p-3" rows={4} maxLength={MAX}
                value={draft} disabled={busy} onChange={event => { setDraft(event.target.value); setNotice(''); }} />
              {conflictText !== null && (
                <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="font-medium text-amber-900">Someone else saved a different justification</p>
                  <p className="whitespace-pre-wrap text-gray-900">{conflictText || 'The saved justification was cleared.'}</p>
                  <Button size="sm" type="button" variant="secondary" onClick={() => setConflictText(null)}>Keep my draft</Button>
                  {' '}
                  <Button size="sm" type="button" variant="secondary" onClick={() => {
                    setDraft(conflictText);
                    setConflictText(null);
                  }}>Use saved justification</Button>
                </div>
              )}
              <Button size="sm" type="submit" loading={busy}
                disabled={!record.version || conflictText !== null || trimmed === record.justification}>
                Save justification
              </Button>
            </form>
          )}
        </div>
      )}
      {notice && <p className="mt-2 text-sm" role="status">{notice}</p>}
      {error && <p className="mt-2 text-sm text-red-700" role="alert">{error}</p>}
      {!busy && (!record || !record.version) && (
        <Button size="sm" type="button" onClick={() => load()}>Reload offramp status</Button>
      )}
    </section>
  );
}
