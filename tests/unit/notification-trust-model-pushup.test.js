/**
 * S334 notification trust-model Stage 1 characterization
 * (docs/NOTIFICATION_TRUST_MODEL_PLAN.md sites 9, 12-22).
 *
 * NotificationService itself is real in this file. Alert persistence and
 * recipient lookup are mocked so each path reaches the email branch without
 * Postgres/Dataverse fixtures, while DynamicsService remains real for the
 * fail-closed negative control.
 *
 * @jest-environment node
 */

import { jest } from '@jest/globals';
import { Readable } from 'stream';

const mockSql = jest.fn();
const mockVerifyInternalCall = jest.fn();
const mockOnboardReviewer = jest.fn();
const mockValidateOnboardInput = jest.fn();
const mockDrainReviewerAcceptanceJobs = jest.fn();
const mockWriteReviewFiles = jest.fn();
const mockVerifySuggestionToken = jest.fn();
const mockCheckRateLimit = jest.fn();
const mockRecordTokenOutcome = jest.fn();
const mockVerifyCronSecret = jest.fn();
const mockRunHealthChecks = jest.fn();
const mockGrantApps = jest.fn();
const mockReconcileProfile = jest.fn();
const mockGetServerSession = jest.fn();
const mockBlobGet = jest.fn();
const mockBlobDel = jest.fn();
const mockBlobList = jest.fn();
const mockListSettings = jest.fn();
const mockGetSettingStrict = jest.fn();
const mockRequireAppAccess = jest.fn();
const mockAlertService = {
  createAlert: jest.fn(),
  autoResolve: jest.fn(),
  cleanupOldAlerts: jest.fn(),
};
const mockAlertRecipients = {
  resolveRecipients: jest.fn(),
  getSuperuserRoster: jest.fn(),
};
const mockLLMComplete = jest.fn();
const mockLLMClient = jest.fn();
const mockFeedbackService = { cleanupOldFeedback: jest.fn() };
const mockReviewDraftService = { deleteExpired: jest.fn() };
const mockIntakeDraftService = {
  getById: jest.fn(),
  removePending: jest.fn(),
  promoteAttachment: jest.fn(),
};
const mockIntakeAuditService = { log: jest.fn() };
const mockCheckIntakeRateLimit = jest.fn();
const mockResolveContactForSession = jest.fn();
const mockHasLiveMembership = jest.fn();
const mockScanBytes = jest.fn();
const mockIsVirusScanEnabled = jest.fn();
const mockValidateReviewForm = jest.fn();
const mockGetActiveQuestionSet = jest.fn();
const mockValidateReviewFile = jest.fn();
const mockValidateIntakeAttachment = jest.fn();
const mockSniffFileType = jest.fn();
const mockResolveProgramDirectorEmailForRequest = jest.fn();
const mockReviewerSuggestionAdapter = {
  getForExternalVerification: jest.fn(),
  patchReviewReceipt: jest.fn(),
  queryAllSuggestions: jest.fn(),
  getForAcceptanceDrain: jest.fn(),
  getByIdWithSelect: jest.fn(),
  findById: jest.fn(),
  updateLifecycle: jest.fn(),
  patchFields: jest.fn(),
  setHonorariumRequest: jest.fn(),
  isExcluded: jest.fn((row) => row?.wmkf_applicantdisposition === 100000001),
  notExcludedFilter: jest.fn(() => 'wmkf_applicantdisposition ne 100000001'),
  ENTITY_SET_NAME: 'wmkf_appreviewersuggestions',
};
const mockPotentialReviewerAdapter = {
  getById: jest.fn(),
  getByIdWithSelect: jest.fn(),
  setContactLink: jest.fn(),
};
const mockGrantRequestAdapter = {
  create: jest.fn(),
  getById: jest.fn(),
  updateById: jest.fn(),
};
const mockGrantCycleAdapter = { queryAllCycles: jest.fn() };
const mockContactAdapter = {
  updateFields: jest.fn(),
  getByIdWithSelect: jest.fn(),
};
const mockSystemUserAdapter = {
  getById: jest.fn(),
  getByIdWithSelect: jest.fn(),
};
const mockGranteeDeliverableAdapter = {
  queryAllDeliverables: jest.fn(),
  update: jest.fn(),
};
const mockResolveSignatureForRequest = jest.fn();
const mockOnboardingState = {
  listStuck: jest.fn(),
  listPending: jest.fn(),
  clearDynamicsPending: jest.fn(),
  bumpAttempt: jest.fn(),
  cleanupCompleted: jest.fn(),
};
const mockOptionSetValues = {
  BILLCOM_ACCOUNT_YES: 100000000,
  BILLCOM_ACCOUNT_NO: 100000001,
  assertOptionSetValuesConfigured: jest.fn(),
};

