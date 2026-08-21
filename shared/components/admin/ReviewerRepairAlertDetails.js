import { useEffect, useState } from 'react';

function fallbackContext(alert) {
  const metadata = alert?.metadata && typeof alert.metadata === 'object' ? alert.metadata : {};
  const requestId = typeof metadata.requestId === 'string' ? metadata.requestId : null;
  const candidateKey = typeof metadata.candidateKey === 'string' ? metadata.candidateKey : null;
  const suggestionId = typeof metadata.suggestionId === 'string' ? metadata.suggestionId : null;
  const inviteSurface = metadata.repairSurface === 'invite'
    || (
      metadata.repairSurface !== 'find'
      && !!suggestionId
      && candidateKey?.startsWith('suggestion:')
    );
  return {
    request: { id: requestId, number: null, title: null },
    reviewer: {
      candidateKey,
      name: metadata.candidateName || null,
      affiliation: null,
    },
    issue: {
      code: metadata.code || 'unknown',
      status: 'repair_required',
      storedEmail: null,
      foundEmail: null,
      source: null,
      detectedAt: null,
      recommendedAction: 'use_primary_action',
    },
    evidenceLinks: [],
    warnings: ['current_context_unavailable'],
    workbenchSurface: inviteSurface ? 'invite' : 'find',
    workbenchUrl: requestId
      ? inviteSurface
        ? `/workbench/${encodeURIComponent(requestId)}?tab=reviewers&sub=candidates&repairSuggestion=${encodeURIComponent(suggestionId)}`
        : `/workbench/${encodeURIComponent(requestId)}?tab=reviewers&sub=find${candidateKey ? `&repairCandidate=${encodeURIComponent(candidateKey)}` : ''}`
      : null,
  };
}

function AddressValue({ label, value }) {
  return (
    <div className="rounded border border-gray-200 bg-white/70 p-2">
      <div className="text-[10px] font-medium uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-0.5 break-all font-mono text-xs text-gray-900">{value || 'Not available'}</div>
    </div>
  );
}

