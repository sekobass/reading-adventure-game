import { segmentHits, spells, waypoint } from './combat.js';

export const WIDTH = 480;
export const HEIGHT = 288;

const combatModes = {
  easy: { harm: 4, pace: .76, health: .78 },
  normal: { harm: 7, pace: 1, health: 1 },
  hard: { harm: 11, pace: 1.24, health: 1.25 },
};
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const maxHP = save => 80 + (save.level - 1) * 12;
export const maxMP = save => 36 + (save.level - 1) * 4;
const clamp = (v, min, max) => Math.max(min, Math.min(v, max));

export class Game {
  constructor(stage, question, save, ui) {
    this.stage = stage;
    this.question = question;
    this.save = save;
    this.ui = ui;
    this.objects = question.objects.map(o => ({ ...o, open: false }));
    this.enemies = question.enemies.map(e => this.makeEnemy(e));
    this.inventory = {};
    this.flags = new Set();
    this.planAttempts = 0;
    this.fieldFaults = 0;
    this.projectiles = [];
    this.notes = new Set();
    this.sequence = 0;
    this.slot = 0;
    this.effects = [];
    this.clock = 0;
    this.finished = false;
    this.knockedOut = false;
    this.resetPlayer();
  }

  get combat() { return combatModes[this.save.settings.combat] ?? combatModes.normal; }
  resetPlayer() {
    const [x, y] = this.stage.start;
    this.player = {
      x, y, hp: maxHP(this.save), mp: maxMP(this.save), attack: 0, cast: 0,
      guard:0, dodge:0, guardWait:0, dodgeWait:0, stamina:100, combo:0, comboTime:0, invincible: 1, direction: [0, -1], walking: false,
    };
    this.knockedOut = false;
  }

  makeEnemy(data) {
    const max = Math.ceil((data.boss ? 58 : 23) * this.combat.health);
    return { ...data, hp: max, max, homeX: data.x, homeY: data.y,
      status:null, statusTime:0, burnTick:0, windup:0, rest:0, flash:0, opening:0, exposed:0, phase:0, attacks:0, pathTime:0 };
  }

  effect(x, y, kind, color, direction = [0, -1]) {
    const label=kind==='damage'?String(direction):undefined;
    this.effects.push({ x, y, kind, color, direction, age: 0, label });
  }

  get arenaActive() { return this.flags.has('entered') && !this.finished; }

  get barriers() {
    const walls = [...this.stage.walls, ...(this.stage.water ?? [])];
    const arena = this.stage.arena;
    if (arena) {
      const { x, y } = arena;
      if (this.flags.has('entered') && this.finished) {
        walls.push([x,17,9,y-38],[x,y+21,9,HEIGHT-y-38]);
      } else walls.push([x,17,9,HEIGHT-34]);
    }
    return walls;
  }

  blocked(x, y, radius) {
    if (x < 17 + radius || x > WIDTH - 17 - radius || y < 17 + radius || y > HEIGHT - 17 - radius) return true;
    return this.barriers.some(rect => segmentHits({x,y},{x,y},rect,radius));
  }

  clear(a,b,padding=0) {
    return !this.barriers.some(rect=>segmentHits(a,b,rect,padding));
  }

  move(entity, dx, dy, radius) {
    for (const [x,y] of [[dx,0],[0,dy]]) {
      const next = {x:entity.x+x,y:entity.y+y};
      if (!this.blocked(next.x,next.y,radius) && this.clear(entity,next,radius)) Object.assign(entity,next);
    }
  }

  retry() {
    this.resetPlayer();
    this.projectiles = [];
    this.effects = [];
    if (!this.arenaActive) return;
    this.flags.delete('entered');
    this.enemies = this.enemies.filter(e=>!e.arena);
    const gate = this.objects.find(o=>o.kind==='gate');
    gate.open = false;
  }

  guard() {
    const p = this.player;
    if (p.guardWait || p.dodge || p.stamina<8) return;
    p.stamina-=8;
    p.guard = .8;
    p.guardWait = 1.15;
    this.effect(p.x,p.y,'burst','#c0d8e8');
  }

  dodge() {
    const p = this.player;
    if (p.dodgeWait || p.stamina<18) return;
    p.stamina-=18;
    p.dodge = .34;
    p.dodgeWait = .93;
    p.guard = 0;
    p.evade = p.direction.slice();
    this.effect(p.x,p.y,'burst','#d7e3bd');
  }