jest.mock('@vercel/postgres', () => ({ sql: mockSql }));
jest.mock('@vercel/blob', () => ({ get: mockBlobGet, del: mockBlobDel, list: mockBlobList }));
jest.mock('next-auth', () => jest.fn((opts) => opts));
jest.mock('next-auth/providers/azure-ad', () => jest.fn((opts) => ({ id: 'azure-ad', ...opts })));
jest.mock('next-auth/next', () => ({ getServerSession: mockGetServerSession }));
jest.mock('../../shared/config/appRegistry', () => ({ DEFAULT_APP_GRANTS: ['admin'] }));
jest.mock('../../lib/services/app-access-service', () => ({ grantApps: mockGrantApps }));
jest.mock('../../lib/services/dynamics-identity-service', () => ({ reconcileProfile: mockReconcileProfile }));
jest.mock('../../lib/bill/internal-call-auth', () => ({ verifyInternalCall: mockVerifyInternalCall }));
jest.mock('../../lib/bill/onboard-reviewer-service', () => ({
  onboardReviewer: mockOnboardReviewer,
  validateOnboardInput: mockValidateOnboardInput,
}));
jest.mock('../../lib/services/reviewer-acceptance-drain', () => {
  const actual = jest.requireActual('../../lib/services/reviewer-acceptance-drain');
  return { ...actual, drainReviewerAcceptanceJobs: mockDrainReviewerAcceptanceJobs };
});
jest.mock('../../lib/services/review-upload', () => {
  const actual = jest.requireActual('../../lib/services/review-upload');
  return { ...actual, writeReviewFiles: mockWriteReviewFiles };
});
jest.mock('../../lib/external/verify-suggestion-token', () => {
  const actual = jest.requireActual('../../lib/external/verify-suggestion-token');
  return { ...actual, verifySuggestionToken: mockVerifySuggestionToken };
});
jest.mock('../../lib/external/rate-limit', () => ({
  checkRateLimit: mockCheckRateLimit,
  recordTokenOutcome: mockRecordTokenOutcome,
}));
jest.mock('../../lib/utils/cron-auth', () => ({ verifyCronSecret: mockVerifyCronSecret }));
jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: mockRequireAppAccess }));
jest.mock('../../lib/utils/health-checker', () => ({ runHealthChecks: mockRunHealthChecks }));
jest.mock('../../lib/services/alert-service', () => mockAlertService);
jest.mock('../../lib/services/alert-recipients', () => mockAlertRecipients);
jest.mock('../../lib/services/llm-client', () => ({
  LLMClient: mockLLMClient,
}));
jest.mock('../../lib/services/feedback-service', () => ({
  __esModule: true,
  default: mockFeedbackService,
}));
jest.mock('../../lib/services/review-draft-service', () => ({
  __esModule: true,
  default: mockReviewDraftService,
}));
jest.mock('../../lib/services/database-service', () => ({ DatabaseService: {} }));
jest.mock('../../lib/services/settings-service', () => ({
  listSettings: mockListSettings,
  getSettingStrict: mockGetSettingStrict,
}));
jest.mock('../../lib/services/intake-draft-service', () => ({
  __esModule: true,
  default: mockIntakeDraftService,
}));
jest.mock('../../lib/services/intake-audit-service', () => ({
  __esModule: true,
  default: mockIntakeAuditService,
}));
jest.mock('../../lib/intake/rate-limit', () => ({ checkIntakeRateLimit: mockCheckIntakeRateLimit }));
jest.mock('../../lib/services/contact-bridge-service', () => ({
  resolveContactForSession: mockResolveContactForSession,
}));
jest.mock('../../lib/services/membership-service', () => ({
  hasLiveMembership: mockHasLiveMembership,
  hasSubmitterRole: jest.fn(),
}));
jest.mock('../../lib/utils/intake-blob', () => ({
  getIntakeBlobToken: jest.fn(() => 'intake-token'),
}));
jest.mock('../../lib/utils/form-schema', () => ({
  getFormSchema: jest.fn(() => ({})),
  findFileField: jest.fn(() => ({
    accept: ['application/pdf'],
    multiple: true,
    maxFiles: 5,
  })),
  countFieldEntries: jest.fn(() => 0),
}));
jest.mock('../../lib/services/cloudmersive-scan', () => ({ scanBytes: mockScanBytes }));
jest.mock('../../lib/utils/virus-scan-config', () => ({ isVirusScanEnabled: mockIsVirusScanEnabled }));
jest.mock('../../lib/utils/file-magic', () => ({
  validateReviewFile: mockValidateReviewFile,
  validateIntakeAttachment: mockValidateIntakeAttachment,
  sniffFileType: mockSniffFileType,
}));
jest.mock('../../lib/external/review-form-schema', () => ({ validateReviewForm: mockValidateReviewForm }));
jest.mock('../../lib/external/review-question-fetcher', () => ({
  getActiveQuestionSet: mockGetActiveQuestionSet,
}));
jest.mock('../../lib/external/review-answer-snapshot', () => ({
  buildRatingSnapshotRows: jest.fn(() => []),
}));
jest.mock('../../lib/external/token-lifecycle', () => ({
  extendForPostSubmissionWindow: jest.fn(),
}));
jest.mock('../../lib/services/program-director-resolver', () => ({
  resolveProgramDirectorEmailForRequest: mockResolveProgramDirectorEmailForRequest,
}));
jest.mock('../../lib/services/email-signature', () => ({
  resolveSignatureForRequest: mockResolveSignatureForRequest,
}));
jest.mock('../../lib/services/sharepoint-cleanup', () => ({
  cleanupSharePointItems: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../lib/services/graph-service', () => ({
  GraphService: {
    getDriveId: jest.fn(),
    uploadFile: jest.fn(),
  },
}));
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => mockReviewerSuggestionAdapter);
jest.mock('../../lib/dataverse/adapters/potential-reviewer', () => mockPotentialReviewerAdapter);
jest.mock('../../lib/dataverse/adapters/grant-request', () => mockGrantRequestAdapter);
jest.mock('../../lib/dataverse/adapters/grant-cycle', () => mockGrantCycleAdapter);
jest.mock('../../lib/dataverse/adapters/contact', () => mockContactAdapter);
jest.mock('../../lib/dataverse/adapters/system-user', () => mockSystemUserAdapter);
jest.mock('../../lib/dataverse/adapters/grantee-deliverable', () => mockGranteeDeliverableAdapter);
jest.mock('../../lib/dataverse/adapters/review-answer', () => ({
  answerUpsertDescriptor: jest.fn(),
}));
jest.mock('../../lib/dataverse/core/changeset', () => ({
  runChangeset: jest.fn(),
  atomicParentWithChildren: jest.fn(({ parent, children }) => ({ parent, children })),
}));
jest.mock('../../lib/bill/onboarding-state', () => mockOnboardingState);
jest.mock('../../lib/bill/option-set-values', () => mockOptionSetValues);
jest.mock('../../lib/utils/tracked-secrets', () => ({
  TRACKED_SECRETS: [{ key: 'test_secret', name: 'Test Secret' }],
}));

const NotificationService = require('../../lib/services/notification-service');
const { DynamicsService } = require('../../lib/services/dynamics-service');
const { hasTrustedDalContext, withDalContext } = require('../../lib/dataverse/core/context');
const { authOptions } = require('../../pages/api/auth/[...nextauth].js');
const billOnboardHandler = require('../../pages/api/bill/onboard-reviewer').default;
const authBypassHandler = require('../../pages/api/cron/auth-bypass-check').default;
const { register } = require('../../instrumentation');
const healthCheckHandler = require('../../pages/api/cron/health-check').default;
const logAnalysisHandler = require('../../pages/api/cron/log-analysis').default;
const maintenanceHandler = require('../../pages/api/cron/maintenance').default;
const secretCheckHandler = require('../../pages/api/cron/secret-check').default;
const granteeRemindersHandler = require('../../pages/api/cron/grantee-deliverable-reminders').default;
const reviewThankyousHandler = require('../../pages/api/cron/send-review-thankyous').default;
const reviewerRemindersHandler = require('../../pages/api/cron/reviewer-reminders').default;
const drainHandler = require('../../pages/api/cron/drain-reviewer-acceptances').default;
const sendReviewReminderHandler = require('../../pages/api/review-manager/send-review-reminder').default;
const withdrawSufficientHandler = require('../../pages/api/review-manager/withdraw-sufficient').default;
const staffUploadHandler = require('../../pages/api/review-manager/upload-review').default;
const externalUploadHandler = require('../../pages/api/external/review/[token]/upload').default;
const attachHandler = require('../../pages/api/intake/draft/attach').default;
const MaintenanceService = require('../../lib/services/maintenance-service');
const { writeReviewFiles } = require('../../lib/services/review-upload');
const { processReviewerAcceptanceJob } = require('../../lib/services/reviewer-acceptance-drain');
const { ensureHonorariumOnboarding } = require('../../lib/bill/honorarium-onboard-orchestrator');
const { sendManualReviewDueReminder } = require('../../lib/services/reviewer-manual-reminder');
const { sweepReviewThankYous } = require('../../lib/services/reviewer-thankyou-sweep');
const { sweepReviewerReminders } = require('../../lib/services/reviewer-reminder-sweep');
const { withdrawSufficient } = require('../../lib/services/review-manager/withdraw-sufficient-service');
const { runGranteeDeliverableReminders } = require('../../lib/services/cron/grantee-deliverable-reminders-service');

const originalEnv = { ...process.env };
const originalNotify = NotificationService.notify;

const PDF_BYTES = Buffer.from('%PDF-1.4\n');
const SUGGESTION_ID = '11111111-1111-1111-1111-111111111111';
const REQUEST_ID = '22222222-2222-2222-2222-222222222222';
const REVIEWER_ID = '33333333-3333-3333-3333-333333333333';
const CONTACT_ID = '44444444-4444-4444-4444-444444444444';
const HONORARIUM_REQUEST_ID = '55555555-5555-5555-5555-555555555555';
const PD_ID = '66666666-6666-6666-6666-666666666666';
const ACCEPTED_AT = '2026-01-01T00:00:00.000Z';

