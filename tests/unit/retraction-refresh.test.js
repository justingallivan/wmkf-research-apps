/** @jest-environment node */
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { prepareCsv, downloadCsv, HEADERS } = require('../../lib/services/retraction-refresh-service');
const { readRetractionDataset, sameRetractionDataset } = require('../../lib/services/retraction-dataset');
const { integrityDatasetLabel } = require('../../shared/utils/integrity-evidence');
let dir;
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'retraction-fixture-')); });
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });
const row = (id='1', overrides={}) => ({ 'Record ID':id,Title:'Study, with\na quoted "title"',Author:'Smith, John; R A Example',Journal:'Journal',Publisher:'Publisher',Subject:'Subject',Institution:'Example University',Country:'USA',RetractionDate:'2/28/2020 0:00',OriginalPaperDOI:'10.1000/example',RetractionNature:'Correction',Reason:'Error; Image concern',URLS:'https://example.org/notice',...overrides });
const csv = (rows) => HEADERS.join(',')+'\n'+rows.map(r=>HEADERS.map(k=>'"'+(r[k]||'').replace(/"/g,'""')+'"').join(',')).join('\n')+'\n';
async function prepare(text) { const file=path.join(dir,'source.csv');await fs.writeFile(file,text);return prepareCsv(file,path.join(dir,'stage.tsv'),AbortSignal.timeout(5000)); }
test('CSV parser retains embedded newlines, quotes, commas, authors and exact checksum',async()=>{
 const text=csv([row()]);const result=await prepare(text);
 expect(result).toMatchObject({count:1,bytes:Buffer.byteLength(text),extraHeaders:[]});
 expect(result.checksum).toBe(require('node:crypto').createHash('sha256').update(text).digest('hex'));
 const stage=await fs.readFile(path.join(dir,'stage.tsv'),'utf8');
 expect(stage.trim().split('\n')).toHaveLength(1);
 expect(stage).toContain('john smith');expect(stage).toContain('Study, with\\na quoted "title"');
});
test.each([
 ['duplicate',()=>csv([row(),row()])],['empty',()=>HEADERS.join(',')+'\n'],
 ['missing author',()=>csv([row('1',{Author:''})])],['invalid date',()=>csv([row('1',{RetractionDate:'2/30/2020'})])],
 ['changed header',()=>csv([row()]).replace('Record ID','RecordIdentifier')],
 ['bad quoting',()=>csv([row()])+'"unterminated'],
])('rejects %s rather than skipping records',async(_n,text)=>{await expect(prepare(text())).rejects.toThrow();});
test('reports widths without truncation',async()=>{const r=await prepare(csv([row('1',{Publisher:'p'.repeat(500),Subject:'s'.repeat(263)})]));expect(r.maxLengths.Publisher).toBe(500);expect(r.maxLengths.Subject).toBe(263);});
test('redirect to another host is refused before it is requested',async()=>{
 const fetchImpl=jest.fn().mockResolvedValue({status:302,headers:new Headers({location:'https://evil.example/data'}),body:{cancel:jest.fn()}});
 await expect(downloadCsv(path.join(dir,'out'),AbortSignal.timeout(5000),fetchImpl)).rejects.toMatchObject({code:'unapproved_download_host'});
 expect(fetchImpl).toHaveBeenCalledTimes(1);
});
test('failed, oversized and incomplete download responses fail',async()=>{
 await expect(downloadCsv(path.join(dir,'out'),AbortSignal.timeout(5000),async()=>({ok:false,status:500}))).rejects.toThrow('retraction_download_failed');
 await expect(downloadCsv(path.join(dir,'out'),AbortSignal.timeout(5000),async()=>new Response('x',{headers:{'content-length':'999999999'}}))).rejects.toThrow('retraction_download_too_large');
 await expect(downloadCsv(path.join(dir,'out'),AbortSignal.timeout(5000),async()=>new Response('x',{headers:{'content-length':'20'}}))).rejects.toThrow('incomplete_retraction_download');
});
test('metadata distinguishes absent/unpublished/unverified; checked time is not generation',async()=>{
 const absent=await readRetractionDataset(async()=>({rows:[{relation:null}]}));expect(absent).toMatchObject({status:'unrecorded',state:'unmanaged'});
 const bad=await readRetractionDataset(async()=>{throw new Error('offline');});expect(sameRetractionDataset(bad,bad)).toBe(false);
 expect(sameRetractionDataset(absent,{status:'unrecorded',state:'unpublished'})).toBe(false);
 expect(sameRetractionDataset({},{})).toBe(false);
 expect(sameRetractionDataset(null,null)).toBe(false);
 expect(sameRetractionDataset({status:'new_unknown'},{status:'new_unknown'})).toBe(false);
 expect(sameRetractionDataset({status:'recorded'},{status:'recorded'})).toBe(false);
 const snapshot={status:'recorded',generation:'1',checksum:'a'.repeat(64),publishedAt:'2026-10-01T00:00:00.000Z',lastCheckedAt:'2026-11-01T00:00:00.000Z'};
 expect(sameRetractionDataset(snapshot,{...snapshot,lastCheckedAt:'2026-11-02T00:00:00.000Z'})).toBe(true);
 expect(sameRetractionDataset(snapshot,{...snapshot,generation:'3'})).toBe(false);
 expect(integrityDatasetLabel(snapshot,Date.parse('2026-11-02'))).not.toContain('warning');
 expect(integrityDatasetLabel(snapshot,Date.parse('2027-01-01'))).toContain('Freshness warning');
 expect(integrityDatasetLabel(null)).toBe('Dataset version not recorded.');
});