  tick(dt, dx, dy) {
    if (this.finished || this.knockedOut) return;
    const p = this.player;
    this.clock += dt;
    for (const timer of ['attack','cast','invincible','guard','dodge','guardWait','dodgeWait','comboTime']) {
      p[timer] = Math.max(0,p[timer]-dt);
    }
    p.stamina=Math.min(100,p.stamina+dt*(p.guard?7:19));
    p.mp = Math.min(maxMP(this.save), p.mp + dt * 3.3);
    const length = Math.hypot(dx, dy);
    p.walking = length > .1 || p.dodge > 0;
    if (p.dodge) {
      this.move(p,p.evade[0]*158*dt,p.evade[1]*158*dt,6);
    } else if (length > .1) {
      p.direction = [dx / length, dy / length];
      const speed = p.guard ? 43 : 87;
      this.move(p, dx / Math.max(1, length) * speed * dt, dy / Math.max(1, length) * speed * dt, 6);
    }
    for (const e of this.enemies) {
      if (this.finished || this.knockedOut) break;
      if (e.hp > 0 && !e.fixed) this.tickEnemy(e,dt);
    }
    if (!this.finished && !this.knockedOut) this.tickProjectiles(dt);
    for (const effect of this.effects) effect.age += dt;
    this.effects = this.effects.filter(effect => effect.age < .55);
  }

  phase(e) { return e.phases?.[e.phase]; }

  tickEnemy(e,dt) {
    const p = this.player;
    for (const timer of ['flash','rest','opening','exposed','statusTime','pathTime']) {
      e[timer] = Math.max(0,e[timer]-dt);
    }
    if (!e.statusTime) e.status = null;
    if (e.status === 'burn' && !e.boss) {
      e.burnTick -= dt;
      if (e.burnTick <= 0) {
        e.burnTick = .65;
        this.damage(e,3);
        if (!e.hp) return;
      }
    }
    if (e.status === 'freeze' || e.status === 'shock') return;
    if (e.role==='healer' && !e.rest) {
      const ally=this.enemies.find(a=>a!==e && a.hp>0 && a.hp<a.max && distance(e,a)<95 && this.clear(e,a));
      if (ally) {
        ally.hp=Math.min(ally.max,ally.hp+6);
        e.rest=2.1;
        this.effect(ally.x,ally.y,'burst','#92e0a3');
      }
    }
    const range = distance(e,p);
    const phase = this.phase(e);
    const sees = this.clear(e,p,1);
    const reach = e.boss ? 36 : 21;
    if (e.windup > 0) {
      e.windup -= dt;
      if (e.windup <= 0) this.resolveAttack(e);
      return;
    }
    if (!e.rest && sees && range < (e.boss ? 145 : e.role==='support' ? 104 : reach)) {
      e.pattern = phase?.pattern ?? (e.role==='support' ? 'shot' : 'melee');
      if (e.boss && !phase?.guard && e.attacks%2===1) e.pattern='sweep';
      e.attacks += 1;
      e.aim = {x:p.x,y:p.y};
      const telegraph = this.combat.pace > 1 ? .68 : .86;
      e.windup = e.boss ? telegraph : .55;
      return;
    }
    if (range < 174 && range > reach-2 && !(e.boss && e.rest)) {
      const radius = e.boss ? 10 : 5;
      const clear = (a,b)=>this.clear(a,b,radius);
      if (clear(e,p)) e.next = p;
      else if (!e.pathTime || e.next === p) {
        e.pathTime = .3;
        e.next = waypoint(e,p,clear,o=>this.blocked(o.x,o.y,radius),WIDTH,HEIGHT);
      }
      if (e.next) {
        const gap = distance(e,e.next);
        if (gap > 1) {
          const step = Math.min(gap,(e.boss?36:42)*this.combat.pace*dt);
          this.move(e,(e.next.x-e.x)*step/gap,(e.next.y-e.y)*step/gap,radius);
        } else e.pathTime = 0;
      }
    }
  }

