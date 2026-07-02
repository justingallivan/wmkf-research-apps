#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { loadDocs, parseFrontmatter, renderFrontmatter } = require('./lib/docs-catalog');

const repoRoot = path.resolve(__dirname, '..');
const TODAY = new Date().toISOString().slice(0, 10);
const FORCE = process.argv.includes('--force');

const OVERRIDES = {
  'AI_DATA_FLOW_MATRIX': { domain: 'prompt-executor', kind: 'audit', status: 'active', canonical: false },
  'AI_PROMPTS_DETAILED': { domain: 'prompt-executor', kind: 'source-of-truth', status: 'canonical', canonical: true },
  'AI_PROMPTS_OVERVIEW': { domain: 'prompt-executor', kind: 'spec', status: 'active', canonical: false },
  'AGENT_HARNESS_STYLE_GUIDE': { domain: 'agent-harness', kind: 'spec', status: 'active', canonical: false },
  'API_ROUTE_SECURITY_MATRIX': { domain: 'security-auth', kind: 'source-of-truth', status: 'canonical', canonical: true },
  'APPLICATION_STATE_ATLAS': { domain: 'dataverse', kind: 'source-of-truth', status: 'canonical', canonical: true },
  'AUTHENTICATION_SETUP': { domain: 'security-auth', kind: 'runbook', status: 'active', canonical: false },
  'CI_GATES_REFERENCE': { domain: 'docs-governance', kind: 'runbook', status: 'canonical', canonical: true },
  'CLAUDE_INSTRUCTION_AUTHORITY': { domain: 'agent-harness', kind: 'source-of-truth', status: 'canonical', canonical: true },
  'CLAUDE_REMEDIATION_PLAN': { domain: 'agent-harness', kind: 'source-of-truth', status: 'canonical', canonical: true },
  'CREDENTIALS_RUNBOOK': { domain: 'security-auth', kind: 'runbook', status: 'canonical', canonical: true },
  'DATAVERSE_CUSTOM_SCHEMA_INVENTORY': { domain: 'dataverse', kind: 'source-of-truth', status: 'active', canonical: true },
  'DATAVERSE_SHAREPOINT_FILE_MODEL': { domain: 'dataverse', kind: 'source-of-truth', status: 'active', canonical: true },
  'DYNAMICS_SCHEMA_ANNOTATION': { domain: 'dataverse', kind: 'source-of-truth', status: 'active', canonical: false },
  'EXECUTOR_CONTRACT': { domain: 'prompt-executor', kind: 'source-of-truth', status: 'canonical', canonical: true },
  'GRANTEE_PORTAL_SPEC': { domain: 'grantee-portal', kind: 'spec', status: 'active', canonical: true },
  'GRANT_CYCLE_LIFECYCLE': { domain: 'architecture', kind: 'source-of-truth', status: 'canonical', canonical: true },
  'REVIEWER_DATA_MODEL': { domain: 'reviewer-workbench', kind: 'source-of-truth', status: 'canonical', canonical: true },
  'REVIEWER_ENGAGEMENT_SPEC': { domain: 'reviewer-workbench', kind: 'source-of-truth', status: 'canonical', canonical: true },
  'REVIEWER_FINDER': { domain: 'reviewer-identity', kind: 'source-of-truth', status: 'canonical', canonical: true },
  'REVIEWER_FINDER_ENFORCEMENT_CONTRACTS': { domain: 'reviewer-identity', kind: 'source-of-truth', status: 'canonical', canonical: true },
  'REVIEWER_FINDER_RETRIEVAL_REDESIGN_PLAN': { domain: 'reviewer-identity', kind: 'source-of-truth', status: 'canonical', canonical: true },
  'REVIEWER_MATERIALS_FOLDER_SPEC': { domain: 'reviewer-workbench', kind: 'source-of-truth', status: 'canonical', canonical: true },
  'REVIEWER_PROVENANCE_MODEL': { domain: 'reviewer-identity', kind: 'source-of-truth', status: 'canonical', canonical: true },
  'SECURITY_OPERATING_PLAN': { domain: 'security-auth', kind: 'runbook', status: 'canonical', canonical: true },
  'SERVICE_AND_UTILITY_CATALOG': { domain: 'docs-governance', kind: 'source-of-truth', status: 'canonical', canonical: true },
  'SYSTEM_MODEL': { domain: 'architecture', kind: 'source-of-truth', status: 'canonical', canonical: true },
  'SYSTEM_OVERVIEW': { domain: 'architecture', kind: 'spec', status: 'historical', canonical: false },
  'VIRTUAL_REVIEW_PANEL': { domain: 'prompt-executor', kind: 'spec', status: 'active', canonical: true },
  'W4_RECONCILE_CONTRACT': { domain: 'dataverse', kind: 'source-of-truth', status: 'canonical', canonical: true },
  'WORKFLOW_CHAINING_DESIGN': { domain: 'prompt-executor', kind: 'spec', status: 'active', canonical: true },
};

