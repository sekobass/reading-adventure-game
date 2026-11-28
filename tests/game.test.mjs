import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Game } from '../js/game.js';
import { spells, segmentHits, waypoint } from '../js/combat.js';
import { initial, historyCsv, newRecord } from '../js/storage.js';

const json = file => JSON.parse(readFileSync(new URL('../data/'+file+'.json',import.meta.url)));
const stages = json('stages');
const questions = json('questions');

function run(question, combat='normal') {
  const events = { mistakes:[], read:[], cleared:0, defeats:0 };
  const save = initial();
  save.settings.combat = combat;
  const game = new Game(stages.find(s=>s.id===question.stageId),question,save,{
    wrong: value=>events.mistakes.push(value), toast(){}, sound(){}, persist(){},
    complete: ()=>events.cleared++, defeat: ()=>events.defeats++,
    read: (note,reread)=>events.read.push([note.id,reread]),
  });
  return { game, events, save };
}

function reach(game, target, range=23) {
  const queue = [[game.player.x,game.player.y]];
  const visited = new Set([queue[0].join()]);
  const probe=Object.create(game);
  for (const [x,y] of queue) {
    probe.player={x,y};
    if (Math.hypot(x-target.x,y-target.y)<range &&
      (game.objects.includes(target) ? probe.nearest() === target : true)) {
      Object.assign(game.player,{x,y});
      return;
    }
    for (const [dx,dy] of [[4,0],[-4,0],[0,4],[0,-4]]) {
      const next = [x+dx,y+dy];
      const key = next.join();
      if (visited.has(key) || game.blocked(...next,6)) continue;
      visited.add(key);
      queue.push(next);
    }
  }
  assert.fail('到達できない: '+target.id);
}

const object = (game,id) => game.objects.find(o=>o.id===id);
function use(game,id) {
  const target = object(game,id);
  reach(game,target);
  game.interact();
}

function advance(game,time) {
  for (let elapsed=0;elapsed<time;elapsed+=.02) game.tick(.02,0,0);
}

function face(game,enemy) {
  const p=game.player;
  const length=Math.hypot(enemy.x-p.x,enemy.y-p.y)||1;
  p.direction=[(enemy.x-p.x)/length,(enemy.y-p.y)/length];
}

function useMagic(game,enemy,kind) {
  game.slot=spells.findIndex(spell=>spell?.id===kind);
  face(game,enemy);
  game.cast();
  advance(game,.23);
}

function defeatBoss(game,events) {
  const boss=game.enemies.find(e=>e.win);
  const support=game.enemies.find(e=>e.role==='support' && e.arena);
  assert.ok(game.arenaActive);
  assert.ok(game.blocked(game.stage.arena.x,145,6));
  game.player.invincible=120;
  if (support) {
    reach(game,boss,28);
    useMagic(game,boss,boss.phases[0].element);
    assert.equal(boss.exposed,0);
    reach(game,support,19);
    for (let i=0;i<8 && support.hp;i++) {
      face(game,support);
      game.attack();
      advance(game,.35);
    }
    assert.equal(support.hp,0);
    advance(game,1);
  }
  reach(game,boss,22);
  face(game,boss);
  const count=events.mistakes.length;
  const hp=boss.hp;
  game.attack();
  assert.equal(boss.hp,hp);
  useMagic(game,boss,boss.phases[0].element==='fire'?'ice':'fire');
  assert.equal(boss.hp,hp);
  assert.equal(boss.status,null);
  assert.ok(events.mistakes.length>count);
  for (let i=0;i<14 && !game.finished;i++) {
    if (game.player.mp<12) advance(game,4);
    advance(game,1.05);
    reach(game,boss,23);
    const phase=boss.phases[boss.phase];
    if (phase.guard && !boss.opening) {
      // Wait for the actual attack windup, then brace for impact.
      const deadline=game.clock+5;
      while (boss.windup<=0 && game.clock<deadline) advance(game,.02);
      assert.ok(boss.windup>0);
      advance(game,Math.max(0,boss.windup-.15));
      game.guard();
      advance(game,.84);
      assert.ok(boss.opening>0);
    }
    useMagic(game,boss,phase.element);
    assert.equal(boss.status,spells[game.slot].effect);
    face(game,boss);
    game.attack();
  }
  assert.equal(boss.phase,1);
  assert.equal(game.blocked(game.stage.arena.x+4,145,6),false);
}