  resolveAttack(e) {
    const p=this.player;
    const phase=this.phase(e);
    e.rest = e.boss ? 1.5 : 1;
    const range = distance(e,p);
    if (e.pattern==='shot') {
      this.launch(e,e.aim,112,170,{source:e});
      return;
    }
    if (e.pattern==='rush') {
      const gap=distance(e,e.aim) || 1;
      for (let i=0;i<6;i++) this.move(e,(e.aim.x-e.x)/gap*6,(e.aim.y-e.y)/gap*6,10);
    }
    const area=e.pattern==='pulse' || e.pattern==='cross';
    const reach=area ? (e.pattern==='pulse'?132:115) : e.pattern==='sweep'?53:e.boss?39:24;
    if (area) this.effect(e.x,e.y,'wave','#f8ab73');
    const dodged=p.dodge || (area && range<=155 && distance(e.aim,p)>26);
    const hit=distance(e,p)<=reach && this.clear(e,p,2);
    if (phase?.guard && this.clear(e,p) && range<155 && (dodged || (hit && p.guard))) {
      e.opening=3.8;
    }
    if (hit && !dodged) this.hurt(e,area?3:0);
    if (e.pattern==='cross') {
      for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        this.launch(e,{x:e.x+dx,y:e.y+dy},95,110,{source:e});
      }
    }
  }

  hurt(e, extra = 0) {
    const p = this.player;
    if (p.invincible || p.dodge) return;
    const amount=Math.max(1,this.combat.harm+(e.boss?5:0)+extra-this.save.armor*2-Number(Boolean(this.save.charm)));
    p.hp = Math.max(0,p.hp-(p.guard?Math.max(1,Math.floor(amount*.25)):amount));
    p.invincible = .7;
    this.effect(p.x, p.y, 'burst', p.guard?'#c0d8e8':'#ff7861');
    this.ui.sound('hurt');
    if (p.hp === 0) {
      this.knockedOut = true;
      this.ui.defeat();
    }
  }

  launch(from,to,speed,range,payload) {
    const dx=to.x-from.x, dy=to.y-from.y, length=Math.hypot(dx,dy) || 1;
    this.projectiles.push({x:from.x,y:from.y,dx:dx/length,dy:dy/length,speed,range,...payload});
  }

  tickProjectiles(dt) {
    this.projectiles = this.projectiles.filter(shot=>{
      if (this.finished || this.knockedOut) return false;
      const step=Math.min(shot.range,shot.speed*dt);
      const target={x:shot.x+shot.dx*step,y:shot.y+shot.dy*step};
      if (this.blocked(target.x,target.y,2) || !this.clear(shot,target,2)) {
        this.effect(shot.x,shot.y,'burst',shot.spell?.color ?? '#f3ad73');
        return false;
      }
      const actors=shot.spell?this.enemies:[this.player];
      const hit=actors.filter(e=>e.hp>0&&!e.fixed&&(!e.arena||this.arenaActive)&&this.clear(shot,e,1))
        .map(e=>{
          const along=(e.x-shot.x)*shot.dx+(e.y-shot.y)*shot.dy;
          const offset=distance(e,{x:shot.x+shot.dx*clamp(along,0,step),y:shot.y+shot.dy*clamp(along,0,step)});
          return {e,offset,along};
        })
        .filter(({e,offset})=>offset<=(e.boss?13:9))
        .sort((a,b)=>a.along-b.along)[0]?.e;
      if (hit) {
        if (shot.spell) this.hitSpell(hit,shot.spell);
        else this.hurt(shot.source);
        return false;
      }
      shot.range-=step;
      Object.assign(shot,target);
      return shot.range>0;
    });
  }

  attack(strong=false) {
    const p = this.player;
    if (p.attack || p.dodge || p.guard || this.finished || this.knockedOut) return;
    const cost=strong?24:5;
    if (p.stamina<cost) return;
    p.stamina-=cost;
    p.attack = strong?.68:.32;
    this.ui.sound('slash');
    this.effect(p.x, p.y, 'slash', '#fff0af', p.direction);
    const candidates = this.enemies.filter(e => {
      const range = distance(e, p);
      return !e.fixed && e.hp > 0 && range < (e.boss ? 36 : strong ? 33:27) && this.clear(p,e,2) &&
        (!e.arena || this.arenaActive) &&
        (range < 13 || (e.x - p.x) * p.direction[0] + (e.y - p.y) * p.direction[1] > -3);
    });
    for (const e of candidates) {
      if (this.finished) break;
      if (e.boss && (!e.exposed || this.supports(e))) {
        this.rejectAttack(e,'守りが固いときに剣を当てた');
        continue;
      }
      if (e.role==='guard' && !e.status && !e.rest && !strong) {
        this.effect(e.x,e.y,'burst','#b6bcd1');
        continue;
      }
      if (e.role==='support' && !e.status && e.windup>0 && !e.evaded) {
        e.evaded=true;
        this.move(e,-p.direction[1]*16,p.direction[0]*16,5);
        continue;
      }
      if (e.boss) e.exposed=0;
      p.combo=p.comboTime ? (p.combo+1)%3:1;
      p.comboTime=1;
      this.damage(e,(strong?20:11)+this.save.weapon*3+this.save.level+(p.combo===0?4:0));
    }
  }

  cast() {
    const p = this.player;
    if (p.cast || p.dodge || p.guard || this.finished || this.knockedOut) return;
    if (this.slot === 2) {
      if (!this.save.inventory.回復薬) return this.ui.toast('回復薬を持っていない。');
      if (p.hp >= maxHP(this.save)) return this.ui.toast('HPは満タンだ。');
      this.save.inventory.回復薬 -= 1;
      p.hp = Math.min(maxHP(this.save), p.hp + 38);
      p.cast = .45;
      this.effect(p.x, p.y, 'burst', '#8af7a6');
      this.ui.persist();
      this.ui.sound('pickup');
      return;
    }
    const spell=spells[this.slot];
    if (!spell) return;
    if (p.mp < spell.cost) return this.ui.toast('MPが足りない。少し待つと回復する。');
    p.mp-=spell.cost;
    p.cast=spell.cooldown;
    this.effect(p.x,p.y,'spell',spell.color);
    this.ui.sound('magic');
    this.launch(p,{x:p.x+p.direction[0],y:p.y+p.direction[1]},170,108,{spell});
  }

  heal() {
    const p=this.player;
    if (p.cast || p.guard || p.dodge || p.mp<14 || p.hp===maxHP(this.save)) return;
    p.mp-=14;
    p.cast=1.45;
    p.hp=Math.min(maxHP(this.save),p.hp+24);
    this.effect(p.x,p.y,'burst','#92e0a3');
    this.ui.sound('magic');
  }

  supports(e) {
    return this.enemies.some(other=>other!==e && other.hp>0 && other.arena && other.role==='support');
  }

  rejectAttack(e,message) {
    if (e.disruptedAt===undefined || this.clock-e.disruptedAt>.8) {
      e.disruptedAt=this.clock;
      this.ui.wrong(message);
    }
    if (!e.windup && !e.exposed) e.rest=Math.min(e.rest,.15);
    this.effect(e.x,e.y,'burst','#95aab7');
  }

  hitSpell(e,spell) {
    const phase=this.phase(e);
    if (e.boss && (this.supports(e) || spell.id!==phase.element || (phase.guard && !e.opening))) {
      this.rejectAttack(e,'守りが固い間に魔法を当てた');
      return;
    }
    if (e.role==='guard' && spell.id==='fire') {
      this.effect(e.x,e.y,'burst','#95aab7');
      return;
    }
    if (e.boss && e.exposed) return;
    e.status=spell.effect;
    e.statusTime=e.boss?2.1:spell.id==='fire'?2.6:spell.id==='ice'?1.65:1.1;
    e.burnTick=.3;
    if (spell.effect!=='burn') e.windup=0;
    this.effect(e.x,e.y,'burst',spell.color);
    if (e.boss) {
      e.exposed=2.1;
      e.opening=0;
    } else this.damage(e,spell.id==='thunder'?12:8);
  }

  damage(e, amount) {
    const nextPhase=e.phases?.[e.phase+1];
    const threshold=nextPhase ? Math.ceil(e.max*(e.phases.length-e.phase-1)/e.phases.length) : 0;
    if (nextPhase && e.hp-amount<=threshold) {
      e.hp=threshold;
      e.phase+=1;
      e.exposed=e.opening=e.statusTime=e.windup=0;
      e.status=null;
      e.rest=.35;
      this.effect(e.x,e.y,'wave','#e8cb96');
      if (nextPhase.summon) this.enemies.push(this.makeEnemy(nextPhase.summon));
      this.ui.toast('番人が姿勢を変えた。');
      return;
    }
    this.effect(e.x,e.y,'damage','#ffeac2',Math.min(e.hp,amount));
    e.hp = Math.max(0, e.hp - amount);
    e.flash = .17;
    if (e.hp) return;
    this.effect(e.x, e.y, 'burst', '#ffe499');
    this.reward(e.boss ? 55 : 17, e.boss ? 26 : 7);
    if (e.role==='healer') this.save.inventory.回復薬=(this.save.inventory.回復薬 ?? 0)+1;
    if (e.win) this.win();
    else this.ui.persist();
  }

  reward(xp, gold) {
    this.save.gold += gold;
    this.save.xp += xp;
    let leveled = false;
    while (this.save.xp >= this.save.level * 45) {
      this.save.xp -= this.save.level * 45;
      this.save.level += 1;
      leveled = true;
    }
    if (leveled) {
      this.player.hp = maxHP(this.save);
      this.player.mp = maxMP(this.save);
      this.effect(this.player.x, this.player.y, 'burst', '#ffee99');
      this.ui.toast('レベルアップ！');
      this.ui.sound('pickup');
    }
  }

  nearest() {
    return this.objects.filter(o => !o.open && distance(o, this.player) < 25 && this.clear(this.player,o))
      .sort((a, b) => distance(a, this.player) - distance(b, this.player))[0];
  }

  matches(conditions) {
    return conditions.every(c => {
      if (c.item) return (this.inventory[c.item] ?? 0) >= c.count;
      if (c.notFlag) return !this.flags.has(c.notFlag);
      return this.flags.has(c.flag);
    });
  }

  interact() {
    if (this.finished || this.knockedOut) return;
    const o = this.nearest();
    if (!o) return this.ui.toast('人や物に近づいてから調べよう。');
    if (o.text) {
      const known = this.notes.has(o.id);
      this.notes.add(o.id);
      this.ui.read(o, known);
      return;
    }
    this.operate(o);
  }

  propose(index,reasonIndex,evidence=[]) {
    const plan=this.question.plan;
    if (!plan || this.flags.has('planned') || this.planAttempts>=2 ||
        !plan.sources.every(id=>this.notes.has(id))) return;
    const option=plan.options[index];
    if (!option) return;
    const reason=plan.reasons?.[reasonIndex];
    if (plan.reasons && !reason) return;
    const evidenceCorrect=plan.evidence.length===new Set(evidence).size && plan.evidence.every(id=>evidence.includes(id));
    this.ui.reason?.(Boolean(reason?.correct),evidenceCorrect);
    if (option.correct && reason?.correct && evidenceCorrect) {
      this.flags.add('planned');
      this.ui.sound('pickup');
      return;
    }
    this.planAttempts+=1;
    if (this.planAttempts===1) this.enemies.push(this.makeEnemy({id:'patrol',role:'support',x:306,y:241}));
    this.ui.wrong('攻略計画: '+option.text+(reason?' 根拠: '+reason.text:''));
  }

  operate(o) {
    const plan=this.question.plan;
    if (plan?.target===o.id) return this.ui.plan?.();
    if (this.fieldFaults>=2) return this.ui.toast('現地の判断をやり直そう。作戦卓へ戻って再調査できる。');
    if (plan && !this.flags.has('planned')) return this.ui.toast('記録を読み、計画を立ててから進もう。');
    const seq = this.question.sequence;
    if (seq?.targets.includes(o.id)) {
      if (this.flags.has(seq.onComplete)) return this.ui.toast('仕掛けはすでに動いている。');
      if (seq.order[this.sequence] !== o.id) {
        this.sequence = 0;
        this.fieldFaults++;
        this.ui.wrong(seq.wrong);
        return;
      }
      this.sequence += 1;
      this.effect(o.x, o.y, 'burst', '#ffe89f');
      this.ui.sound('pickup');
      if (this.sequence === seq.order.length) {
        this.flags.add(seq.onComplete);
        this.ui.toast('奥の扉から音がした！');
      }
      return;
    }
    const rule = this.question.rules.find(r => r.target === o.id);
    if (!rule) return;
    if (!this.matches(rule.when)) {
      if (rule.wrong) { this.fieldFaults++; this.ui.wrong(rule.wrong); }
      return;
    }
    const result = rule.then;
    for (const [item, count] of Object.entries(result.give ?? {})) {
      this.inventory[item] = (this.inventory[item] ?? 0) + count;
      this.ui.toast(item + 'を手に入れた！');
    }
    for (const [item, count] of Object.entries(result.take ?? {})) this.inventory[item] -= count;
    for (const flag of result.set ?? []) this.flags.add(flag);
    if (result.gold) {
      this.save.gold+=result.gold;
      this.ui.persist();
      this.ui.toast(result.gold+' Gを見つけた。');
    }
    if (result.open) {
      o.open = true;
      this.effect(o.x, o.y, 'burst', '#ffe9a3');
      this.ui.sound('pickup');
    }
    if (result.spawn) this.enemies.push(...[result.spawn].flat().map(enemy=>this.makeEnemy(enemy)));
    if (result.move) {
      [this.player.x, this.player.y] = result.move;
      if (o.kind === 'gate') {
        this.flags.add('entered');
        this.projectiles=[];
        this.effect(this.player.x,this.player.y,'wave','#e6bf77');
        if (result.spawn?.name) this.ui.toast(result.spawn.name+'が現れた。');
      }
    }
    if (o.delivery) this.ui.toast('依頼の品を届けた！');
    if (!rule.when.length && rule.wrong) { this.fieldFaults++; this.ui.wrong(rule.wrong); }
    if (result.win || (this.question.completeWhen && this.matches(this.question.completeWhen))) this.win();
  }

  win() {
    if (this.finished) return;
    this.finished = true;
    this.reward(30, 18);
    this.save.inventory.回復薬 = (this.save.inventory.回復薬 ?? 0) + 1;
    this.ui.complete();
  }
}
