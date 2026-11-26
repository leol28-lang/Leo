const vm=require('vm'),fs=require('fs');
const html=fs.readFileSync(require('path').join(__dirname, '..', 'public', 'index.html'), 'utf8');
const js=html.match(/<script>([\s\S]*)<\/script>/)[1];
function ctxStub(){const t={};return new Proxy(t,{get(o,k){if(!(k in o)){if(k==='measureText')o[k]=()=>({width:10});else if(k==='createRadialGradient'||k==='createLinearGradient')o[k]=()=>({addColorStop(){}});else o[k]=()=>{};}return o[k];},set(o,k,v){o[k]=v;return true;}});}
function mkEl(){const cls=new Set();return {_cls:cls,style:{},classList:{add:c=>cls.add(c),remove:c=>cls.delete(c),toggle:(c,f)=>{const on=f===undefined?!cls.has(c):!!f;on?cls.add(c):cls.delete(c);return on},contains:c=>cls.has(c)},dataset:{},appendChild(c){return c},append(){},remove(){},querySelectorAll(){return []},closest(){return null},addEventListener(){},getBoundingClientRect(){return {left:0,top:0,width:960,height:600}},getContext(){return ctxStub()},clientWidth:900,clientHeight:600,width:0,height:0,innerHTML:'',textContent:'',checked:false,offsetWidth:284,offsetHeight:320,value:'',disabled:false,drawImage(){}};}
const els={}; const store=new Map(); const clock={now:1000};
const sandbox={__store:store,document:{getElementById:id=>els[id]||(els[id]=mkEl()),querySelectorAll:()=>[],createElement:()=>mkEl()},window:{addEventListener(){},devicePixelRatio:1,innerWidth:1200,innerHeight:800},localStorage:{getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)},performance:{now:()=>clock.now},requestAnimationFrame(){return 1},cancelAnimationFrame(){},setTimeout:()=>1,clearTimeout(){},console};
vm.createContext(sandbox); vm.runInContext(js,sandbox);
const R=c=>vm.runInContext(c,sandbox);
const out={}; const errs=[];
const tryR=(label,c)=>{ try{ return R(c);}catch(e){ errs.push(label+': '+e.message); return null; } };
out.mapCount=R('MAPS.length');
// 第七章路径检查
R('newGame(6,"normal")');
out.ch7={pathLen:R('LV.path.length'), unique:R('new Set(LV.path.map(p=>p.r*100+p.c)).size===LV.path.length'), inBounds:R('LV.path.every(p=>p.r>=0&&p.c>=0&&p.r<LV.rows&&p.c<LV.cols)'), eggs:R('LV.map.eggs.length'), cols:R('LV.cols'), rows:R('LV.rows')};
// 解锁与章节奖励
out.lock={ch2Before:R('isMapUnlocked(1)'), ch7Before:R('isMapUnlocked(6)')};
R('newGame(0,"normal")');
out.bonusBefore=R('buildBtns.some(b=>b.k==="b_vine")');
R('markCleared(0)');
R('renderMenu()');
out.lock.ch2After=R('isMapUnlocked(1)'); out.lock.ch3After=R('isMapUnlocked(2)');
R('newGame(0,"normal")');
out.bonusAfter=R('buildBtns.some(b=>b.k==="b_vine")');
out.bonusLockedBefore=R('buildBtns.some(b=>b.k==="b_sand")');
// 菜单：未解锁的关卡不能开始
R('selMap=3; S=null;'); tryR('menuStart', "$('menuStart').onclick()");
out.menuBlocked=R('S===null || S.mapIdx!==3');
// Boss 只在第七章
R('newGame(0,"normal"); S.wave=5;'); out.ch1Wave5NoGolem=R('!buildWave(5).includes("golem")');
R('newGame(6,"normal"); S.wave=5;'); out.ch7Wave5Golem=R('buildWave(5).includes("golem")');
// 第七章通关 → 结束动画 → 最终战
R('newGame(6,"normal"); S.wave=15; S.waveActive=true; S.queue=[]; S.enemies=[];');
tryR('win', 'update(0.05)');
out.ch7Won={won:R('S.won'), cleared6:R('progress.cleared.includes(6)'), bonusVoid:R('progress.cleared.includes(6)')};
tryR('ending', 'startEnding()');
out.endingMode=R('FIN.mode');
let steps=0;
for(; steps<1000 && R('FIN.mode')==='ending'; steps++){ clock.now+=33; tryR('endingFrame', `finFrame(${clock.now})`); }
out.endingSteps=steps;
out.gauntletStarted={gauntlet:R('!!(S&&S.gauntlet)'), stage:R('G&&G.stage'), hp:R('G&&G.hp'), lives:R('G&&G.lives'), idx:R('LV.idx'), thumbs:R('thumbs.length')};
// 七段最终战
const stageLog=[];
for(let st=0; st<7; st++){
  const idx=R('LV.idx');
  tryR('startWave', 'startWave()');
  const lastType=R('S.queue[S.queue.length-1]');
  const wave1=R('S.wave');
  // 模拟清场
  R('S.queue=[]; S.enemies=[];');
  tryR('clear', 'update(0.05)');
  stageLog.push({st, idx, boss:lastType, wave:wave1, hpAfter:R('G.hp'), stageAfter:R('G.stage')});
  if(st<6) tryR('nextStage', 'gauntletStage()');
  else tryR('qte', 'startQTE()');
}
out.stages=stageLog;
out.qteStarted={mode:R('FIN.mode'), phase:R('FIN.phase'), N:R('FIN.N'), icons:R('FIN.icons.length')};
// 等待小兵走到 boss → 出现防御卡
steps=0; for(; steps<400 && R('FIN.phase')==='grab'; steps++){ clock.now+=33; tryR('grabFrame', `finFrame(${clock.now})`); }
out.afterGrab={phase:R('FIN.phase'), steps, remain:R('FIN.remain')};
// 错误点击（不是防御卡）不计数
tryR('wrongTap', "onFinTap({target:{classList:{contains:()=>false},closest(){return null}},clientX:5,clientY:5})");
out.wrongTapCount=R('FIN.remain');
// 点击防御卡 N 下
const N=R('FIN.N');
for(let i=0;i<N;i++) tryR('hit', "onFinTap({target:{classList:{contains:()=>true},dataset:{i:'"+i+"'},closest(){return null}},clientX:300,clientY:300})");
out.afterTargets={phase:R('FIN.phase')};
// 疯狂电击 30 下（跑几帧确保画面不报错）
for(let i=0;i<5;i++){ clock.now+=33; tryR('shockFrame', `finFrame(${clock.now})`); }
for(let i=0;i<29;i++) tryR('shockTap', "onFinTap({target:{classList:{contains:()=>false},closest(){return null}},clientX:300,clientY:300})");
out.afterShock29={phase:R('FIN.phase'), taps:R('FIN.taps')};
tryR('shockTap30', "onFinTap({target:{classList:{contains:()=>false},closest(){return null}},clientX:300,clientY:300})");
out.afterShock30={phase:R('FIN.phase')};
for(let i=0;i<3;i++){ clock.now+=33; tryR('finalFrame', `finFrame(${clock.now})`); }
// 最后一击
tryR('finalTap', "onFinTap({target:{classList:{contains:()=>false},closest(){return null}},clientX:300,clientY:300})");
out.afterFinalTap={phase:R('FIN.phase')};
steps=0; for(; steps<400 && R('FIN.mode')==='qte'; steps++){ clock.now+=33; tryR('flashFrame', `finFrame(${clock.now})`); }
out.victory={mode:R('FIN.mode'), steps, final:R('progress.final'), lives:R('FIN.lives'), secs:R('FIN.secs')};
for(let i=0;i<200;i++){ clock.now+=33; tryR('victoryFrame', `finFrame(${clock.now})`); }
tryR('endVictory', 'endVictory()');
out.afterVictory={G:R('G'), homeVisible:!els['home']._cls.has('hidden'), finHidden:els['fin']._cls.has('hidden')};
// 复制按钮
tryR('quizOpen', 'openQuiz()'); tryR('answer2','answerQuiz(2)');
out.copyBtn=R("$('quizResult').innerHTML").includes('copyCode');
out.copyBinding=R("typeof $('copyCode').onclick");
// 备份包含章节进度，导入可恢复
const bk=R('JSON.stringify(buildBackup())');
out.backupProgress=JSON.parse(bk).progress;
R('progress.cleared=[]; progress.final=false; saveProgress();');
tryR('apply', `applyBackup(parseBackup(${JSON.stringify(bk)}))`);
out.restoredCleared=R('progress.cleared.slice().sort((a,b)=>a-b)');
// 之前的功能仍然正常
tryR('save', 'newGame(1,"normal"); saveTo("slot1",true)');
out.saveOk=R('!!readSaves().slot1');
out.errors=errs;
console.log(JSON.stringify(out,null,1));