test('5ステージ・5読解レベルに2種類ずつ用意されている',()=>{
  assert.equal(new Set(questions.map(q=>q.id)).size,50);
  for (const {id} of stages) for(let level=1;level<=5;level++) {
    assert.equal(questions.filter(q=>q.stageId===id && q.difficulty===level).length,2);
  }
});
for (const q of questions) {
  test(q.id+' の文章・到達可能性・誤答からの復帰・クリア',()=>{
    const { game,events,save } = run(q);
    assert.equal(q.plan.options.length,4);
    assert.equal(q.plan.options.filter(o=>o.correct).length,1);
    assert.equal(new Set(q.plan.options.map(o=>o.text)).size,4);
    const correct=q.plan.options.findIndex(o=>o.correct);
    game.propose(correct,q.plan.reasons?.findIndex(o=>o.correct));
    assert.equal(game.flags.has('planned'),false);
    const notes=q.objects.filter(o=>o.text);
    for (const note of notes) use(game,note.id);
    use(game,notes[0].id);
    assert.equal(events.read.length,notes.length+1);
    assert.deepEqual(events.read.at(-1),[notes[0].id,true]);
    use(game,'plan');
    game.propose(correct,q.plan.reasons?.findIndex(o=>o.correct));
    assert.equal(game.flags.has('planned'),true);
    if (q.stageId===1) {
      const key=q.rules.find(r=>r.then.win).target;
      for (const item of q.objects.filter(o=>o.kind==='chest' && o.id!==key)) use(game,item.id);
      assert.equal(events.mistakes.length,2);
      assert.ok(game.enemies.some(e=>e.id==='mimic'));
      use(game,key);
      assert.equal(game.inventory.城の鍵,1);
    }
    if (q.stageId===2) {
      use(game,'boat');
      assert.equal(game.finished,false);
      assert.equal(events.mistakes.length,1);
      assert.equal(game.blocked(301,143,6),true);
      use(game,'fuel');
      use(game,'boat');
      assert.ok(game.player.x>328);
      assert.equal(events.mistakes.length,1);
    }
    if (q.stageId===3) {
      use(game,'gate');
      defeatBoss(game,events);
    }
    if (q.stageId===4) {
      game.operate(object(game,'b'));
      assert.equal(events.mistakes.length,1);
      for (const o of q.objects.filter(o=>o.id.startsWith('pickup'))) use(game,o.id);
      for (const note of notes) {
        use(game,note.id);
        game.operate(object(game,note.id));
      }
      assert.equal(events.mistakes.length,1);
    }
    if (q.stageId===5) {
      use(game,'gate');
      assert.equal(game.blocked(game.stage.arena.x+4,145,6),true);
      use(game,q.sequence.order[0]);
      use(game,q.sequence.order[0]);
      assert.equal(game.sequence,0);
      assert.equal(events.mistakes.length,2);
      for (const id of q.sequence.order) use(game,id);
      use(game,'gate');
      assert.ok(game.player.x>330);
      defeatBoss(game,events);
    }
    assert.equal(events.cleared,1);
    assert.ok(game.finished);
    assert.ok(save.gold>0);
    assert.equal(save.inventory.回復薬,4);
  });
}
test('壁の当たり判定と戦闘失敗からの復帰',()=>{
  const {game,events}=run(questions.find(q=>q.id==='1-3-1'),'hard');
  const [x,y,w]=game.stage.walls[0];
  Object.assign(game.player,{x:x+w/2,y:y-7});
  game.tick(.04,0,1);
  assert.equal(game.player.y,y-7);
  const enemy=game.enemies[0];
  enemy.x=game.player.x;
  enemy.y=game.player.y;
  enemy.windup=.01;
  game.player.invincible=0;
  game.player.hp=1;
  game.tick(.04,0,0);
  assert.equal(events.defeats,1);
  assert.deepEqual(events.mistakes,[]);
  game.resetPlayer();
  assert.ok(game.player.hp>0 && !game.knockedOut);
});
test('学習履歴 CSV の列と引用符',()=>{
  const record=newRecord(questions[0]);
  record.mistakes.push('誤答 "赤"');
  record.readingMs=1250;
  const csv=historyCsv([record]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('"誤答 ""赤"""'));
  assert.ok(csv.includes('"1.25"'));
  assert.equal(csv.split('\r\n').length,2);
});

