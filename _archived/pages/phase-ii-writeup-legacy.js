import { useState, useCallback } from 'react';
import Layout, { PageHeader, Card, Button } from '../shared/components/Layout';
import FileUploaderSimple from '../shared/components/FileUploaderSimple';
import ResultsDisplay from '../shared/components/ResultsDisplay';
import RequireAppAccess from '../shared/components/RequireAppAccess';
import ErrorAlert from '../shared/components/ErrorAlert';

function ProposalSummarizerLegacy() {
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
      const response = await fetch('/api/process-legacy', {
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
    setSelectedFileForQA(filename);
    setQAMessages([]);
    setShowQAModal(true);
  };

  const submitQuestion = async () => {
    if (!currentQuestion.trim()) {
      setError('Please enter a question');
      return;
    }

    setIsQAProcessing(true);
    const question = currentQuestion;
    setCurrentQuestion('');

    setQAMessages(prev => [...prev, { role: 'user', content: question }]);

    try {
      const response = await fetch('/api/qa', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          question,
          context: results[selectedFileForQA].formatted,
          filename: selectedFileForQA
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to get answer');
      }

      setQAMessages(prev => [...prev, { role: 'assistant', content: data.answer }]);

    } catch (error) {
      console.error('Q&A error:', error);
      setQAMessages(prev => [...prev, {
        role: 'assistant',
        content: `Error: ${error.message}`
      }]);
    } finally {
      setIsQAProcessing(false);
    }
  };

  return (
    <Layout
      title="Create Phase II Writeup Draft (Legacy)"
      description="Generate standardized writeup drafts from PDF research proposals using Claude AI"
    >
      <PageHeader
        title="Create Phase II Writeup Draft (Legacy)"
        subtitle="Legacy version — generates original-format summaries"
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

      {/* Q&A Modal */}
      {showQAModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4" onClick={() => setShowQAModal(false)}>
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <h2 className="text-xl font-semibold text-gray-900">Ask Questions - {selectedFileForQA}</h2>
              <button onClick={() => setShowQAModal(false)} className="text-gray-500 hover:text-gray-700 text-2xl leading-none">
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-hidden flex flex-col">
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {qaMessages.map((msg, index) => (
                  <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] p-3 rounded-lg ${
                      msg.role === 'user'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-900'
                    }`}>
                      <div className="whitespace-pre-wrap">{msg.content}</div>
                    </div>
                  </div>
                ))}
                {isQAProcessing && (
                  <div className="flex justify-start">
                    <div className="bg-gray-100 text-gray-900 p-3 rounded-lg flex items-center gap-2">
                      <div className="animate-spin rounded-full h-4 w-4 border-2 border-gray-400 border-t-transparent"></div>
                      Thinking...
                    </div>
                  </div>
                )}
              </div>
              <div className="border-t border-gray-200 p-4">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={currentQuestion}
                    onChange={(e) => setCurrentQuestion(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && !isQAProcessing && submitQuestion()}
                    placeholder="Ask a question about this proposal..."
                    disabled={isQAProcessing}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <Button
                    variant="primary"
                    onClick={submitQuestion}
                    disabled={isQAProcessing || !currentQuestion.trim()}
                  >
                    Ask
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Feedback Modal */}
      {showFeedbackModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4" onClick={isRefining ? null : () => setShowFeedbackModal(false)}>
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <h2 className="text-xl font-semibold text-gray-900">Refine Summary - {selectedFileForRefine}</h2>
              <button
                onClick={() => setShowFeedbackModal(false)}
                className="text-gray-500 hover:text-gray-700 text-2xl leading-none"
                disabled={isRefining}
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-hidden flex flex-col p-4">
              {isRefining ? (
                <div className="text-center space-y-4">
                  <div className="flex items-center justify-center gap-3">
                    <div className="animate-spin rounded-full h-6 w-6 border-2 border-gray-400 border-t-transparent"></div>
                    <span className="text-gray-700 font-medium">Claude is refining your summary...</span>
                  </div>
                  <p className="text-gray-600">Please wait while your feedback is being processed and incorporated into an improved summary.</p>
                  <div className="bg-gray-50 p-4 rounded-lg text-left">
                    <p className="font-medium text-gray-900 mb-2">Your feedback:</p>
                    <p className="text-gray-700 italic">&quot;{feedbackText}&quot;</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <textarea
                    value={feedbackText}
                    onChange={(e) => setFeedbackText(e.target.value)}
                    placeholder="Provide specific feedback on how to improve the summary..."
                    rows={6}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                  />
                  <div className="flex justify-end gap-3">
                    <Button
                      variant="secondary"
                      onClick={() => setShowFeedbackModal(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="primary"
                      onClick={submitRefinement}
                      disabled={isRefining || !feedbackText.trim()}
                    >
                      {isRefining ? 'Refining...' : 'Refine Summary'}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}

export default function ProposalSummarizerLegacyPage() {
  return <RequireAppAccess appKey="phase-ii-writeup"><ProposalSummarizerLegacy /></RequireAppAccess>;
}
