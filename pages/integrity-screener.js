import { useState, useCallback } from 'react';
import Layout, { PageHeader, Card, Button } from '../shared/components/Layout';
import HelpButton from '../shared/components/HelpButton';
import RequireAppAccess from '../shared/components/RequireAppAccess';
import ErrorAlert from '../shared/components/ErrorAlert';

/**
 * Confidence badge component
 */
function ConfidenceBadge({ confidence }) {
  let colorClass = 'bg-gray-100 text-gray-800 border-gray-200';
  let label = 'Low';

  if (confidence >= 90) {
    colorClass = 'bg-red-100 text-red-800 border-red-200';
    label = 'High';
  } else if (confidence >= 70) {
    colorClass = 'bg-yellow-100 text-yellow-800 border-yellow-200';
    label = 'Medium';
  } else if (confidence >= 50) {
    colorClass = 'bg-orange-100 text-orange-800 border-orange-200';
    label = 'Low';
  }

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${colorClass}`}>
      {confidence}% ({label})
    </span>
  );
}

/**
 * Retraction match card
 */
function RetractionMatchCard({ match, onDismiss }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
      <div className="p-4 bg-gray-50 border-b border-gray-200">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-medium text-gray-500 uppercase">Retraction Watch</span>
              <ConfidenceBadge confidence={match.confidence} />
            </div>
            <h4 className="text-sm font-medium text-gray-900 line-clamp-2">{match.title}</h4>
          </div>
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-sm text-blue-600 hover:text-blue-800 whitespace-nowrap"
          >
            {expanded ? 'Less' : 'More'}
          </button>
        </div>
      </div>

      <div className="p-4 space-y-2">
        {match.retractionNature && (
          <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded ${
            match.retractionNature.toLowerCase().includes('retraction')
              ? 'bg-red-100 text-red-800'
              : 'bg-yellow-100 text-yellow-800'
          }`}>
            {match.retractionNature}
          </span>
        )}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600">
          {match.journal && <span>Journal: {match.journal}</span>}
          {match.retractionDate && <span>Date: {new Date(match.retractionDate).toLocaleDateString()}</span>}
        </div>

        {match.reasons && match.reasons.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {match.reasons.map((reason, i) => (
              <span key={i} className="inline-flex px-2 py-0.5 text-xs bg-red-50 text-red-700 rounded">
                {reason}
              </span>
            ))}
          </div>
        )}

        {expanded && (
          <div className="mt-3 pt-3 border-t border-gray-200 space-y-2 text-sm text-gray-600">
            {match.authors && <p><strong>Authors:</strong> {match.authors}</p>}
            {match.matchedAuthor && <p><strong>Matched Name:</strong> {match.matchedAuthor}</p>}
            {match.institution && <p><strong>Institution:</strong> {match.institution}</p>}
            {match.doi && (
              <p>
                <strong>DOI:</strong>{' '}
                <a href={`https://doi.org/${match.doi}`} target="_blank" rel="noopener noreferrer"
                   className="text-blue-600 hover:underline">
                  {match.doi}
                </a>
              </p>
            )}
          </div>
        )}

        <div className="flex gap-2 pt-2">
          {match.urls && (
            <a
              href={match.urls.split(';')[0].trim()}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-600 hover:underline"
            >
              View Source
            </a>
          )}
          <button
            onClick={() => onDismiss(match, 'retraction_watch')}
            className="text-xs text-gray-500 hover:text-gray-700"
          >
            Dismiss - Different Person
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * AI-analyzed result card (PubPeer or News)
 */
