'use strict';

const fs = require('fs');
const path = require('path');

const SOURCE_PATH_RE = /(?:^|[\s([`'"])((?:pages|lib)\/[A-Za-z0-9._~@/[\]-]+\.(?:js|jsx|ts|tsx|mjs|cjs))(?:[:#]\d+)?/g;
const PATH_LINE_RE = /\b(?:pages|lib|scripts|shared|docs)\/[^\s)`,;]+:\d+\b/;
const EMAIL_ADDRESS_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/ig;
const EMAIL_OWNERSHIP_CLAIM_RE =
  /\b(?:almost certainly|certainly|definitely|undoubtedly|surely|belongs? to|namesake|role mailbox|generic mailbox|shared mailbox|personal (?:email|address)|published (?:email|address)|real (?:email|address)|correct(?:-person)? (?:email|address)|wrong(?:-person)? (?:email|address)|different [A-Z][\p{L}'’-]+)\b/iu;
const CLAIM_HEDGE_RE =
  /\b(?:likely|appears?|may|might|probably|possibly|unclear|unverified|not (?:yet )?verified|could be|cannot confirm|we did not verify)\b/i;
const CLAIM_ASSUMED_RE = /\[ASSUMED(?:[:\]\s])/i;
const CLAIM_VERIFIED_RE =
  /\[VERIFIED via (?:https?:\/\/|(?:pages|lib|scripts|shared|docs)\/)[^\]]+\]/i;
const CLAIM_URL_RE = /https?:\/\/[^\s)>\]]+/i;
const CLAIM_EXEMPT_RE =
  /<!--\s*assertion-exempt:\s*(?:quoted-example|hypothetical|template)\s*-->/i;
const ADVERSARIAL_REVIEW_WAIVER_RE =
  /<!--\s*adversarial-review:waived\s+reason=([^>]{5,})-->/i;
const ADVERSARIAL_REVIEW_RECEIPT_RE =
  /\[ADVERSARIAL-REVIEW-RECEIPT:\s*(docs\/[^\]\r\n]+\.md)\s*\]/gi;

function normalizeSlashes(value) {
  return String(value || '').replace(/\\/g, '/');
}

function withoutFencedCode(text) {
  let inFence = false;
  return String(text || '').split(/\r?\n/).map((line) => {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      return '';
    }
    return inFence ? '' : line;
  }).join('\n');
}

