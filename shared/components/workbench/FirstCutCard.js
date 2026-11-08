import { useRef, useState } from 'react';
import { Card } from '../Layout';
import { FIRST_CUT_STATUS, isFirstCutEditable, hasSemiFinalistRecommendation, SEMI_FINALIST_STATUS, isSemiFinalistEditable } from '../../config/j27FirstCut';
import { requestJson } from '../../utils/api-request';

export default function FirstCutCard({ context, canManage, refresh, semiFinalist = false, automaticIntegrityEnabled = false }) {
  const [pendingDecision, setPendingDecision] = useState('');
  const saveInFlight = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [screenUnconfirmed, setScreenUnconfirmed] = useState(false);
  const { requestId, requestVersion, phaseIStatus, phaseIStatusLabel } = context;
  const title = semiFinalist ? 'Semi-finalist recommendation' : 'First Cut';
  const choices = semiFinalist ? SEMI_FINALIST_STATUS : FIRST_CUT_STATUS;
  const current = phaseIStatus === choices.yes ? 'yes' : phaseIStatus === choices.no ? 'no' : '';
  const editable = semiFinalist ? isSemiFinalistEditable(phaseIStatus) : isFirstCutEditable(phaseIStatus);
  const recommendationRecorded = !semiFinalist && hasSemiFinalistRecommendation(phaseIStatus);

  async function save(decision) {
    if (saveInFlight.current || (decision !== 'yes' && decision !== 'no')
      || decision === current || !canManage || !editable || !requestVersion) return;
    saveInFlight.current = true;
    setPendingDecision(decision);
    setSaving(true);
    setError('');
    setSaved(false);
    setScreenUnconfirmed(false);
    try {
      const result = await requestJson('/api/workbench/first-cut', {
        method: 'POST',
        body: { requestId, decision, version: requestVersion, ...(semiFinalist && { stage: 'semi-finalist' }) },
        fallbackMessage: `Could not save the ${title}.`,
      });
      setSaved(true);
      setScreenUnconfirmed(result?.automaticScreen === 'unconfirmed');
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
      <h2 className="text-base font-semibold text-gray-900">{title}</h2>
      {!semiFinalist && (
        <p className="mt-1 text-sm text-gray-600">
          {recommendationRecorded ? 'First Cut is closed.' : <>Phase I status: {phaseIStatusLabel || (phaseIStatus === null ? 'Not set' : 'Unavailable')}</>}
        </p>
      )}
      {semiFinalist && automaticIntegrityEnabled && !current && (
        <p className="mt-1 text-sm text-gray-600">Saving Yes schedules an Integrity Screen in the background.</p>
      )}
      {canManage && editable && requestVersion ? (
        <label className="mt-3 flex w-fit flex-col gap-1 text-sm font-medium text-gray-900">
          {semiFinalist ? 'Recommend as a semi-finalist?' : 'First Cut decision'}
          <select
            className="min-h-10 rounded-lg border border-gray-300 bg-white px-3"
            value={pendingDecision || current}
            disabled={saving}
            onChange={(event) => save(event.target.value)}
          >
            <option value="" disabled>Select a decision</option>
            <option value="yes">{semiFinalist ? 'Yes' : 'Yes — Scored'}</option>
            <option value="no">{semiFinalist ? 'No' : 'No — Not Scored'}</option>
          </select>
        </label>
      ) : !recommendationRecorded && (
        <p className="mt-2 text-sm text-gray-600">
          {semiFinalist ? (current === 'yes' ? 'Yes' : current === 'no' ? 'No' : 'Decision pending') : 'First Cut is read-only.'}
        </p>
      )}
      {(saving || saved) && (
        <p role="status" className="mt-2 text-sm text-gray-700">
          {saving ? `Saving ${title}…` : semiFinalist ? 'Recommendation saved.' : 'First Cut saved.'}
        </p>
      )}
      {screenUnconfirmed && (
        <p className="mt-2 text-sm text-amber-800" role="alert">
          Recommendation saved. The automatic Integrity Screen could not be confirmed. Check its status in Integrity.
        </p>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    </Card>
  );
}