function AIResultCard({ source, result, onDismiss, screenedName }) {
  const sourceLabels = {
    pubpeer: 'PubPeer',
    news: 'News Search',
  };

  const hasConcerns = result.hasConcerns;

  return (
    <div className={`border rounded-lg bg-white overflow-hidden ${hasConcerns ? 'border-yellow-300' : 'border-gray-200'}`}>
      <div className={`p-4 border-b ${hasConcerns ? 'bg-yellow-50 border-yellow-200' : 'bg-gray-50 border-gray-200'}`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <span className="text-xs font-medium text-gray-500 uppercase">{sourceLabels[source]}</span>
            {hasConcerns ? (
              <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 border border-yellow-200">
                Review Needed
              </span>
            ) : (
              <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 border border-green-200">
                Clear
              </span>
            )}
          </div>
          {result.resultCount > 0 && (
            <span className="text-xs text-gray-500">{result.resultCount} results</span>
          )}
        </div>
      </div>

      <div className="p-4">
        <p className="text-sm text-gray-700 whitespace-pre-wrap">{result.summary}</p>

        <div className="flex gap-2 pt-3 mt-3 border-t border-gray-100">
          {result.searchUrl && (
            <a
              href={result.searchUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-600 hover:underline"
            >
              View on PubPeer
            </a>
          )}
          {hasConcerns && (
            <button
              onClick={() => onDismiss({ source, summary: result.summary }, source)}
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              Dismiss
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Applicant result card
 */
function ApplicantResultCard({ result, onDismiss }) {
  const [expanded, setExpanded] = useState(result.hasConcerns);
  const detailsId = `integrity-result-${String(result.name || 'applicant').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

  const retractionMatches = result.sources.retraction_watch?.matches || [];
  const pubpeerResult = result.sources.pubpeer || {};
  const newsResult = result.sources.news || {};

  return (
    <div className={`border rounded-lg bg-white overflow-hidden ${result.hasConcerns ? 'border-yellow-400 ring-1 ring-yellow-200' : 'border-gray-200'}`}>
      {/* Header */}
      <div className={`p-4 border-b ${result.hasConcerns ? 'bg-yellow-50 border-yellow-200' : 'bg-gray-50 border-gray-200'}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-lg font-semibold text-gray-900">{result.name}</h3>
              {result.isCommonName && (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-blue-100 text-blue-700">
                  Common Name
                </span>
              )}
            </div>
            {result.institution && (
              <p className="text-sm text-gray-600 mt-1">{result.institution}</p>
            )}
          </div>

          <div className="flex items-center gap-3">
            {result.hasConcerns ? (
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-yellow-100 text-yellow-800 border border-yellow-300">
                {result.matchCount} item{result.matchCount !== 1 ? 's' : ''} for review
              </span>
            ) : (
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800 border border-green-300">
                No concerns
              </span>
            )}
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="rounded-lg px-2 py-1 text-sm text-blue-600 hover:bg-blue-50 hover:text-blue-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              aria-expanded={expanded}
              aria-controls={detailsId}
            >
              {expanded ? 'Collapse' : 'Expand'}
            </button>
          </div>
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div id={detailsId} className="p-4 space-y-4">
          {/* Retraction Watch results */}
          {result.sources.retraction_watch?.searched && (
            <div>
              {retractionMatches.length > 0 ? (
                <>
                  <h4 className="text-sm font-medium text-gray-700 mb-2">
                    Retraction Watch ({retractionMatches.length} match{retractionMatches.length !== 1 ? 'es' : ''})
                  </h4>
                  <div className="space-y-3">
                    {retractionMatches.map((match, i) => (
                      <RetractionMatchCard key={i} match={match} onDismiss={onDismiss} />
                    ))}
                  </div>
                </>
              ) : (
                <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
                  <div className="p-4 bg-gray-50 border-b border-gray-200">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-gray-500 uppercase">Retraction Watch</span>
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 border border-green-200">
                        Clear
                      </span>
                    </div>
                  </div>
                  <div className="p-4">
                    <p className="text-sm text-gray-700">No retractions found in the database.</p>
                  </div>
                </div>
              )}
              {result.sources.retraction_watch?.error && (
                <p className="text-xs text-red-600 mt-2">Error: {result.sources.retraction_watch.error}</p>
              )}
            </div>
          )}

          {/* PubPeer results */}
          {pubpeerResult.searched && (
            <AIResultCard
              source="pubpeer"
              result={pubpeerResult}
              onDismiss={onDismiss}
              screenedName={result.name}
            />
          )}

          {/* News results */}
          {newsResult.searched && (
            <AIResultCard
              source="news"
              result={newsResult}
              onDismiss={onDismiss}
              screenedName={result.name}
            />
          )}

          {/* No sources searched message (shouldn't normally happen) */}
          {!result.sources.retraction_watch?.searched &&
           !result.sources.pubpeer?.searched &&
           !result.sources.news?.searched && (
            <p className="text-sm text-gray-600">
              No sources were searched for this applicant.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Applicant input row
 */
function ApplicantInputRow({ applicant, index, onUpdate, onRemove, canRemove }) {
  return (
    <div className="flex gap-3 items-start">
      <div className="flex-1">
        <label htmlFor={`applicant-name-${index}`} className="sr-only">Applicant {index + 1} full name</label>
        <input
          id={`applicant-name-${index}`}
          type="text"
          value={applicant.name}
          onChange={(e) => onUpdate(index, 'name', e.target.value)}
          placeholder="Full Name"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>
      <div className="flex-1">
        <label htmlFor={`applicant-institution-${index}`} className="sr-only">Applicant {index + 1} institution</label>
        <input
          id={`applicant-institution-${index}`}
          type="text"
          value={applicant.institution}
          onChange={(e) => onUpdate(index, 'institution', e.target.value)}
          placeholder="Institution (optional)"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>
      {canRemove && (
        <button
          type="button"
          onClick={() => onRemove(index)}
          className="min-h-9 rounded-lg px-3 py-2 text-red-600 hover:bg-red-50 hover:text-red-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
        >
          Remove
        </button>
      )}
    </div>
  );
}

/**
 * Main page component
 */
function IntegrityScreenerPage() {
  // State
  const [applicants, setApplicants] = useState([
    { name: '', institution: '' }
  ]);
  const [results, setResults] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressMessage, setProgressMessage] = useState('');
  const [error, setError] = useState(null);

  // Applicant management
  const addApplicant = useCallback(() => {
    setApplicants(prev => [...prev, { name: '', institution: '' }]);
  }, []);

  const removeApplicant = useCallback((index) => {
    setApplicants(prev => prev.filter((_, i) => i !== index));
  }, []);

  const updateApplicant = useCallback((index, field, value) => {
    setApplicants(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  }, []);

  // Run screening
  const runScreening = useCallback(async () => {
    // Validate
    const validApplicants = applicants.filter(a => a.name.trim().length > 0);
    if (validApplicants.length === 0) {
      setError('Please enter at least one applicant name');
      return;
    }

    setIsProcessing(true);
    setError(null);
    setResults(null);
    setProgressMessage('Starting screening...');

    try {
      const response = await fetch('/api/integrity-screener/screen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          applicants: validApplicants,
        }),
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.message) {
                setProgressMessage(data.message);
              }

              if (data.results) {
                setResults(data);
              }

              if (data.error) {
                setError(data.message || 'An error occurred');
              }
            } catch (e) {
              // Ignore parse errors
            }
          }
        }
      }
    } catch (err) {
      setError(err.message || 'Failed to connect to screening service');
    } finally {
      setIsProcessing(false);
      setProgressMessage('');
    }
  }, [applicants]);

  // Handle dismissal (placeholder - would need screening ID for persistence)
  const handleDismiss = useCallback((match, source) => {
    // For now, just log - in full implementation this would call the dismiss API
    console.log('Dismiss:', { match, source });
    alert('Dismissal noted. In full implementation, this would be saved to database.');
  }, []);

  // Export results as PDF
  const exportPdf = useCallback(async () => {
    if (!results) return;

    try {
      const { PDFReportBuilder, downloadPdf } = await import('../shared/utils/pdf-export');
      const builder = new PDFReportBuilder();
      await builder.init();

      const dateStr = new Date().toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric',
      });

      builder
        .addTitle('Integrity Screening Report')
        .addMetadata('Date', dateStr)
        .addMetadata('Total Applicants', String(results.results.length))
        .addMetadata('Applicants with Concerns', String(results.applicantsWithConcerns))
        .addMetadata('Total Matches', String(results.totalMatches))
        .addDivider();

      results.results.forEach((result, index) => {
        if (index > 0) builder.addPage();

        builder.addSection(`${index + 1}. ${result.name}`);
        if (result.institution) {
          builder.addKeyValue('Institution', result.institution);
        }
        builder.addBadge(
          result.hasConcerns ? 'Review Needed' : 'No Concerns',
          result.hasConcerns ? 'warning' : 'success'
        );
        if (result.isCommonName) {
          builder.addParagraph('Note: Common name (higher false positive risk)', { font: 'italic' });
        }

        // Retraction Watch
        const retractionMatches = result.sources.retraction_watch?.matches || [];
        if (result.sources.retraction_watch?.searched) {
          builder.addSection('Retraction Watch', 2);
          if (retractionMatches.length > 0) {
            builder.addParagraph(`${retractionMatches.length} match${retractionMatches.length !== 1 ? 'es' : ''} found`, { font: 'bold' });
            retractionMatches.forEach((match) => {
              builder.addSpace(5);
              builder.addParagraph(match.title || 'Untitled', { font: 'bold' });
              if (match.confidence) builder.addKeyValue('Confidence', `${match.confidence}%`);
              if (match.retractionNature) builder.addKeyValue('Action', match.retractionNature);
              if (match.journal) builder.addKeyValue('Journal', match.journal);
              if (match.retractionDate) builder.addKeyValue('Date', new Date(match.retractionDate).toLocaleDateString());
              if (match.reasons?.length > 0) builder.addKeyValue('Reasons', match.reasons.join(', '));
              if (match.authors) builder.addKeyValue('Authors', match.authors);
              if (match.matchedAuthor) builder.addKeyValue('Matched Name', match.matchedAuthor);
              if (match.institution) builder.addKeyValue('Institution', match.institution);
              if (match.doi) builder.addKeyValue('DOI', match.doi);
            });
          } else {
            builder.addParagraph('No retractions found in the database.');
          }
          if (result.sources.retraction_watch?.error) {
            builder.addParagraph(`Error: ${result.sources.retraction_watch.error}`, { font: 'italic' });
          }
        }

        // PubPeer
        const pubpeerResult = result.sources.pubpeer || {};
        if (pubpeerResult.searched) {
          builder.addSection('PubPeer', 2);
          builder.addBadge(
            pubpeerResult.hasConcerns ? 'Review Needed' : 'Clear',
            pubpeerResult.hasConcerns ? 'warning' : 'success'
          );
          if (pubpeerResult.resultCount > 0) {
            builder.addKeyValue('Results Found', String(pubpeerResult.resultCount));
          }
          if (pubpeerResult.summary) {
            builder.addParagraph(pubpeerResult.summary);
          }
        }

        // News
        const newsResult = result.sources.news || {};
        if (newsResult.searched) {
          builder.addSection('News Search', 2);
          builder.addBadge(
            newsResult.hasConcerns ? 'Review Needed' : 'Clear',
            newsResult.hasConcerns ? 'warning' : 'success'
          );
          if (newsResult.resultCount > 0) {
            builder.addKeyValue('Results Found', String(newsResult.resultCount));
          }
          if (newsResult.summary) {
            builder.addParagraph(newsResult.summary);
          }
        }
      });

      const pdfBytes = await builder.build();
      downloadPdf(pdfBytes, `integrity-screening-${new Date().toISOString().split('T')[0]}.pdf`);

    } catch (err) {
      console.error('PDF export error:', err);
      setError('Failed to export PDF: ' + err.message);
    }
  }, [results]);

  // Export results as JSON
  const exportJSON = useCallback(() => {
    if (!results) return;

    const report = {
      screenedAt: new Date().toISOString(),
      applicants: results.results,
      summary: {
        totalApplicants: results.results.length,
        applicantsWithConcerns: results.applicantsWithConcerns,
        totalMatches: results.totalMatches,
      },
    };

    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `integrity-screening-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [results]);

  // Export results as Markdown
  const exportMarkdown = useCallback(() => {
    if (!results) return;

    const dateStr = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    let md = `# Integrity Screening Report\n\n`;
    md += `**Date:** ${dateStr}\n\n`;
    md += `## Summary\n\n`;
    md += `- **Total Applicants Screened:** ${results.results.length}\n`;
    md += `- **Applicants with Concerns:** ${results.applicantsWithConcerns}\n`;
    md += `- **Total Matches Found:** ${results.totalMatches}\n\n`;
    md += `---\n\n`;

    results.results.forEach((result, index) => {
      md += `## ${index + 1}. ${result.name}\n\n`;
      if (result.institution) {
        md += `- **Institution:** ${result.institution}\n`;
      }
      md += `- **Status:** ${result.hasConcerns ? '⚠️ Review Needed' : '✓ No Concerns'}\n`;
      if (result.isCommonName) {
        md += `- **Note:** Common name (higher false positive risk)\n`;
      }
      md += `\n`;

      // Retraction Watch results
      const retractionMatches = result.sources.retraction_watch?.matches || [];
      if (result.sources.retraction_watch?.searched) {
        md += `### Retraction Watch\n\n`;
        if (retractionMatches.length > 0) {
          md += `**${retractionMatches.length} match${retractionMatches.length !== 1 ? 'es' : ''} found**\n\n`;
          retractionMatches.forEach((match, i) => {
            md += `#### Match ${i + 1}: ${match.title}\n\n`;
            md += `- **Confidence:** ${match.confidence}%\n`;
            if (match.retractionNature) md += `- **Action:** ${match.retractionNature}\n`;
            if (match.journal) md += `- **Journal:** ${match.journal}\n`;
            if (match.retractionDate) {
              md += `- **Date:** ${new Date(match.retractionDate).toLocaleDateString()}\n`;
            }
            if (match.reasons && match.reasons.length > 0) {
              md += `- **Reasons:** ${match.reasons.join(', ')}\n`;
            }
            if (match.authors) md += `- **Authors:** ${match.authors}\n`;
            if (match.matchedAuthor) md += `- **Matched Name:** ${match.matchedAuthor}\n`;
            if (match.institution) md += `- **Institution:** ${match.institution}\n`;
            if (match.doi) md += `- **DOI:** [${match.doi}](https://doi.org/${match.doi})\n`;
            if (match.urls) md += `- **Source:** [View on Retraction Watch](${match.urls.split(';')[0].trim()})\n`;
            md += `\n`;
          });
        } else {
          md += `- **Status:** ✓ Clear\n\n`;
          md += `No retractions found in the database.\n\n`;
        }
        if (result.sources.retraction_watch?.error) {
          md += `*Error: ${result.sources.retraction_watch.error}*\n\n`;
        }
      }

      // PubPeer results
      const pubpeerResult = result.sources.pubpeer || {};
      if (pubpeerResult.searched) {
        md += `### PubPeer\n\n`;
        md += `- **Status:** ${pubpeerResult.hasConcerns ? '⚠️ Review Needed' : '✓ Clear'}\n`;
        if (pubpeerResult.resultCount > 0) {
          md += `- **Results Found:** ${pubpeerResult.resultCount}\n`;
        }
        md += `\n${pubpeerResult.summary}\n\n`;
        if (pubpeerResult.searchUrl) {
          md += `[View on PubPeer](${pubpeerResult.searchUrl})\n\n`;
        }
      }

      // News results
      const newsResult = result.sources.news || {};
      if (newsResult.searched) {
        md += `### News Search\n\n`;
        md += `- **Status:** ${newsResult.hasConcerns ? '⚠️ Review Needed' : '✓ Clear'}\n`;
        if (newsResult.resultCount > 0) {
          md += `- **Results Found:** ${newsResult.resultCount}\n`;
        }
        md += `\n${newsResult.summary}\n\n`;
      }


      md += `---\n\n`;
    });

    md += `*Report generated by Applicant Integrity Screener*\n`;

    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `integrity-screening-${new Date().toISOString().split('T')[0]}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [results]);

  return (
    <Layout>
      <PageHeader
        title="Applicant Integrity Screener"
        subtitle="Screen grant applicants for research integrity concerns"
      >
        <HelpButton appKey="integrity-screener" className="mt-3" />
      </PageHeader>

      <div className="max-w-5xl mx-auto space-y-6">
        {/* Input Form */}
        <Card title="Applicants to Screen">
          <div className="space-y-4">
            <div className="space-y-3">
              {applicants.map((applicant, index) => (
                <ApplicantInputRow
                  key={index}
                  applicant={applicant}
                  index={index}
                  onUpdate={updateApplicant}
                  onRemove={removeApplicant}
                  canRemove={applicants.length > 1}
                />
              ))}
            </div>

            <button
              onClick={addApplicant}
              className="text-sm text-blue-600 hover:text-blue-800"
            >
              + Add Another Applicant
            </button>

            <div className="pt-4 border-t border-gray-200 flex justify-end">
              <Button
                onClick={runScreening}
                disabled={isProcessing}
              >
                {isProcessing ? 'Screening...' : 'Screen Applicants'}
              </Button>
            </div>
          </div>
        </Card>

        {/* Progress */}
        {isProcessing && progressMessage && (
          <Card>
            <div className="flex items-center gap-3">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
              <span className="text-gray-600">{progressMessage}</span>
            </div>
          </Card>
        )}

        {/* Error */}
        <ErrorAlert error={error} onDismiss={() => setError(null)} />

        {/* Results */}
        {results && (
          <div className="space-y-4">
            {/* Summary */}
            <Card>
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Screening Results</h3>
                  <p className="text-sm text-gray-600 mt-1">
                    {results.applicantsWithConcerns} of {results.results.length} applicant{results.results.length !== 1 ? 's' : ''} with potential concerns
                    {results.totalMatches > 0 && ` (${results.totalMatches} total matches)`}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button onClick={exportPdf} variant="secondary">
                    Export PDF
                  </Button>
                  <Button onClick={exportMarkdown} variant="secondary">
                    Export Markdown
                  </Button>
                  <Button onClick={exportJSON} variant="secondary">
                    Export JSON
                  </Button>
                </div>
              </div>
            </Card>

            {/* Individual Results */}
            <div className="space-y-4">
              {results.results.map((result, index) => (
                <ApplicantResultCard
                  key={index}
                  result={result}
                  onDismiss={handleDismiss}
                />
              ))}
            </div>
          </div>
        )}

        {/* Info about data sources */}
        <Card title="Data Sources">
          <div className="text-sm text-gray-600 space-y-2">
            <p>
              <strong>Retraction Watch Database:</strong> Comprehensive database of retracted papers
              (~63,000+ entries). Updated periodically.
            </p>
            <p>
              <strong>PubPeer (requires SERP API):</strong> Post-publication peer review platform.
              AI analyzes comments for integrity concerns.
            </p>
            <p>
              <strong>News Search (requires SERP API):</strong> Google News search for professionally
              relevant concerns. AI filters for misconduct and integrity issues.
            </p>
            <p className="text-gray-500 mt-4">
              Note: Results require human review. False positives may occur, especially for common names.
              Always verify matches before making decisions.
            </p>
          </div>
        </Card>
      </div>
    </Layout>
  );
}

export default function IntegrityScreenerGuard() {
  return <RequireAppAccess appKey="integrity-screener"><IntegrityScreenerPage /></RequireAppAccess>;
}
