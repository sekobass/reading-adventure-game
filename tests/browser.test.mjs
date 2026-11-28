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
let server, browser, base, kingdomUpdate, legacyWorker = false, disconnectIcon = false;

before(async () => {
  server = createServer(async (request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (path === '/ready') {
      response.writeHead(200,{'Content-Type':'text/html'}).end('<title>Worker lifecycle probe</title>');
      return;
    }
    const relative=path.slice(scope.length);
    const file=resolve(root,relative.endsWith('/') || !relative ? relative+'index.html' : relative);
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
        ? `self.addEventListener('install', event => event.waitUntil(caches.open('reading-dungeon-'+self.registration.scope+'-v0.1.1')));
           self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));`
        : kingdomUpdate && relative==='kingdom/data/questions.json' && request.url.includes('refresh=1')
          ? kingdomUpdate : await readFile(file);
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

async function seed(context, storageBlocked = false, inheritedProgress = progress) {
  await context.addInitScript(({ progress, history, storageBlocked }) => {
    if (!localStorage.getItem('reading-dungeon-v1:progress')) {
      localStorage.setItem('reading-dungeon-v1:progress',JSON.stringify(progress));
      localStorage.setItem('reading-dungeon-v1:history',JSON.stringify(history));
    }
    if (storageBlocked) Storage.prototype.setItem = () => {
      throw new DOMException('Simulated write error','QuotaExceededError');
    };
  }, { progress:inheritedProgress, history, storageBlocked });
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
          const joystick=page.locator('#joystick');
          await joystick.scrollIntoViewIfNeeded();
          const box = await joystick.boundingBox();
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
      await move('ArrowRight',137);
      await inspect();
      await page.getByRole('heading',{name:'荷運びの記録'}).waitFor();
      await tap(page.getByRole('button',{name:'閉じる'}));
      await move('ArrowRight',186);
      // The legacy pointerdown can send its subsequent click to a plan choice.
      await page.keyboard.press('KeyE');
      await page.getByRole('heading',{name:'攻略計画'}).waitFor();
      assert.equal(await page.locator('.plan-choices button').count(),4);
      await tap(page.getByRole('button',{name:/西で燃料を受け取ってから/}));
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
      if (touch) {
        await tap(page.locator('[data-action=guard]'));
        await tap(page.locator('[data-action=dodge]'));
      } else {
        await page.keyboard.press('KeyF');
        await page.keyboard.press('ShiftLeft');
      }
      await page.waitForFunction(atPixel,{axis:'x',goal:110,sense:1});
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
    assert.ok(await page.evaluate(()=>caches.has('reading-dungeon-'+location.origin+location.pathname+'-v0.1.1')));
    legacyWorker = false;
    await page.evaluate(async()=> (await navigator.serviceWorker.getRegistration()).update());
    await waitUntil(()=>page.evaluate(async()=>Boolean((await navigator.serviceWorker.getRegistration()).waiting)));
    const probe = await context.newPage();
    await probe.goto(new URL('/ready',base).href);
    await page.close();
    await waitUntil(()=>probe.evaluate(async scope=>{
      const registration = await navigator.serviceWorker.getRegistration(scope);
      return registration?.active?.state === 'activated' && !registration.waiting &&
        !(await caches.has('reading-dungeon-'+scope+'-v0.1.1'));
    },base));
    await probe.close();

    page = await context.newPage();
    await page.goto(base+'?utm_source=chatgpt.com');
    await page.waitForFunction(()=>navigator.serviceWorker.controller!==null);
    assert.match(await page.locator('footer').innerText(),/Ver\. 0\.2\.0/);
    const cached = await page.evaluate(async()=>{
      const name = (await caches.keys()).find(name=>name.endsWith('-v0.2.0'));
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

test('スマートフォン幅で文章を表示し、学習履歴だけをリセットできる', {timeout:15000}, async()=>{
  const context=await browser.newContext({hasTouch:true,isMobile:true,viewport:{width:390,height:720}});
  try {
    await seed(context);
    const page=await context.newPage();
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base);
    await stageTwo(page,node=>node.tap());
    const joystick=page.locator('#joystick');
    await joystick.scrollIntoViewIfNeeded();
    const box=await joystick.boundingBox();
    const cdp=await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{
      x:box.x+box.width*.85,y:box.y+box.height*.5,
    }]});
    try { await page.waitForFunction(atPixel,{axis:'x',goal:91,sense:1}); }
    finally { await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); }
    await page.getByRole('button',{name:'調べる',exact:true}).tap();
    await page.getByRole('heading',{name:'兵士の依頼'}).waitFor();
    const reading=await page.locator('.reading').evaluate(node=>({
      width:node.getBoundingClientRect().width, text:parseFloat(getComputedStyle(node).fontSize),
    }));
    assert.ok(reading.width<390 && reading.text>=18);
    await page.getByRole('button',{name:'閉じる'}).tap();
    await page.getByRole('button',{name:'学習履歴',exact:true}).tap();
    await page.getByRole('button',{name:'学習履歴を削除'}).tap();
    await page.getByRole('button',{name:'削除を実行'}).tap();
    const persisted=await page.evaluate(()=>({
      progress:JSON.parse(localStorage.getItem('reading-dungeon-v1:progress')),
      history:JSON.parse(localStorage.getItem('reading-dungeon-v1:history')),
    }));
    assert.equal(persisted.progress.unlocked,2);
    assert.equal(persisted.progress.weapon,progress.weapon);
    assert.deepEqual(persisted.history,[]);
    assert.deepEqual(errors,[]);
  } finally { await context.close(); }
});

test('問題管理の追加・入力チェック・編集・複製・削除・書き出し・再読込・テストプレイ', {timeout:30000}, async()=>{
  const context=await browser.newContext({acceptDownloads:true});
  try {
    await seed(context);
    const page=await context.newPage();
    page.setDefaultTimeout(5000);
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base);
    await page.locator('#start:enabled').waitFor();
    await page.getByRole('button',{name:'問題管理'}).click();
    await page.getByRole('button',{name:'問題を追加'}).click();
    await page.getByLabel('目標',{exact:true}).fill('');
    await page.getByRole('button',{name:'入力をチェック'}).click();
    await page.getByText(/問題ID、ステージ、難易度/).waitFor();
    await page.getByLabel('目標',{exact:true}).fill('テスト専用の目標');
    await page.getByRole('button',{name:'下書きを保存'}).click();
    await page.getByText('このブラウザに下書きを保存しました。').waitFor();
    await page.getByLabel('解説',{exact:true}).fill('編集済みの解説');
    await page.getByRole('button',{name:'下書きを保存'}).click();
    assert.equal(await page.getByLabel('解説',{exact:true}).inputValue(),'編集済みの解説');
    const saved=await page.getByLabel('問題ID',{exact:true}).inputValue();
    await page.getByRole('button',{name:'複製',exact:true}).click();
    assert.notEqual(await page.getByLabel('問題ID',{exact:true}).inputValue(),saved);
    await page.getByRole('button',{name:'下書きを保存'}).click();
    await page.getByRole('button',{name:'削除',exact:true}).click();
    await page.getByRole('button',{name:'削除を確定'}).click();
    await page.getByLabel('問題を選択').selectOption(saved);
    await page.getByLabel('目標',{exact:true}).fill('未保存のテスト目標');
    await page.getByRole('button',{name:'テストプレイ',exact:true}).click();
    await page.getByRole('button',{name:'テストプレイ終了'}).waitFor();
    assert.equal(await page.locator('#mission').innerText(),'未保存のテスト目標');
    await page.getByRole('button',{name:'テストプレイ終了'}).click();
    assert.equal(await page.getByLabel('目標',{exact:true}).inputValue(),'未保存のテスト目標');

    for (const [label,name,mimeType] of [
      ['JSONを書き出す','questions.json','application/json'],
      ['Excel用CSVを書き出す','questions.csv','text/csv'],
    ]) {
      const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:label}).click()]);
      const content=await readFile(await download.path());
      await page.getByLabel('JSON・CSVを読み込む').setInputFiles({name,mimeType,buffer:content});
      await page.getByRole('button',{name:'下書きを読み込み内容で置換'}).click();
      await page.getByText('読み込んだ問題を下書きに保存しました。').waitFor();
    }
    const stored=await page.evaluate(()=>{
      const get=key=>JSON.parse(localStorage.getItem('reading-dungeon-v1:'+key));
      return {bank:get('question-drafts-v2'),progress:get('progress'),history:get('history')};
    });
    assert.equal(stored.bank.length,51);
    assert.equal(stored.bank.find(q=>q.id===saved).explanation,'編集済みの解説');
    assert.deepEqual(stored.progress,progress);
    assert.deepEqual(stored.history,history);
    assert.deepEqual(errors,[]);
  } finally {await context.close();}
});

