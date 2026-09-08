const {chromium}=require('@playwright/test');
const path=require('path');
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1050}});
  await page.goto('file:///'+path.resolve('web/index.html').replaceAll('\\','/'));
  await page.waitForTimeout(2000);
  await page.screenshot({path:'docs/dashboard-desktop.png'});
  await page.setViewportSize({width:390,height:844});
  console.log(await page.evaluate(()=>[...document.querySelectorAll('body *')].map(el=>({tag:el.tagName,id:el.id,cls:el.className,w:el.getBoundingClientRect().width,r:el.getBoundingClientRect().right})).filter(x=>x.r>391&&x.w>0).slice(0,20)));
  await page.screenshot({path:'docs/dashboard-mobile.png'});
  await browser.close();
})();
