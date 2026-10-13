import fs from 'node:fs';
import path from 'node:path';

const schemaDirectory = path.join(process.cwd(), 'lib/dataverse/schema/wave32-proposal-ranking');
const rolePath = path.join(process.cwd(), 'lib/dataverse/schema/roles/proposal-ranking-app.json');

describe('Proposal Ranking Dataverse schema', () => {
  test('only ranking lists receive the Delete permission needed for dry-run erasure', () => {
    const role = JSON.parse(fs.readFileSync(rolePath, 'utf8'));
    expect(role.privileges.filter((item) => item.ops.includes('Delete')).map((item) => item.table)).toEqual(['wmkf_ProposalRankingList']);
  });

  test('application role privileges name the exact schema names of all private tables', () => {
    const schemas = fs.readdirSync(schemaDirectory)
      .filter((file) => file.endsWith('.json'))
      .map((file) => JSON.parse(fs.readFileSync(path.join(schemaDirectory, file), 'utf8')));
    const role = JSON.parse(fs.readFileSync(rolePath, 'utf8'));
    const roleTables = new Set(role.privileges.map((privilege) => privilege.table.toLowerCase()));
    for (const schema of schemas) expect(roleTables).toContain(schema.schemaName.toLowerCase());
  });
});
