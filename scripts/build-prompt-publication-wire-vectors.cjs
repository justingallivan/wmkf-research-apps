#!/usr/bin/env node
/** Deterministic JS-oracle structural vectors; no policy mutation or live IO. */
const fs=require('node:fs'),path=require('node:path');
const wire=require('../lib/prompt-publication/publication-contract');
const golden=require('../tests/fixtures/prompt-publication/fingerprints-v1.json');
const clone=v=>JSON.parse(JSON.stringify(v));
const vectors=[];
const add=(kind,value,label)=>vectors.push({kind,label,json:JSON.stringify(value),valid:wire[kind==='request'?'validateRequest':'validateReceipt'](value).valid});
for(const v of golden.requests){add('request',v.input,'golden');for(const field of Object.keys(v.input))for(const bad of [null,{},[],true,17,'wrong']){const r=clone(v.input);r[field]=bad;add('request',r,field+' malformed');}for(const field of Object.keys(v.input)){const r=clone(v.input);delete r[field];add('request',r,field+' missing');}add('request',{...v.input,force:true},'unknown bypass');}
add('receipt',golden.receipt,'historical receipt');
for(const field of Object.keys(golden.receipt))for(const bad of [null,{},[],true,17,'wrong']){const r=clone(golden.receipt);r[field]=bad;add('receipt',r,field+' malformed');}
for(const pathParts of [['metadataBaseline','current'],['metadataBaseline','catalog'],['metadataBaseline','headRevision'],['expectedCurrent','etag'],['expectedCurrent','version'],['expectedCurrent','id']]){const r=clone(golden.requests[1].input);let p=r;for(const k of pathParts.slice(0,-1))p=p[k];p[pathParts.at(-1)]='wrong';add('request',r,pathParts.join('.')+' malformed');}
for(const year of ['0000','2026','1900','2000'])for(const day of ['02-28','02-29','02-30']){const r=clone(golden.receipt);r.publishedAt=year+'-'+day+'T00:00:00.000Z';add('receipt',r,'calendar '+year+' '+day);}
for(const char of ['\u0085','\u2028','\u2029','é','界']){const r=clone(golden.requests[1].input);r.metadataBaseline.catalog.description=char.repeat(3990);add('request',r,'baseline Unicode '+char.charCodeAt(0));}
const output=JSON.stringify({version:1,vectors},null,2)+'\n';const target=path.resolve(__dirname,'../tests/fixtures/prompt-publication/wire-sdk-v1.json');
if(process.argv[2]==='--check'){if(fs.readFileSync(target,'utf8')!==output)throw new Error('Wire SDK vectors drift');console.log('Wire SDK vectors match JS.');}else if(process.argv.length===2){fs.writeFileSync(target,output);}else throw new Error('Only --check supported');
