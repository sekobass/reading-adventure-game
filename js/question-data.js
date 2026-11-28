import { Game, WIDTH, HEIGHT } from './game.js';
import { initial } from './storage.js';

const kinds = new Set(['npc','book','sign','chest','house','boat','gate','pedestal','supply']);
const elements = new Set(['fire','ice','thunder']);
const patterns = new Set(['rush','shot','sweep','pulse','cross','melee']);
const strings = value => Array.isArray(value) && value.every(text);
const text = value => typeof value==='string' && value.trim().length>0;
const point = (x,y) => Number.isFinite(x) && Number.isFinite(y) && x>=17 && x<=WIDTH-17 && y>=17 && y<=HEIGHT-17;
const itemCounts = value => value && typeof value==='object' && !Array.isArray(value) &&
  Object.entries(value).every(([key,count])=>text(key) && !['__proto__','constructor','prototype'].includes(key) && Number.isInteger(count) && count>0 && count<=99);

function conditions(value) {
  if (!Array.isArray(value)) return false;
  return value.every(c=>{
    if (!c || typeof c!=='object') return false;
    if (c.flag) return text(c.flag) && !value.some(other=>other?.notFlag===c.flag);
    if (c.notFlag) return text(c.notFlag);
    return text(c.item) && itemCounts({[c.item]:c.count});
  });
}

function validChoices(options) {
  return Array.isArray(options) && [4,5].includes(options.length) &&
    options.every(o=>text(o?.text) && (o.correct===undefined || typeof o.correct==='boolean')) &&
    options.filter(o=>o.correct===true).length===1 &&
    new Set(options.map(o=>o.text)).size===options.length;
}

function commonObjects(q, stage, errors) {
  if (!Array.isArray(q.objects) || !q.objects.length || q.objects.length>50 ||
      !q.objects.every(o=>o && text(o.id) && text(o.name) && kinds.has(o.kind) && point(o.x,o.y) &&
        (o.text===undefined || text(o.text)) && (!o.delivery || text(o.text)))) {
    errors.push('配置物のID・種類・名前・座標・文章を確認してください。');
    return;
  }
  const objects=new Map(q.objects.map(o=>[o.id,o]));
  if (objects.size!==q.objects.length) errors.push('配置物のIDが重複しています。');
  if (new Set(q.objects.map(o=>o.x+','+o.y)).size!==q.objects.length) errors.push('同じ座標に複数の配置物があります。');
  const plan=q.plan;
  if (!plan || !objects.has(plan.target) || objects.get(plan.target).text ||
      !strings(plan.sources) || !plan.sources.length || !plan.sources.every(id=>text(objects.get(id)?.text)) ||
      !validChoices(plan.options) || (plan.reasons!==undefined && !validChoices(plan.reasons))) {
    errors.push('攻略計画と根拠には、異なる4～5つの選択肢と正解1つが必要です。参照する文章も確認してください。');
  }
  const steps=q.sequence;
  if (steps && (!strings(steps.targets) || !strings(steps.order) || !steps.order.length ||
      new Set(steps.targets).size!==steps.targets.length || new Set(steps.order).size!==steps.order.length ||
      !steps.targets.every(id=>id!==plan?.target && objects.get(id)?.kind==='pedestal') ||
      !steps.order.every(id=>steps.targets.includes(id)) || !text(steps.onComplete) || !text(steps.wrong))) {
    errors.push('攻略順序には重複のない台座IDと完了フラグが必要です。');
  }
  const validEnemy = enemy => enemy && text(enemy.id) && point(enemy.x,enemy.y) &&
    (!enemy.arena || (stage.arena && enemy.x>stage.arena.x+20)) &&
    (!enemy.boss || (enemy.arena && Array.isArray(enemy.phases) && enemy.phases.length===2 && enemy.phases.every(p=>
      elements.has(p?.element) && patterns.has(p.pattern) && (!p.guard || ['pulse','cross','sweep','melee','rush'].includes(p.pattern))))) &&
    (!enemy.win || (enemy.boss && !enemy.fixed));
  if (!Array.isArray(q.enemies) || !q.enemies.every(validEnemy)) {
    errors.push('敵の位置・属性・段階別攻撃・入場条件を確認してください。');
  }
  if (!Array.isArray(q.rules) || new Set(q.rules.map(r=>r?.target)).size!==q.rules.length) {
    errors.push('攻略条件を配列で指定し、対象を1回ずつ登録してください。');
    return;
  }
  for (const rule of q.rules) {
    const target=objects.get(rule?.target);
    const action=rule?.then;
    if (!target || target.id===plan?.target || (target.text && !target.delivery) ||
        !conditions(rule.when) || !action || typeof action!=='object' || Array.isArray(action) ||
        (action.give && (!itemCounts(action.give) || !action.open)) ||
        (action.take && (!itemCounts(action.take) || !Object.entries(action.take).every(([name,count])=>
          rule.when.some(c=>c.item===name && c.count>=count)))) ||
        (action.set && !strings(action.set)) ||
        (action.move && (!Array.isArray(action.move) || action.move.length!==2 || !point(...action.move))) ||
        (action.spawn && ![action.spawn].flat().every(validEnemy)) ||
        (action.spawn && !action.open) ||
        (target?.kind==='gate' && action.move && (!stage.arena || action.move[0]<=stage.arena.x+16))) {
      errors.push((rule?.target ?? '対象不明')+' の実行条件・品物・配置に誤りや矛盾があります。');
    }
  }
  const enemies=[...(Array.isArray(q.enemies)?q.enemies:[]),...q.rules.flatMap(r=>r?.then?.spawn ?? [])];
  const ids=[...objects.keys(),...enemies.map(e=>e?.id)];
  if (new Set(ids).size!==ids.length) errors.push('配置物・敵のIDは重複できません。');
  if (q.completeWhen!==undefined && (!conditions(q.completeWhen) || !q.completeWhen.length)) {
    errors.push('クリアに必要な条件が矛盾しているか、空欄です。');
  }
}

