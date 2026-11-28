import { Game, maxHP, maxMP } from './game.js';
import { renderer } from './render.js';
import { initial, storage, newRecord, historyCsv } from './storage.js';
import { input } from './input.js';
import { questionEditor } from './question-editor.js';

const $ = selector => document.querySelector(selector);
const modal = $('#modal');
const body = $('#dialog-body');
const draw = renderer($('#world'));
const touchDevice = matchMedia('(any-pointer: coarse)');
let stages, questions, game, record, panel, reading, toastTimer, audio;
let editorBank, previewSession;
const store = storage(() => toast('ブラウザの保存を利用できません。'));
let save = store.read('progress', initial());
save.settings = { ...initial().settings, ...save.settings };
save.variants ??= {};
let records = store.read('history', []);
const writeSave = () => !previewSession && store.write('progress',save);
const writeHistory = () => !previewSession && store.write('history',records);

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function paragraph(text, className) { body.append(el('p',text,className)); }
function buttons(...items) {
  const row = el('div',undefined,'actions');
  for (const [label,callback,primary,disabled] of items) {
    const button = el('button',label,primary?'primary':undefined);
    button.type = 'button';
    button.disabled = Boolean(disabled);
    button.addEventListener('click',callback);
    row.append(button);
  }
  body.append(row);
}
function toast(text) {
  clearTimeout(toastTimer);
  $('#toast').textContent = text;
  toastTimer = setTimeout(() => { $('#toast').textContent = ''; },2900);
}
function sound(kind) {
  if (!save.settings.sound || !window.AudioContext) return;
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') audio.resume().catch(()=>{});
    const wave = audio.createOscillator();
    const gain = audio.createGain();
    const notes = { slash:[260,95], magic:[330,780], pickup:[490,820], hurt:[170,70], win:[350,990] };
    const [a,b] = notes[kind];
    const now = audio.currentTime;
    wave.type = kind === 'slash' ? 'square' : 'triangle';
    wave.frequency.setValueAtTime(a,now);
    wave.frequency.exponentialRampToValueAtTime(b,now+.16);
    gain.gain.setValueAtTime(.065,now);
    gain.gain.exponentialRampToValueAtTime(.001,now+.2);
    wave.connect(gain).connect(audio.destination);
    wave.start();
    wave.stop(now+.21);
  } catch {
    // Sound is optional on browsers that block playback.
  }
}
function stopReading() {
  if (!reading) return;
  reading.record.readingMs += Math.max(0,Math.round(performance.now()-reading.since));
  reading = undefined;
  writeHistory();
}
function open(name,title) {
  stopReading();
  controls.clear();
  panel = name;
  $('#dialog-title').textContent = title;
  $('#close').hidden = name === 'defeat';
  body.replaceChildren();
  if (!modal.open) modal.showModal();
  modal.scrollTop = 0;
}
function close() {
  stopReading();
  panel = undefined;
  modal.close();
  controls.clear();
}
$('#close').addEventListener('click',close);
modal.addEventListener('cancel',event => {
  event.preventDefault();
  if (panel !== 'defeat') close();
});
window.addEventListener('pagehide',stopReading);

function applySettings() {
  document.documentElement.style.setProperty('--reading-size',save.settings.text+'px');
  const touch = save.settings.touch === 'on' || (save.settings.touch === 'auto' && touchDevice.matches);
  const visible = Boolean(game) && touch;
  $('#touch-pad').hidden = !visible;
  document.body.classList.toggle('touch-active',visible);
}
touchDevice.addEventListener('change',applySettings);