function titleFromFilename(rel) {
  return path.basename(rel, '.md')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase())
    .replace(/\bAi\b/g, 'AI')
    .replace(/\bApi\b/g, 'API')
    .replace(/\bPdf\b/g, 'PDF')
    .replace(/\bLl m\b/g, 'LLM');
}

function titleFromBody(body, rel) {
  const h1 = body.match(/^#\s+(.+?)\s*$/m);
  return h1 ? h1[1].replace(/\s+/g, ' ').trim() : titleFromFilename(rel);
}

function domainFor(name) {
  if (/^(AGENT_|CLAUDE_|CODEX_)/.test(name)) return 'agent-harness';
  if (/^(AI_|PROMPT_|EXECUTOR|MODEL_|WORKFLOW|STAGED_)/.test(name)) return 'prompt-executor';
  if (/^(API_|AUTHENTICATION|CREDENTIALS|SECURITY|THIRD_PARTY|WAVE1|DFT_VIRUS)/.test(name)) return 'security-auth';
  if (/^(BILL|HONORARIUM)/.test(name)) return 'finance-honoraria';
  if (/^(BUDGET|INTAKE)/.test(name)) return 'intake-portal';
  if (/^(DATAVERSE|DYNAMICS|POSTGRES|W4_)/.test(name)) return 'dataverse';
  if (/^GRANTEE/.test(name)) return 'grantee-portal';
  if (/^REVIEWER_FINDER|^REVIEWER_IDENTITY|^REVIEWER_ORCID|^REVIEWER_TRACK_B|^REVIEWER_PROVENANCE|^REVIEWER_RECENCY|^REVIEWER_WEB/.test(name)) return 'reviewer-identity';
  if (/^REVIEWER/.test(name)) return 'reviewer-workbench';
  if (/^(EMAIL|UNIFIED_EMAIL|TODO_EMAIL|RESOLVED_PAGE_EMAIL)/.test(name)) return 'email';
  if (/^(PDF|DIAGRAM|SYSTEM_|STRATEGY|NOMENCLATURE|VIRTUAL_REVIEW_PANEL|REQUEST_WORKBENCH|WORKBENCH|STAFF_EDITABLE|EXTERNAL_REVIEWER|GROUP_B|GRANT_CYCLE)/.test(name)) return 'architecture';
  if (/^(DOCS_|CANONICAL_COUNTS|CI_GATES|SERVICE_AND_UTILITY|HOME_MAC|PARALLEL_AGENT|RETROSPECTIVE|PROFILE_CONTEXT|WISHLIST|perf-log)/.test(name)) return 'docs-governance';
  return 'general';
}

function kindFor(name) {
  if (OVERRIDES[name]?.kind) return OVERRIDES[name].kind;
  if (/CATALOG|ATLAS|MATRIX|CATALOG|CONTRACT|CANONICAL_COUNTS|GLOSSARY|LIFECYCLE|SERVICE_AND_UTILITY|SYSTEM_MODEL|SYSTEM_OVERVIEW/.test(name)) return 'source-of-truth';
  if (/RUNBOOK/.test(name)) return 'runbook';
  if (/AUDIT|FINDINGS|REVIEW$|RETROSPECTIVE|ANALYSIS/.test(name)) return 'audit';
  if (/DECISION|INTERPRETATION|STRATEGY_EVALUATION/.test(name)) return 'decision';
  if (/STATUS/.test(name)) return 'status';
  if (/DRAFT|PROMPT|EMAIL$/.test(name)) return 'draft';
  if (/PLAN|STRATEGY|SCOPING|TODO|WISHLIST|HANDOFF|SUMMARY|LESSONS|REMEDIATION|MIGRATION|ROLLOUT/.test(name)) return 'plan';
  if (/SPEC|DESIGN|MODEL|ARCHITECTURE|FLOWCHART|DIAGRAM|MOCKUP/.test(name)) return 'spec';
  return 'history';
}

function statusFor(name, kind) {
  if (OVERRIDES[name]?.status) return OVERRIDES[name].status;
  if (/DRAFT|PROMPT|TODO|WISHLIST|EMAIL$/.test(name)) return 'draft';
  if (/P1UPDATE_TEST_DRAFT_v[234]|P1UPDATE_TEST_DRAFT$|QUICK_PROBE|MAKER_PORTAL_TESTS|CONNOR_CORE_GATE|CONNOR_FLOW_BODY_RERUN/.test(name)) return 'historical';
  if (/AUDIT|FINDINGS|HANDOFF|SUMMARY|LESSONS|HOME_MAC|perf-log|DOCS_STALENESS|RETROSPECTIVE/.test(name)) return 'historical';
  if (kind === 'source-of-truth' || kind === 'status') return 'canonical';
  return 'active';
}

function summaryFor(title, kind) {
  const clean = title.replace(/\s+/g, ' ').replace(/[.。]+$/, '').trim();
  const prefix = {
    'source-of-truth': 'Canonical reference for',
    spec: 'Specification for',
    plan: 'Implementation or migration plan for',
    status: 'Current status dashboard for',
    runbook: 'Operational runbook for',
    audit: 'Point-in-time audit or findings for',
    decision: 'Decision record for',
    draft: 'Draft working document for',
    history: 'Historical context for',
  }[kind] || 'Documentation for';
  const value = `${prefix} ${clean}.`;
  return clipSummary(value);
}

function clipSummary(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim().replace(/[.。]*$/, '.');
  if (text.length <= 150) return text;
  const prefix = text.slice(0, 147).replace(/\s+\S*$/, '').trim();
  return `${prefix || text.slice(0, 147).trim()}...`;
}

function summaryFromBody(body, title, kind) {
  const lines = body.split(/\r?\n/);
  const paragraphs = [];
  let current = [];
  let inCode = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith('```') || line.startsWith('````')) {
      inCode = !inCode;
      continue;
    }
    if (inCode) continue;
    if (!line || line.startsWith('#') || line === '---' || line.startsWith('|') || /^[-*]\s+\[[ x]\]/i.test(line)) {
      if (current.length) {
        paragraphs.push(current.join(' '));
        current = [];
      }
      continue;
    }
    if (/^(status|last updated|maintenance rule):/i.test(line)) continue;
    const cleaned = line.replace(/^>\s*/, '').replace(/\*\*/g, '').replace(/`/g, '').trim();
    if (!cleaned || /^generated by /i.test(cleaned)) continue;
    current.push(cleaned);
    if (cleaned.endsWith('.')) {
      paragraphs.push(current.join(' '));
      current = [];
    }
  }
  if (current.length) paragraphs.push(current.join(' '));

  const candidate = paragraphs
    .map((p) => p.replace(/\[[^\]]+\]\(([^)]+)\)/g, '$1').replace(/\s+/g, ' ').trim())
    .find((p) => p.length >= 45 && p.length <= 220 && !p.includes('<!--'));
  if (!candidate) return summaryFor(title, kind);
  return clipSummary(candidate);
}

function existingRelated(body) {
  const refs = [];
  const re = /(?<![\w./-])((?:docs|lib|pages|shared|scripts|tests)\/[A-Za-z0-9_.\/\[\]-]+(?:\.[A-Za-z0-9]+)?)/g;
  let match;
  while ((match = re.exec(body)) !== null && refs.length < 8) {
    const ref = match[1].replace(/[:.,;)]+$/, '');
    if (ref.includes('*')) continue;
    if (fs.existsSync(path.join(repoRoot, ref)) && !refs.includes(ref)) refs.push(ref);
  }
  return refs.slice(0, 4);
}

function seed() {
  const docs = loadDocs(repoRoot);
  for (const doc of docs) {
    const parsed = parseFrontmatter(doc.text);
    const name = path.basename(doc.rel, '.md');
    const override = OVERRIDES[name] || {};
    const body = parsed.body;
    const title = !FORCE && parsed.data && parsed.data.title ? parsed.data.title : titleFromBody(body, doc.rel);
    const kind = !FORCE && parsed.data && parsed.data.kind ? parsed.data.kind : kindFor(name);
    const data = {
      ...(parsed.data || {}),
      title,
      domain: !FORCE && parsed.data && parsed.data.domain ? parsed.data.domain : (override.domain || domainFor(name)),
      kind,
      status: !FORCE && parsed.data && parsed.data.status ? parsed.data.status : statusFor(name, kind),
      summary: !FORCE && parsed.data && parsed.data.summary ? parsed.data.summary : summaryFromBody(body, title, kind),
      canonical: !FORCE && parsed.data && 'canonical' in parsed.data ? parsed.data.canonical : ('canonical' in override ? override.canonical : (kind === 'source-of-truth' || kind === 'status')),
      cataloged: !FORCE && parsed.data && parsed.data.cataloged ? parsed.data.cataloged : TODAY,
      owner: !FORCE && parsed.data && parsed.data.owner ? parsed.data.owner : 'product-engineering',
    };
    if (FORCE && parsed.data && parsed.data.last_verified === TODAY) {
      delete data.last_verified;
    }
    const related = parsed.data && Array.isArray(parsed.data.related) ? parsed.data.related : existingRelated(body);
    if (related.length) data.related = related;
    const output = `${renderFrontmatter(data)}${body.replace(/^\s+/, '')}`;
    fs.writeFileSync(doc.file, output);
  }
  console.log(`Seeded catalog frontmatter for ${docs.length} top-level markdown doc(s).`);
}

seed();
