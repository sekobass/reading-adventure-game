import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Game } from '../kingdom/js/game.js';
import { spells } from '../kingdom/js/combat.js';
import { initial, newRecord, historyCsv } from '../kingdom/js/storage.js';
import { backupFormat, battleGuide, chooseVariant, discovery, readBackup, selectRoute, routeClosing } from '../kingdom/js/campaign.js';
import { importQuestions, questionsCsv, validateBank, validateQuestion } from '../kingdom/js/question-data.js';

const read=name=>JSON.parse(readFileSync(new URL('../kingdom/data/'+name+'.json',import.meta.url)));
const stages=read('stages'), questions=read('questions');
const noop=()=>{};
const index=choices=>choices.findIndex(choice=>choice.correct);
function make(q) {
  const events={wrong:0,wins:0};
  const game=new Game(stages.find(s=>s.id===q.stageId),q,initial(),{
    toast:noop,sound:noop,persist:noop,read:noop,defeat:noop,complete:()=>events.wins++,wrong:()=>events.wrong++,
  });
  return {game,events};
}
function prepare(game) {
  const p=game.question.plan;
  for (const id of p.sources) game.notes.add(id);
  game.propose(index(p.options));
}
function advance(game,seconds) {
  for (let dt=0;dt<seconds;dt+=.02) game.tick(.02,0,0);
}
function operate(game,id) { game.operate(game.objects.find(o=>o.id===id)); }
function face(p,e) {
  const gap=Math.hypot(p.x-e.x,p.y-e.y);
  p.direction=[(e.x-p.x)/gap,(e.y-p.y)/gap];
}
function fight(game,boss) {
  const p=game.player;
  // Geometry and phase rules are exercised independently of character movement.
  p.invincible=200;
  for (let attempt=0;attempt<18 && !game.finished;attempt++) {
    const support=game.enemies.find(e=>e.arena && e.role==='support' && e.hp>0);
    if (support) {
      const hp=boss.hp;
      game.hitSpell(boss,spells.find(s=>s?.id===boss.phases[boss.phase].element));
      assert.equal(boss.hp,hp);
      assert.equal(boss.exposed,0);
      Object.assign(p,{x:support.x-19,y:support.y});
      for (let i=0;i<5 && support.hp;i++) {
        face(p,support);
        game.attack();
        advance(game,.35);
      }
      assert.equal(support.hp,0);
    }
    advance(game,1.05);
    if (p.mp<12) advance(game,4.5);
    Object.assign(p,{x:Math.max(game.stage.arena.x+16,boss.x-22),y:boss.y});
    const phase=boss.phases[boss.phase];
    if (phase.guard && !boss.opening) {
      const deadline=game.clock+5;
      while (boss.windup<=0 && game.clock<deadline) advance(game,.02);
      assert.ok(boss.windup>0);
      advance(game,Math.max(0,boss.windup-.15));
      game.guard();
      advance(game,.84);
      assert.ok(boss.opening>0);
    }
    game.slot=spells.findIndex(spell=>spell?.id===phase.element);
    face(p,boss);
    game.cast();
    advance(game,.22);
    assert.equal(boss.status,spells[game.slot].effect);
    face(p,boss);
    game.attack();
  }
  assert.equal(boss.phase,2);
  assert.ok(game.finished);
  assert.equal(game.blocked(game.stage.arena.x+4,145,6),false);
}

for (const q of questions) test('七つの封印 '+q.id+' の読解、配置、クリア',()=>{
  const {game,events}=make(q);
  const p=q.plan;
  game.propose(index(p.options));
  assert.ok(!game.flags.has('planned'));
  prepare(game);
  assert.ok(game.flags.has('planned'));
  operate(game,p.destination);
  if (game.stage.arena) {
    operate(game,'gate');
    const boss=game.enemies.find(e=>e.boss);
    assert.ok(boss && game.arenaActive);
    assert.equal(game.clear({x:315,y:145},boss),false);
    fight(game,boss);
  }
  assert.equal(events.wins,1);
});

test('誤答3回後も増援・ロックが発生せず、同じ問題を正答してクリアできる',()=>{
  const q=questions[0], {game,events}=make(q), p=q.plan;
  const roster=game.enemies.map(e=>e.id);
  for (const id of p.sources) game.notes.add(id);
  const wrong=p.options.findIndex(option=>!option.correct);
  for (let i=0;i<3;i++) game.propose(wrong);
  assert.equal(events.wrong,3);
  assert.equal(game.planAttempts,3);
  assert.deepEqual(game.enemies.map(e=>e.id),roster);
  assert.ok(!game.flags.has('planned'));
  game.propose(index(p.options));
  assert.ok(game.flags.has('planned'));
  const wrongPlace=q.rules.find(rule=>rule.wrong).target;
  for (let i=0;i<3;i++) operate(game,wrongPlace);
  operate(game,p.destination);
  assert.equal(events.wins,1);
});

