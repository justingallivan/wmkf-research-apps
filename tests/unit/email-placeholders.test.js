/** @jest-environment node */

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { applyPlaceholders } = require('../../lib/utils/email-placeholders.js');

describe('applyPlaceholders', () => {
  test.each([null, undefined, false, 0, ''])('falsy template %p becomes an empty string', (template) => {
    expect(applyPlaceholders(template, {})).toBe('');
  });

  test('nullish values become empty strings while false and zero are stringified', () => {
    expect(applyPlaceholders('a; b; c; d', {
      a: null,
      b: undefined,
      c: false,
      d: 0,
    })).toBe('; ; false; 0');
  });

  test('applies longer keys before shorter substring keys, regardless of insertion order', () => {
    expect(applyPlaceholders('ab a', { a: 'short', ab: 'long' })).toBe('long short');
  });

  test('keeps equal-length entry order and applies replacement chaining sequentially', () => {
    expect(applyPlaceholders('a', { a: 'b', b: 'done' })).toBe('done');
  });

  test('replaces all occurrences literally and leaves unknown placeholders unchanged', () => {
    expect(applyPlaceholders('x.x {{unknown}}', { x: '$&\\' })).toBe('$&\\.$&\\ {{unknown}}');
  });

  test('preserves empty-key split/join behavior and throws for a missing replacement map', () => {
    expect(applyPlaceholders('abc', { '': '-' })).toBe('a-b-c');
    expect(() => applyPlaceholders('abc', undefined)).toThrow(TypeError);
    expect(() => applyPlaceholders('abc', null)).toThrow(TypeError);
  });
});

test('plain Node imports the grantee module and renders through its helper dependency', () => {
  const granteeUrl = pathToFileURL(path.resolve(__dirname, '../../lib/external/grantee-invite-email.js')).href;
  const childSource = `
    const grantee = await import(${JSON.stringify(granteeUrl)});
    const body = grantee.buildGranteeReminderDraftBodyText({
      bodyTemplate: 'Reminder: {{proposalTitle}} / {{dueDate}}',
      piName: 'Ada Lovelace',
      title: 'Neural Study',
      invitedDate: '2026-06-08T00:00:00.000Z',
    });
    process.stdout.write(body);
    if (body !== 'Reminder: Neural Study / June 22, 2026') process.exitCode = 1;
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', childSource], {
    cwd: path.resolve(__dirname, '../..'),
    encoding: 'utf8',
    timeout: 10_000,
  });

  expect(result.status).toBe(0);
  expect(result.stdout).toBe('Reminder: Neural Study / June 22, 2026');
  expect(result.stderr).not.toContain('ERR_MODULE_NOT_FOUND');
});
