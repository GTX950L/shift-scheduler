/* verify_ui.js —— v1.46 界面与操作指引回归测试（Playwright headless chromium）
   覆盖：首开 3 步向导 / 空状态引导 / 流程提示条 / 工具栏两行结构 /
        「⋯ 更多」菜单完整性 / 帮助菜单四项 / 折叠式操作指引 / 0 控制台错误
   运行：npm run test:all 或 node run-tests.js ui */
const pw = require('./pw');
const { chromium } = pw;

const results = [];
const ok = (name, pass, extra) => {
  results.push({ name, pass: !!pass, extra: extra || '' });
  console.log((pass ? '  ✓ ' : '  ✗ ') + name + (extra ? ' — ' + extra : ''));
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 980 } });
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  page.on('dialog', d => d.accept());

  try {
    await page.goto('http://127.0.0.1:8002/index.html', { waitUntil: 'load', timeout: 30000 });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(700);

    /* 1. 首开 3 步向导 */
    const g1 = await page.evaluate(() => ({
      open: document.getElementById('welcomeModal').classList.contains('show'),
      tabs: document.querySelectorAll('#gdTabs .gd-tab').length,
      bodyLen: (document.getElementById('gdBody').textContent || '').trim().length,
      quick: document.querySelectorAll('#gdBody .gd-quick button').length,
      prevDisabled: document.getElementById('gdPrev').disabled,
      title: (document.querySelector('#welcomeModal h3') || {}).textContent || ''
    }));
    ok('1. 首开弹出 3 步向导且内容已渲染', g1.open && g1.tabs === 3 && g1.bodyLen > 80 && g1.quick >= 1 && g1.prevDisabled,
      '标签=' + g1.tabs + ' 正文=' + g1.bodyLen + '字 快捷按钮=' + g1.quick + ' 第1步禁用上一步=' + g1.prevDisabled);

    /* 2. 向导可翻页 */
    const g2 = await page.evaluate(async () => {
      document.getElementById('gdNext').click();
      await new Promise(r => setTimeout(r, 120));
      const s2 = { sel: document.querySelectorAll('#gdTabs .gd-tab.sel').length, prevDisabled: document.getElementById('gdPrev').disabled };
      document.getElementById('gdNext').click();
      await new Promise(r => setTimeout(r, 120));
      const s3 = { nextTxt: document.getElementById('gdNext').textContent, done: document.querySelectorAll('#gdTabs .gd-tab.done').length };
      return { s2, s3 };
    });
    ok('2. 向导翻页 / 末步按钮文案', g2.s2.sel === 1 && !g2.s2.prevDisabled && /完成/.test(g2.s3.nextTxt) && g2.s3.done === 2,
      '第3步按钮="' + g2.s3.nextTxt.trim() + '" 已完成标记=' + g2.s3.done);

    /* 3. 跳过 → 空状态引导 */
    await page.evaluate(() => document.getElementById('wStart').click());
    await page.waitForTimeout(350);
    const e1 = await page.evaluate(() => ({
      es: !document.getElementById('emptyState').hidden,
      cards: document.querySelectorAll('#emptyState .es-card').length,
      sheetHidden: getComputedStyle(document.getElementById('sheetScroll')).display === 'none',
      flow: !document.getElementById('flowBar').hidden,
      flowTxt: (document.getElementById('fbTxt').textContent || '').slice(0, 20)
    }));
    ok('3. 空状态引导（空表格换成三张卡片 + 流程提示）', e1.es && e1.cards === 3 && e1.sheetHidden,
      '空状态=' + e1.es + ' 卡片=' + e1.cards + ' 表格已隐藏=' + e1.sheetHidden);
    ok('4. 流程提示条（无人员时提示导入/添加）', e1.flow && /还没有技术员/.test(e1.flowTxt),
      '提示条=' + e1.flow + ' 文案="' + e1.flowTxt + '…"');

    /* 5. 从空状态卡片载入示例 */
    await page.evaluate(() => document.querySelector('#emptyState .es-card[data-es="sample"]').click());
    await page.waitForTimeout(1000);
    const s1 = await page.evaluate(() => ({
      n: state.people.length,
      esHidden: document.getElementById('emptyState').hidden,
      sheetVisible: getComputedStyle(document.getElementById('sheetScroll')).display !== 'none',
      flowHidden: document.getElementById('flowBar').hidden
    }));
    ok('5. 空状态卡片 → 载入示例 → 表格回归', s1.n === 23 && s1.esHidden && s1.sheetVisible,
      '人员=' + s1.n + ' 空状态已隐藏=' + s1.esHidden + ' 提示条已隐藏=' + s1.flowHidden);

    /* 6. 流程提示条：切到未排班月份 → 提示自动排班 */
    const f1 = await page.evaluate(async () => {
      state.schedMarks = {}; state.monthShift = {}; state.manual = {};   // 模拟「这个月还没排班」
      state.curYear = 2026; state.curMonth = 12;
      saveState(); renderAll();
      await new Promise(r => setTimeout(r, 200));
      const bar = document.getElementById('flowBar');
      return { hidden: bar.hidden, txt: document.getElementById('fbTxt').textContent,
        ops: document.querySelectorAll('#fbOps button').length,
        people: state.people.length, key: CUR.key, manualEmpty: Object.keys(state.manual).length === 0 };
    });
    ok('6. 未排班月份 → 提示自动排班并给按钮', !f1.hidden && /还没有排班/.test(f1.txt) && f1.ops >= 1,
      '提示="' + f1.txt.slice(0, 26) + '…" 按钮=' + f1.ops + ' 人员=' + f1.people + ' 中心月=' + f1.key
        + ' manual空=' + f1.manualEmpty + ' hidden=' + f1.hidden);

    /* 7. 提示条可一键关闭本次 */
    const f2 = await page.evaluate(async () => {
      document.getElementById('fbClose').click();
      await new Promise(r => setTimeout(r, 150));
      return document.getElementById('flowBar').hidden;
    });
    ok('7. 提示条可关闭本次提示', f2 === true, '关闭后 hidden=' + f2);

    /* 8. 工具栏两行结构 + 主操作按钮齐全 */
    const tb = await page.evaluate(() => {
      const ids = ['genBtn', 'importBtn', 'exportBtn', 'checkBtn', 'printBtn', 'helpBtn', 'moreBtn', 'undoBtn', 'redoBtn'];
      const missing = ids.filter(id => !document.getElementById(id));
      const rows = document.querySelectorAll('#toolbar .tb-row').length;
      const pri = document.querySelectorAll('#toolbar button.pri').length;
      const more = [...document.querySelectorAll('#moreMenu button')].map(b => b.dataset.act);
      const help = [...document.querySelectorAll('#helpMenu button')].map(b => b.dataset.a);
      const exp = [...document.querySelectorAll('#exportMenu button')].map(b => b.dataset.act);
      return { missing, rows, pri, more, help, exp, moreDup: new Set(more).size !== more.length };
    });
    ok('8. 工具栏两行 + 主操作按钮齐全', tb.missing.length === 0 && tb.rows === 2 && tb.pri === 1,
      '缺按钮=' + JSON.stringify(tb.missing) + ' 行数=' + tb.rows + ' 主按钮=' + tb.pri);
    ok('9. 「⋯ 更多」菜单完整且无重复', tb.more.length === 9 && !tb.moreDup,
      tb.more.join(', '));
    ok('10. 帮助菜单四项', tb.help.join(',') === 'help,guide,keys,log', tb.help.join(','));
    ok('11. 导出菜单含空白待填表', tb.exp.includes('blank-xlsx') && tb.exp.includes('json'),
      tb.exp.join(', '));

    /* 12. 「更多」每一项都能触发且不报错（逐项点击） */
    const acts = ['copyMonth', 'clearNext', 'clearMan', 'rotateAll', 'snapshot', 'holiday', 'sample', 'reset'];
    for (const a of acts) {
      await pw.moreAction(page, a, 260);
      /* 关掉可能弹出的弹窗，避免挡住后续点击 */
      await page.evaluate(() => ['spRotModal', 'snapModal', 'holidayModal', 'personModal'].forEach(id => {
        const el = document.getElementById(id); if (el) el.classList.remove('show');
      }));
      await page.waitForTimeout(60);
    }
    ok('12. 「更多」八项操作均可执行', errs.length === 0, errs.length ? errs.slice(0, 2).join(' | ') : '无报错');

    /* 13. 帮助 → 新手引导 / 快捷键 可打开 */
    const h1 = await page.evaluate(() => { document.getElementById('helpBtn').click(); document.querySelector('#helpMenu button[data-a="keys"]').click(); return document.getElementById('keysModal').classList.contains('show'); });
    await page.evaluate(() => document.getElementById('keysClose').click());
    await page.waitForTimeout(150);
    const h2 = await page.evaluate(() => { document.getElementById('helpBtn').click(); document.querySelector('#helpMenu button[data-a="guide"]').click(); return document.getElementById('welcomeModal').classList.contains('show') && document.querySelectorAll('#gdTabs .gd-tab').length === 3; });
    await page.evaluate(() => document.getElementById('wStart').click());
    await page.waitForTimeout(150);
    ok('13. 帮助 → 快捷键 / 新手引导', h1 && h2, '快捷键弹窗=' + h1 + ' 向导=' + h2);

    /* 14. 折叠式操作指引（5 步，默认仅第 1 步展开） */
    const tips = await page.evaluate(() => ({
      n: document.querySelectorAll('.tip-list details.tip').length,
      open: document.querySelectorAll('.tip-list details.tip[open]').length
    }));
    ok('14. 操作指引为 5 步可折叠', tips.n === 5 && tips.open === 1, '步骤=' + tips.n + ' 默认展开=' + tips.open);

    /* 15. 各断点无横向溢出（回归：v1.46 工具栏两行化后曾把设置行顶出屏幕） */
    const over = [];
    for (const [w, h] of [[1440, 900], [1280, 900], [1100, 820], [1024, 768], [900, 800], [768, 900], [480, 900]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(260);
      const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (o > 4) over.push(w + 'px→溢出' + o);
    }
    await page.setViewportSize({ width: 1500, height: 980 });
    await page.waitForTimeout(200);
    ok('15. 七个断点均无横向溢出', over.length === 0, over.length ? over.join(' / ') : '1440/1280/1100/1024/900/768/480 全部 OK');

    /* 16. 0 控制台错误 */
    ok('16. 0 控制台/页面错误', errs.length === 0, errs.length ? errs.slice(0, 3).join(' | ') : '');

  } catch (e) {
    ok('流程异常', false, e.message);
    await page.screenshot({ path: '_ui_fail.png' }).catch(() => {});
  }

  await browser.close();
  const pass = results.filter(r => r.pass).length;
  console.log('\n结果: ' + pass + '/' + results.length + ' 通过' + (pass === results.length ? ' 🎉' : ''));
  process.exit(pass === results.length ? 0 : 1);
})();
