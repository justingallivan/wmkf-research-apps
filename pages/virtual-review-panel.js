import { useState, useCallback, useRef, useEffect } from 'react';
import Layout, { PageHeader, Card, Button } from '../shared/components/Layout';
import FileUploaderSimple from '../shared/components/FileUploaderSimple';
import RequireAppAccess from '../shared/components/RequireAppAccess';
import ErrorAlert from '../shared/components/ErrorAlert';
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
  WidthType, AlignmentType, BorderStyle
} from 'docx';

/**
 * Provider definitions with default model names for display
 */
const PROVIDER_INFO = {
  claude: { name: 'Claude', icon: '🟣', color: 'purple', defaultModel: 'claude-sonnet-4' },
  openai: { name: 'GPT', icon: '🟢', color: 'green', defaultModel: 'gpt-4o' },
  gemini: { name: 'Gemini', icon: '🔵', color: 'blue', defaultModel: 'gemini-2.5-flash' },
  perplexity: { name: 'Perplexity', icon: '🟠', color: 'orange', defaultModel: 'sonar-pro' },
};

/**
 * Rating color helper
 */
function getRatingColor(rating) {
  if (!rating) return 'bg-gray-100 text-gray-600';
  const r = rating.toLowerCase();
  if (r.includes('excellent') || r.includes('rewrite textbooks')) return 'bg-green-100 text-green-800';
  if (r.includes('very good') || r.includes('broad interest')) return 'bg-blue-100 text-blue-800';
  if (r.includes('good') || r.includes('disciplinary')) return 'bg-yellow-100 text-yellow-800';
  if (r.includes('fair') || r.includes('medium')) return 'bg-orange-100 text-orange-800';
  if (r.includes('poor') || r.includes('impossible') || r.includes('little')) return 'bg-red-100 text-red-800';
  if (r.includes('low risk')) return 'bg-green-100 text-green-800';
  if (r.includes('high risk')) return 'bg-red-100 text-red-800';
  return 'bg-gray-100 text-gray-600';
}

/**
 * Provider selector checkboxes
 */
function ProviderSelector({ selected, available, providerModels, onChange, disabled }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {Object.entries(PROVIDER_INFO).map(([key, info]) => {
        const isAvailable = available.includes(key);
        const isSelected = selected.includes(key);
        const modelName = providerModels?.[key] || info.defaultModel;
        return (
          <label
            key={key}
            className={`
              flex items-center gap-3 px-4 py-3 rounded-lg border-2 cursor-pointer transition-all
              ${!isAvailable ? 'opacity-40 cursor-not-allowed border-gray-200 bg-gray-50' : ''}
              ${isSelected && isAvailable ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white hover:border-gray-300'}
              ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
            `}
          >
            <input
              type="checkbox"
              checked={isSelected}
              disabled={disabled || !isAvailable}
              onChange={() => {
                if (isSelected) {
                  onChange(selected.filter(p => p !== key));
                } else {
                  onChange([...selected, key]);
                }
              }}
              className="sr-only"
            />
            <span className="text-xl">{info.icon}</span>
            <div className="flex flex-col">
              <span className="font-medium text-gray-900">{info.name}</span>
              <span className="text-xs text-gray-500">{modelName}</span>
            </div>
            {!isAvailable && <span className="text-xs text-gray-400 ml-auto">(no API key)</span>}
            {isSelected && isAvailable && <span className="text-blue-500 ml-auto">✓</span>}
          </label>
        );
      })}
    </div>
  );
}

/**
 * Per-provider status card during processing
 */
/**
 * Elapsed timer hook — ticks every second while active
 */
function useElapsedTimer(active) {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(null);

  useEffect(() => {
    if (active) {
      startRef.current = Date.now();
      setElapsed(0);
      const interval = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
      }, 1000);
      return () => clearInterval(interval);
    }
    startRef.current = null;
  }, [active]);

  return elapsed;
}

/**
 * Overall elapsed timer — shows mm:ss while running, final time when done
 */
function OverallTimer({ startedAt, running }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!startedAt) return;
    setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    if (!running) return;
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [startedAt, running]);

  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const formatted = mins > 0 ? `${mins}m ${secs.toString().padStart(2, '0')}s` : `${secs}s`;

  return (
    <span className="font-mono tabular-nums text-xs">
      {running ? `${formatted} elapsed` : `Total: ${formatted}`}
    </span>
  );
}