test('手当たり次第では計画も探索も進められない',()=>{
  const {game,events}=run(questions[0]);
  const key=game.question.rules.find(r=>r.then.win).target;
  use(game,key);
  assert.equal(game.finished,false);
  for (const id of game.question.plan.sources) use(game,id);
  const options=game.question.plan.options;
  const wrong=options.map((option,index)=>option.correct ? -1:index).filter(index=>index>=0);
  for (const index of wrong) game.propose(index);
  assert.equal(game.planAttempts,2);
  assert.equal(events.mistakes.length,2);
  game.propose(options.findIndex(option=>option.correct));
  assert.equal(game.flags.has('planned'),false);
  use(game,key);
  assert.equal(game.finished,false);
});

test('炎・氷・雷の着弾で固有の状態異常が発生し、MPが回復する',()=>{
  for (const [kind,status] of [['fire','burn'],['ice','freeze'],['thunder','shock']]) {
    const slot=spells.findIndex(spell=>spell?.id===kind);
    const {game}=run(questions[0]);
    const enemy=game.enemies[0];
    Object.assign(enemy,{x:100,y:219,rest:2});
    Object.assign(game.player,{x:70,y:219,mp:0,direction:[1,0]});
    game.slot=slot;
    game.cast();
    assert.equal(game.projectiles.length,0);
    advance(game,3.2);
    useMagic(game,enemy,kind);
    assert.equal(enemy.status,status);
    assert.ok(game.player.cast>0);
  }
});

test('通常の剣・魔法・敵弾・範囲攻撃は壁を貫通しない',()=>{
  const {game}=run(questions[0]);
  const [x,y,w,h]=game.stage.walls[0];
  const enemy=game.enemies[0];
  Object.assign(game.player,{x:x+w/2,y:y-7,invincible:0,direction:[0,1]});
  Object.assign(enemy,{x:x+w/2,y:y+h+6,rest:10});
  const hp=enemy.hp, playerHP=game.player.hp;
  game.attack();
  useMagic(game,enemy,'fire');
  assert.equal(enemy.hp,hp);
  assert.equal(game.projectiles.length,0);
  game.launch(enemy,game.player,130,100,{source:enemy});
  advance(game,.3);
  assert.equal(game.projectiles.length,0);
  enemy.pattern='pulse';
  enemy.aim={x:game.player.x,y:game.player.y};
  game.resolveAttack(enemy);
  assert.equal(game.player.hp,playerHP);
  const corner={x,y};
  assert.ok(segmentHits({x:corner.x-12,y:corner.y+12},{x:corner.x+12,y:corner.y-12},game.stage.walls[0],1));
  assert.ok(!game.clear(game.player,enemy));
  const next=waypoint(enemy,game.player,(a,b)=>game.clear(a,b,5),p=>game.blocked(p.x,p.y,5),480,288);
  assert.ok(next && next!==game.player);
  assert.ok(game.clear(enemy,next,5));
});

test('ボス敗北後に入口へ戻り、同じ計画から広間へ再入場できる',()=>{
  const {game,events}=run(questions.find(q=>q.id==='3-3-1'));
  for (const id of game.question.plan.sources) use(game,id);
  game.propose(game.question.plan.options.findIndex(o=>o.correct));
  use(game,'gate');
  const boss=game.enemies[0];
  assert.ok(game.arenaActive);
  assert.equal(game.clear({x:295,y:145},boss),false);
  game.player.invincible=0;
  game.player.hp=1;
  game.hurt(boss);
  assert.equal(events.defeats,1);
  game.retry();
  assert.ok(!game.arenaActive && !game.knockedOut);
  assert.ok(game.player.hp>1);
  use(game,'gate');
  assert.ok(game.arenaActive && game.enemies[0]!==boss);
});

test('ボスは防御で軽減でき、回避または防御から後半の隙を作れる',()=>{
  const {game}=run(questions.find(q=>q.id==='3-3-2'));
  for (const id of game.question.plan.sources) use(game,id);
  game.propose(game.question.plan.options.findIndex(o=>o.correct));
  use(game,'gate');
  const boss=game.enemies[0];
  boss.phase=1;
  boss.pattern='pulse';
  boss.aim={x:game.player.x,y:game.player.y};
  game.player.invincible=0;
  const hp=game.player.hp;
  game.guard();
  game.resolveAttack(boss);
  assert.ok(boss.opening>0);
  assert.ok(game.player.hp<hp && game.player.hp>hp-10);
  boss.opening=0;
  const defendedHP=game.player.hp;
  game.dodge();
  game.resolveAttack(boss);
  assert.ok(boss.opening>0);
  assert.equal(game.player.hp,defendedHP);
});

