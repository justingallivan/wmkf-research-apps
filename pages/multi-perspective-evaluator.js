import { useState, useCallback } from 'react';
import Layout, { PageHeader, Card, Button } from '../shared/components/Layout';
import FileUploaderSimple from '../shared/components/FileUploaderSimple';
import RequireAppAccess from '../shared/components/RequireAppAccess';
import ErrorAlert from '../shared/components/ErrorAlert';
import {
  PDFReportBuilder,
  downloadPdf,
  getRecommendationBadgeType,
  getRatingBadgeType
} from '../shared/utils/pdf-export';

/**
 * Framework definitions for the selector
 */
const FRAMEWORKS = {
  keck: {
    id: 'keck',
    name: 'Keck Foundation',
    description: 'High-risk, high-reward research that is pioneering and not fundable elsewhere',
    icon: '🚀'
  },
  nsf: {
    id: 'nsf',
    name: 'NSF Merit Review',
    description: 'Standard NSF review criteria: intellectual merit and broader impacts',
    icon: '📋'
  },
  general: {
    id: 'general',
    name: 'General Scientific',
    description: 'Broad scientific evaluation: rigor, novelty, and feasibility',
    icon: '🔬'
  }
};

/**
 * Framework selector component
 */
function FrameworkSelector({ selected, onSelect, disabled }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {Object.values(FRAMEWORKS).map((framework) => (
        <button
          key={framework.id}
          onClick={() => onSelect(framework.id)}
          disabled={disabled}
          className={`
            p-4 rounded-lg border-2 text-left transition-all duration-200
            ${selected === framework.id
              ? 'border-blue-500 bg-blue-50'
              : 'border-gray-200 hover:border-gray-300 bg-white'
            }
            ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
          `}
        >
          <div className="flex items-center gap-2 mb-2">
            <span className="text-2xl">{framework.icon}</span>
            <span className="font-semibold text-gray-900">{framework.name}</span>
          </div>
          <p className="text-sm text-gray-600">{framework.description}</p>
        </button>
      ))}
    </div>
  );
}

/**
 * Recommendation badge component
 */
function RecommendationBadge({ recommendation }) {
  const colorMap = {
    'Strong Recommend': 'bg-green-100 text-green-800 border-green-300',
    'Recommend': 'bg-blue-100 text-blue-800 border-blue-300',
    'Borderline': 'bg-yellow-100 text-yellow-800 border-yellow-300',
    'Not Recommended': 'bg-red-100 text-red-800 border-red-300'
  };

  const color = colorMap[recommendation] || 'bg-gray-100 text-gray-800 border-gray-300';

  return (
    <span className={`px-4 py-2 rounded-full text-sm font-bold border-2 ${color}`}>
      {recommendation || 'Unknown'}
    </span>
  );
}

/**
 * Confidence badge component
 */
function ConfidenceBadge({ confidence }) {
  const colorMap = {
    'High': 'bg-green-50 text-green-700',
    'Medium': 'bg-yellow-50 text-yellow-700',
    'Low': 'bg-red-50 text-red-700'
  };

  const color = colorMap[confidence] || 'bg-gray-50 text-gray-700';

  return (
    <span className={`px-2 py-1 rounded text-xs font-medium ${color}`}>
      {confidence} confidence
    </span>
  );
}

/**
 * Rating badge component
 */
