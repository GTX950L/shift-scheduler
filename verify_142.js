/* shift-scheduler v1.42 端到端验证：Playwright headless chromium
   覆盖：① 循环画笔悬停预览——连班防呆格显示拦截提示，且预览与点击实际结果一致
        ② 空白月逐格 cycle：悬停"点击将变为 X"→点击→格子确实变为 X（两次循环）
        ③ 键盘编辑（点选→数字设值/空格循环/加班/Delete清手动/方向键移动/
           Ctrl+Z·Ctrl+Y/Esc 取消/未选中时←→仍切月）
        ④ 周模板复制改为可选目标周（弹窗/全不勾取消/复制落格/取消按钮）
        ⑤ 快照恢复前差异预览（confirm 含差异摘要，恢复生效）
   运行：NODE_PATH=C:\...\node_modules node verify_142.js  （需已起 http.server 8002） */
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  let lastDialog = '';
  page.on('dialog', d => { lastDialog = d.message(); d.accept(); });
  const results = [];
  const ok = (name, pass, extra) => results.push({ name, pass: !!pass, extra: extra || '' });
  const S = (pid, mo, d) => '#sheet tbody tr[data-pid="' + pid + '"] td.cell[data-m="' + mo + '"][data-d="' + d + '"]';
  const cls = (pid, mo, d) => page.evaluate(sel => { const t = document.querySelector(sel); return t ? t.className : ''; }, S(pid, mo, d));
  const tipText = () => page.evaluate(() => { const t = document.getElementById('pvTip'); return { show: t.classList.contains('show'), txt: t.textContent }; });
  /* 悬停目标并等浮层真正出现。先手动滚入视野让 scroll→pvHide 落定，再悬停，
     避免 Playwright hover 自动滚动与 mouseover 的竞态导致浮层被瞬间隐藏 */
  async function hoverTip(sel){
    await page.evaluate(s => { const el = document.querySelector(s); if (el) el.scrollIntoView({ block: 'center', inline: 'center' }); }, sel);
    await page.waitForTimeout(250);
    for (let i = 0; i < 4; i++) {
      await page.hover(sel);
      await page.waitForTimeout(180);
      const t = await tipText();
      if (t.show) return t;
    }
    return tipText();
  }
  const toastTxt = () => page.evaluate(() => document.getElementById('toast').textContent);
  const manCount = () => page.evaluate(() => document.querySelectorAll('#sheet td.cell.man').length);

  try {
    // ---------- 准备：示例数据 → 单月视图 → 10月自动排班（停留在 10 月） ----------
    await page.goto('http://127.0.0.1:8002/index.html', { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(800);
    await page.click('#wSample').catch(() => {});
    await page.waitForTimeout(900);
    await page.selectOption('#viewMode', 'month'); await page.waitForTimeout(500);
    await page.click('#nextMonth'); await page.waitForTimeout(600);            // 9月 → 10月
    await page.click('#genBtn'); await page.waitForTimeout(900);               // 自动排班 10 月
    const chk10 = await page.evaluate(() => document.getElementById('checkModal').classList.contains('show'));
    if (chk10) await page.click('#checkClose').catch(() => {});
    ok('准备. 10 月已自动排班', await page.evaluate(() => !!document.querySelector('#sheet tbody tr[data-pid] td.cell[data-m="2026-10"]')), '体检弹窗=' + chk10);

    // ---------- ① 连班防呆格悬停预览（在排班里动态找"自动避连班"格） ----------
    const blk = await page.evaluate(() => {
      for (let i = 1; i <= 20; i++) {
        const pid = 'p' + i;
        for (let d = 1; d <= 31; d++) {
          const cy = cycleNextValue(pid, '2026-10', d);
          if (cy.note && cy.note.indexOf('自动避连班') >= 0) return { pid, d, cur: cy.cur, next: cy.next };
        }
      }
      return null;
    });
    if (blk) {
      await page.selectOption('#brush', 'cycle'); await page.waitForTimeout(200);
      const tb = await hoverTip(S(blk.pid, '2026-10', blk.d));
      await page.click(S(blk.pid, '2026-10', blk.d)); await page.waitForTimeout(350);
      const after = await page.evaluate(({ pid, d }) => currentCellChar(pid, '2026-10', d), blk);
      ok('1a. 防呆格悬停含拦截提示', tb.show && tb.txt.indexOf('自动避连班') >= 0, '文本=' + tb.txt.replace(/\s+/g, ' ').slice(0, 42));
      ok('1b. 点击结果与预览一致（无违规写入）', after === blk.next, '预览目标=' + blk.next + ' 点击后实际=' + after);
    } else {
      ok('1a. 防呆格悬停含拦截提示', false, '10月排班未找到自动避连班格');
      ok('1b. 防呆格点击不误设违规班次', false, '同上');
    }

    // ---------- ② 空白 11 月：预览与点击逐格一致（两次循环） ----------
    await page.click('#nextMonth'); await page.waitForTimeout(600);            // 10月 → 11月（空白）
    const pick = await page.evaluate(() => {
      for (const pid of ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']) {
        for (let d = 1; d <= 29; d++) {
          const cy = cycleNextValue(pid, '2026-11', d);
          if (cy.cur === '.' && cy.next !== cy.cur) return { pid, d };
        }
      }
      return null;
    });
    ok('准备2. 找到可逐格循环的空白格', !!pick, pick ? pick.pid + ' 11月' + pick.d + '日' : '未找到');
    const labelOf = { '白班': 'day', '夜班': 'night', '休': 'rest' };
    await page.selectOption('#brush', 'cycle'); await page.waitForTimeout(200);
    if (pick) {
      const t1 = await hoverTip(S(pick.pid, '2026-11', pick.d));
      const m1 = /点击 → (白班|夜班|休)/.exec(t1.txt);
      await page.click(S(pick.pid, '2026-11', pick.d)); await page.waitForTimeout(350);
      const cA = await cls(pick.pid, '2026-11', pick.d);
      ok('2a. 悬停预览第1次目标', t1.show && !!m1 && cA.indexOf(labelOf[m1[1]]) >= 0,
        '预览=' + (m1 ? m1[1] : '无') + ' 点击后=' + cA.split(' ')[1]);
      const t2 = await hoverTip(S(pick.pid, '2026-11', pick.d));
      const m2 = /点击 → (白班|夜班|休)/.exec(t2.txt);
      await page.click(S(pick.pid, '2026-11', pick.d)); await page.waitForTimeout(350);
      const cB = await cls(pick.pid, '2026-11', pick.d);
      ok('2b. 悬停预览第2次目标', !!m2 && cB.indexOf(labelOf[m2[1]]) >= 0,
        '预览=' + (m2 ? m2[1] : '无') + ' 点击后=' + cB.split(' ')[1]);
      await page.hover('#toolbar'); await page.waitForTimeout(250);
      const hd = await tipText();
      ok('2c. 移出表格浮层隐藏', !hd.show, '');
    }

    // ---------- ③ 键盘编辑（p3 行，空白格） ----------
    await page.selectOption('#brush', 'rest'); await page.waitForTimeout(200);
    await page.click(S('p3', '2026-11', 1)); await page.waitForTimeout(300);   // 单击=强制休，且获得焦点
    const kbOn = await page.evaluate(() => !!document.querySelector('#sheet td.kb-sel'));
    ok('3a. 单击后出现键盘焦点框', kbOn, '');
    await page.keyboard.press('2'); await page.waitForTimeout(400);             // 数字2=白班
    const c3 = await cls('p3', '2026-11', 1);
    await page.keyboard.press(' '); await page.waitForTimeout(400);             // 空格循环 → 夜班
    const c4 = await cls('p3', '2026-11', 1);
    ok('3b. 数字2设白 + 空格循环', c3.indexOf('day') >= 0 && c4.indexOf('night') >= 0, '按2后=' + c3.split(' ')[1] + ' 空格后=' + c4.split(' ')[1]);
    await page.keyboard.press('5'); await page.waitForTimeout(400);             // 数字5=加班
    const otBadge = await page.evaluate(() => { const td = document.querySelector('#sheet tbody tr[data-pid="p3"] td.cell[data-m="2026-11"][data-d="1"] .c-badge'); return td ? td.textContent : ''; });
    ok('3c. 数字5=加班徽标', otBadge === '加', 'badge=' + otBadge);
    await page.keyboard.press('Delete'); await page.waitForTimeout(400);        // Delete 清除手动
    const c5 = await cls('p3', '2026-11', 1);
    ok('3d. Delete 清除手动', c5.indexOf('man') < 0, '清除后=' + c5.split(' ').slice(0, 2).join(' '));
    await page.selectOption('#brush', 'rest'); await page.waitForTimeout(200);  // 数字5 已改画笔为加班 → 复位为休
    await page.click(S('p3', '2026-11', 2)); await page.waitForTimeout(300);   // 焦点移到 11/2（画笔=休 → 写入休）
    await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(300);     // 左移到 11/1
    await page.keyboard.press('2'); await page.waitForTimeout(400);             // 11/1 设白班
    const c6 = await cls('p3', '2026-11', 1);
    const c7 = await cls('p3', '2026-11', 2);
    ok('3e. 方向键移动焦点后设值', c6.indexOf('day') >= 0 && c7.indexOf('rest') >= 0 && c7.indexOf('man') >= 0, '11/1=' + c6.split(' ')[1] + ' 11/2=' + c7.split(' ')[1]);
    await page.keyboard.press('Control+z'); await page.waitForTimeout(400);
    const c8 = await cls('p3', '2026-11', 1);
    await page.keyboard.press('Control+y'); await page.waitForTimeout(400);
    const c9 = await cls('p3', '2026-11', 1);
    ok('3f. 键盘操作可撤销/重做', c8.indexOf('day') < 0 && c9.indexOf('day') >= 0, '撤销后11/1=' + c8.split(' ')[1] + ' 重做后=' + c9.split(' ')[1]);
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    const kbOff = await page.evaluate(() => !document.querySelector('#sheet td.kb-sel'));
    ok('3g. Esc 取消焦点', kbOff, '');
    await page.keyboard.press('ArrowRight'); await page.waitForTimeout(600);    // 无焦点：→ 切月份
    const decShown = await page.evaluate(() => !!document.querySelector('#sheet thead th[data-m="2026-12"]'));
    await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(600);     // 切回 11 月
    ok('3h. 未选中格子时 ←→ 仍切月份', decShown, '');

    // ---------- ④ 周模板复制到可选目标周（回 10 月已排班月） ----------
    await page.click('#prevMonth'); await page.waitForTimeout(600);             // 11月 → 10月
    const wkMeta = await page.evaluate(() => {
      const weeks = buildWeekGroups();
      const fi = weeks.findIndex(w => w.isFull);
      if (fi < 0) return null;
      const tgts = weeks.slice(fi + 1).filter(x => x.isFull);
      return { w: fi + 1, tgtN: tgts.length };
    });
    if (wkMeta) {
      await page.click('#sheet thead th.week[data-w="' + wkMeta.w + '"]'); await page.waitForTimeout(400);
      const mOpen = await page.evaluate(() => document.getElementById('weekModal').classList.contains('show'));
      const mChk = await page.evaluate(() => document.querySelectorAll('#weekTargets input').length);
      const mInfo = await page.evaluate(() => document.getElementById('weekInfo').textContent);
      ok('4a. 周表头点击弹出目标选择', mOpen && mChk === wkMeta.tgtN && mInfo.indexOf('目标周') >= 0, '勾选项=' + mChk + ' 预期=' + wkMeta.tgtN);
      const manBefore = await manCount();
      await page.evaluate(() => document.querySelectorAll('#weekTargets input').forEach(i => i.checked = false));
      await page.click('#weekOk'); await page.waitForTimeout(400);
      const toastCancel = await toastTxt();
      const manAfterCancel = await manCount();
      ok('4b. 全不勾选则取消复制', toastCancel.indexOf('未勾选任何目标周') >= 0 && manAfterCancel === manBefore, 'toast=' + toastCancel.slice(0, 24));
      await page.click('#sheet thead th.week[data-w="' + wkMeta.w + '"]'); await page.waitForTimeout(400);
      await page.click('#weekOk'); await page.waitForTimeout(600);              // 默认全勾 → 复制
      const manAfter = await manCount();
      const toastOk = await toastTxt();
      ok('4c. 复制到勾选周生效', manAfter > manBefore && toastOk.indexOf('已把第') >= 0, '手动格 ' + manBefore + '→' + manAfter + ' toast=' + toastOk.slice(0, 30));
      await page.click('#sheet thead th.week[data-w="' + wkMeta.w + '"]'); await page.waitForTimeout(300);
      await page.click('#weekCancel'); await page.waitForTimeout(300);
      const mClosed = await page.evaluate(() => !document.getElementById('weekModal').classList.contains('show'));
      ok('4d. 取消按钮关闭弹窗', mClosed, '');
    } else {
      ok('4a. 周表头弹出目标选择', false, '10月视图内无完整周');
      ok('4b. 全不勾选则取消复制', false, '同上');
      ok('4c. 复制到勾选周生效', false, '同上');
      ok('4d. 取消按钮关闭弹窗', false, '同上');
    }

    // ---------- ⑤ 快照恢复前差异预览 ----------
    const manCur = await manCount();
    await page.click('#snapBtn'); await page.waitForTimeout(400);
    const snapN = await page.evaluate(() => document.querySelectorAll('#snapList .snap-restore').length);
    await page.click('#snapList .snap-restore'); await page.waitForTimeout(900);
    const confirmMsg = lastDialog;
    const manAfterRestore = await manCount();
    ok('5a. 恢复前 confirm 含差异预览', confirmMsg.indexOf('差异预览') >= 0 && confirmMsg.indexOf('手工排班') >= 0,
      'confirm=' + confirmMsg.replace(/\n/g, ' | ').slice(0, 90));
    ok('5b. 快照恢复生效（手工格回落）', snapN >= 1 && manAfterRestore < manCur,
      '快照数=' + snapN + ' 手动格 ' + manCur + '→' + manAfterRestore);

    ok('6. 0 控制台/页面错误', errs.length === 0, errs.join(' | '));
  } catch (e) {
    ok('流程异常', false, e.message);
    await page.screenshot({ path: '_v142_fail.png' }).catch(() => {});
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
