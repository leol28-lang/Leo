// 双人测试：联网最终战 + 结局动画同步；房间聊天；快捷语音
const vm = require('vm'), fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'public', 'index.html'), 'utf8');
const js = html.match(/<script>([\s\S]*)<\/script>/)[1];
const BASE = process.env.TD_BASE || 'http://127.0.0.1:3000';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function ctxStub() {
  const t = {};
  return new Proxy(t, {
    get(o, k) {
      if (!(k in o)) {
        if (k === 'measureText') o[k] = () => ({ width: 10 });
        else if (k === 'createRadialGradient' || k === 'createLinearGradient') o[k] = () => ({ addColorStop() {} });
        else o[k] = () => {};
      }
      return o[k];
    },
    set(o, k, v) { o[k] = v; return true; }
  });
}
function mkEl() {
  const cls = new Set();
  return {
    _cls: cls, style: {},
    classList: { add: c => cls.add(c), remove: c => cls.delete(c), toggle: (c, f) => { const on = f === undefined ? !cls.has(c) : !!f; on ? cls.add(c) : cls.delete(c); return on; }, contains: c => cls.has(c) },
    dataset: {}, appendChild(c) { return c; }, append() {}, remove() {}, querySelectorAll() { return []; }, closest() { return null; },
    addEventListener() {}, getBoundingClientRect() { return { left: 0, top: 0, width: 960, height: 600 }; },
    getContext() { return ctxStub(); }, clientWidth: 900, clientHeight: 600, width: 0, height: 0, innerHTML: '', textContent: '',
    checked: false, offsetWidth: 284, offsetHeight: 320, value: '', disabled: false, drawImage() {}, scrollTop: 0, scrollHeight: 0
  };
}
const HIDDEN_IDS = new Set();
for (const m of html.matchAll(/<[^>]*>/g)) {
  const tag = m[0];
  const id = (/id="([^"]+)"/.exec(tag) || [])[1];
  if (id && /class="[^"]*\bhidden\b[^"]*"/.test(tag)) HIDDEN_IDS.add(id);
}
function makeClient(name) {
  const els = {}; const store = new Map();
  const sandbox = {
    document: { getElementById: id => els[id] || (els[id] = (() => { const e = mkEl(); if (HIDDEN_IDS.has(id)) e.classList.add('hidden'); return e; })()), querySelectorAll: () => [], createElement: () => mkEl(), activeElement: null },
    window: { addEventListener() {}, devicePixelRatio: 1, innerWidth: 1200, innerHeight: 800 },
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    performance: { now: () => 1000 }, requestAnimationFrame() { return 1; }, cancelAnimationFrame() {},
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    fetch: (url, opts) => fetch(BASE + url, opts), console, JSON, Math, Date, Number, String, Set, Map, Promise, Object, Array, Error,
  };
  vm.createContext(sandbox); vm.runInContext(js, sandbox);
  const R = c => vm.runInContext(c, sandbox);
  const $el = id => sandbox.document.getElementById(id);
  return { name, R, $el, setVal: (id, v) => { $el(id).value = v; }, tick: () => R('mpTick()'), store };
}

const results = [];
const check = (label, ok, extra) => results.push([ok ? 'PASS' : 'FAIL', label, extra === undefined ? '' : JSON.stringify(extra)]);
const sync = async (H, G) => { await H.tick(); await G.tick(); await H.tick(); await G.tick(); };
const tapEv = (i) => `({ target: { classList: { contains: () => ${i === undefined ? 'false' : 'true'} }, dataset: { i: '${i}' }, closest: () => null }, clientX: 100, clientY: 120 })`;

