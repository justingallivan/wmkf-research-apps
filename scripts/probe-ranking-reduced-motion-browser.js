/**
 * Pointer-drop regression using fictional data only.
 * Start `node scripts/rehearse-proposal-ranking-v2.js` first (port 3135).
 * Requires Playwright WebKit; --chrome uses installed Chrome.
 * Defaults to reduced motion; --no-reduced-motion checks normal animation.
 */
const assert = require('node:assert/strict');
const { chromium,webkit }=require('playwright');
(async()=>{
 const browser=await (!process.argv.includes('--chrome')?webkit.launch({headless:true}):chromium.launch({headless:true,channel:'chrome'}));
 try{
  const page=await browser.newPage({viewport:{width:1400,height:1100},reducedMotion:!process.argv.includes('--no-reduced-motion')?'reduce':'no-preference'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:3135');
  await page.getByRole('button',{name:'Load 23 proposals / 4 PDs'}).click();
  await page.getByRole('button',{name:'Start private preparation'}).click();
  await page.getByLabel('Delay saves by 2 seconds').check();
  const samples=[];
  for(let i=0;i<4;i++){
   const moving=page.getByRole('button',{name:'Move Example Institution 1, position '+(i%2?2:1),exact:true});
   await moving.scrollIntoViewIfNeeded();
   const source=await moving.boundingBox();
   const card=await page.locator('#proposal-example-1').locator('..').boundingBox();
   const other=await page.locator('#proposal-example-3').locator('..').boundingBox();
   await page.evaluate(expected=>{window.__drop=null;window.__rankTime=null;window.addEventListener('mouseup',()=>window.__drop=performance.now(),{once:true,capture:true}); const observer=new MutationObserver(()=>{if(window.__drop && document.querySelector('[aria-label="'+expected+'"]')){window.__rankTime=performance.now()-window.__drop;observer.disconnect()}});observer.observe(document.body,{subtree:true,attributes:true,childList:true});},'Move Example Institution 1, position '+(i%2?1:2));
   await page.mouse.move(source.x+source.width/2,source.y+source.height/2);await page.mouse.down();
   await page.mouse.move(source.x+source.width/2,source.y+source.height/2+8,{steps:3});
   await page.mouse.move(source.x+source.width/2,source.y+source.height/2+(other.y+other.height/2)-(card.y+card.height/2),{steps:20});
   // The drag sensor processes pointer movement on animation frames.
   await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
   await page.mouse.up();
   try { await page.getByRole('button',{name:'Move Example Institution 1, position '+(i%2?1:2),exact:true}).waitFor({timeout:10000}); }
   catch (error) {
    console.error(JSON.stringify(await page.evaluate(() => ({ drop: window.__drop, rankTime: window.__rankTime,
      status: [...document.querySelectorAll('[role=status]')].map(node => node.textContent),
      cardStyle: document.querySelector('#proposal-example-1')?.closest('li')?.getAttribute('style'),
      live: [...document.querySelectorAll('[aria-live]')].map(node => node.textContent) })), null, 2));
    throw error;
   }
   const rankMs=await page.evaluate(()=>window.__rankTime);
   const radio=page.locator('#proposal-example-1').getByRole('radio',{name:i%2?'Not sure':'Confident',exact:true});
   const clickStart=Date.now();await radio.click({timeout:10000});
   const checked=await radio.isChecked();
   const saving = await page.getByRole('status').filter({hasText:'Saving changes'}).count();
   assert.equal(checked,true); assert.equal(saving,1);
   assert.equal(typeof rankMs,'number');
   samples.push({rankMs,confidenceClickMs:Date.now()-clickStart,checked,saving});
   await page.getByRole('status').filter({hasText:'All changes saved'}).waitFor({timeout:15000});
  }
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({engine:!process.argv.includes('--chrome')?'webkit':'chrome',reducedMotion:!process.argv.includes('--no-reduced-motion'),samples,errors},null,2));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
