import { useState, useCallback, useEffect, useRef } from 'react';
import Layout, { PageHeader, Card, Button } from '../shared/components/Layout';
import FileUploaderSimple from '../shared/components/FileUploaderSimple';
import ResultsDisplay from '../shared/components/ResultsDisplay';
import RequireAppAccess from '../shared/components/RequireAppAccess';
import ErrorAlert from '../shared/components/ErrorAlert';
import { useProfile } from '../shared/context/ProfileContext';
import { parseSections } from '../shared/config/prompts/proposal-summarizer';
import { parseSseStream } from '../shared/utils/sse-stream';
import Phase2FeedbackModal from '../shared/components/Phase2FeedbackModal';
import Phase2WordExportModal from '../shared/components/Phase2WordExportModal';
import Phase2QAModal from '../shared/components/Phase2QAModal';

function ProposalSummarizer() {
  const { profileName } = useProfile();
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState(null);
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState('');
  const [error, setError] = useState(null);
  const [showQAModal, setShowQAModal] = useState(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [qaMessages, setQAMessages] = useState([]);
  const [currentQuestion, setCurrentQuestion] = useState('');
  const [isQAProcessing, setIsQAProcessing] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [selectedFileForQA, setSelectedFileForQA] = useState('');
  const [selectedFileForRefine, setSelectedFileForRefine] = useState('');

  // Staff Lead — pre-filled from profile, editable
  const [staffLead, setStaffLead] = useState('');

  // Word export modal state
  const [showWordExportModal, setShowWordExportModal] = useState(false);
  const [selectedFileForExport, setSelectedFileForExport] = useState('');
  const [selectedResultForExport, setSelectedResultForExport] = useState(null);
  const [wordExportFields, setWordExportFields] = useState({
    institution: '',
    cityState: '',
    projectTitle: '',
    meetingDate: '',
    requestedAmount: '',
    programType: 'Science and Engineering',
    invitedAmount: '',
    projectBudget: '',
  });
  const [isGeneratingWord, setIsGeneratingWord] = useState(false);

  // Initialize staff lead from profile name. Intentionally keyed on profileName
  // only: adding staffLead would re-fire and re-populate after a user clears it.
  useEffect(() => {
    if (profileName && !staffLead) {
      setStaffLead(profileName);
    }
  }, [profileName]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFilesUploaded = useCallback((uploadedFiles) => {
    setSelectedFiles(uploadedFiles);
    setError(null);
    setResults(null);
  }, []);

  const processProposals = async () => {
    if (selectedFiles.length === 0) {
      setError('Please select PDF files first');
      return;
    }

    setProcessing(true);
    setProgress(0);
    setProgressText('Starting proposal processing...');
    setError(null);

    try {
      const response = await fetch('/api/process', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          files: selectedFiles
        })
      });

      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch (e) {
          // If JSON parsing fails, use the default error message
        }
        throw new Error(errorMessage);
      }

      // Handle streaming response
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;
        const lines = buffer.split('\n\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.substring(6));

              if (data.progress !== undefined) {
                setProgress(data.progress);
              }

              if (data.message) {
                setProgressText(data.message);
              }

              if (data.results) {
                setResults(data.results);
              }
            } catch (e) {
              console.error('Failed to parse streaming data:', e);
            }
          }
        }
      }

      setProgressText('Processing complete!');
      setSelectedFiles([]);

    } catch (error) {
      console.error('Processing error:', error);
      setError(error.message || 'Failed to process proposals');
    } finally {
      setProcessing(false);
    }
  };

  const handleRefine = async (filename, currentSummary) => {
    setSelectedFileForRefine(filename);
    setShowFeedbackModal(true);
  };

  const submitRefinement = async () => {
    if (!feedbackText.trim()) {
      setError('Please provide feedback for refinement');
      return;
    }

    setIsRefining(true);
    setError(null);

    try {
      const response = await fetch('/api/refine', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          currentSummary: results[selectedFileForRefine].formatted,
          feedback: feedbackText
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to refine summary');
      }

      setResults(prev => ({
        ...prev,
        [selectedFileForRefine]: {
          ...prev[selectedFileForRefine],
          formatted: data.refinedSummary
        }
      }));

      setFeedbackText('');
      setSelectedFileForRefine('');
      setShowFeedbackModal(false);

    } catch (error) {
      console.error('Refinement error:', error);
      setError(error.message || 'Failed to refine summary');
    } finally {
      setIsRefining(false);
    }
  };

  const handleQuestionAsk = async (filename) => {
    // Only reset conversation when switching to a different file
    if (filename !== selectedFileForQA) {
      setSelectedFileForQA(filename);
      setQAMessages([]);
    }
    setShowQAModal(true);
  };

  // Ref for auto-scrolling the chat container
  const qaChatRef = useRef(null);
  // Ref to track abort controller for cancelling streams
  const qaAbortRef = useRef(null);

  // Auto-scroll chat when messages change
  useEffect(() => {
    if (qaChatRef.current) {
      qaChatRef.current.scrollTop = qaChatRef.current.scrollHeight;
    }
  }, [qaMessages]);

  const submitQuestion = async () => {
    if (!currentQuestion.trim()) {
      setError('Please enter a question');
      return;
    }

    setIsQAProcessing(true);
    const question = currentQuestion;
    setCurrentQuestion('');

    // Add user message
    setQAMessages(prev => [...prev, { role: 'user', content: question }]);

    // Add thinking indicator
    setQAMessages(prev => [...prev, { role: 'assistant', content: '', isThinking: true, thinkingText: 'Analyzing your question...' }]);

    const abortController = new AbortController();
    qaAbortRef.current = abortController;

    try {
      const result = results[selectedFileForQA];
      const response = await fetch('/api/qa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortController.signal,
        body: JSON.stringify({
          question,
          messages: qaMessages.filter(m => !m.isThinking && !m.isError).map(m => ({ role: m.role, content: m.content })),
          proposalText: result.extractedText || '',
          summaryText: result.formatted || '',
          filename: selectedFileForQA,
        }),
      });

      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}`;
        try {
          const errData = await response.json();
          errorMessage = errData.error || errorMessage;
        } catch {}
        throw new Error(errorMessage);
      }

      // Parse SSE stream via the shared parser. Same AbortController
      // drives both fetch() above and the parser's signal, so a modal
      // close triggers both teardowns in one call.
      let streamedText = '';
      let streamedSources = [];

      for await (const evt of parseSseStream({
        stream: response.body,
        signal: abortController.signal,
      })) {
        const { event: eventType, data: parsed } = evt;

        switch (eventType) {
          case 'thinking':
            // Update thinking indicator text
            setQAMessages(prev => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last && last.isThinking) {
                updated[updated.length - 1] = { ...last, thinkingText: parsed.message };
              }
              return updated;
            });
            break;

          case 'text_delta':
            streamedText += parsed.text;
            // Replace thinking indicator with streaming message, or update streaming message
            setQAMessages(prev => {
              const updated = [...prev];
              const lastIdx = updated.length - 1;
              const last = updated[lastIdx];
              if (last && (last.isThinking || last.isStreaming)) {
                updated[lastIdx] = { role: 'assistant', content: streamedText, isStreaming: true };
              } else {
                updated.push({ role: 'assistant', content: streamedText, isStreaming: true });
              }
              return updated;
            });
            break;

          case 'sources':
            // Collect web search sources for citation display
            if (parsed.sources) {
              streamedSources = parsed.sources;
            }
            break;

          case 'complete':
            // Finalize the message with sources if available
            setQAMessages(prev => {
              const updated = [...prev];
              const lastIdx = updated.length - 1;
              if (updated[lastIdx]?.isStreaming || updated[lastIdx]?.isThinking) {
                updated[lastIdx] = {
                  role: 'assistant',
                  content: streamedText || 'No response received.',
                  ...(streamedSources.length > 0 ? { sources: streamedSources } : {}),
                };
              }
              return updated;
            });
            break;

          case 'error':
            setQAMessages(prev => {
              const updated = [...prev];
              const lastIdx = updated.length - 1;
              if (updated[lastIdx]?.isThinking || updated[lastIdx]?.isStreaming) {
                updated[lastIdx] = { role: 'assistant', content: parsed.message, isError: true };
              } else {
                updated.push({ role: 'assistant', content: parsed.message, isError: true });
              }
              return updated;
            });
            break;
        }
      }

      // Ensure finalization if stream ends without 'complete' event
      setQAMessages(prev => {
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        if (updated[lastIdx]?.isStreaming) {
          updated[lastIdx] = {
            role: 'assistant',
            content: streamedText || 'No response received.',
            ...(streamedSources.length > 0 ? { sources: streamedSources } : {}),
          };
        } else if (updated[lastIdx]?.isThinking) {
          updated[lastIdx] = { role: 'assistant', content: streamedText || 'No response received.' };
        }
        return updated;
      });

    } catch (error) {
      if (error.name === 'AbortError') return;
      console.error('Q&A error:', error);
      setQAMessages(prev => {
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        if (updated[lastIdx]?.isThinking || updated[lastIdx]?.isStreaming) {
          updated[lastIdx] = { role: 'assistant', content: error.message || 'Failed to get answer', isError: true };
        } else {
          updated.push({ role: 'assistant', content: error.message || 'Failed to get answer', isError: true });
        }
        return updated;
      });
    } finally {
      setIsQAProcessing(false);
      qaAbortRef.current = null;
    }
  };

  // --- Word Export ---
  const handleWordExport = (filename, result) => {
    setSelectedFileForExport(filename);
    setSelectedResultForExport(result);

    // Pre-fill from structured data
    const structured = result.structured || {};
    const notSpecified = (v) => !v || v === 'Not specified';
    setWordExportFields(prev => ({
      ...prev,
      institution: notSpecified(structured.institution) ? '' : structured.institution,
      cityState: notSpecified(structured.city_state) ? '' : structured.city_state,
      projectTitle: notSpecified(structured.project_title) ? '' : structured.project_title,
      meetingDate: notSpecified(structured.meeting_date) ? '' : structured.meeting_date,
      requestedAmount: notSpecified(structured.funding_amount) ? '' : structured.funding_amount,
      invitedAmount: notSpecified(structured.invited_amount) ? '' : structured.invited_amount,
      projectBudget: notSpecified(structured.total_project_cost) ? '' : structured.total_project_cost,
    }));

    setShowWordExportModal(true);
  };

  const generateWordDocument = async () => {
    setIsGeneratingWord(true);
    setError(null);

    try {
      const { generatePhaseIIDocument } = await import('../shared/utils/word-export');

      const result = selectedResultForExport;
      const sections = parseSections(result.formatted);
      // Use editable fields as overrides over raw AI extraction
      const metadata = {
        ...(result.structured || {}),
        institution: wordExportFields.institution || result.structured?.institution,
        city_state: wordExportFields.cityState || result.structured?.city_state,
        project_title: wordExportFields.projectTitle || result.structured?.project_title,
        meeting_date: wordExportFields.meetingDate || result.structured?.meeting_date,
        funding_amount: wordExportFields.requestedAmount || result.structured?.funding_amount,
        invited_amount: wordExportFields.invitedAmount || result.structured?.invited_amount,
        total_project_cost: wordExportFields.projectBudget || result.structured?.total_project_cost,
      };

      const blob = await generatePhaseIIDocument(sections, metadata, {
        ...wordExportFields,
        staffLead: staffLead,
      });

      // Trigger download
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const cleanFilename = selectedFileForExport.replace(/\.[^/.]+$/, '');
      a.download = `${cleanFilename}_Phase_II_Writeup.docx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setShowWordExportModal(false);
    } catch (err) {
      console.error('Word export error:', err);
      setError(`Failed to generate Word document: ${err.message}`);
    } finally {
      setIsGeneratingWord(false);
    }
  };

  const updateExportField = (field, value) => {
    setWordExportFields(prev => ({ ...prev, [field]: value }));
  };

  return (
    <Layout
      title="Create Phase II Writeup Draft"
      description="Generate standardized writeup drafts from PDF research proposals using Claude AI"
    >
      <PageHeader
        title="Create Phase II Writeup Draft"
        subtitle="Generate standardized writeup drafts from PDF research proposals using Claude AI"
        icon="✍️"
      />

      <ErrorAlert error={error} onDismiss={() => setError(null)} />

      <Card className="mb-6">
        <div className="mb-4">
          <h2 className="text-xl font-semibold text-gray-900 mb-2 flex items-center gap-2">
            <span>📁</span>
            <span>Upload Research Proposals</span>
          </h2>
        </div>

        {/* Staff Lead field */}
        <div className="mb-4">
          <label htmlFor="staff-lead" className="block text-sm font-medium text-gray-700 mb-1">
            Staff Lead
          </label>
          <input
            id="staff-lead"
            type="text"
            value={staffLead}
            onChange={(e) => setStaffLead(e.target.value)}
            placeholder="Enter staff lead name"
            className="w-full max-w-md px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
          />
          <p className="mt-1 text-xs text-gray-500">Pre-filled from your profile. Used in Word template export.</p>
        </div>

        <FileUploaderSimple
          onFilesUploaded={handleFilesUploaded}
          multiple={true}
          accept=".pdf"
          maxSize={50 * 1024 * 1024}
        />
      </Card>

      {selectedFiles.length > 0 && !processing && !results && (
        <Card className="mb-6 bg-green-50 border-green-200">
          <div className="text-center">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Ready to Process</h3>
            <p className="text-gray-700 mb-4">
              {selectedFiles.length} proposal{selectedFiles.length > 1 ? 's' : ''} uploaded and ready for Phase II writeup generation
            </p>
            <Button
              variant="primary"
              size="lg"
              onClick={processProposals}
            >
              Generate Writeup Drafts
            </Button>
          </div>
        </Card>
      )}

      {processing && (
        <Card className="mb-6">
          <div className="text-center">
            <div className="flex items-center justify-center gap-3 mb-4">
              <div className="animate-spin rounded-full h-6 w-6 border-2 border-gray-400 border-t-transparent"></div>
              <span className="text-gray-700 font-medium">{progressText}</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3 mb-2">
              <div
                className="bg-gray-600 h-3 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="text-sm text-gray-600">{progress}%</div>
          </div>
        </Card>
      )}

      {results && (
        <div className="mt-8">
          <ResultsDisplay
            results={results}
            onRefine={handleRefine}
            onQuestionAsk={handleQuestionAsk}
            onWordExport={handleWordExport}
            showActions={true}
            exportFormats={['markdown', 'json']}
          />
        </div>
      )}

      {results && !processing && (
        <div className="flex justify-center mt-6">
          <Button
            variant="secondary"
            onClick={() => {
              setResults(null);
              setProgress(0);
              setProgressText('');
            }}
          >
            New Proposals
          </Button>
        </div>
      )}

      {/* Q&A Side Panel */}
      <Phase2QAModal
        isOpen={showQAModal}
        selectedFile={selectedFileForQA}
        messages={qaMessages}
        chatRef={qaChatRef}
        currentQuestion={currentQuestion}
        onChangeQuestion={setCurrentQuestion}
        isProcessing={isQAProcessing}
        onClose={() => {
          if (qaAbortRef.current) qaAbortRef.current.abort();
          setShowQAModal(false);
        }}
        onSubmit={submitQuestion}
      />

      <Phase2FeedbackModal
        isOpen={showFeedbackModal}
        selectedFile={selectedFileForRefine}
        feedbackText={feedbackText}
        onChangeFeedbackText={setFeedbackText}
        isRefining={isRefining}
        onClose={() => setShowFeedbackModal(false)}
        onSubmit={submitRefinement}
      />

      <Phase2WordExportModal
        isOpen={showWordExportModal}
        fields={wordExportFields}
        onChangeField={updateExportField}
        staffLead={staffLead}
        isGenerating={isGeneratingWord}
        onClose={() => setShowWordExportModal(false)}
        onGenerate={generateWordDocument}
      />
    </Layout>
  );
}

export default function ProposalSummarizerPage() {
  return <RequireAppAccess appKey="phase-ii-writeup"><ProposalSummarizer /></RequireAppAccess>;
}
