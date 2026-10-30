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
    ok('5. 空状态卡片 → 载入示例 → 表格回归', s1.n === 22 && s1.esHidden && s1.sheetVisible,
      '人员=' + s1.n + ' 空状态已隐藏=' + s1.esHidden + ' 提示条已隐藏=' + s1.flowHidden);

    /* 5b. v1.50 合计行：在岗主数字 + 白/夜副行 + 粘在表格底部 */
    const tot = await page.evaluate(() => {
      const row = document.querySelector('#sheet tr.tot-row');
      if(!row) return { exists: false };
      const td = row.querySelectorAll('td')[0];
      const cs = getComputedStyle(td);
      const mkey = CUR.months[0].key, d = 1;
      let day = 0, night = 0;
      for(const p of state.people){
        const c = (CUR.grids[mkey][p.id] || [])[d-1] || '.';
        if(getLeave(p.id, mkey, d)) continue;
        if(c === 'd' || c === 'D') day++; else if(c === 'n' || c === 'N') night++;
      }
      return { exists: true, sticky: cs.position === 'sticky', bottom: cs.bottom,
        total: (td.querySelector('.t-total') || {}).textContent || '',
        sub: (td.querySelector('.t-sub') || {}).textContent || '',
        expectTotal: String(day + night), expectSub: day + '/' + night,
        hasBar: !!td.querySelector('.t-bar') };
    });
    ok('5b. 合计行粘底 + 在岗数与白/夜副行一致',
      tot.exists && tot.sticky && tot.bottom === '0px' && tot.total === tot.expectTotal
        && tot.sub === tot.expectSub && tot.hasBar,
      '在岗=' + tot.total + '(应' + tot.expectTotal + ') 白/夜=' + tot.sub + '(应' + tot.expectSub
        + ') sticky=' + tot.sticky + ' 柱条=' + tot.hasBar);

    /* 5c. v1.50 提示条 hidden 时真的不占位（此前 .flow-bar{display:flex} 覆盖了 [hidden]） */
    const fbBox = await page.evaluate(() => {
      const bar = document.getElementById('flowBar');
      return { hidden: bar.hidden, disp: getComputedStyle(bar).display,
        h: Math.round(bar.getBoundingClientRect().height) };
    });
    ok('5c. 提示条隐藏时不占布局', fbBox.hidden && fbBox.h === 0,
      'hidden=' + fbBox.hidden + ' 高度=' + fbBox.h + 'px display=' + fbBox.disp);

    /* 5d. v1.50 人员卡片紧凑模式：一行一人，全员工一屏看全 */
    const comp = await page.evaluate(async () => {
      const list = document.getElementById('peopleList');
      const hDetail = list.scrollHeight;                       // 详细模式：列表内容总高
      document.getElementById('densityBtn').click();
      await new Promise(r => setTimeout(r, 320));
      const c = document.querySelector('.p-card');
      const out = { cards: document.querySelectorAll('.p-card').length,
        cardH: c ? Math.round(c.getBoundingClientRect().height) : 0,
        hDetail, hCompact: list.scrollHeight, clientH: list.clientHeight,
        hasBadge: !!document.querySelector('.p-card .pmeta .badge') };
      document.getElementById('densityBtn').click();
      await new Promise(r => setTimeout(r, 220));
      return out;
    });
    // 断言用相对量：紧凑内容总高应不到详细的一半，且单卡 ≤40px（不依赖视口高度）
    ok('5d. 紧凑模式大幅压缩人员列表', comp.cards === 22 && comp.cardH < 40
      && comp.hCompact < comp.hDetail * 0.6 && comp.hasBadge,
      '卡片高=' + comp.cardH + 'px 列表总高 ' + comp.hDetail + '→' + comp.hCompact
        + 'px（容器 ' + comp.clientH + 'px，' + (comp.hCompact <= comp.clientH + 1 ? '一屏放得下' : '需滚动') + '）');

    /* 5e. v1.50 姓名搜索：输入即高亮，清空即移除 */
    const srch = await page.evaluate(async () => {
      const box = document.getElementById('nameSearch');
      box.value = '王'; box.dispatchEvent(new Event('input'));
      await new Promise(r => setTimeout(r, 320));
      const ids = [...document.querySelectorAll('#sheet tbody tr.search-hit')].map(r => r.dataset.pid);
      const names = ids.map(id => (state.people.find(p => p.id === id) || {}).name);
      box.value = ''; box.dispatchEvent(new Event('input'));
      await new Promise(r => setTimeout(r, 200));
      return { names, cleared: document.querySelectorAll('#sheet tbody tr.search-hit').length };
    });
    ok('5e. 姓名搜索高亮并定位', srch.names.length === 2 && srch.names.every(n => n && n.indexOf('王') >= 0)
      && srch.cleared === 0, '命中=' + srch.names.join('/') + ' 清空后高亮=' + srch.cleared);

    /* 5f. v1.52 班次筛选：只看白班 → 非白班格子淡化 + 横幅提示 */
    const sf = await page.evaluate(async () => {
      const sel = document.getElementById('shiftFilter');
      sel.value = 'day'; sel.dispatchEvent(new Event('change'));
      await new Promise(r => setTimeout(r, 280));
      return { total: document.querySelectorAll('#sheet td.cell').length,
        dim: document.querySelectorAll('#sheet td.cell.sf-dim').length,
        barShown: !document.getElementById('filterBar').hidden,
        txt: document.getElementById('filterTxt').textContent };
    });
    ok('5f. 只看白班 → 其余淡化 + 横幅提示', sf.dim > 0 && sf.dim < sf.total && sf.barShown
      && /只看白班/.test(sf.txt),
      '淡化 ' + sf.dim + '/' + sf.total + ' 格；横幅="' + sf.txt + '"');

    /* 5g. v1.52 部门筛选：只显示该部门人员 */
    const dp = await page.evaluate(async () => {
      const sel = document.getElementById('deptFilter');
      sel.value = '除气'; sel.dispatchEvent(new Event('change'));
      await new Promise(r => setTimeout(r, 280));
      return { rows: document.querySelectorAll('#sheet tbody tr[data-pid]').length,
        expect: state.people.filter(p => p.dept === '除气').length,
        txt: document.getElementById('filterTxt').textContent };
    });
    ok('5g. 部门筛选只显示该部门', dp.rows === dp.expect && /除气/.test(dp.txt),
      '行数 ' + dp.rows + '（应 ' + dp.expect + '）；横幅="' + dp.txt + '"');

    /* 5h. v1.52 隐藏人员：表格少一行 + 横幅点名 + 卡片标记 */
    const hp2 = await page.evaluate(async () => {
      const before = document.querySelectorAll('#sheet tbody tr[data-pid]').length;
      toggleHidePerson('p1');
      await new Promise(r => setTimeout(r, 280));
      return { before, after: document.querySelectorAll('#sheet tbody tr[data-pid]').length,
        hidN: state.hiddenPeople.length,
        txt: document.getElementById('filterTxt').textContent,
        cardMarked: document.querySelectorAll('.p-card.is-hidden').length };
    });
    ok('5h. 隐藏人员生效且横幅点名', hp2.after === hp2.before - 1 && hp2.hidN === 1
      && /已隐藏/.test(hp2.txt) && hp2.cardMarked === 1,
      hp2.before + '→' + hp2.after + ' 行；横幅="' + hp2.txt + '"');

    /* 5i. v1.52 一键清除全部筛选 */
    const clr = await page.evaluate(async () => {
      document.getElementById('filterClear').click();
      await new Promise(r => setTimeout(r, 340));
      return { rows: document.querySelectorAll('#sheet tbody tr[data-pid]').length,
        dim: document.querySelectorAll('#sheet td.cell.sf-dim').length,
        barHidden: document.getElementById('filterBar').hidden,
        sf: state.shiftFilter, df: state.deptFilter, hid: state.hiddenPeople.length };
    });
    ok('5i. 一键清除全部筛选', clr.rows === 22 && clr.dim === 0 && clr.barHidden
      && clr.sf === 'all' && clr.df === 'all' && clr.hid === 0,
      '行数=' + clr.rows + ' 淡化=' + clr.dim + ' 横幅隐藏=' + clr.barHidden);

    /* 5j. v1.53 「资材部版式」导出的 xlsx 可生成且菜单有入口 */
    const stx = await page.evaluate(() => {
      const bytes = buildShiftSheetXlsx();
      const u8 = new Uint8Array(bytes);
      return { size: bytes.length, isZip: u8[0] === 0x50 && u8[1] === 0x4B,
        hasMenu: !!document.querySelector('#exportMenu button[data-act="xlsx-styled"]'),
        leader: state.leader };
    });
    ok('5j. 资材部版式导出可生成（zip 头 + 菜单入口）',
      stx.isZip && stx.size > 5000 && stx.hasMenu,
      stx.size + ' 字节，zip=' + stx.isZip + ' 菜单=' + stx.hasMenu + ' 负责人=' + stx.leader);

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
    // 必需项 + 无重复（v1.53 起多了「负责人」，改为按必需项校验，避免每加一项就要改数字）
    const MORE_NEED = ['copyMonth','clearNext','clearMan','rotateAll','rotatePerson','snapshot','leader','holiday','sample','reset'];
    ok('9. 「⋯ 更多」菜单完整且无重复',
      MORE_NEED.every(x => tb.more.includes(x)) && tb.more.length === MORE_NEED.length && !tb.moreDup,
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
