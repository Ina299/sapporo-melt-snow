const {test,expect}=require('@playwright/test');
test('daily snow stocks, constraints, comparison and export work offline',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route(/https:\/\//,route=>route.abort());await page.goto('/web/');
  await expect(page.locator('#snow-station option')).toHaveCount(13);
  await expect(page.locator('#snow-comparison tr')).toHaveCount(3);
  await expect(page.locator('#snow-error')).toBeEmpty();
  await page.locator('#snow-trucks').fill('0');
  await expect(page.locator('#snow-summary')).toContainText('0km');
  await expect(page.locator('#snow-summary')).toContainText('日末に堆雪上限');
  await page.locator('#snow-station').selectOption('清田区');
  await page.locator('#snow-mode').selectOption('melt_only');
  await page.locator('#snow-dc_it_mw').fill('0');
  await expect(page.locator('#snow-capacity-note')).toContainText('融雪上限 0t/日');
  const download=page.waitForEvent('download');await page.locator('#snow-export').click();
  const file=await (await download).path();const data=JSON.parse(require('fs').readFileSync(file,'utf8'));
  expect(data.station).toBe('清田区');expect(data.result.summary.transported_t).toBe(0);
  expect(data.result.summary.road_t+data.result.summary.temporary_t).toBeCloseTo(data.result.summary.generated_t);
  expect(data.result.daily).toHaveLength(161);
  await page.locator('#snow-trucks').fill('');await expect(page.locator('#snow-results')).toBeHidden();
  await expect(page.locator('#snow-export')).toBeDisabled();
  await page.locator('#snow-trucks').fill('2');await expect(page.locator('#snow-results')).toBeVisible();
  for(const width of [390,320]){
    await page.setViewportSize({width,height:844});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  }
  expect(errors).toEqual([]);
});
