import { importQuestions, questionsCsv, validateBank, validateQuestion } from './question-data.js';

function node(tag,text,attrs={}) {
  const element=document.createElement(tag);
  if (text!==undefined) element.textContent=text;
  for (const [name,value] of Object.entries(attrs)) element[name]=value;
  return element;
}

function download(content,name,type) {
  const url=URL.createObjectURL(new Blob([content],{type}));
  const link=node('a',undefined,{href:url,download:name});
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

export function questionEditor(container,{bank,published,stages,save,preview,draft}) {
  let selected=draft?.question ?? bank[0];
  let originalId=draft ? draft.originalId : selected.id;
  let incoming;
  const root=node('section',undefined,{className:'question-editor'});
  const status=node('p');
  status.setAttribute('aria-live','polite');
  const controls=node('div',undefined,{className:'actions'});
  const form=node('div',undefined,{className:'editor-form'});
  const operations=node('div',undefined,{className:'actions'});
  const transfer=node('div',undefined,{className:'actions'});
  const picker=node('select');
  function button(region,label,run) {
    const control=node('button',label,{type:'button'});
    control.addEventListener('click',run);
    region.append(control);
    return control;
  }
  function label(region,title,control) {
    const field=node('label',title);
    control.setAttribute('aria-label',title);
    field.append(control);
    region.append(field);
    return control;
  }
  function input(region,title,value,multiline=false) {
    const control=node(multiline?'textarea':'input',undefined,{defaultValue:value,value});
    if (multiline) control.rows=3;
    return label(region,title,control);
  }
  function select(region,title,values,value) {
    const control=node('select');
    for (const [id,name] of values) control.append(node('option',name,{value:id}));
    control.value=value;
    return label(region,title,control);
  }
  function json(region,title,value) {
    return input(region,title,JSON.stringify(value,null,2),true);
  }
  function report(lines) {
    status.textContent=Array.isArray(lines)?lines.join('\n'):lines;
  }
  function selectQuestion(question,id) {
    selected=question;
    originalId=id;
    picker.value=id ?? '';
    render();
  }
  function nextId(template) {
    const ids=new Set(bank.map(q=>q.id));
    let id=template, suffix=1;
    while (ids.has(id)) id=template+'-'+suffix++;
    return id;
  }

  function persist(next,item,message) {
    if (!save(next)) return report('このブラウザに下書きを保存できませんでした。');
    bank=next;
    rebuildPicker();
    selectQuestion(item ?? next[0],item?.id ?? next[0].id);
    report(message);
  }
  function rebuildPicker() {
    picker.replaceChildren(node('option','未保存の問題',{value:''}));
    for (const q of bank) {
      picker.append(node('option','MISSION '+q.stageId+' / Lv.'+q.difficulty+' / '+q.id,{value:q.id}));
    }
  }
  label(controls,'問題を選択',picker);
  picker.addEventListener('change',()=>{
    const match=bank.find(q=>q.id===picker.value);
    if (match) selectQuestion(match,match.id);
  });
  button(controls,'問題を追加',()=>{
    const template=published.find(q=>q.stageId===selected.stageId && q.difficulty===selected.difficulty) ?? published.find(q=>q.stageId===selected.stageId);
    selectQuestion({...structuredClone(template),id:nextId('stage-'+template.stageId+'-new')},undefined);
    report('公開版のひな型をコピーしました。編集してから下書きを保存してください。');
  });
  button(controls,'複製',()=>{
    try {
      const copy=readForm();
      selectQuestion({...copy,id:nextId(copy.id.slice(0,68)+'-copy')},undefined);
      report('編集中の内容を複製しました。別の問題として下書きに保存できます。');
    } catch(error) { report(error.message); }
  });
  let readForm;
  function render() {
    form.replaceChildren();
    operations.replaceChildren();
    status.textContent='';
    const basic=node('div',undefined,{className:'editor-basic'});
    form.append(basic);
    const id=input(basic,'問題ID',selected.id);
    const stage=select(basic,'ステージ',stages.map(s=>[s.id,'第'+s.chapter+'章｜'+s.name]),selected.stageId);
    const level=select(basic,'難易度',[1,2,3,4,5].map(i=>[i,'Lv.'+i]),selected.difficulty);
    const type=input(basic,'問題分類',selected.type);
    const mission=input(form,'目標',selected.mission);
    const notes=new Map();
    for (const o of selected.objects.filter(o=>o.text)) notes.set(o.id,input(form,'問題文｜'+o.name,o.text,true));
    function choiceFields(region,title,items=[]) {
      const choices=Array.from({length:5},(_,i)=>input(region,title+' '+(i+1)+(i===4?'（任意）':''),items[i]?.text ?? '',true));
      const key=select(region,title+'の正解',choices.map((_,i)=>[i,String(i+1)]),Math.max(0,items.findIndex(o=>o.correct)));
      return ()=>choices.map((o,i)=>({text:o.value.trim(),...(i===Number(key.value)?{correct:true}:{})}))
        .filter((o,i)=>i<4 || o.text);
    }
    const choices=choiceFields(form,'選択肢',selected.plan.options);
    const reasonFields=node('fieldset');
    form.append(reasonFields);
    const reasons=choiceFields(reasonFields,'根拠',selected.plan.reasons);

    const hints=input(form,'ヒント（1行に1つ）',selected.hints.join('\n'),true);
    const explanation=input(form,'解説',selected.explanation,true);
    const order=input(form,'攻略順序（台座IDをコンマ区切り）',selected.sequence?.order.join(', ') ?? '');
    order.disabled=!selected.sequence;
    const phaseFields=new Map();
    const enemies=[...selected.enemies,...selected.rules.flatMap(r=>[r.then.spawn].flat().filter(Boolean))];
    for (const enemy of enemies.filter(e=>e.boss)) {
      const fields=enemy.phases.map((p,i)=>select(form,(enemy.name ?? enemy.id)+'の弱点｜第'+(i+1)+'段階',
        [['fire','炎'],['ice','氷'],['thunder','雷']],p.element));
      phaseFields.set(enemy.id,fields);
    }
    const advanced=node('details');
    advanced.append(node('summary','配置・正解条件・敵の詳細（JSON）'));
    form.append(advanced);
    const objects=json(advanced,'配置物・文章（JSON）',selected.objects);
    const plan=json(advanced,'計画の場所・資料と正解証拠（JSON）',{target:selected.plan.target,sources:selected.plan.sources,evidence:selected.plan.evidence});
    const rules=json(advanced,'実行条件と成果（JSON）',selected.rules);
    const enemyData=json(advanced,'敵（JSON）',selected.enemies);
    const sequence=json(advanced,'台座の条件（JSON）',selected.sequence ?? null);
    const finish=json(advanced,'追加のクリア条件（JSON）',selected.completeWhen ?? null);

    function field(control) {
      try { return JSON.parse(control.value); }
      catch { throw new Error(control.parentElement.firstChild.textContent+'のJSONを確認してください。'); }
    }
    readForm=()=>{
      const placements=field(objects);
      const legal=field(rules);
      const actors=field(enemyData);
      const steps=field(sequence);
      const end=field(finish);
      const planData=field(plan);
      if (![placements,legal,actors].every(Array.isArray) || !planData || typeof planData!=='object') {
        throw new Error('配置物、実行条件、敵は配列で、計画はオブジェクトで指定してください。');
      }
      for (const o of placements) {
        if (notes.has(o?.id) && notes.get(o.id).value!==notes.get(o.id).defaultValue) o.text=notes.get(o.id).value.trim();
      }
      const allEnemies=[...actors,...legal.flatMap(r=>[r?.then?.spawn].flat().filter(Boolean))];
      for (const actor of allEnemies) {
        actor?.phases?.forEach?.((p,i)=>{
          const control=phaseFields.get(actor.id)?.[i];
          if (p && control && control.value!==selectedEnemyElement(actor.id,i)) p.element=control.value;
        });
      }
      if (steps && !order.disabled && order.value!==order.defaultValue) steps.order=order.value.split(',').map(s=>s.trim()).filter(Boolean);
      return {
        id:id.value.trim(),stageId:Number(stage.value),difficulty:Number(level.value),
        type:type.value.trim(),mission:mission.value.trim(),explanation:explanation.value.trim(),
        objects:placements,rules:legal,enemies:actors,hints:hints.value.split('\n').map(s=>s.trim()).filter(Boolean),
        plan:{...planData,options:choices(),reasons:reasons()},
        ...(steps===null?{}:{sequence:steps}),...(end===null?{}:{completeWhen:end}),
      };
    };
    function selectedEnemyElement(id,index) { return enemies.find(e=>e.id===id)?.phases?.[index]?.element; }
    function checked(run) {
      try {
        const question=readForm();
        const errors=validateQuestion(question,stages);
        if (errors.length) report(errors);
        else run(question);
      } catch(error) { report(error.message); }
    }
    button(operations,'入力をチェック',()=>checked(()=>report('この条件で実行できる手順が見つかりました。文章の意味と戦闘はテストプレイでも確認してください。')));
    button(operations,'下書きを保存',()=>checked(question=>{
      const next=[...bank.filter(q=>q.id!==originalId),question];
      const errors=validateBank(next,stages,()=>[]);
      if (errors.length) return report(errors);
      persist(next,question,'このブラウザに下書きを保存しました。');
    }));
    button(operations,'テストプレイ',()=>checked(question=>preview(question,originalId)));
    if (originalId) button(operations,'削除',()=>{
      const next=bank.filter(q=>q.id!==originalId);
      const errors=validateBank(next,stages,()=>[]);
      if (errors.length) return report(errors);
      operations.replaceChildren();
      report(originalId+' を下書きから削除します。過去の学習履歴には残ります。');
      button(operations,'削除を確定',()=>persist(next,undefined,'下書きから削除しました。'));
      button(operations,'キャンセル',render);
    });
  }
  const file=node('input',undefined,{type:'file',accept:'.json,.csv,application/json,text/csv'});
  label(transfer,'JSON・CSVを読み込む',file);
  const replace=button(transfer,'下書きを読み込み内容で置換',()=>{
    const next=incoming;
    incoming=undefined;
    replace.disabled=true;
    if (next) persist(next,undefined,'読み込んだ問題を下書きに保存しました。');
  });
  replace.disabled=true;
  file.addEventListener('change',async()=>{
    incoming=undefined;
    replace.disabled=true;
    const selectedFile=file.files[0];
    if (!selectedFile) return;
    try {
      if (selectedFile.size>5*1024*1024) throw new Error('読み込みは5 MBまでです。');
      const next=importQuestions(await selectedFile.text(),/\.csv$/i.test(selectedFile.name));
      const errors=validateBank(next,stages);
      if (errors.length) return report(errors);
      incoming=next;
      replace.disabled=false;
      report(next.length+'問を確認しました。置換ボタンを押すと現在の下書きと入れ替わります。');
    } catch(error) { report(error.message); }
    finally { file.value=''; }
  });
  button(transfer,'JSONを書き出す',()=>download(JSON.stringify(bank,null,2)+'\n','questions.json','application/json'));
  button(transfer,'Excel用CSVを書き出す',()=>download(questionsCsv(bank),'questions.csv','text/csv;charset=utf-8'));
  root.append(node('p','下書きはこのブラウザに保存されます。全端末に配布するには、JSONを書き出して公開用の kingdom/data/questions.json を更新してください。'),
    controls,form,operations,status,transfer);
  container.append(root);
  rebuildPicker();
  selectQuestion(selected,originalId);
}
