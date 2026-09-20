/* verify_import.js —— v1.45 导入/导出多格式回归测试（Playwright headless chromium）
   覆盖：
     A. 多格式导入：CSV(UTF-8/GBK) · XLSX(序列日期/文本日期/裸序列号) · XLS(BIFF8) · HTML 伪 Excel
     B. 真实业务表形态：标题行 + 双行表头（日期在上行、姓名在下行「星期\n姓名」）+ 工号列 + 跨月
     C. 写出→读回 round-trip：xlsxBuild / xlsBuild 生成的字节再由真实导入流程读回，数据一致
     D. 导出菜单：排班表/月度统计的 CSV / .xlsx / .xls 均触发下载且文件名正确
     E. 兜底：「手动指定表头行」弹窗出现 + 点选后按该行解析成功
     F. 0 控制台错误
   运行：npm run test:all（推荐）或 node verify_import.js（浏览器解析见 pw.js）
   注意：不要用 page.click 点被弹窗遮住的隐藏按钮——默认 30s 超时会被误当成「卡死」；
        本脚本一律在 evaluate 里直接 .click()，并把每次等待压到最短。 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('./pw');

const FIX = path.join(__dirname, 'test-fixtures');
const results = [];
const ok = (name, pass, extra) => {
  results.push({ name, pass: !!pass, extra: extra || '' });
  console.log((pass ? '  ✓ ' : '  ✗ ') + name + (extra ? ' — ' + extra : ''));
};
const fixture = f => fs.readFileSync(path.join(FIX, f)).toString('base64');
const IMPORT_MS = 900;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  /* 对话框路由：导入覆盖确认一律确定；「是否清空旧排班重排」一律取消（要保留导入结果做断言） */
  page.on('dialog', d => (/清空并重新自动排班/.test(d.message()) ? d.dismiss() : d.accept()));

  /* 页内把数据恢复成空白（免重载，快得多） */
  const reset = async () => {
    await page.evaluate(() => {
      state.people = []; state.manual = {}; state.monthShift = {}; state.spRot = {};
      state.leave = {}; state.holidays = {}; state.rowOrder = []; state.sampleVer = 0;
      ['welcomeModal', 'headerPickModal', 'checkModal'].forEach(id => document.getElementById(id).classList.remove('show'));
      saveState(); renderAll();
    });
    await page.waitForTimeout(150);
  };
  const loadSample = async () => {
    await page.evaluate(() => document.getElementById('wSampleSmall').click());
    await page.waitForTimeout(700);
    await page.evaluate(() => { state.viewMode = 'month'; saveState(); renderAll(); });
    await page.waitForTimeout(250);
  };
  /* 把字节交给页面的 handleImportFile（走真实的 FileReader → 解析 → 应用全链路） */
  const importBytes = async (b64, name) => {
    await page.evaluate(async ({ b64, name }) => {
      const bin = atob(b64);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      handleImportFile(new File([u8], name, { type: 'application/octet-stream' }));
    }, { b64, name });
    await page.waitForTimeout(IMPORT_MS);
  };
  const importFixture = f => importBytes(fixture(f), f);
  const readState = () => page.evaluate(() => {
    const mk = Object.keys(state.manual).sort();
    const out = {};
    for (const m of mk) out[m] = Object.fromEntries(Object.entries(state.manual[m]).map(([pid, s]) => {
      const p = state.people.find(x => x.id === pid);
      return [p ? p.name : pid, s];
    }));
    return {
      people: state.people.map(p => ({ name: p.name, dept: p.dept, shift: p.shiftRule, rest: p.restRule, workId: p.workId || '' })),
      months: mk, manual: out,
      pickerOpen: document.getElementById('headerPickModal').classList.contains('show')
    };
  });

  try {
    const t0 = Date.now();
    await page.goto('http://127.0.0.1:8002/index.html', { waitUntil: 'load', timeout: 30000 });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(500);
    await page.evaluate(() => { const b = document.getElementById('wStart'); if (b) b.click(); });
    await page.waitForTimeout(300);
    console.log('页面就绪（' + (Date.now() - t0) + 'ms）\n');

    /* ---------- A1. 本工具 CSV 导出 → 再导入 ---------- */
    console.log('A. 多格式导入');
    await loadSample();
    const csvText = await page.evaluate(() => scheduleMatrix(false)
      .map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\r\n'));
    const sampleN = (await readState()).people.length;
    await reset();
    await page.evaluate(csv => handleImportFile(new File([new TextEncoder().encode(csv)], '自我导出.csv', { type: 'text/csv' })), csvText);
    await page.waitForTimeout(IMPORT_MS);
    const a1 = await readState();
    ok('A1. 本工具 CSV 导出 → 导入', a1.people.length === sampleN && a1.months.includes('2026-09'),
      '人员 ' + sampleN + '→' + a1.people.length + '，月份 ' + a1.months.join(','));

    /* ---------- A2. 真实业务表形态（双行表头 + 工号列 + 序列日期） ---------- */
    for (const [f, label] of [
      ['排班表_双行表头_序列日期.xlsx', 'XLSX 双行表头+序列日期'],
      ['排班表_双行表头_无日期格式.xlsx', 'XLSX 双行表头+裸序列号'],
      ['排班表_双行表头_文本日期.xlsx', 'XLSX 双行表头+文本日期'],
      ['排班表_双行表头.xls', 'XLS 双行表头(BIFF8)'],
      ['排班表_双行表头.csv', 'CSV 双行表头(GBK)']
    ]) {
      await reset();
      await importFixture(f);
      const st = await readState();
      const jy = st.manual['2026-09'] && st.manual['2026-09']['甲一'];
      const zj = st.manual['2026-09'] && st.manual['2026-09']['子甲'];
      const workOk = st.people.some(p => p.workId === '2610000');
      /* 甲一：1~6 白 · 7 休 · 8~13 白 · 14 休 · 15~20 白 · 21 休 · 22~27 夜 · 28 休 · 29~30 夜 */
      ok('A2. ' + label,
        st.people.length === 20 && jy && jy.slice(0, 7) === 'dddddd.' && jy[21] === 'n' && jy[24] === 'n'
          && zj && zj[0] === 'd' && workOk && !st.pickerOpen,
        '人数=' + st.people.length + ' 甲一=' + (jy ? jy.slice(0, 8) + '…' : '缺失')
          + ' 第25天=' + (jy ? jy[24] : '?') + ' 子甲首格=' + (zj ? zj[0] : '缺失') + ' 工号=' + workOk);
    }

    /* ---------- A3. 单行表头 XLSX（姓名/部门/班次规则 + 文本日期） ---------- */
    await reset();
    await importFixture('排班表_单行表头_文本日期.xlsx');
    const a3 = await readState();
    const jy3 = a3.manual['2026-09'] && a3.manual['2026-09']['甲一'];
    const cf = a3.people.find(p => p.name === '子甲');
    ok('A3. XLSX 单行表头', a3.people.length === 20 && jy3 && jy3[0] === 'd' && cf
      && cf.dept === '转码' && cf.shift === 'fixed-day',
      '人数=' + a3.people.length + ' 甲一=' + (jy3 ? jy3.slice(0, 6) + '…' : '缺失')
        + ' 子甲=' + (cf ? cf.dept + '/' + cf.shift : '缺失'));

    /* ---------- A4. HTML 伪 Excel ---------- */
    await reset();
    await page.evaluate(() => {
      let h = '<html><body><table><tr><td>某某车间排班</td></tr><tr><td>姓名</td>';
      for (let d = 1; d <= 30; d++) h += '<td>2026/9/' + d + '</td>';
      h += '</tr>';
      ['赵一', '钱二', '孙三'].forEach((nm, i) => {
        h += '<tr><td>' + nm + '</td>';
        for (let d = 1; d <= 30; d++) h += '<td>' + ((d + i) % 7 === 0 ? '休' : '白班') + '</td>';
        h += '</tr>';
      });
      h += '</table></body></html>';
      handleImportFile(new File([new TextEncoder().encode(h)], '网页导出.xls', { type: 'application/vnd.ms-excel' }));
    });
    await page.waitForTimeout(IMPORT_MS);
    const a4 = await readState();
    const zy = a4.manual['2026-09'] && a4.manual['2026-09']['赵一'];
    ok('A4. HTML 伪 Excel（.xls 实为网页表格）', a4.people.length === 3 && zy && zy[0] === 'd' && zy[6] === '.',
      '人数=' + a4.people.length + ' 赵一=' + (zy ? zy.slice(0, 8) + '…' : '缺失'));

    /* ---------- B. 写出 → 读回 round-trip ---------- */
    console.log('B. 写出 → 读回 round-trip');
    for (const fmt of ['xlsx', 'xls']) {
      await reset();
      await loadSample();
      const rt = await page.evaluate(async (f) => {
        const bytes = (f === 'xls')
          ? xlsBuild([{ name: '排班表 2026-09', rows: scheduleMatrix(true) }])
          : xlsxBuild([{ name: '排班表 2026-09', rows: scheduleMatrix(true) }]);
        /* 记录导出前的人工排班（按姓名）；导出写的是「实际排班文本」，回读应逐格等价 */
        const orig = {}, names = [];
        for (const p of state.people) { names.push(p.name); orig[p.name] = (state.manual['2026-09'] || {})[p.id] || ''; }
        const len = bytes.length;
        state.people = []; state.manual = {}; state.monthShift = {}; state.leave = {}; state.rowOrder = [];
        saveState(); renderAll();
        handleImportFile(new File([bytes], 'roundtrip.' + f, { type: 'application/octet-stream' }));
        await new Promise(r => setTimeout(r, 1300));
        const back = state.manual['2026-09'] || {};
        const lv = state.leave['2026-09'] || {};
        let withCells = 0, mismatch = 0; const bad = [];
        for (const p of state.people) {
          const got = back[p.id] || '';
          if (!got) { bad.push(p.name + '(无排班)'); continue; }
          withCells++;
          const exp = (orig[p.name] || '').split('').map((ch, i) => {
            if (lv[p.id] && lv[p.id][i + 1]) return '_';
            return ch === 'x' ? 'd' : ch === 'y' ? 'n' : ch;
          }).join('');
          if (exp && exp !== got) { mismatch++; if (bad.length < 3) bad.push(p.name + ' 期望' + exp.slice(0, 6) + ' 实得' + got.slice(0, 6)); }
        }
        return { len, n: state.people.length, want: names.length, withCells, mismatch, bad };
      }, fmt);
      ok('B. ' + fmt + ' 写出→读回', rt.n === rt.want && rt.withCells === rt.want && rt.mismatch === 0,
        rt.len + ' 字节；人员 ' + rt.want + '→' + rt.n + '，有排班 ' + rt.withCells + '，不一致 ' + rt.mismatch
          + (rt.bad.length ? '（' + rt.bad.join('；') + '）' : ''));
    }

    /* ---------- C. 导出菜单均触发下载 ---------- */
    console.log('C. 导出菜单下载');
    await reset();
    await loadSample();
    const dl = async (act) => {
      const [d] = await Promise.all([
        page.waitForEvent('download', { timeout: 8000 }).catch(() => null),
        page.evaluate(a => {
          document.getElementById('exportBtn').click();
          const b = document.querySelector('#exportMenu button[data-act="' + a + '"]');
          if (b) b.click();
        }, act)
      ]);
      return d;
    };
    for (const [act, re, label] of [
      ['csv', /^排班表_2026-09\.csv$/, 'C1. 导出 排班表 CSV'],
      ['xlsx', /^排班表_2026-09\.xlsx$/, 'C2. 导出 排班表 .xlsx'],
      ['xls', /^排班表_2026-09\.xls$/, 'C3. 导出 排班表 .xls'],
      ['stats-xlsx', /^月度统计_2026-09\.xlsx$/, 'C4. 导出 月度统计 .xlsx'],
      ['stats-xls', /^月度统计_2026-09\.xls$/, 'C5. 导出 月度统计 .xls']
    ]) {
      const d = await dl(act);
      const fn = d ? d.suggestedFilename() : '';
      ok(label, !!d && re.test(fn), fn || '未捕获下载');
      if (d && (act === 'xlsx' || act === 'xls')) {
        const out = path.join(__dirname, '_out', act === 'xls' ? 'app_schedule.xls' : 'app_schedule.xlsx');
        fs.mkdirSync(path.dirname(out), { recursive: true });
        await d.saveAs(out).catch(() => {});
      }
    }

    /* ---------- D1. 识别失败 → 出现「手动指定表头行」窗口 ---------- */
    console.log('D. 识别兜底');
    await reset();
    await page.evaluate(() => {
      const csv = ['计件汇总表', '1,2,3,4,5', '6,7,8,9,10', '11,12,13,14,15'].join('\r\n');
      handleImportFile(new File([new TextEncoder().encode(csv)], '无法识别.csv', { type: 'text/csv' }));
    });
    await page.waitForTimeout(IMPORT_MS);
    const pick = await page.evaluate(() => ({
      open: document.getElementById('headerPickModal').classList.contains('show'),
      rows: document.querySelectorAll('#hpTable tr.hp-row').length,
      okDisabled: document.getElementById('hpOk').disabled
    }));
    ok('D1. 识别失败弹出「手动指定表头行」', pick.open && pick.rows === 4 && pick.okDisabled,
      '窗口=' + pick.open + ' 可选行=' + pick.rows + ' 未选行时按钮禁用=' + pick.okDisabled);

    /* ---------- D2. 在窗口里点选表头行 → 按该行解析并完成导入 ---------- */
    await reset();
    const picked = await page.evaluate(async () => {
      const rows = [
        ['某某车间排班明细'],
        ['姓名', '部门', '9/1', '9/2', '9/3', '9/4', '9/5', '9/6', '9/7'],
        ['王五', '除气', '白班', '休', '白班', '白班', '白班', '白班', '休'],
        ['李六', '转码', '夜班', '夜班', '休', '夜班', '夜班', '夜班', '夜班']
      ];
      openHeaderPicker(rows, { kind: '测试' });        /* 走真实的兜底弹窗 */
      await new Promise(r => setTimeout(r, 100));
      document.querySelector('#hpTable tr[data-r="1"]').click();
      await new Promise(r => setTimeout(r, 100));
      const enabled = !document.getElementById('hpOk').disabled;
      document.getElementById('hpOk').click();          /* 用选中的第 2 行解析 */
      await new Promise(r => setTimeout(r, 1300));
      const back = state.manual['2026-09'] || {};
      const w = state.people.find(p => p.name === '王五');
      const l = state.people.find(p => p.name === '李六');
      return { enabled, n: state.people.length, wang: w ? (back[w.id] || '') : '', li: l ? (back[l.id] || '') : '' };
    });
    ok('D2. 选表头行后按该行解析成功', picked.enabled && picked.n === 2
      && picked.wang.slice(0, 7) === 'd.dddd.' && picked.li.slice(0, 7) === 'nn.nnnn',
      '人数=' + picked.n + ' 王五=' + picked.wang.slice(0, 7) + ' 李六=' + picked.li.slice(0, 7));

    /* ---------- E. 0 控制台错误 ---------- */
    ok('E. 0 控制台/页面错误', errs.length === 0, errs.length ? errs.slice(0, 3).join(' | ') : '');

  } catch (e) {
    ok('流程异常', false, e.message);
    await page.screenshot({ path: '_import_fail.png' }).catch(() => {});
  }

  await browser.close();
  const pass = results.filter(r => r.pass).length;
  console.log('\n结果: ' + pass + '/' + results.length + ' 通过' + (pass === results.length ? ' 🎉' : ''));
  process.exit(pass === results.length ? 0 : 1);
})();