function updateHUD() {
  if (!game) return;
  const p = game.player;
  const stats = `Lv.${save.level}　HP ${p.hp}/${maxHP(save)}　MP ${Math.floor(p.mp)}/${maxMP(save)}　${save.gold} G`;
  const cooldown = p.cast > 0 ? '　魔法準備中' : '';
  if ($('#stats').textContent !== stats + cooldown) $('#stats').textContent = stats + cooldown;
  document.querySelectorAll('[data-slot]').forEach(button => {
    const active = +button.dataset.slot === game.slot;
    button.classList.toggle('active',active);
    button.setAttribute('aria-pressed',active);
  });
}
function syncScreen() {
  $('#title').hidden = Boolean(game);
  for (const name of ['restart','pause','field-notes','field-menu']) $('#'+name).hidden = !game;
  $('#clear-result').hidden = !game?.finished;
  $('#end-preview').hidden = !previewSession;
  $('#journal').disabled = !game;
  $('#chapter').textContent = game ? `${previewSession?'テストプレイ / ':''}STAGE ${String(game.stage.id).padStart(2,'0')}` : '冒険の書';
  $('#heading').textContent = game?.stage.name ?? '謎解きダンジョン';
  $('#location').textContent = game ? '◆　'+game.stage.place : '◆　失われた秘宝';
  $('#mission').textContent = game?.question.mission ?? '文章を手がかりに、失われた秘宝を探し出そう。';
  if (!game) $('#stats').textContent = '';
  $('#start').textContent = save.unlocked > 1 ? '▶　冒険をつづける' : '▶　冒険をはじめる';
  applySettings();
  updateHUD();
}

function shuffled(items) {
  const list=items.slice();
  for (let i=list.length-1;i>0;i--) {
    const j=Math.floor(Math.random()*(i+1));
    [list[i],list[j]]=[list[j],list[i]];
  }
  return list;
}
function start(id, repeat = false) {
  if (previewSession) {
    close();
    return launchGame(stages.find(s=>s.id===previewSession.draft.question.stageId),previewSession.draft.question);
  }
  const stage = stages?.find(s=>s.id === id);
  if (!stage || id>save.unlocked) return;
  close();
  const variants = questions.filter(q=>q.stageId === id && q.difficulty === save.settings.reading);
  const key = id + ':' + save.settings.reading;
  const choice = repeat || key in save.variants ? ((save.variants[key] ?? -1)+1) % variants.length : 0;
  save.variants[key] = choice;
  launchGame(stage,variants[choice]);
}
function launchGame(stage,problem) {
  record = newRecord(problem);
  records.push(record);
  writeHistory();
  writeSave();
  const plan={...problem.plan,options:shuffled(problem.plan.options)};
  if (plan.reasons) plan.reasons=shuffled(plan.reasons);
  game = new Game(stage,{...problem,plan},save,{
    toast, sound, wrong, read, defeat, complete, plan:showPlan, persist:writeSave,
  });
  syncScreen();
  toast('光る印の人や記録を調べよう。');
}
function showEditor(draft) {
  if (!questions || previewSession) return;
  open('editor','保護者向け　問題管理');
  editorBank ??= store.read('question-drafts-v2',questions);
  questionEditor(body,{
    bank:editorBank,published:questions,stages,draft,
    save(next) {
      if (!store.write('question-drafts-v2',next)) return false;
      editorBank=next;
      return true;
    },
    preview(question,originalId) {
      close();
      previewSession={game,record,records,save,draft:{question,originalId}};
      save=structuredClone(save);
      records=[];
      start(question.stageId);
    },
  });
}

function endPreview() {
  if (!previewSession) return;
  close();
  const original=previewSession;
  previewSession=undefined;
  ({ game,record,records,save }=original);
  syncScreen();
  showEditor(original.draft);
}

function wrong(message) {
  record.mistakes.push(message);
  const n = record.mistakes.length;
  if (n === 1) toast('うまくいかなかった。文章を読み直そう。');
  else {
    const hint = game.question.hints[Math.min(n-2,game.question.hints.length-1)];
    record.hints += 1;
    if (modal.open) paragraph(hint);
    else toast(hint);
  }
  writeHistory();
}
const readingGlossary = {
  古代遺跡:'こだいいせき', 遺跡:'いせき', 洞窟:'どうくつ', 魔物:'まもの',
  冒険者:'ぼうけんしゃ', 台座:'だいざ', 扉:'とびら', 燃料:'ねんりょう',
  倉庫:'そうこ', 手当て:'てあて', 薬草:'やくそう', 番人:'ばんにん',
};
const readingTerm = new RegExp('('+Object.keys(readingGlossary).join('|')+')','g');

function passage(text) {
  const line = el('p',undefined,'reading');
  for (const segment of text.split(readingTerm)) {
    if (!Object.hasOwn(readingGlossary,segment)) line.append(segment);
    else {
      const ruby = el('ruby',segment);
      ruby.append(el('rt',readingGlossary[segment]));
      line.append(ruby);
    }
  }
  body.append(line);
}

