/**
 * @jest-environment node
 *
 * The reviewer-email copy migration is the only supported way to push seed copy
 * onto the live settings (seeds are init data, not a runtime fallback). These
 * cover the plan classification and the write gate.
 */

const {
  planReviewerCopyMigration,
  executeReviewerCopyMigration,
  REVIEWER_BODY_TARGETS,
} = require('../../scripts/migrate-reviewer-email-copy.mjs');
const { spawnSync } = require('child_process');
const path = require('path');
const { pathToFileURL } = require('url');

const TARGETS = [
  { key: 'email.reviewer_withdraw.body', desired: 'NEW WITHDRAW' },
  { key: 'email.reviewer_acceptance.body', desired: 'NEW ACCEPT' },
];

function reader(map) {
  return jest.fn(async (key) => (
    Object.prototype.hasOwnProperty.call(map, key)
      ? { found: true, value: map[key] }
      : { found: false }
  ));
}

describe('planReviewerCopyMigration', () => {
  test('classifies changed, unchanged, and missing rows', async () => {
    const plan = await planReviewerCopyMigration({
      getSettingStrict: reader({
        'email.reviewer_withdraw.body': 'OLD WITHDRAW',
        'email.reviewer_acceptance.body': 'NEW ACCEPT',
      }),
      targets: TARGETS,
    });
    expect(plan.map((r) => r.status)).toEqual(['change', 'no-change']);
    expect(plan[0].before).toBe('OLD WITHDRAW');
  });

  test('a blank live row is reported missing, never silently populated', async () => {
    const plan = await planReviewerCopyMigration({
      getSettingStrict: reader({ 'email.reviewer_withdraw.body': '   ' }),
      targets: [TARGETS[0]],
    });
    expect(plan[0].status).toBe('missing');
  });

  test('an unset live row is reported missing', async () => {
    const plan = await planReviewerCopyMigration({
      getSettingStrict: reader({}),
      targets: [TARGETS[0]],
    });
    expect(plan[0].status).toBe('missing');
  });

  test('a read failure is captured, not thrown', async () => {
    const plan = await planReviewerCopyMigration({
      getSettingStrict: jest.fn(async () => { throw new Error('dataverse down'); }),
      targets: [TARGETS[0]],
    });
    expect(plan[0].status).toBe('error');
    expect(plan[0].error).toContain('dataverse down');
  });

  test('the real target list covers the four reviewer bodies with non-empty copy', () => {
    expect(REVIEWER_BODY_TARGETS.map((t) => t.key)).toEqual([
      'email.reviewer_withdraw.body',
      'email.reviewer_acceptance.body',
      'email.reviewer_reminder_respond_by.body',
      'email.reviewer_reminder_review_due.body',
    ]);
    for (const target of REVIEWER_BODY_TARGETS) {
      expect(target.desired.trim().length).toBeGreaterThan(0);
      expect(target.desired).toContain('{{greeting}}');
    }
  });

  test('no body hard-codes a closing line — renderers compose one conditionally', () => {
    // reviewer-email-closing preserves a signature that opens with a valediction
    // and prepends a default only to bare-name/fallback blocks. The four live
    // bodies therefore leave the closing out of the stored template.
    const CLOSING = /(thank you|with appreciation|with gratitude|sincerely|best regards|regards|warmly)\s*,?\s*$/i;
    for (const target of REVIEWER_BODY_TARGETS) {
      const beforeSignature = target.desired.split('{{signature}}')[0].trimEnd();
      expect({ key: target.key, tail: beforeSignature.slice(-40) })
        .toEqual({ key: target.key, tail: expect.not.stringMatching(CLOSING) });
    }
  });

  test('the withdraw target carries the corrected copy', () => {
    const withdraw = REVIEWER_BODY_TARGETS.find((t) => t.key === 'email.reviewer_withdraw.body');
    expect(withdraw.desired).toContain('Thank you for considering our request to review');
    expect(withdraw.desired).toContain('a full slate of reviewers');
    expect(withdraw.desired).not.toContain('willingness to review');
  });
});

