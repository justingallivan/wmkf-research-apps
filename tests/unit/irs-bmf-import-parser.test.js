/**
 * @jest-environment node
 */

const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { Writable } = require('stream');
const { streamRegionIntoStaging } = require('../../lib/services/irs-bmf-service');

test('IRS BMF CSV streams into COPY text with valid rows and skips malformed rows', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'irs-bmf-parser-'));
  const csvPath = path.join(dir, 'region.csv');
  const csv = [
    '\uFEFFEIN,NAME,SUBSECTION,STATUS,STREET',
    '123456789,"Example, Inc.",03,01,"Main\\Street"',
    '111-22-3333,"Two\nLines",03,02,"Tabbed\tRoad"',
    'bad,Invalid EIN,03,01,Street',
    '987654321,Missing status,03,,Street',
    '555555555,Truncated',
  ].join('\n');
  let copyText = '';
  const client = {
    query: jest.fn(() => new Writable({
      write(chunk, _encoding, callback) {
        copyText += chunk.toString();
        callback();
      },
    })),
  };

  try {
    await fs.writeFile(csvPath, csv);
    const result = await streamRegionIntoStaging(client, '3', csvPath, '2026-09-24');
    expect(result).toMatchObject({ count: 2, skipped: 3 });
    expect(result.skippedSamples).toHaveLength(3);
    expect(client.query).toHaveBeenCalledTimes(1);
    const lines = copyText.trimEnd().split('\n').map((line) => line.split('\t'));
    expect(lines).toHaveLength(2);
    expect(lines.every((fields) => fields.length === 20)).toBe(true);
    expect(lines[0][0]).toBe('123456789');
    expect(lines[0][1]).toBe('Example, Inc.');
    expect(lines[0][3]).toBe('Main\\\\Street');
    expect(lines[1][0]).toBe('111223333');
    expect(lines[1][1]).toBe('Two\\nLines');
    expect(lines[1][3]).toBe('Tabbed\\tRoad');
    expect(lines.map((fields) => fields.slice(18))).toEqual([
      ['3', '2026-09-24'],
      ['3', '2026-09-24'],
    ]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
