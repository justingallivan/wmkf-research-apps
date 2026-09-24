/** @jest-environment node */
/**
 * Mechanized Stage 1d census. New report/export routes, request aggregates or
 * staff list components must be classified here before they can land.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const source = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

const REPORT_EXPORT_ROUTES = {
  'pages/api/admin/stats.js': { class: 'exclude', guard: 'excludeTestRequestSpendRows' },
  'pages/api/cron/drain-cycle-dossiers.js': { class: 'indirect', guard: 'drainCycleDossiers' },
  'pages/api/cycle-dossier/download.js': { class: 'indirect', guard: 'downloadCycleDossier' },
  'pages/api/cycle-dossier/index.js': { class: 'indirect', guard: 'cycleDossierAction' },
  'pages/api/dataverse-export/download.js': { class: 'indirect', guard: 'verifyDownloadToken' },
  'pages/api/dataverse-export/metadata.js': { class: 'n/a', guard: 'fetchLiveTaxonomy' },
  'pages/api/dataverse-export/preview.js': { class: 'exclude', guard: 'excludeMarkedTestRequests' },
  'pages/api/dataverse-export/run.js': { class: 'exclude', guard: 'excludeMarkedTestRequests' },
  // Single-request actions stay available for test requests (owner decision 2026-09-23).
  'pages/api/grant-reporting/extract.js': { class: 'single-request', guard: 'handleFullExtract' },
  'pages/api/grant-reporting/lookup-grant.js': { class: 'single-request', guard: 'lookupGrant' },
  'pages/api/review-manager/export-reviews.js': { class: 'exclude', guard: 'exportCombinedReviews' },
  'pages/api/workbench/export-candidates.js': { class: 'exclude', guard: 'exportCandidates' },
  'pages/api/workbench/grantee-deliverables/awardees.js': { class: 'exclude', guard: 'listGranteeAwardees' },
  'pages/api/workbench/grantee-deliverables/cycle-export.js': { class: 'exclude', guard: 'exportGranteeCycle' },
};

const AGGREGATE_CALLERS = {
  'lib/services/dataverse-export/fetch-client.js': 'primitive',
  'lib/services/dynamics-explorer/tool-executor.js': 'exclude',
  'lib/services/dynamics-service.js': 'primitive',
  'lib/services/dynamics/read-ops.js': 'primitive',
  // Cycle/status filter options are navigation and include test requests.
  'lib/services/workbench/request-search-service.js': 'navigation',
  'pages/api/dataverse-export/preview.js': 'exclude',
  'pages/api/dataverse-export/run.js': 'exclude',
};

const REPORT_SERVICE_CALLERS = {
  'lib/services/dynamics-explorer/tools/composite.js': 'ordinaryTestRequestODataFilterForNavigation',
  'lib/services/dynamics-explorer/tools/get-related.js': 'ordinaryTestRequestODataFilterForNavigation',
};

const BADGE_COMPONENTS = [
  'pages/dynamics-explorer.js',
  'pages/expertise-finder.js',
  'pages/review-panel.js',
  'pages/workbench/[requestId].js',
  'shared/components/admin/TestRequestPreviewSection.js',
  'shared/components/final-writeups/FinalWriteupsViews.js',
  'shared/components/meeting-tracker/MeetingTrackerList.js',
  'shared/components/meeting-tracker/SessionEditor.js',
  'shared/components/workbench/InitialAssessmentsPanel.js',
  'shared/components/workbench/RequestListPanel.js',
  'shared/components/workbench/RequestLocator.js',
  'shared/components/workbench/ReviewerFollowUpPanel.js',
  'shared/components/workbench/StaffDeliberationsPanel.js',
];

test('every report/export route is classified', () => {
  const routes = walk(path.join(ROOT, 'pages/api'))
    .map((file) => path.relative(ROOT, file))
    .filter((file) => file.endsWith('.js'))
    .filter((file) => /(^|\/)([^/]*(export|report|stats|dossier|awardee)[^/]*)\.js$/.test(file)
      || file.startsWith('pages/api/dataverse-export/')
      || file.startsWith('pages/api/grant-reporting/')
      || file.startsWith('pages/api/cycle-dossier/'))
    .sort();
  expect(routes).toEqual(Object.keys(REPORT_EXPORT_ROUTES).sort());
});

test.each(Object.entries(REPORT_EXPORT_ROUTES))('%s keeps its %s classification seam', (file, record) => {
  expect(source(file)).toContain(record.guard);
});

test('every aggregate/count caller is classified', () => {
  const pattern = /aggregateRequests\(|aggregateMeetingDateCycles\(|aggregateStatusesByGrantProgram\(|aggregateRecords\(|countRecords\(|fetchXmlAggregateCount\(/;
  const files = [path.join(ROOT, 'lib/services'), path.join(ROOT, 'pages/api')]
    .flatMap(walk)
    .filter((file) => file.endsWith('.js') && pattern.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(ROOT, file))
    .sort();
  expect(files).toEqual(Object.keys(AGGREGATE_CALLERS).sort());
});

test.each(Object.entries(REPORT_SERVICE_CALLERS))('%s keeps its report exclusion seam', (file, guard) => {
  expect(source(file)).toContain(guard);
});

test.each(BADGE_COMPONENTS)('%s uses the shared TEST badge', (file) => {
  const contents = source(file);
  expect(contents).toMatch(/import TestRequestBadge from ['"][^'"]*TestRequestBadge['"]/);
  expect(contents).toMatch(/<TestRequestBadge\b/);
});

test('Dynamics Explorer request tables suppress the local page-only CSV in favor of the guarded export tool', () => {
  const contents = source('pages/dynamics-explorer.js');
  expect(contents).toContain('markerColumn < 0');
  expect(contents).toContain('downloadCsv(headers, rows');
  expect(source('shared/config/prompts/dynamics-explorer.js')).toContain('always preserve it as an "Is Test Request" column');
});
