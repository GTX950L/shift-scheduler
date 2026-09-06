/* run-tests.js —— 一键回归测试（v1.44 新增）
   自动起本地静态服务(127.0.0.1:8002)，依次运行项目三套端到端测试：
   smoke.js（冒烟 18 项）→ verify_sprot.js（指定转班日 9 项）→ verify_142.js（v1.42 便捷功能 22 项）。
   用法：npm run test:all   （需先安装 playwright 或 playwright-core，见 README「回归测试」）
   浏览器解析与本地缓存探测见 pw.js。
   注意：必须用异步 spawn（不能 spawnSync）—— 同步等待会阻塞事件循环，测试期间的 HTTP 请求将无响应。 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = __dirname;
const PORT = 8002;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const fp = path.normalize(path.join(ROOT, urlPath === '/' ? '/index.html' : urlPath));
  if (fp !== ROOT && !fp.startsWith(ROOT + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(fp, (err, buf) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream' });
    res.end(buf);
  });
});
server.on('error', e => {
  if (e.code === 'EADDRINUSE') { console.error('✗ 端口 ' + PORT + ' 已被占用，请先关闭占用进程（如旧的 http.server 8002）再运行'); process.exit(1); }
  throw e;
});

function runOne(file, name) {
  return new Promise(resolve => {
    console.log('\n===== ' + name + '（' + file + '）=====');
    const c = spawn(process.execPath, [path.join(ROOT, file)], { stdio: 'inherit', cwd: ROOT });
    c.on('close', code => resolve(code === 0));
    c.on('error', e => { console.error('✗ 启动失败: ' + e.message); resolve(false); });
  });
}

server.listen(PORT, '127.0.0.1', async () => {
  console.log('🖥  测试服务 http://127.0.0.1:' + PORT + '/ 已启动');
  const tests = [
    ['smoke.js', '冒烟测试'],
    ['verify_sprot.js', '人员级指定转班日'],
    ['verify_142.js', 'v1.42 便捷功能']
  ];
  let failed = 0;
  for (const [file, name] of tests) {
    if (!fs.existsSync(path.join(ROOT, file))) { console.log('✗ 缺少 ' + file); failed++; continue; }
    if (!(await runOne(file, name))) failed++;
  }
  server.close();
  console.log('\n' + (failed ? '✗ ' + failed + ' 套未通过' : '✅ 3/3 套回归测试全部通过'));
  process.exit(failed ? 1 : 0);
});
