const { enableAudit } = require('../../scripts/provision-expertise-roster.cjs');

describe('roster metadata auditing', () => {
  test('uses replacement PUT without losing existing metadata or localized labels', async () => {
    const definition = {
      '@odata.context': 'metadata', '@odata.type': '#Microsoft.Dynamics.CRM.StringAttributeMetadata',
      LogicalName: 'wmkf_name', MaxLength: 255,
      DisplayName: { LocalizedLabels: [{ LanguageCode: 1033, Label: 'Name' }] },
      IsAuditEnabled: { Value: false, CanBeChanged: true, ManagedPropertyLogicalName: 'canmodifyauditsettings' },
    };
    const client = { get: jest.fn().mockResolvedValue({ ok: true, body: definition }), raw: jest.fn().mockResolvedValue({ ok: true }) };
    await enableAudit(client, '/metadata');
    const [method, path, body, headers] = client.raw.mock.calls[0];
    expect(method).toBe('PUT'); expect(path).toBe('/metadata');
    expect(body).toEqual({ ...definition, '@odata.context': undefined, IsAuditEnabled: { ...definition.IsAuditEnabled, Value: true } });
    expect(headers['MSCRM.MergeLabels']).toBe('true');
    expect(definition.IsAuditEnabled.Value).toBe(false);
  });
  test.each([true, false])('does not rewrite enabled or locked metadata (%s)', async enabled => {
    const client = { get: jest.fn().mockResolvedValue({ ok: true, body: { IsAuditEnabled: { Value: enabled, CanBeChanged: false } } }), raw: jest.fn() };
    if (enabled) await enableAudit(client, '/metadata');
    else await expect(enableAudit(client, '/metadata')).rejects.toThrow('locked');
    expect(client.raw).not.toHaveBeenCalled();
  });
});
