const vm = require('vm'), fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'public', 'index.html'), 'utf8');
const js = html.match(/<script>([\s\S]*)<\/script>/)[1];
const BASE = process.env.TD_BASE || 'http://127.0.0.1:3000';
const sleep = ms => new Promise(r => setTimeout(r, ms));
function ctxStub() { const t = {}; return new Proxy(t, { get(o, k) { if (!(k in o)) { if (k === 'measureText') o[k] = () => ({ width: 10 }); else if (k === 'createRadialGradient' || k === 'createLinearGradient') o[k] = () => ({ addColorStop() {} }); else o[k] = () => {}; } return o[k]; }, set(o, k, v) { o[k] = v; return true; } }); }
function mkEl() { const cls = new Set(); return { _cls: cls, style: {}, classList: { add: c => cls.add(c), remove: c => cls.delete(c), toggle: (c, f) => { const on = f === undefined ? !cls.has(c) : !!f; on ? cls.add(c) : cls.delete(c); return on; }, contains: c => cls.has(c) }, dataset: {}, appendChild(c) { return c; }, append() {}, remove() {}, querySelectorAll() { return []; }, closest() { return null; }, addEventListener() {}, getBoundingClientRect() { return { left: 0, top: 0, width: 960, height: 600 }; }, getContext() { return ctxStub(); }, clientWidth: 900, clientHeight: 600, width: 0, height: 0, innerHTML: '', textContent: '', checked: false, offsetWidth: 284, offsetHeight: 320, value: '', disabled: false, drawImage() {} }; }
function makeClient(name) {
  const els = {}; const store = new Map();
  const sandbox = {
    document: { getElementById: id => els[id] || (els[id] = mkEl()), querySelectorAll: () => [], createElement: () => mkEl(), activeElement: null },
    window: { addEventListener() {}, devicePixelRatio: 1, innerWidth: 1200, innerHeight: 800 },
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    performance: { now: () => 1000 }, requestAnimationFrame() { return 1; }, cancelAnimationFrame() {},
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    fetch: (url, opts) => fetch(BASE + url, opts), console, JSON, Math, Date, Number, String, Set, Map, Promise, Object, Array, Error,
  };
  vm.createContext(sandbox); vm.runInContext(js, sandbox);
  const R = c => vm.runInContext(c, sandbox);
  const elv = (id, v) => { $el(id).value = v; };
  function $el(id) { return sandbox.document.getElementById(id); }
  return { name, R, els, setVal: (id, v) => { $el(id).value = v; }, tick: () => R('mpTick()') };
}
const results = []; const check = (label, ok, extra) => { results.push([ok ? 'PASS' : 'FAIL', label, extra === undefined ? '' : JSON.stringify(extra)]); };

