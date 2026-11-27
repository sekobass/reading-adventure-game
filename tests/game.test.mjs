import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Game } from '../js/game.js';
import { initial, historyCsv, newRecord } from '../js/storage.js';

const json = file => JSON.parse(readFileSync(new URL('../data/'+file+'.json',import.meta.url)));
const stages = json('stages');
const questions = json('questions');
const sizes = [[60,100],[100,150],[150,200],[200,300],[300,400]];

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
  for (const [x,y] of queue) {
    if (Math.hypot(x-target.x,y-target.y)<range &&
      (game.objects.includes(target) ? game.nearest.call({...game,player:{x,y}}) === target : true)) {
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

function defeatBoss(game,events) {
  const boss = game.enemies.find(e=>e.win);
  reach(game,boss,29);
  const length = Math.hypot(boss.x-game.player.x,boss.y-game.player.y) || 1;
  game.player.direction=[(boss.x-game.player.x)/length,(boss.y-game.player.y)/length];
  const count = events.mistakes.length;
  const hp = boss.hp;
  game.attack();
  assert.equal(boss.hp,hp);
  game.slot=boss.weakness==='ice'?0:1;
  boss.hp-=12;
  game.cast();
  assert.equal(boss.hp,hp);
  assert.equal(events.mistakes.length,count+2);
  game.slot=boss.weakness==='ice'?1:0;
  game.tick(.5,0,0);
  game.cast();
  assert.ok(boss.stunned>0);
  for (let i=0;i<12 && !game.finished;i++) {
    game.attack();
    game.tick(.33,0,0);
  }
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
    const size=q.objects.flatMap(o=>o.text??[]).join('').length;
    assert.ok(size>=sizes[q.difficulty-1][0] && size<=sizes[q.difficulty-1][1], size);
    const notes=q.objects.filter(o=>o.text);
    for (const note of notes) use(game,note.id);
    use(game,notes[0].id);
    assert.equal(events.read.length,notes.length+1);
    assert.deepEqual(events.read.at(-1),[notes[0].id,true]);
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
    if (q.stageId===3) defeatBoss(game,events);
    if (q.stageId===4) {
      game.operate(object(game,'a'));
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
      assert.equal(game.blocked(350,145,6),true);
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