function ProviderStatusCard({ provider, status, stage, latencyMs, model }) {
  const info = PROVIDER_INFO[provider] || { name: provider, icon: '⚪' };
  const elapsed = useElapsedTimer(status === 'in_progress');

  const statusColors = {
    pending: 'bg-gray-50 border-gray-200',
    in_progress: 'bg-blue-50 border-blue-300',
    completed: 'bg-green-50 border-green-300',
    failed: 'bg-red-50 border-red-300',
  };

  const statusIcons = {
    pending: '⏳',
    in_progress: '⚙️',
    completed: '✅',
    failed: '❌',
  };

  return (
    <div className={`p-3 rounded-lg border-2 ${statusColors[status] || statusColors.pending}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">{info.icon}</span>
          <span className="font-medium text-gray-900">{info.name}</span>
        </div>
        <span>{statusIcons[status] || '⏳'}</span>
      </div>
      <div className="text-xs text-gray-400 mt-1">{model || info.defaultModel}</div>
      {stage && (
        <div className="text-xs text-gray-500 mt-0.5">
          {stage.replace(/_/g, ' ')}
        </div>
      )}
      {status === 'in_progress' && (
        <div className="text-xs text-blue-500 mt-0.5 font-mono tabular-nums">
          {elapsed}s elapsed...
        </div>
      )}
      {latencyMs && status === 'completed' && (
        <div className="text-xs text-gray-400 mt-0.5">
          {(latencyMs / 1000).toFixed(1)}s
        </div>
      )}
    </div>
  );
}

/**
 * Rating comparison matrix
 */
function RatingMatrix({ ratingMatrix, providers }) {
  if (!ratingMatrix) return null;

  const rows = [
    { key: 'impactRating', label: 'Impact' },
    { key: 'riskRating', label: 'Risk' },
    { key: 'overallRating', label: 'Overall' },
  ];

  return (
    <Card title="Rating Comparison Matrix">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left py-2 px-3 font-medium text-gray-600">Criterion</th>
              {Object.keys(ratingMatrix.overallRating || ratingMatrix.impactRating || {}).map(reviewer => (
                <th key={reviewer} className="text-center py-2 px-3 font-medium text-gray-600">
                  {reviewer}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const ratings = ratingMatrix[row.key];
              if (!ratings) return null;
              return (
                <tr key={row.key} className="border-b border-gray-100">
                  <td className="py-2 px-3 font-medium text-gray-700">{row.label}</td>
                  {Object.entries(ratings).map(([reviewer, rating]) => (
                    <td key={reviewer} className="py-2 px-3 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${getRatingColor(rating)}`}>
                        {rating}
                      </span>
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/**
 * Individual reviewer card (expandable)
 */
function ReviewerCard({ review }) {
  const [expanded, setExpanded] = useState(false);
  const info = PROVIDER_INFO[review.provider] || { name: review.providerName, icon: '⚪' };
  const parsed = review.parsedResponse;

  if (!parsed) return null;

  const formFields = [
    { key: 'impactRating', label: 'Impact Rating', type: 'rating' },
    { key: 'impactNarrative', label: 'Significant Impacts', type: 'text' },
    { key: 'riskRating', label: 'Risk Rating', type: 'rating' },
    { key: 'riskNarrative', label: 'Risk Analysis', type: 'text' },
    { key: 'keyUncertaintyResolution', label: 'Key Uncertainty', type: 'text' },
    { key: 'methodsAssessment', label: 'Methods Assessment', type: 'text' },
    { key: 'questionsForPI', label: 'Questions for PI', type: 'text' },
    { key: 'teamAssessment', label: 'Team Assessment', type: 'text' },
    { key: 'fundingAlternatives', label: 'Funding Alternatives', type: 'text' },
    { key: 'budgetIssues', label: 'Budget Issues', type: 'text' },
    { key: 'overallRating', label: 'Overall Rating', type: 'rating' },
    { key: 'additionalComments', label: 'Additional Comments', type: 'text' },
  ];

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 bg-white hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-xl">{info.icon}</span>
          <span className="font-semibold text-gray-900">{info.name}</span>
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${getRatingColor(parsed.overallRating)}`}>
            {parsed.overallRating || 'N/A'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {review.costCents != null && (
            <span className="text-xs text-gray-400">${(review.costCents / 100).toFixed(4)}</span>
          )}
          <span className="text-gray-400">{expanded ? '▲' : '▼'}</span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-gray-200 p-4 space-y-4 bg-gray-50">
          {formFields.map(field => {
            const value = parsed[field.key];
            if (!value) return null;
            return (
              <div key={field.key}>
                <h5 className="text-sm font-medium text-gray-700 mb-1">{field.label}</h5>
                {field.type === 'rating' ? (
                  <span className={`inline-block px-3 py-1 rounded text-sm font-medium ${getRatingColor(value)}`}>
                    {value}
                  </span>
                ) : (
                  <p className="text-sm text-gray-600 whitespace-pre-wrap">{value}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Panel summary display
 */
function PanelSummary({ summary }) {
  if (!summary) return null;

  return (
    <div className="space-y-6">
      {/* Panel Recommendation */}
      {summary.panelRecommendation && (
        <Card title="Panel Recommendation">
          <p className="text-gray-700">{summary.panelRecommendation}</p>
          {summary.confidenceNote && (
            <p className="text-sm text-gray-500 mt-3 italic">{summary.confidenceNote}</p>
          )}
        </Card>
      )}

      {/* Consensus */}
      {summary.consensus?.length > 0 && (
        <Card title="Consensus Points">
          <ul className="space-y-2">
            {summary.consensus.map((point, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                <span className="text-green-500 mt-0.5 flex-shrink-0">✓</span>
                {point}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Key Strengths */}
      {summary.keyStrengths?.length > 0 && (
        <Card title="Key Strengths">
          <ul className="space-y-2">
            {summary.keyStrengths.map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                <span className="text-green-500 mt-0.5 flex-shrink-0">+</span>
                {s}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Key Concerns */}
      {summary.keyConcerns?.length > 0 && (
        <Card title="Key Concerns">
          <ol className="list-decimal list-inside space-y-2">
            {summary.keyConcerns.map((c, i) => (
              <li key={i} className="text-sm text-gray-700">{c}</li>
            ))}
          </ol>
        </Card>
      )}

      {/* Disagreements */}
      {summary.disagreements?.length > 0 && (
        <Card title="Disagreements">
          <div className="space-y-4">
            {summary.disagreements.map((d, i) => (
              <div key={i} className="bg-yellow-50 p-4 rounded-lg border border-yellow-200">
                <h5 className="font-medium text-gray-900 mb-2">{d.topic}</h5>
                {d.positions && (
                  <div className="space-y-1 mb-2">
                    {Object.entries(d.positions).map(([reviewer, position]) => (
                      <div key={reviewer} className="text-sm">
                        <span className="font-medium text-gray-700">{reviewer}:</span>{' '}
                        <span className="text-gray-600">{position}</span>
                      </div>
                    ))}
                  </div>
                )}
                {d.significance && (
                  <p className="text-xs text-gray-500 italic">{d.significance}</p>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Questions for PI */}
      {summary.questionsForPI?.length > 0 && (
        <Card title="Questions for the PI">
          <ol className="list-decimal list-inside space-y-2">
            {summary.questionsForPI.map((q, i) => (
              <li key={i} className="text-sm text-gray-700">{q}</li>
            ))}
          </ol>
        </Card>
      )}

      {/* Resolvable vs Fundamental Concerns */}
      {summary.resolvableVsFundamental?.length > 0 && (
        <Card title="Resolvable vs. Fundamental Concerns">
          <div className="space-y-3">
            {summary.resolvableVsFundamental.map((item, i) => {
              if (typeof item === 'string') {
                return (
                  <div key={i} className="text-sm text-gray-700 pl-4 border-l-2 border-gray-300">
                    {item}
                  </div>
                );
              }
              // Object form: {concern, classification, resolution}
              const label = item.concern || item.issue || item.description || JSON.stringify(item);
              const cls = item.classification || item.type || '';
              return (
                <div key={i} className="text-sm text-gray-700 pl-4 border-l-2 border-gray-300">
                  {cls && (
                    <><span className={`font-medium ${cls.toLowerCase().includes('fundamental') ? 'text-red-600' : 'text-amber-600'}`}>
                      [{cls}]
                    </span>{' '}</>
                  )}
                  <span className="font-medium">{label}</span>
                  {item.resolution && <span className="text-gray-500"> — {item.resolution}</span>}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Claim Verification Highlights */}
      {summary.claimVerificationHighlights?.length > 0 && (
        <Card title="Claim Verification Highlights">
          <ul className="space-y-2">
            {summary.claimVerificationHighlights.map((h, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                <span className="text-amber-500 mt-0.5 flex-shrink-0">⚠</span>
                {h}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Devil's Advocate Summary */}
      {summary.devilsAdvocateSummary && (
        <Card title="Devil's Advocate Summary">
          <p className="text-sm text-gray-700">{summary.devilsAdvocateSummary}</p>
        </Card>
      )}
    </div>
  );
}

/**
 * Cost breakdown table
 */
function CostBreakdown({ costBreakdown, totalCostCents }) {
  if (!costBreakdown) return null;

  return (
    <Card title="Cost Breakdown">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200">
            <th className="text-left py-2 font-medium text-gray-600">Provider</th>
            <th className="text-right py-2 font-medium text-gray-600">Cost</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(costBreakdown).map(([provider, cost]) => {
            const info = PROVIDER_INFO[provider] || { name: provider, icon: '⚪' };
            return (
              <tr key={provider} className="border-b border-gray-100">
                <td className="py-2">
                  <span className="mr-2">{info.icon}</span>
                  {info.name}
                </td>
                <td className="py-2 text-right font-mono">${(cost / 100).toFixed(4)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-gray-300">
            <td className="py-2 font-semibold">Total</td>
            <td className="py-2 text-right font-mono font-semibold">
              ${((totalCostCents || 0) / 100).toFixed(4)}
            </td>
          </tr>
        </tfoot>
      </table>
    </Card>
  );
}

/**
 * Build markdown export content from panel results
 */
function buildMarkdownExport(proposalFilename, panelSummary, structuredReviews, claimVerifications, costBreakdown, totalCostCents, intelligenceBlock, devilsAdvocate) {
  const lines = [];
  lines.push(`# Virtual Review Panel Report`);
  lines.push(`**Proposal:** ${proposalFilename}`);
  lines.push(`**Date:** ${new Date().toLocaleDateString()}`);
  lines.push(`**Reviewers:** ${structuredReviews.map(r => `${r.providerName} (${r.model})`).join(', ')}`);
  lines.push('');

  // Stage 0: Pre-Review Intelligence
  if (intelligenceBlock) {
    lines.push('## Pre-Review Intelligence (Stage 0)');
    if (intelligenceBlock.landscapeSummary) {
      lines.push(intelligenceBlock.landscapeSummary);
      lines.push('');
    }
    if (intelligenceBlock.mostRelevantPapers?.length > 0) {
      lines.push('### Most Relevant Papers');
      intelligenceBlock.mostRelevantPapers.forEach(p => {
        if (typeof p === 'string') { lines.push(`- ${p}`); return; }
        const citation = p.citation || p.title || p.name || 'Unknown';
        const parts = [citation];
        if (p.relevanceToProposal) parts.push(p.relevanceToProposal);
        else if (p.relevance) parts.push(p.relevance);
        if (p.comparability) parts.push(`[${p.comparability}]`);
        lines.push(`- ${parts.join(' — ')}`);
      });
      lines.push('');
    }
    if (intelligenceBlock.activeGroups?.length > 0) {
      lines.push('### Active Research Groups');
      intelligenceBlock.activeGroups.forEach(g => {
        if (typeof g === 'string') { lines.push(`- ${g}`); return; }
        const name = g.pi || g.name || g.group || 'Unknown';
        const parts = [name];
        if (g.institution) parts[0] = `${name} (${g.institution})`;
        if (g.focus) parts.push(g.focus);
        if (g.recentActivity) parts.push(g.recentActivity);
        lines.push(`- ${parts.join(' — ')}`);
      });
      lines.push('');
    }
    if (intelligenceBlock.competingApproaches?.length > 0) {
      lines.push('### Competing Approaches');
      intelligenceBlock.competingApproaches.forEach(a => {
        const approach = typeof a === 'string' ? a : (a.approach || a.name || a.description || JSON.stringify(a));
        lines.push(`- ${approach}`);
      });
      lines.push('');
    }
    if (intelligenceBlock.openProblems?.length > 0) {
      lines.push('### Open Problems');
      intelligenceBlock.openProblems.forEach(p => {
        const problem = typeof p === 'string' ? p : (p.problem || p.description || JSON.stringify(p));
        lines.push(`- ${problem}`);
      });
      lines.push('');
    }
    if (intelligenceBlock.piPublicationSummary?.length > 0) {
      lines.push('### PI Publication Summary');
      intelligenceBlock.piPublicationSummary.forEach(p => {
        if (typeof p === 'string') { lines.push(`- ${p}`); return; }
        const name = p.piName || p.name || p.pi || 'PI';
        const parts = [`**${name}**`];
        if (p.recentTopics?.length) parts.push(`Recent topics: ${p.recentTopics.join(', ')}`);
        if (p.apparentExpertise?.length) parts.push(`Expertise: ${p.apparentExpertise.join(', ')}`);
        if (p.notableGaps) parts.push(`Gaps: ${p.notableGaps}`);
        lines.push(`- ${parts.join('. ')}`);
      });
      lines.push('');
    }
    if (intelligenceBlock.additionalContext) {
      lines.push('### Additional Context');
      lines.push(intelligenceBlock.additionalContext);
      lines.push('');
    }
    lines.push('---');
    lines.push('');
  }

  if (panelSummary?.panelRecommendation) {
    lines.push('## Panel Recommendation');
    lines.push(panelSummary.panelRecommendation);
    if (panelSummary.confidenceNote) {
      lines.push('');
      lines.push(`*${panelSummary.confidenceNote}*`);
    }
    lines.push('');
  }

  // Rating matrix
  if (panelSummary?.ratingMatrix) {
    lines.push('## Rating Comparison');
    const reviewerNames = Object.keys(panelSummary.ratingMatrix.overallRating || panelSummary.ratingMatrix.impactRating || {});
    lines.push(`| Criterion | ${reviewerNames.join(' | ')} |`);
    lines.push(`| --- | ${reviewerNames.map(() => '---').join(' | ')} |`);
    for (const [key, label] of [['impactRating', 'Impact'], ['riskRating', 'Risk'], ['overallRating', 'Overall']]) {
      const ratings = panelSummary.ratingMatrix[key];
      if (ratings) {
        lines.push(`| ${label} | ${reviewerNames.map(r => ratings[r] || 'N/A').join(' | ')} |`);
      }
    }
    lines.push('');
  }

  if (panelSummary?.consensus?.length > 0) {
    lines.push('## Consensus Points');
    panelSummary.consensus.forEach(p => lines.push(`- ${p}`));
    lines.push('');
  }

  if (panelSummary?.keyStrengths?.length > 0) {
    lines.push('## Key Strengths');
    panelSummary.keyStrengths.forEach(s => lines.push(`- ${s}`));
    lines.push('');
  }

  if (panelSummary?.keyConcerns?.length > 0) {
    lines.push('## Key Concerns');
    panelSummary.keyConcerns.forEach((c, i) => lines.push(`${i + 1}. ${c}`));
    lines.push('');
  }

  if (panelSummary?.disagreements?.length > 0) {
    lines.push('## Disagreements');
    panelSummary.disagreements.forEach(d => {
      lines.push(`### ${d.topic}`);
      if (d.positions) {
        Object.entries(d.positions).forEach(([reviewer, position]) => {
          lines.push(`- **${reviewer}:** ${position}`);
        });
      }
      if (d.significance) lines.push(`\n*${d.significance}*`);
      lines.push('');
    });
  }

  if (panelSummary?.questionsForPI?.length > 0) {
    lines.push('## Questions for the PI');
    panelSummary.questionsForPI.forEach((q, i) => lines.push(`${i + 1}. ${q}`));
    lines.push('');
  }

  if (panelSummary?.resolvableVsFundamental?.length > 0) {
    lines.push('## Resolvable vs. Fundamental Concerns');
    panelSummary.resolvableVsFundamental.forEach(item => {
      const text = typeof item === 'string' ? item : `${item.classification || item.type ? `[${item.classification || item.type}] ` : ''}${item.concern || item.issue || item.description || JSON.stringify(item)}${item.resolution ? ` — ${item.resolution}` : ''}`;
      lines.push(`- ${text}`);
    });
    lines.push('');
  }

  if (panelSummary?.claimVerificationHighlights?.length > 0) {
    lines.push('## Claim Verification Highlights');
    panelSummary.claimVerificationHighlights.forEach(h => lines.push(`- ⚠ ${h}`));
    lines.push('');
  }

  // Devil's Advocate summary from synthesis
  if (panelSummary?.devilsAdvocateSummary) {
    lines.push('## Devil\'s Advocate Summary');
    lines.push(panelSummary.devilsAdvocateSummary);
    lines.push('');
  }

  // Devil's Advocate full review
  if (devilsAdvocate?.parsedResponse) {
    const da = devilsAdvocate.parsedResponse;
    lines.push('## Devil\'s Advocate Review');
    lines.push(`*Adversarial review by ${devilsAdvocate.providerName} (${devilsAdvocate.model}) — intentionally one-sided*`);
    lines.push('');
    if (da.primaryConcern) { lines.push('### Primary Concern'); lines.push(da.primaryConcern); lines.push(''); }
    if (da.failureScenario) { lines.push('### Most Likely Failure Scenario'); lines.push(da.failureScenario); lines.push(''); }
    if (da.challengedAssumptions?.length > 0) {
      lines.push('### Challenged Assumptions');
      da.challengedAssumptions.forEach(a => lines.push(`- ${a}`));
      lines.push('');
    }
    if (da.competitiveWeaknesses) { lines.push('### Competitive Weaknesses'); lines.push(da.competitiveWeaknesses); lines.push(''); }
    if (da.budgetAndTimeline) { lines.push('### Budget & Timeline'); lines.push(da.budgetAndTimeline); lines.push(''); }
    if (da.bestCounterargument) { lines.push('### Best Counterargument'); lines.push(da.bestCounterargument); lines.push(''); }
    if (da.verdictIfSkeptical) { lines.push('### Skeptical Verdict'); lines.push(da.verdictIfSkeptical); lines.push(''); }
  }

  // Individual reviews
  lines.push('---');
  lines.push('## Individual Reviews');
  for (const review of structuredReviews) {
    const p = review.parsedResponse;
    if (!p) continue;
    lines.push(`### ${review.providerName} (${review.model})`);
    lines.push(`- **Impact:** ${p.impactRating || 'N/A'}`);
    if (p.impactNarrative) lines.push(`  ${p.impactNarrative}`);
    lines.push(`- **Risk:** ${p.riskRating || 'N/A'}`);
    if (p.riskNarrative) lines.push(`  ${p.riskNarrative}`);
    if (p.keyUncertaintyResolution) lines.push(`- **Key Uncertainty:** ${p.keyUncertaintyResolution}`);
    if (p.methodsAssessment) lines.push(`- **Methods:** ${p.methodsAssessment}`);
    if (p.questionsForPI) lines.push(`- **Questions for PI:** ${p.questionsForPI}`);
    if (p.teamAssessment) lines.push(`- **Team:** ${p.teamAssessment}`);
    if (p.fundingAlternatives) lines.push(`- **Funding Alternatives:** ${p.fundingAlternatives}`);
    if (p.budgetIssues) lines.push(`- **Budget:** ${p.budgetIssues}`);
    lines.push(`- **Overall:** ${p.overallRating || 'N/A'}`);
    if (p.additionalComments) lines.push(`- **Additional:** ${p.additionalComments}`);
    lines.push('');
  }

  // Cost
  if (costBreakdown) {
    lines.push('## Cost Breakdown');
    lines.push('| Provider | Cost |');
    lines.push('| --- | --- |');
    Object.entries(costBreakdown).forEach(([provider, cost]) => {
      const name = PROVIDER_INFO[provider]?.name || provider;
      lines.push(`| ${name} | $${(cost / 100).toFixed(4)} |`);
    });
    lines.push(`| **Total** | **$${((totalCostCents || 0) / 100).toFixed(4)}** |`);
    lines.push('');
  }

  return lines.join('\n');
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Build and download DOCX export
 */
async function downloadDocx(proposalFilename, panelSummary, structuredReviews, claimVerifications, costBreakdown, totalCostCents, intelligenceBlock, devilsAdvocate) {
  const children = [];
  const baseName = proposalFilename?.replace(/\.pdf$/i, '') || 'proposal';

  children.push(new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun('Virtual Review Panel Report')] }));
  children.push(new Paragraph({ children: [new TextRun({ text: `Proposal: ${proposalFilename}`, bold: true })] }));
  children.push(new Paragraph({ children: [new TextRun(`Date: ${new Date().toLocaleDateString()}`)] }));
  children.push(new Paragraph({ children: [new TextRun(`Reviewers: ${structuredReviews.map(r => `${r.providerName} (${r.model})`).join(', ')}`)] }));
  children.push(new Paragraph({ text: '' }));

  // Stage 0: Pre-Review Intelligence
  if (intelligenceBlock) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Pre-Review Intelligence (Stage 0)')] }));
    if (intelligenceBlock.landscapeSummary) {
      children.push(new Paragraph({ children: [new TextRun(intelligenceBlock.landscapeSummary)] }));
      children.push(new Paragraph({ text: '' }));
    }
    if (intelligenceBlock.mostRelevantPapers?.length > 0) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('Most Relevant Papers')] }));
      intelligenceBlock.mostRelevantPapers.forEach(p => {
        if (typeof p === 'string') { children.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun(p)] })); return; }
        const citation = p.citation || p.title || p.name || 'Unknown';
        const runs = [new TextRun({ text: citation, bold: true })];
        const detail = p.relevanceToProposal || p.relevance;
        if (detail) runs.push(new TextRun(` — ${detail}`));
        if (p.comparability) runs.push(new TextRun({ text: ` [${p.comparability}]`, italics: true }));
        children.push(new Paragraph({ bullet: { level: 0 }, children: runs }));
      });
      children.push(new Paragraph({ text: '' }));
    }
    if (intelligenceBlock.activeGroups?.length > 0) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('Active Research Groups')] }));
      intelligenceBlock.activeGroups.forEach(g => {
        if (typeof g === 'string') { children.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun(g)] })); return; }
        const name = g.pi || g.name || g.group || 'Unknown';
        const runs = [new TextRun({ text: g.institution ? `${name} (${g.institution})` : name, bold: true })];
        if (g.focus) runs.push(new TextRun(` — ${g.focus}`));
        if (g.recentActivity) runs.push(new TextRun({ text: `. ${g.recentActivity}`, italics: true }));
        children.push(new Paragraph({ bullet: { level: 0 }, children: runs }));
      });
      children.push(new Paragraph({ text: '' }));
    }
    if (intelligenceBlock.competingApproaches?.length > 0) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('Competing Approaches')] }));
      intelligenceBlock.competingApproaches.forEach(a => {
        const approach = typeof a === 'string' ? a : (a.approach || a.name || a.description || JSON.stringify(a));
        children.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun(approach)] }));
      });
      children.push(new Paragraph({ text: '' }));
    }
    if (intelligenceBlock.openProblems?.length > 0) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('Open Problems')] }));
      intelligenceBlock.openProblems.forEach(p => {
        const problem = typeof p === 'string' ? p : (p.problem || p.description || JSON.stringify(p));
        children.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun(problem)] }));
      });
      children.push(new Paragraph({ text: '' }));
    }
    if (intelligenceBlock.piPublicationSummary?.length > 0) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('PI Publication Summary')] }));
      intelligenceBlock.piPublicationSummary.forEach(p => {
        if (typeof p === 'string') { children.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun(p)] })); return; }
        const name = p.piName || p.name || p.pi || 'PI';
        const runs = [new TextRun({ text: name, bold: true })];
        if (p.recentTopics?.length) runs.push(new TextRun(`. Recent topics: ${p.recentTopics.join(', ')}`));
        if (p.apparentExpertise?.length) runs.push(new TextRun(`. Expertise: ${p.apparentExpertise.join(', ')}`));
        if (p.notableGaps) runs.push(new TextRun({ text: `. Gaps: ${p.notableGaps}`, italics: true }));
        children.push(new Paragraph({ bullet: { level: 0 }, children: runs }));
      });
      children.push(new Paragraph({ text: '' }));
    }
    if (intelligenceBlock.additionalContext) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('Additional Context')] }));
      children.push(new Paragraph({ children: [new TextRun(intelligenceBlock.additionalContext)] }));
      children.push(new Paragraph({ text: '' }));
    }
  }

  if (panelSummary?.panelRecommendation) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Panel Recommendation')] }));
    children.push(new Paragraph({ children: [new TextRun(panelSummary.panelRecommendation)] }));
    if (panelSummary.confidenceNote) {
      children.push(new Paragraph({ children: [new TextRun({ text: panelSummary.confidenceNote, italics: true })] }));
    }
    children.push(new Paragraph({ text: '' }));
  }

  // Rating matrix as table
  if (panelSummary?.ratingMatrix) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Rating Comparison')] }));
    const reviewerNames = Object.keys(panelSummary.ratingMatrix.overallRating || panelSummary.ratingMatrix.impactRating || {});
    const headerRow = new TableRow({
      children: [
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Criterion', bold: true })] })], width: { size: 20, type: WidthType.PERCENTAGE } }),
        ...reviewerNames.map(name => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: name, bold: true })], alignment: AlignmentType.CENTER })], width: { size: Math.floor(80 / reviewerNames.length), type: WidthType.PERCENTAGE } })),
      ],
    });
    const dataRows = [['impactRating', 'Impact'], ['riskRating', 'Risk'], ['overallRating', 'Overall']]
      .filter(([key]) => panelSummary.ratingMatrix[key])
      .map(([key, label]) => new TableRow({
        children: [
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: label, bold: true })] })] }),
          ...reviewerNames.map(name => new TableCell({ children: [new Paragraph({ children: [new TextRun(panelSummary.ratingMatrix[key][name] || 'N/A')], alignment: AlignmentType.CENTER })] })),
        ],
      }));
    children.push(new Table({ rows: [headerRow, ...dataRows], width: { size: 100, type: WidthType.PERCENTAGE } }));
    children.push(new Paragraph({ text: '' }));
  }

  if (panelSummary?.consensus?.length > 0) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Consensus Points')] }));
    panelSummary.consensus.forEach(p => children.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun(p)] })));
    children.push(new Paragraph({ text: '' }));
  }

  if (panelSummary?.keyStrengths?.length > 0) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Key Strengths')] }));
    panelSummary.keyStrengths.forEach(s => children.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun(s)] })));
    children.push(new Paragraph({ text: '' }));
  }

  if (panelSummary?.keyConcerns?.length > 0) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Key Concerns')] }));
    panelSummary.keyConcerns.forEach((c, i) => children.push(new Paragraph({ children: [new TextRun(`${i + 1}. ${c}`)] })));
    children.push(new Paragraph({ text: '' }));
  }

  if (panelSummary?.disagreements?.length > 0) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Disagreements')] }));
    panelSummary.disagreements.forEach(d => {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(d.topic)] }));
      if (d.positions) {
        Object.entries(d.positions).forEach(([reviewer, position]) => {
          children.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: `${reviewer}: `, bold: true }), new TextRun(position)] }));
        });
      }
      if (d.significance) {
        children.push(new Paragraph({ children: [new TextRun({ text: d.significance, italics: true })] }));
      }
    });
    children.push(new Paragraph({ text: '' }));
  }

  if (panelSummary?.questionsForPI?.length > 0) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Questions for the PI')] }));
    panelSummary.questionsForPI.forEach((q, i) => children.push(new Paragraph({ children: [new TextRun(`${i + 1}. ${q}`)] })));
    children.push(new Paragraph({ text: '' }));
  }

  if (panelSummary?.resolvableVsFundamental?.length > 0) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Resolvable vs. Fundamental Concerns')] }));
    panelSummary.resolvableVsFundamental.forEach(item => {
      const text = typeof item === 'string' ? item : `${item.classification || item.type ? `[${item.classification || item.type}] ` : ''}${item.concern || item.issue || item.description || JSON.stringify(item)}${item.resolution ? ` — ${item.resolution}` : ''}`;
      children.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun(text)] }));
    });
    children.push(new Paragraph({ text: '' }));
  }

  // Devil's Advocate summary from synthesis
  if (panelSummary?.devilsAdvocateSummary) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Devil\'s Advocate Summary')] }));
    children.push(new Paragraph({ children: [new TextRun(panelSummary.devilsAdvocateSummary)] }));
    children.push(new Paragraph({ text: '' }));
  }

  // Devil's Advocate full review
  if (devilsAdvocate?.parsedResponse) {
    const da = devilsAdvocate.parsedResponse;
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Devil\'s Advocate Review')] }));
    children.push(new Paragraph({ children: [new TextRun({ text: `Adversarial review by ${devilsAdvocate.providerName} (${devilsAdvocate.model}) — intentionally one-sided`, italics: true })] }));
    children.push(new Paragraph({ text: '' }));
    if (da.primaryConcern) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('Primary Concern')] }));
      children.push(new Paragraph({ children: [new TextRun(da.primaryConcern)] }));
    }
    if (da.failureScenario) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('Most Likely Failure Scenario')] }));
      children.push(new Paragraph({ children: [new TextRun(da.failureScenario)] }));
    }
    if (da.challengedAssumptions?.length > 0) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('Challenged Assumptions')] }));
      da.challengedAssumptions.forEach(a => children.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun(a)] })));
    }
    if (da.competitiveWeaknesses) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('Competitive Weaknesses')] }));
      children.push(new Paragraph({ children: [new TextRun(da.competitiveWeaknesses)] }));
    }
    if (da.budgetAndTimeline) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('Budget & Timeline')] }));
      children.push(new Paragraph({ children: [new TextRun(da.budgetAndTimeline)] }));
    }
    if (da.bestCounterargument) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('Best Counterargument')] }));
      children.push(new Paragraph({ children: [new TextRun(da.bestCounterargument)] }));
    }
    if (da.verdictIfSkeptical) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('Skeptical Verdict')] }));
      children.push(new Paragraph({ children: [new TextRun(da.verdictIfSkeptical)] }));
    }
    children.push(new Paragraph({ text: '' }));
  }

  // Individual reviews
  children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Individual Reviews')] }));
  for (const review of structuredReviews) {
    const p = review.parsedResponse;
    if (!p) continue;
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(`${review.providerName} (${review.model})`)] }));
    const fields = [
      ['Impact', p.impactRating, p.impactNarrative],
      ['Risk', p.riskRating, p.riskNarrative],
      ['Key Uncertainty', null, p.keyUncertaintyResolution],
      ['Methods', null, p.methodsAssessment],
      ['Questions for PI', null, p.questionsForPI],
      ['Team', null, p.teamAssessment],
      ['Funding Alternatives', null, p.fundingAlternatives],
      ['Budget', null, p.budgetIssues],
      ['Overall', p.overallRating, null],
      ['Additional Comments', null, p.additionalComments],
    ];
    for (const [label, rating, narrative] of fields) {
      const runs = [new TextRun({ text: `${label}: `, bold: true })];
      if (rating) runs.push(new TextRun({ text: rating, bold: true }));
      if (rating && narrative) runs.push(new TextRun(' — '));
      if (narrative) runs.push(new TextRun(narrative));
      if (rating || narrative) children.push(new Paragraph({ children: runs }));
    }
    children.push(new Paragraph({ text: '' }));
  }

  // Cost
  if (costBreakdown) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Cost Breakdown')] }));
    const costRows = Object.entries(costBreakdown).map(([provider, cost]) =>
      new TableRow({
        children: [
          new TableCell({ children: [new Paragraph({ children: [new TextRun(PROVIDER_INFO[provider]?.name || provider)] })] }),
          new TableCell({ children: [new Paragraph({ children: [new TextRun(`$${(cost / 100).toFixed(4)}`)], alignment: AlignmentType.RIGHT })] }),
        ],
      })
    );
    costRows.push(new TableRow({
      children: [
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Total', bold: true })] })] }),
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: `$${((totalCostCents || 0) / 100).toFixed(4)}`, bold: true })], alignment: AlignmentType.RIGHT })] }),
      ],
    }));
    children.push(new Table({
      rows: [
        new TableRow({
          children: [
            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Provider', bold: true })] })] }),
            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Cost', bold: true })], alignment: AlignmentType.RIGHT })] }),
          ],
        }),
        ...costRows,
      ],
      width: { size: 50, type: WidthType.PERCENTAGE },
    }));
  }

  const doc = new Document({ sections: [{ children }] });
  const buffer = await Packer.toBlob(doc);
  const url = URL.createObjectURL(buffer);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${baseName}_panel_review.docx`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Main Virtual Review Panel component
 */
function VirtualReviewPanelContent() {
  const [files, setFiles] = useState([]);
  const [selectedProviders, setSelectedProviders] = useState(['claude', 'openai']);
  const [includeClaimVerification, setIncludeClaimVerification] = useState(true);
  const [includeIntelligencePass, setIncludeIntelligencePass] = useState(false);
  const [includeDevilsAdvocate, setIncludeDevilsAdvocate] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [events, setEvents] = useState([]);
  const [providerStatuses, setProviderStatuses] = useState({});
  const [currentStage, setCurrentStage] = useState(null);
  const [panelSummary, setPanelSummary] = useState(null);
  const [structuredReviews, setStructuredReviews] = useState([]);
  const [claimVerifications, setClaimVerifications] = useState([]);
  const [devilsAdvocate, setDevilsAdvocate] = useState(null);
  const [costBreakdown, setCostBreakdown] = useState(null);
  const [totalCostCents, setTotalCostCents] = useState(null);
  const [intelligenceBlock, setIntelligenceBlock] = useState(null);
  const [availableProviders, setAvailableProviders] = useState(Object.keys(PROVIDER_INFO));
  const [providerModels, setProviderModels] = useState({});
  const [processingStartedAt, setProcessingStartedAt] = useState(null);
  const eventSourceRef = useRef(null);

  // Fetch available providers and models from server on mount
  useEffect(() => {
    fetch('/api/virtual-review-panel')
      .then(res => res.json())
      .then(data => {
        if (data.providers) {
          setAvailableProviders(data.providers.map(p => p.key));
          const models = {};
          data.providers.forEach(p => { models[p.key] = p.model; });
          setProviderModels(models);
          // Auto-select all available providers
          setSelectedProviders(prev => {
            const available = data.providers.map(p => p.key);
            return prev.filter(p => available.includes(p));
          });
        }
      })
      .catch(() => { /* use defaults */ });
  }, []);

  const handleSubmit = useCallback(async () => {
    if (files.length === 0) return;
    if (selectedProviders.length < 2) {
      setError('Please select at least 2 LLM providers');
      return;
    }

    setProcessing(true);
    setProcessingStartedAt(Date.now());
    setError(null);
    setEvents([]);
    setProviderStatuses({});
    setCurrentStage(null);
    setPanelSummary(null);
    setStructuredReviews([]);
    setClaimVerifications([]);
    setDevilsAdvocate(null);
    setCostBreakdown(null);
    setTotalCostCents(null);
    setIntelligenceBlock(null);

    try {
      const response = await fetch('/api/virtual-review-panel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: files.map(f => ({ url: f.url, filename: f.filename })),
          providers: selectedProviders,
          includeClaimVerification,
          includeIntelligencePass,
          includeDevilsAdvocate,
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
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            handleEvent(data);
          } catch {
            // Skip malformed events
          }
        }
      }

      // Process remaining buffer
      if (buffer.startsWith('data: ')) {
        try {
          const data = JSON.parse(buffer.slice(6));
          handleEvent(data);
        } catch {
          // Skip
        }
      }
    } catch (err) {
      setError(err.message || 'Failed to connect to review panel API');
    } finally {
      setProcessing(false);
    }
    // handleEvent is a stable useCallback ([] deps); it's also declared below,
    // so listing it here would hit the TDZ. Omission is intentional and safe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, selectedProviders, includeClaimVerification, includeIntelligencePass, includeDevilsAdvocate]);

  const handleEvent = useCallback((data) => {
    setEvents(prev => [...prev, data]);

    switch (data.event) {
    case 'progress':
      if (data.providers) {
        setAvailableProviders(data.providers.map(p => p.key));
      }
      break;

    case 'stage_start':
      setCurrentStage(data.stage);
      break;

    case 'provider_start':
      setProviderStatuses(prev => ({
        ...prev,
        [`${data.provider}_${data.stage}`]: { status: 'in_progress', stage: data.stage },
      }));
      break;

    case 'provider_complete':
      setProviderStatuses(prev => ({
        ...prev,
        [`${data.provider}_${data.stage}`]: {
          status: 'completed',
          stage: data.stage,
          latencyMs: data.latencyMs,
          model: data.model,
        },
      }));

      if (data.stage === 'structured_review') {
        setStructuredReviews(prev => [...prev, {
          provider: data.provider,
          providerName: data.providerName,
          model: data.model,
          parsedResponse: data.parsedResponse,
          costCents: data.costCents,
          latencyMs: data.latencyMs,
        }]);
      } else if (data.stage === 'claim_verification') {
        setClaimVerifications(prev => [...prev, {
          provider: data.provider,
          providerName: data.providerName,
          model: data.model,
          parsedResponse: data.parsedResponse,
          citations: data.citations,
        }]);
      }
      break;

    case 'provider_error':
      setProviderStatuses(prev => ({
        ...prev,
        [`${data.provider}_${data.stage}`]: { status: 'failed', stage: data.stage },
      }));
      break;

    case 'synthesis_complete':
      setCurrentStage('synthesis_complete');
      break;

    case 'complete':
      setPanelSummary(data.panelSummary);
      setCostBreakdown(data.costBreakdown);
      setTotalCostCents(data.totalCostCents);
      if (data.intelligenceBlock) setIntelligenceBlock(data.intelligenceBlock);
      if (data.devilsAdvocate) setDevilsAdvocate(data.devilsAdvocate);
      break;

    case 'error':
      setError(data.message);
      break;
    }
  }, []);

  const hasResults = panelSummary || structuredReviews.length > 0;

  return (
    <Layout
      title="Virtual Review Panel"
      description="Multi-LLM review panel that evaluates grant proposals against WMKF reviewer criteria"
    >
      <PageHeader
        title="Virtual Review Panel"
        subtitle="Multiple AI models independently review proposals using the WMKF reviewer form, then a panel summary synthesizes their assessments"
      />

      <div className="space-y-6">
        {/* Upload Section */}
        <Card title="Upload Proposal">
          <FileUploaderSimple
            onFilesUploaded={setFiles}
            multiple={false}
            accept=".pdf"
          />
          {files.length > 0 && (
            <p className="text-sm text-green-600 mt-2">
              Uploaded: {files[0].filename}
            </p>
          )}
        </Card>

        {/* Configuration */}
        <Card title="Panel Configuration">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select LLM Reviewers (minimum 2)
              </label>
              <ProviderSelector
                selected={selectedProviders}
                available={availableProviders}
                providerModels={providerModels}
                onChange={setSelectedProviders}
                disabled={processing}
              />
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeIntelligencePass}
                  onChange={(e) => setIncludeIntelligencePass(e.target.checked)}
                  disabled={processing}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">
                  Include pre-review intelligence pass (Stage 0) — searches academic databases to ground reviews in real literature
                </span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeClaimVerification}
                  onChange={(e) => setIncludeClaimVerification(e.target.checked)}
                  disabled={processing}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">
                  Include claim verification (Stage 1) — verifies novelty claims and checks for precedent
                </span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeDevilsAdvocate}
                  onChange={(e) => setIncludeDevilsAdvocate(e.target.checked)}
                  disabled={processing}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">
                  Include devil&apos;s advocate — one model finds strongest reasons NOT to fund (labeled separately)
                </span>
              </label>
            </div>
          </div>
        </Card>

        {/* Submit */}
        <div className="flex justify-center">
          <Button
            onClick={handleSubmit}
            disabled={processing || files.length === 0 || selectedProviders.length < 2}
            className="px-8 py-3"
          >
            {processing ? 'Running Panel Review...' : 'Run Virtual Review Panel'}
          </Button>
        </div>

        {error && <ErrorAlert message={error} onDismiss={() => setError(null)} />}

        {/* Progress Section — visible during processing AND after completion */}
        {(processing || events.length > 0) && (
          <Card title={processing ? 'Panel Progress' : 'Panel Progress (Complete)'}>
            <div className="space-y-4">
              {currentStage && (
                <div className={`flex items-center justify-between text-sm font-medium mb-2 ${processing ? 'text-blue-600' : 'text-green-600'}`}>
                  <span>{processing ? `Current stage: ${currentStage.replace(/_/g, ' ')}` : 'All stages complete'}</span>
                  {processingStartedAt && <OverallTimer startedAt={processingStartedAt} running={processing} />}
                </div>
              )}

              {/* Intelligence Pass status */}
              {includeIntelligencePass && events.some(e => e.message?.startsWith('Stage 0')) && (
                <div>
                  <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">Pre-Review Intelligence (Stage 0)</h4>
                  <div className="bg-gray-50 rounded-lg p-3 space-y-1">
                    {events
                      .filter(e => e.message?.startsWith('Stage 0') || e.message?.includes('Intelligence pass'))
                      .map((e, i) => (
                        <div key={i} className="text-sm text-gray-600 flex items-center gap-2">
                          {e.message.includes('complete') || e.message.includes('Complete')
                            ? <span className="text-green-500">&#10003;</span>
                            : e.message.includes('failed') || e.message.includes('Failed')
                            ? <span className="text-red-500">&#10007;</span>
                            : <span className="text-blue-500 animate-pulse">&#9679;</span>}
                          <span>{e.message}</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* Claim Verification status */}
              {includeClaimVerification && Object.keys(providerStatuses).some(k => k.includes('claim_verification')) && (
                <div>
                  <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">Claim Verification</h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {selectedProviders.map(p => {
                      const key = `${p}_claim_verification`;
                      const s = providerStatuses[key] || { status: 'pending' };
                      return (
                        <ProviderStatusCard
                          key={key}
                          provider={p}
                          status={s.status}
                          stage="claim verification"
                          latencyMs={s.latencyMs}
                          model={s.model || providerModels[p]}
                        />
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Structured Review status */}
              {Object.keys(providerStatuses).some(k => k.includes('structured_review')) && (
                <div>
                  <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">Structured Review</h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {selectedProviders.map(p => {
                      const key = `${p}_structured_review`;
                      const s = providerStatuses[key] || { status: 'pending' };
                      return (
                        <ProviderStatusCard
                          key={key}
                          provider={p}
                          status={s.status}
                          stage="structured review"
                          latencyMs={s.latencyMs}
                          model={s.model || providerModels[p]}
                        />
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Devil's Advocate status */}
              {includeDevilsAdvocate && Object.keys(providerStatuses).some(k => k.includes('devils_advocate')) && (
                <div>
                  <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">Devil&apos;s Advocate</h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {Object.entries(providerStatuses)
                      .filter(([k]) => k.includes('devils_advocate'))
                      .map(([key, s]) => {
                        const provider = key.replace('_devils_advocate', '');
                        return (
                          <ProviderStatusCard
                            key={key}
                            provider={provider}
                            status={s.status}
                            stage="devil's advocate"
                            latencyMs={s.latencyMs}
                            model={s.model || providerModels[provider]}
                          />
                        );
                      })}
                  </div>
                </div>
              )}

              {/* Event log */}
              <details className="text-xs text-gray-400">
                <summary className="cursor-pointer">Event log ({events.length} events)</summary>
                <pre className="mt-2 max-h-40 overflow-y-auto bg-gray-50 p-2 rounded">
                  {events.map((e, i) => (
                    <div key={i}>{e.event}: {e.message || e.provider || e.error || ''}</div>
                  ))}
                </pre>
              </details>
            </div>
          </Card>
        )}

        {/* Results Section */}
        {hasResults && (
          <div className="space-y-6">
            {/* Export Buttons */}
            <div className="flex gap-3 justify-end">
              <Button
                onClick={() => {
                  const md = buildMarkdownExport(files[0]?.filename, panelSummary, structuredReviews, claimVerifications, costBreakdown, totalCostCents, intelligenceBlock, devilsAdvocate);
                  const baseName = (files[0]?.filename || 'proposal').replace(/\.pdf$/i, '');
                  downloadFile(md, `${baseName}_panel_review.md`, 'text/markdown');
                }}
                className="text-sm px-4 py-2"
              >
                Export Markdown
              </Button>
              <Button
                onClick={() => downloadDocx(files[0]?.filename, panelSummary, structuredReviews, claimVerifications, costBreakdown, totalCostCents, intelligenceBlock, devilsAdvocate)}
                className="text-sm px-4 py-2"
              >
                Export DOCX
              </Button>
            </div>

            {/* Rating Matrix */}
            {panelSummary?.ratingMatrix && (
              <RatingMatrix
                ratingMatrix={panelSummary.ratingMatrix}
                providers={structuredReviews.map(r => r.providerName)}
              />
            )}

            {/* Panel Summary */}
            <PanelSummary summary={panelSummary} />

            {/* Devil's Advocate Review */}
            {devilsAdvocate?.parsedResponse && (
              <Card title="Devil's Advocate Review">
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <p className="text-xs text-red-600 italic mb-3">
                    Adversarial review by {devilsAdvocate.providerName} ({devilsAdvocate.model}) — intentionally one-sided to stress-test the proposal
                  </p>
                  {devilsAdvocate.parsedResponse.primaryConcern && (
                    <div className="mb-3">
                      <h5 className="text-sm font-medium text-gray-800 mb-1">Primary Concern</h5>
                      <p className="text-sm text-gray-700">{devilsAdvocate.parsedResponse.primaryConcern}</p>
                    </div>
                  )}
                  {devilsAdvocate.parsedResponse.failureScenario && (
                    <div className="mb-3">
                      <h5 className="text-sm font-medium text-gray-800 mb-1">Most Likely Failure Scenario</h5>
                      <p className="text-sm text-gray-700">{devilsAdvocate.parsedResponse.failureScenario}</p>
                    </div>
                  )}
                  {devilsAdvocate.parsedResponse.challengedAssumptions?.length > 0 && (
                    <div className="mb-3">
                      <h5 className="text-sm font-medium text-gray-800 mb-1">Challenged Assumptions</h5>
                      <ul className="list-disc list-inside text-sm text-gray-700 space-y-1">
                        {devilsAdvocate.parsedResponse.challengedAssumptions.map((a, i) => (
                          <li key={i}>{a}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {devilsAdvocate.parsedResponse.competitiveWeaknesses && (
                    <div className="mb-3">
                      <h5 className="text-sm font-medium text-gray-800 mb-1">Competitive Weaknesses</h5>
                      <p className="text-sm text-gray-700">{devilsAdvocate.parsedResponse.competitiveWeaknesses}</p>
                    </div>
                  )}
                  {devilsAdvocate.parsedResponse.budgetAndTimeline && (
                    <div className="mb-3">
                      <h5 className="text-sm font-medium text-gray-800 mb-1">Budget & Timeline</h5>
                      <p className="text-sm text-gray-700">{devilsAdvocate.parsedResponse.budgetAndTimeline}</p>
                    </div>
                  )}
                  {devilsAdvocate.parsedResponse.bestCounterargument && (
                    <div className="mb-3">
                      <h5 className="text-sm font-medium text-gray-800 mb-1">Best Counterargument</h5>
                      <p className="text-sm text-gray-700">{devilsAdvocate.parsedResponse.bestCounterargument}</p>
                    </div>
                  )}
                  {devilsAdvocate.parsedResponse.verdictIfSkeptical && (
                    <div>
                      <h5 className="text-sm font-medium text-gray-800 mb-1">Skeptical Verdict</h5>
                      <p className="text-sm text-gray-700">{devilsAdvocate.parsedResponse.verdictIfSkeptical}</p>
                    </div>
                  )}
                </div>
              </Card>
            )}

            {/* Individual Reviews */}
            <Card title="Individual Reviewer Assessments">
              <div className="space-y-3">
                {structuredReviews.map((review, i) => (
                  <ReviewerCard key={i} review={review} />
                ))}
              </div>
            </Card>

            {/* Claim Verifications */}
            {claimVerifications.length > 0 && (
              <Card title="Claim Verification Details">
                <div className="space-y-4">
                  {claimVerifications.map((cv, i) => {
                    const info = PROVIDER_INFO[cv.provider] || { name: cv.providerName, icon: '⚪' };
                    return (
                      <details key={i} className="border border-gray-200 rounded-lg">
                        <summary className="p-3 cursor-pointer hover:bg-gray-50 flex items-center gap-2">
                          <span>{info.icon}</span>
                          <span className="font-medium">{info.name}</span>
                          {cv.parsedResponse?.claims && (
                            <span className="text-xs text-gray-400">
                              ({cv.parsedResponse.claims.length} claims analyzed)
                            </span>
                          )}
                        </summary>
                        <div className="p-4 border-t border-gray-200 bg-gray-50">
                          {cv.parsedResponse?.overallNoveltyAssessment && (
                            <p className="text-sm text-gray-700 mb-3">
                              <strong>Novelty Assessment:</strong> {cv.parsedResponse.overallNoveltyAssessment}
                            </p>
                          )}
                          {cv.parsedResponse?.redFlags?.length > 0 && (
                            <div className="mb-3">
                              <strong className="text-sm text-red-700">Red Flags:</strong>
                              <ul className="list-disc list-inside text-sm text-red-600 mt-1">
                                {cv.parsedResponse.redFlags.map((f, j) => (
                                  <li key={j}>{f}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {cv.parsedResponse?.claims?.map((claim, j) => (
                            <div key={j} className="mb-2 p-2 bg-white rounded border border-gray-100 text-sm">
                              <div className="font-medium text-gray-800">{claim.claim}</div>
                              <div className="flex gap-2 mt-1">
                                <span className={`px-1.5 py-0.5 rounded text-xs ${
                                  claim.assessment === 'supported' ? 'bg-green-100 text-green-700' :
                                  claim.assessment === 'partially_supported' ? 'bg-yellow-100 text-yellow-700' :
                                  claim.assessment === 'unsupported' ? 'bg-red-100 text-red-700' :
                                  'bg-gray-100 text-gray-600'
                                }`}>
                                  {claim.assessment?.replace('_', ' ')}
                                </span>
                                <span className="text-xs text-gray-400">{claim.category}</span>
                              </div>
                              {claim.reasoning && (
                                <p className="text-xs text-gray-600 mt-1">{claim.reasoning}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      </details>
                    );
                  })}
                </div>
              </Card>
            )}

            {/* Cost Breakdown */}
            <CostBreakdown costBreakdown={costBreakdown} totalCostCents={totalCostCents} />
          </div>
        )}
      </div>
    </Layout>
  );
}

export default function VirtualReviewPanel() {
  return (
    <RequireAppAccess appKey="virtual-review-panel">
      <VirtualReviewPanelContent />
    </RequireAppAccess>
  );
}