function read(note, reread = false, fromJournal = false) {
  open('reading',note.name);
  if (reread) record.rereads += 1;
  writeHistory();
  reading = {record,since:performance.now()};
  passage(note.text);
  if (note.delivery && !game.finished && !fromJournal) {
    if (game.flags.has(note.id)) paragraph('この依頼は達成済みです。','muted');
    else buttons(['品物を届ける',()=>{
      const before = record.mistakes.length;
      game.operate(note);
      if (!game.finished && record.mistakes.length === before) close();
      else if (!game.finished && before === 0) paragraph('依頼を読み直し、品物と数を確認しよう。','muted');
    },true]);
  }
}
function showPlan(selectedIndex) {
  const {plan}=game.question;
  open('plan','攻略計画');
  if (game.flags.has('planned')) {
    paragraph('計画を確認した。マップで実行しよう。');
    return;
  }
  if (game.planAttempts>=2) {
    paragraph('この計画はいったん保留。別の記録で、根拠を確かめ直そう。');
    paragraph(game.question.hints[1],'muted');
    buttons(['別の記録で再挑戦',()=>start(game.stage.id,true),true]);
    return;
  }
  const missing=plan.sources.filter(id=>!game.notes.has(id));
  if (missing.length) {
    paragraph('計画の前に、マップで次の記録を調べよう。');
    for (const id of missing) paragraph(game.objects.find(o=>o.id===id).name);
    return;
  }
  paragraph(selectedIndex===undefined?'記録の条件をすべて満たす計画を選ぼう。':'記録から計画の根拠を選ぼう。');
  if (selectedIndex!==undefined) buttons(['計画の選択に戻る',()=>showPlan()]);
  if (game.planAttempts) {
    paragraph(game.question.hints[0],'muted');
    buttons(['記録を読み直す',journal]);
  }
  const choices=el('div',undefined,'rows plan-choices');
  const choicesToShow=selectedIndex===undefined?plan.options:plan.reasons;
  choicesToShow.forEach((option,index)=>{
    const button=el('button',option.text);
    button.type='button';
    button.addEventListener('click',()=>{
      if (plan.reasons && selectedIndex===undefined) return showPlan(index);
      game.propose(selectedIndex ?? index,selectedIndex===undefined?undefined:index);
      if (game.flags.has('planned')) {
        close();
        toast('計画を確認した。マップで実行しよう。');
      } else showPlan();
    });
    choices.append(button);
  });
  body.append(choices);
}
function journal() {
  if (!game) return;
  open('journal','ミッション・冒険の記録');
  paragraph(game.question.mission);
  const notes = game.objects.filter(o=>game.notes.has(o.id));
  if (!notes.length) paragraph('まだ記録がありません。マップで人や石碑を調べよう。','muted');
  for (const note of notes) buttons([note.name,()=>read(note,true,true)]);
  if (record.mistakes.length) buttons(['ヒントを見る',()=>{
    const index = Math.min(Math.max(0,record.mistakes.length-2),game.question.hints.length-1);
    record.hints += 1;
    writeHistory();
    open('hint','攻略のヒント');
    paragraph(game.question.hints[index]);
  }]);
}
function defeat() {
  record.defeats += 1;
  writeHistory();
  open('defeat','冒険者は力尽きた');
  paragraph('体力と魔力を回復して、入口からこのミッションを続けよう。');
  buttons(['入口へ戻る',()=>{
    game.retry();
    close();
  },true],['別の問題に挑戦',()=>start(game.stage.id,true)]);
}
function complete() {
  record.cleared = true;
  record.firstSuccess = !record.mistakes.length;
  const id = game.stage.id;
  save.cleared = [...new Set([...save.cleared,id])];
  save.unlocked = Math.min(stages.length,Math.max(save.unlocked,id+1));
  $('#clear-result').hidden = false;
  showClearResult();
  writeSave();
  writeHistory();
  sound('win');
}
function showClearResult() {
  if (!game?.finished) return;
  const id = game.stage.id;
  open('complete',id===stages.length?'冒険クリア　失われた秘宝':'ステージクリア');
  passage(game.question.explanation);
  paragraph(record.firstSuccess?'初回成功　・　回復薬を1つ獲得':`読解の誤答 ${record.mistakes.length}回　・　回復薬を1つ獲得`);
  if (previewSession) buttons(['問題の編集に戻る',endPreview,true],['テストをやり直す',()=>start(id,true)]);
  else buttons(id<stages.length?['次のステージ',()=>start(id+1),true]:['ステージ選択',stageMenu,true],
    ['もう一度挑戦',()=>start(id,true)]);
  $('#dialog-title').focus();
}
function pause() {
  if (!game) return;
  open('pause','一時停止');
  buttons(['冒険にもどる',close,true],['ステージ選択',stageMenu],['所持品・装備',bag],['設定',settings],['タイトルに戻る',()=>{
    close();
    game = undefined;
    syncScreen();
  }]);
}
function stageMenu() {
  if (previewSession) return endPreview();
  open('stages','ステージ選択');
  if (!stages) return paragraph('ステージデータを読み込んでいます。');
  const rows = el('div',undefined,'rows');
  for (const stage of stages) {
    const status = save.cleared.includes(stage.id)?' ✓':stage.id>save.unlocked?' 鍵付き':'';
    const button = el('button',`STAGE ${stage.id}　${stage.name}${status}`);
    button.disabled = stage.id>save.unlocked;
    button.addEventListener('click',()=>start(stage.id));
    rows.append(button);
  }
  body.append(rows);
}
function bag() {
  open('bag','所持品・装備');
  paragraph(`Lv.${save.level}　経験値 ${save.xp}/${save.level*45}　所持金 ${save.gold} G`);
  paragraph(`剣 +${save.weapon}　防具 +${save.armor}`);
  const items = Object.entries({...save.inventory,...game?.inventory}).filter(([,n])=>n>0);
  paragraph(items.map(([name,n])=>name+' × '+n).join('　') || '所持アイテムなし');
  for (const [key,label] of [['weapon','剣'],['armor','防具']]) {
    const cost = 20 + save[key]*15;
    buttons([`${label}を強化（${cost} G）`,()=>{
      if (save.gold<cost) return;
      save.gold-=cost;
      save[key]+=1;
      writeSave();
      sound('pickup');
      bag();
    },false,save.gold<cost]);
  }
}
function confirmClear(key) {
  if (previewSession) return;
  const history = key==='history';
  open('confirm',history?'学習履歴の削除':'冒険の初期化');
  paragraph(history?'このブラウザに保存された学習履歴をすべて削除します。':'ステージ進行、レベル、装備、所持品、設定を初期化します。');
  buttons(['キャンセル',history?historyPanel:settings,true],['削除を実行',()=>{
    if (history) {
      records = [];
      writeHistory();
      if (game && !game.finished) {
        close();
        game = undefined;
        syncScreen();
      }
      historyPanel();
    } else {
      save = initial();
      writeSave();
      game = undefined;
      syncScreen();
      close();
    }
  }]);
}
function settings() {
  open('settings','設定');
  const form = el('div',undefined,'settings');
  const fields = [
    ['reading','読解の難易度',[1,2,3,4,5].map(n=>[n,'Lv.'+n])],
    ['combat','戦闘の難易度',[['easy','やさしい'],['normal','ふつう'],['hard','むずかしい']]],
    ['text','文章の文字サイズ',[18,20,22,24,26].map(n=>[n,n+' px'])],
    ['touch','タッチ操作',[['auto','自動'],['on','表示'],['off','非表示']]],
    ['sound','効果音',[['true','あり'],['false','なし']]],
  ];
  for (const [key,title,choices] of fields) {
    const label = el('label',title);
    const select = el('select');
    for (const [value,name] of choices) {
      const option = el('option',name);
      option.value = value;
      select.append(option);
    }
    select.value = save.settings[key];
    select.addEventListener('change',()=>{
      save.settings[key] = key==='reading'||key==='text'?+select.value:key==='sound'?select.value==='true':select.value;
      writeSave();
      applySettings();
    });
    label.append(select);
    form.append(label);
  }
  body.append(form);
  paragraph('読解レベルは、次にステージを始めるときに反映されます。','muted');
  buttons(['冒険を初期化',()=>confirmClear('progress')]);
}
const rate = (list, test) => list.length ? Math.round(100*list.filter(test).length/list.length)+'%' : '—';
function table(headers, rows) {
  const wrapper = el('div',undefined,'scroll');
  const table = el('table');
  const head = table.createTHead().insertRow();
  for (const label of headers) head.append(el('th',label));
  const tbody = table.createTBody();
  for (const row of rows) {
    const tr = tbody.insertRow();
    for (const value of row) tr.append(el('td',value));
  }
  wrapper.append(table);
  body.append(wrapper);
}
function historyPanel() {
  open('history','保護者向け　学習履歴');
  const success = r=>r.firstSuccess;
  paragraph(`プレイ ${records.length} 回　・　初回成功率 ${rate(records,success)}　・　ヒント使用率 ${rate(records,r=>r.hints>0)}`);
  paragraph('初回成功は、読解に関する誤った行動をせずにクリアした記録です。割合には未クリアの挑戦も含みます。','muted');
  const dimensions = [
    ['問題の種類',[...new Set(records.map(r=>r.type))].sort(),(r,k)=>r.type===k],
    ['読解レベル',[1,2,3,4,5],(r,k)=>r.difficulty===k],
  ];
  for (const [title,labels,match] of dimensions) {
    table([title,'挑戦数','初回成功率'],labels.map(label=>{
      const group = records.filter(r=>match(r,label));
      return [label,group.length,rate(group,success)];
    }));
  }
  body.append(el('h3','プレイ履歴'));
  table(['日時','問題','結果','誤答','ヒント','再表示','読書秒','戦闘失敗'],records.slice().reverse().map(r=>[
    new Date(r.date).toLocaleString('ja-JP'),r.problem,r.firstSuccess?'初回成功':r.cleared?'クリア':'未クリア',
    r.mistakes.length?r.mistakes.join(' / '):'0',r.hints,r.rereads,(r.readingMs/1000).toFixed(1),r.defeats,
  ]));
  buttons(['CSV出力',()=>{
    const url = URL.createObjectURL(new Blob([historyCsv(records)],{type:'text/csv;charset=utf-8'}));
    const link = el('a');
    link.href = url;
    link.download = 'reading-history.csv';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  },true],['学習履歴を削除',()=>confirmClear('history')]);
}

