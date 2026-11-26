// 安全与限额测试：单独启动一个服务器，把限额调小来验证
const { spawn } = require('child_process');
const path = require('path');

const PORT = 3931;
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (label, ok, extra) => results.push([ok ? 'PASS' : 'FAIL', label, extra === undefined ? '' : JSON.stringify(extra)]);

async function post(name, body, raw) {
  const res = await fetch(`${BASE}/api/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw !== undefined ? raw : JSON.stringify(body || {})
  });
  let data = null;
  try { data = await res.json(); } catch (err) {}
  return { status: res.status, data };
}

(async () => {
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: Object.assign({}, process.env, { PORT: String(PORT), RATE_MAX: '5', MAX_ROOMS: '1' }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  server.stdout.on('data', d => { log += d; });
  server.stderr.on('data', d => { log += d; });
  try {
    let up = false;
    for (let i = 0; i < 50 && !up; i++) {
      try { const r = await fetch(`${BASE}/healthz`); up = r.ok; } catch (err) { await sleep(100); }
    }
    check('server starts and reports health', up);

    const home = await fetch(`${BASE}/`);
    const html = await home.text();
    check('home page served', home.status === 200 && html.includes('<html'), home.status);
    check('security header set', home.headers.get('x-content-type-options') === 'nosniff');
    const nf = await fetch(`${BASE}/no-such-page`);
    check('unknown path is 404', nf.status === 404);

    // 1. 非法 JSON（这一次调用计入限流）
    const bad = await post('create', null, '{not json');
    check('invalid JSON rejected', bad.status === 400, bad.status);

    // 2. 创建房间，名字里有控制字符，应被清理
    const created = await post('create', { name: 'A\u0001B\u0007C' });
    check('create room', created.status === 200 && !!created.data.code, created.status);
    check('control chars removed from name', created.data.room && created.data.room.seats[0].name === 'ABC', created.data.room && created.data.room.seats[0].name);

    // 3. 房间上限 = 1，第二个房间应被拒绝
    const second = await post('create', { name: 'x' });
    check('room cap enforced', second.status === 400 && /房间已满/.test(second.data.error || ''), second.data);

    // 4. 超过频率上限（RATE_MAX=5），第 6 次调用应返回 429
    const fifth = await post('join', { code: 'ZZZZ', name: 'y' });   // 第 4 次调用
    const sixth = await post('join', { code: 'ZZZZ', name: 'y' });   // 第 5 次调用
    const seventh = await post('join', { code: 'ZZZZ', name: 'y' }); // 第 6 次，应被限流
    check('rate limit returns 429', seventh.status === 429, { fifth: fifth.status, sixth: sixth.status, seventh: seventh.status });

  } catch (err) {
    check('security test crashed', false, err.message);
  } finally {
    server.kill();
  }

  // 大请求体检查：单独起一个不受限流影响的服务器
  const big = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: Object.assign({}, process.env, { PORT: String(PORT + 1), RATE_MAX: '1000' }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  try {
    const base2 = `http://127.0.0.1:${PORT + 1}`;
    let up = false;
    for (let i = 0; i < 50 && !up; i++) {
      try { const r = await fetch(`${base2}/healthz`); up = r.ok; } catch (err) { await sleep(100); }
    }
    const payload = JSON.stringify({ name: 'x', junk: 'a'.repeat(2 * 1024 * 1024) });
    const res = await fetch(`${base2}/api/create`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload });
    check('oversized body rejected with 413', res.status === 413, res.status);
    const ok = await fetch(`${base2}/api/create`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'ok' }) });
    check('server still works after oversized request', ok.status === 200, ok.status);
  } catch (err) {
    check('big body test crashed', false, err.message);
  } finally {
    big.kill();
  }

  for (const r of results) console.log(r[0], r[1], r[2]);
  const fails = results.filter(r => r[0] === 'FAIL').length;
  console.log(fails ? `FAILED ${fails} of ${results.length}` : `ALL PASS ${results.length}`);
  process.exit(fails ? 1 : 0);
})();
