import { useState, useCallback } from 'react';
import Layout, { PageHeader, Card, Button } from '../shared/components/Layout';
import FileUploaderSimple from '../shared/components/FileUploaderSimple';
import ResultsDisplay from '../shared/components/ResultsDisplay';
import RequireAppAccess from '../shared/components/RequireAppAccess';
import ErrorAlert from '../shared/components/ErrorAlert';

function PhaseIWriteup() {
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

  const handleWordExport = async (filename, result) => {
    if (!result?.formatted?.trim()) {
      setError('No content available to export to Word');
      return;
    }
    let url;
    try {
      const { generateMarkdownDocument } = await import('../shared/utils/word-export');
      const sections = [{ title: '', content: result.formatted }];
      const cleanFilename = filename.replace(/\.[^/.]+$/, '');
      const timestamp = new Date().toISOString().split('T')[0];
      const blob = await generateMarkdownDocument(sections, {
        title: 'Phase I Writeup Draft',
        subtitle: `${cleanFilename} — ${timestamp}`,
      });
      url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${cleanFilename.replace(/[^a-zA-Z0-9-_]/g, '_')}_Phase_I_Writeup.docx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      console.error('Word export failed:', err);
      setError('Failed to generate Word document');
    } finally {
      if (url) URL.revokeObjectURL(url);
    }
  };

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
      const response = await fetch('/api/process-phase-i-writeup', {
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

      console.log('Starting to read streaming response...');

      while (true) {
        const { done, value } = await reader.read();
        console.log('Read chunk:', { done, valueLength: value?.length });
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        console.log('Decoded chunk:', chunk);
        buffer += chunk;
        const lines = buffer.split('\n\n');
        buffer = lines.pop();
        console.log('Split into lines:', lines.length, 'lines, buffer remaining:', buffer.length);

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.substring(6));
              console.log('Frontend received streaming data:', data);

              if (data.progress !== undefined) {
                console.log('Setting progress to:', data.progress);
                setProgress(data.progress);
              }

              if (data.message) {
                console.log('Setting progress text to:', data.message);
                setProgressText(data.message);
              }

              if (data.results) {
                console.log('Setting results to:', data.results);
                setResults(data.results);
              }
            } catch (e) {
              console.error('Failed to parse streaming data:', e);
              console.error('Problematic line:', line);
            }
          }
        }
      }

      console.log('Streaming complete, setting final state...');
      setProgressText('Processing complete!');
      setSelectedFiles([]);
      console.log('Final state set, results should be visible now.');
      console.log('Current processing state:', processing);
      console.log('Current results state:', results);

    } catch (error) {
      console.error('Processing error:', error);
      setError(error.message || 'Failed to process proposals');
    } finally {
      console.log('Setting processing to false...');
      setProcessing(false);
      console.log('Processing state set to false');
    }
  };

  return (
    <Layout
      title="Create Phase I Writeup Draft"
      description="Generate Phase I writeup drafts from PDF research proposals using Claude AI"
    >
      <PageHeader
        title="Create Phase I Writeup Draft"
        subtitle="Generate Phase I writeup drafts from PDF research proposals using Claude AI"
        icon="📝"
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
              {selectedFiles.length} proposal{selectedFiles.length > 1 ? 's' : ''} uploaded and ready for Phase I writeup generation
            </p>
            <Button
              variant="primary"
              size="lg"
              onClick={processProposals}
            >
              🚀 Generate Writeup Drafts
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
          {console.log('Rendering ResultsDisplay with results:', results)}
          <ResultsDisplay
            results={results}
            showActions={false}
            exportFormats={['markdown', 'json']}
            onWordExport={handleWordExport}
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
            📄 New Proposals
          </Button>
        </div>
      )}
    </Layout>
  );
}

export default function PhaseIWriteupPage() {
  return <RequireAppAccess appKey="phase-i-writeup"><PhaseIWriteup /></RequireAppAccess>;
}
