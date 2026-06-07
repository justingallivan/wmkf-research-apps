/**
 * EXPERIMENT (S230): evaluate the "Perplexity-as-reviewer-AGENT" approach vs the
 * shipped Track C path. The shipped web-discovery uses the Perplexity /search API
 * (retrieval) + a separate Claude extraction. This probe instead asks a single
 * Perplexity `sonar` chat call to BOTH search and reason — returning finished
 * reviewer candidates as JSON (the prompt Perplexity itself proposed, S230).
 *
 * Purpose: eyeball raw output QUALITY on a real proposal before deciding whether
 * to integrate (e.g. as a discovery source feeding the verify→enrich→COI
 * pipeline). NOT production: no DB, no writes, no A7 wrapping, fail-loud. The
 * model-authored affiliation / email / conflict_flag are UNVERIFIED — treat them
 * as hints only; the whole point of the eval is to see how trustworthy they are.
 *
 * Usage:
 *   node scripts/probe-perplexity-reviewer-agent.mjs --request <akoya_requestnum|GUID> [--copi "Anthony Leung, …"]
 *   node scripts/probe-perplexity-reviewer-agent.mjs --input proposal.json
 *   node scripts/probe-perplexity-reviewer-agent.mjs --title "…" --abstract "…" \
 *        --pi "Jane Smith" --copi "Anthony Leung, John Doe" --team "…"
 *   (--model sonar-pro|sonar  default sonar-pro; --abstract-field <name>  default wmkf_abstract)
 *
 * --request pulls akoya_title + wmkf_abstract + project leader (PI) from Dynamics.
 * Co-PIs / other personnel aren't a single clean Dynamics field, so pass them with
 * --copi / --team (any flag overrides/supplements the fetched values). Hitting
 * Dynamics needs .env.local creds + the script bypass (enterDynamicsBypassForScript);
 * .env.local points at PROD Dataverse — this is READ-ONLY (a single getRecord).
 *
 * proposal.json shape:
 *   { "title": "", "principalInvestigators": "", "coPrincipalInvestigators": "",
 *     "otherTeam": "", "abstract": "" }
 *
 * Reads PERPLEXITY_API_KEY (+ Dynamics creds) from env or .env.local (never printed).
 */
import { readFileSync } from 'node:fs';

// Load all of .env.local into process.env (quote-stripped, no override) so both
// the Perplexity key AND the Dynamics creds (for --request) are available —
// same pattern as scripts/reset-request-reviewers.mjs.
function loadEnvLocal() {
  try {
    const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
    for (const line of env.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !(m[1] in process.env)) {
        process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
      }
    }
  } catch { /* env may already be exported in the shell */ }
}
loadEnvLocal();

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Fetch title + abstract + project-leader (PI) for a request from Dynamics.
// READ-ONLY. Uses the script-only restriction bypass, like the other Dynamics
// scripts. Co-PIs are NOT pulled (no clean field) — supply via --copi.
async function fetchProposalFromDynamics(requestArg, abstractField) {
  const { DynamicsService } = await import('../lib/services/dynamics-service.js');
  const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
  enterDynamicsBypassForScript('probe-perplexity-reviewer-agent');
  const select = ['akoya_requestid', 'akoya_requestnum', 'akoya_title', abstractField, '_wmkf_projectleader_value'].join(',');
  let rec;
  if (GUID_RE.test(requestArg)) {
    rec = await DynamicsService.getRecord('akoya_requests', requestArg, { select });
  } else {
    const { records } = await DynamicsService.queryRecords('akoya_requests', {
      select,
      filter: `akoya_requestnum eq '${String(requestArg).replace(/'/g, "''")}'`,
      top: 1,
    });
    if (!records || records.length === 0) {
      console.error(`No akoya_request found with akoya_requestnum '${requestArg}'.`);
      process.exit(2);
    }
    rec = records[0];
  }
  return {
    title: rec.akoya_title || '',
    principalInvestigators: rec['_wmkf_projectleader_value_formatted'] || '',
    coPrincipalInvestigators: '',
    otherTeam: '',
    abstract: rec[abstractField] || '',
  };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    const next = argv[i + 1];
    // A flag with no following value (or followed by another flag) is boolean.
    if (next === undefined || next.startsWith('--')) { out[k] = true; }
    else { out[k] = next; i++; }
  }
  return out;
}

const TEMPLATE = {
  title: '',
  principalInvestigators: '',
  coPrincipalInvestigators: '',
  otherTeam: '',
  abstract: '',
};

const args = parseArgs(process.argv.slice(2));
const model = args.model || 'sonar-pro';

let base = null;
if (args.request) {
  base = await fetchProposalFromDynamics(args.request, args['abstract-field'] || 'wmkf_abstract');
} else if (args.input) {
  base = JSON.parse(readFileSync(args.input, 'utf8'));
} else if (!(args.title || args.abstract)) {
  console.error('No proposal supplied. Pass --request <num|GUID>, --input <file.json>, or --title/--abstract/--pi/--copi/--team.');
  console.error('JSON template:\n' + JSON.stringify(TEMPLATE, null, 2));
  process.exit(2);
}

// Flags override/supplement the base (Dynamics or file) — e.g. --copi for the
// Co-PIs that --request can't pull cleanly.
base = base || {};
const proposal = {
  title: args.title || base.title || '',
  principalInvestigators: args.pi || base.principalInvestigators || '',
  coPrincipalInvestigators: args.copi || base.coPrincipalInvestigators || '',
  otherTeam: args.team || base.otherTeam || '',
  abstract: args.abstract || base.abstract || '',
};

if (!proposal.title && !proposal.abstract) {
  console.error('Resolved proposal has no title or abstract — nothing to search on. Check the request id / abstract field.');
  process.exit(2);
}