(async () => {
  const H = makeClient('host'), G = makeClient('guest');
  // 1. 房主创建房间
  H.setVal('mpName', '房主'); await H.R('mpCreate()');
  const code = H.R('MP.code');
  check('host created room', !!code && H.R('MP.role') === 'host', { code });
  H.R('MP.seatSig'); // ensure exists
  // 2. 房主把座位数改为 3（座位 1 AI，座位 2 AI）
  await H.R("mpConfig({ seatCount: 3 })");
  check('seat count 3', H.R('MP.room.seatCount') === 3, H.R('MP.room.seatCount'));
  check('seat 1 and 2 are AI', H.R("MP.room.seats.filter(s=>s.state==='ai').length") === 2);
  // 3. 队员加入
  G.setVal('mpName', '小红'); G.setVal('mpCode', code); await G.R('mpJoin()');
  check('guest joined as guest', G.R('MP.role') === 'guest' && G.R('MP.code') === code, G.R('MP.role'));
  await H.tick();
  check('host sees 2 humans', H.R('mpHumanCount()') === 2, H.R('mpHumanCount()'));
  // 4. 房主关闭座位 2 再开放回 AI（测试座位切换）
  await H.R("mpConfig({ seat: 2, state: 'closed' })");
  check('seat 2 closed', H.R("MP.room.seats[2].state") === 'closed');
  await H.R("mpConfig({ seat: 2, state: 'ai' })");
  check('seat 2 back to AI', H.R("MP.room.seats[2].state") === 'ai');
  // 5. 房主开始游戏（地图 0，普通）
  H.setVal('mpMap', '0'); H.setVal('mpDiff', 'normal');
  await H.R('mpStartGame()');
  check('host playing', H.R('MP.playing') === true && H.R('S.mapIdx') === 0);
  // 6. 队员 tick：加入对局
  await G.tick();
  check('guest auto-joined round', G.R('MP.playing') === true && G.R('S.mapIdx') === 0, { round: G.R('MP.round') });
  // 7. 房主在本地放两座塔，快照同步到队员
  H.R("S.gold = 500");
  const spot = H.R('mpBuildSpots()[0]');
  H.R(`S.selType='arrow'; placeTower(${spot.r}, ${spot.c})`);
  check('host placed tower locally', H.R('S.towers.length') === 1);
  await H.tick();        // 发送快照
  await G.tick();        // 队员接收
  check('guest sees host tower via snapshot', G.R('S.towers.length') === 1, G.R('S.towers.length'));
  check('guest gold synced to shared pool', G.R('S.gold') === H.R('S.gold'), { g: G.R('S.gold'), h: H.R('S.gold') });
  // 8. 队员尝试在同一格放塔（应被房主拒绝），再在另一格放塔
  G.R(`S.selType='cannon'; placeTower(${spot.r}, ${spot.c})`);
  const spot2 = H.R('mpBuildSpots()[1]');
  G.R(`S.selType='cannon'; placeTower(${spot2.r}, ${spot2.c})`);
  await sleep(60);
  await H.tick();        // 房主取得操作并执行
  check('host applied guest placement at new spot only', H.R('S.towers.length') === 2, H.R('S.towers.map(t=>t.type)'));
  check('guest selection not overwritten by snapshot', (await (async () => { await H.tick(); await G.tick(); return G.R("S.selType"); })()) === 'cannon');
  check('guest sees 2 towers', G.R('S.towers.length') === 2, G.R('S.towers.length'));
  // 9. 光标：队员悬停，房主能看到
  G.R(`MP.myHover = {r:${spot2.r}, c:${spot2.c}}`);
  await G.tick(); await H.tick();
  check('host sees guest hover', H.R('MP.hovers.some(h => h.seat === 1)'), H.R('MP.hovers'));
  check('guest sees own hover not as ghost', G.R('MP.hovers.some(h => h.seat === mpMySeat())') === true);
  // 10. 队员请求开始下一波
  G.R('startWave()');
  await sleep(60); await H.tick();
  check('host started wave from guest request', H.R('S.waveActive') === true);
  // 11. AI 队友在房主端行动（用模拟时间推进）
  const goldBefore = H.R('S.gold');
  H.R('S.gold = 2000');
  const towersBefore = H.R('S.towers.length');
  for (let i = 0; i < 40; i++) H.R('mpAITick(0.5)');
  check('AI seats built/upgraded on host', H.R('S.towers.length') > towersBefore || H.R('S.towers.some(t=>t.picks.length>0)'), { before: towersBefore, after: H.R('S.towers.length') });
  // 12. 房主的快照同步后，队员的弹窗/状态一致
  await H.tick(); await G.tick();
  check('guest towers match host after AI', G.R('S.towers.length') === H.R('S.towers.length'), { g: G.R('S.towers.length'), h: H.R('S.towers.length') });
  // 13. 房主离开 → 队员收到房间关闭
  await H.R('mpLeave()');
  await G.tick();
  check('guest notified room closed', G.R('MP.code') === null, G.R('MP.code'));
  // 14. 清理
  for (const r of results) console.log(r[0], r[1], r[2]);
  const fails = results.filter(r => r[0] === 'FAIL').length;
  console.log(fails ? `FAILED ${fails}` : 'ALL PASS', results.length);
})().catch(e => { console.error('TEST CRASH', e); process.exit(1); });
