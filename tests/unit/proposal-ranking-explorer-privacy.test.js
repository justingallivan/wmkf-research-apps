import {
  filterProposalRankingSearchEntities,
  isProposalRankingPrivateEntity,
  proposalRankingPrivacyError,
  resolveProposalRankingPrivacyError,
} from '../../lib/services/dynamics-explorer/proposal-ranking-privacy.js';
import { DynamicsService } from '../../lib/services/dynamics-service.js';
import * as metadataAdapter from '../../lib/dataverse/adapters/metadata.js';
import { executeTool } from '../../lib/services/dynamics-explorer/tool-executor.js';
import { exportCsv } from '../../lib/services/dynamics-explorer/tools/export.js';

jest.mock('../../lib/services/dynamics-service.js', () => ({
  DynamicsService: {
    getEntityDefinitions: jest.fn(),
    resolveEntitySetName: jest.fn(),
    queryRecords: jest.fn(),
    countRecords: jest.fn(),
    aggregateRecords: jest.fn(),
    queryAllRecords: jest.fn(),
  },
}));
jest.mock('../../lib/dataverse/adapters/metadata.js', () => ({ getMetadataBatch: jest.fn() }));

const entityDefinitions = [
  { logicalName: 'akoya_request', entitySetName: 'akoya_requests' },
  { logicalName: 'systemuser', entitySetName: 'systemusers' },
];

function metadataFor(entities) {
  return async (logicalName) => entities[logicalName] || { targets: new Map(), attributes: new Set() };
}

function configureDataverseMetadata() {
  DynamicsService.getEntityDefinitions.mockResolvedValue(entityDefinitions);
  metadataAdapter.getMetadataBatch.mockImplementation(async (paths) => {
    const logicalName = paths[0].match(/LogicalName='([^']+)'/)?.[1];
    if (logicalName === 'akoya_request') {
      return [
        { value: [{ LogicalName: 'akoya_requestid' }] },
        { value: [{ ReferencingEntity: 'akoya_request', ReferencedEntity: 'systemuser', ReferencingEntityNavigationPropertyName: 'publicAlias' }] },
        { value: [] },
        { value: [] },
      ];
    }
    if (logicalName === 'systemuser') {
      return [
        { value: [{ LogicalName: 'systemuserid' }] },
        { value: [] },
        { value: [{ ReferencingEntity: 'wmkf_proposalrankinground', ReferencedEntity: 'systemuser', ReferencedEntityNavigationPropertyName: 'x_auditrows' }] },
        { value: [] },
      ];
    }
    throw new Error(`Unexpected metadata entity: ${logicalName}`);
  });
}