// --dry-run: print what we resolved (verify the right fields) and STOP — no
// Perplexity call, no key needed.
if (args['dry-run'] || args.show) {
  console.log('Resolved proposal (DRY RUN — no Perplexity call made):');
  console.log('  title      :', JSON.stringify(proposal.title));
  console.log('  PI         :', JSON.stringify(proposal.principalInvestigators));
  console.log('  co-PIs     :', JSON.stringify(proposal.coPrincipalInvestigators));
  console.log('  other team :', JSON.stringify(proposal.otherTeam));
  console.log('  abstract   :', proposal.abstract ? `${proposal.abstract.length} chars` : '(EMPTY — check --abstract-field)');
  if (proposal.abstract) {
    console.log('  abstract preview:\n' + proposal.abstract.slice(0, 700) + (proposal.abstract.length > 700 ? '\n…[truncated]' : ''));
  }
  process.exit(0);
}

const key = process.env.PERPLEXITY_API_KEY;
if (!key) { console.error('No PERPLEXITY_API_KEY found (env or .env.local).'); process.exit(2); }

// The prompt Perplexity proposed (S230), placeholders filled. Kept close to
// as-authored so the eval reflects THAT prompt's behavior. (A7 wrapping would be
// added before any productionization — this is a quality probe only.)
const prompt = `You are assisting with reviewer selection for a research proposal.

Task:
Given the proposal metadata and abstract below, identify a short list of potential external reviewers who are well matched to evaluate the proposal.

Hard constraints:
1. Exclude any person who is listed as a PI, co-PI, senior personnel, collaborator, or otherwise part of the proposal team.
2. Exclude anyone with an obvious conflict of interest, including recent coauthors, current or former advisors/students where relevant, same institution, or other clearly linked relationships if detectable from publicly available information.
3. Return only people who appear to be independent and appropriate reviewers.
4. Prefer reviewers with direct expertise in the proposal's topic and methods.
5. Return a short list only, ideally 5 to 8 candidates.

For each candidate, provide:
- Full name.
- Current affiliation.
- Short rationale for why this person is a strong reviewer match.
- Confidence level in the match.
- Contact information if publicly available and reasonably reliable, such as institutional email or public professional contact page.
- Any potential conflict flag, if applicable.

If contact information is not publicly available, say "not found publicly" rather than guessing.

Output requirements:
- Return valid JSON only.
- Do not include any commentary outside the JSON.
- Use this schema exactly:

{
  "proposal_title": "",
  "excluded_names": [],
  "reviewers": [
    {
      "name": "",
      "affiliation": "",
      "rationale": "",
      "confidence": "high|medium|low",
      "contact_information": { "email": "", "website": "", "source_note": "" },
      "conflict_flag": ""
    }
  ]
}

Proposal metadata:
- Title: ${proposal.title || ''}
- Principal Investigators: ${proposal.principalInvestigators || ''}
- Co-Principal Investigators: ${proposal.coPrincipalInvestigators || ''}
- Other proposal personnel: ${proposal.otherTeam || ''}

Abstract:
${proposal.abstract || ''}`;

console.log('→ POST https://api.perplexity.ai/chat/completions');
console.log('  model =', model);
console.log('  title =', JSON.stringify(proposal.title || '(none)'));
console.log('  PI/Co-PI =', JSON.stringify([proposal.principalInvestigators, proposal.coPrincipalInvestigators].filter(Boolean).join(' | ') || '(none)'));

const resp = await fetch('https://api.perplexity.ai/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
  body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: 0, max_tokens: 2000 }),
});

console.log('\n← HTTP', resp.status, resp.statusText);
const data = await resp.json().catch(() => ({}));
if (!resp.ok) {
  console.error('Error:', JSON.stringify(data?.error || data, null, 2));
  process.exit(1);
}

const content = data.choices?.[0]?.message?.content || '';
const citations = data.citations || data.choices?.[0]?.message?.citations || [];
console.log('  usage:', JSON.stringify(data.usage || {}));
console.log('  citations:', Array.isArray(citations) ? citations.length : 0);

console.log('\n──── RAW CONTENT ────\n' + content);

// Lenient JSON extraction (sonar sometimes wraps JSON in prose/fences).
function extractJson(s) {
  let t = String(s || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const a = t.indexOf('{'); const b = t.lastIndexOf('}');
  if (a === -1 || b === -1 || b < a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; }
}

const parsed = extractJson(content);
console.log('\n──── PARSED ────');
if (!parsed) {
  console.log('Could not parse JSON from the response (see RAW above).');
} else {
  console.log(JSON.stringify(parsed, null, 2));
  // Quick eval signals — the things that matter for the integrate/skip decision.
  const reviewers = Array.isArray(parsed.reviewers) ? parsed.reviewers : [];
  const withEmail = reviewers.filter((r) => r?.contact_information?.email && !/not found/i.test(r.contact_information.email));
  const team = [proposal.principalInvestigators, proposal.coPrincipalInvestigators, proposal.otherTeam]
    .filter(Boolean).join(', ').toLowerCase();
  const leaked = reviewers.filter((r) => r?.name && team.includes(String(r.name).toLowerCase()));
  console.log('\n──── EVAL SIGNALS ────');
  console.log('  reviewers returned:', reviewers.length);
  console.log('  reviewers with a (model-authored, UNVERIFIED) email:', withEmail.length,
    withEmail.length ? '— verify each before trusting' : '');
  console.log('  proposal-team names leaked into reviewers (exact match):', leaked.length,
    leaked.length ? `→ ${leaked.map((r) => r.name).join(', ')}` : '');
  console.log('  citations attached to the answer:', Array.isArray(citations) ? citations.length : 0);
}
