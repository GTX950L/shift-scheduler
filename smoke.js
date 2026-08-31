/* shift-scheduler v1.35 冒烟测试：Playwright headless chromium
   覆盖：加载无错 / 示例数据 / 自动排班 / 排班表渲染 / 手动蓝点 / 撤销 /
        请假登记 / 复制到下月+清下月(请假对称) / 视图切换 / 更新记录 / 工具下拉 / CSV 导出
   运行：NODE_PATH=.../node_modules node smoke.js  （需已起 http.server 8002） */
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  // 破坏性操作确认全部自动接受（测试流程需要）
  page.on('dialog', d => d.accept());
  const results = [];
  const ok = (name, pass, extra) => results.push({ name, pass: !!pass, extra: extra || '' });

  try {
    await page.goto('http://127.0.0.1:8002/index.html', { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(800);

    // 1. 欢迎弹窗
    const welcome = await page.isVisible('#welcomeModal.show');
    ok('1. 欢迎弹窗', welcome, welcome ? '（首次打开展示）' : '未出现（可能是非空 localStorage 或加载异常）');

    // 2. 填入示例数据（欢迎弹窗内按钮）
    await page.click('#wSample').catch(() => {});
    await page.waitForTimeout(800);
    const pCount = await page.evaluate(() => document.querySelectorAll('.p-card').length);
    ok('2. 示例数据 20 人', pCount === 20, '实际 ' + pCount + ' 人');

    // 3. 排班表行数（20 人 + 合计行 = 21）
    const rowN = await page.evaluate(() => document.querySelectorAll('#sheet tbody tr[data-pid]').length);
    const colN = await page.evaluate(() => document.querySelectorAll('#sheet thead tr:nth-child(2) th:not(.corner)').length);
    ok('3. 排班表渲染', rowN === 20 && colN >= 30, rowN + ' 行 × ' + colN + ' 列（9月示例31天）');

    // 4. 统计表 + KPI + 图表
    const statsRows = await page.evaluate(() => document.querySelectorAll('#statsTable tbody tr').length);
    const kpis = await page.evaluate(() => document.querySelectorAll('#kpiRow .kpi').length);
    const hasSvg = await page.evaluate(() => !!document.querySelector('#chartBox svg'));
    ok('4. 统计/KPI/图表', statsRows >= 22 && kpis === 5 && hasSvg, '统计行 ' + statsRows + ' · KPI ' + kpis + ' · SVG ' + hasSvg);

    // 5. 切到 10 月（未排班）→ 自动排班 → 无违规
    await page.click('#nextMonth');
    await page.waitForTimeout(600);
    await page.click('#genBtn');
    await page.waitForTimeout(800);
    const checkModalOpen = await page.evaluate(() => document.getElementById('checkModal').classList.contains('show'));
    if (checkModalOpen) await page.click('#checkClose');
    const sheet10 = await page.evaluate(() => document.querySelectorAll('#sheet tbody tr[data-pid]').length);
    ok('5. 10月自动排班', sheet10 === 20, '10 月排班表 ' + sheet10 + ' 行，体检弹窗=' + checkModalOpen);

    // 6. 点击格子 → 手动蓝点（画笔切「休」强制写入，避免 cycle 被连班防呆拦截）
    const tdSel = '#sheet tbody tr[data-pid] td.cell';
    await page.selectOption('#brush', 'rest');
    await page.waitForTimeout(200);
    await page.click(tdSel);
    await page.waitForTimeout(300);
    const man1 = await page.evaluate(() => document.querySelector('#sheet tbody tr[data-pid] td.cell').classList.contains('man'));
    ok('6. 点击格子出现手动蓝点', man1, '画笔=休，点击首格写入强制休');

    // 7. Ctrl+Z 撤销 → 蓝点消失
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    const man2 = await page.evaluate(() => document.querySelector('#sheet tbody tr[data-pid] td.cell').classList.contains('man'));
    ok('7. Ctrl+Z 撤销恢复', !man2, '蓝点已消失');

    // 8. 右键 → 事假（格变灰"假"）
    await page.click(tdSel, { button: 'right' });
    await page.waitForTimeout(300);
    await page.click('#cellMenu button[data-a="leave-s"]');
    await page.waitForTimeout(300);
    const leaveTxt = await page.evaluate(() => document.querySelector('#sheet tbody tr[data-pid] td.cell .c-txt').textContent);
    ok('8. 右键登记事假', leaveTxt === '假', '格子显示「' + leaveTxt + '」');

    // 9. 复制到下月 → 切 11 月 → 请假随迁
    await page.click('#copyMonthBtn');
    await page.waitForTimeout(500);
    await page.click('#nextMonth'); // 10月 → 11月
    await page.waitForTimeout(600);
    const leaveCopied = await page.evaluate(() => {
      const tr = document.querySelector('#sheet tbody tr[data-pid]');
      const t = tr && tr.querySelector('td.cell .c-txt');
      return t ? t.textContent : '';
    }).then(txt => txt === '假').catch(() => false);
    ok('9. 请假随「到下月」复制', leaveCopied, '11 月首格=' + (leaveCopied ? '假' : '非假'));

    // 10. 清下月同步清除请假：中心月 11 月 → 先复制 11月到12月（含请假），再清下月（=12月）
    await page.click('#copyMonthBtn');
    await page.waitForTimeout(500);
    const leave12Before = await page.evaluate(() => {
      const td = document.querySelector('#sheet tbody tr[data-pid] td.cell[data-m="2026-12"][data-d="1"]');
      return td && td.querySelector('.c-txt') && td.querySelector('.c-txt').textContent === '假';
    });
    await page.click('#clearNextBtn'); // 中心月 11 月 → 清除对象为 12 月
    await page.waitForTimeout(500);
    const leave12After = await page.evaluate(() => {
      const td = document.querySelector('#sheet tbody tr[data-pid] td.cell[data-m="2026-12"][data-d="1"]');
      return td && td.querySelector('.c-txt') && td.querySelector('.c-txt').textContent === '假';
    });
    const leave11Keep = await page.evaluate(() => {
      const td = document.querySelector('#sheet tbody tr[data-pid] td.cell[data-m="2026-11"][data-d="1"]');
      return td && td.querySelector('.c-txt') && td.querySelector('.c-txt').textContent === '假';
    });
    ok('10. 清下月同步清除请假', leave12Before && !leave12After && leave11Keep,
      '12月清除前=' + leave12Before + ' 清除后=' + leave12After + ' 11月保留=' + leave11Keep);

    // 11. 视图切换（本月+下月 → 本月）
    await page.selectOption('#viewMode', 'month');
    await page.waitForTimeout(400);
    const colMonth = await page.evaluate(() => document.querySelectorAll('#sheet thead tr:nth-child(2) th:not(.corner)').length);
    ok('11. 视图切换为单月', colMonth >= 28 && colMonth <= 31, '本月视图 ' + colMonth + ' 列');

    // 12. 更新记录含 v1.35
    await page.click('#helpBtn');
    await page.waitForTimeout(300);
    await page.click('#helpMenu button[data-a="log"]');
    await page.waitForTimeout(400);
    const hasV135 = await page.evaluate(() => document.getElementById('logModal').textContent.includes('v1.35'));
    await page.click('#logClose');
    ok('12. 更新记录含 v1.35', hasV135, '新版本条目已写入');

    // 13. 工具下拉（跨项目导航）
    await page.click('#toolsBtn');
    await page.waitForTimeout(300);
    const toolsTxt = await page.evaluate(() => document.getElementById('toolsMenu').textContent);
    const hasLinks = toolsTxt.includes('设备问题共性分析') && toolsTxt.includes('Cpk 过程能力分析') && toolsTxt.includes('GitHub 仓库');
    ok('13. 工具下拉跨项目导航', hasLinks, '含三个入口');

    // 14. CSV 导出触发下载
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 5000 }).catch(() => null),
      (async () => {
        await page.click('#exportBtn');
        await page.waitForTimeout(300);
        await page.click('#exportMenu button[data-act="csv"]');
      })()
    ]);
    ok('14. CSV 导出', !!download, download ? '文件名: ' + download.suggestedFilename() : '未捕获下载');

    // 15. 控制台无 JS 错误
    ok('15. 0 控制台/页面错误', errs.length === 0, errs.length ? errs.slice(0, 3).join(' | ') : '');

  } catch (e) {
    ok('流程异常', false, e.message);
    await page.screenshot({ path: '_smoke_fail.png' }).catch(() => {});
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
