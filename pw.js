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
module.exports = pw;
