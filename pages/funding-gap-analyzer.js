import { useState, useCallback } from 'react';
import Layout, { PageHeader, Card, Button } from '../shared/components/Layout';
import FileUploaderSimple from '../shared/components/FileUploaderSimple';
import RequireAppAccess from '../shared/components/RequireAppAccess';
import ErrorAlert from '../shared/components/ErrorAlert';

function FundingGapAnalyzer() {
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState(null);
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState('');
  const [searchYears, setSearchYears] = useState(5);
  const [includeCoPIs, setIncludeCoPIs] = useState(true);
  const [includeUSASpending, setIncludeUSASpending] = useState(false);
  const [error, setError] = useState(null);

  const handleFilesUploaded = useCallback((uploadedFiles) => {
    setSelectedFiles(uploadedFiles);
    setError(null);
    setResults(null);
  }, []);

  const analyzeProposals = async () => {
    if (selectedFiles.length === 0) {
      setError('Please select at least one PDF file');
      return;
    }

    setProcessing(true);
    setProgress(0);
    setProgressText('Starting funding gap analysis...');
    setError(null);

    try {
      // eslint-disable-next-line no-restricted-syntax -- raw fetch: SSE stream (response.body.getReader() below); allowlisted per CLIENT_REQUEST_LAYER_PLAN §2.6
      const response = await fetch('/api/analyze-funding-gap', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          files: selectedFiles,
          searchYears,
          includeCoPIs,
          includeUSASpending
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      // Handle streaming response
      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;

          // Process complete lines
          const lines = buffer.split('\n\n');
          buffer = lines.pop() || ''; // Keep incomplete line in buffer

          for (const line of lines) {
            if (line && line.startsWith('data: ')) {
              try {
                const jsonString = line.slice(6).trim();

                if (jsonString && jsonString !== '' && jsonString !== 'null') {
                  const data = JSON.parse(jsonString);

                  if (data && typeof data === 'object') {
                    if (typeof data.progress === 'number') {
                      setProgress(data.progress);
                    }

                    if (data.message) {
                      setProgressText(String(data.message));
                    }

                    if (data.complete && data.results) {
                      setResults(data.results);
                    }

                    if (data.error) {
                      throw new Error(data.error);
                    }
                  }
                }
              } catch (parseError) {
                console.error('Parse error:', parseError);
                // Continue on parse errors
                continue;
              }
            }
          }
        }
      } catch (streamError) {
        console.error('Streaming error:', streamError);
        throw new Error('Failed to process server response stream');
      }

      setProgressText('Analysis complete!');
      setSelectedFiles([]);

    } catch (error) {
      console.error('Analysis error:', {
        message: error.message,
        stack: error.stack,
        name: error.name
      });

      setError(error.message || 'Failed to analyze funding gaps');
    } finally {
      setProcessing(false);
    }
  };

  const [expandedProposals, setExpandedProposals] = useState({});

  const toggleExpanded = (filename) => {
    setExpandedProposals(prev => ({
      ...prev,
      [filename]: !prev[filename]
    }));
  };

  const downloadIndividualReport = (filename, report) => {
    if (!report || !report.formatted) return;

    const pi = report.structured?.pi || 'Unknown';
    const piSafe = pi.replace(/[^a-zA-Z0-9]/g, '_');
    const filenameSafe = filename.replace(/\.pdf$/i, '').replace(/[^a-zA-Z0-9]/g, '_');
    const date = new Date().toISOString().split('T')[0];

    const downloadName = `funding_analysis_${piSafe}_${filenameSafe}_${date}.md`;

    const blob = new Blob([report.formatted], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = downloadName;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadAllAsZip = async () => {
    if (!results || typeof results !== 'object') return;

    try {
      // Dynamically import JSZip
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();

      const date = new Date().toISOString().split('T')[0];

      // Add each report to the zip
      Object.entries(results).forEach(([filename, report]) => {
        if (report && report.formatted) {
          const pi = report.structured?.pi || 'Unknown';
          const piSafe = pi.replace(/[^a-zA-Z0-9]/g, '_');
          const filenameSafe = filename.replace(/\.pdf$/i, '').replace(/[^a-zA-Z0-9]/g, '_');
          const reportName = `funding_analysis_${piSafe}_${filenameSafe}_${date}.md`;

          zip.file(reportName, report.formatted);
        }
      });

      // Generate and download the zip
      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = `funding_gap_analyses_${date}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error creating ZIP:', error);
      setError('Failed to create ZIP file. Please try downloading reports individually.');
    }
  };

  return (
    <Layout
      title="Funding Analysis"
      description="Analyze federal funding landscapes and identify potential gaps for research proposals"
    >
      <PageHeader
        title="Funding Analysis"
        subtitle="Analyze NSF awards and federal funding opportunities for research proposals"
        icon="💵"
      />

      <ErrorAlert error={error} onDismiss={() => setError(null)} />

      <div className="space-y-6">
        <Card>
          <div>
            <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <span>⚙️</span>
              <span>Analysis Configuration</span>
            </h2>
            <div className="space-y-4">
              <div className="max-w-md">
                <label htmlFor="searchYears" className="block text-sm font-medium text-gray-700 mb-2">
                  Search Time Period
                </label>
                <select
                  id="searchYears"
                  value={searchYears}
                  onChange={(e) => setSearchYears(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  disabled={processing}
                >
                  <option value={3}>Past 3 years</option>
                  <option value={5}>Past 5 years (recommended)</option>
                  <option value={10}>Past 10 years</option>
                </select>
                <p className="text-sm text-gray-600 mt-1">
                  Time period for querying NSF awards and funding trends
                </p>
              </div>

              <div className="max-w-md">
                <label className="flex items-center space-x-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeCoPIs}
                    onChange={(e) => setIncludeCoPIs(e.target.checked)}
                    disabled={processing}
                    className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                  />
                  <div>
                    <span className="text-sm font-medium text-gray-700">
                      Include Co-Principal Investigator roles (NSF)
                    </span>
                    <p className="text-xs text-gray-600">
                      Search NSF awards where the person is listed as Co-PI in addition to PI
                    </p>
                  </div>
                </label>
              </div>

              <div className="max-w-md">
                <label className="flex items-center space-x-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeUSASpending}
                    onChange={(e) => setIncludeUSASpending(e.target.checked)}
                    disabled={processing}
                    className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                  />
                  <div>
                    <span className="text-sm font-medium text-gray-700">
                      Include USAspending.gov data (DOE, DOD, NASA, etc.)
                    </span>
                    <p className="text-xs text-gray-600">
                      Query institution-wide federal awards from all agencies (may include irrelevant data)
                    </p>
                  </div>
                </label>
              </div>
            </div>
          </div>
        </Card>

        <Card className="mb-6 bg-blue-50 border-blue-200">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2 flex items-center gap-2">
              <span>ℹ️</span>
              <span>What This Tool Does</span>
            </h3>
            <div className="text-gray-700 space-y-2">
              <p>This analyzer will:</p>
              <ul className="list-disc ml-6 space-y-1">
                <li>Extract PI name, institution, and research keywords from proposals</li>
                <li>Query <strong>NSF Awards API</strong> for PI's current funding and research area trends</li>
                <li>Query <strong>NIH RePORTER API</strong> for PI's biomedical research projects (with smart filtering)</li>
                <li>Analyze DOE and DOD funding landscapes based on Claude's knowledge</li>
                <li>Identify potential funding gaps and opportunities across federal agencies</li>
                <li>Generate actionable recommendations for federal funding applications</li>
              </ul>
              <p className="text-sm italic mt-3">
                Processing time: Approximately 1-2 minutes per proposal due to real-time API queries
              </p>
            </div>
          </div>
        </Card>

        <Card className="mb-6">
          <div className="mb-4">
            <h2 className="text-xl font-semibold text-gray-900 mb-2 flex items-center gap-2">
              <span>📁</span>
              <span>Upload Proposals</span>
            </h2>
            <p className="text-gray-600 text-sm">
              Upload one or more research proposals for funding gap analysis
            </p>
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
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Ready to Analyze</h3>
              <p className="text-gray-700 mb-4">
                {selectedFiles.length} proposal{selectedFiles.length > 1 ? 's' : ''} ready for federal funding analysis
                <br />
                Search Period: Past {searchYears} years
                {includeCoPIs && <><br />Including Co-PI roles in search</>}
              </p>
              <Button
                variant="primary"
                size="lg"
                onClick={analyzeProposals}
              >
                🔍 Analyze Funding Gaps
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
          <div className="mt-8 space-y-6">
            {/* Header with summary stats and download all button */}
            <Card>
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
                  <span>📊</span>
                  <span>Funding Gap Analysis Results</span>
                </h2>
                <Button
                  variant="primary"
                  onClick={downloadAllAsZip}
                >
                  📦 Download All as ZIP
                </Button>
              </div>

              {results.metadata && (
                <div className="bg-blue-50 p-4 rounded-lg">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
                    <div>
                      <div className="text-2xl font-bold text-gray-900">
                        {results.metadata.proposalCount}
                      </div>
                      <div className="text-sm text-gray-600">Proposal{results.metadata.proposalCount > 1 ? 's' : ''} Analyzed</div>
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-gray-900">
                        {results.metadata.searchYears}
                      </div>
                      <div className="text-sm text-gray-600">Years Searched</div>
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-gray-900">
                        {Object.keys(results).filter(k => k !== 'metadata').length}
                      </div>
                      <div className="text-sm text-gray-600">Report{Object.keys(results).filter(k => k !== 'metadata').length > 1 ? 's' : ''} Generated</div>
                    </div>
                  </div>
                </div>
              )}
            </Card>

            {/* Individual proposal cards */}
            {Object.entries(results).filter(([key]) => key !== 'metadata').map(([filename, report]) => (
              <Card key={filename} className="border-2 hover:border-gray-300 transition-colors">
                <div className="space-y-4">
                  {/* Card header with quick info */}
                  <div className="flex justify-between items-start gap-4">
                    <div className="flex-1">
                      <h3 className="text-lg font-semibold text-gray-900 mb-2">{filename}</h3>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                        <div>
                          <span className="text-gray-600">PI:</span>
                          <span className="ml-2 font-medium text-gray-900">{report.structured?.pi || 'N/A'}</span>
                        </div>
                        <div>
                          <span className="text-gray-600">Institution:</span>
                          <span className="ml-2 font-medium text-gray-900">
                            {report.structured?.institution || 'N/A'}
                            {report.structured?.state && ` (${report.structured.state})`}
                          </span>
                        </div>
                        <div>
                          <span className="text-gray-600">NSF Funding:</span>
                          <span className="ml-2 font-medium text-gray-900">
                            {report.structured?.nsfTotalFunding || '$0'} ({report.structured?.nsfAwardCount || 0})
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => downloadIndividualReport(filename, report)}
                      >
                        📥 Download
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => toggleExpanded(filename)}
                      >
                        {expandedProposals[filename] ? '▲ Hide' : '▼ View Full Report'}
                      </Button>
                    </div>
                  </div>

                  {/* Expanded full report */}
                  {expandedProposals[filename] && (
                    <div className="pt-4 border-t border-gray-200">
                      <div
                        className="bg-gray-50 p-4 rounded-lg whitespace-pre-wrap font-mono text-xs overflow-x-auto"
                        style={{ maxHeight: '600px', overflowY: 'auto' }}
                      >
                        {report.formatted || 'No report available'}
                      </div>
                    </div>
                  )}

                  {/* Keywords preview (collapsed state only) */}
                  {!expandedProposals[filename] && report.structured?.keywords && report.structured.keywords.length > 0 && (
                    <div className="pt-3 border-t border-gray-200">
                      <p className="text-xs text-gray-600">
                        <strong>Keywords:</strong> {report.structured.keywords.slice(0, 5).join(', ')}
                        {report.structured.keywords.length > 5 && ` +${report.structured.keywords.length - 5} more`}
                      </p>
                    </div>
                  )}
                </div>
              </Card>
            ))}
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
              🔄 New Analysis
            </Button>
          </div>
        )}
      </div>
    </Layout>
  );
}

export default function FundingGapAnalyzerPage() {
  return <RequireAppAccess appKey="funding-gap-analyzer"><FundingGapAnalyzer /></RequireAppAccess>;
}