export default function ReviewerRepairAlertDetails({ alert }) {
  const [remote, setRemote] = useState({ alertId: alert.id, loading: true, context: null, error: null });

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/admin/alerts?repairContext=${encodeURIComponent(alert.id)}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok || !body.context) {
          throw new Error(body.error || `Could not load repair context (${response.status})`);
        }
        return body.context;
      })
      .then((context) => setRemote({ alertId: alert.id, loading: false, context, error: null }))
      .catch((error) => {
        if (error.name !== 'AbortError') {
          setRemote({ alertId: alert.id, loading: false, context: null, error: error.message });
        }
      });
    return () => controller.abort();
  }, [alert.id]);

  const currentRemote = remote.alertId === alert.id
    ? remote
    : { loading: true, context: null, error: null };
  const context = currentRemote.context || fallbackContext(alert);
  const requestLabel = context.request.number
    ? `Request ${context.request.number}`
    : context.request.id
      ? `Request ${context.request.id}`
      : 'Unknown request';
  const evidenceLinks = Array.isArray(context.evidenceLinks) ? context.evidenceLinks : [];
  const contextWarnings = Array.isArray(context.warnings) ? context.warnings : [];
  const isAddressConflict = context.issue.status === 'conflict_pending';
  const isReadyToClose = context.issue.status === 'ready_to_close';
  const isInviteSurface = context.workbenchSurface === 'invite';
  const recommendedAction = context.issue.recommendedAction;

  return (
    <div className="mt-2 space-y-3 text-xs text-gray-700">
      <div className="rounded-lg border border-amber-200 bg-white/70 p-3 space-y-2">
        <div>
          <div className="font-semibold text-gray-900">{requestLabel}</div>
          {context.request.title && <div className="mt-0.5 text-gray-600">{context.request.title}</div>}
        </div>

        <div>
          <span className="font-medium text-gray-900">Reviewer: </span>
          {context.reviewer.name || 'Name unavailable'}
          {context.reviewer.affiliation ? ` · ${context.reviewer.affiliation}` : ''}
        </div>

        <p>
          {isReadyToClose
            ? 'The current reviewer record no longer shows this address conflict. This alert is ready for an administrator to close after a final check.'
            : isAddressConflict
            ? 'This reviewer remains blocked because the stored address and newly found address need staff review. Creating this alert did not change either address.'
            : 'This reviewer remains blocked because the underlying identity or address record needs repair. Creating this alert did not change the reviewer record.'}
        </p>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <AddressValue
            label={isAddressConflict ? 'Stored address' : 'Person record address'}
            value={context.issue.storedEmail}
          />
          <AddressValue
            label={isAddressConflict ? 'Newly found address' : 'Roster candidate address'}
            value={context.issue.foundEmail}
          />
        </div>

        {(context.issue.source || context.issue.detectedAt) && (
          <div className="text-[11px] text-gray-500">
            {context.issue.source ? `Source: ${context.issue.source}` : ''}
            {context.issue.source && context.issue.detectedAt ? ' · ' : ''}
            {context.issue.detectedAt ? `Detected ${new Date(context.issue.detectedAt).toLocaleString()}` : ''}
          </div>
        )}

        {evidenceLinks.length > 0 && (
          <div>
            <div className="font-medium text-gray-900">Evidence</div>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {evidenceLinks.map((item) => (
                <li key={item.url}>
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-700 underline hover:text-blue-900"
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="rounded border border-blue-200 bg-blue-50 p-2 text-blue-900">
          <div className="font-medium">What to do</div>
          <ol className="mt-1 list-decimal space-y-1 pl-4">
            {isReadyToClose ? (
              <>
                <li>Optionally open the reviewer in Workbench to confirm the conflict or repair block is gone.</li>
                <li>Return here and Resolve this alert. No additional reviewer change is required by this alert.</li>
              </>
            ) : isAddressConflict && recommendedAction === 'confirm_identity' ? (
              <>
                <li>Open the highlighted reviewer in Workbench and choose Confirm identity.</li>
                <li>Compare the stored and newly found addresses against the evidence, correct the contact details, and submit the identity/address attestation.</li>
                <li>If the evidence does not establish the exact person, choose Not a fit instead. Do not create another repair request for this alert.</li>
                <li>Return here and Resolve this alert only after the reviewer card no longer shows the identity or address block.</li>
              </>
            ) : isAddressConflict && recommendedAction === 'review_repair' && isInviteSurface ? (
              <>
                <li>Open the highlighted reviewer in Invite Reviewers and choose Review repair.</li>
                <li>Compare the two addresses against the evidence, choose the correct address, and submit the attestation.</li>
                <li>Return here and Resolve this alert only after the reviewer no longer shows the conflict.</li>
              </>
            ) : isAddressConflict && recommendedAction === 'review_address_conflict' ? (
              <>
                <li>Open the reviewer in Workbench and choose Review email choice on the highlighted card.</li>
                <li>Compare the two addresses against the evidence, choose the correct address, and submit the attestation.</li>
                <li>Return here and Resolve this alert only after the reviewer card no longer shows the conflict.</li>
              </>
            ) : (
              <>
                <li>Open the highlighted reviewer in Workbench and use the primary repair or retry action shown on the card.</li>
                <li>Verify the exact person and address against the available evidence before submitting any change.</li>
                <li>Return here and Resolve this alert only after the reviewer card no longer shows the repair block.</li>
              </>
            )}
          </ol>
        </div>

        {context.workbenchUrl && (
          <a
            href={context.workbenchUrl}
            className="inline-flex rounded border border-blue-300 bg-white px-3 py-1.5 font-medium text-blue-800 hover:bg-blue-50"
          >
            {isInviteSurface ? 'Open reviewer in Invite Reviewers →' : 'Open reviewer in Workbench →'}
          </a>
        )}

        {currentRemote.loading && <div className="text-[11px] text-gray-500">Loading current repair context…</div>}
        {!currentRemote.loading && !currentRemote.error && contextWarnings.length > 0 && (
          <div className="rounded border border-amber-300 bg-amber-50 p-2 text-amber-900">
            Some current request or reviewer details were unavailable. Verify the highlighted reviewer card before acting.
          </div>
        )}
        {currentRemote.error && (
          <div className="rounded border border-amber-300 bg-amber-50 p-2 text-amber-900">
            Current details could not be refreshed. The link and identifiers above come from the alert record; verify the reviewer card before acting.
          </div>
        )}
      </div>

      {alert.message && <p>{alert.message}</p>}
      {alert.metadata && (
        <details>
          <summary className="cursor-pointer text-[11px] text-gray-500">Technical details</summary>
          <pre className="mt-1 max-h-40 overflow-x-auto rounded bg-white/50 p-2 text-[11px]">
            {JSON.stringify(alert.metadata, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
