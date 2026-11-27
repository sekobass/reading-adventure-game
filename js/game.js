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
    this.notes = new Set();
    this.sequence = 0;
    this.slot = stage.id === 3 ? 1 : 0;
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
      invincible: 1, direction: [0, -1], walking: false,
    };
    this.knockedOut = false;
  }

  makeEnemy(data) {
    const max = Math.ceil((data.boss ? 58 : 23) * this.combat.health);
    return { ...data, hp: max, max, homeX: data.x, homeY: data.y,
      stunned: 0, windup: 0, rest: 0, flash: 0 };
  }

  effect(x, y, kind, color, direction = [0, -1]) {
    this.effects.push({ x, y, kind, color, direction, age: 0 });
  }

  blocked(x, y, radius) {
    if (x < 17 + radius || x > WIDTH - 17 - radius || y < 17 + radius || y > HEIGHT - 17 - radius) return true;
    const hit = ([left, top, width, height]) =>
      x + radius > left && y + radius > top && x - radius < left + width && y - radius < top + height;
    if (this.stage.walls.some(hit) || this.stage.water?.some(hit)) return true;
    if (this.stage.id === 5 && x + radius > 330 && !this.flags.has('entered')) return true;
    return false;
  }

  move(entity, dx, dy, radius) {
    if (!this.blocked(entity.x + dx, entity.y, radius)) entity.x += dx;
    if (!this.blocked(entity.x, entity.y + dy, radius)) entity.y += dy;
  }

  tick(dt, dx, dy) {
    if (this.finished || this.knockedOut) return;
    const p = this.player;
    this.clock += dt;
    p.attack = Math.max(0, p.attack - dt);
    p.cast = Math.max(0, p.cast - dt);
    p.invincible = Math.max(0, p.invincible - dt);
    p.mp = Math.min(maxMP(this.save), p.mp + dt * 3);
    const length = Math.hypot(dx, dy);
    p.walking = length > .1;
    if (p.walking) {
      p.direction = [dx / length, dy / length];
      this.move(p, dx / Math.max(1, length) * 87 * dt, dy / Math.max(1, length) * 87 * dt, 6);
    }
    for (const e of this.enemies) {
      if (this.knockedOut) break;
      if (e.hp <= 0 || e.fixed) continue;
      e.flash = Math.max(0, e.flash - dt);
      if (e.stunned > 0) {
        e.stunned = Math.max(0, e.stunned - dt);
        continue;
      }
      const range = distance(e, p);
      const reach = e.boss ? 31 : 18;
      e.rest = Math.max(0, e.rest - dt);
      if (e.windup > 0) {
        e.windup -= dt;
        if (e.windup <= 0) {
          e.rest = .85;
          if (range < reach + 3 && !p.invincible) this.hurt(e);
        }
        continue;
      }
      if (!e.rest && range < reach) {
        e.windup = e.boss ? .5 : .38;
      } else if (range > reach - 3 && range < (e.boss ? 151 : 100)) {
        const pace = (e.boss ? 29 : 39) * this.combat.pace * (e.rest ? .55 : 1);
        this.move(e, (p.x - e.x) / range * pace * dt, (p.y - e.y) / range * pace * dt, e.boss ? 11 : 5);
      } else if (!e.boss && range >= 100) {
        const x = e.homeX + Math.cos(this.clock * .8 + e.homeX) * 15;
        const y = e.homeY + Math.sin(this.clock * .9 + e.homeY) * 12;
        this.move(e, (x - e.x) * dt, (y - e.y) * dt, 5);
      }
    }
    for (const effect of this.effects) effect.age += dt;
    this.effects = this.effects.filter(effect => effect.age < .55);
  }

  hurt(e) {
    const p = this.player;
    p.hp = Math.max(0, p.hp - Math.max(1, this.combat.harm + (e.boss ? 4 : 0) - this.save.armor * 2));
    p.invincible = .8;
    this.effect(p.x, p.y, 'burst', '#ff7861');
    this.ui.sound('hurt');
    if (p.hp === 0) {
      this.knockedOut = true;
      this.ui.defeat();
    }
  }

  attack() {
    const p = this.player;
    if (p.attack || this.finished || this.knockedOut) return;
    p.attack = .32;
    this.ui.sound('slash');
    this.effect(p.x, p.y, 'slash', '#fff0af', p.direction);
    const candidates = this.enemies.filter(e => {
      const range = distance(e, p);
      return !e.fixed && e.hp > 0 && range < (e.boss ? 36 : 27) &&
        (range < 13 || (e.x - p.x) * p.direction[0] + (e.y - p.y) * p.direction[1] > -3);
    });
    for (const e of candidates) {
      if (this.finished) break;
      if (e.weakness && e.stunned <= 0) {
        this.ui.wrong('守りが固いときに剣を当てた');
        this.effect(e.x, e.y, 'burst', '#95aab7');
      } else this.damage(e, 11 + this.save.weapon * 3 + this.save.level);
    }
  }

  cast() {
    const p = this.player;
    if (p.cast || this.finished || this.knockedOut) return;
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
    if (p.mp < 8) return this.ui.toast('MPが足りない。少し待つと回復する。');
    p.mp -= 8;
    p.cast = .48;
    const kind = this.slot === 0 ? 'fire' : 'ice';
    const color = kind === 'fire' ? '#ff9c62' : '#93eaff';
    this.effect(p.x, p.y, 'spell', color);
    this.ui.sound('magic');
    for (const e of this.enemies) {
      if (e.fixed || e.hp <= 0 || distance(e, p) > 76) continue;
      this.effect(e.x, e.y, 'burst', color);
      if (e.weakness === kind) {
        e.stunned = e.stun;
        e.windup = 0;
        this.ui.toast('番人の動きが止まった！');
      } else if (e.weakness) {
        e.hp = Math.min(e.max, e.hp + 15);
        this.ui.wrong('番人を回復させる魔法を当てた');
      } else this.damage(e, 12 + this.save.level);
    }
  }

  damage(e, amount) {
    e.hp = Math.max(0, e.hp - amount);
    e.flash = .17;
    if (e.hp) return;
    this.effect(e.x, e.y, 'burst', '#ffe499');
    this.reward(e.boss ? 55 : 17, e.boss ? 26 : 7);
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
    return this.objects.filter(o => !o.open && distance(o, this.player) < 25)
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

  operate(o) {
    const seq = this.question.sequence;
    if (seq?.targets.includes(o.id)) {
      if (this.flags.has(seq.onComplete)) return this.ui.toast('仕掛けはすでに動いている。');
      if (seq.order[this.sequence] !== o.id) {
        this.sequence = 0;
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
      if (rule.wrong) this.ui.wrong(rule.wrong);
      return;
    }
    const result = rule.then;
    for (const [item, count] of Object.entries(result.give ?? {})) {
      this.inventory[item] = (this.inventory[item] ?? 0) + count;
      this.ui.toast(item + 'を手に入れた！');
    }
    for (const [item, count] of Object.entries(result.take ?? {})) this.inventory[item] -= count;
    for (const flag of result.set ?? []) this.flags.add(flag);
    if (result.open) {
      o.open = true;
      this.effect(o.x, o.y, 'burst', '#ffe9a3');
      this.ui.sound('pickup');
    }
    if (result.spawn) this.enemies.push(this.makeEnemy(result.spawn));
    if (result.move) {
      [this.player.x, this.player.y] = result.move;
      if (o.kind === 'gate') this.flags.add('entered');
    }
    if (o.delivery) this.ui.toast('依頼の品を届けた！');
    if (!rule.when.length && rule.wrong) this.ui.wrong(rule.wrong);
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
