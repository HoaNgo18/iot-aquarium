async page => {
  await page.locator('#ph-card [data-value]').filter({ hasText: /\d/ }).waitFor();
  const results = [];
  for (const width of [1920, 1366, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    const cards = await page.locator('.kpi-grid > .kpi-card').evaluateAll(nodes => nodes.map(node => {
      const { x, y, width, height } = node.getBoundingClientRect();
      return { x, y, width, height };
    }));
    if (cards.length !== 3) throw new Error('Expected three direct metric cards');
    for (const key of ['y', 'width', 'height']) {
      if (Math.max(...cards.map(card => card[key])) - Math.min(...cards.map(card => card[key])) > 1)
        throw new Error(`Unequal ${key} at ${width}: ${JSON.stringify(cards)}`);
    }
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw new Error('Desktop horizontal overflow');
    results.push({ viewport: width, cards });
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  if (await page.evaluate(() => document.documentElement.scrollHeight > innerHeight + 2)) throw new Error('Desktop requires scrolling');
  await page.screenshot({ path: 'output/playwright/equal-cards-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = await page.locator('.kpi-grid > .kpi-card').evaluateAll(nodes => nodes.map(node => {
    const { x, y, width, bottom } = node.getBoundingClientRect(); return { x, y, width, bottom };
  }));
  if (mobile[1].y < mobile[0].bottom || mobile[2].y < mobile[1].bottom) throw new Error('Mobile cards must stack');
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw new Error('Mobile horizontal overflow');
  await page.screenshot({ path: 'output/playwright/equal-cards-mobile.png', fullPage: true });
  return { status: 'PASS', desktop: results, mobile };
}