function okJson(body) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

function mockDynamicsFetch({ vercelEvents = [] } = {}) {
  global.fetch = jest.fn((url, opts = {}) => {
    const href = String(url);
    if (href.includes('api.vercel.com')) {
      return Promise.resolve(okJson({ events: vercelEvents }));
    }
    if (href.includes('login.microsoftonline.com')) {
      return Promise.resolve(okJson({ access_token: 'token', expires_in: 3600 }));
    }
    if (href.includes('/systemusers')) {
      return Promise.resolve(okJson({ value: [{ systemuserid: 'system-user-1' }] }));
    }
    if (opts.method === 'POST' && href.endsWith('/emails')) {
      return Promise.resolve(okJson({ activityid: 'email-1' }));
    }
    if (opts.method === 'POST' && href.includes('Microsoft.Dynamics.CRM.SendEmail')) {
      return Promise.resolve(okJson({}));
    }
    return Promise.resolve(okJson({ value: [] }));
  });
  return global.fetch;
}

function watchNotifyEntry() {
  const seen = [];
  jest.spyOn(NotificationService, 'notify').mockImplementation(function wrappedNotify(args) {
    seen.push({
      type: args.type,
      source: args.source,
      severity: args.severity,
      trusted: hasTrustedDalContext(),
      title: args.title,
    });
    return originalNotify.call(this, args);
  });
  return seen;
}

function expectTrustedNotify(seen, matcher) {
  const hit = seen.find((entry) => (
    (!matcher.type || entry.type === matcher.type) &&
    (!matcher.source || entry.source === matcher.source) &&
    (!matcher.title || entry.title === matcher.title)
  ));
  expect(hit).toBeTruthy();
  expect(hit.trusted).toBe(true);
}

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function makeRawReq(body) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.method = 'POST';
  req.headers = {};
  return req;
}