function playable() { return Boolean(game && !modal.open && !game.knockedOut); }
function perform(action) {
  if (!playable()) return;
  if (action==='journal') return journal();
  if (action==='pause') return pause();
  if (game.finished) {
    if (action==='interact') showClearResult();
    return;
  }
  if (action==='cycle') game.slot = (game.slot+1)%4;
  else if (action.startsWith('slot')) game.slot = +action.at(-1);
  else if (action==='attack') game.attack();
  else if (action==='cast') game.cast();
  else if (action==='guard') game.guard();
  else if (action==='dodge') game.dodge();
  else if (action==='interact') game.interact();
}
const controls = input({playable,action:perform});
for (const [selector,callback] of [
  ['#journal',journal],['#field-notes',journal],['#pause',pause],['#field-menu',pause],
  ['#bag',bag],['#restart',()=>start(game.stage.id,true)],
  ['#clear-result',showClearResult],['#end-preview',endPreview],
  ['#start',()=>save.unlocked>1?stageMenu():start(1)],
  ['[data-panel="stages"]',stageMenu],['[data-panel="history"]',historyPanel],
  ['[data-panel="settings"]',settings],
  ['[data-panel="editor"]',()=>showEditor()],
]) $(selector).addEventListener('click',callback);
document.querySelectorAll('[data-slot]').forEach(button=>{
  button.addEventListener('click',()=>perform('slot'+button.dataset.slot));
});
let prev = 0;
function frame(time) {
  const step = Math.min(.04,(time-prev)/1000);
  prev = time;
  if (playable() && !game.finished) {
    game.tick(step,...controls.movement());
    if (controls.attacking() && playable()) game.attack();
  }
  if (stages) draw(game,game?.stage ?? stages[0],time/1000);
  updateHUD();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
syncScreen();
try {
  [stages,questions] = await Promise.all(['stages','questions'].map(async name=>{
    const response = await fetch('./data/'+name+'.json');
    if (!response.ok) throw new Error(name);
    return response.json();
  }));
  $('#start').disabled = false;
} catch {
  $('#load-error').textContent = '冒険データを読み込めません。ページを再読み込みしてください。';
}
if ('serviceWorker' in navigator && stages) {
  navigator.serviceWorker.register('./sw.js').catch(()=>{});
}
