import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';

const scope = '/reading-adventure-game/';
const root = fileURLToPath(new URL('../', import.meta.url));
const mime = { html:'text/html', js:'text/javascript', css:'text/css', json:'application/json',
  webmanifest:'application/manifest+json', png:'image/png' };
let server, browser, base, legacyWorker = false, disconnectIcon = false;

before(async () => {
  server = createServer(async (request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (path === '/ready') {
      response.writeHead(200,{'Content-Type':'text/html'}).end('<title>Worker lifecycle probe</title>');
      return;
    }
    const file = resolve(root, path.slice(scope.length) || 'index.html');
    if (!path.startsWith(scope) || !file.startsWith(resolve(root)+sep)) {
      response.writeHead(404).end();
      return;
    }
    if (disconnectIcon && path === scope+'assets/icon-512.png') {
      request.socket.destroy();
      return;
    }
    try {
      const content = legacyWorker && path === scope+'sw.js'
        ? `self.addEventListener('install', event => event.waitUntil(caches.open('reading-dungeon-v0.1.0')));
           self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));`
        : await readFile(file);
      response.writeHead(200, {
        'Content-Type': mime[file.split('.').at(-1)] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
      }).end(content);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  base = `http://127.0.0.1:${server.address().port}${scope}`;
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE });
});

after(async () => {
  await browser?.close();
  server?.close();
});

const progress = {
  level: 2, xp: 8, gold: 33, weapon: 1, armor: 1, inventory: { 回復薬: 4 },
  unlocked: 2, cleared: [1], variants: { '1:3': 0 },
  settings: { reading: 3, combat: 'easy', text: 22, touch: 'auto', sound: false },
};
const history = [{
  date: '2026-11-01T03:00:00.000Z', stage: 1, problem: '1-3-1',
  type: '登場人物の発言', difficulty: 3, firstSuccess: true, mistakes: [], hints: 0,
  rereads: 0, readingMs: 1250, cleared: true, defeats: 0,
}];

async function seed(context, storageBlocked = false) {
  await context.addInitScript(({ progress, history, storageBlocked }) => {
    if (!localStorage.getItem('reading-dungeon-v1:progress')) {
      localStorage.setItem('reading-dungeon-v1:progress',JSON.stringify(progress));
      localStorage.setItem('reading-dungeon-v1:history',JSON.stringify(history));
    }
    if (storageBlocked) Storage.prototype.setItem = () => {
      throw new DOMException('Simulated write error','QuotaExceededError');
    };
  }, { progress, history, storageBlocked });
}

// Read the player's sprite from the visible Canvas. All changes of position
// come from actual keyboard or pointer input.
function atPixel({ axis, goal, sense }) {
  const canvas = document.querySelector('#world');
  const { data } = canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height);
  for (let i=0;i<data.length;i+=4) {
    if (data[i]!==100 || data[i+1]!==197 || data[i+2]!==173) continue;
    const x = i/4 % canvas.width + 5;
    const y = Math.floor(i/4/canvas.width) + 9;
    return sense * (axis === 'x' ? x : y) >= sense * goal;
  }
  return false;
}

async function stageTwo(page, tap) {
  await tap(page.locator('#start'));
  await tap(page.getByRole('button',{ name:/STAGE 2/ }));
  await page.getByRole('heading',{name:'川を渡る方法'}).waitFor();
}