function makeMultipartReq({ fields = {}, file = {}, query = {} } = {}) {
  const boundary = '----wmkf-test-boundary';
  const chunks = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${name}"\r\n\r\n` +
      `${value}\r\n`,
    );
  }
  chunks.push(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="files"; filename="${file.filename || 'review.pdf'}"\r\n` +
    `Content-Type: ${file.mimeType || 'application/pdf'}\r\n\r\n`,
  );
  chunks.push(file.buffer || PDF_BYTES);
  chunks.push(`\r\n--${boundary}--\r\n`);

  const body = Buffer.concat(chunks.map((chunk) => (Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))));
  const req = Readable.from([body]);
  req.method = 'POST';
  req.query = query;
  req.headers = {
    'content-type': `multipart/form-data; boundary=${boundary}`,
    'content-length': String(body.length),
  };
  return req;
}

function mockBlankEmailDefault(matchKey = () => true) {
  mockGetSettingStrict.mockImplementation(async (key) => (
    matchKey(key)
      ? { found: true, value: '   ' }
      : { found: true, value: `configured ${key}` }
  ));
}

function mockUnavailableEmailDefault(matchKey = () => true) {
  mockGetSettingStrict.mockImplementation(async (key) => {
    if (matchKey(key)) throw new Error(`unavailable ${key}`);
    return { found: true, value: `configured ${key}` };
  });
}

function makeAcceptanceJob({ isAcceptRepeat = true } = {}) {
  return {
    id: 7,
    lease_token: 'lease-1',
    status: 'accepted',
    suggestion_id: SUGGESTION_ID,
    accepted_at: ACCEPTED_AT,
    payload: {
      acceptedAt: ACCEPTED_AT,
      isAcceptRepeat,
      suggestion: {
        wmkf_appreviewersuggestionid: SUGGESTION_ID,
        _wmkf_honorariumrequest_value: HONORARIUM_REQUEST_ID,
        _wmkf_potentialreviewer_value: REVIEWER_ID,
      },
      request: {
        akoya_requestid: REQUEST_ID,
        akoya_requestnum: '1001',
        akoya_title: 'Test Request',
        wmkf_reviewduedate: '2026-08-01',
        wmkf_meetingdate: '2026-06-01',
        _wmkf_programdirector_value: PD_ID,
      },
      reviewer: {
        wmkf_potentialreviewersid: REVIEWER_ID,
        _wmkf_contact_value: CONTACT_ID,
        wmkf_name: 'Reviewer One',
        wmkf_firstname: 'Reviewer',
        wmkf_lastname: 'One',
        wmkf_emailaddress: 'reviewer@example.com',
      },
      body: {
        address: {
          line1: '1 Main St',
          city: 'Los Angeles',
          state: 'CA',
          postalCode: '90000',
          country: 'US',
        },
        contactEdits: {},
      },
    },
    steps: {},
  };
}

function makeAcceptanceDrainDeps(overrides = {}) {
  return {
    suggestions: {
      getForAcceptanceDrain: jest.fn().mockResolvedValue({
        wmkf_appreviewersuggestionid: SUGGESTION_ID,
        _wmkf_potentialreviewer_value: REVIEWER_ID,
        _wmkf_honorariumrequest_value: HONORARIUM_REQUEST_ID,
        wmkf_accepted: true,
        wmkf_declined: false,
        wmkf_responsereceivedat: ACCEPTED_AT,
      }),
    },
    jobs: {
      cancelReviewerAcceptanceJob: jest.fn().mockResolvedValue({ id: 7 }),
      completeReviewerAcceptanceJob: jest.fn().mockResolvedValue({ id: 7, status: 'completed' }),
      mergeReviewerAcceptanceJobStep: jest.fn().mockResolvedValue({ id: 7 }),
    },
    potentialReviewers: {
      getById: jest.fn().mockResolvedValue({
        wmkf_potentialreviewersid: REVIEWER_ID,
        _wmkf_contact_value: CONTACT_ID,
        wmkf_name: 'Reviewer One',
        wmkf_emailaddress: 'reviewer@example.com',
      }),
    },
    ensureHonorarium: jest.fn().mockResolvedValue({ contactId: CONTACT_ID }),
    captureOrcid: jest.fn().mockResolvedValue(undefined),
    captureIdentity: jest.fn().mockResolvedValue(undefined),
    syncNameTitle: jest.fn().mockResolvedValue(undefined),
    alertEmail: jest.fn().mockResolvedValue(undefined),
    alertAffiliation: jest.fn().mockResolvedValue(undefined),
    quota: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function mockDefaultMaintenanceRun() {
  jest.spyOn(MaintenanceService, 'startRun').mockResolvedValue('run-1');
  jest.spyOn(MaintenanceService, 'completeRun').mockResolvedValue(undefined);
  jest.spyOn(MaintenanceService, 'getRetentionConfig').mockResolvedValue({
    usage_log_days: 1,
    query_log_days: 1,
    health_history_days: 1,
    intake_audit_days: 1,
    bill_webhook_events_days: 1,
    maintenance_runs_days: 1,
    bill_onboarding_state_days: 1,
    alert_days: 1,
    blob_days: 1,
  });
  jest.spyOn(MaintenanceService, 'cleanupUsageLog').mockResolvedValue(0);
  jest.spyOn(MaintenanceService, 'cleanupQueryLog').mockResolvedValue(0);
  jest.spyOn(MaintenanceService, 'cleanupExpiredCache').mockResolvedValue({ error: 'cache failed' });
  jest.spyOn(MaintenanceService, 'cleanupHealthHistory').mockResolvedValue(0);
  jest.spyOn(MaintenanceService, 'cleanupIntakeAudit').mockResolvedValue(0);
  jest.spyOn(MaintenanceService, 'cleanupBillWebhookEvents').mockResolvedValue(0);
  jest.spyOn(MaintenanceService, 'cleanupMaintenanceRuns').mockResolvedValue(0);
  jest.spyOn(MaintenanceService, 'sweepBillOnboarding').mockResolvedValue({ resumed: 0, scanned: 0, errors: 0 });
  jest.spyOn(MaintenanceService, 'cleanupBillOnboardingState').mockResolvedValue(0);
  jest.spyOn(MaintenanceService, 'sweepIntakePending').mockResolvedValue({ deleted: 0, errors: 0 });
  jest.spyOn(MaintenanceService, 'cleanupBlobs').mockResolvedValue({ deleted: 0, errors: 0 });
  jest.spyOn(MaintenanceService, 'cleanupIntakePrivateBlobs').mockResolvedValue({ deleted: 0, errors: 0 });
  mockAlertService.cleanupOldAlerts.mockResolvedValue(0);
  mockFeedbackService.cleanupOldFeedback.mockResolvedValue(0);
  mockReviewDraftService.deleteExpired.mockResolvedValue(0);
}

beforeEach(() => {
  process.env = { ...originalEnv };
  process.env.DATAVERSE_DAL_ENFORCEMENT = 'on';
  process.env.NOTIFICATION_EMAIL_FROM = 'sender@example.com';
  process.env.DYNAMICS_URL = 'https://example.crm.dynamics.com';
  process.env.DYNAMICS_TENANT_ID = 'tenant';
  process.env.DYNAMICS_CLIENT_ID = 'client';
  process.env.DYNAMICS_CLIENT_SECRET = 'secret';

  jest.clearAllMocks();
  DynamicsService.clearCaches();
  mockDynamicsFetch();

  mockDrainReviewerAcceptanceJobs.mockReset();
  mockWriteReviewFiles.mockReset();
  mockWriteReviewFiles.mockImplementation((...args) => (
    jest.requireActual('../../lib/services/review-upload').writeReviewFiles(...args)
  ));
  mockVerifySuggestionToken.mockReset();
  mockVerifySuggestionToken.mockResolvedValue({
    ok: true,
    payload: { ops: ['upload_review'] },
    suggestion: {
      wmkf_appreviewersuggestionid: SUGGESTION_ID,
      wmkf_reviewreceivedat: null,
    },
    request: { akoya_requestid: REQUEST_ID, akoya_requestnum: '1001' },
    reviewer: null,
  });
  mockCheckRateLimit.mockReset();
  mockCheckRateLimit.mockResolvedValue({ ok: true });
  mockRecordTokenOutcome.mockReset();
  mockRecordTokenOutcome.mockResolvedValue(undefined);

  mockAlertService.createAlert.mockImplementation(async (args) => ({ id: 'alert-1', ...args }));
  mockAlertService.autoResolve.mockResolvedValue(0);
  mockAlertService.cleanupOldAlerts.mockResolvedValue(0);
  mockAlertRecipients.resolveRecipients.mockResolvedValue({
    recipients: ['admin@example.com'],
    category: 'ops',
    source: 'test',
  });
  mockAlertRecipients.getSuperuserRoster.mockResolvedValue(['admin@example.com']);
  mockVerifyCronSecret.mockReturnValue(true);
  mockRequireAppAccess.mockResolvedValue({ session: { user: { dynamicsSystemuserId: PD_ID } } });
  mockVerifyInternalCall.mockReturnValue({ ok: true });
  mockGrantApps.mockResolvedValue(undefined);
  mockReconcileProfile.mockResolvedValue(undefined);
  mockLLMComplete.mockResolvedValue({ text: 'analysis' });
  mockLLMClient.mockImplementation(() => ({ complete: mockLLMComplete }));
  mockIsVirusScanEnabled.mockReturnValue(true);
  mockValidateReviewFile.mockReturnValue({ ok: true, type: 'pdf' });
  mockValidateIntakeAttachment.mockReturnValue({ ok: true, type: 'pdf' });
  mockSniffFileType.mockReturnValue('pdf');
  mockValidateReviewForm.mockReturnValue({ ok: true, dataverseValues: {}, ratings: {} });
  mockGetActiveQuestionSet.mockResolvedValue([]);
  mockResolveProgramDirectorEmailForRequest.mockResolvedValue('pd@example.com');
  mockGetSettingStrict.mockResolvedValue({ found: true, value: 'Configured email default' });
  mockBlobDel.mockResolvedValue(undefined);
  mockBlobList.mockResolvedValue({ blobs: [], cursor: null });
  mockIntakeAuditService.log.mockResolvedValue(null);
  mockCheckIntakeRateLimit.mockResolvedValue({ ok: true });
  mockResolveContactForSession.mockResolvedValue({ ok: true, contactId: 'contact-1' });
  mockHasLiveMembership.mockResolvedValue(true);
  mockOnboardingState.listStuck.mockResolvedValue([]);
  mockOnboardingState.listPending.mockResolvedValue([]);
  mockOnboardingState.clearDynamicsPending.mockResolvedValue(undefined);
  mockOnboardingState.bumpAttempt.mockResolvedValue(1);
  mockOnboardingState.cleanupCompleted.mockResolvedValue(0);
  mockOptionSetValues.assertOptionSetValuesConfigured.mockImplementation(() => {});
  mockContactAdapter.updateFields.mockResolvedValue(undefined);
  mockContactAdapter.getByIdWithSelect.mockResolvedValue({
    contactid: CONTACT_ID,
    fullname: 'Reviewer One',
    emailaddress1: 'reviewer@example.com',
  });
  mockSystemUserAdapter.getById.mockResolvedValue({
    systemuserid: PD_ID,
    fullname: 'Program Director',
    internalemailaddress: 'pd@example.com',
    isdisabled: false,
  });
  mockSystemUserAdapter.getByIdWithSelect.mockResolvedValue({
    systemuserid: PD_ID,
    fullname: 'Program Director',
    internalemailaddress: 'pd@example.com',
    isdisabled: false,
  });
  mockResolveSignatureForRequest.mockResolvedValue({ signature: 'Program Director' });
  mockReviewerSuggestionAdapter.queryAllSuggestions.mockResolvedValue({ records: [] });
  mockReviewerSuggestionAdapter.getByIdWithSelect.mockResolvedValue({
    wmkf_appreviewersuggestionid: SUGGESTION_ID,
    _wmkf_request_value: REQUEST_ID,
    _wmkf_potentialreviewer_value: REVIEWER_ID,
    wmkf_accepted: true,
    wmkf_reviewstatus: 100000001,
    wmkf_reviewreceivedat: null,
    wmkf_applicantdisposition: null,
    wmkf_remindercount: 0,
    _etag: 'W/"1"',
  });
  mockReviewerSuggestionAdapter.findById.mockResolvedValue({
    wmkf_appreviewersuggestionid: SUGGESTION_ID,
    _wmkf_request_value: REQUEST_ID,
    _wmkf_potentialreviewer_value: REVIEWER_ID,
    wmkf_invited: true,
    wmkf_accepted: false,
    wmkf_declined: false,
    wmkf_responsetype: null,
    _etag: 'W/"1"',
  });
  mockReviewerSuggestionAdapter.updateLifecycle.mockResolvedValue(undefined);
  mockReviewerSuggestionAdapter.patchFields.mockResolvedValue(undefined);
  mockReviewerSuggestionAdapter.patchReviewReceipt.mockResolvedValue(undefined);
  mockReviewerSuggestionAdapter.setHonorariumRequest.mockResolvedValue(undefined);
  mockPotentialReviewerAdapter.getById.mockResolvedValue({
    wmkf_potentialreviewersid: REVIEWER_ID,
    _wmkf_contact_value: CONTACT_ID,
    wmkf_name: 'Reviewer One',
    wmkf_emailaddress: 'reviewer@example.com',
  });
  mockPotentialReviewerAdapter.getByIdWithSelect.mockResolvedValue({
    wmkf_potentialreviewersid: REVIEWER_ID,
    wmkf_name: 'Reviewer One',
    wmkf_emailaddress: 'reviewer@example.com',
  });
  mockPotentialReviewerAdapter.setContactLink.mockResolvedValue(undefined);
  mockGrantRequestAdapter.getById.mockResolvedValue({
    akoya_requestid: REQUEST_ID,
    akoya_requestnum: '1001',
    akoya_title: 'Test Request',
    _wmkf_programdirector_value: PD_ID,
    _wmkf_projectleader_value: CONTACT_ID,
    _akoya_primarycontactid_value: CONTACT_ID,
    wmkf_reviewduedate: '2026-01-01',
    wmkf_respondreminderenabled: true,
    wmkf_respondoffsetdays: 7,
    wmkf_respondreminderleaddays: 1,
    wmkf_reviewduereminderenabled: true,
    wmkf_reviewduereminderleaddays: 1,
  });
  mockGrantRequestAdapter.create.mockResolvedValue({ akoya_requestid: HONORARIUM_REQUEST_ID });
  mockGranteeDeliverableAdapter.queryAllDeliverables.mockResolvedValue({
    records: [{
      wmkf_granteedeliverableid: 'deliverable-1',
      _wmkf_request_value: REQUEST_ID,
      wmkf_inviteddate: '2026-01-01T00:00:00.000Z',
      _etag: 'W/"1"',
    }],
    totalCount: 1,
    capped: false,
  });
  mockGranteeDeliverableAdapter.update.mockResolvedValue(undefined);
  mockReviewerSuggestionAdapter.getForExternalVerification.mockResolvedValue({
    wmkf_appreviewersuggestionid: SUGGESTION_ID,
    _wmkf_request_value: REQUEST_ID,
    wmkf_Request: {
      akoya_requestid: REQUEST_ID,
      akoya_requestnum: '1001',
      akoya_title: 'Test Request',
    },
    wmkf_PotentialReviewer: {
      wmkf_name: 'Reviewer One',
      wmkf_lastname: 'One',
      wmkf_emailaddress: 'reviewer@example.com',
    },
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  DynamicsService.clearCaches();
  global.fetch = jest.fn();
  process.env = { ...originalEnv };
});

describe('notification trust-model Stage 1 negative control', () => {
  test('real Dynamics email write fails closed with no trusted context', async () => {
    const fetchSpy = mockDynamicsFetch();

    await expect(
      DynamicsService.createAndSendEmail({
        subject: 'subject',
        body: '<p>body</p>',
        from: 'sender@example.com',
        to: ['admin@example.com'],
      }),
    ).rejects.toThrow(/no trusted Dataverse context/);

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('notification trust-model Stage 1 pushed-up wrappers', () => {
  test('site 9 - NextAuth notifyNewUser fire-and-forget enters notification-email context', async () => {
    const seen = watchNotifyEntry();
    mockSql
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'profile-1' }] });

    await expect(authOptions.callbacks.signIn({
      user: { id: 'azure-user-1', email: 'new@example.com', name: 'New User' },
      account: { provider: 'azure-ad' },
      profile: { oid: 'azure-oid-1', name: 'New User' },
    })).resolves.toBe(true);

    expectTrustedNotify(seen, { type: 'new_user' });
  });

  test('site 14 - bill onboard route 500 alert enters notification-email context', async () => {
    const seen = watchNotifyEntry();
    process.env.BILL_INTEGRATION_SECRET = 'x'.repeat(32);
    mockValidateOnboardInput.mockReturnValue(null);
    mockOnboardReviewer.mockRejectedValue(new Error('route boom'));
    const res = makeRes();

    await billOnboardHandler(makeRawReq({
      honorariumRequestId: 'hon-1',
      reviewerContactId: 'contact-1',
      reviewerName: 'Reviewer',
      reviewerEmail: 'reviewer@example.com',
      address: { line1: '1 Main', city: 'LA', zipOrPostalCode: '90000', country: 'US' },
    }), res);

    expect(res.statusCode).toBe(500);
    expectTrustedNotify(seen, { type: 'bill_unhandled_error', source: 'bill/onboard-reviewer' });
  });

  test('site 15 - auth-bypass cron enters cron-auth-bypass-check context', async () => {
    const seen = watchNotifyEntry();
    process.env.NODE_ENV = 'production';
    process.env.EMERGENCY_AUTH_BYPASS = 'true';
    jest.spyOn(MaintenanceService, 'startRun').mockResolvedValue('run-1');
    jest.spyOn(MaintenanceService, 'completeRun').mockResolvedValue(undefined);
    const res = makeRes();

    await authBypassHandler({ method: 'GET', headers: {} }, res);

    expect(res.body.ok).toBe(true);
    expectTrustedNotify(seen, { type: 'security', source: 'cron/auth-bypass-check' });
  });

  test('sites 15 and 16 - instrumentation cold-start alerts are caught and wrapped', async () => {
    const seen = watchNotifyEntry();
    process.env.NEXT_RUNTIME = 'nodejs';
    process.env.NODE_ENV = 'production';
    process.env.EMERGENCY_AUTH_BYPASS = 'true';
    mockSql.mockRejectedValueOnce(Object.assign(new Error('missing tracker'), { code: '42P01' }));

    await register();

    expectTrustedNotify(seen, { type: 'security', source: 'instrumentation/cold-start' });
    expectTrustedNotify(seen, { type: 'migration_tracker_missing', source: 'instrumentation/migration-drift' });
  });

  test('site 17 - health-check unhealthy alert enters notification-email context', async () => {
    const seen = watchNotifyEntry();
    jest.spyOn(MaintenanceService, 'startRun').mockResolvedValue('run-1');
    jest.spyOn(MaintenanceService, 'completeRun').mockResolvedValue(undefined);
    mockRunHealthChecks.mockResolvedValue({
      overall: 'unhealthy',
      responseTimeMs: 25,
      services: { dataverse: { status: 'error' } },
    });
    mockSql
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ overall_status: 'degraded' }] })
      .mockResolvedValueOnce({ rows: [{ count: '2' }] });
    const res = makeRes();

    await healthCheckHandler({ method: 'GET', headers: {} }, res);

    expect(res.body.ok).toBe(true);
    expectTrustedNotify(seen, { type: 'health', source: 'cron/health-check' });
  });

  test('site 18 - log-analysis error alert enters notification-email context', async () => {
    const seen = watchNotifyEntry();
    process.env.VERCEL_API_TOKEN = 'vercel-token';
    process.env.VERCEL_PROJECT_ID = 'project-1';
    jest.spyOn(MaintenanceService, 'startRun').mockResolvedValue('run-1');
    jest.spyOn(MaintenanceService, 'completeRun').mockResolvedValue(undefined);
    const events = Array.from({ length: 50 }, (_, i) => ({
      type: 'error',
      created: Date.now() - i,
      text: `error ${i}`,
      payload: { path: `/api/${i}` },
    }));
    mockDynamicsFetch({ vercelEvents: events });
    const res = makeRes();

    await logAnalysisHandler({ method: 'GET', headers: {} }, res);

    expect(res.body.errorCount).toBe(50);
    expectTrustedNotify(seen, { type: 'log_analysis', source: 'cron/log-analysis' });
  });

  test('site 19 - maintenance summary failure alert enters notification-email context', async () => {
    const seen = watchNotifyEntry();
    mockDefaultMaintenanceRun();
    const res = makeRes();

    await maintenanceHandler({ method: 'GET', headers: {} }, res);

    expect(res.body.ok).toBe(false);
    expectTrustedNotify(seen, { type: 'maintenance', source: 'cron/maintenance' });
  });

  test('site 19 - maintenance catch-path failure alert enters notification-email context', async () => {
    const seen = watchNotifyEntry();
    jest.spyOn(MaintenanceService, 'startRun').mockResolvedValue('run-1');
    jest.spyOn(MaintenanceService, 'completeRun').mockResolvedValue(undefined);
    jest.spyOn(MaintenanceService, 'getRetentionConfig').mockRejectedValue(new Error('top-level failure'));
    const res = makeRes();

    await maintenanceHandler({ method: 'GET', headers: {} }, res);

    expect(res.statusCode).toBe(500);
    expectTrustedNotify(seen, {
      type: 'maintenance',
      source: 'cron/maintenance',
      title: 'Daily maintenance failed',
    });
  });

  test('site 20 - secret-check expiration alert enters notification-email context', async () => {
    const seen = watchNotifyEntry();
    jest.spyOn(MaintenanceService, 'startRun').mockResolvedValue('run-1');
    jest.spyOn(MaintenanceService, 'completeRun').mockResolvedValue(undefined);
    mockListSettings.mockImplementation(async (prefix) => (
      prefix === 'secret_expiration:'
        ? { 'secret_expiration:test_secret': '2020-01-01' }
        : {}
    ));
    const res = makeRes();

    await secretCheckHandler({ method: 'GET', headers: {} }, res);

    expect(res.body.ok).toBe(true);
    expectTrustedNotify(seen, { type: 'secret_expiration', source: 'cron/secret-check' });
  });

  test('site 21 - intake attach infected alert enters notification-email context', async () => {
    const seen = watchNotifyEntry();
    mockGetServerSession.mockResolvedValue({
      user: {
        userType: 'applicant',
        contactOid: 'oid-1',
        contactEmail: 'applicant@example.com',
        contactName: 'Applicant One',
      },
    });
    mockIntakeDraftService.getById.mockResolvedValue({
      id: 9,
      contact_oid: 'oid-1',
      account_id: 'account-1',
      form_key: 'form-1',
      request_id: null,
      attachments: [],
      pending_attachments: [{
        attachmentId: '11111111-1111-4111-8111-111111111111',
        fieldKey: 'upload',
        pathname: 'private/path.pdf',
        filename: 'bad.pdf',
        contentType: 'application/pdf',
        maxBytes: 1024,
      }],
    });
    mockBlobGet.mockResolvedValue({ stream: new Response(PDF_BYTES).body });
    mockScanBytes.mockResolvedValue({
      scan_result: 'infected',
      foundViruses: [{ virusName: 'EICAR-Test-File' }],
      detectedThreats: ['EICAR'],
      verifiedFileFormat: 'pdf',
      scannedAt: '2026-01-01T00:00:00.000Z',
      scanner: 'cloudmersive',
    });
    const res = makeRes();

    await attachHandler({
      method: 'POST',
      headers: {},
      body: {
        draftId: 9,
        attachmentId: '11111111-1111-4111-8111-111111111111',
      },
    }, res);

    expect(res.statusCode).toBe(422);
    expectTrustedNotify(seen, { type: 'virus_detection_intake', source: 'intake-attach' });
  });
});

describe('notification trust-model Stage 2 pushed-up wrappers', () => {
  test('site 10 - bill onboard route service alerts inherit bill-onboard-reviewer context', async () => {
    const seen = watchNotifyEntry();
    process.env.BILL_INTEGRATION_SECRET = 'x'.repeat(32);
    mockValidateOnboardInput.mockReturnValue(null);
    mockOnboardReviewer.mockImplementation(async () => {
      await NotificationService.notify({
        type: 'bill_ambiguous_match',
        severity: 'warning',
        emailAdmins: true,
        title: 'BILL network search returned multiple matches for Reviewer',
        message: 'Ops needs to confirm which BILL Network member this reviewer maps to.',
        metadata: { honorariumRequestId: HONORARIUM_REQUEST_ID, reviewerContactId: CONTACT_ID },
        source: 'bill/onboard-reviewer',
        category: 'spend',
      });
      return { ok: true, status: 'ambiguous_match' };
    });
    const res = makeRes();

    await billOnboardHandler(makeRawReq({
      honorariumRequestId: HONORARIUM_REQUEST_ID,
      reviewerContactId: CONTACT_ID,
      reviewerName: 'Reviewer One',
      reviewerEmail: 'reviewer@example.com',
      address: { line1: '1 Main', city: 'Los Angeles', zipOrPostalCode: '90000', country: 'US' },
    }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, status: 'ambiguous_match' });
    expectTrustedNotify(seen, { type: 'bill_ambiguous_match', source: 'bill/onboard-reviewer' });
  });

  test('site 10b - reviewer acceptance drain onboard alert inherits cron-drain-reviewer-acceptances context', async () => {
    const seen = watchNotifyEntry();
    const onboard = jest.fn(async () => {
      await NotificationService.notify({
        type: 'bill_ambiguous_match',
        severity: 'warning',
        emailAdmins: true,
        title: 'BILL network search returned multiple matches for Reviewer',
        message: 'Ops needs to confirm which BILL Network member this reviewer maps to.',
        metadata: { honorariumRequestId: HONORARIUM_REQUEST_ID, reviewerContactId: CONTACT_ID },
        source: 'bill/onboard-reviewer',
        category: 'spend',
      });
      return { ok: true, status: 'ambiguous_match' };
    });
    const ensureHonorarium = jest.fn((args) => ensureHonorariumOnboarding(args, {
      contacts: { updateFields: jest.fn().mockResolvedValue(undefined) },
      onboard,
      backProp: jest.fn().mockResolvedValue(undefined),
      isDeferred: () => false,
    }));
    const deps = makeAcceptanceDrainDeps({
      ensureHonorarium,
      sendAcceptanceEmail: jest.fn().mockResolvedValue({ sent: true }),
    });

    await expect(withDalContext('cron-drain-reviewer-acceptances', () =>
      processReviewerAcceptanceJob(makeAcceptanceJob({ isAcceptRepeat: true }), deps),
    )).resolves.toMatchObject({ status: 'completed' });

    expect(onboard).toHaveBeenCalledTimes(1);
    expectTrustedNotify(seen, { type: 'bill_ambiguous_match', source: 'bill/onboard-reviewer' });
  });

  test('site 11 - manual review reminder default alert inherits review-manager-send-review-reminder context', async () => {
    // Form A: drive the real route handler (requireAppAccess mocked) so its own
    // withDalContext is what establishes context.
    const seen = watchNotifyEntry();
    mockBlankEmailDefault((key) => key === 'email.reviewer_reminder_review_due.subject');

    const res = makeRes();
    await sendReviewReminderHandler(
      { method: 'POST', headers: {}, body: { requestId: REQUEST_ID, suggestionId: SUGGESTION_ID } },
      res,
    );

    expect(res.body).toMatchObject({ ok: false, reason: 'misconfigured' });
    expectTrustedNotify(seen, {
      type: 'email_default_misconfigured',
      source: 'reviewer-reminders-review-due-manual',
    });
  });

  test('site 11 - review thank-you default alert inherits cron-review-thankyous context', async () => {
    // Form A: drive the real cron handler so its own withDalContext is what's tested.
    const seen = watchNotifyEntry();
    jest.spyOn(MaintenanceService, 'startRun').mockResolvedValue('run-1');
    jest.spyOn(MaintenanceService, 'completeRun').mockResolvedValue(undefined);
    mockBlankEmailDefault((key) => key === 'email.reviewer_thankyou.subject');
    mockReviewerSuggestionAdapter.queryAllSuggestions.mockResolvedValue({
      records: [{
        wmkf_appreviewersuggestionid: SUGGESTION_ID,
        _wmkf_potentialreviewer_value: REVIEWER_ID,
        _wmkf_request_value: REQUEST_ID,
      }],
    });

    const res = makeRes();
    await reviewThankyousHandler({ method: 'GET', headers: {}, query: { maxBatch: '1' } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ scanned: 1, skippedMisconfigured: 1 });
    expectTrustedNotify(seen, {
      type: 'email_default_misconfigured',
      source: 'reviewer-thankyous',
    });
  });

  test('site 11 - reviewer reminder default alerts inherit cron-reviewer-reminders context', async () => {
    // Form A: drive the real cron handler so its own withDalContext is what's tested.
    const seen = watchNotifyEntry();
    jest.spyOn(MaintenanceService, 'startRun').mockResolvedValue('run-1');
    jest.spyOn(MaintenanceService, 'completeRun').mockResolvedValue(undefined);
    mockBlankEmailDefault((key) => (
      key === 'email.reviewer_reminder_respond_by.subject'
      || key === 'email.reviewer_reminder_review_due.subject'
    ));

    const res = makeRes();
    await reviewerRemindersHandler({ method: 'GET', headers: {}, query: { maxBatch: '1' } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      respond: expect.objectContaining({ scanned: 0 }),
      reviewDue: expect.objectContaining({ scanned: 0 }),
    });
    expectTrustedNotify(seen, {
      type: 'email_default_misconfigured',
      source: 'reviewer-reminders-respond-by',
    });
    expectTrustedNotify(seen, {
      type: 'email_default_misconfigured',
      source: 'reviewer-reminders-review-due',
    });
  });

  test('site 11 - withdraw-sufficient default alert inherits review-manager-withdraw-sufficient context', async () => {
    // Form A: drive the real route handler (requireAppAccess mocked).
    const seen = watchNotifyEntry();
    mockBlankEmailDefault((key) => key === 'email.reviewer_withdraw.subject');

    const res = makeRes();
    await withdrawSufficientHandler(
      { method: 'POST', headers: {}, body: { requestId: REQUEST_ID, suggestionIds: [SUGGESTION_ID] } },
      res,
    );

    expect(res.body).toMatchObject({
      ok: true,
      withdrawn: 1,
      results: [{ suggestionId: SUGGESTION_ID, status: 'withdrawn_email_skipped' }],
    });

    expectTrustedNotify(seen, {
      type: 'email_default_misconfigured',
      source: 'review-manager/withdraw-sufficient',
    });
  });

  test('site 11 - acceptance confirmation default alert inherits cron-drain-reviewer-acceptances context', async () => {
    const seen = watchNotifyEntry();
    mockBlankEmailDefault((key) => key === 'email.reviewer_acceptance.subject');
    const deps = makeAcceptanceDrainDeps();

    await expect(withDalContext('cron-drain-reviewer-acceptances', () =>
      processReviewerAcceptanceJob(makeAcceptanceJob({ isAcceptRepeat: false }), deps),
    )).resolves.toMatchObject({ status: 'completed' });

    expectTrustedNotify(seen, {
      type: 'email_default_misconfigured',
      source: 'external/review/respond:acceptance-confirmation',
    });
  });

  test('sites 10b, 13, and 11-acceptance - drain cron handler establishes cron-drain-reviewer-acceptances context', async () => {
    let trustedAtDrain = null;
    mockDrainReviewerAcceptanceJobs.mockImplementation(async () => {
      trustedAtDrain = hasTrustedDalContext();
      return {
        claimed: 0,
        jobIds: [],
        completed: 0,
        completedJobIds: [],
        cancelled: 0,
        cancelledJobIds: [],
        failed: 0,
        failedJobIds: [],
        retried: 0,
        retriedJobIds: [],
        leaseLost: 0,
        leaseLostJobIds: [],
        errors: [],
      };
    });
    jest.spyOn(MaintenanceService, 'startRun').mockResolvedValue('run-1');
    jest.spyOn(MaintenanceService, 'completeRun').mockResolvedValue(undefined);

    const res = makeRes();
    await drainHandler({ method: 'GET', headers: {}, query: {} }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, claimed: 0, completed: 0, failed: 0 });
    expect(mockDrainReviewerAcceptanceJobs).toHaveBeenCalledWith({ limit: 5, lockSeconds: 300 });
    expect(trustedAtDrain).toBe(true);
    expect(MaintenanceService.completeRun).toHaveBeenCalledWith('run-1', expect.objectContaining({
      status: 'completed',
      details: expect.objectContaining({
        completedJobIds: [],
        retriedJobIds: [],
        leaseLostJobIds: [],
      }),
    }));
  });

  test('drain cron persists a failed maintenance run when a claimed job loses its lease', async () => {
    mockDrainReviewerAcceptanceJobs.mockResolvedValue({
      claimed: 1,
      jobIds: [7],
      completed: 0,
      completedJobIds: [],
      cancelled: 0,
      cancelledJobIds: [],
      failed: 0,
      failedJobIds: [],
      retried: 0,
      retriedJobIds: [],
      leaseLost: 1,
      leaseLostJobIds: [7],
      errors: [{ jobId: 7, code: 'reviewer_acceptance_lease_lost' }],
    });
    jest.spyOn(MaintenanceService, 'startRun').mockResolvedValue('run-lease-lost');
    jest.spyOn(MaintenanceService, 'completeRun').mockResolvedValue(undefined);

    const res = makeRes();
    await drainHandler({ method: 'GET', headers: {}, query: {} }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, completed: 0, leaseLost: 1 });
    expect(MaintenanceService.completeRun).toHaveBeenCalledWith(
      'run-lease-lost',
      expect.objectContaining({
        status: 'failed',
        errorMessage: '0 reviewer acceptance job(s) failed; 1 lease(s) lost',
        details: expect.objectContaining({
          completedJobIds: [],
          leaseLostJobIds: [7],
        }),
      }),
    );
  });

  test('site 11 - grantee deliverable reminder default alert inherits grantee-deliverable-reminders-cron context', async () => {
    // Form A: drive the REAL cron handler so the wrap it establishes is what
    // provides the context — this guards the handler's own withDalContext, not
    // just service context-propagation (Stage 3 precondition).
    const seen = watchNotifyEntry();
    mockUnavailableEmailDefault((key) => key === 'email.grantee_reminder.body');

    const res = makeRes();
    await granteeRemindersHandler({ method: 'GET', headers: {}, query: {} }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ scanned: 1, skippedMisconfigured: 1 });
    expectTrustedNotify(seen, {
      type: 'email_default_misconfigured',
      source: 'grantee-deliverable-reminders',
    });
  });
});

describe('notification trust-model already-covered characterization sites', () => {
  test('site 12 - review-upload detection alerts inherit existing caller upload contexts', async () => {
    const seen = watchNotifyEntry();
    mockScanBytes.mockResolvedValue({
      scan_result: 'infected',
      foundViruses: [{ virusName: 'EICAR-Test-File' }],
      scannedAt: '2026-01-01T00:00:00.000Z',
      scanner: 'cloudmersive',
    });

    const args = {
      suggestionId: SUGGESTION_ID,
      files: [{ filename: 'bad.pdf', buffer: PDF_BYTES }],
      structuredData: {},
      opts: { source: 'staff_upload', performedBy: 'profile-1' },
    };
    await expect(withDalContext('review-manager-upload', () => writeReviewFiles(args)))
      .resolves.toMatchObject({ ok: false, reason: 'infected' });
    expectTrustedNotify(seen, { type: 'virus_detection_reviewer', source: 'review-upload' });

    seen.length = 0;
    await expect(withDalContext('external-upload', () =>
      writeReviewFiles({ ...args, opts: { source: 'reviewer_self_token', performedBy: null } }),
    )).resolves.toMatchObject({ ok: false, reason: 'infected' });
    expectTrustedNotify(seen, { type: 'virus_detection_reviewer', source: 'review-upload' });
  });

  test('site 12 - upload handlers establish trusted context before writeReviewFiles', async () => {
    const seen = [];
    mockWriteReviewFiles.mockImplementation(async (args) => {
      seen.push({
        source: args.opts.source,
        suggestionId: args.suggestionId,
        trusted: hasTrustedDalContext(),
      });
      return {
        ok: true,
        folder: 'Reviews/Test',
        files: args.files.map((file) => ({ name: file.filename, size: file.buffer.length })),
      };
    });

    const staffRes = makeRes();
    await staffUploadHandler(
      makeMultipartReq({ fields: { suggestionId: SUGGESTION_ID } }),
      staffRes,
    );

    expect(staffRes.statusCode).toBe(200);
    expect(staffRes.body).toMatchObject({ ok: true, folder: 'Reviews/Test' });

    const externalRes = makeRes();
    await externalUploadHandler(
      makeMultipartReq({ query: { token: 'review-token' } }),
      externalRes,
    );

    expect(externalRes.statusCode).toBe(200);
    expect(externalRes.body).toMatchObject({ ok: true, folder: 'Reviews/Test' });
    expect(mockVerifySuggestionToken).toHaveBeenCalledWith('review-token');
    expect(mockRecordTokenOutcome).toHaveBeenCalledWith(expect.anything(), 'review-token', true);
    expect(seen).toEqual([
      { source: 'staff_upload', suggestionId: SUGGESTION_ID, trusted: true },
      { source: 'reviewer_self_token', suggestionId: SUGGESTION_ID, trusted: true },
    ]);
  });

  test('site 13 - reviewer acceptance drain alert inherits cron-drain-reviewer-acceptances context', async () => {
    const seen = watchNotifyEntry();
    const job = {
      id: 7,
      lease_token: 'lease-1',
      status: 'accepted',
      suggestion_id: SUGGESTION_ID,
      accepted_at: ACCEPTED_AT,
      payload: {
        acceptedAt: ACCEPTED_AT,
        isAcceptRepeat: true,
        suggestion: { wmkf_appreviewersuggestionid: SUGGESTION_ID },
        request: { akoya_requestid: REQUEST_ID, akoya_requestnum: '1001' },
        reviewer: { wmkf_potentialreviewersid: 'reviewer-1' },
        body: {},
      },
      steps: {},
    };
    const deps = {
      suggestions: {
        getForAcceptanceDrain: jest.fn().mockResolvedValue({
          wmkf_appreviewersuggestionid: SUGGESTION_ID,
          wmkf_accepted: true,
          wmkf_declined: false,
          wmkf_responsereceivedat: ACCEPTED_AT,
        }),
      },
      jobs: {
        cancelReviewerAcceptanceJob: jest.fn(),
        completeReviewerAcceptanceJob: jest.fn(),
        mergeReviewerAcceptanceJobStep: jest.fn(),
      },
      potentialReviewers: { getById: jest.fn().mockResolvedValue({ wmkf_potentialreviewersid: 'reviewer-1' }) },
      ensureHonorarium: jest.fn().mockRejectedValue(new Error('honorarium failed')),
      captureOrcid: jest.fn().mockResolvedValue(undefined),
      captureIdentity: jest.fn().mockResolvedValue(undefined),
      syncNameTitle: jest.fn().mockResolvedValue(undefined),
      alertEmail: jest.fn().mockResolvedValue(undefined),
      alertAffiliation: jest.fn().mockResolvedValue(undefined),
      sendAcceptanceEmail: jest.fn().mockResolvedValue(undefined),
      quota: jest.fn().mockResolvedValue(undefined),
    };

    await expect(withDalContext('cron-drain-reviewer-acceptances', () =>
      processReviewerAcceptanceJob(job, deps),
    )).rejects.toThrow(/honorarium_onboarding_retry_required/);

    expectTrustedNotify(seen, { type: 'honorarium_onboard_failed', source: 'reviewer-acceptance-drain' });
  });

  test('site 22 - maintenance _safeBillAlert inherits bill-onboarding-resume context', async () => {
    const seen = watchNotifyEntry();
    mockOnboardingState.listPending.mockResolvedValue([{
      honorarium_request_id: 'hon-1',
      pending_match: true,
      pending_pni: 'PNI1',
    }]);
    mockOptionSetValues.assertOptionSetValuesConfigured.mockImplementation(() => {
      throw new Error('option values missing');
    });

    await expect(withDalContext('bill-onboarding-resume', () =>
      MaintenanceService.sweepBillOnboarding({ limit: 1 }),
    )).resolves.toMatchObject({ scanned: 1, errors: 1 });

    expectTrustedNotify(seen, { type: 'bill_resume_misconfigured', source: 'bill/onboarding-resume' });
  });

  test('site 22 - maintenance handler establishes bill-onboarding-resume context before sweepBillOnboarding', async () => {
    mockDefaultMaintenanceRun();
    let trustedAtSweep = null;
    MaintenanceService.sweepBillOnboarding.mockImplementation(async () => {
      trustedAtSweep = hasTrustedDalContext();
      return { resumed: 0, scanned: 0, errors: 0 };
    });

    const res = makeRes();
    await maintenanceHandler({ method: 'GET', headers: {}, query: {} }, res);

    expect(res.body.results.billOnboardingResume).toEqual({ resumed: 0, scanned: 0, errors: 0 });
    expect(MaintenanceService.sweepBillOnboarding).toHaveBeenCalledTimes(1);
    expect(trustedAtSweep).toBe(true);
  });
});
