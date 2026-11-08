import { useRef, useState } from 'react';
import { Card } from '../Layout';
import { FIRST_CUT_STATUS, isFirstCutEditable } from '../../config/j27FirstCut';
import { requestJson } from '../../utils/api-request';

export default function FirstCutCard({ context, canManage, refresh }) {
  const [pendingDecision, setPendingDecision] = useState('');
  const saveInFlight = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const { requestId, requestVersion, phaseIStatus, phaseIStatusLabel } = context;
  const current = phaseIStatus === FIRST_CUT_STATUS.yes ? 'yes'
    : phaseIStatus === FIRST_CUT_STATUS.no ? 'no' : '';
  const editable = isFirstCutEditable(phaseIStatus);

  async function save(decision) {
    if (saveInFlight.current || (decision !== 'yes' && decision !== 'no')
      || decision === current || !canManage || !editable || !requestVersion) return;
    saveInFlight.current = true;
    setPendingDecision(decision);
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      await requestJson('/api/workbench/first-cut', {
        method: 'POST',
        body: { requestId, decision, version: requestVersion },
        fallbackMessage: 'Could not save First Cut.',
      });
      setSaved(true);
    } catch (failure) {
      setPendingDecision('');
      setError(failure.status === 409
        ? 'The request changed. Review the refreshed status before saving again.'
        : failure.message);
    } finally {
      // Keep the selector locked until the refreshed request version is available.
      try {
        await refresh();
      } finally {
        setPendingDecision('');
        setSaving(false);
        saveInFlight.current = false;
      }
    }
  }

  return (
    <Card hover={false} className="mb-4">
      <h2 className="text-base font-semibold text-gray-900">First Cut</h2>
      <p className="mt-1 text-sm text-gray-600">
        Phase I status: {phaseIStatusLabel || (phaseIStatus === null ? 'Not set' : 'Unavailable')}
      </p>
      {canManage && editable && requestVersion ? (
        <label className="mt-3 flex w-fit flex-col gap-1 text-sm font-medium text-gray-900">
          First Cut decision
          <select
            className="min-h-10 rounded-lg border border-gray-300 bg-white px-3"
            value={pendingDecision || current}
            disabled={saving}
            onChange={(event) => save(event.target.value)}
          >
            <option value="" disabled>Select a decision</option>
            <option value="yes">Yes — Scored</option>
            <option value="no">No — Not Scored</option>
          </select>
        </label>
      ) : <p className="mt-2 text-sm text-gray-600">First Cut is read-only.</p>}
      {(saving || saved) && (
        <p role="status" className="mt-2 text-sm text-gray-700">
          {saving ? 'Saving First Cut…' : 'First Cut saved.'}
        </p>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    </Card>
  );
}