test('洞窟の記録からボスの広間に入り、戦闘中も文章を読み直せる', {timeout:20000}, async()=>{
  const context=await browser.newContext({viewport:{width:1200,height:850}});
  try {
    await seed(context,false,{...progress,unlocked:3,cleared:[1,2]});
    const page=await context.newPage();
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base);
    await page.locator('#start:enabled').click();
    await page.getByRole('button',{name:/STAGE 3/}).click();
    async function move(key,axis,goal,sense=1) {
      await page.keyboard.down(key);
      try {await page.waitForFunction(atPixel,{axis,goal,sense},{timeout:5000});}
      finally {await page.keyboard.up(key);}
    }
    for (const [x,title] of [[96,'冒険者の日記'],[137,'岩の広間の観察']]) {
      await move('ArrowRight','x',x);
      await page.keyboard.press('KeyE');
      await page.getByRole('heading',{name:title}).waitFor();
      await page.keyboard.press('Escape');
    }
    await move('ArrowRight','x',215);
    await page.keyboard.press('KeyE');
    await page.getByRole('button',{name:/^最初は氷と剣。変化後は衝撃をしのぎ/}).click();
    await move('ArrowUp','y',146,-1);
    await move('ArrowRight','x',289);
    await page.keyboard.press('KeyE');
    await page.waitForFunction(atPixel,{axis:'x',goal:330,sense:1});
    await page.keyboard.down('ArrowLeft');
    await delay(550);
    await page.keyboard.up('ArrowLeft');
    assert.equal(await page.evaluate(atPixel,{axis:'x',goal:321,sense:-1}),false);
    await page.keyboard.press('KeyR');
    await page.getByRole('button',{name:'岩の広間の観察'}).click();
    assert.match(await page.locator('.reading').innerText(),/回避/);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Digit4');
    await page.locator('[data-slot="3"][aria-pressed="true"]').waitFor();
    assert.deepEqual(errors,[]);
  } finally {await context.close();}
});