// Use the same wall and quest rules as gameplay. The search abstracts combat
// and follows the possible mission states without guessing incorrect choices.
function canFinish(stage,q) {
  const noop=()=>{};
  const game=new Game(stage,q,initial(),{toast:noop,wrong:noop,sound:noop,complete:noop,persist:noop});
  const navigation=new Map();
  function accessible() {
    const key=[game.player.x,game.player.y,game.arenaActive,...game.enemies.map(e=>e.id)].join(',');
    if (navigation.has(key)) return navigation.get(key);
    const seen=new Set();
    const locations=[{x:game.player.x,y:game.player.y}];
    const targets=[...game.objects,...game.enemies];
    const accessibleIds=new Set();
    for (const pos of locations) {
      for (const o of targets) {
        if (!accessibleIds.has(o.id) && Math.hypot(pos.x-o.x,pos.y-o.y)<23 && game.clear(pos,o)) accessibleIds.add(o.id);
      }
      for (const [dx,dy] of [[7,0],[-7,0],[0,7],[0,-7]]) {
        const next={x:pos.x+dx,y:pos.y+dy};
        const id=next.x+','+next.y;
        if (seen.has(id) || game.blocked(next.x,next.y,6) || !game.clear(pos,next,6)) continue;
        seen.add(id);
        locations.push(next);
      }
    }
    navigation.set(key,accessibleIds);
    return accessibleIds;
  }
  const initialArea=accessible();
  if (![q.plan.target,...q.plan.sources].every(id=>initialArea.has(id))) return false;
  game.flags.add('planned');
  function snapshot() {
    return { position:[game.player.x,game.player.y], inventory:{...game.inventory}, flags:[...game.flags],
      opened:game.objects.filter(o=>o.open).map(o=>o.id), sequence:game.sequence, enemies:game.enemies.slice() };
  }
  function restore(state) {
    [game.player.x,game.player.y]=state.position;
    game.inventory={...state.inventory};
    game.flags=new Set(state.flags);
    for (const o of game.objects) o.open=state.opened.includes(o.id);
    game.sequence=state.sequence;
    game.enemies=state.enemies.slice();
    game.finished=false;
    game.effects=[];
  }
  const queue=[snapshot()], seen=new Set();
  for (let index=0;index<queue.length && index<1200;index++) {
    const state=queue[index];
    restore(state);
    const area=accessible();
    if (game.enemies.some(e=>e.win && area.has(e.id) &&
        game.enemies.filter(other=>other.role==='support' && other.arena).every(other=>area.has(other.id)))) return true;
    const candidates=q.rules.filter(r=>area.has(r.target) && !state.opened.includes(r.target) &&
      game.matches(r.when) && (!r.wrong || r.when.length)).map(r=>r.target);
    const step=q.sequence?.order[state.sequence];
    if (step && area.has(step)) candidates.push(step);
    for (const id of candidates) {
      restore(state);
      game.operate(game.objects.find(o=>o.id===id));
      if (game.blocked(game.player.x,game.player.y,6)) continue;
      if (game.finished) return true;
      const next=snapshot();
      const key=JSON.stringify([next.position,next.inventory,next.flags.sort(),next.opened,next.sequence,next.enemies.map(e=>e.id)]);
      if (!seen.has(key)) {
        seen.add(key);
        queue.push(next);
      }
    }
  }
  return false;
}

