// 一键测试：启动一个服务器，依次运行全部双人/单人测试，再运行安全测试
const { spawn, spawnSync } = require('child_process');
const path = require('path');

const PORT = process.env.TEST_PORT || '3917';
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const tests = ['solo-campaign.js', 'mp-two-clients.js', 'mp-ui.js', 'finale-chat.js'];

(async () => {
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: Object.assign({}, process.env, { PORT, RATE_MAX: '100000', CREATE_PER_10MIN: '100000' }),
    stdio: ['ignore', 'inherit', 'inherit']
  });
  let failed = [];
  try {
    let up = false;
    for (let i = 0; i < 50 && !up; i++) {
      try { up = (await fetch(`${BASE}/healthz`)).ok; } catch (err) { await sleep(100); }
    }
    if (!up) throw new Error('服务器没有启动');
    for (const t of tests) {
      console.log(`\n===== ${t} =====`);
      const r = spawnSync(process.execPath, [path.join(__dirname, t)], {
        env: Object.assign({}, process.env, { TD_BASE: BASE }),
        encoding: 'utf8', timeout: 180000
      });
      process.stdout.write(r.stdout || '');
      process.stderr.write(r.stderr || '');
      if (r.status !== 0) failed.push(t);
    }
  } finally {
    server.kill();
  }
  console.log('\n===== security.js =====');
  const sec = spawnSync(process.execPath, [path.join(__dirname, 'security.js')], { encoding: 'utf8', timeout: 120000 });
  process.stdout.write(sec.stdout || '');
  process.stderr.write(sec.stderr || '');
  if (sec.status !== 0) failed.push('security.js');
  console.log(failed.length ? `\n失败的测试：${failed.join(', ')}` : '\n全部测试通过');
  process.exit(failed.length ? 1 : 0);
})();