function proseSentences(text) {
  const prose = withoutFencedCode(text)
    .replace(/\r?\n(?!\s*\r?\n)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!prose) return [];
  return prose
    .split(/(?<=[.!?])\s+(?=(?:[-*]\s+|[#>*_`]*[A-Z]))/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function isExampleEmail(email) {
  const domain = String(email || '').split('@')[1]?.toLowerCase() || '';
  return /^(?:example\.(?:com|org|net)|example|test|invalid)$/.test(domain) ||
    /\.(?:test|invalid)$/.test(domain);
}

function hasClaimEvidenceOrHedge(sentence) {
  return CLAIM_ASSUMED_RE.test(sentence) ||
    CLAIM_VERIFIED_RE.test(sentence) ||
    CLAIM_URL_RE.test(sentence) ||
    PATH_LINE_RE.test(sentence) ||
    CLAIM_HEDGE_RE.test(sentence) ||
    CLAIM_EXEMPT_RE.test(sentence);
}

/**
 * Detect the narrow incident class that motivated the blocker: a durable prose
 * sentence asserts ownership/identity of a real email address without evidence,
 * an uncertainty label, or an explicitly enumerated non-claim exemption.
 *
 * This intentionally does NOT treat "clearly" or bare copulas as confidence
 * markers; both are too common in ordinary documentation to block precisely.
 */
function findUnverifiedReviewerEmailOwnershipClaims(text) {
  const claims = [];
  for (const sentence of proseSentences(text)) {
    const emails = [...sentence.matchAll(EMAIL_ADDRESS_RE)]
      .map((match) => match[0])
      .filter((email) => !isExampleEmail(email));
    if (!emails.length || !EMAIL_OWNERSHIP_CLAIM_RE.test(sentence)) continue;
    if (hasClaimEvidenceOrHedge(sentence)) continue;
    claims.push({ sentence, emails: [...new Set(emails.map((email) => email.toLowerCase()))] });
  }
  return claims;
}

function isHighRiskReviewArtifact(relativePath, text) {
  const rel = normalizeSlashes(relativePath);
  if (!/^docs\/.+\.md$/i.test(rel)) return false;
  const prose = withoutFencedCode(text);
  const hasVerdict = /^#{1,3}\s+(?:Final\s+)?Verdict\b/im.test(prose);
  const hasFindings = /^#{1,3}\s+(?:Prioritized\s+)?Findings\b/im.test(prose);
  const hasRecommendation =
    /\b(?:recommend(?:ation|ed|s)?|required (?:change|named changes)|correction)\b/i.test(prose);
  return hasVerdict && hasFindings && hasRecommendation;
}

function hasAdversarialReviewWaiver(text) {
  return ADVERSARIAL_REVIEW_WAIVER_RE.test(String(text || ''));
}

function extractAdversarialReviewReceiptPaths(prompt) {
  const paths = new Set();
  const body = String(prompt || '');
  let match;
  while ((match = ADVERSARIAL_REVIEW_RECEIPT_RE.exec(body)) !== null) {
    paths.add(normalizeSlashes(match[1].trim()));
  }
  return [...paths].sort();
}

function isQualifiedAdversarialReviewPrompt(prompt, relativePath) {
  const body = String(prompt || '');
  const rel = normalizeSlashes(relativePath);
  return extractAdversarialReviewReceiptPaths(body).includes(rel) &&
    /\b(?:adversarial|refut(?:e|ation)|find what is wrong|disconfirm)\b/i.test(body) &&
    /\bfor each recommendation\b/i.test(body) &&
    /\bfile:line\b/i.test(body) &&
    /\bdisconfirming check\b/i.test(body);
}

function repoRelative(root, filePath) {
  const absolute = path.isAbsolute(filePath) ? filePath : path.join(root, filePath);
  return normalizeSlashes(path.relative(root, absolute));
}

function resolveInside(root, rel) {
  const full = path.resolve(root, rel);
  const relative = normalizeSlashes(path.relative(root, full));
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return full;
}

function proposedTextForTool(data, root) {
  const tool = data && data.tool_name;
  const ti = (data && data.tool_input) || {};
  if (tool === 'Write') {
    return typeof ti.content === 'string' ? ti.content : null;
  }
  if (tool !== 'Edit') return null;

  const filePath = typeof ti.file_path === 'string' ? ti.file_path : '';
  if (!filePath) return null;
  const rel = repoRelative(root, filePath);
  const full = resolveInside(root, rel);
  if (!full || !fs.existsSync(full)) return null;

  const oldString = typeof ti.old_string === 'string' ? ti.old_string : '';
  const newString = typeof ti.new_string === 'string' ? ti.new_string : '';
  if (!oldString) return null;

  const existing = fs.readFileSync(full, 'utf8');
  if (!existing.includes(oldString)) return null;
  if (ti.replace_all === true) return existing.split(oldString).join(newString);
  return existing.replace(oldString, newString);
}

/*
 * Text INTRODUCED by this tool call only — the source-read guard must judge
 * the delta, not re-litigate every path a long historical plan doc already
 * names (whole-doc scanning there blocks unrelated paragraph edits).
 * Edit → new_string; Write over an existing file → lines not already present;
 * Write of a new file → full content.
 */
function newlyIntroducedText(data, root) {
  const tool = data && data.tool_name;
  const ti = (data && data.tool_input) || {};
  if (tool === 'Edit') {
    return typeof ti.new_string === 'string' ? ti.new_string : null;
  }
  if (tool !== 'Write') return null;
  const content = typeof ti.content === 'string' ? ti.content : null;
  if (content == null) return null;

  const filePath = typeof ti.file_path === 'string' ? ti.file_path : '';
  const full = filePath ? resolveInside(root, repoRelative(root, filePath)) : null;
  if (!full || !fs.existsSync(full)) return content;

  const existingLines = new Set(fs.readFileSync(full, 'utf8').split(/\r?\n/));
  return content.split(/\r?\n/).filter((line) => !existingLines.has(line)).join('\n');
}

function frontmatterValue(text, key) {
  const match = String(text || '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return '';
  const line = match[1].split(/\r?\n/).find((candidate) =>
    new RegExp(`^${key}\\s*:`, 'i').test(candidate)
  );
  return line ? line.replace(/^[^:]+:\s*/, '').trim().replace(/^['"]|['"]$/g, '') : '';
}

function isPlanDoc(rel, text) {
  const normalized = normalizeSlashes(rel);
  if (!/^docs\/.*\.md$/i.test(normalized)) return false;
  if (/PLAN[^/]*\.md$/i.test(normalized)) return true;
  return /\bplan\b/i.test(frontmatterValue(text, 'kind'));
}

function isPlanOrDesignDoc(rel, text) {
  const normalized = normalizeSlashes(rel);
  if (isPlanDoc(normalized, text)) return true;
  if (/(?:PLAN|DESIGN|ARCHITECTURE)[^/]*\.md$/i.test(normalized)) return true;
  return /\b(?:plan|design|architecture)\b/i.test(frontmatterValue(text, 'kind'));
}

function extractNamedSourcePaths(text) {
  const out = new Set();
  const body = String(text || '');
  let match;
  while ((match = SOURCE_PATH_RE.exec(body)) !== null) {
    out.add(normalizeSlashes(match[1]));
  }
  return [...out].sort();
}

function hasNotReadEscape(text, relPath) {
  const lines = String(text || '').split(/\r?\n/);
  return lines.some((line) =>
    /\[NOT-READ:[^\]]+\]/i.test(line) && normalizeSlashes(line).includes(relPath)
  );
}

function transcriptHasReadEvidence(transcriptText, root, relPath) {
  const rel = normalizeSlashes(relPath);
  const abs = normalizeSlashes(path.join(root, rel));
  const variants = [rel, `./${rel}`, abs];
  const lines = String(transcriptText || '').split(/\r?\n/);

  for (const rawLine of lines) {
    const line = normalizeSlashes(rawLine);
    if (!variants.some((variant) => line.includes(variant))) continue;
    if (/"(?:name|tool_name|toolName)"\s*:\s*"(?:Read|Open|NotebookRead)"/i.test(line)) return true;
    // codegraph_explore returns verbatim line-numbered source and is contractually
    // Read-equivalent (and this repo's preferred read path) — a transcript line
    // pairing the file path with codegraph output counts as read evidence.
    if (/codegraph/i.test(line)) return true;
    if (/\b(?:rtk\s+)?(?:cat|sed|nl|awk|head|tail|less|more)\b/.test(line)) return true;
  }
  return false;
}

const UNCERTAINTY_RE = /\bTBD\b|\[ASSUMED\b|unknown|not yet (?:counted|derived|verified)|to be (?:confirmed|counted|verified)/i;
const COUNT_CONTEXT_RE = /\b(?:count|total|union|baseline|routes?|files?|coverage|wave|delta|in-scope|scope|census|inventory|arithmetic)\b/i;
const CLOSED_COUNT_RE = /\b\d+\b|\b\d+\s*(?:\+|x|\*)\s*\d+|\b\d+\s+of\s+\d+\b/i;
const QUALIFIED_COUNT_RE = /\[(?:ASSUMED|TBD|DERIVED-FROM|ASSUMED-DERIVED)[:\]]/i;
const SUBJECTS = [
  ['route', /\broutes?\b|pages\/api\//i],
  ['file', /\bfiles?\b/i],
  ['adapter', /\badapters?\b|dataverse\/adapters/i],
  ['dynamics', /\bDynamicsService\b|dynamics-service|dynamics/i],
  ['service', /\bservices?\b|lib\/services/i],
  ['union', /\bunion\b/i],
  ['baseline', /\bbaseline\b/i],
  ['wave', /\bwave\b/i],
  ['coverage', /\bcoverage\b/i],
  ['census', /\bcensus\b|\binventory\b/i],
  ['scope', /\bscope\b|\bin-scope\b/i],
  ['dal', /\bDAL\b|withDalContext|Dataverse/i],
];

function subjectSet(line) {
  const subjects = new Set();
  for (const [name, re] of SUBJECTS) {
    if (re.test(line)) subjects.add(name);
  }
  return subjects;
}

function intersects(a, b) {
  for (const value of a) {
    if (b.has(value)) return true;
  }
  return false;
}

function findAssumptionQuantityLeaks(text) {
  const lines = String(text || '').split(/\r?\n/);
  const uncertainties = [];
  const closedClaims = [];

  lines.forEach((line, index) => {
    if (UNCERTAINTY_RE.test(line) && COUNT_CONTEXT_RE.test(line)) {
      uncertainties.push({ line, lineNumber: index + 1, subjects: subjectSet(line) });
      return;
    }
    // Markdown ordered-list ordinals describe sequence, not quantity. Judge
    // the remaining text so `1. Verify every route` does not become a bogus
    // numeric coverage claim merely because the line also contains "route".
    const claimText = line.replace(/^\s*\d+[.)]\s+/, '');
    if (
      CLOSED_COUNT_RE.test(claimText) &&
      COUNT_CONTEXT_RE.test(line) &&
      !UNCERTAINTY_RE.test(line) &&
      !QUALIFIED_COUNT_RE.test(line)
    ) {
      closedClaims.push({ line, lineNumber: index + 1, subjects: subjectSet(line) });
    }
  });

  const leaks = [];
  for (const uncertainty of uncertainties) {
    for (const claim of closedClaims) {
      const shared = intersects(uncertainty.subjects, claim.subjects);
      const broadPlanCount =
        uncertainty.subjects.size === 0 ||
        claim.subjects.size === 0 ||
        uncertainty.subjects.has('route') ||
        claim.subjects.has('route') ||
        uncertainty.subjects.has('union') ||
        claim.subjects.has('union');
      if (shared || broadPlanCount) {
        leaks.push({ uncertainty, claim });
      }
      if (leaks.length >= 5) return leaks;
    }
  }
  return leaks;
}

function sourceMentionTerms(changedRel) {
  const rel = normalizeSlashes(changedRel);
  const base = path.basename(rel);
  const ext = path.extname(base);
  const stem = ext ? base.slice(0, -ext.length) : base;
  const terms = [rel, base];
  if (stem.length >= 8 && !['index', 'route', 'helper', 'service'].includes(stem)) terms.push(stem);
  return [...new Set(terms)];
}

function docMentionsChangedSource(text, changedRel) {
  const normalized = normalizeSlashes(text);
  for (const term of sourceMentionTerms(changedRel)) {
    if (normalized.includes(term)) return { term };
  }
  return null;
}

function hasStalenessAck(text, changedRel) {
  const rel = normalizeSlashes(changedRel);
  return String(text || '').split(/\r?\n/).some((line) => {
    const normalized = normalizeSlashes(line);
    return normalized.includes(rel) &&
      (/\[RECHECKED after [^\]]+ change:/i.test(normalized) || /\[STALE-ACCEPTED:/i.test(normalized));
  });
}

const DISCOVERY_ASK_RE = /\b(?:check|verify|determine|find out|see|confirm|look for)\s+(?:whether|if|which|where|how many|any)\b/i;
const LOCAL_DISCOVERY_RE = /\b(?:routes?|files?|imports?|callers?|source|pages\/|lib\/|scripts\/|stream|SSE|long[- ]?poll|exists?|present)\b/i;
const TRACE_MARKER_RE = /\b(?:TRACED|SELF-TRACE COMPLETE|Evidence|Read):/i;

function windowAround(lines, index, radius) {
  return lines.slice(Math.max(0, index - radius), Math.min(lines.length, index + radius + 1)).join('\n');
}

function hasAdjacentTrace(lines, index) {
  const window = windowAround(lines, index, 8);
  if (/\[DELEGATED-DISCOVERY:[^\]]+\]/i.test(window)) return true;
  if (TRACE_MARKER_RE.test(window) && PATH_LINE_RE.test(window)) return true;
  return /\b(?:checked|read|found|none found|confirmed|verified)\b[\s\S]{0,240}/i.test(window) && PATH_LINE_RE.test(window);
}

function findUntracedDiscoveryAsks(prompt) {
  const lines = String(prompt || '').split(/\r?\n/);
  const misses = [];
  lines.forEach((line, index) => {
    if (!DISCOVERY_ASK_RE.test(line) || !LOCAL_DISCOVERY_RE.test(line)) return;
    if (!hasAdjacentTrace(lines, index)) {
      misses.push({ line: line.trim(), lineNumber: index + 1 });
    }
  });
  return misses;
}

module.exports = {
  docMentionsChangedSource,
  extractAdversarialReviewReceiptPaths,
  newlyIntroducedText,
  extractNamedSourcePaths,
  findAssumptionQuantityLeaks,
  findUnverifiedReviewerEmailOwnershipClaims,
  findUntracedDiscoveryAsks,
  hasAdversarialReviewWaiver,
  hasNotReadEscape,
  hasStalenessAck,
  isHighRiskReviewArtifact,
  isQualifiedAdversarialReviewPrompt,
  isPlanDoc,
  isPlanOrDesignDoc,
  proposedTextForTool,
  repoRelative,
  resolveInside,
  transcriptHasReadEvidence,
};
