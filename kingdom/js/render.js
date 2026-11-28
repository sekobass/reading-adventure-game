import { WIDTH, HEIGHT } from './game.js';

const themes = {
  forest: ['#294b3c','#365a45','#51765a','#142e2a','#3a6046','#6c9160','#9a8460','#b49a70'],
  river: ['#3b5945','#45674c','#68845c','#1a392f','#42674a','#769457','#a38a65','#b99e76'],
  cave: ['#303d57','#3d4b66','#566380','#182538','#485479','#7186ac','#555976','#74778e'],
  village: ['#465e42','#526c49','#758759','#263b2e','#57764b','#8ca35b','#987b53','#b39564'],
  ruins: ['#413f53','#4c4a60','#67647b','#242638','#565373','#837c9b','#64576b','#81708a'],
};

export function renderer(canvas,minimap) {
  const chart=minimap.getContext('2d');
  const ctx = canvas.getContext('2d');
  const ground = document.createElement('canvas');
  ground.width = WIDTH;
  ground.height = HEIGHT;
  const g = ground.getContext('2d');
  let lastStage;
  const paint = (target, x, y, w, h, color) => {
    target.fillStyle = color;
    target.fillRect(Math.round(x), Math.round(y), w, h);
  };
  const pixel = (x,y,w,h,color) => paint(ctx,x,y,w,h,color);
  const tile = (x,y,w,h,color) => paint(g,x,y,w,h,color);

  function tree(x, y, c, scale = 1) {
    const block = (dx,dy,w,h,color) => tile(x + dx*scale,y + dy*scale,w*scale,h*scale,color);
    block(-10,5,21,8,'#101e27');
    if (c === themes.cave) {
      block(-10,-3,20,12,c[3]);
      block(-4,-15,8,18,c[4]);
      block(-3,-13,2,14,'#83adca');
      block(1,-11,2,9,'#a0c6db');
      block(3,-3,5,9,'#5d719d');
      return;
    }
    if (c === themes.ruins) {
      block(-9,-9,18,19,c[3]);
      block(-6,-11,12,18,c[4]);
      block(-7,-12,14,4,c[5]);
      block(-4,-5,2,11,c[5]);
      block(2,-2,2,5,'#aa8b78');
      return;
    }
    block(-3,-1,6,13,'#594735');
    block(-11,-13,22,17,c[3]);
    block(-7,-19,14,22,c[4]);
    block(-13,-9,26,12,c[4]);
    block(-9,-15,17,10,c[5]);
    block(-4,-19,8,4,c[5]);
    block(-8,-7,9,3,c[5]);
    block(4,0,6,3,c[3]);
  }

  function background(stage) {
    const c = themes[stage.theme];
    let seed = 97 + stage.id * 332;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    tile(0,0,WIDTH,HEIGHT,c[0]);
    for (let y=0;y<HEIGHT;y+=8) for (let x=0;x<WIDTH;x+=8) {
      const r = random();
      if (r < .39) tile(x,y,8,8,r < .13 ? c[1] : c[0]);
      if (r < .12) {
        tile(x+2,y+4,3,1,c[2]);
        tile(x+4,y+2,1,3,c[2]);
      }
      if (r > .98) tile(x+3,y+5,2,2,stage.theme === 'cave' ? '#a7bbfc' : '#d5a567');
    }
    const path = [[65,223,170,17],[221,109,17,131],[222,108,193,15],[65,73,15,150],[68,72,171,14]];
    for (const [x,y,w,h] of path) {
      tile(x,y,w,h,c[6]);
      tile(x+2,y+2,w-4,h-4,c[7]);
      for (let k=0;k<w*h/38;k++) tile(x+random()*(w-3),y+random()*(h-2),2,1,random()<.5 ? c[6] : c[2]);
    }
    for (const [x,y,w,h] of stage.water ?? []) {
      tile(x-4,y,w+8,h,'#77918a');
      tile(x,y,w,h,'#24536a');
      for(let j=0;j<95;j++) tile(x+random()*(w-10),y+random()*h,3+Math.floor(random()*7),1,random()<.5?'#39768a':'#2e647c');
    }
    for (const [x,y,w,h] of stage.bridges ?? []) {
      const pieces = y < 100 ? [[x,y,14,h],[x+w-16,y,16,h]] : [[x,y,w,h]];
      for (const [bx,by,bw,bh] of pieces) {
        tile(bx,by,bw,bh,'#705235');
        for (let dx=1;dx<bw;dx+=5) tile(bx+dx,by+2,3,bh-4,'#b2895c');
        tile(bx,by,bw,2,'#dac08a');
      }
    }
    for(const [x,y,w,h] of stage.walls) {
      tile(x-2,y+4,w+4,h,'#1b2b32');
      tile(x,y,w,h,c[3]);
      tile(x,y-4,w,h,c[2]);
      for(let dx=1;dx<w-1;dx+=10) {
        tile(x+dx,y-3,Math.min(8,w-dx),4,c[5]);
        tile(x+dx,y+3,Math.min(7,w-dx),1,c[4]);
      }
    }
    tile(0,0,WIDTH,15,c[3]);
    tile(0,272,WIDTH,16,c[3]);
    tile(0,0,14,HEIGHT,c[3]);
    tile(466,0,14,HEIGHT,c[3]);
    for (let x=4;x<480;x+=16) {
      tree(x, 9+random()*8,c,.8+random()*.44);
      tree(x, 279+random()*7,c,.85+random()*.36);
    }
    for (let y=34;y<268;y+=19) {
      tree(7+random()*6,y,c,.85);
      tree(472-random()*6,y,c,.84);
    }
    for (const [x,y] of [[42,43],[39,166],[182,244],[410,36],[444,198],[399,254]]) {
      // Flat foliage keeps the walkable floor visibly distinct from the walls.
      tile(x-7,y,14,3,c[4]);
      tile(x-4,y-3,9,4,c[5]);
      tile(x+2,y-4,3,3,c[2]);
    }
    lastStage = stage;
  }

  function person(x,y,body,hair,facing,bob=0) {
    pixel(x-7,y+2,14,4,'#131b26a0');
    pixel(x-4,y-2+bob,3,6,'#252841');
    pixel(x+1,y-2-bob,3,6,'#252841');
    pixel(x-5,y-9,10,8,body);
    pixel(x-7,y-8,2,5,'#efba83');
    pixel(x+5,y-8,2,5,'#efba83');
    pixel(x-4,y-15,8,7,'#ffd39d');
    pixel(x-5,y-16,10,3,hair);
    pixel(x-4,y-13,2,2,hair);
    pixel(x+(facing[0]<-.3?-2:1),y-12,1,2,'#253041');
    pixel(x-4,y-4,8,2,'#695036');
    pixel(x,y-4,2,2,'#ffdb89');
  }

  function object(o, highlighted, active) {
    const {x,y,kind} = o;
    if (o.open && kind !== 'chest') return;
    if (kind === 'npc') {
      person(x,y,'#d688a4','#68465d',[0,1]);
      pixel(x-1,y-23,3,6,'#f7d693');
      pixel(x-1,y-16,3,2,'#f7d693');
    } else if (kind === 'chest') {
      pixel(x-10,y-8,20,13,'#222335');
      pixel(x-8,y-7,16,9,o.open ? '#514338' : o.color);
      pixel(x-7,y-10-(o.open?3:0),14,5,o.open?'#836e4f':o.color);
      pixel(x-9,y-3,18,2,'#e0ae64');
      pixel(x-1,y-5,3,5,'#ffe7a2');
    } else if (kind === 'boat') {
      pixel(x-10,y-7,20,12,'#503c38');
      pixel(x-13,y-4,26,6,'#674838');
      pixel(x-8,y-5,16,8,'#be8b54');
      pixel(x-2,y-12,2,16,'#f3c68a');
      pixel(x-1,y-11,8,7,'#e5d6a8');
    } else if (kind === 'house') {
      pixel(x-17,y-15,34,21,'#635544');
      pixel(x-20,y-19,40,7,'#a66a58');
      pixel(x-15,y-24,30,6,'#c48768');
      pixel(x-4,y-8,8,14,'#322d36');
      pixel(x+7,y-10,6,6,'#ffe0a1');
    } else if (kind === 'gate') {
      pixel(x-11,y-18,22,24,'#535168');
      pixel(x-7,y-13,14,19,'#252638');
      pixel(x-5,y-11,10,17,'#967758');
      pixel(x-1,y-8,2,12,'#66513d');
    } else if (kind === 'pedestal') {
      pixel(x-10,y-9,20,14,'#393951');
      pixel(x-8,y-11,16,11,active?'#9a855f':'#737c94');
      ctx.font='12px sans-serif';
      ctx.textAlign='center';
      ctx.fillStyle=active?'#ffd780':'#e5dbfc';
      ctx.fillText(o.glyph,x,y-1);
    } else if (kind === 'book') {
      pixel(x-8,y-8,16,11,'#573c52');
      pixel(x-7,y-9,14,9,'#eadeb1');
      pixel(x,y-9,1,9,'#847255');
      pixel(x-5,y-6,4,1,'#ae9873');
      pixel(x+2,y-4,4,1,'#ae9873');
    } else if (kind === 'supply') {
      pixel(x-5,y-5,11,9,'#b57556');
      pixel(x-3,y-8,7,6,'#e0be76');
      pixel(x,y-7,2,4,'#648757');
    } else {
      pixel(x-1,y-10,3,15,'#775538');
      pixel(x-9,y-14,18,9, o.text?'#797b91':'#b18457');
      pixel(x-6,y-11,12,1,'#f1d7a0');
      pixel(x-5,y-8,8,1,'#dbc398');
    }
    if (highlighted) {
      ctx.font='10px sans-serif';
      const w = Math.min(218, ctx.measureText(o.name).width+14);
      const center = Math.max(w/2+4,Math.min(WIDTH-w/2-4,x));
      pixel(center-w/2,y-37,w,13,'#121a26ed');
      ctx.textAlign='center';
      ctx.fillStyle='#ffe1a1';
      ctx.fillText(o.name,center,y-27);
    }
  }

  function monster(e, time) {
    if (!e.hp) return;
    const b = e.boss ? 2 : 1;
    const still = e.status==='freeze' || e.status==='shock';
    const y = e.y - (still ? 0 : Math.round(Math.sin(time*8 + e.x)*2));
    pixel(e.x-8*b,e.y+2,16*b,5,'#111728a0');
    const statusColor = {freeze:'#85d5f0',shock:'#f4d26a',burn:'#ef8763'}[e.status];
    const color = statusColor ?? (e.flash ? '#f8d0ae' : e.boss ? ['#916595','#bc7c69','#a87895'][e.phase] : ({support:'#b381aa',healer:'#86b28e',guard:'#8093a6'}[e.role] ?? '#9b719c'));
    pixel(e.x-8*b,y-8*b,16*b,12*b,'#302743');
    pixel(e.x-6*b,y-11*b,12*b,12*b,color);
    pixel(e.x-9*b,y-6*b,18*b,5*b,color);
    pixel(e.x-6*b,y-10*b,3*b,3*b,statusColor?'#ffeddc':'#c99fc8');
    pixel(e.x-4*b,y-7*b,2*b,3*b,e.windup>0?'#ff694f':'#ffe2a2');
    pixel(e.x+2*b,y-7*b,2*b,3*b,e.windup>0?'#ff694f':'#ffe2a2');
    if (e.role==='guard') pixel(e.x-12,y-8,5,10,'#b6c5d4');
    if (e.role==='healer') { pixel(e.x-2,y-19,3,8,'#d4e9a8'); pixel(e.x-5,y-16,9,2,'#d4e9a8'); }
    if (e.boss || e.hp<e.max) {
      pixel(e.x-9*b,y-15*b,18*b,2,'#222637');
      pixel(e.x-9*b,y-15*b,Math.ceil(18*b*e.hp/e.max),2,'#e78786');
    }
    if (statusColor) {
      const f=Math.floor(time*12)%4;
      pixel(e.x-10*b,y-7*b+f,3,3,statusColor);
      pixel(e.x+9*b,y-12*b+f,3,3,statusColor);
    }
    if (e.windup>0) {
      ctx.beginPath();
      if (e.pattern==='shot' || e.pattern==='rush') {
        ctx.moveTo(e.x,e.y);
        ctx.lineTo(e.aim.x,e.aim.y);
      } else {
        const reach={pulse:132,cross:115,sweep:53,melee:24}[e.pattern] ?? 30;
        ctx.arc(e.x,e.y,reach,0,Math.PI*2);
      }
      ctx.strokeStyle='#f58d65bb';
      ctx.stroke();
    }
  }

  function effects(list) {
    for (const fx of list) {
      if (fx.kind==='damage') {
        ctx.font='bold 11px sans-serif';
        ctx.textAlign='center';
        ctx.fillStyle=fx.color;
        ctx.fillText(fx.label,fx.x,fx.y-21-fx.age*24);
        continue;
      }
      ctx.save();
      ctx.globalAlpha = Math.max(0,1-fx.age/.55);
      const radius = 8 + fx.age * (fx.kind === 'wave' ? 170 : 29);
      for (let i=0;i<12;i++) {
        const angle = fx.kind==='slash'
          ? Math.atan2(fx.direction[1],fx.direction[0]) - 1 + i*.18
          : i*Math.PI/6 + fx.age*2;
        pixel(fx.x+Math.cos(angle)*radius,fx.y+Math.sin(angle)*radius-2,i%2+2,2,fx.color);
      }
      ctx.restore();
    }
  }

  function map(stage,game) {
    chart.save();
    chart.scale(minimap.width/WIDTH,minimap.height/HEIGHT);
    chart.fillStyle='#211c2b';
    chart.fillRect(0,0,WIDTH,HEIGHT);
    for (const [x,y,w,h] of game?.barriers ?? stage.walls) {
      chart.fillStyle='#7e718d';
      chart.fillRect(x,y,w,h);
    }
    if (game) {
      for (const note of game.objects.filter(o=>!o.open && (o.text || o.id==='plan'))) {
        chart.fillStyle=note.id==='plan'?'#edbd89':game.notes.has(note.id)?'#699f90':'#b5a8c8';
        chart.fillRect(note.x-4,note.y-4,8,8);
      }
      chart.fillStyle='#d6fce6';
      chart.fillRect(game.player.x-5,game.player.y-5,10,10);
    }
    chart.restore();
  }

  return (game, stage, time) => {
    if (lastStage !== stage) background(stage);
    ctx.drawImage(ground,0,0);
    map(stage,game);
    if (!game) {
      for (const [x,y,t] of [[111,82,'chest'],[387,98,'chest'],[360,218,'house'],[123,208,'npc']]) {
        object({x,y,kind:t,color:'#caa364'});
      }
      for (let i=0;i<18;i++) {
        const x=(37+i*73)%460, y=(31+i*63)%250+13;
        pixel(x+Math.sin(i+time)*8,y+Math.cos(i+time)*6,2,2,'#f7d07e');
      }
      return;
    }
    if (stage.arena) {
      const {x,y}=stage.arena;
      for (let wy=18;wy<270;wy+=8) {
        if (Math.abs(wy-y)<19 && game.finished) continue;
        const door=Math.abs(wy-y)<19;
        pixel(x,wy,9,8,door?'#67564e':'#303545');
        pixel(x+1,wy,6,2,door?(game.arenaActive?'#f1a763':'#9e8866'):'#62677d');
      }
    }
    const near = game.nearest();
    const sequence = game.question.sequence?.order.slice(0,game.sequence) ?? [];
    const figures = [
      ...game.objects.map(o=>({ y:o.y, draw:()=>object(o,false,sequence.includes(o.id)) })),
      ...game.enemies.map(e=>({ y:e.y,draw:()=>monster(e,game.clock) })),
      {y:game.player.y,draw:()=>{
        const p=game.player;
        if(p.invincible && Math.floor(game.clock*16)%2) return;
        person(p.x,p.y,'#64c5ad','#3b5261',p.direction,p.walking?Math.round(Math.sin(game.clock*18)):0);
        if (p.guard) pixel(p.x+6,p.y-9,4,9,'#a6d6ea');
      }},
    ].sort((a,b)=>a.y-b.y);
    for(const fig of figures) fig.draw();
    for (const shot of game.projectiles) {
      const color=shot.spell?.color ?? '#f0a37a';
      pixel(shot.x-shot.dx*5-1,shot.y-shot.dy*5-1,3,3,color);
      pixel(shot.x-2,shot.y-2,5,5,color);
      pixel(shot.x-1,shot.y-1,2,2,'#fff1ba');
    }
    effects(game.effects);
    if (near) object(near,true,sequence.includes(near.id));
  };
}