(async () => {
  const H = makeClient('host'), G = makeClient('guest');
  // ---------- 联网对局：第七章 → 结局 → 最终战 → 胜利 ----------
  H.setVal('mpName', '房主'); await H.R('mpCreate()');
  const code = H.R('MP.code');
  G.setVal('mpName', '小红'); G.setVal('mpCode', code); await G.R('mpJoin()');
  await H.tick(); await G.tick();
  // 房主选择第七章、普通难度后开始
  H.setVal('mpMap', '6'); H.setVal('mpDiff', 'normal'); await H.R("mpStartGame()");
  await G.tick();
  check('both on chapter 7', H.R('S.mapIdx') === 6 && G.R('S.mapIdx') === 6, { h: H.R('S.mapIdx'), g: G.R('S.mapIdx') });

  // 房主赢下第七章 → 结局动画
  H.R('S.won = true; S.waveActive = false; startEnding();');
  await sync(H, G);
  check('ending overlay on host', H.R("FIN.mode") === 'ending');
  check('ending mirrored to guest', G.R("FIN.mode") === 'ending', G.R('FIN.mode'));
  check('guest cannot skip ending', G.R("$('finSkip').classList.contains('hidden')") === true);

  // 结局结束 → 最终战第一段
  H.R('endEnding()');
  await sync(H, G);
  check('gauntlet started on host', H.R('S.gauntlet === true && G.stage === 0') === true, { g: H.R('S.gauntlet'), stage: H.R('G && G.stage') });
  check('gauntlet flag mirrored to guest', G.R('S.gauntlet === true && G.stage === 0') === true, { g: G.R('!!S.gauntlet'), stage: G.R('G && G.stage') });
  check('guest HUD mode not finale', G.R('FIN.mode') === null);

  // 第二段：房主在本地完成一段 → 进入下一段（模拟 onStageCleared 的结果）
  H.R('G.hp = 3; G.stage = 3; gauntletStage();');
  await sync(H, G);
  check('guest follows stage 4 map', G.R('S.gStage') === 3 && G.R('S.mapIdx') === H.R('S.mapIdx'), { gs: G.R('S.gStage'), idx: G.R('S.mapIdx') });
  check('guest G hp mirrored', G.R('G && G.hp') === 3, G.R('G && G.hp'));

  // 最终一击前的互动：房主血量归零 → 触发最终战互动
  H.R('G.hp = 0; startQTE();');
  await sync(H, G);
  check('qte mode on host', H.R('FIN.mode') === 'qte' && H.R('FIN.phase') === 'grab');
  check('qte mirrored to guest', G.R('FIN.mode') === 'qte' && G.R('FIN.phase') === 'grab', G.R('FIN.phase'));
  // 抓取动画结束 → 出现防御卡（房主判定）
  H.R('FIN.pt = 3.1; runQTE(0.01);');
  await sync(H, G);
  const N = H.R('FIN.N');
  check('host spawned targets', H.R('FIN.targets.length') === N && N > 0, { N, t: H.R('FIN.targets.length') });
  check('guest sees same targets', G.R('FIN.targets.length') === N, { g: G.R('FIN.targets.length') });
  check('guest never spawns targets locally', G.R('FIN.phase') === 'targets');
  // 客人点击前两个防御卡 → 发送给房主 → 房主判定
  G.R(`onFinTap(${tapEv(0)}); onFinTap(${tapEv(1)});`);
  await sleep(80); await sync(H, G);
  check('host applied two guest taps', H.R('FIN.remain') === N - 2, { remain: H.R('FIN.remain') });
  check('guest targets updated', G.R('FIN.targets.filter(t => t.alive).length') === N - 2, G.R('FIN.targets.filter(t => t.alive).length'));
  // 同一个防御卡重复点击不会重复计数
  G.R(`onFinTap(${tapEv(0)});`); await sleep(60); await H.tick();
  check('duplicate tap ignored', H.R('FIN.remain') === N - 2, { remain: H.R('FIN.remain') });
  // 剩下的全部点掉
  const rest = [];
  for (let i = 2; i < N; i++) rest.push(`onFinTap(${tapEv(i)});`);
  G.R(rest.join(' '));
  await sleep(80); await sync(H, G);
  check('host entered shock phase', H.R('FIN.phase') === 'shock', H.R('FIN.phase'));
  check('guest entered shock phase', G.R('FIN.phase') === 'shock', G.R('FIN.phase'));
  // 电击连点
  const need = H.R('FIN.need');
  G.R(`for (let k = 0; k < ${need}; k++) onFinTap(${tapEv()});`);
  await sleep(120); await sync(H, G);
  check('host shock taps counted', H.R('FIN.taps') === need && H.R('FIN.phase') === 'final', { taps: H.R('FIN.taps'), phase: H.R('FIN.phase') });
  check('guest final-blow phase', G.R('FIN.phase') === 'final');
  // 最后一击
  G.R(`onFinTap(${tapEv()});`); await sleep(60); await sync(H, G);
  check('host flash after final blow', H.R('FIN.phase') === 'flash');
  check('guest flash after final blow', G.R('FIN.phase') === 'flash');
  // 闪回结束 → 真正胜利（房主判定）；客人不能自己触发胜利
  G.R('FIN.pt = 3.6; runQTE(0.01);');
  check('guest does not self-trigger victory', G.R('FIN.mode') === 'qte');
  H.R('FIN.pt = 3.6; runQTE(0.01);');
  check('host victory mode', H.R('FIN.mode') === 'victory' && H.R('progress.final') === true);
  await sync(H, G);
  check('victory mirrored to guest', G.R('FIN.mode') === 'victory', G.R('FIN.mode'));
  check('victory next button visible on guest', G.R("$('finNext').classList.contains('hidden')") === false);
  // 返回首页
  H.R('endVictory()');
  await sync(H, G);
  check('overlay closed on guest after host returns home', G.R('FIN.mode') === null && G.R("$('fin').classList.contains('hidden')") === true);

  // ---------- 聊天 ----------
  await H.tick();
  const sysJoin = H.R("MP.chat.some(m => m.k === 'sys' && /小红 加入了房间/.test(m.x))");
  check('join system message reached host', sysJoin);
  H.R("chatToggle(false)");
  await H.R("chatSendText('大家好，一起守住！', false)"); await sleep(60); await G.tick();
  check('chat delivered to guest', G.R("MP.chat.some(m => m.k === 'chat' && m.x === '大家好，一起守住！')"));
  check('guest unread counted while box closed', G.R('MP.unread') >= 1, G.R('MP.unread'));
  G.R('chatToggle(true)');
  check('opening chat clears unread', G.R('MP.unread') === 0);
  check('chat list rendered', G.R("$('chatList').innerHTML.includes('大家好')"));
  // 文本安全（不把 HTML 当标签）
  await G.R("chatSendText('<img src=x onerror=1>', false)"); await sleep(60); await H.tick();
  check('html escaped in chat render', H.R("MP.chat.some(m => m.x === '<img src=x onerror=1>')") && (G.R("chatRender(); $('chatList').innerHTML.includes('&lt;img')") === true));
  // 长度与频率限制
  const tooLong = await H.R("mpApi('chat', { code: MP.code, pid: MP.pid, text: 'x'.repeat(61) })").then(() => 'ok', e => e.message);
  check('too-long message rejected', /最多 60/.test(tooLong), tooLong);
  let rateErr = null;
  for (let k = 0; k < 8; k++) {
    try { await H.R("mpApi('chat', { code: MP.code, pid: MP.pid, text: '刷屏' + " + k + " })"); }
    catch (e) { rateErr = e.message; }
  }
  check('rate limit on rapid messages', /太快/.test(rateErr || ''), rateErr);
  await sleep(60); await H.tick();

  // ---------- 快捷语音 ----------
  const fresh = makeClient('fresh');
  fresh.R('qkRenderUI()');
  check('quick phrases off by default', fresh.R("QK.on") === false && fresh.$el('quickBtn').classList.contains('hidden'));
  // 只有 1 条：直接发送
  G.R("QK.on = true; QK.list = ['就这么办！']; qkSave();");
  check('quick button shown when on', G.R("!$('quickBtn').classList.contains('hidden')"));
  G.R('chatToggle(true); qkPick();');
  check('single phrase sends directly (no menu)', G.R("$('qkPop').classList.contains('hidden')") === true);
  await sleep(80); await H.tick();
  check('single quick phrase reached host', H.R("MP.chat.some(m => m.k === 'quick' && m.x === '就这么办！')"));
  // 多条：弹出菜单
  G.R("QK.list = ['快看这里！', '顶住！', '谢谢！']; qkSave();");
  G.R('qkPick();');
  check('multiple phrases open menu', G.R("!$('qkPop').classList.contains('hidden') && $('qkPop').innerHTML.includes('data-q=\"2\"')"));
  G.$el('qkPop').onclick({ target: { closest: () => ({ dataset: { q: '2' } }) } });
  await sleep(80); await H.tick();
  check('menu choice sent', H.R("MP.chat.some(m => m.k === 'quick' && m.x === '谢谢！')"));
  check('menu closed after choosing', G.R("$('qkPop').classList.contains('hidden')") === true);
  // 设置保存
  const saved = G.store.get('td_quick_v1');
  check('quick settings persisted', saved && JSON.parse(saved).list.length === 3, saved);
  const reloaded = makeClient('reload');
  reloaded.store.set('td_quick_v1', saved);
  reloaded.R('QK = qkLoad()');
  check('quick settings reload', reloaded.R('QK.list.length') === 3 && reloaded.R('QK.on') === true);
  // 离开后聊天入口隐藏
  await G.R('mpLeave()');
  await sleep(60); await H.tick();
  check('leave message reached host', H.R("MP.chat.some(m => m.k === 'sys' && /小红 离开了房间/.test(m.x))") || H.R("MP.chat.some(m => m.k === 'sys' && /离开/.test(m.x))"));
  check('chat button hidden after leaving', G.$el('chatBtn').classList.contains('hidden') === true);
  await H.R('mpLeave()');

  for (const r of results) console.log(r[0], r[1], r[2]);
  const fails = results.filter(r => r[0] === 'FAIL').length;
  console.log(fails ? `FAILED ${fails} of ${results.length}` : `ALL PASS ${results.length}`);
})().catch(e => { console.error('TEST CRASH', e); process.exit(1); });