for (const touch of [false,true]) {
  test(`燃料取得から川を渡りステージ3へ（${touch?'タッチ・保存不可':'キーボード・既存セーブ'}）`, {timeout:30000}, async () => {
    const context = await browser.newContext({ hasTouch:touch, isMobile:touch, viewport:{width:1024,height:768} });
    try {
      await seed(context,touch);
      const page = await context.newPage();
      page.setDefaultTimeout(5000);
      const errors = [];
      page.on('pageerror',error=>errors.push(error.message));
      await page.goto(base+'?utm_source=chatgpt.com');
      const tap = node => touch ? node.tap() : node.click();
      await stageTwo(page,tap);
      const cdp = touch ? await context.newCDPSession(page) : undefined;
      const inspect = () => touch ? tap(page.getByRole('button',{name:'調べる',exact:true})) : page.keyboard.press('KeyE');

      async function move(key, goal) {
        const dx = key==='ArrowRight' ? 1 : key==='ArrowLeft' ? -1 : 0;
        const dy = key==='ArrowDown' ? 1 : key==='ArrowUp' ? -1 : 0;
        if (cdp) {
          const box = await page.locator('#joystick').boundingBox();
          await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{
            x: box.x + box.width*(.5+.35*dx), y: box.y + box.height*(.5+.35*dy),
          }]});
        } else await page.keyboard.down(key);
        try {
          await page.waitForFunction(atPixel,{axis:dx?'x':'y',goal,sense:dx||dy},{timeout:7000});
        } finally {
          if (cdp) await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
          else await page.keyboard.up(key);
        }
      }

      await move('ArrowRight',91);
      await inspect();
      await page.getByRole('heading',{name:'兵士の依頼'}).waitFor();
      await tap(page.getByRole('button',{name:'閉じる'}));
      await move('ArrowLeft',68);
      await move('ArrowUp',83);
      await inspect();
      await page.getByRole('status').filter({hasText:'を手に入れた'}).waitFor();
      await move('ArrowDown',144);
      await move('ArrowRight',253);
      await inspect();

      await page.getByRole('heading',{name:'ステージクリア'}).waitFor();
      // Dismiss the result using a normal player action and recover it on the map.
      if (touch) await tap(page.getByRole('button',{name:'閉じる'}));
      else await page.keyboard.press('Escape');
      await page.waitForFunction(atPixel,{axis:'x',goal:350,sense:1});
      const result = page.getByRole('button',{name:'クリア結果'});
      assert.ok(await result.isVisible(),'右岸で閉じたクリア結果を再表示できる');
      await tap(result);
      await tap(page.getByRole('button',{name:'次のステージ'}));
      await page.getByRole('heading',{name:'魔物の弱点'}).waitFor();
      await move('ArrowRight',90);
      assert.deepEqual(errors,[]);
      if (!touch) {
        const saved = await page.evaluate(()=>({
          progress:JSON.parse(localStorage.getItem('reading-dungeon-v1:progress')),
          history:JSON.parse(localStorage.getItem('reading-dungeon-v1:history')),
        }));
        assert.deepEqual(saved.progress.cleared,[1,2]);
        assert.equal(saved.progress.unlocked,3);
        assert.equal(saved.progress.inventory.回復薬,5);
        assert.equal(saved.progress.weapon,progress.weapon);
        assert.deepEqual(saved.progress.settings,progress.settings);
        assert.deepEqual(saved.history[0],history[0]);
        assert.equal(saved.history[1].firstSuccess,true);
        assert.equal(saved.history[1].cleared,true);
      }
    } finally { await context.close(); }
  });
}

async function waitUntil(check) {
  const deadline = Date.now()+6000;
  while (Date.now()<deadline) {
    if (await check()) return;
    await delay(50);
  }
  assert.fail('Service Worker did not reach the expected lifecycle state');
}

test('GitHub Pages相当のパスで旧版から更新し、通信切断とクエリ付きオフライン起動に対応', {timeout:30000}, async () => {
  const context = await browser.newContext();
  legacyWorker = true;
  try {
    await seed(context);
    let page = await context.newPage();
    await page.goto(base+'?utm_source=chatgpt.com');
    await page.waitForFunction(()=>navigator.serviceWorker.controller!==null);
    assert.ok(await page.evaluate(()=>caches.has('reading-dungeon-v0.1.0')));
    legacyWorker = false;
    await page.evaluate(async()=> (await navigator.serviceWorker.getRegistration()).update());
    await waitUntil(()=>page.evaluate(async()=>Boolean((await navigator.serviceWorker.getRegistration()).waiting)));
    const probe = await context.newPage();
    await probe.goto(new URL('/ready',base).href);
    await page.close();
    await waitUntil(()=>probe.evaluate(async scope=>{
      const registration = await navigator.serviceWorker.getRegistration(scope);
      return registration?.active?.state === 'activated' && !registration.waiting &&
        !(await caches.has('reading-dungeon-v0.1.0'));
    },base));
    await probe.close();

    page = await context.newPage();
    await page.goto(base+'?utm_source=chatgpt.com');
    await page.waitForFunction(()=>navigator.serviceWorker.controller!==null);
    assert.match(await page.locator('footer').innerText(),/Ver\. 0\.1\.1/);
    const cached = await page.evaluate(async()=>{
      const name = (await caches.keys()).find(name=>name.endsWith('-v0.1.1'));
      const cache = await caches.open(name);
      return cache.delete(new URL('./assets/icon-512.png',location.href).href);
    });
    assert.equal(cached,true);
    await stageTwo(page,node=>node.click());
    disconnectIcon = true;
    const status = await page.evaluate(async()=> (await fetch('./assets/icon-512.png?failed=1')).status);
    assert.equal(status,503);
    await page.keyboard.down('ArrowRight');
    try { await page.waitForFunction(atPixel,{axis:'x',goal:89,sense:1}); }
    finally { await page.keyboard.up('ArrowRight'); }
    await context.setOffline(true);
    await page.reload();
    await page.locator('#start:enabled').waitFor();
    assert.equal(new URL(page.url()).search,'?utm_source=chatgpt.com');
    assert.equal(await page.evaluate(async()=> (await fetch('./data/stages.json?utm_source=test')).status),200);
    await stageTwo(page,node=>node.click());
    await page.keyboard.down('ArrowRight');
    try { await page.waitForFunction(atPixel,{axis:'x',goal:89,sense:1}); }
    finally { await page.keyboard.up('ArrowRight'); }
  } finally {
    legacyWorker = false;
    disconnectIcon = false;
    await context.close();
  }
});