export function validateQuestion(question,stages) {
  const q=question;
  const errors=[];
  const stage=stages.find(s=>s.id===q?.stageId);
  if (!q || typeof q.id!=='string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(q.id ?? '') || !text(q.type) ||
      !text(q.mission) || !text(q.explanation) || !strings(q.hints) || q.hints.length<2 ||
      !stage || ![1,2,3,4,5].includes(q.difficulty)) {
    errors.push('問題ID、ステージ、難易度、分類、目標、ヒント2つ以上、解説を確認してください。');
  }
  if (stage) commonObjects(q,stage,errors);
  if (!errors.length && !canFinish(stage,q)) {
    errors.push('文章の位置、消費する品物、フラグ、扉、敵の位置を確認してください。クリアできる手順が見つかりません。');
  }
  return errors;
}

export function validateBank(value, stages, validate = validateQuestion) {
  if (!Array.isArray(value) || !value.length || value.length>250) return ['問題一覧は1～250件の配列にしてください。'];
  const errors=[];
  if (new Set(value.map(q=>q?.id)).size!==value.length) errors.push('問題IDが重複しています。');
  for (const q of value) for (const error of validate(q,stages)) errors.push((q?.id ?? 'IDなし')+'：'+error);
  for (const stage of stages) for (const level of [1,2,3,4,5]) {
    if (!value.some(q=>q?.stageId===stage.id && q.difficulty===level)) {
      errors.push('ステージ '+stage.id+'・Lv.'+level+' には少なくとも1問が必要です。');
    }
  }
  return errors;
}

const columns=['id','stageId','difficulty','type','mission','hints','explanation','objects','plan','rules','enemies','sequence','completeWhen'];
const structure=new Set(['hints','objects','plan','rules','enemies','sequence','completeWhen']);
const quote = value => '"'+value.replaceAll('"','""')+'"';
const formula = /^[=+\-@\t\r]/;

export function questionsCsv(bank) {
  return '\uFEFF'+[columns.join(','),...bank.map(q=>columns.map(key=>{
    let value=structure.has(key)?JSON.stringify(q[key] ?? null):String(q[key] ?? '');
    if (formula.test(value)) value="'"+value;
    return quote(value);
  }).join(','))].join('\r\n');
}

export function importQuestions(textValue,csv) {
  const source=textValue.replace(/^\uFEFF/,'');
  if (!csv) return JSON.parse(source);
  const rows=[];
  let row=[], cell='', quoted=false;
  for (let i=0;i<source.length;i++) {
    const c=source[i];
    if (c==='"') {
      if (quoted && source[i+1]==='"') {cell+='"';i++;}
      else quoted=!quoted;
    } else if (!quoted && c===',') {
      row.push(cell);cell='';
    } else if (!quoted && (c==='\n'||c==='\r')) {
      row.push(cell);rows.push(row);row=[];cell='';
      if (c==='\r' && source[i+1]==='\n') i++;
    } else cell+=c;
  }
  if (quoted) throw new Error('CSVの引用符が閉じていません。');
  if (cell || row.length) rows.push([...row,cell]);
  const header=rows.shift();
  if (header?.length!==columns.length || !columns.every(c=>header.includes(c))) {
    throw new Error('この画面から書き出したCSVの見出しを使用してください。');
  }
  return rows.filter(row=>row.some(Boolean)).map((row,index)=>{
    if (row.length!==columns.length) throw new Error('CSV '+(index+2)+'行目の列数が異なります。');
    const result={};
    for (const [i,key] of header.entries()) {
      let value=row[i];
      if (value[0]==="'" && formula.test(value.slice(1))) value=value.slice(1);
      if (structure.has(key)) {
        if (value && value!=='null') result[key]=JSON.parse(value);
      } else result[key]=['stageId','difficulty'].includes(key)?Number(value):value;
    }
    return result;
  });
}