test('公開問題の構造、到達可能性、JSONとExcel用CSVの往復',async()=>{
  const {validateBank,importQuestions,questionsCsv}=await import('../js/question-data.js');
  assert.deepEqual(validateBank(questions,stages),[]);
  assert.deepEqual(importQuestions(JSON.stringify(questions),false),questions);
  assert.deepEqual(importQuestions(questionsCsv(questions),true),questions);
  const sample={...questions[0],mission:'=1+1',explanation:'一行目, "引用"\r\n二行目'};
  assert.deepEqual(importQuestions(questionsCsv([sample]),true),[sample]);
});

test('編集した問題の矛盾や到達不能を検出する',async()=>{
  const {validateQuestion}=await import('../js/question-data.js');
  const sample=()=>structuredClone(questions.find(q=>q.id==='2-3-1'));
  const missingFuel=sample();
  missingFuel.rules=missingFuel.rules.filter(rule=>rule.target!=='fuel');
  assert.match(validateQuestion(missingFuel,stages).join(),/手順が見つかりません/);
  const conflict=sample();
  conflict.rules.find(r=>r.target==='fuel').when=[{flag:'a'},{notFlag:'a'}];
  assert.match(validateQuestion(conflict,stages).join(),/矛盾/);
  const onFarSide=sample();
  Object.assign(onFarSide.objects.find(o=>o.id==='plan'),{x:385,y:125});
  assert.match(validateQuestion(onFarSide,stages).join(),/手順が見つかりません/);
  const mismatched=sample();
  mismatched.plan.options[1].correct=true;
  assert.match(validateQuestion(mismatched,stages).join(),/正解1つ/);
});

test('すべてのボスの記録と段階別の属性が一致する',()=>{
  const names={fire:'炎',ice:'氷',thunder:'雷'};
  for (const q of questions.filter(q=>q.stageId===3 || q.stageId===5)) {
    const spawn=q.rules.find(rule=>rule.target==='gate').then.spawn;
    const boss=[spawn].flat().find(enemy=>enemy.boss);
    const correct=q.plan.options.find(option=>option.correct).text;
    for (const phase of boss.phases) {
      assert.ok(correct.includes(names[phase.element]),q.id);
      assert.ok(q.explanation.includes(names[phase.element]),q.id);
    }
    assert.ok(boss.phases[1].guard);
    if (q.stageId===3) assert.equal(boss.phases[0].element,'ice');
  }
});

test('上級では計画に加えて根拠も必要で、誤答後は正しい根拠で続行できる',()=>{
  const question=questions.find(q=>q.id==='2-4-1');
  const {game,events}=run(question);
  for (const id of question.plan.sources) use(game,id);
  const plan=question.plan.options.findIndex(o=>o.correct);
  game.propose(plan);
  assert.equal(game.flags.has('planned'),false);
  game.propose(plan,question.plan.reasons.findIndex(o=>!o.correct));
  assert.equal(events.mistakes.length,1);
  assert.equal(game.flags.has('planned'),false);
  game.propose(plan,question.plan.reasons.findIndex(o=>o.correct));
  assert.equal(game.flags.has('planned'),true);
});

test('戦闘中の扉越しにボスへ剣や雷を当てられない',()=>{
  const q=questions.find(q=>q.id==='5-3-2');
  const {game}=run(q);
  for (const id of q.plan.sources) use(game,id);
  game.propose(q.plan.options.findIndex(o=>o.correct));
  for (const id of q.sequence.order) use(game,id);
  use(game,'gate');
  const boss=game.enemies.find(e=>e.boss);
  game.enemies.find(e=>e.role==='support').hp=0;
  const {x,y}=game.stage.arena;
  // Put both actors close enough to hit if the closed door were ignored.
  Object.assign(game.player,{x:x-7,y,direction:[1,0]});
  Object.assign(boss,{x:x+21,y,rest:4,exposed:3});
  const hp=boss.hp;
  game.attack();
  useMagic(game,boss,'thunder');
  assert.equal(boss.hp,hp);
  assert.equal(boss.status,null);
  assert.equal(game.projectiles.length,0);

  // Positive control: equivalent range, both actors on the same side.
  Object.assign(game.player,{x:x+22,y,cast:0,attack:0,direction:[1,0]});
  Object.assign(boss,{x:x+50,y,exposed:0});
  useMagic(game,boss,'thunder');
  assert.equal(boss.status,'shock');
  game.attack();
  assert.ok(boss.hp<hp);
});
