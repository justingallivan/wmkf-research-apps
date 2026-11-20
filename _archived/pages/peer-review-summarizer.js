import { useState, useCallback } from 'react';
import DOMPurify from 'dompurify';
import Layout, { PageHeader, Card, Button } from '../shared/components/Layout';
import FileUploaderSimple from '../shared/components/FileUploaderSimple';
import RequireAppAccess from '../shared/components/RequireAppAccess';
import ErrorAlert from '../shared/components/ErrorAlert';

function PeerReviewSummarizer() {
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState(null);
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState('');
  const [error, setError] = useState(null);

  const handleFilesUploaded = useCallback((uploadedFiles) => {
    setSelectedFiles(uploadedFiles);
    setError(null);
    setResults(null);
  }, []);



  const processFiles = async () => {
    if (selectedFiles.length === 0) {
      setError('Please select files first');
      return;
    }

    setProcessing(true);
    setProgress(0);
    setProgressText('Starting peer review analysis...');
    setError(null);

    try {
      // eslint-disable-next-line no-restricted-syntax -- raw fetch: SSE stream (response.body.getReader() below); allowlisted per CLIENT_REQUEST_LAYER_PLAN §2.6
      const response = await fetch('/api/process-peer-reviews', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          files: selectedFiles
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      // Handle streaming response
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
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

      setProgressText('Analysis complete!');
      setSelectedFiles([]);

    } catch (error) {
      console.error('Processing error:', error);
      setError(error.message || 'Failed to process peer reviews');
    } finally {
      setProcessing(false);
    }
  };

  const exportData = (type) => {
    if (!results) return;

    let content, filename;
    const timestamp = new Date().toISOString().split('T')[0];

    if (type === 'summary') {
      content = results.formatted || 'No summary generated';
      filename = `${timestamp}_peer_review_summary.md`;
    } else if (type === 'questions') {
      content = results.structured?.questions || 'No questions extracted';
      filename = `${timestamp}_reviewer_questions.md`;
    }

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const [isGeneratingWord, setIsGeneratingWord] = useState(false);

  const exportWord = async () => {
    if (!results) return;
    setIsGeneratingWord(true);
    try {
      const { generateMarkdownDocument } = await import('../shared/utils/word-export');
      const sections = [];
      if (results.formatted) {
        sections.push({ title: '', content: results.formatted });
      }
      if (results.structured?.questions) {
        sections.push({ title: '', content: results.structured.questions });
      }
      const timestamp = new Date().toISOString().split('T')[0];
      const reviewCount = results.metadata?.reviewCount;
      const subtitle = reviewCount ? `${reviewCount} review${reviewCount !== 1 ? 's' : ''} analyzed — ${timestamp}` : timestamp;
      const blob = await generateMarkdownDocument(sections, {
        title: 'Peer Review Analysis',
        subtitle,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${timestamp}_peer_review_analysis.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Word export failed:', err);
      setError('Failed to generate Word document');
    } finally {
      setIsGeneratingWord(false);
    }
  };

  const convertMarkdownToHTML = (markdown) => {
    if (!markdown) return '';
    
    let html = markdown
      .replace(/^### (.*$)/gim, '<h3>$1</h3>')
      .replace(/^## (.*$)/gim, '<h2>$1</h2>')
      .replace(/^# (.*$)/gim, '<h1>$1</h1>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/<u>(.*?)<\/u>/g, '<u>$1</u>')
      .replace(/^---$/gm, '<hr>')
      .replace(/^[\*\-] (.*$)/gm, '<li>$1</li>');

    html = html.replace(/(<li>.*?<\/li>(\n<li>.*?<\/li>)*)/g, '<ul>$1</ul>');
    html = html.replace(/\n\n+/g, '</p><p>');
    html = html.replace(/\n/g, '<br>');
    html = '<p>' + html + '</p>';
    
    html = html
      .replace(/<p>(<h[1-3]>.*?<\/h[1-3]>)<\/p>/g, '$1')
      .replace(/<p>(<ul>.*?<\/ul>)<\/p>/g, '$1')
      .replace(/<p>(<hr>)<\/p>/g, '$1')
      .replace(/<p><\/p>/g, '');
    
    return html;
  };

  return (
    <Layout 
      title="Peer Review Summarizer"
      description="Synthesize and analyze peer review feedback with actionable insights"
    >
      <PageHeader 
        title="Peer Review Summarizer"
        subtitle="Upload peer review documents to generate comprehensive analysis and synthesis"
        icon="📝"
      />

      <ErrorAlert error={error} onDismiss={() => setError(null)} />

      <Card className="mb-6">
        <div className="mb-4">
          <h2 className="text-xl font-semibold text-gray-900 mb-2 flex items-center gap-2">
            <span>📁</span>
            <span>Upload Peer Reviews</span>
          </h2>
        </div>
        <FileUploaderSimple
          onFilesUploaded={handleFilesUploaded}
          multiple={true}
          accept=".pdf,.doc,.docx"
          maxSize={50 * 1024 * 1024}
        />
      </Card>

      {selectedFiles.length > 0 && !processing && !results && (
        <Card className="mb-6 bg-green-50 border-green-200">
          <div className="text-center">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Ready to Process</h3>
            <p className="text-gray-700 mb-4">
              {selectedFiles.length} file{selectedFiles.length > 1 ? 's' : ''} uploaded and ready for peer review analysis
            </p>
            <Button
              variant="primary"
              size="lg"
              onClick={processFiles}
            >
              🚀 Analyze Reviews
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
        <Card className="mt-8">
          <div className="mb-6">
            <h3 className="text-xl font-semibold text-gray-900 mb-4">Analysis Results</h3>
            <div className="flex gap-3 mb-6">
              <Button variant="secondary" onClick={() => exportData('summary')}>
                Export Summary
              </Button>
              <Button variant="secondary" onClick={() => exportData('questions')}>
                Export Questions
              </Button>
              <Button variant="secondary" onClick={exportWord} disabled={isGeneratingWord}>
                {isGeneratingWord ? 'Generating...' : 'Export Word'}
              </Button>
            </div>
          </div>
          
          <div className="space-y-6">
            <div>
              <h4 className="text-lg font-medium text-gray-900 mb-3">Summary Preview:</h4>
              <div className="prose max-w-none p-4 bg-gray-50 rounded-lg border">
                <div 
                  dangerouslySetInnerHTML={{
                    __html: DOMPurify.sanitize(convertMarkdownToHTML(results.formatted))
                  }}
                />
              </div>
            </div>
            
            {results.structured?.questions && (
              <div>
                <h4 className="text-lg font-medium text-gray-900 mb-3">Questions Preview:</h4>
                <div className="prose max-w-none p-4 bg-gray-50 rounded-lg border">
                  <div 
                    dangerouslySetInnerHTML={{
                      __html: DOMPurify.sanitize(convertMarkdownToHTML(results.structured.questions))
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </Card>
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
            📝 New Analysis
          </Button>
        </div>
      )}
    </Layout>
  );
}

export default function PeerReviewSummarizerPage() {
  return <RequireAppAccess appKey="peer-review-summarizer"><PeerReviewSummarizer /></RequireAppAccess>;
}