test('七つの封印で証言を集めて判断し、旧版を保持したままセーブを復元する', {timeout:35000}, async()=>{
  const context=await browser.newContext({acceptDownloads:true,viewport:{width:1280,height:900}});
  try {
    await seed(context);
    const page=await context.newPage();
    page.setDefaultTimeout(6000);
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    const kingdom=new URL('./kingdom/',base).href;
    await page.goto(kingdom);
    await page.locator('#start:enabled').click();
    async function move(key,axis,goal,sense=1) {
      await page.keyboard.down(key);
      try {await page.waitForFunction(atPixel,{axis,goal,sense},{timeout:6000});}
      finally {await page.keyboard.up(key);}
    }
    const investigate=()=>page.keyboard.press('KeyE');
    for (const [x,heading] of [[96,'水車番の証言'],[166,'水車番の手帳'],[227,'北門周辺の控え']]) {
      await move('ArrowRight','x',x);
      await investigate();
      await page.getByRole('heading',{name:heading}).waitFor();
      await page.keyboard.press('Escape');
    }
    await move('ArrowRight','x',268);
    await investigate();
    await page.getByRole('button',{name:'下流の石段',exact:true}).click();
    await page.getByRole('button',{name:/出発時点で通れたのは石段/}).click();
    await page.getByRole('checkbox',{name:'水車番の証言'}).check();
    await page.getByRole('checkbox',{name:'水車番の手帳'}).check();
    await page.getByRole('button',{name:'判断を提出'}).click();
    await move('ArrowLeft','x',64,-1);
    await move('ArrowUp','y',75,-1);
    await investigate();
    await page.getByRole('heading',{name:'ミッションクリア'}).waitFor();
    await page.getByRole('button',{name:'次のミッション'}).click();
    await page.getByRole('heading',{name:'鐘番の隠れ部屋'}).waitFor();
    await page.getByRole('button',{name:'設定',exact:true}).click();
    await page.getByRole('button',{name:'セーブのバックアップ・復元'}).click();
    const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'バックアップを書き出す'}).click()]);
    const content=await readFile(await download.path());
    const backup=JSON.parse(content);
    assert.deepEqual(backup.progress.cleared,[1]);
    assert.equal(backup.history[0].reasonsCorrect,1);
    await page.getByLabel('復元するバックアップ').setInputFiles({name:'seven-seals-save.json',mimeType:'application/json',buffer:content});
    await page.getByRole('button',{name:'内容を確認'}).click();
    await page.getByRole('button',{name:'復元する'}).click();
    assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('reading-dungeon-v1:progress'))),progress);
    assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('reading-dungeon-v1:history'))),history);
    assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('seven-seals-v1:snapshot')).progress.cleared),[1]);
    await page.waitForFunction(()=>navigator.serviceWorker.controller?.scriptURL.includes('/kingdom/sw.js'));
    await context.setOffline(true);
    await page.goto(kingdom+'?offline=1');
    await page.locator('#start:enabled').waitFor();
    await context.setOffline(false);
    await page.getByRole('link',{name:'Ver.0.2へ戻る'}).click();
    await page.locator('#start:enabled').waitFor();
    assert.match(await page.title(),/謎解きダンジョン/);
    assert.deepEqual(errors,[]);
  } finally {await context.close();}
});