describe('Proposal Ranking generic-reader privacy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('blocks every private table alias from generic table readers', () => {
    for (const table of [
      'wmkf_proposalrankingcycle', 'wmkf_proposalrankingcycles',
      'wmkf_proposalrankinground', 'wmkf_proposalrankingrounds',
      'wmkf_proposalrankinglist', 'wmkf_proposalrankinglists',
    ]) {
      expect(isProposalRankingPrivateEntity(table)).toBe(true);
      expect(proposalRankingPrivacyError({ table_name: table })).toMatch(/not available/);
    }
    expect(proposalRankingPrivacyError({ table_name: 'akoya_requests' })).toBeNull();
  });

  test('blocks private-name references and staff-directory reverse relationship expansion', () => {
    expect(proposalRankingPrivacyError({ table_name: 'akoya_requests', expand: 'wmkf_createdby_wmkf_proposalrankinground' }))
      .toMatch(/not available/);
    expect(proposalRankingPrivacyError({ table_name: 'systemusers', expand: 'createdby' }))
      .toMatch(/Staff-directory/);
    expect(proposalRankingPrivacyError({ table_name: 'systemusers', select: 'fullname,systemuserid' })).toBeNull();
  });

  test('resolves aliased nested reverse audit navigation to private targets', async () => {
    const entities = {
      akoya_request: {
        targets: new Map([['createdby', 'systemuser'], ['modifiedby', 'systemuser']]),
        attributes: new Set(['akoya_requestid']),
      },
      systemuser: {
        targets: new Map([['x_auditcreated', 'wmkf_proposalrankinground'], ['x_auditmodified', 'wmkf_proposalrankinglist']]),
        attributes: new Set(['fullname', 'systemuserid']),
      },
    };
    const dependencies = {
      getEntityDefinitions: async () => entityDefinitions,
      getEntityProperties: metadataFor(entities),
    };

    for (const expand of ['createdby($expand=x_auditcreated)', 'modifiedby($expand=x_auditmodified)']) {
      expect(expand).not.toMatch(/wmkf_proposalranking/i);
      await expect(resolveProposalRankingPrivacyError({ table_name: 'akoya_requests', expand }, dependencies))
        .resolves.toMatch(/not available/);
    }
  });

  test('resolves navigation paths in filters and rejects unknown relationship targets', async () => {
    const dependencies = {
      getEntityDefinitions: async () => entityDefinitions,
      getEntityProperties: metadataFor({
        akoya_request: {
          targets: new Map([['createdby', 'systemuser']]),
          attributes: new Set(['akoya_requestid']),
        },
        systemuser: {
          targets: new Map([['x_auditrows', 'wmkf_proposalrankinground']]),
          attributes: new Set(['fullname', 'systemuserid']),
        },
      }),
    };

    await expect(resolveProposalRankingPrivacyError({
      table_name: 'akoya_request',
      filter: "createdby/x_auditrows/any(row: row/statecode eq 0)",
    }, dependencies)).resolves.toMatch(/not available/);
    await expect(resolveProposalRankingPrivacyError({
      table_name: 'akoya_request',
      orderby: 'createdby/unknown_alias asc',
    }, dependencies)).resolves.toMatch(/not available/);
    for (const input of [
      { field: 'createdby/x_auditrows' },
      { group_by: 'createdby/x_auditrows' },
      { expand: 'createdby($expand=x_auditrows)' },
    ]) {
      await expect(resolveProposalRankingPrivacyError({ table_name: 'akoya_requests', ...input }, dependencies))
        .resolves.toMatch(/not available/);
    }
  });

  test('blocks the nested filter alias bypass and parses deeper semicolon options', async () => {
    const dependencies = {
      getEntityDefinitions: async () => entityDefinitions,
      getEntityProperties: metadataFor({
        akoya_request: { targets: new Map([['publicAlias', 'systemuser']]), attributes: new Set() },
        systemuser: { targets: new Map([['x_auditrows', 'wmkf_proposalrankinground'], ['team', 'account']]), attributes: new Set(['fullname']) },
        account: { targets: new Map([['x_auditrows', 'wmkf_proposalrankinground']]), attributes: new Set(['name']) },
      }),
    };

    for (const expand of [
      'publicAlias($filter=x_auditrows/any(r:r/statecode eq 0))',
      'publicAlias($select=fullname;$expand=team($select=fullname;$filter=x_auditrows/any(r:r/statecode eq 0)))',
      'publicAlias($orderby=x_auditrows/name asc)',
    ]) {
      await expect(resolveProposalRankingPrivacyError({ table_name: 'akoya_requests', expand }, dependencies))
        .resolves.toMatch(/not available/);
    }
  });

  test('guards query_records and export_csv before reading an aliased nested private target', async () => {
    configureDataverseMetadata();
    const input = {
      table_name: 'akoya_requests',
      expand: 'publicAlias($filter=x_auditrows/any(r:r/statecode eq 0))',
    };

    await expect(executeTool('query_records', input, jest.fn(), 1))
      .resolves.toMatchObject({ error: expect.stringMatching(/not available/) });
    expect(DynamicsService.queryRecords).not.toHaveBeenCalled();

    await expect(exportCsv(input, jest.fn(), 1))
      .resolves.toMatchObject({ error: expect.stringMatching(/not available/) });
    expect(DynamicsService.queryAllRecords).not.toHaveBeenCalled();
  });

  test('allows metadata-resolved public paths and fails closed when metadata is unavailable', async () => {
    const dependencies = {
      getEntityDefinitions: async () => entityDefinitions,
      getEntityProperties: metadataFor({
        akoya_request: {
          targets: new Map([['createdby', 'systemuser']]),
          attributes: new Set(['akoya_requestid']),
        },
        systemuser: {
          targets: new Map(),
          attributes: new Set(['fullname', 'systemuserid']),
        },
      }),
    };

    await expect(resolveProposalRankingPrivacyError({ table_name: 'akoya_requests', select: 'createdby/fullname' }, dependencies))
      .resolves.toBeNull();
    await expect(resolveProposalRankingPrivacyError({
      table_name: 'akoya_requests',
      expand: 'createdby',
    }, { getEntityDefinitions: async () => entityDefinitions, getEntityProperties: async () => { throw new Error('metadata unavailable'); } }))
      .resolves.toMatch(/not available/);
  });

  test('removes private table search targets while allowing generic indexed search', () => {
    expect(filterProposalRankingSearchEntities(['akoya_request', 'wmkf_proposalrankinground', 'wmkf_proposalrankinglists']))
      .toEqual(['akoya_request']);
    expect(filterProposalRankingSearchEntities(undefined)).toBeUndefined();
  });
});
