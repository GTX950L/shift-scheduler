/* pw.js —— e2e 测试浏览器解析（v1.44 新增）
   兼容两种安装：优先 require('playwright')，失败回退 playwright-core；
   并自动探测本机 ms-playwright 缓存的最新 chromium，注入 executablePath。
   → smoke.js / verify_*.js 只需 require('./pw')，无需预先安装完整 playwright。 */
const fs = require('fs');
const path = require('path');

let pw = null;
for (const name of ['playwright', 'playwright-core']) {
  try { pw = require(name); break; } catch (e) { /* 尝试下一个 */ }
}
if (!pw) {
  console.error('✗ 未找到 playwright / playwright-core。\n  安装其一即可：\n    npm i -D playwright        （然后 npx playwright install chromium）\n    npm i -D playwright-core   （配合本机已有 ms-playwright 浏览器缓存）');
  process.exit(2);
}

/* 在 ms-playwright 缓存目录中挑选版本号最大的 chromium（headless shell 优先同级可用者） */
function pickExe() {
  const roots = [];
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) roots.push(process.env.PLAYWRIGHT_BROWSERS_PATH);
  if (process.env.LOCALAPPDATA) roots.push(path.join(process.env.LOCALAPPDATA, 'ms-playwright'));
  if (process.env.USERPROFILE) roots.push(path.join(process.env.USERPROFILE, 'AppData', 'Local', 'ms-playwright'));
  let best = null, bestV = -1;
  for (const r of roots) {
    if (!fs.existsSync(r)) continue;
    let dirs = [];
    try { dirs = fs.readdirSync(r); } catch (e) { continue; }
    for (const dir of dirs) {
      const m = /^chromium(?:_headless_shell)?-(\d+)$/.exec(dir);
      if (!m) continue;
      const v = +m[1];
      const p = path.join(r, dir,
        dir.includes('headless_shell')
          ? 'chrome-headless-shell-win64/chrome-headless-shell.exe'
          : 'chrome-win64/chrome.exe');
      if (fs.existsSync(p) && v > bestV) { bestV = v; best = p; }
    }
  }
  return best;
}

const exe = pickExe();
const origLaunch = pw.chromium.launch.bind(pw.chromium);
pw.chromium.launch = (opts = {}) => origLaunch(exe ? Object.assign({}, opts, { executablePath: exe }) : opts);

/* 便捷动作：点工具栏「⋯ 更多」里的某一项（v1.46 起低频操作收进该菜单）。
   一律用 evaluate 直接 .click()——被弹窗遮挡时 page.click 会白等 30s。 */
pw.moreAction = async (page, act, waitMs = 400) => {
  await page.evaluate(a => {
    const mb = document.getElementById('moreBtn');
    if (mb) mb.click();
    const b = document.querySelector('#moreMenu button[data-act="' + a + '"]');
    if (b) b.click();
  }, act);
  await page.waitForTimeout(waitMs);
};
/* 便捷动作：点「⬇ 导出」或「⬆ 导入」菜单里的某一项 */
pw.menuAction = async (page, menu, act, waitMs = 400) => {
  await page.evaluate(({ menu, act }) => {
    const btn = document.getElementById(menu === 'import' ? 'importBtn' : 'exportBtn');
    if (btn) btn.click();
    const b = document.querySelector('#' + (menu === 'import' ? 'importMenu' : 'exportMenu') + ' button[data-act="' + act + '"]');
    if (b) b.click();
  }, { menu, act });
  await page.waitForTimeout(waitMs);
};
/* 便捷动作：导入后确认「导入预览」（v1.46 起导入前会先弹识别结果预览）。
   返回是否确实点了确认；若没有预览弹出（例如走了兜底路径）返回 false。 */
pw.confirmImport = async (page, waitMs = 400) => {
  const clicked = await page.evaluate(() => {
    const m = document.getElementById('importPreviewModal');
    if (!m || !m.classList.contains('show')) return false;
    const b = document.getElementById('ipOk');
    if (b) b.click();
    return true;
  });
  await page.waitForTimeout(waitMs);
  return clicked;
};
module.exports = pw;
