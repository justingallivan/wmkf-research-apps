/** @jest-environment node */
import { execFileSync } from 'node:child_process';

test('real shared loader extracts a compressed synthetic PDF from a Node Buffer', () => {
  // Use the actual dependency graph: mocking the parser or Blob/Graph imports
  // hides the Buffer-specific PDF.js failure seen during Sandbox preflight.
  const output = execFileSync(process.execPath, ['--no-warnings', '-e', `
    const { registerHooks } = require('node:module');
    registerHooks({resolve(s,c,next){try{return next(s,c);}catch(e){
      if(s.startsWith('.')&&!/\\.[a-z]+$/i.test(s))return next(s+'.js',c);throw e;
    }}});
    const { extractTextFromBuffer } = require('./lib/utils/file-loader.js');
    const bytes = require('node:fs').readFileSync('tests/fixtures/summary-narrative.synthetic.pdf');
    extractTextFromBuffer(bytes,'narrative.pdf','application/pdf').then(text=>{
      if(!text.includes('low-intensity pulsed illumination')||!text.includes('three independently prepared batches'))process.exit(2);
      console.log('extraction-verified');
    }).catch(()=>process.exit(3));
  `], { cwd: process.cwd(), encoding: 'utf8', timeout: 15000 });
  expect(output).toContain('extraction-verified');
});
