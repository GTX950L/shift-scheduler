/* shift-scheduler v1.40 人员级指定转班日 端到端验证：Playwright headless chromium
   覆盖：转班下拉入口 / 弹窗设定（固定白班人员从第7日起转夜）/
        周日休保留 / reload 持久化 / 列表展示与取消回落 / Ctrl+Z·Ctrl+Y /
        月轮转人员不受扰 / 10月体检零违规
   运行：NODE_PATH=.../node_modules node verify_sprot.js  （需已起 http.server 8002） */
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  page.on('dialog', d => d.accept());
  const results = [];
  const ok = (name, pass, extra) => results.push({ name, pass: !!pass, extra: extra || '' });
  const cellCls = (pid, mo, d) => page.evaluate(({ pid, mo, d }) => {
    const td = document.querySelector(`#sheet tbody tr[data-pid="${pid}"] td.cell[data-m="${mo}"][data-d="${d}"]`);
    return td ? td.className : '';
  }, { pid, mo, d });

  try {
    await page.goto('http://127.0.0.1:8002/index.html', { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(800);
    await page.click('#wSample').catch(() => {});
    await page.waitForTimeout(900);

    // 1. 切到 10 月（未锁月）→ 郑高鑫(p6 fixed-day) 设「从第7日起换班」
    await page.click('#nextMonth'); await page.waitForTimeout(700);
    await page.click('#rotateBtn'); await page.waitForTimeout(300);
    await page.click('#rotateMenu button[data-a="person"]'); await page.waitForTimeout(400);
    const modalOpen = await page.evaluate(() => document.getElementById('spRotModal').classList.contains('show'));
    await page.selectOption('#spRotPerson', 'p6'); await page.waitForTimeout(200);
    await page.selectOption('#spRotDay', '7');
    await page.click('#spRotAdd'); await page.waitForTimeout(500);
    ok('1. 指定转班弹窗可用', modalOpen, '弹窗打开=' + modalOpen);

    // 2. 排班生效：10/1-6 白 · 10/7 起夜 · 周日休保留
    const a1 = await cellCls('p6', '2026-10', 1);
    const a6 = await cellCls('p6', '2026-10', 6);
    const a7 = await cellCls('p6', '2026-10', 7);
    const a8 = await cellCls('p6', '2026-10', 8);
    const a11 = await cellCls('p6', '2026-10', 11); // 周日休
    const a30 = await cellCls('p6', '2026-10', 30);
    ok('2. 白班→第7日起夜班', a1.includes('day') && a6.includes('day') && a7.includes('night') && a8.includes('night') && a30.includes('night'),
      '10/1=' + a1.split(' ')[1] + ' 10/6=' + a6.split(' ')[1] + ' 10/7=' + a7.split(' ')[1] + ' 10/30=' + a30.split(' ')[1]);
    ok('3. 周日休保留', a11.includes('rest'), '10/11(周日)=' + a11.split(' ')[1]);

    // 4. 状态持久化（reload 后仍在）+ 弹窗列表显示条目
    await page.reload(); await page.waitForTimeout(900);
    const r7 = await cellCls('p6', '2026-10', 7);
    ok('4. 设定持久化(reload)', r7.includes('night'), 'reload后 10/7=' + r7.split(' ')[1]);

    // 5. 列表显示 + 取消按钮生效 → 回落按规则(全白)
    await page.click('#rotateBtn'); await page.waitForTimeout(300);
    await page.click('#rotateMenu button[data-a="person"]'); await page.waitForTimeout(400);
    const listTxt = await page.evaluate(() => document.getElementById('spRotList').textContent);
    await page.click('#spRotList button[data-clear="p6"]'); await page.waitForTimeout(500);
    const c7 = await cellCls('p6', '2026-10', 7);
    ok('5. 列表展示 + 取消生效', listTxt.includes('郑高鑫') && c7.includes('day'), '列表=' + listTxt.slice(0, 30) + ' 取消后10/7=' + c7.split(' ')[1]);

    // 6. Ctrl+Z / Ctrl+Y（设定→撤销→重做 全链）
    await page.selectOption('#spRotPerson', 'p6'); await page.waitForTimeout(150);
    await page.selectOption('#spRotDay', '7'); await page.waitForTimeout(150);
    await page.click('#spRotAdd'); await page.waitForTimeout(500);
    await page.keyboard.press('Control+z'); await page.waitForTimeout(500);
    const u7 = await cellCls('p6', '2026-10', 7);
    await page.keyboard.press('Control+y'); await page.waitForTimeout(500);
    const r7b = await cellCls('p6', '2026-10', 7);
    ok('6. 撤销/重做', u7.includes('day') && r7b.includes('night'), '撤销后10/7=' + u7.split(' ')[1] + ' 重做后=' + r7b.split(' ')[1]);
    await page.click('#spRotClose').catch(() => {});

    // 7. rotate 人员不受影响（10 月末周末转班照常：p2 月初 day 段存在）
    const p2_15 = await cellCls('p2', '2026-10', 15);
    ok('7. 月轮转人员不受扰', p2_15.includes('day'), 'p2 10/15=' + p2_15.split(' ')[1]);

    // 8. 体检无违规 + 0 JS 错误
    await page.click('#checkBtn'); await page.waitForTimeout(700);
    const chk = await page.evaluate(() => ({ open: document.getElementById('checkModal').classList.contains('show'), txt: document.getElementById('checkList').textContent }));
    if (chk.open) await page.click('#checkClose').catch(() => {});
    ok('8. 10月体检无违规', chk.open && !/发现\s*\d+\s*个违规/.test(chk.txt), chk.txt.slice(0, 80));
    ok('9. 0 控制台/页面错误', errs.length === 0, errs.join(' | '));
  } catch (e) {
    ok('流程异常', false, e.message);
    await page.screenshot({ path: '_v140_fail.png' }).catch(() => {});
  }
  await browser.close();
  let pass = 0;
  for (const r of results) {
    console.log((r.pass ? '✅' : '❌') + ' ' + r.name + (r.extra ? ' — ' + r.extra : ''));
    if (r.pass) pass++;
  }
  console.log('\n结果: ' + pass + '/' + results.length + ' 通过' + (pass === results.length ? ' 🎉' : ''));
  process.exit(pass === results.length ? 0 : 1);
})();
