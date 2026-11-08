/** @jest-environment node */
jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));
jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));
jest.mock('../../pages/api/auth/[...nextauth]', () => ({ authOptions: {} }));
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: {
    checkRestriction: jest.fn(), getRecord: jest.fn(), queryRecords: jest.fn(),
    createRecord: jest.fn(), updateRecord: jest.fn(),
  },
}));

import { randomUUID } from 'node:crypto';
import { DynamicsService } from '../../lib/services/dynamics-service';
import { withDalContext } from '../../lib/dataverse/core/context';
import { J27_FIT_CONCERNS, J27_INTAKE_FIT_COMPARISON_FIELD } from '../../shared/config/j27FitComparison';
import { INTAKE_PROMPTS, runJ27Intake } from '../../scripts/lib/j27-intake-runner';
import complete from '../../scripts/fixtures/j27-intake/complete.json';
import missing from '../../scripts/fixtures/j27-intake/missing-other-support.json';
import overlap from '../../scripts/fixtures/j27-intake/known-keck-overlap.json';

const cases = [
  {
    packet: complete, assessment: 682090000, title: 'Electrical signals across fungal networks',
    method: 'Fluorescent voltage sensor', expertise: 'fungal microscopy', risk: 'Signals may decay across branch junctions.',
    summary: 'The team will test whether electrical signals coordinate distant fungal branches.',
    methodology: 'The team has demonstrated a fluorescent voltage sensor in fungal cells. Live microscopy will follow signals across junctions.',
    rationale: 'The work could explain coordination without a nervous system. It connects electrical activity to events at different branches. Signals may decay across branch junctions.',
  },
  {
    packet: missing, assessment: 682090001, title: 'To test a portable copper sensor',
    method: 'Benchtop copper probe', expertise: 'electrochemical assays', risk: 'Other dissolved metals may interfere with the reading.',
    summary: 'The team aims to build a portable device that measures copper in drinking water.',
    methodology: 'The team has demonstrated a benchtop copper probe. It will integrate the probe with a handheld reader.',
    rationale: 'A working reader could support drinking water screening. The project would adapt a benchtop probe for portable use. Other dissolved metals may interfere with the reading.',
  },
  {
    packet: overlap, assessment: 682090000, title: 'How salt changes freezing on mineral surfaces',
    method: 'Optical freezing chamber', expertise: 'optical imaging', risk: 'Salt may accumulate unevenly.',
    summary: 'The team will test how salt affects where ice first forms on a mineral surface.',
    methodology: 'The team has demonstrated a chamber that images freezing as it happens. It will add a controlled salt gradient.',
    rationale: 'Success could explain which mineral sites start freezing in salty water. The work links individual freezing sites to salt concentration. Uneven salt accumulation could obscure the effect.',
  },
];

function responsesFor(fixture) {
  const { packet, title, summary, methodology, method, expertise, rationale, risk } = fixture;
  const hint = packet === missing
    ? { raised: true, evidence: 'The near-term goal is a portable device for screening drinking water.', page: 1, section: 'Project Narrative' }
    : { raised: false, evidence: '', page: null, section: '' };
  const flags = Object.keys(J27_FIT_CONCERNS).map((id) => ({ id, level: 'green', reason: '', evidence: [] }));
  if (packet === missing) {
    Object.assign(flags[0], {
      level: 'red', reason: 'The near-term deliverable is a screening device.',
      evidence: [{ source: 'proposal', quote: hint.evidence, page: hint.page, section: hint.section }],
    });
    Object.assign(flags[4], { level: 'gray', reason: 'Other Support was not supplied.' });
  }
  if (packet === overlap) {
    Object.assign(flags[5], {
      level: 'yellow', reason: 'A recent award measured the same freezing phenomenon.',
      evidence: [{
        source: 'keck_abstracts', quote: 'This award measured the formation of ice crystals on mineral surfaces.',
        page: null, section: 'Mock Award on Mineral Growth (2025)',
      }],
    });
  }
  return [
    title,
    { executive_summary: summary, open_questions: [], too_applied_hint: hint, terms_defined: [] },
    { methodology, enabling_methods: [{ method, status: 'in_hand', page: 2, section: 'Approach' }], numbers_kept: [], terms_defined: [], open_questions: [] },
    {
      personnel: packet.roster.map(({ name }) => `<u>${name}</u>`).join(' and ') + ' bring expertise relevant to the proposed measurements.',
      people: packet.roster.map((person) => ({
        ...person, expertise, pioneer: { method: '', proposal_statement: '', biosketch_citation: '' },
      })),
      word_budget: 65, titles_dropped: [], open_questions: [],
    },
    {
      rationale, opening_used: rationale.split(' ').slice(0, 4).join(' '), impact_basis: 'Uses the supported outcome from the proposal.',
      risks: [{ risk, source: 'proposal reading', page: 2, section: 'Approach' }], judgment_words: [],
    },
    { flags },
  ];
}

