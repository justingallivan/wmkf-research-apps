const deleteFile = jest.fn();

jest.mock('../../lib/services/graph-service', () => ({
  GraphService: {
    deleteFile: (...args) => deleteFile(...args),
  },
}));

let cleanupSharePointItems;
let cleanupSharePointItemsDetailed;

beforeAll(async () => {
  const mod = await import('../../lib/services/sharepoint-cleanup');
  cleanupSharePointItems = mod.cleanupSharePointItems;
  cleanupSharePointItemsDetailed = mod.cleanupSharePointItemsDetailed;
});

beforeEach(() => {
  jest.clearAllMocks();
  deleteFile.mockResolvedValue(undefined);
});

test('detailed cleanup attributes each successful and failed Graph item', async () => {
  deleteFile
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error('Graph 503'));

  const result = await cleanupSharePointItemsDetailed(
    'drive-1',
    [
      { id: 'sp-1', name: 'deleted.pdf' },
      { id: 'sp-2', name: 'failed.pdf' },
    ],
    'test-cleanup',
  );

  expect(result).toEqual({
    deleted: [{ id: 'sp-1', name: 'deleted.pdf' }],
    failed: [{ id: 'sp-2', name: 'failed.pdf', error: 'Graph 503' }],
  });
});

test('boolean compatibility helper remains true only when every delete succeeds', async () => {
  await expect(cleanupSharePointItems(
    'drive-1',
    [{ id: 'sp-1', name: 'deleted.pdf' }],
  )).resolves.toBe(true);

  deleteFile.mockRejectedValueOnce(new Error('Graph 503'));
  await expect(cleanupSharePointItems(
    'drive-1',
    [{ id: 'sp-2', name: 'failed.pdf' }],
  )).resolves.toBe(false);
});
