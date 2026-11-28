const prefix = 'seven-seals-v1:';
export const initial = () => ({
  level: 1, xp: 0, gold: 0, weapon: 0, armor: 0, charm:false, inventory: { 回復薬: 3 },
  unlocked: 1, cleared: [], variants: {}, archive: {}, route:null,
  settings: { reading: 3, combat: 'normal', text: 20, touch: 'auto', sound: true },
});

export function storage(notify) {
  return {
    read(key, fallback) {
      try {
        return JSON.parse(localStorage.getItem(prefix + key)) ?? fallback;
      } catch {
        notify();
        return fallback;
      }
    },
    write(key, value) {
      try {
        localStorage.setItem(prefix + key, JSON.stringify(value));
        return true;
      } catch {
        notify();
        return false;
      }
    },
  };
}

export function newRecord(question) {
  return {
    date: new Date().toISOString(), stage: question.stageId, problem: question.id,
    type: question.type, difficulty: question.difficulty, firstSuccess: false,
    mistakes: [], hints: 0, rereads: 0, readingMs: 0, cleared: false, defeats: 0,
    playMs:0, attempts:0, reasonsCorrect:0, evidenceCorrect:0, retry:0,
  };
}

export function historyCsv(records) {
  const headings = ['プレイ日時','ステージ','問題ID','問題分類','読解レベル','初回成功','誤答回数','誤答内容','ヒント使用回数','文章再表示回数','文章表示秒数','クリア','戦闘失敗回数','操作秒','推理の提出回数','根拠正答数','証拠正答数','再挑戦回数'];
  const rows = records.map(r => [
    r.date, r.stage, r.problem, r.type, r.difficulty, +r.firstSuccess,
    r.mistakes.length, r.mistakes.join(' / '), r.hints, r.rereads,
    (r.readingMs / 1000).toFixed(2), +r.cleared, r.defeats,
    ((r.playMs ?? 0)/1000).toFixed(2),r.attempts ?? 0,r.reasonsCorrect ?? 0,r.evidenceCorrect ?? 0,r.retry ?? 0,
  ]);
  return '\uFEFF' + [headings, ...rows].map(row => row.map(value =>
    '"' + String(value).replace(/"/g, '""') + '"').join(',')).join('\r\n');
}