const originalFetch = global.fetch;
const originalApiKey = process.env.CLAUDE_API_KEY;
let request;
let binding;
let rows;
let responses;

function setUp(fixture) {
  jest.resetAllMocks();
  const { packet, assessment } = fixture;
  binding = {
    packetId: packet.id, requestId: randomUUID(),
    ternary: { materialsVersion: packet.materialsVersion, assessment, rationale: 'Independent fixture assessment.', runId: randomUUID() },
  };
  request = {
    akoya_requestid: binding.requestId, akoya_title: packet.applicantTitle,
    wmkf_istestrequest: true, wmkf_testcreationrunid: randomUUID(), _etag: 'W/"1"',
    wmkf_GrantCycle: { wmkf_cyclecode: 'J27' },
    wmkf_ai_fitassessment: assessment, wmkf_ai_fitrationale: binding.ternary.rationale,
    wmkf_ai_summary: null, wmkf_wmkfprojectdescription: null, [J27_INTAKE_FIT_COMPARISON_FIELD]: null,
  };
  rows = INTAKE_PROMPTS.map((prompt) => ({
    wmkf_ai_promptid: randomUUID(), wmkf_ai_promptname: prompt.PROMPT_NAME, wmkf_promptversion: 1,
    wmkf_ai_systemprompt: prompt.SYSTEM_PROMPT, wmkf_ai_promptbody: prompt.USER_PROMPT_TEMPLATE,
    wmkf_ai_promptvariables: JSON.stringify(prompt.PROMPT_VARIABLES),
    wmkf_ai_promptoutputschema: JSON.stringify(prompt.PROMPT_OUTPUT_SCHEMA),
    wmkf_ai_model: 'claude-sonnet-4-6', wmkf_ai_maxtokens: 4096,
  }));
  DynamicsService.queryRecords.mockImplementation(async (entity, { filter }) => {
    expect(entity).toBe('wmkf_ai_prompts');
    return { records: rows.filter((row) => filter.includes(`'${row.wmkf_ai_promptname}'`)) };
  });
  DynamicsService.getRecord.mockImplementation(async (entity, id) => {
    expect([entity, id]).toEqual(['akoya_requests', binding.requestId]);
    return { ...request };
  });
  DynamicsService.updateRecord.mockImplementation(async (entity, id, patch, options) => {
    expect([entity, id, options.ifMatch]).toEqual(['akoya_requests', binding.requestId, request._etag]);
    Object.assign(request, patch, { _etag: `W/"${Number(request._etag.slice(3, -1)) + 1}"` });
  });
  DynamicsService.createRecord.mockImplementation(async (entity) => {
    expect(entity).toBe('wmkf_ai_runs');
    return { wmkf_ai_runid: randomUUID() };
  });
  responses = responsesFor(fixture);
  process.env.CLAUDE_API_KEY = 'sk-ant-test';
  global.fetch = jest.fn(async (url) => {
    const target = new URL(url);
    expect(target.origin).toBe('https://api.anthropic.com');
    if (target.pathname === '/v1/models') {
      return { ok: true, status: 200, json: async () => ({ data: [{ id: 'claude-sonnet-4-6' }] }) };
    }
    expect(target.pathname).toBe('/v1/messages');
    expect(responses).not.toHaveLength(0);
    const output = responses.shift();
    return {
      ok: true, status: 200, json: async () => ({
        content: [{ type: 'text', text: typeof output === 'string' ? output : JSON.stringify(output) }],
        usage: { input_tokens: 10, output_tokens: 20 }, model: 'claude-sonnet-4-6', stop_reason: 'end_turn',
      }),
    };
  });
}