test('七つの封印をスマートフォン幅でタッチ操作できる', {timeout:15000}, async()=>{
  const context=await browser.newContext({hasTouch:true,isMobile:true,viewport:{width:390,height:760}});
  try {
    const page=await context.newPage();
    await page.goto(new URL('./kingdom/',base).href);
    await page.locator('#start:enabled').tap();
    const cdp=await context.newCDPSession(page);
    async function rightTo(goal) {
      const joystick=page.locator('#joystick');
      await joystick.scrollIntoViewIfNeeded();
      const box=await joystick.boundingBox();
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width*.86,y:box.y+box.height*.5}]});
      try {await page.waitForFunction(atPixel,{axis:'x',goal,sense:1});}
      finally {await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
      await page.getByRole('button',{name:'調べる',exact:true}).tap();
    }
    for (const [goal,title] of [[96,'水車番の証言'],[166,'水車番の手帳'],[227,'北門周辺の控え']]) {
      await rightTo(goal);
      await page.getByRole('heading',{name:title}).waitFor();
      assert.ok(await page.locator('.reading').evaluate(e=>e.getBoundingClientRect().width<390 && parseFloat(getComputedStyle(e).fontSize)>=18));
      await page.getByRole('button',{name:'閉じる'}).tap();
    }
    await rightTo(268);
    await page.getByRole('heading',{name:'攻略計画'}).waitFor();
    await page.getByRole('button',{name:'下流の石段',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'計画の選択に戻る'}).count(),0);
  } finally {await context.close();}
});

test('七つの封印の問題データだけを更新し、オフラインでも検証済みの新版を使う', {timeout:15000}, async()=>{
  const context=await browser.newContext();
  try {
    const page=await context.newPage();
    const url=new URL('./kingdom/',base).href;
    await page.goto(url);
    await page.waitForFunction(()=>navigator.serviceWorker.controller?.scriptURL.includes('/kingdom/sw.js'));
    await page.locator('#start:enabled').waitFor();
    const bank=JSON.parse(await readFile(resolve(root,'kingdom/data/questions.json'),'utf8'));
    bank[0].mission='配信データだけを更新したミッション';
    kingdomUpdate=JSON.stringify(bank);
    const bad=structuredClone(bank);
    bad[0].plan.evidence=['存在しない証拠'];
    for (const mode of ['更新','無効な配信','オフライン']) {
      if (mode==='無効な配信') kingdomUpdate=JSON.stringify(bad);
      await context.setOffline(mode==='オフライン');
      await page.reload();
      await page.locator('#start:enabled').waitFor();
      await page.getByRole('button',{name:'問題管理'}).click();
      assert.equal(await page.getByLabel('目標',{exact:true}).inputValue(),bank[0].mission);
      await page.getByRole('button',{name:'閉じる'}).click();
    }
  } finally {kingdomUpdate=undefined;await context.close();}
});

test('新版の問題管理で証拠を含む下書きの保存とテストプレイができる', {timeout:15000}, async()=>{
  const context=await browser.newContext({acceptDownloads:true});
  try {
    const page=await context.newPage();
    await page.goto(new URL('./kingdom/',base).href);
    await page.locator('#start:enabled').waitFor();
    await page.getByRole('button',{name:'問題管理'}).click();
    await page.getByRole('button',{name:'問題を追加'}).click();
    await page.getByLabel('目標',{exact:true}).fill('検証用の調査');
    await page.getByRole('button',{name:'下書きを保存'}).click();
    await page.getByText('このブラウザに下書きを保存しました。').waitFor();
    await page.getByRole('button',{name:'テストプレイ',exact:true}).click();
    assert.equal(await page.locator('#mission').innerText(),'検証用の調査');
    await page.getByRole('button',{name:'テストプレイ終了'}).click();
    const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'JSONを書き出す'}).click()]);
    const file=JSON.parse(await readFile(await download.path(),'utf8'));
    assert.equal(file.length,13);
    assert.ok(file.find(q=>q.mission==='検証用の調査').plan.evidence.length>=2);
    assert.equal(await page.evaluate(()=>localStorage.getItem('seven-seals-v1:snapshot')),null);
  } finally {await context.close();}
});
