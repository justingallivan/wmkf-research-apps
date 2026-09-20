import { useState, useCallback } from 'react';
import Layout, { PageHeader, Card, Button } from '../shared/components/Layout';
import FileUploaderSimple from '../shared/components/FileUploaderSimple';
import RequireAppAccess from '../shared/components/RequireAppAccess';
import ErrorAlert from '../shared/components/ErrorAlert';

/**
 * Single paper result card
 */
function PaperCard({ paper, index }) {
  const [expanded, setExpanded] = useState(false);

  if (paper.error) {
    return (
      <div className="bg-white border border-red-200 rounded-lg overflow-hidden">
        <div className="bg-red-50 p-4 border-b border-red-200">
          <h3 className="text-base font-medium text-gray-900">
            Paper {index + 1}: {paper.sourceFile || 'Error'}
          </h3>
        </div>
        <div className="p-4">
          <p className="text-red-600">{paper.error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="bg-gray-50 p-4 border-b border-gray-200">
        <div className="flex justify-between items-start gap-4">
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-medium text-gray-900">
              {paper.title || 'Untitled Paper'}
            </h3>
            {paper.authors?.length > 0 && (
              <p className="text-sm text-gray-600 mt-1">
                {paper.authors.slice(0, 3).join(', ')}
                {paper.authors.length > 3 ? ' et al.' : ''}
                {paper.year ? ` (${paper.year})` : ''}
              </p>
            )}
            {paper.journal && (
              <p className="text-sm text-gray-500 italic">{paper.journal}</p>
            )}
          </div>
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-sm text-blue-600 hover:text-blue-800 whitespace-nowrap"
          >
            {expanded ? 'Show less' : 'Show more'}
          </button>
        </div>
      </div>

      {/* Tags Row */}
      <div className="px-4 py-2 bg-gray-25 border-b border-gray-100 flex flex-wrap gap-2">
        {paper.researchType && (
          <span className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded-full text-xs">
            {paper.researchType}
          </span>
        )}
        {paper.relevance?.field && (
          <span className="px-2 py-0.5 bg-green-100 text-green-800 rounded-full text-xs">
            {paper.relevance.field}
          </span>
        )}
        {paper.keywords?.slice(0, 3).map((kw, i) => (
          <span key={i} className="px-2 py-0.5 bg-gray-100 text-gray-700 rounded-full text-xs">
            {kw}
          </span>
        ))}
      </div>

      {/* Abstract */}
      <div className="p-4">
        <p className="text-gray-700 text-sm leading-relaxed">
          {paper.abstract || 'No abstract available'}
        </p>

        {/* Expanded Details */}
        {expanded && (
          <div className="mt-4 pt-4 border-t border-gray-200 space-y-4">
            {/* Background */}
            {paper.background?.problem && (
              <div>
                <h4 className="text-sm font-medium text-gray-900">Research Problem</h4>
                <p className="text-sm text-gray-600 mt-1">{paper.background.problem}</p>
              </div>
            )}

            {/* Methods */}
            {paper.methods?.approach && (
              <div>
                <h4 className="text-sm font-medium text-gray-900">Methods</h4>
                <p className="text-sm text-gray-600 mt-1">{paper.methods.approach}</p>
                {paper.methods.techniques?.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {paper.methods.techniques.map((t, i) => (
                      <span key={i} className="px-2 py-0.5 bg-purple-100 text-purple-800 rounded text-xs">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Key Findings */}
            {paper.findings?.main?.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-gray-900">Key Findings</h4>
                <ul className="list-disc list-inside text-sm text-gray-600 mt-1 space-y-1">
                  {paper.findings.main.map((f, i) => <li key={i}>{f}</li>)}
                </ul>
              </div>
            )}

            {/* Conclusions */}
            {paper.conclusions?.summary && (
              <div>
                <h4 className="text-sm font-medium text-gray-900">Conclusions</h4>
                <p className="text-sm text-gray-600 mt-1">{paper.conclusions.summary}</p>
              </div>
            )}

            {paper.conclusions?.implications && (
              <div>
                <h4 className="text-sm font-medium text-gray-900">Implications</h4>
                <p className="text-sm text-gray-600 mt-1">{paper.conclusions.implications}</p>
              </div>
            )}

            {paper.conclusions?.limitations && (
              <div>
                <h4 className="text-sm font-medium text-gray-900">Limitations</h4>
                <p className="text-sm text-gray-600 mt-1">{paper.conclusions.limitations}</p>
              </div>
            )}

            {/* Source File */}
            <div className="pt-2 text-xs text-gray-500 flex items-center gap-2">
              <span>Source: {paper.sourceFile}</span>
              {paper.doi && (
                <a
                  href={`https://doi.org/${paper.doi}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  DOI
                </a>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Synthesis section component
 */
function SynthesisSection({ synthesis }) {
  const [expandedSections, setExpandedSections] = useState({
    themes: true,
    findings: true,
    gaps: false,
    methods: false
  });

  const toggleSection = (section) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  if (!synthesis || synthesis.error) {
    return (
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
        <p className="text-yellow-800">
          {synthesis?.error || 'Synthesis not available. Upload at least 2 papers for cross-paper synthesis.'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Overview */}
      <div className="bg-blue-50 p-4 rounded-lg">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">Overview</h3>
        <p className="text-gray-700">{synthesis.overview?.briefSummary}</p>
        <div className="mt-2 flex gap-4 text-sm text-gray-600">
          <span>{synthesis.overview?.paperCount} papers analyzed</span>
          {synthesis.overview?.dateRange && <span>{synthesis.overview.dateRange}</span>}
          {synthesis.overview?.primaryField && <span>{synthesis.overview.primaryField}</span>}
        </div>
      </div>

      {/* Narrative Synthesis */}
      {synthesis.synthesis && (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Synthesis</h3>
          <p className="text-gray-700 leading-relaxed">{synthesis.synthesis}</p>
        </div>
      )}

      {/* Themes */}
      {synthesis.themes?.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <button
            className="w-full p-4 text-left flex justify-between items-center hover:bg-gray-50"
            onClick={() => toggleSection('themes')}
          >
            <h3 className="text-lg font-semibold text-gray-900">Themes ({synthesis.themes.length})</h3>
            <span className="text-gray-500">{expandedSections.themes ? '−' : '+'}</span>
          </button>
          {expandedSections.themes && (
            <div className="p-4 pt-0 space-y-4">
              {synthesis.themes.map((theme, i) => (
                <div key={i} className="border-t border-gray-100 pt-4 first:border-0 first:pt-0">
                  <h4 className="font-medium text-gray-900">{theme.theme}</h4>
                  <p className="text-sm text-gray-600 mt-1">{theme.description}</p>
                  {theme.consensus && (
                    <p className="text-sm text-green-700 mt-2">
                      <span className="font-medium">Consensus:</span> {theme.consensus}
                    </p>
                  )}
                  {theme.disagreements && (
                    <p className="text-sm text-orange-700 mt-1">
                      <span className="font-medium">Disagreements:</span> {theme.disagreements}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Key Findings */}
      {synthesis.keyFindings && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <button
            className="w-full p-4 text-left flex justify-between items-center hover:bg-gray-50"
            onClick={() => toggleSection('findings')}
          >
            <h3 className="text-lg font-semibold text-gray-900">Key Findings</h3>
            <span className="text-gray-500">{expandedSections.findings ? '−' : '+'}</span>
          </button>
          {expandedSections.findings && (
            <div className="p-4 pt-0 space-y-3">
              {synthesis.keyFindings.established?.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-green-800">Established Findings</h4>
                  <ul className="list-disc list-inside text-sm text-gray-600 mt-1">
                    {synthesis.keyFindings.established.map((f, i) => <li key={i}>{f}</li>)}
                  </ul>
                </div>
              )}
              {synthesis.keyFindings.emerging?.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-blue-800">Emerging Findings</h4>
                  <ul className="list-disc list-inside text-sm text-gray-600 mt-1">
                    {synthesis.keyFindings.emerging.map((f, i) => <li key={i}>{f}</li>)}
                  </ul>
                </div>
              )}
              {synthesis.keyFindings.contradictory?.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-orange-800">Contradictory Findings</h4>
                  <ul className="list-disc list-inside text-sm text-gray-600 mt-1">
                    {synthesis.keyFindings.contradictory.map((f, i) => <li key={i}>{f}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Research Gaps */}
      {synthesis.gaps && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <button
            className="w-full p-4 text-left flex justify-between items-center hover:bg-gray-50"
            onClick={() => toggleSection('gaps')}
          >
            <h3 className="text-lg font-semibold text-gray-900">Research Gaps</h3>
            <span className="text-gray-500">{expandedSections.gaps ? '−' : '+'}</span>
          </button>
          {expandedSections.gaps && (
            <div className="p-4 pt-0 space-y-3">
              {synthesis.gaps.identified?.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-gray-900">Identified by Authors</h4>
                  <ul className="list-disc list-inside text-sm text-gray-600 mt-1">
                    {synthesis.gaps.identified.map((g, i) => <li key={i}>{g}</li>)}
                  </ul>
                </div>
              )}
              {synthesis.gaps.inferred?.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-gray-900">Inferred from Analysis</h4>
                  <ul className="list-disc list-inside text-sm text-gray-600 mt-1">
                    {synthesis.gaps.inferred.map((g, i) => <li key={i}>{g}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Methodological Approaches */}
      {synthesis.methodologicalApproaches && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <button
            className="w-full p-4 text-left flex justify-between items-center hover:bg-gray-50"
            onClick={() => toggleSection('methods')}
          >
            <h3 className="text-lg font-semibold text-gray-900">Methodological Approaches</h3>
            <span className="text-gray-500">{expandedSections.methods ? '−' : '+'}</span>
          </button>
          {expandedSections.methods && (
            <div className="p-4 pt-0 space-y-3">
              {synthesis.methodologicalApproaches.common?.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  <span className="text-sm font-medium text-gray-700">Common:</span>
                  {synthesis.methodologicalApproaches.common.map((m, i) => (
                    <span key={i} className="px-2 py-0.5 bg-gray-100 text-gray-700 rounded text-sm">{m}</span>
                  ))}
                </div>
              )}
              {synthesis.methodologicalApproaches.comparison && (
                <p className="text-sm text-gray-600">{synthesis.methodologicalApproaches.comparison}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Future Directions */}
      {synthesis.futureDirections?.synthesis && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Future Research Directions</h3>
          <p className="text-gray-700">{synthesis.futureDirections.synthesis}</p>
        </div>
      )}
    </div>
  );
}

function LiteratureAnalyzer() {
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState(null);
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState('');
  const [error, setError] = useState(null);
  const [focusTopic, setFocusTopic] = useState('');
  const [activeTab, setActiveTab] = useState('papers');

  const handleFilesUploaded = useCallback((uploadedFiles) => {
    setSelectedFiles(uploadedFiles);
    setError(null);
    setResults(null);
  }, []);

  const analyzePapers = async () => {
    if (selectedFiles.length === 0) {
      setError('Please upload at least one PDF file');
      return;
    }

    setProcessing(true);
    setProgress(0);
    setProgressText('Starting analysis...');
    setError(null);

    try {
      // eslint-disable-next-line no-restricted-syntax -- raw fetch: SSE stream (response.body.getReader() below); allowlisted per CLIENT_REQUEST_LAYER_PLAN §2.6
      const response = await fetch('/api/analyze-literature', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          files: selectedFiles,
          options: {
            focusTopic: focusTopic.trim() || null
          }
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

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;

        // Process complete lines
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

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
                  if (data.results) {
                    setResults(data.results);
                  }
                }
              }
            } catch (parseError) {
              continue;
            }
          }
        }
      }

      setProgressText('Analysis complete!');
      setSelectedFiles([]);

    } catch (error) {
      console.error('Analysis error:', error);
      setError(error.message || 'Failed to analyze papers');
    } finally {
      setProcessing(false);
    }
  };

  const exportAsJson = () => {
    if (!results) return;

    const blob = new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `literature_analysis_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportAsMarkdown = () => {
    if (!results) return;

    let content = `# Literature Analysis Report\n\n`;
    content += `Generated: ${new Date().toLocaleDateString()}\n`;
    content += `Papers Analyzed: ${results.summary?.totalPapers || 0}\n`;
    content += `Successful Extractions: ${results.summary?.successfulExtractions || 0}\n\n`;
    content += `---\n\n`;

    // Synthesis section
    if (results.synthesis && !results.synthesis.error) {
      content += `## Synthesis\n\n`;
      if (results.synthesis.overview?.briefSummary) {
        content += `### Overview\n\n${results.synthesis.overview.briefSummary}\n\n`;
      }
      if (results.synthesis.synthesis) {
        content += `### Summary\n\n${results.synthesis.synthesis}\n\n`;
      }

      // Themes
      if (results.synthesis.themes?.length > 0) {
        content += `### Themes\n\n`;
        results.synthesis.themes.forEach((theme, i) => {
          content += `**${i + 1}. ${theme.theme}**\n\n`;
          content += `${theme.description}\n\n`;
          if (theme.consensus) content += `- *Consensus:* ${theme.consensus}\n`;
          if (theme.disagreements) content += `- *Disagreements:* ${theme.disagreements}\n`;
          content += `\n`;
        });
      }

      // Key Findings
      if (results.synthesis.keyFindings) {
        content += `### Key Findings\n\n`;
        if (results.synthesis.keyFindings.established?.length > 0) {
          content += `**Established:**\n`;
          results.synthesis.keyFindings.established.forEach(f => content += `- ${f}\n`);
          content += `\n`;
        }
        if (results.synthesis.keyFindings.emerging?.length > 0) {
          content += `**Emerging:**\n`;
          results.synthesis.keyFindings.emerging.forEach(f => content += `- ${f}\n`);
          content += `\n`;
        }
      }

      // Research Gaps
      if (results.synthesis.gaps) {
        content += `### Research Gaps\n\n`;
        if (results.synthesis.gaps.identified?.length > 0) {
          content += `**Identified by Authors:**\n`;
          results.synthesis.gaps.identified.forEach(g => content += `- ${g}\n`);
          content += `\n`;
        }
        if (results.synthesis.gaps.inferred?.length > 0) {
          content += `**Inferred:**\n`;
          results.synthesis.gaps.inferred.forEach(g => content += `- ${g}\n`);
          content += `\n`;
        }
      }

      // Future Directions
      if (results.synthesis.futureDirections?.synthesis) {
        content += `### Future Research Directions\n\n${results.synthesis.futureDirections.synthesis}\n\n`;
      }
    }

    content += `---\n\n## Individual Papers\n\n`;

    // Paper details
    results.papers?.forEach((paper, index) => {
      content += `### ${index + 1}. ${paper.title || 'Untitled'}\n\n`;

      if (paper.error) {
        content += `**Error:** ${paper.error}\n\n`;
      } else {
        if (paper.authors?.length > 0) {
          const authorStr = paper.authors.slice(0, 5).join(', ');
          content += `**Authors:** ${authorStr}${paper.authors.length > 5 ? ' et al.' : ''}\n`;
        }
        if (paper.year) content += `**Year:** ${paper.year}\n`;
        if (paper.journal) content += `**Journal:** ${paper.journal}\n`;
        if (paper.doi) content += `**DOI:** ${paper.doi}\n`;
        content += `\n`;

        if (paper.abstract) {
          content += `**Abstract:** ${paper.abstract}\n\n`;
        }

        if (paper.findings?.main?.length > 0) {
          content += `**Key Findings:**\n`;
          paper.findings.main.forEach(f => content += `- ${f}\n`);
          content += `\n`;
        }

        if (paper.conclusions?.summary) {
          content += `**Conclusions:** ${paper.conclusions.summary}\n\n`;
        }

        if (paper.keywords?.length > 0) {
          content += `**Keywords:** ${paper.keywords.join(', ')}\n\n`;
        }
      }

      content += `---\n\n`;
    });

    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `literature_analysis_${new Date().toISOString().split('T')[0]}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Layout
      title="Literature Analyzer"
      description="Analyze and synthesize research papers"
    >
      <PageHeader
        title="Literature Analyzer"
        subtitle="Upload research papers for AI-powered analysis and cross-paper synthesis"
        icon="📖"
      />

      <ErrorAlert error={error} onDismiss={() => setError(null)} />

      <div className="space-y-6">
        {/* Instructions */}
        <Card>
          <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <span>📋</span>
            <span>How It Works</span>
          </h2>
          <div className="text-gray-700 space-y-2">
            <p>1. Upload one or more research paper PDFs</p>
            <p>2. Claude Vision analyzes each paper to extract key information</p>
            <p>3. For multiple papers, a synthesis is generated identifying themes and patterns</p>
            <p>4. Export results as JSON or Markdown for your literature review</p>
          </div>
        </Card>

        {/* File Upload */}
        <Card>
          <div className="mb-4">
            <h2 className="text-xl font-semibold text-gray-900 mb-2 flex items-center gap-2">
              <span>📁</span>
              <span>Upload Research Papers</span>
            </h2>
            <p className="text-sm text-gray-600">
              Upload PDF files of research papers (articles, reviews, etc.)
            </p>
          </div>
          <FileUploaderSimple
            onFilesUploaded={handleFilesUploaded}
            multiple={true}
            accept=".pdf"
            maxSize={50 * 1024 * 1024}
          />

          {/* Focus Topic Input */}
          {selectedFiles.length > 1 && (
            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Focus Topic (optional)
              </label>
              <input
                type="text"
                value={focusTopic}
                onChange={(e) => setFocusTopic(e.target.value)}
                placeholder="e.g., 'machine learning in healthcare' or 'climate change impacts'"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <p className="mt-1 text-xs text-gray-500">
                Specify a topic to focus the synthesis on specific aspects across papers
              </p>
            </div>
          )}
        </Card>

        {/* Ready State */}
        {selectedFiles.length > 0 && !processing && !results && (
          <Card className="bg-green-50 border-green-200">
            <div className="text-center">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Ready to Analyze</h3>
              <p className="text-gray-700 mb-4">
                {selectedFiles.length} paper{selectedFiles.length > 1 ? 's' : ''} uploaded
                {selectedFiles.length > 1 && ' - synthesis will be generated'}
              </p>
              <Button
                variant="primary"
                size="lg"
                onClick={analyzePapers}
              >
                📖 Analyze Papers
              </Button>
            </div>
          </Card>
        )}

        {/* Processing State */}
        {processing && (
          <Card>
            <div className="text-center">
              <div className="flex items-center justify-center gap-3 mb-4">
                <div className="animate-spin rounded-full h-6 w-6 border-2 border-gray-400 border-t-transparent"></div>
                <span className="text-gray-700 font-medium">{progressText}</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-3 mb-2">
                <div
                  className="bg-blue-600 h-3 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="text-sm text-gray-600">{progress}%</div>
            </div>
          </Card>
        )}

        {/* Results */}
        {results && (
          <Card className="mt-8">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
                <span>📊</span>
                <span>Analysis Results</span>
              </h2>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={exportAsJson}>
                  📋 Export JSON
                </Button>
                <Button variant="secondary" onClick={exportAsMarkdown}>
                  📝 Export Markdown
                </Button>
              </div>
            </div>

            {/* Summary Stats */}
            <div className="bg-blue-50 p-4 rounded-lg mb-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                <div>
                  <div className="text-2xl font-bold text-gray-900">
                    {results.summary?.totalPapers || 0}
                  </div>
                  <div className="text-sm text-gray-600">Papers Uploaded</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-green-600">
                    {results.summary?.successfulExtractions || 0}
                  </div>
                  <div className="text-sm text-gray-600">Successfully Analyzed</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-blue-600">
                    {results.synthesis?.themes?.length || 0}
                  </div>
                  <div className="text-sm text-gray-600">Themes Identified</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-red-600">
                    {results.summary?.errors || 0}
                  </div>
                  <div className="text-sm text-gray-600">Errors</div>
                </div>
              </div>
            </div>

            {/* Tabs */}
            <div className="border-b border-gray-200 mb-6">
              <nav className="flex gap-4">
                <button
                  onClick={() => setActiveTab('synthesis')}
                  className={`pb-2 px-1 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === 'synthesis'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Synthesis
                </button>
                <button
                  onClick={() => setActiveTab('papers')}
                  className={`pb-2 px-1 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === 'papers'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Individual Papers ({results.papers?.length || 0})
                </button>
              </nav>
            </div>

            {/* Tab Content */}
            {activeTab === 'synthesis' && (
              <SynthesisSection synthesis={results.synthesis} />
            )}

            {activeTab === 'papers' && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {results.papers?.map((paper, index) => (
                  <PaperCard key={index} paper={paper} index={index} />
                ))}
              </div>
            )}
          </Card>
        )}

        {/* New Analysis Button */}
        {results && !processing && (
          <div className="flex justify-center mt-6">
            <Button
              variant="secondary"
              onClick={() => {
                setResults(null);
                setProgress(0);
                setProgressText('');
                setFocusTopic('');
                setActiveTab('papers');
              }}
            >
              📖 New Analysis
            </Button>
          </div>
        )}
      </div>
    </Layout>
  );
}

export default function LiteratureAnalyzerPage() {
  return <RequireAppAccess appKey="literature-analyzer"><LiteratureAnalyzer /></RequireAppAccess>;
}