afterEach(() => {
  global.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.CLAUDE_API_KEY;
  else process.env.CLAUDE_API_KEY = originalApiKey;
});

test.each(cases)('runs P1–P6 with fixture responses for $packet.id', async (fixture) => {
  setUp(fixture);
  const { results } = await withDalContext('j27-fixtures', () => runJ27Intake(fixture.packet, binding));
  expect(Object.keys(results)).toEqual(['P1', 'P2', 'P3', 'P4', 'P5', 'P6']);
  expect(responses).toHaveLength(0);
  const messages = global.fetch.mock.calls.filter(([url]) => new URL(url).pathname === '/v1/messages');
  expect(messages).toHaveLength(6);
  expect(DynamicsService.createRecord).toHaveBeenCalledTimes(6);
  expect(request.wmkf_wmkfprojectdescription).toBe(fixture.title);
  expect(request.wmkf_ai_summary).toBe(fixture.summary);
  expect(DynamicsService.updateRecord.mock.calls.map((call) => Object.keys(call[2]))).toEqual([
    ['wmkf_wmkfprojectdescription'], ['wmkf_ai_summary'], [J27_INTAKE_FIT_COMPARISON_FIELD],
  ]);
  const sent = messages.map(([, init]) => JSON.parse(init.body).messages[0].content);
  expect(sent[2]).toContain(fixture.summary);
  expect(sent[3]).toContain(fixture.methodology);
  expect(sent[4]).toContain(fixture.methodology);
  expect(sent[4]).toContain(fixture.method);
  expect(sent[4]).toContain(fixture.summary);
  expect(results.P6.snapshot.p6.flags).toEqual(responsesFor(fixture)[5].flags);
  if (fixture.packet === missing) expect(sent[5]).toContain('The near-term goal is a portable device');
});

test('repeat intake preserves staff title and summary and reuses the frozen pair', async () => {
  const fixture = cases[0];
  setUp(fixture);
  await withDalContext('j27-fixtures', () => runJ27Intake(fixture.packet, binding));
  request.wmkf_wmkfprojectdescription = 'Staff-edited short title';
  request.wmkf_ai_summary = 'Staff-edited summary of the scientific question.';
  request.wmkf_ai_fitassessment = 682090002;
  responses = responsesFor(fixture).slice(2, 5);
  const { results } = await withDalContext('j27-fixtures', () => runJ27Intake(fixture.packet, binding));
  expect(results.P1.state).toBe('preserved');
  expect(results.P2.state).toBe('preserved');
  expect(results.P6.reused).toBe(true);
  expect(request.wmkf_wmkfprojectdescription).toBe('Staff-edited short title');
  expect(request.wmkf_ai_summary).toBe('Staff-edited summary of the scientific question.');
  expect(DynamicsService.updateRecord).toHaveBeenCalledTimes(3);
});

test('refuses an ordinary request and a stale prompt before sending a provider request', async () => {
  setUp(cases[0]);
  request.wmkf_istestrequest = false;
  await expect(withDalContext('j27-fixtures', () => runJ27Intake(complete, binding))).rejects.toThrow(/Factory-marked/);
  request.wmkf_istestrequest = true;
  rows[0].wmkf_ai_systemprompt = 'An obsolete title prompt.';
  await expect(withDalContext('j27-fixtures', () => runJ27Intake(complete, binding))).rejects.toThrow(/does not match this branch/);
  expect(global.fetch).not.toHaveBeenCalled();
  expect(DynamicsService.updateRecord).not.toHaveBeenCalled();
});
