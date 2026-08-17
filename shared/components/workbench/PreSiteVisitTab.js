import { useEffect, useRef, useState } from 'react';
import { Card } from '../Layout';

function filenameFromDisposition(disposition) {
  const match = String(disposition || '').match(/filename="([^"]+)"/i);
  return match?.[1] || 'Phase II Pre-Site Visit Writeup.docx';
}
export default function PreSiteVisitTab({ requestId }) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [completedFilename, setCompletedFilename] = useState(null);
  const generationSequence = useRef(0);
  const activeController = useRef(null);

  useEffect(() => {
    generationSequence.current += 1;
    activeController.current?.abort();
    activeController.current = null;
    setGenerating(false);
    setError(null);
    setCompletedFilename(null);
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
    setCompletedFilename(null);

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
      const blob = await response.blob();
      if (generationSequence.current !== sequence || id !== requestId) return;

      const filename = filenameFromDisposition(response.headers.get('Content-Disposition'));
      const url = URL.createObjectURL(blob);
      try {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      } finally {
        URL.revokeObjectURL(url);
      }
      setCompletedFilename(filename);
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
              file and authoritative Dataverse request fields. The current published prompt version
              in Admin controls the Claude model.
            </p>
            <p className="text-sm text-gray-600 mt-2">
              The graphical abstract, caption, recommendation, referee comments, scientific
              presentation, and institutional funding history remain marked for staff completion.
            </p>
            <p className="text-sm text-amber-800 mt-2">
              This version downloads the draft to your computer. It records the normal AI run audit
              but does not yet save the Word file in SharePoint.
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
          {completedFilename && (
            <p className="mt-4 text-sm text-green-800">
              Downloaded {completedFilename}. Open it in Word to complete the staff-owned sections.
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}
