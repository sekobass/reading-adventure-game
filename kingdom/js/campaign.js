export const chapters=['消えた村人','裏切り者のいる村','呪われた森林'];

export function chooseVariant(bank,stageId,progress,repeat=false) {
  const candidates=bank.filter(q=>q.stageId===stageId);
  const gap=Math.min(...candidates.map(q=>Math.abs(q.difficulty-progress.settings.reading)));
  const variants=candidates.filter(q=>Math.abs(q.difficulty-progress.settings.reading)===gap);
  if (!variants.length) return;
  const key=String(stageId);
  const previous=progress.variants[key];
  const bias=stageId>=5 && progress.route==='disclose'?1:0;
  const index=(Number.isInteger(previous)?previous+1:repeat?1:bias)%variants.length;
  progress.variants[key]=index;
  return variants[index];
}

export function discovery(progress,stage,problem) {
  progress.cleared=[...new Set([...progress.cleared,stage.id])];
  progress.archive[stage.id]={title:stage.name,text:stage.outro,problem:problem.id};
}

export function selectRoute(progress,route) {
  if (!progress.cleared.includes(4) || progress.route || !['disclose','protect'].includes(route)) return false;
  progress.route=route;
  if (route==='disclose') progress.gold+=24;
  else progress.inventory.回復薬+=2;
  return true;
}

export const routeClosing = route => route==='disclose'
  ? '記録を公開したことで村人が集まり、水路へ向かう船の資金を用意した。'
  : '証人を守るため、レナは少人数で水路を調べる準備を始めた。';

export const backupFormat = 'seven-seals/1';
export function readBackup(value,maxStage) {
  const p=value?.progress, h=value?.history;
  const nonnegative=n=>Number.isInteger(n)&&n>=0;
  const validStage=n=>Number.isInteger(n)&&n>0&&n<=maxStage;
  if (value?.format!==backupFormat || !p || !Array.isArray(h) ||
      !validStage(p.unlocked) || !Array.isArray(p.cleared) || !p.cleared.every(validStage) ||
      ![p.xp,p.gold,p.weapon,p.armor,p.inventory?.回復薬].every(nonnegative) ||
      !Number.isInteger(p.level) || p.level<1 || ![null,'disclose','protect'].includes(p.route) ||
      !p.archive || !Object.values(p.archive).every(a=>typeof a?.title==='string' && typeof a.text==='string') ||
      !p.variants || !Object.values(p.variants).every(nonnegative) ||
      ![1,2,3,4,5].includes(p.settings?.reading) || !['easy','normal','hard'].includes(p.settings.combat) ||
      !['auto','on','off'].includes(p.settings.touch) || typeof p.settings.sound!=='boolean' ||
      ![18,20,22,24,26].includes(p.settings.text) ||
      h.some(r=>!r || typeof r.problem!=='string' || typeof r.type!=='string' || !validStage(r.stage) ||
        !Array.isArray(r.mistakes) || !r.mistakes.every(m=>typeof m==='string') ||
        !['readingMs','playMs','attempts','reasonsCorrect','evidenceCorrect','retry','defeats','hints','rereads','tacticalErrors'].every(key=>nonnegative(r[key])))) {
    throw new Error('Ver.1.0のバックアップ形式と内容を確認してください。');
  }
  return {progress:p,history:h};
}