test('設定に一致する問題を全5レベルで出し、同じレベルの再挑戦では別問題になる',()=>{
  const progress=initial();
  assert.equal(progress.settings.reading,3);
  for (const level of [1,2,3,4,5]) {
    progress.settings.reading=level;
    for (const {id} of stages) {
      const a=chooseVariant(questions,id,progress);
      const b=chooseVariant(questions,id,progress,true);
      assert.equal(a.difficulty,level);
      assert.equal(b.difficulty,level);
      assert.notEqual(a.id,b.id);
    }
  }
});

test('分岐と証拠帳を保存・復元し、別版のバックアップをはじく',()=>{
  const routes=['disclose','protect'].map(route=>{
    const progress=initial();
    for (const stage of stages.slice(0,4)) discovery(progress,stage,questions.find(q=>q.stageId===stage.id));
    assert.ok(selectRoute(progress,route));
    assert.ok(!selectRoute(progress,route));
    const history=[newRecord(questions[0])];
    const value=JSON.parse(JSON.stringify({format:backupFormat,progress,history}));
    assert.deepEqual(readBackup(value,6),{progress,history});
    assert.throws(()=>readBackup({...value,format:'reading-dungeon-v1'},6));
    assert.ok(historyCsv(history).includes('根拠正答数'));
    return [chooseVariant(questions,5,progress).id,routeClosing(route)];
  });
  assert.notDeepEqual(routes[0],routes[1]);
});

test('公開データの到達可能性とJSON・CSV往復、無効な強調箇所の検出',()=>{
  assert.equal(stages.length,6);
  assert.deepEqual(validateBank(questions,stages),[]);
  assert.deepEqual(importQuestions(JSON.stringify(questions),false),questions);
  assert.deepEqual(importQuestions(questionsCsv(questions),true),questions);
  const bad=structuredClone(questions[0]);
  bad.plan.highlights[0].quote='本文にない語句';
  assert.ok(validateQuestion(bad,stages).length);
});

test('新版の閉鎖扉は強攻撃と氷を遮り、同じ距離の広間内では凍結後に攻撃できる',()=>{
  const {game}=make(questions.find(q=>q.id==='k2-l3-1'));
  prepare(game);
  operate(game,game.question.plan.destination);
  operate(game,'gate');
  const boss=game.enemies.find(e=>e.boss);
  const {x,y}=game.stage.arena;
  Object.assign(game.player,{x:x-8,y,direction:[1,0]});
  Object.assign(boss,{x:x+20,y,rest:5,exposed:2});
  const hp=boss.hp;
  game.attack(true);
  assert.equal(boss.hp,hp);
  game.slot=1;
  game.cast();
  advance(game,.28);
  assert.equal(boss.status,null);
  assert.equal(game.projectiles.length,0);
  Object.assign(game.player,{x:x+20,y,cast:0,attack:0,direction:[1,0]});
  Object.assign(boss,{x:x+48,y,exposed:0});
  game.cast();
  advance(game,.2);
  assert.equal(boss.status,'freeze');
  game.attack(true);
  assert.ok(boss.hp<hp);
});

test('60問の正解一覧と資料数・選択肢・文の長さを照合する',()=>{
  const reviewed=[
    ['下流の石段','水車小屋','北門','南の広場','下流の石段','水車小屋','南の広場','北門','下流の石段','水車小屋'],
    ['星の印','月の印','花の印','鳥の印','月の印','花の印','鳥の印','星の印','花の印','月の印'],
    ['港の荷物箱','橋番の小屋','村の倉','広場の机','広場の机','港の荷物箱','橋番の小屋','村の倉','村の倉','橋番の小屋'],
    ['赤のレバー','青のレバー','黄のレバー','白のレバー','青のレバー','黄のレバー','白のレバー','赤のレバー','黄のレバー','白のレバー'],
    ['青い灯','銀の灯','赤い灯','黄色い灯','銀の灯','赤い灯','黄色い灯','青い灯','青い灯','銀の灯'],
    ['根の印','石の印','葉の印','雲の印','石の印','葉の印','雲の印','根の印','葉の印','雲の印'],
  ];
  assert.equal(questions.length,60);
  for (const q of questions) {
    const variant=Number(q.id.at(-1));
    const answer=reviewed[q.stageId-1][(q.difficulty-1)*2+variant-1];
    assert.equal(q.plan.options.find(o=>o.correct).text,answer,q.id);
    assert.equal(q.objects.find(o=>o.id===q.plan.destination).name,answer,q.id);
    const sources=q.objects.filter(o=>o.text);
    assert.equal(sources.length,q.difficulty<=3?1:2,q.id);
    assert.ok(sources.every(o=>[...o.text].length<=100),q.id);
    assert.ok(q.plan.options.length>=3 && q.plan.options.length<=4,q.id);
    const guides=battleGuide(q);
    assert.equal(guides.length,q.stageId%2?0:1);
    if (guides.length) assert.equal(guides[0].steps.length,3);
  }
});
