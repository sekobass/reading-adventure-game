import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Game } from '../kingdom/js/game.js';
import { spells } from '../kingdom/js/combat.js';
import { initial, newRecord, historyCsv } from '../kingdom/js/storage.js';
import { backupFormat, chooseVariant, discovery, readBackup, selectRoute, routeClosing } from '../kingdom/js/campaign.js';
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
  game.propose(index(p.options),index(p.reasons),p.evidence);
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

for (const q of questions) test('七つの封印 '+q.id+' の証拠、配置、クリア',()=>{
  const {game,events}=make(q);
  const p=q.plan;
  game.propose(index(p.options),index(p.reasons),p.evidence);
  assert.ok(!game.flags.has('planned'));
  prepare(game);
  assert.ok(game.flags.has('planned'));
  if (q.sequence) {
    for (const id of q.sequence.order) operate(game,id);
    operate(game,'gate');
    const boss=game.enemies.find(e=>e.boss);
    assert.ok(boss && game.arenaActive);
    assert.equal(game.clear({x:315,y:145},boss),false);
    fight(game,boss);
  } else operate(game,q.rules.find(rule=>rule.then.win).target);
  assert.equal(events.wins,1);
});

test('総当たりと攻撃の連打では作戦を通せない。再挑戦では資料が変わる',()=>{
  const q=questions[0], {game,events}=make(q), p=q.plan;
  for (const id of p.sources) game.notes.add(id);
  for (let i=0;i<120;i++) {
    game.attack(i%2===1);
    game.cast();
    operate(game,q.rules.find(rule=>rule.then.win).target);
    advance(game,.12);
  }
  game.propose(index(p.options),index(p.reasons),[]);
  game.propose(index(p.options),index(p.reasons),[...p.evidence,'n3']);
  game.propose(index(p.options),index(p.reasons),p.evidence);
  assert.equal(events.wrong,2);
  assert.ok(!game.flags.has('planned'));
  assert.ok(!game.finished);
  assert.ok(game.enemies.some(e=>e.id==='patrol'));
  assert.equal(chooseVariant(questions,1,game.save).id,'k1-1');
  assert.equal(chooseVariant(questions,1,game.save,true).id,'k1-2');
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

test('公開データの到達可能性とJSON・CSV往復、無効な証拠の検出',()=>{
  assert.equal(stages.length,6);
  assert.deepEqual(validateBank(questions,stages),[]);
  assert.deepEqual(importQuestions(JSON.stringify(questions),false),questions);
  assert.deepEqual(importQuestions(questionsCsv(questions),true),questions);
  const bad=structuredClone(questions[0]);
  bad.plan.evidence.push('unknown');
  assert.ok(validateQuestion(bad,stages).length);
});

test('新版の閉鎖扉は強攻撃と氷を遮り、同じ距離の広間内では凍結後に攻撃できる',()=>{
  const {game}=make(questions.find(q=>q.id==='k2-1'));
  prepare(game);
  for (const id of game.question.sequence.order) operate(game,id);
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