function RatingBadge({ rating }) {
  const colorMap = {
    'Strong': 'bg-green-100 text-green-800',
    'Moderate': 'bg-yellow-100 text-yellow-800',
    'Weak': 'bg-red-100 text-red-800'
  };

  const color = colorMap[rating] || 'bg-gray-100 text-gray-800';

  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${color}`}>
      {rating || 'N/A'}
    </span>
  );
}

/**
 * Synthesis view component
 */
function SynthesisView({ concept }) {
  const { consensus, disagreements, synthesis, forDecisionMakers } = concept;

  return (
    <div className="space-y-6">
      {/* Decision Makers Summary */}
      {forDecisionMakers && (
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 p-6 rounded-lg border border-blue-200">
          <h4 className="text-lg font-semibold text-gray-900 mb-3">Executive Summary</h4>
          <p className="text-gray-800 font-medium mb-4">{forDecisionMakers.headline}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div className="bg-white p-3 rounded border border-green-200">
              <span className="font-medium text-green-700">Further consider if:</span>
              <p className="text-gray-600 mt-1">{forDecisionMakers.furtherConsiderIf}</p>
            </div>
            <div className="bg-white p-3 rounded border border-red-200">
              <span className="font-medium text-red-700">Decline if:</span>
              <p className="text-gray-600 mt-1">{forDecisionMakers.declineIf}</p>
            </div>
          </div>
        </div>
      )}

      {/* Recommendation and Narrative */}
      {synthesis && (
        <div className="bg-white p-6 rounded-lg border border-gray-200">
          <div className="flex flex-wrap items-center gap-4 mb-4">
            <RecommendationBadge recommendation={synthesis.weightedRecommendation} />
            <ConfidenceBadge confidence={synthesis.confidenceInRecommendation} />
          </div>

          <p className="text-gray-700 mb-4">{synthesis.overallNarrative}</p>

          {synthesis.recommendationRationale && (
            <div className="text-sm text-gray-600 bg-gray-50 p-3 rounded">
              <span className="font-medium">Rationale: </span>
              {synthesis.recommendationRationale}
            </div>
          )}

          {synthesis.keyTakeaways?.length > 0 && (
            <div className="mt-4">
              <h5 className="text-sm font-medium text-gray-900 mb-2">Key Takeaways</h5>
              <ul className="list-disc list-inside text-sm text-gray-600 space-y-1">
                {synthesis.keyTakeaways.map((takeaway, i) => (
                  <li key={i}>{takeaway}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Consensus */}
      {consensus && (
        <div className="bg-white p-6 rounded-lg border border-gray-200">
          <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <span className="text-green-500">✓</span>
            Consensus Points
          </h4>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {consensus.agreedStrengths?.length > 0 && (
              <div>
                <h5 className="text-sm font-medium text-green-700 mb-2">Agreed Strengths</h5>
                <ul className="space-y-1">
                  {consensus.agreedStrengths.map((strength, i) => (
                    <li key={i} className="text-sm text-gray-600 flex items-start gap-2">
                      <span className="text-green-500 mt-0.5">+</span>
                      {strength}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {consensus.agreedConcerns?.length > 0 && (
              <div>
                <h5 className="text-sm font-medium text-red-700 mb-2">Agreed Concerns</h5>
                <ul className="space-y-1">
                  {consensus.agreedConcerns.map((concern, i) => (
                    <li key={i} className="text-sm text-gray-600 flex items-start gap-2">
                      <span className="text-red-500 mt-0.5">-</span>
                      {concern}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Disagreements */}
      {disagreements?.length > 0 && (
        <div className="bg-white p-6 rounded-lg border border-gray-200">
          <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <span className="text-yellow-500">⚖️</span>
            Disagreements & Resolutions
          </h4>

          <div className="space-y-4">
            {disagreements.map((disagreement, i) => (
              <div key={i} className="border border-gray-100 rounded-lg p-4">
                <h5 className="font-medium text-gray-900 mb-3">{disagreement.topic}</h5>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                  <div className="bg-green-50 p-2 rounded text-sm">
                    <span className="font-medium text-green-700">Optimist:</span>
                    <p className="text-gray-600 mt-1">{disagreement.optimistView}</p>
                  </div>
                  <div className="bg-red-50 p-2 rounded text-sm">
                    <span className="font-medium text-red-700">Skeptic:</span>
                    <p className="text-gray-600 mt-1">{disagreement.skepticView}</p>
                  </div>
                  <div className="bg-blue-50 p-2 rounded text-sm">
                    <span className="font-medium text-blue-700">Neutral:</span>
                    <p className="text-gray-600 mt-1">{disagreement.neutralView}</p>
                  </div>
                </div>

                <div className="bg-purple-50 p-3 rounded">
                  <span className="font-medium text-purple-700">Resolution: </span>
                  <span className="text-gray-700">{disagreement.resolution}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Perspective card component
 */
function PerspectiveCard({ perspective, data, color }) {
  const [expanded, setExpanded] = useState(false);

  if (!data || data.error) {
    return (
      <div className={`bg-white border-2 ${color.border} rounded-lg overflow-hidden`}>
        <div className={`${color.header} px-4 py-3`}>
          <h4 className="font-semibold text-gray-900">{perspective}</h4>
        </div>
        <div className="p-4">
          <p className="text-red-600 text-sm">
            {data?.error || 'Failed to generate perspective'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-white border-2 ${color.border} rounded-lg overflow-hidden`}>
      <div className={`${color.header} px-4 py-3 flex justify-between items-center`}>
        <h4 className="font-semibold text-gray-900">{perspective}</h4>
        <RatingBadge rating={data.overallRating} />
      </div>

      <div className="p-4">
        <p className="text-gray-700 text-sm mb-3">{data.overallImpression}</p>

        {/* Show key points based on perspective type */}
        {perspective === 'Optimist' && data.keyStrengths && (
          <div className="mb-3">
            <h5 className="text-xs font-medium text-green-700 mb-1">Key Strengths</h5>
            <ul className="text-xs text-gray-600 space-y-1">
              {data.keyStrengths.slice(0, expanded ? undefined : 2).map((s, i) => (
                <li key={i} className="flex items-start gap-1">
                  <span className="text-green-500">+</span> {s}
                </li>
              ))}
            </ul>
          </div>
        )}

        {perspective === 'Skeptic' && data.keyConcerns && (
          <div className="mb-3">
            <h5 className="text-xs font-medium text-red-700 mb-1">Key Concerns</h5>
            <ul className="text-xs text-gray-600 space-y-1">
              {data.keyConcerns.slice(0, expanded ? undefined : 2).map((c, i) => (
                <li key={i} className="flex items-start gap-1">
                  <span className="text-red-500">-</span> {c.concern}
                </li>
              ))}
            </ul>
          </div>
        )}

        {perspective === 'Neutral' && (
          <>
            {data.balancedStrengths && (
              <div className="mb-2">
                <h5 className="text-xs font-medium text-blue-700 mb-1">Strengths</h5>
                <ul className="text-xs text-gray-600">
                  {data.balancedStrengths.slice(0, 2).map((s, i) => (
                    <li key={i}>+ {s}</li>
                  ))}
                </ul>
              </div>
            )}
            {data.balancedConcerns && (
              <div className="mb-2">
                <h5 className="text-xs font-medium text-blue-700 mb-1">Concerns</h5>
                <ul className="text-xs text-gray-600">
                  {data.balancedConcerns.slice(0, 2).map((c, i) => (
                    <li key={i}>- {c}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        {expanded && (
          <div className="mt-3 pt-3 border-t border-gray-200 space-y-3">
            {/* Criteria evaluations */}
            {data.criteriaEvaluations?.length > 0 && (
              <div>
                <h5 className="text-xs font-medium text-gray-700 mb-2">Criteria Ratings</h5>
                <div className="space-y-1">
                  {data.criteriaEvaluations.map((ce, i) => (
                    <div key={i} className="flex justify-between items-center text-xs">
                      <span className="text-gray-600">{ce.criterion}</span>
                      <RatingBadge rating={ce.rating} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Perspective-specific expanded content */}
            {perspective === 'Optimist' && data.anticipatedConcerns?.length > 0 && (
              <div>
                <h5 className="text-xs font-medium text-green-700 mb-1">Anticipated Concerns & Counterpoints</h5>
                {data.anticipatedConcerns.map((r, i) => (
                  <div key={i} className="text-xs text-gray-600 mb-1">
                    <span className="font-medium">{r.concern}:</span> {r.counterpoint}
                  </div>
                ))}
              </div>
            )}

            {perspective === 'Skeptic' && (
              <>
                {data.potentialFailureModes?.length > 0 && (
                  <div>
                    <h5 className="text-xs font-medium text-red-700 mb-1">Failure Modes</h5>
                    <ul className="text-xs text-gray-600">
                      {data.potentialFailureModes.map((f, i) => <li key={i}>- {f}</li>)}
                    </ul>
                  </div>
                )}
                {data.literatureConcerns && (
                  <div>
                    <h5 className="text-xs font-medium text-red-700 mb-1">Literature Concerns</h5>
                    <p className="text-xs text-gray-600">{data.literatureConcerns}</p>
                  </div>
                )}
              </>
            )}

            {perspective === 'Neutral' && (
              <>
                {data.mostLikelyOutcome && (
                  <div>
                    <h5 className="text-xs font-medium text-blue-700 mb-1">Most Likely Outcome</h5>
                    <p className="text-xs text-gray-600">{data.mostLikelyOutcome}</p>
                  </div>
                )}
                {data.comparisonToField && (
                  <div>
                    <h5 className="text-xs font-medium text-blue-700 mb-1">Comparison to Field</h5>
                    <p className="text-xs text-gray-600">{data.comparisonToField}</p>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-blue-600 hover:text-blue-800 mt-2"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      </div>
    </div>
  );
}

/**
 * Proposal Summary component
 * Displays what they're proposing and potential impact
 */
function ProposalSummaryView({ proposalSummary }) {
  if (!proposalSummary || proposalSummary.error) {
    return null;
  }

  const { proposalSummary: summary, keyInnovation, fieldContext } = proposalSummary;

  return (
    <div className="bg-gradient-to-r from-amber-50 to-yellow-50 p-6 rounded-lg border border-amber-200 mb-6">
      <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
        <span>📋</span>
        Proposal Overview
      </h4>

      <div className="space-y-4">
        {/* What They're Proposing */}
        <div>
          <h5 className="text-sm font-medium text-amber-800 mb-2">What They're Proposing</h5>
          <p className="text-gray-700">{summary?.whatTheyreProposing || 'Not available'}</p>
        </div>

        {/* Potential Impact */}
        <div>
          <h5 className="text-sm font-medium text-amber-800 mb-2">Potential Impact If Successful</h5>
          <p className="text-gray-700">{summary?.potentialImpact || 'Not available'}</p>
        </div>

        {/* Key Innovation and Field Context */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t border-amber-200">
          {keyInnovation && (
            <div className="bg-white p-3 rounded border border-amber-100">
              <span className="text-xs font-medium text-amber-700 uppercase">Key Innovation</span>
              <p className="text-sm text-gray-700 mt-1">{keyInnovation}</p>
            </div>
          )}
          {fieldContext && (
            <div className="bg-white p-3 rounded border border-amber-100">
              <span className="text-xs font-medium text-amber-700 uppercase">Field Context</span>
              <p className="text-sm text-gray-700 mt-1">{fieldContext}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Perspectives view component (3-column grid)
 */
function PerspectivesView({ perspectives }) {
  const colors = {
    optimist: { border: 'border-green-300', header: 'bg-green-50' },
    skeptic: { border: 'border-red-300', header: 'bg-red-50' },
    neutral: { border: 'border-blue-300', header: 'bg-blue-50' }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <PerspectiveCard
        perspective="Optimist"
        data={perspectives.optimist}
        color={colors.optimist}
      />
      <PerspectiveCard
        perspective="Skeptic"
        data={perspectives.skeptic}
        color={colors.skeptic}
      />
      <PerspectiveCard
        perspective="Neutral"
        data={perspectives.neutral}
        color={colors.neutral}
      />
    </div>
  );
}

/**
 * Single concept result component
 */
function ConceptResult({ concept, index }) {
  const [activeView, setActiveView] = useState('synthesis');
  const [showLiterature, setShowLiterature] = useState(false);

  if (concept.error) {
    return (
      <Card className="border-red-200 bg-red-50">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">
          Concept {concept.pageNumber || index + 1}: Error
        </h3>
        <p className="text-red-600">{concept.error}</p>
      </Card>
    );
  }

  return (
    <Card className="mb-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-4 mb-4 pb-4 border-b border-gray-200">
        <div>
          <h3 className="text-xl font-semibold text-gray-900">
            {concept.pageNumber ? `${concept.pageNumber}. ` : ''}{concept.title || 'Untitled Concept'}
          </h3>
          {(concept.piName || concept.institution) && (
            <p className="text-sm text-gray-600 mt-1">
              {concept.piName}{concept.institution ? ` - ${concept.institution}` : ''}
            </p>
          )}
          <p className="text-sm text-gray-500 mt-1">
            Framework: {concept.frameworkName}
          </p>
        </div>

        {/* View Toggle - only show if perspectives exist */}
        {concept.perspectives && (
          <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
            <button
              onClick={() => setActiveView('synthesis')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeView === 'synthesis'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Synthesis
            </button>
            <button
              onClick={() => setActiveView('perspectives')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeView === 'perspectives'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Perspectives
            </button>
          </div>
        )}
      </div>

      {/* Proposal Summary - always shown above the views */}
      <ProposalSummaryView proposalSummary={concept.proposalSummary} />

      {/* Content based on active view */}
      {activeView === 'synthesis' || !concept.perspectives ? (
        <SynthesisView concept={concept} />
      ) : (
        <PerspectivesView perspectives={concept.perspectives} />
      )}

      {/* Literature Search (collapsible) */}
      {concept.literatureSearch && (
        <div className="mt-6 pt-4 border-t border-gray-200">
          <button
            onClick={() => setShowLiterature(!showLiterature)}
            className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
          >
            <span>{showLiterature ? '▼' : '▶'}</span>
            <span className="font-medium">Literature Search</span>
            <span className="text-gray-500">
              ({concept.literatureSearch.totalFound} publications found)
            </span>
          </button>

          {showLiterature && (
            <div className="mt-3 text-sm">
              <div className="text-xs text-gray-500 mb-2">
                <span className="font-medium">Queries:</span>{' '}
                {concept.literatureSearch.queries?.map((q, i) => (
                  <span key={i} className="inline-block bg-gray-200 rounded px-1 mr-1">"{q}"</span>
                ))}
              </div>

              {concept.literatureSearch.publications?.length > 0 && (
                <div className="max-h-48 overflow-y-auto border border-gray-200 rounded bg-gray-50 p-2">
                  {concept.literatureSearch.publications.map((pub, i) => (
                    <div key={i} className="text-xs text-gray-600 py-1 border-b border-gray-100 last:border-0">
                      <div className="font-medium text-gray-800">
                        {pub.url ? (
                          <a href={pub.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                            {pub.title}
                          </a>
                        ) : (
                          pub.title
                        )}
                      </div>
                      <div className="text-gray-500">
                        {pub.authors?.slice(0, 3).join(', ')}{pub.authors?.length > 3 ? ' et al.' : ''}
                        {pub.year ? ` (${pub.year})` : ''}
                        {pub.source ? ` - ${pub.source}` : ''}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function MultiPerspectiveEvaluator() {
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState(null);
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState('');
  const [progressStage, setProgressStage] = useState(null);
  const [error, setError] = useState(null);
  const [selectedFramework, setSelectedFramework] = useState('keck');

  const handleFilesUploaded = useCallback((uploadedFiles) => {
    setSelectedFiles(uploadedFiles);
    setError(null);
    setResults(null);
  }, []);

  const evaluateConcepts = async () => {
    if (selectedFiles.length === 0) {
      setError('Please upload a PDF file containing concepts');
      return;
    }

    setProcessing(true);
    setProgress(0);
    setProgressText('Starting multi-perspective evaluation...');
    setProgressStage(null);
    setError(null);

    try {
      // eslint-disable-next-line no-restricted-syntax -- raw fetch: SSE stream (response.body.getReader() below); allowlisted per CLIENT_REQUEST_LAYER_PLAN §2.6
      const response = await fetch('/api/evaluate-multi-perspective', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          files: selectedFiles,
          framework: selectedFramework
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
                  if (data.stage) {
                    setProgressStage(data.stage);
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

      setProgressText('Evaluation complete!');
      setSelectedFiles([]);

    } catch (error) {
      console.error('Evaluation error:', error);
      setError(error.message || 'Failed to evaluate concepts');
    } finally {
      setProcessing(false);
      setProgressStage(null);
    }
  };

  const exportAsJson = () => {
    if (!results) return;

    const blob = new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `multi_perspective_evaluation_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportAsPdf = async () => {
    if (!results?.concepts) return;

    try {
      const builder = new PDFReportBuilder();
      await builder.init();

      // Title and metadata
      builder
        .addTitle('Multi-Perspective Concept Evaluation', 'AI-powered analysis from three perspectives')
        .addMetadata('Generated', new Date().toLocaleDateString())
        .addMetadata('Framework', results.frameworkName)
        .addMetadata('Total Concepts', String(results.concepts.length))
        .addDivider();

      // Process each concept
      for (let i = 0; i < results.concepts.length; i++) {
        const concept = results.concepts[i];

        if (i > 0) {
          builder.addPage();
        }

        // Concept header
        builder.addSection(`${i + 1}. ${concept.title || 'Untitled Concept'}`);

        if (concept.piName || concept.institution) {
          builder.addMetadata('PI', `${concept.piName || 'Not specified'}${concept.institution ? ` (${concept.institution})` : ''}`);
        }

        if (concept.error) {
          builder.addParagraph(`Error: ${concept.error}`, { color: { r: 0.7, g: 0.2, b: 0.2 } });
          continue;
        }

        // Proposal Summary
        if (concept.proposalSummary?.proposalSummary) {
          builder.addSection('Proposal Overview', 2);
          builder.addHighlightBox(
            'What They\'re Proposing',
            concept.proposalSummary.proposalSummary.whatTheyreProposing
          );
          builder.addHighlightBox(
            'Potential Impact If Successful',
            concept.proposalSummary.proposalSummary.potentialImpact
          );
          if (concept.proposalSummary.keyInnovation) {
            builder.addKeyValue('Key Innovation', concept.proposalSummary.keyInnovation);
          }
          if (concept.proposalSummary.fieldContext) {
            builder.addKeyValue('Field Context', concept.proposalSummary.fieldContext);
          }
        }

        // Recommendation
        if (concept.synthesis) {
          builder.addSection('Recommendation', 2);
          builder.addBadge(
            `${concept.synthesis.weightedRecommendation} (${concept.synthesis.confidenceInRecommendation} confidence)`,
            getRecommendationBadgeType(concept.synthesis.weightedRecommendation)
          );
          builder.addParagraph(concept.synthesis.overallNarrative);

          if (concept.synthesis.keyTakeaways?.length > 0) {
            builder.addSpace(5);
            builder.addParagraph('Key Takeaways:', { font: 'bold' });
            builder.addBulletList(concept.synthesis.keyTakeaways);
          }
        }

        // Executive Summary
        if (concept.forDecisionMakers) {
          builder.addSection('Executive Summary', 2);
          builder.addParagraph(concept.forDecisionMakers.headline, { font: 'bold' });
          builder.addKeyValue('Further consider if', concept.forDecisionMakers.furtherConsiderIf);
          builder.addKeyValue('Decline if', concept.forDecisionMakers.declineIf);
        }

        // Consensus
        if (concept.consensus) {
          builder.addSection('Consensus Points', 2);

          if (concept.consensus.agreedStrengths?.length > 0) {
            builder.addParagraph('Agreed Strengths:', { font: 'bold' });
            builder.addBulletList(concept.consensus.agreedStrengths.map(s => `+ ${s}`));
          }

          if (concept.consensus.agreedConcerns?.length > 0) {
            builder.addParagraph('Agreed Concerns:', { font: 'bold' });
            builder.addBulletList(concept.consensus.agreedConcerns.map(c => `- ${c}`));
          }
        }

        // Disagreements
        if (concept.disagreements?.length > 0) {
          builder.addSection('Disagreements & Resolutions', 2);

          for (const disagreement of concept.disagreements) {
            builder.addParagraph(disagreement.topic, { font: 'bold' });
            builder.addKeyValue('Optimist', disagreement.optimistView);
            builder.addKeyValue('Skeptic', disagreement.skepticView);
            builder.addKeyValue('Neutral', disagreement.neutralView);
            builder.addKeyValue('Resolution', disagreement.resolution);
            builder.addSpace(8);
          }
        }

        // Individual Perspectives Summary
        builder.addSection('Individual Perspectives', 2);

        for (const perspectiveName of ['optimist', 'skeptic', 'neutral']) {
          const pData = concept.perspectives?.[perspectiveName];
          if (pData && !pData.error) {
            const displayName = perspectiveName.charAt(0).toUpperCase() + perspectiveName.slice(1);
            builder.addParagraph(`${displayName} (${pData.overallRating}):`, { font: 'bold' });
            builder.addParagraph(pData.overallImpression, { indent: 10 });
          }
        }

        // Literature info (brief)
        if (concept.literatureSearch?.totalFound > 0) {
          builder.addSection('Literature Context', 2);
          builder.addParagraph(
            `Found ${concept.literatureSearch.totalFound} relevant publications. ` +
            `Search queries: ${concept.literatureSearch.queries?.join(', ') || 'N/A'}`
          );
        }
      }

      // Build and download
      const pdfBytes = await builder.build();
      downloadPdf(pdfBytes, `multi_perspective_evaluation_${new Date().toISOString().split('T')[0]}.pdf`);

    } catch (error) {
      console.error('PDF export error:', error);
      setError('Failed to export PDF: ' + error.message);
    }
  };

  const exportAsMarkdown = () => {
    if (!results?.concepts) return;

    let content = `# Multi-Perspective Concept Evaluation Report\n\n`;
    content += `Generated: ${new Date().toLocaleDateString()}\n`;
    content += `Framework: ${results.frameworkName}\n`;
    content += `Total Concepts: ${results.summary?.totalConcepts || results.concepts.length}\n\n`;
    content += `---\n\n`;

    results.concepts.forEach((concept, index) => {
      content += `## ${index + 1}. ${concept.title || 'Untitled Concept'}\n\n`;

      if (concept.error) {
        content += `**Error:** ${concept.error}\n\n`;
      } else {
        if (concept.piName) {
          content += `**PI:** ${concept.piName}`;
          if (concept.institution) content += ` (${concept.institution})`;
          content += `\n\n`;
        }

        // Proposal Summary
        if (concept.proposalSummary?.proposalSummary) {
          content += `### Proposal Overview\n\n`;
          content += `**What They're Proposing:** ${concept.proposalSummary.proposalSummary.whatTheyreProposing}\n\n`;
          content += `**Potential Impact If Successful:** ${concept.proposalSummary.proposalSummary.potentialImpact}\n\n`;
          if (concept.proposalSummary.keyInnovation) {
            content += `**Key Innovation:** ${concept.proposalSummary.keyInnovation}\n\n`;
          }
          if (concept.proposalSummary.fieldContext) {
            content += `**Field Context:** ${concept.proposalSummary.fieldContext}\n\n`;
          }
        }

        // Synthesis
        if (concept.synthesis) {
          content += `### Recommendation\n\n`;
          content += `**${concept.synthesis.weightedRecommendation}** (${concept.synthesis.confidenceInRecommendation} confidence)\n\n`;
          content += `${concept.synthesis.overallNarrative}\n\n`;

          if (concept.synthesis.keyTakeaways?.length > 0) {
            content += `**Key Takeaways:**\n`;
            concept.synthesis.keyTakeaways.forEach(t => content += `- ${t}\n`);
            content += `\n`;
          }
        }

        // Decision Makers Summary
        if (concept.forDecisionMakers) {
          content += `### Executive Summary\n\n`;
          content += `${concept.forDecisionMakers.headline}\n\n`;
          content += `- **Further consider if:** ${concept.forDecisionMakers.furtherConsiderIf}\n`;
          content += `- **Decline if:** ${concept.forDecisionMakers.declineIf}\n\n`;
        }

        // Consensus
        if (concept.consensus) {
          content += `### Consensus Points\n\n`;
          if (concept.consensus.agreedStrengths?.length > 0) {
            content += `**Agreed Strengths:**\n`;
            concept.consensus.agreedStrengths.forEach(s => content += `- ${s}\n`);
            content += `\n`;
          }
          if (concept.consensus.agreedConcerns?.length > 0) {
            content += `**Agreed Concerns:**\n`;
            concept.consensus.agreedConcerns.forEach(c => content += `- ${c}\n`);
            content += `\n`;
          }
        }

        // Disagreements
        if (concept.disagreements?.length > 0) {
          content += `### Disagreements & Resolutions\n\n`;
          concept.disagreements.forEach((d, i) => {
            content += `**${i + 1}. ${d.topic}**\n`;
            content += `- Optimist: ${d.optimistView}\n`;
            content += `- Skeptic: ${d.skepticView}\n`;
            content += `- Neutral: ${d.neutralView}\n`;
            content += `- **Resolution:** ${d.resolution}\n\n`;
          });
        }

        // Individual Perspectives Summary
        content += `### Individual Perspectives\n\n`;
        ['optimist', 'skeptic', 'neutral'].forEach(p => {
          const pData = concept.perspectives?.[p];
          if (pData && !pData.error) {
            content += `**${p.charAt(0).toUpperCase() + p.slice(1)}** (${pData.overallRating}): ${pData.overallImpression}\n\n`;
          }
        });
      }

      content += `---\n\n`;
    });

    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `multi_perspective_evaluation_${new Date().toISOString().split('T')[0]}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Stage display for progress
  const stageLabels = {
    'initial-analysis': 'Analyzing concept...',
    'literature-search': 'Searching literature...',
    'perspectives': 'Running 3 perspectives...',
    'integration': 'Synthesizing results...'
  };

  return (
    <Layout
      title="Multi-Perspective Evaluator"
      description="Evaluate research concepts from multiple AI perspectives"
    >
      <PageHeader
        title="Multi-Perspective Evaluator"
        subtitle="Evaluate concepts using Optimist, Skeptic, and Neutral AI perspectives with integrated synthesis"
        icon="🎭"
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
            <p>1. Select an evaluation framework (Keck, NSF, or General Scientific)</p>
            <p>2. Upload a PDF where each page contains one research concept</p>
            <p>3. Three AI perspectives analyze each concept in parallel:</p>
            <ul className="ml-6 list-disc text-sm text-gray-600">
              <li><span className="text-green-600 font-medium">Optimist</span> - Builds the strongest case FOR the concept</li>
              <li><span className="text-red-600 font-medium">Skeptic</span> - Identifies weaknesses and concerns</li>
              <li><span className="text-blue-600 font-medium">Neutral</span> - Provides balanced, probability-weighted assessment</li>
            </ul>
            <p>4. An integrator synthesizes all perspectives into consensus, disagreements, and a final recommendation</p>
          </div>
        </Card>

        {/* Framework Selector */}
        <Card>
          <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <span>⚙️</span>
            <span>Select Evaluation Framework</span>
          </h2>
          <FrameworkSelector
            selected={selectedFramework}
            onSelect={setSelectedFramework}
            disabled={processing}
          />
        </Card>

        {/* File Upload */}
        <Card>
          <div className="mb-4">
            <h2 className="text-xl font-semibold text-gray-900 mb-2 flex items-center gap-2">
              <span>📁</span>
              <span>Upload Concepts PDF</span>
            </h2>
            <p className="text-sm text-gray-600">
              Upload a single PDF file where each page contains one research concept
            </p>
          </div>
          <FileUploaderSimple
            onFilesUploaded={handleFilesUploaded}
            multiple={false}
            accept=".pdf"
            maxSize={50 * 1024 * 1024}
          />
        </Card>

        {/* Ready State */}
        {selectedFiles.length > 0 && !processing && !results && (
          <Card className="bg-green-50 border-green-200">
            <div className="text-center">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Ready to Evaluate</h3>
              <p className="text-gray-700 mb-2">
                {selectedFiles.length} file uploaded • Framework: {FRAMEWORKS[selectedFramework].name}
              </p>
              <p className="text-sm text-gray-600 mb-4">
                Each concept will be analyzed by 3 AI perspectives and synthesized into a recommendation.
              </p>
              <Button
                variant="primary"
                size="lg"
                onClick={evaluateConcepts}
              >
                🎭 Run Multi-Perspective Evaluation
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

              {/* Stage indicator */}
              {progressStage && (
                <div className="flex justify-center gap-2 mb-4">
                  {['initial-analysis', 'literature-search', 'proposal-summary', 'perspectives', 'integration'].map((stage, i) => (
                    <div
                      key={stage}
                      className={`px-3 py-1 rounded-full text-xs font-medium ${
                        progressStage === stage
                          ? 'bg-blue-100 text-blue-800'
                          : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {i + 1}. {stage.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                    </div>
                  ))}
                </div>
              )}

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
        {results?.concepts && (
          <div className="mt-8">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
                <span>📊</span>
                <span>Evaluation Results</span>
                <span className="text-sm font-normal text-gray-500">
                  ({results.frameworkName})
                </span>
              </h2>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={exportAsPdf}>
                  📄 Export PDF
                </Button>
                <Button variant="secondary" onClick={exportAsJson}>
                  📋 Export JSON
                </Button>
                <Button variant="secondary" onClick={exportAsMarkdown}>
                  📝 Export Markdown
                </Button>
              </div>
            </div>

            {/* Summary Stats */}
            <Card className="mb-6 bg-blue-50 border-blue-200">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                <div>
                  <div className="text-2xl font-bold text-gray-900">
                    {results.concepts.length}
                  </div>
                  <div className="text-sm text-gray-600">Concepts</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-green-600">
                    {results.concepts.filter(c =>
                      c.synthesis?.weightedRecommendation?.includes('Recommend') &&
                      !c.synthesis?.weightedRecommendation?.includes('Not')
                    ).length}
                  </div>
                  <div className="text-sm text-gray-600">Recommended</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-yellow-600">
                    {results.concepts.filter(c =>
                      c.synthesis?.weightedRecommendation === 'Borderline'
                    ).length}
                  </div>
                  <div className="text-sm text-gray-600">Borderline</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-red-600">
                    {results.concepts.filter(c =>
                      c.synthesis?.weightedRecommendation === 'Not Recommended' || c.error
                    ).length}
                  </div>
                  <div className="text-sm text-gray-600">Not Recommended</div>
                </div>
              </div>
            </Card>

            {/* Concept Results */}
            {results.concepts.map((concept, index) => (
              <ConceptResult key={index} concept={concept} index={index} />
            ))}
          </div>
        )}

        {/* New Evaluation Button */}
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
              🎭 New Evaluation
            </Button>
          </div>
        )}
      </div>
    </Layout>
  );
}

export default function MultiPerspectiveEvaluatorPage() {
  return <RequireAppAccess appKey="multi-perspective-evaluator"><MultiPerspectiveEvaluator /></RequireAppAccess>;
}
