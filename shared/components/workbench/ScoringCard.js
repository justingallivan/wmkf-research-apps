import { useRef, useState } from 'react';
import { Card } from '../Layout';
import { SCORING_STATUS, isScoringEditable, hasChairsRecommendation, CHAIRS_RECOMMENDATION_STATUS, isChairsRecommendationEditable } from '../../config/j27Scoring';
import { requestJson } from '../../utils/api-request';

export default function ScoringCard({ context, canManage, refresh, chairsRecommendation = false, automaticIntegrityEnabled = false, previewReadOnly = false }) {
  const [pendingDecision, setPendingDecision] = useState('');
  const saveInFlight = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [screenUnconfirmed, setScreenUnconfirmed] = useState(false);
  const { requestId, requestVersion, phaseIStatus, phaseIStatusLabel } = context;
  const title = chairsRecommendation ? 'Recommendation to Chairs' : 'Scoring';
  const saveFailed = chairsRecommendation ? 'Could not save the recommendation to Chairs.' : 'Could not save the scoring decision.';
  const choices = chairsRecommendation ? CHAIRS_RECOMMENDATION_STATUS : SCORING_STATUS;
  const current = phaseIStatus === choices.yes ? 'yes' : phaseIStatus === choices.no ? 'no' : '';
  const editable = chairsRecommendation ? isChairsRecommendationEditable(phaseIStatus) : isScoringEditable(phaseIStatus);
  const recommendationRecorded = !chairsRecommendation && hasChairsRecommendation(phaseIStatus);

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
      const result = await requestJson('/api/workbench/scoring', {
        method: 'POST',
        body: { requestId, decision, version: requestVersion, ...(chairsRecommendation && { stage: 'chairs-recommendation' }) },
        fallbackMessage: saveFailed,
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
      {!chairsRecommendation && (
        <p className="mt-1 text-sm text-gray-600">
          {recommendationRecorded ? 'Scoring is closed.' : <>Status: {phaseIStatusLabel || (phaseIStatus === null ? 'Not set' : 'Unavailable')}</>}
        </p>
      )}
      {chairsRecommendation && automaticIntegrityEnabled && !current && (
        <p className="mt-1 text-sm text-gray-600">Saving Recommended Invite schedules an Integrity Screen in the background.</p>
      )}
      {canManage && editable && requestVersion ? (
        <label className="mt-3 flex w-fit flex-col gap-1 text-sm font-medium text-gray-900">
          {chairsRecommendation ? 'Recommendation' : 'Scoring decision'}
          <select
            className="min-h-10 rounded-lg border border-gray-300 bg-white px-3"
            value={pendingDecision || current}
            disabled={saving}
            onChange={(event) => save(event.target.value)}
          >
            <option value="" disabled>Select a decision</option>
            <option value="yes">{chairsRecommendation ? 'Recommended Invite' : 'Scored'}</option>
            <option value="no">{chairsRecommendation ? 'Recommended Do Not Invite' : 'Not Scored'}</option>
          </select>
        </label>
      ) : !recommendationRecorded && (
        <p className="mt-2 text-sm text-gray-600">
          {chairsRecommendation ? (current === 'yes' ? 'Recommended Invite' : current === 'no' ? 'Recommended Do Not Invite' : 'Decision pending') : previewReadOnly ? 'Scoring is read-only on Preview.'
              // Say why only when authority is the one thing missing (staff flow audit, finding 6).
              : editable && requestVersion && !canManage ? 'Scoring is read-only. Only the lead Program Director or a superuser can record it.'
                : 'Scoring is read-only.'}
        </p>
      )}
      {(saving || saved) && (
        <p role="status" className="mt-2 text-sm text-gray-700">
          {saving ? `Saving ${title}…` : chairsRecommendation ? 'Recommendation saved.' : 'Scoring saved.'}
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
