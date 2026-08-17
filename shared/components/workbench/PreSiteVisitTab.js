import { useEffect, useRef, useState } from 'react';
import { Card } from '../Layout';
import { REQUEST_DOCUMENT_OPERATION_STATUS } from '../../config/requestDocument';

export default function PreSiteVisitTab({ requestId }) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [artifact, setArtifact] = useState(null);
  const generationSequence = useRef(0);
  const activeController = useRef(null);

  useEffect(() => {
    generationSequence.current += 1;
    activeController.current?.abort();
    activeController.current = null;
    setGenerating(false);
    setError(null);
    setArtifact(null);
    return () => {
      generationSequence.current += 1;
      activeController.current?.abort();
      activeController.current = null;
    };
  }, [requestId]);

  const generate = async () => {
    if (!requestId || generating) return;
    const id = requestId;
    const sequence = ++generationSequence.current;
    activeController.current?.abort();
    const controller = new AbortController();
    activeController.current = controller;
    setGenerating(true);
    setError(null);
    setArtifact(null);

    try {
      const response = await fetch('/api/workbench/pre-site-visit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: id }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Generation failed (${response.status})`);
      }
      const body = await response.json().catch(() => ({}));
      if (generationSequence.current !== sequence || id !== requestId) return;
      if (!body.artifact) throw new Error('Generation returned no artifact identity.');
      setArtifact(body.artifact);
    } catch (generationError) {
      if (generationError?.name !== 'AbortError'
        && generationSequence.current === sequence
        && id === requestId) {
        setError(generationError.message);
      }
    } finally {
      if (generationSequence.current === sequence && id === requestId) {
        if (activeController.current === controller) activeController.current = null;
        setGenerating(false);
      }
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm" role="alert">
          {error}
        </div>
      )}
      <Card hover={false}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <h2 className="text-lg font-semibold text-gray-900">Pre Site Visit Writeup</h2>
            <p className="text-sm text-gray-600 mt-1">
              Creates a Word draft from the exact <code>AI Materials/ProposalNarrative_&#123;Request#&#125;.pdf</code>
              {' '}file plus authoritative Dataverse request fields. The current published prompt version
              in Admin controls the Claude model.
            </p>
            <p className="text-sm text-gray-600 mt-2">
              The graphical abstract, caption, recommendation, referee comments, scientific
              presentation, and institutional funding history remain marked for staff completion.
            </p>
            <p className="text-sm text-amber-800 mt-2">
              The generated sections and exact input snapshot are registered in Dataverse. The Word
              draft is saved in SharePoint and becomes the working document for the Site Visit stage.
            </p>
          </div>
          <button
            type="button"
            onClick={generate}
            disabled={generating || !requestId}
            className="px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-medium disabled:opacity-50"
          >
            {generating ? 'Generating Word draft…' : 'Generate Word draft'}
          </button>
        </div>
        <div aria-live="polite">
          {artifact?.operationStatus === REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING && (
            <p className="mt-4 text-sm text-amber-800">
              This draft is already being generated. Try again shortly to retrieve the completed Word link.
            </p>
          )}
          {artifact?.operationStatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY && artifact.file?.webUrl && (
            <p className="mt-4 text-sm text-green-800">
              Ready: {' '}
              <a
                href={artifact.file.webUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium underline"
              >
                Open {artifact.file.name || 'the Pre-Site Visit draft'} in Word
              </a>
              {' '}to complete the staff-owned sections.
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}
