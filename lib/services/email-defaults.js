import { getSettingStrict } from './settings-service.js';
import NotificationService from './notification-service.js';

async function notifyMisconfiguredDefault({ key, reason, source, error }) {
  try {
    await NotificationService.notify({
      type: 'email_default_misconfigured',
      severity: 'error',
      title: 'Email default misconfigured',
      message: `Required email default "${key}" is ${reason}; the email was not sent so the workflow can recover after the default is fixed.`,
      metadata: {
        key,
        reason,
        error: error ? String(error.message || error).slice(0, 500) : undefined,
      },
      source,
      autoResolveKey: `email-default-misconfigured:${key}`,
      emailAdmins: true,
      category: 'ops',
    });
  } catch (notifyError) {
    console.error('[email-defaults] misconfiguration alert failed:', notifyError.message || notifyError);
  }
}

export async function readRequiredEmailDefaults(keys, { source = 'email-defaults' } = {}) {
  const values = {};
  const failures = [];

  for (const key of keys) {
    try {
      const result = await getSettingStrict(key);
      const value = result?.found ? String(result.value ?? '') : '';
      if (value.trim() === '') {
        failures.push({ key, reason: 'blank' });
        continue;
      }
      values[key] = value;
    } catch (error) {
      failures.push({ key, reason: 'unavailable', error });
    }
  }

  await Promise.all(failures.map((failure) =>
    notifyMisconfiguredDefault({ ...failure, source })
  ));

  return {
    ok: failures.length === 0,
    values,
    failures,
  };
}