describe('executeReviewerCopyMigration', () => {
  const safePlan = [
    { key: 'a', status: 'change', desired: 'A' },
    { key: 'b', status: 'no-change', desired: 'B' },
    { key: 'c', status: 'missing', desired: 'C' },
  ];
  const planWithError = [
    ...safePlan,
    { key: 'd', status: 'error', desired: 'D' },
  ];

  test('dry run writes nothing', async () => {
    const setSetting = jest.fn();
    const result = await executeReviewerCopyMigration({ setSetting, plan: planWithError, dryRun: true });
    expect(setSetting).not.toHaveBeenCalled();
    expect(result).toEqual({ updated: 0, failed: 0 });
  });

  test('execute writes ONLY change rows when every read succeeded', async () => {
    const setSetting = jest.fn(async () => true);
    const result = await executeReviewerCopyMigration({
      setSetting, plan: safePlan, dryRun: false, logger: { log: () => {}, error: () => {} },
    });
    expect(setSetting).toHaveBeenCalledTimes(1);
    expect(setSetting).toHaveBeenCalledWith('a', 'A', null);
    expect(result).toEqual({ updated: 0 + 1, failed: 0 });
  });

  test('a rejected write is counted as failed, not reported as updated', async () => {
    const setSetting = jest.fn(async () => false);
    const result = await executeReviewerCopyMigration({
      setSetting, plan: safePlan, dryRun: false, logger: { log: () => {}, error: () => {} },
    });
    expect(result).toEqual({ updated: 0, failed: 1 });
  });

  test('execute without a setSetting implementation refuses rather than no-oping', async () => {
    await expect(
      executeReviewerCopyMigration({ setSetting: undefined, plan: safePlan, dryRun: false }),
    ).rejects.toThrow('setSetting is required');
  });

  test('execute aborts an error-bearing plan before the first write', async () => {
    const setSetting = jest.fn(async () => true);
    await expect(executeReviewerCopyMigration({
      setSetting,
      plan: planWithError,
      dryRun: false,
    })).rejects.toThrow('setting read failed');
    expect(setSetting).not.toHaveBeenCalled();
  });

  test('re-running against already-migrated settings writes nothing', async () => {
    const migrated = await planReviewerCopyMigration({
      getSettingStrict: reader({
        'email.reviewer_withdraw.body': 'NEW WITHDRAW',
        'email.reviewer_acceptance.body': 'NEW ACCEPT',
      }),
      targets: TARGETS,
    });
    const setSetting = jest.fn(async () => true);
    const result = await executeReviewerCopyMigration({
      setSetting, plan: migrated, dryRun: false, logger: { log: () => {}, error: () => {} },
    });
    expect(setSetting).not.toHaveBeenCalled();
    expect(result.updated).toBe(0);
  });
});

test('CLI main exits nonzero and makes no writes for a mixed change+error plan', () => {
  const moduleUrl = pathToFileURL(path.resolve(__dirname, '../../scripts/migrate-reviewer-email-copy.mjs')).href;
  const childScript = `
    const { main } = await import(${JSON.stringify(moduleUrl)});
    const getSettingStrict = async (key) => {
      if (key === 'email.reviewer_acceptance.body') throw new Error('simulated read failure');
      return { found: true, value: 'OLD COPY' };
    };
    const setSetting = async () => {
      console.log('WRITE_WAS_ATTEMPTED');
      return true;
    };
    await main({ execute: true, getSettingStrict, setSetting, loadEnvironment: false });
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', childScript], {
    cwd: path.resolve(__dirname, '../..'),
    encoding: 'utf8',
  });

  expect(result.status).toBe(1);
  expect(result.stdout).not.toContain('WRITE_WAS_ATTEMPTED');
  expect(result.stderr).not.toContain('WRITE_WAS_ATTEMPTED');
  expect(`${result.stdout}\n${result.stderr}`).toContain('ABORTED: 1 setting read failed');
});
