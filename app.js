let skillFilter='';
function filterSkills(val){skillFilter=val.toLowerCase().trim();renderSkillSections();}

// ══ EDIT MODE ══
let editMode = false;
let calcPts = {combine:0,duration:0,magnitude:0,range:0,targets:0};
let calcMaxPts = 0;
function toggleEdit(){
  editMode=!editMode;
  const b=document.getElementById('edit-btn');
  b.classList.toggle('on',editMode);
  b.textContent=editMode?'✅ Terminer':'✏️ Éditer';
  renderHeader();
  renderTab(currentTab);
}
function eb(){return editMode?'<div class="edit-banner">✏️ Mode édition actif — modifiez les valeurs directement</div>':'';}

// ══ HELPERS ══
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
// Pour usage dans onclick="fn('${safeN(x)}')" — doit échapper JS string + HTML attribut
function safeN(s){
  return String(s==null?'':s)
    .replace(/\\/g,'\\\\')
    .replace(/'/g,"\\'")
    .replace(/"/g,'&quot;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;');
}

// ══ INDEXEDDB POUR DESSINS ══
const Drawings = (()=>{
  const DB_NAME='mythras_db', STORE='drawings', VERSION=1;
  let _db=null;
  const _cache=new Map(); // key: charId+'|'+pageId → dataURL
  const k=(c,p)=>c+'|'+p;
  function open(){
    if(_db) return Promise.resolve(_db);
    return new Promise((resolve,reject)=>{
      const req=indexedDB.open(DB_NAME,VERSION);
      req.onupgradeneeded=()=>{
        const db=req.result;
        if(!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess=()=>{_db=req.result;resolve(_db);};
      req.onerror=()=>reject(req.error);
    });
  }
  async function set(charId,pageId,dataURL){
    _cache.set(k(charId,pageId),dataURL);
    const db=await open();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite');
      tx.objectStore(STORE).put(dataURL,k(charId,pageId));
      tx.oncomplete=()=>resolve();
      tx.onerror=()=>reject(tx.error);
    });
  }
  async function get(charId,pageId){
    const ck=k(charId,pageId);
    if(_cache.has(ck)) return _cache.get(ck);
    const db=await open();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readonly');
      const r=tx.objectStore(STORE).get(ck);
      r.onsuccess=()=>{const v=r.result||null;if(v)_cache.set(ck,v);resolve(v);};
      r.onerror=()=>reject(r.error);
    });
  }
  function getCached(charId,pageId){return _cache.get(k(charId,pageId))||null;}
  async function del(charId,pageId){
    _cache.delete(k(charId,pageId));
    const db=await open();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite');
      tx.objectStore(STORE).delete(k(charId,pageId));
      tx.oncomplete=()=>resolve();
      tx.onerror=()=>reject(tx.error);
    });
  }
  async function loadCharCache(charId,pageIds){
    // Pré-charge en cache tous les dessins d'un perso pour rendu synchrone
    const db=await open();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readonly');
      const store=tx.objectStore(STORE);
      let pending=pageIds.length;
      if(!pending) return resolve();
      pageIds.forEach(pid=>{
        const ck=k(charId,pid);
        const r=store.get(ck);
        r.onsuccess=()=>{if(r.result)_cache.set(ck,r.result); if(--pending===0)resolve();};
        r.onerror=()=>{if(--pending===0)resolve();};
      });
      tx.onerror=()=>reject(tx.error);
    });
  }
  async function delChar(charId){
    // Supprime tous les dessins d'un perso (sur del char)
    [..._cache.keys()].filter(ck=>ck.startsWith(charId+'|')).forEach(ck=>_cache.delete(ck));
    const db=await open();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite');
      const store=tx.objectStore(STORE);
      const r=store.openCursor();
      r.onsuccess=e=>{
        const cur=e.target.result;
        if(!cur)return resolve();
        if(typeof cur.key==='string'&&cur.key.startsWith(charId+'|')) cur.delete();
        cur.continue();
      };
      r.onerror=()=>reject(r.error);
    });
  }
  return {open,set,get,getCached,del,loadCharCache,delChar};
})();

// ══ SANITIZE IMPORT JSON ══
// Whitelist + coercion : empêche d'injecter des champs/types arbitraires depuis un JSON utilisateur
function sanitizeImported(data){
  if(!data||typeof data!=='object'||Array.isArray(data)) throw new Error('Format invalide');
  const str=v=>typeof v==='string'?v:String(v??'');
  const num=v=>{const n=Number(v);return Number.isFinite(n)?n:0;};
  const arr=v=>Array.isArray(v)?v:[];
  const obj=v=>(v&&typeof v==='object'&&!Array.isArray(v))?v:{};
  const cleanSkill=s=>({name:str(s.name).slice(0,80),formula:str(s.formula).slice(0,40),...(s.trained!==undefined?{trained:!!s.trained}:{})});
  const cleanSpell=s=>({name:str(s.name).slice(0,80),cost:str(s.cost).slice(0,40),desc:str(s.desc).slice(0,2000),notes:str(s.notes).slice(0,1000)});
  const out={
    charName:str(data.charName).slice(0,80),
    charSubtitle:str(data.charSubtitle).slice(0,200),
    stats:{},
    derivedAttrs:arr(data.derivedAttrs).slice(0,30).map(a=>({name:str(obj(a).name).slice(0,40),value:str(obj(a).value).slice(0,40)})),
    identity:arr(data.identity).slice(0,30).map(r=>({key:str(obj(r).key).slice(0,40),val:str(obj(r).val).slice(0,200)})),
    money:{po:num(obj(data.money).po),pa:num(obj(data.money).pa),rc:num(obj(data.money).rc)},
    abilities:arr(data.abilities).slice(0,60).map(a=>str(a).slice(0,80)),
    abilitiesDesc:str(data.abilitiesDesc).slice(0,5000),
    passions:arr(data.passions).slice(0,30).map(p=>({name:str(obj(p).name).slice(0,80),pct:num(obj(p).pct)})),
    stdSkills:arr(data.stdSkills).slice(0,80).map(cleanSkill),
    profSkills:arr(data.profSkills).slice(0,80).map(cleanSkill),
    magicSkills:arr(data.magicSkills).slice(0,40).map(cleanSkill),
    combatStyles:arr(data.combatStyles).slice(0,20).map(cs=>({
      name:str(obj(cs).name).slice(0,80),
      formula:str(obj(cs).formula).slice(0,40),
      trait:str(obj(cs).trait).slice(0,40),
      weapons:str(obj(cs).weapons).slice(0,200),
    })),
    folkSpells:arr(data.folkSpells).slice(0,80).map(cleanSpell),
    sorcSpells:arr(data.sorcSpells).slice(0,80).map(cleanSpell),
    sorcSchoolQuote:str(data.sorcSchoolQuote).slice(0,500),
    weapons:arr(data.weapons).slice(0,30).map(w=>({
      name:str(obj(w).name).slice(0,80),dmg:str(obj(w).dmg).slice(0,40),
      size:str(obj(w).size).slice(0,10),range:str(obj(w).range).slice(0,10),
      apHP:str(obj(w).apHP).slice(0,20),effects:str(obj(w).effects).slice(0,200),
    })),
    equipment:arr(data.equipment).slice(0,200).map(e=>({
      name:str(obj(e).name).slice(0,120),
      qty:Math.max(0,Math.floor(num(obj(e).qty??1))),
      enc:str(obj(e).enc??'0').slice(0,10),
    })),
    enc:{
      current:str(obj(data.enc).current??'0').slice(0,10),
      encumbered:str(obj(data.enc).encumbered??'0').slice(0,10),
      overloaded:str(obj(data.enc).overloaded??'0').slice(0,10),
    },
    lp:{current:num(obj(data.lp).current),max:Math.max(1,Math.floor(num(obj(data.lp).max??3)))},
    mp:{current:num(obj(data.mp).current),modMax:Math.floor(num(obj(data.mp).modMax))},
    statMods:{},expMod:Math.floor(num(data.expMod)),
    fatigue:str(data.fatigue).slice(0,30)||'Fresh',
    hitLocations:arr(data.hitLocations).slice(0,20).map(l=>({
      name:str(obj(l).name).slice(0,40),range:str(obj(l).range).slice(0,10),
      maxHP:Math.max(1,Math.floor(num(obj(l).maxHP??5))),
      currentHP:Math.floor(num(obj(l).currentHP??5)),
      armor:Math.max(0,Math.floor(num(obj(l).armor))),
    })),
    skillMods:{},skillSuccesses:{},
    bgNotes:str(data.bgNotes).slice(0,20000),
    pages:arr(data.pages).slice(0,200).map(p=>({
      id:str(obj(p).id).slice(0,60)||'p_'+Date.now()+'_'+Math.random().toString(36).slice(2,5),
      title:str(obj(p).title).slice(0,120),
      content:str(obj(p).content).slice(0,50000),
      drawing:typeof obj(p).drawing==='string'&&obj(p).drawing.startsWith('data:image/')?obj(p).drawing.slice(0,2000000):null,
      date:str(obj(p).date).slice(0,40),
      archived:!!obj(p).archived,
    })),
  };
  // stats : seulement clés connues
  const STATS=['STR','CON','SIZ','DEX','INT','POW','CHA'];
  const inStats=obj(data.stats);
  STATS.forEach(k=>{out.stats[k]=Math.max(0,Math.floor(num(inStats[k]??10)));});
  // statMods : seulement clés connues
  const inSM=obj(data.statMods);
  STATS.forEach(k=>{const v=Math.floor(num(inSM[k]));if(v)out.statMods[k]=v;});
  // skillMods : keys = strings, values = numbers
  const inSk=obj(data.skillMods);
  Object.keys(inSk).slice(0,500).forEach(k=>{
    const v=Math.floor(num(inSk[k]));
    if(v) out.skillMods[String(k).slice(0,80)]=v;
  });
  // skillSuccesses : keys = strings, values = {s,f}
  const inSs=obj(data.skillSuccesses);
  Object.keys(inSs).slice(0,500).forEach(k=>{
    const v=inSs[k];
    if(typeof v==='object'&&v)
      out.skillSuccesses[String(k).slice(0,80)]={s:!!v.s,f:!!v.f};
    else if(typeof v==='number')
      out.skillSuccesses[String(k).slice(0,80)]={s:v>0,f:false};
  });
  return out;
}

// ══ DEFAULT STATE (personnage vierge) ══
const D = {
  charName:'Nouveau Personnage',
  charSubtitle:'Race · Âge · Carrière',
  stats:{STR:10,CON:10,SIZ:10,DEX:10,INT:10,POW:10,CHA:10},
  derivedAttrs:[
    {name:'Action Points',value:'2'},{name:'Initiative',value:'10'},
    {name:'Dmg Modifier',value:'+0'},{name:'Healing Rate',value:'2'},
    {name:'Movement',value:'6m'},{name:'MP max',value:'10'},
  ],
  identity:[
    {key:'Nom complet',val:''},{key:'Race',val:''},
    {key:'Genre / Âge',val:''},{key:'Carrière',val:''},
    {key:'Corpulence',val:''},{key:'Culture',val:''},
    {key:'Classe sociale',val:''},{key:'École magique',val:''},
  ],
  money:{po:0,pa:0,rc:0},
  abilities:[],abilitiesDesc:'',
  passions:[],
  stdSkills:[
    {name:'Athletics',formula:'STR+DEX',trained:false},{name:'Boating',formula:'STR+CON',trained:false},
    {name:'Conceal',formula:'DEX+POW',trained:false},{name:'Customs',formula:'INTx2',trained:false},
    {name:'Dance',formula:'DEX+CHA',trained:false},{name:'Deceit',formula:'INT+CHA',trained:false},
    {name:'Drive',formula:'DEX+POW',trained:false},{name:'First Aid',formula:'INT+DEX',trained:false},
    {name:'Influence',formula:'CHAx2',trained:false},{name:'Insight',formula:'INT+POW',trained:false},
    {name:'Locale',formula:'INTx2',trained:false},{name:'Perception',formula:'INT+POW',trained:false},
    {name:'Ride',formula:'DEX+POW',trained:false},{name:'Sing',formula:'CHA+POW',trained:false},
    {name:'Stealth',formula:'DEX+INT',trained:false},{name:'Swim',formula:'STR+CON',trained:false},
    {name:'Unarmed',formula:'STR+DEX',trained:false},
  ],
  profSkills:[],magicSkills:[],combatStyles:[],
  folkSpells:[],sorcSpells:[],sorcSchoolQuote:'',
  weapons:[],equipment:[],
  enc:{current:'0',encumbered:'0',overloaded:'0'},
  lp:{current:3,max:3},mp:{current:10,modMax:0},
  statMods:{},expMod:0,
  fatigue:'Fresh',
  hitLocations:[
    {name:'Tête',range:'19-20',maxHP:4,currentHP:4,armor:0},
    {name:'Bras Gauche',range:'16-18',maxHP:3,currentHP:3,armor:0},
    {name:'Bras Droit',range:'13-15',maxHP:3,currentHP:3,armor:0},
    {name:'Poitrine',range:'10-12',maxHP:5,currentHP:5,armor:0},
    {name:'Abdomen',range:'7-9',maxHP:4,currentHP:4,armor:0},
    {name:'Jambe Gauche',range:'4-6',maxHP:4,currentHP:4,armor:0},
    {name:'Jambe Droite',range:'1-3',maxHP:4,currentHP:4,armor:0},
  ],
  skillMods:{},quests:[],
  bgNotes:'',sessionNotes:'',generalNotes:'',skillSuccesses:{},
};

// ══ CHAR LIST ══
function getCharList(){return JSON.parse(localStorage.getItem('mythras_charlist')||'[]');}
function setCharList(l){localStorage.setItem('mythras_charlist',JSON.stringify(l));}

// Migration : nyxa_charlist / nyxa_v1 → mythras_*
if(!localStorage.getItem('mythras_charlist')){
  if(localStorage.getItem('nyxa_charlist')){
    const oldList=JSON.parse(localStorage.getItem('nyxa_charlist'));
    setCharList(oldList);
    oldList.forEach(c=>{
      const d=localStorage.getItem('nyxa_char_'+c.id);
      if(d) localStorage.setItem('mythras_char_'+c.id,d);
    });
    const oa=localStorage.getItem('nyxa_active_char');
    if(oa) localStorage.setItem('mythras_active_char',oa);
  } else if(localStorage.getItem('nyxa_v1')){
    const old=localStorage.getItem('nyxa_v1');
    const id='default';
    localStorage.setItem('mythras_char_'+id,old);
    const parsed=JSON.parse(old);
    setCharList([{id,name:parsed.charName||'Personnage',subtitle:parsed.charSubtitle||''}]);
    localStorage.setItem('mythras_active_char',id);
  } else {
    const id='char_'+Date.now();
    localStorage.setItem('mythras_char_'+id,JSON.stringify(D));
    setCharList([{id,name:D.charName,subtitle:D.charSubtitle}]);
    localStorage.setItem('mythras_active_char',id);
  }
}

let activeCharId = localStorage.getItem('mythras_active_char') || getCharList()[0]?.id;

// ══ STATE ══
function migrateState(S){
  ['charName','charSubtitle','stats','derivedAttrs','identity','money','abilities','abilitiesDesc',
   'passions','stdSkills','profSkills','magicSkills','combatStyles','folkSpells','sorcSpells',
   'sorcSchoolQuote','weapons','equipment','enc'].forEach(k=>{
    if(S[k]===undefined) S[k]=JSON.parse(JSON.stringify(D[k]));
  });
  if(!S.skillMods) S.skillMods=JSON.parse(JSON.stringify(D.skillMods));
  Object.keys(D.skillMods).forEach(k=>{ if(S.skillMods[k]===undefined) S.skillMods[k]=D.skillMods[k]; });
  S.hitLocations=S.hitLocations||D.hitLocations;
  S.hitLocations.forEach(l=>{ if(l.armor===undefined) l.armor=0; });
  (S.equipment||[]).forEach(e=>{ if(e.qty===undefined) e.qty=1; });
  if(!S.statMods) S.statMods={};
  if(S.expMod===undefined) S.expMod=0;
  if(S.mp.modMax===undefined) S.mp.modMax=0;
  delete S.mp.max;
  if(!S.skillSuccesses) S.skillSuccesses={};
  Object.keys(S.skillSuccesses).forEach(k=>{
    if(typeof S.skillSuccesses[k]==='number')
      S.skillSuccesses[k]={s:S.skillSuccesses[k]>0,f:false};
  });
  if(!S.pages){
    S.pages=[];
    const d=new Date().toLocaleDateString('fr-FR');
    (S.quests||[]).forEach(q=>{
      S.pages.push({id:'p_'+Date.now()+'_'+Math.random().toString(36).slice(2,5),
        title:q.title||'Quête',
        content:[q.desc,q.meta].filter(Boolean).join('\n\n'),
        drawing:null,date:d,archived:q.status!=='active'});
    });
    if(S.sessionNotes?.trim()) S.pages.push({id:'p_sn_'+Date.now(),title:'Notes de Session',content:S.sessionNotes,drawing:null,date:d,archived:false});
    if(S.generalNotes?.trim()) S.pages.push({id:'p_gn_'+Date.now(),title:'PNJ & Lieux',content:S.generalNotes,drawing:null,date:d,archived:false});
  }
  // Marquer hasDrawing si on lit l'ancien format avec drawing en data URL
  (S.pages||[]).forEach(p=>{
    if(p.drawing&&typeof p.drawing==='string'&&p.drawing.startsWith('data:')){
      p.hasDrawing=true; // sera migré vers IDB après chargement
      p._pendingDrawing=p.drawing;
      p.drawing=null;
    } else if(p.hasDrawing===undefined){
      p.hasDrawing=false;
    }
  });
  return S;
}

function loadStateForChar(id){
  const raw=localStorage.getItem('mythras_char_'+id);
  return migrateState(raw?JSON.parse(raw):JSON.parse(JSON.stringify(D)));
}

let S = loadStateForChar(activeCharId);

function save(){
  try{
    // Ne pas sérialiser _pendingDrawing
    const toSave=JSON.parse(JSON.stringify(S));
    (toSave.pages||[]).forEach(p=>{delete p._pendingDrawing;});
    localStorage.setItem('mythras_char_'+activeCharId, JSON.stringify(toSave));
    const list=getCharList();
    const idx=list.findIndex(c=>c.id===activeCharId);
    if(idx>=0){list[idx].name=S.charName;list[idx].subtitle=S.charSubtitle;setCharList(list);}
    const el=document.getElementById('save-ind');
    if(el){el.style.opacity='1';el.style.color='var(--green)';clearTimeout(el._t);el._t=setTimeout(()=>el.style.opacity='0',1500);}
  }catch(e){
    const el=document.getElementById('save-ind');
    if(el){el.textContent='⚠️ Stockage plein';el.style.opacity='1';el.style.color='var(--red)';}
    console.error('Save failed:',e);
  }
}

// Migration des dessins inline → IndexedDB (au démarrage et après import)
async function migratePendingDrawings(charId,state){
  const pending=(state.pages||[]).filter(p=>p._pendingDrawing);
  for(const p of pending){
    try{
      await Drawings.set(charId,p.id,p._pendingDrawing);
      p.hasDrawing=true;
      delete p._pendingDrawing;
    }catch(e){console.error('Drawing migration failed:',e);}
  }
  if(pending.length) save();
}

async function preloadDrawings(charId,state){
  const ids=(state.pages||[]).filter(p=>p.hasDrawing).map(p=>p.id);
  if(ids.length) await Drawings.loadCharCache(charId,ids);
}

// ══ CALC ══
const RESIST=[{name:'Brawn',formula:'STR+SIZ'},{name:'Endurance',formula:'CONx2'},{name:'Evade',formula:'DEXx2'},{name:'Willpower',formula:'POWx2'}];

function effStat(k){ return (S.stats[k]||0)+((S.statMods||{})[k]||0); }
function mpMax(){ return effStat('POW')+(S.mp.modMax||0); }

function calcBase(formula){
  const f=formula.replace(/([A-Z]{2,3})/g,m=>S.stats[m]!==undefined?effStat(m):0).replace(/[xX]/g,'*');
  try{return Function('"use strict";return('+f+')')();}catch(e){return 0;}
}

// ══ RENDER : par tab ══
let currentTab='perso';

function renderTab(tab){
  // header est rendu séparément (toujours visible)
  const eb1=document.getElementById('eb-'+tab);if(eb1)eb1.innerHTML=eb();
  if(tab==='perso'){
    renderTrackers(); renderStats(); renderDerivedAttrs(); renderIdentity();
    renderMoney(); renderAbilities(); loadBgNotes();
  } else if(tab==='skills'){
    renderResistances(); renderStdSkills(); renderProfSkills(); renderPassions();
  } else if(tab==='magie'){
    renderTrackers(); renderMPDots(); renderMagicSkills();
    renderFolkSpells(); renderSorcSpells(); renderSorcCalc();
  } else if(tab==='combat'){
    renderFatigue(); renderHitLocs(); renderCombatStyles();
    renderWeapons(); renderEquipment();
  } else if(tab==='dice'){
    initDiceTab(); renderHistory();
  } else if(tab==='journal'){
    renderJournal();
  }
}

function renderAll(){
  renderHeader();
  renderTab(currentTab);
}

function renderHeader(){
  const n=document.getElementById('header-name');
  const s=document.getElementById('header-subtitle');
  if(!n)return;
  if(editMode){
    n.innerHTML=`<input class="e-input w100" type="text" value="${esc(S.charName)}" oninput="S.charName=this.value;save()" style="font-size:20px;font-weight:700;color:var(--green)">`;
    s.innerHTML=`<input class="e-input w100" type="text" value="${esc(S.charSubtitle)}" oninput="S.charSubtitle=this.value;save()" style="font-size:12px;color:var(--muted);margin-top:2px">`;
  } else {
    n.textContent='⚡ '+S.charName;
    s.textContent=S.charSubtitle;
    document.title=S.charName+' · Mythras';
  }
}

function renderTrackers(){
  const lp=document.getElementById('display-lp');
  const mp=document.getElementById('display-mp');
  const mpb=document.getElementById('mp-big');
  const mx=mpMax();
  if(lp){
    if(editMode){
      lp.innerHTML=`${S.lp.current}/<input class="e-input num" type="number" min="1" value="${S.lp.max}" oninput="S.lp.max=parseInt(this.value)||1;save()">`;
    } else {
      lp.textContent=S.lp.current+'/'+S.lp.max;
    }
  }
  if(mp) mp.textContent=S.mp.current+'/'+mx;
  if(mpb) mpb.textContent=S.mp.current;
  const lbl=document.getElementById('mp-max-label');
  if(lbl) lbl.textContent='/ '+mx+' maximum';
}

function renderMPDots(){
  const c=document.getElementById('mp-dots');if(!c)return;c.innerHTML='';
  const mx=mpMax();
  for(let i=0;i<mx;i++){
    const d=document.createElement('div');const active=i<S.mp.current;
    d.style.cssText=`width:20px;height:20px;border-radius:50%;border:2px solid ${active?'var(--green)':'var(--border)'};background:${active?'rgba(61,255,170,.18)':'transparent'};cursor:pointer;transition:all .2s`;
    d.onclick=()=>{S.mp.current=i+1;save();renderTrackers();renderMPDots();};c.appendChild(d);
  }
  const bonus=S.mp.modMax||0;
  const bonusStr=(bonus>=0?'+':'')+bonus;
  const bonusCol=bonus>0?'var(--green)':bonus<0?'var(--red)':'var(--muted)';
  const row=document.createElement('div');
  row.style.cssText='margin-top:12px;display:flex;align-items:center;gap:6px;justify-content:center;font-size:12px;color:var(--muted)';
  row.innerHTML=`Bonus MP : <button onclick="adjMPMod(-1)" style="width:22px;height:22px;border-radius:4px;border:1px solid var(--border);background:var(--card);color:var(--text);font-size:14px;cursor:pointer;line-height:1">−</button><span style="color:${bonusCol};font-weight:700;min-width:28px;text-align:center">${bonusStr}</span><button onclick="adjMPMod(1)" style="width:22px;height:22px;border-radius:4px;border:1px solid var(--border);background:var(--card);color:var(--text);font-size:14px;cursor:pointer;line-height:1">+</button>`;
  c.appendChild(row);
}

function renderStats(){
  const c=document.getElementById('stats-grid');if(!c)return;
  const keys=['STR','CON','SIZ','DEX','INT','POW','CHA'];
  const green=['INT','POW'];
  c.className='stats-grid';
  c.innerHTML=keys.map(k=>{
    const g=green.includes(k);
    const mod=(S.statMods||{})[k]||0;
    const eff=effStat(k);
    const modStr=mod===0?'0':(mod>0?'+'+mod:''+mod);
    const modCol=mod>0?'var(--green)':mod<0?'var(--red)':'var(--muted)';
    return `<div class="stat-box"><div class="stat-label">${k}</div>${
      editMode
        ?`<input class="e-stat${g?' green':''}" type="number" min="1" max="99" value="${S.stats[k]}" oninput="S.stats['${k}']=parseInt(this.value)||0;save();renderStats();renderSkillSections()">`
        :`<div class="stat-value${g?' green':''}">${eff}</div>
         <div style="display:flex;align-items:center;justify-content:center;gap:2px;margin-top:3px">
           <button onclick="adjStatMod('${k}',-1)" style="width:17px;height:17px;border-radius:3px;border:1px solid var(--border);background:var(--card);color:var(--text);font-size:11px;cursor:pointer;line-height:1;padding:0">−</button>
           <span style="font-size:10px;color:${modCol};min-width:22px;text-align:center;font-weight:600">${modStr}</span>
           <button onclick="adjStatMod('${k}',1)" style="width:17px;height:17px;border-radius:3px;border:1px solid var(--border);background:var(--card);color:var(--text);font-size:11px;cursor:pointer;line-height:1;padding:0">+</button>
         </div>`
    }</div>`;
  }).join('')+(()=>{
    const em=S.expMod||0;
    const emStr=em>=0?'+'+em:''+em;
    const emCol=em>0?'var(--green)':em<0?'var(--red)':'var(--muted)';
    return `<div class="stat-box"><div class="stat-label">EXP mod</div>${
      editMode
        ?`<input class="e-stat" type="number" value="${em}" oninput="S.expMod=parseInt(this.value)||0;save();renderStats()" style="color:var(--yellow)">`
        :`<div class="stat-value" style="font-size:16px;color:${emCol}">${emStr}</div>
          <div style="display:flex;align-items:center;justify-content:center;gap:2px;margin-top:3px">
            <button onclick="S.expMod=(S.expMod||0)-1;save();renderStats()" style="width:17px;height:17px;border-radius:3px;border:1px solid var(--border);background:var(--card);color:var(--text);font-size:11px;cursor:pointer;line-height:1;padding:0">−</button>
            <span style="font-size:10px;color:${emCol};min-width:22px;text-align:center;font-weight:600">${emStr}</span>
            <button onclick="S.expMod=(S.expMod||0)+1;save();renderStats()" style="width:17px;height:17px;border-radius:3px;border:1px solid var(--border);background:var(--card);color:var(--text);font-size:11px;cursor:pointer;line-height:1;padding:0">+</button>
          </div>`
    }</div>`;
  })();
}

function renderDerivedAttrs(){
  const c=document.getElementById('derived-attrs');if(!c)return;
  c.className='attr-grid';
  c.innerHTML=S.derivedAttrs.map((a,i)=>`
    <div class="attr-item">
      <div class="attr-name">${editMode?`<input class="e-input" type="text" value="${esc(a.name)}" oninput="S.derivedAttrs[${i}].name=this.value;save()" style="color:var(--muted);font-size:12px">`:esc(a.name)}</div>
      <div class="attr-value">${editMode?`<input class="e-input num" type="text" value="${esc(a.value)}" oninput="S.derivedAttrs[${i}].value=this.value;save()" style="color:var(--green);font-size:16px;font-weight:700">`:esc(a.value)}</div>
    </div>`).join('');
}

function renderIdentity(){
  const c=document.getElementById('identity');if(!c)return;
  c.innerHTML=S.identity.map((r,i)=>`
    <div class="identity-row">
      <div class="identity-key">${editMode?`<input class="e-input sm" type="text" value="${esc(r.key)}" oninput="S.identity[${i}].key=this.value;save()" style="color:var(--muted)">`:esc(r.key)}</div>
      <div class="identity-val">${editMode?`<input class="e-input w100" type="text" value="${esc(r.val)}" oninput="S.identity[${i}].val=this.value;save()">`:esc(r.val)}</div>
      ${editMode?`<button class="del-btn" onclick="S.identity.splice(${i},1);save();renderIdentity()">×</button>`:''}
    </div>`).join('');
  if(editMode) c.innerHTML+=`<button class="add-btn" style="margin-top:8px" onclick="S.identity.push({key:'Champ',val:''});save();renderIdentity()">+ Ajouter un champ</button>`;
}

function renderMoney(){
  const c=document.getElementById('money-grid');if(!c)return;
  c.className='';
  c.innerHTML=`
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px">
      <div class="money-box"><div class="money-label">🪙 Or</div><div class="money-value">${S.money.po}</div></div>
      <div class="money-box"><div class="money-label">🥈 Argent</div><div class="money-value">${S.money.pa}</div></div>
      <div class="money-box"><div class="money-label">🟤 Cuivre</div><div class="money-value">${S.money.rc}</div></div>
    </div>
    <div style="background:var(--card2);border-radius:8px;padding:10px">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--muted);margin-bottom:8px">Transaction</div>
      <div style="display:flex;gap:6px;margin-bottom:10px">
        ${['t-po','t-pa','t-rc'].map((id,i)=>`
          <div style="flex:1;text-align:center">
            <div style="font-size:10px;color:var(--muted);margin-bottom:4px">${['Or','Argent','Cuivre'][i]}</div>
            <input id="${id}" type="number" min="0" value="0" style="width:100%;background:var(--card);border:1px solid var(--border);border-radius:6px;color:var(--text);padding:6px;font-size:18px;text-align:center;outline:none;-moz-appearance:textfield">
          </div>`).join('')}
      </div>
      <div style="display:flex;gap:8px">
        <button onclick="doMoney(1)" style="flex:1;padding:10px;background:rgba(61,255,170,.1);border:1px solid var(--green-dim);border-radius:8px;color:var(--green);font-size:14px;font-weight:700;cursor:pointer">+ Recevoir</button>
        <button onclick="doMoney(-1)" style="flex:1;padding:10px;background:rgba(255,77,109,.07);border:1px solid rgba(255,77,109,.3);border-radius:8px;color:var(--red);font-size:14px;font-weight:700;cursor:pointer">− Dépenser</button>
      </div>
    </div>
    ${editMode?`<div style="margin-top:10px;padding:10px;background:rgba(255,209,102,.06);border:1px solid rgba(255,209,102,.2);border-radius:8px">
      <div style="font-size:10px;color:var(--yellow);margin-bottom:8px">Modifier directement</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
        ${[{k:'po',l:'Or'},{k:'pa',l:'Argent'},{k:'rc',l:'Cuivre'}].map(f=>`
          <div class="money-box">
            <div class="money-label">${f.l}</div>
            <input class="e-input" type="number" min="0" value="${S.money[f.k]}" oninput="S.money['${f.k}']=parseInt(this.value)||0;save();renderMoney()" style="font-size:18px;font-weight:700;color:var(--yellow);text-align:center;width:100%">
          </div>`).join('')}
      </div>
    </div>`:''}
  `;
}

function doMoney(sign){
  const po=parseInt(document.getElementById('t-po').value)||0;
  const pa=parseInt(document.getElementById('t-pa').value)||0;
  const rc=parseInt(document.getElementById('t-rc').value)||0;
  applyMoney(sign*po, sign*pa, sign*rc);
  document.getElementById('t-po').value=0;
  document.getElementById('t-pa').value=0;
  document.getElementById('t-rc').value=0;
}

function applyMoney(po,pa,rc){
  let rRC=S.money.rc+rc, rPA=S.money.pa+pa, rPO=S.money.po+po;
  if(rRC>=100){rPA+=Math.floor(rRC/100);rRC=rRC%100;}
  else if(rRC<0){const b=Math.ceil(-rRC/100);rPA-=b;rRC+=b*100;}
  if(rPA>=100){rPO+=Math.floor(rPA/100);rPA=rPA%100;}
  else if(rPA<0){const b=Math.ceil(-rPA/100);rPO-=b;rPA+=b*100;}
  S.money={po:rPO,pa:rPA,rc:rRC};
  save();renderMoney();
}

function renderAbilities(){
  const c=document.getElementById('abilities');if(!c)return;
  const tags=S.abilities.map((a,i)=>editMode
    ?`<span style="display:inline-flex;align-items:center;gap:4px;margin:3px"><input class="e-input" type="text" value="${esc(a)}" oninput="S.abilities[${i}]=this.value;save()" style="width:110px"><button class="del-btn" onclick="S.abilities.splice(${i},1);save();renderAbilities()">×</button></span>`
    :`<span class="ability-tag">${esc(a)}</span>`).join('');
  const addBtn=editMode?`<button class="add-btn" style="margin-top:6px" onclick="S.abilities.push('Capacité');save();renderAbilities()">+ Ajouter</button>`:'';
  const desc=editMode
    ?`<textarea class="e-ta" style="margin-top:8px;min-height:60px" oninput="S.abilitiesDesc=this.value;save()">${esc(S.abilitiesDesc)}</textarea>`
    :`<div style="font-size:12px;color:var(--muted);line-height:1.5;margin-top:8px">${esc(S.abilitiesDesc)}</div>`;
  c.innerHTML=`<div style="margin-bottom:4px">${tags}${addBtn}</div>${desc}`;
}

// ══ SKILL ROW ══
function mkSkillRow(skill,trained,showDot,type,idx){
  const base=calcBase(skill.formula);
  const mod=(S.skillMods[skill.name]||0);
  const total=base+mod;
  const modStr=(mod>=0?'+':'')+mod;
  const n=safeN(skill.name);
  const dot=showDot?`<div class="skill-dot ${trained?'':'no'}"></div>`:`<div style="width:14px;flex-shrink:0"></div>`;
  const chk=S.skillSuccesses[skill.name]||{s:false,f:false};
  const succBtn=`<div style="display:flex;align-items:center;gap:4px;flex-shrink:0">
    <button class="skill-check${chk.s?' ok':''}" onclick="toggleSkillCheck('${n}','s')" title="Réussi au moins une fois">✓</button>
    <button class="skill-check${chk.f?' ko':''}" onclick="toggleSkillCheck('${n}','f')" title="Échec critique">✕</button>
  </div>`;
  if(editMode&&type!==undefined&&idx!==undefined){
    const canDrag=(type==='prof'||type==='magic')&&!skillFilter;
    return `<div class="skill-row" data-drag-idx="${idx}" data-drag-type="${type}Skills">
      ${canDrag?`<div class="drag-handle" title="Glisser pour réordonner">⠿</div>`:dot}
      <div class="skill-name-col">
        <input class="e-input w100" type="text" value="${esc(skill.name)}" oninput="renameSkill('${type}',${idx},this.value)">
        <input class="e-input w100" type="text" value="${esc(skill.formula)}" oninput="S.${type}Skills[${idx}].formula=this.value;save();renderSkillSections()" style="font-size:10px;color:var(--muted);margin-top:2px">
      </div>
      <div style="display:flex;align-items:center;gap:4px;flex-shrink:0">
        <span style="font-size:10px;color:var(--muted)">mod</span>
        <input class="e-input num" type="number" value="${mod}" oninput="setMod('${n}',this.value);renderSkillSections()" style="width:48px;text-align:center;font-weight:700">
      </div>
      <div class="skill-pct">${total}%</div>
      <button class="del-btn" onclick="delSkill('${type}',${idx})">×</button>
    </div>`;
  }
  return `<div class="skill-row">
    ${dot}
    <div class="skill-name-col">
      <div class="skill-name">${esc(skill.name)}</div>
      <div class="skill-base-formula">${esc(skill.formula)} = ${base}</div>
    </div>
    ${succBtn}
    <div class="skill-mod-ctrl">
      <button class="skill-mod-btn" onclick="adjMod('${n}',-1)">−</button>
      <span class="skill-mod-val">${modStr}</span>
      <button class="skill-mod-btn" onclick="adjMod('${n}',1)">+</button>
    </div>
    <div class="skill-pct">${total}%</div>
  </div>`;
}

function renderResistances(){
  const c=document.getElementById('resistances');if(!c)return;
  c.innerHTML=RESIST.map(r=>{
    const base=calcBase(r.formula),mod=(S.skillMods[r.name]||0),total=base+mod;
    const modStr=(mod>=0?'+':'')+mod,n=safeN(r.name),isW=r.name==='Willpower';
    const modCtrl=editMode
      ?`<div style="display:flex;align-items:center;gap:4px;flex-shrink:0">
          <span style="font-size:10px;color:var(--muted)">mod</span>
          <input class="e-input num" type="number" value="${mod}" oninput="setMod('${n}',this.value);renderResistances()" style="width:48px;text-align:center;font-weight:700">
        </div>`
      :`<div class="skill-mod-ctrl">
          <button class="skill-mod-btn" onclick="adjMod('${n}',-1)">−</button>
          <span class="skill-mod-val">${modStr}</span>
          <button class="skill-mod-btn" onclick="adjMod('${n}',1)">+</button>
        </div>`;
    return `<div class="skill-row">
      <div style="width:14px;flex-shrink:0"></div>
      <div class="skill-name-col">
        <div class="skill-name" style="font-weight:700;${isW?'color:var(--green)':''}">${r.name}</div>
        <div class="skill-base-formula">${r.formula} = ${base}</div>
      </div>
      ${modCtrl}
      <div class="skill-pct" style="${isW?'color:var(--green)':''}">${total}%</div>
    </div>`;
  }).join('');
}

function renderStdSkills(){
  const c=document.getElementById('std-skills');if(!c)return;
  const f=skillFilter;
  const rows=S.stdSkills.filter(s=>!f||s.name.toLowerCase().includes(f));
  c.innerHTML=rows.length?rows.map((s,i)=>mkSkillRow(s,s.trained,true,'std',S.stdSkills.indexOf(s))).join('')
    :(f?'<div style="color:var(--muted);font-size:12px;padding:8px">Aucune compétence trouvée</div>':'');
  const a=document.getElementById('add-std');
  if(a) a.innerHTML=editMode&&!f?`<button class="add-btn" onclick="addSkill('std')">+ Ajouter</button>`:'';
}

function renderProfSkills(){
  const c=document.getElementById('prof-skills');if(!c)return;
  const f=skillFilter;
  const rows=S.profSkills.filter(s=>!f||s.name.toLowerCase().includes(f));
  c.innerHTML=rows.length?rows.map((s,i)=>mkSkillRow(s,true,true,'prof',S.profSkills.indexOf(s))).join('')
    :(f?'<div style="color:var(--muted);font-size:12px;padding:8px">Aucune compétence trouvée</div>':'');
  const a=document.getElementById('add-prof');
  if(a) a.innerHTML=editMode&&!f?`<button class="add-btn" onclick="addSkill('prof')">+ Ajouter</button>`:'';
  initDrag('prof-skills','profSkills');
}

function renderMagicSkills(){
  const c=document.getElementById('magic-skills');if(!c)return;
  const f=skillFilter;
  const rows=S.magicSkills.filter(s=>!f||s.name.toLowerCase().includes(f));
  c.innerHTML=rows.length?rows.map((s,i)=>mkSkillRow(s,true,true,'magic',S.magicSkills.indexOf(s))).join('')
    :(f?'<div style="color:var(--muted);font-size:12px;padding:8px">Aucune compétence trouvée</div>':'');
  const a=document.getElementById('add-magic');
  if(a) a.innerHTML=editMode&&!f?`<button class="add-btn" onclick="addSkill('magic')">+ Ajouter</button>`:'';
  initDrag('magic-skills','magicSkills');
}

/* ── Drag & drop reorder ── */
let _drag={active:false};
function initDrag(containerId,arrName,rowSel='skill-row'){
  const c=document.getElementById(containerId);
  if(!c||!editMode)return;
  c.querySelectorAll('.drag-handle').forEach(h=>{
    h.addEventListener('pointerdown',e=>{
      e.preventDefault();
      const row=h.closest('.'+rowSel);
      const allRows=[...c.querySelectorAll('.'+rowSel)];
      const fromIdx=allRows.indexOf(row);
      if(fromIdx<0)return;
      row.classList.add('sk-dragging');
      row.style.pointerEvents='none';
      _drag={active:true,arrName,rowSel,fromIdx,toIdx:fromIdx,c,allRows,row};
      document.addEventListener('pointermove',_onDragMove,{passive:true});
      document.addEventListener('pointerup',_onDragEnd);
    });
  });
}
function _onDragMove(e){
  if(!_drag.active)return;
  const under=document.elementFromPoint(e.clientX,e.clientY);
  const targetRow=under?.closest?.('.'+(_drag.rowSel||'skill-row'));
  if(!targetRow||!_drag.allRows.includes(targetRow))return;
  const toIdx=_drag.allRows.indexOf(targetRow);
  if(toIdx===_drag.toIdx)return;
  _drag.toIdx=toIdx;
  _drag.allRows.forEach((r,i)=>{
    r.classList.toggle('sk-over-top',i===toIdx&&toIdx<_drag.fromIdx);
    r.classList.toggle('sk-over-bot',i===toIdx&&toIdx>_drag.fromIdx);
  });
}
function _onDragEnd(){
  document.removeEventListener('pointermove',_onDragMove);
  document.removeEventListener('pointerup',_onDragEnd);
  if(!_drag.active)return;
  const{arrName,fromIdx,toIdx}=_drag;
  const cleanup=_drag;
  _drag={active:false};
  if(fromIdx!==toIdx){
    const arr=S[arrName];
    const[moved]=arr.splice(fromIdx,1);
    arr.splice(toIdx,0,moved);
    save();
    if(arrName==='profSkills')renderProfSkills();
    else if(arrName==='magicSkills')renderMagicSkills();
    else if(arrName==='folkSpells')renderFolkSpells();
    else if(arrName==='sorcSpells')renderSorcSpells();
  } else {
    cleanup.c?.querySelectorAll('.'+(cleanup.rowSel||'skill-row')).forEach(r=>r.classList.remove('sk-dragging','sk-over-top','sk-over-bot'));
  }
}

function renderCombatStyles(){
  const c=document.getElementById('combat-styles');if(!c)return;
  c.innerHTML=S.combatStyles.map((cs,i)=>{
    const base=calcBase(cs.formula),mod=(S.skillMods[cs.name]||0),total=base+mod;
    const modStr=(mod>=0?'+':'')+mod,n=safeN(cs.name);
    if(editMode){return `<div class="weapon-card">
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
        <input class="e-input w100" type="text" value="${esc(cs.name)}" oninput="renameCS(${i},this.value)" style="font-size:14px;font-weight:700">
        <button class="del-btn" onclick="S.combatStyles.splice(${i},1);save();renderCombatStyles()">×</button>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
        <span style="font-size:11px;color:var(--muted)">Formule:</span><input class="e-input sm" type="text" value="${esc(cs.formula)}" oninput="S.combatStyles[${i}].formula=this.value;save();renderCombatStyles()">
        <span style="font-size:11px;color:var(--muted)">Trait:</span><input class="e-input" type="text" value="${esc(cs.trait)}" oninput="S.combatStyles[${i}].trait=this.value;save()" style="width:80px">
        <span style="font-size:11px;color:var(--muted)">Armes:</span><input class="e-input w100" type="text" value="${esc(cs.weapons)}" oninput="S.combatStyles[${i}].weapons=this.value;save()">
      </div>
      <div style="display:flex;align-items:center;gap:8px;padding-top:8px;border-top:1px solid var(--border)">
        <div style="font-size:11px;color:var(--muted);flex:1">${esc(cs.formula)} = ${base}</div>
        <div style="display:flex;align-items:center;gap:4px;flex-shrink:0">
          <span style="font-size:10px;color:var(--muted)">mod</span>
          <input class="e-input num" type="number" value="${mod}" oninput="setMod('${n}',this.value);renderCombatStyles()" style="width:48px;text-align:center;font-weight:700">
        </div>
        <div class="skill-pct">${total}%</div>
      </div>
    </div>`;}
    return `<div class="weapon-card">
      <div class="weapon-name">${esc(cs.name)}</div>
      <div class="weapon-stats">
        <div class="weapon-stat">Armes: <span>${esc(cs.weapons)}</span></div>
        <div class="weapon-stat">Trait: <span>${esc(cs.trait)}</span></div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-top:10px;padding-top:8px;border-top:1px solid var(--border)">
        <div style="font-size:11px;color:var(--muted);flex:1">${esc(cs.formula)} = ${base}</div>
        <div class="skill-mod-ctrl">
          <button class="skill-mod-btn" onclick="adjMod('${n}',-1)">−</button>
          <span class="skill-mod-val">${modStr}</span>
          <button class="skill-mod-btn" onclick="adjMod('${n}',1)">+</button>
        </div>
        <div class="skill-pct">${total}%</div>
      </div>
    </div>`;
  }).join('');
  const a=document.getElementById('add-cs');
  if(a) a.innerHTML=editMode?`<button class="add-btn" onclick="S.combatStyles.push({name:'Nouveau style',formula:'STR+DEX',trait:'',weapons:''});save();renderCombatStyles()">+ Ajouter un style</button>`:'';
}

function renderPassions(){
  const c=document.getElementById('passions');if(!c)return;
  if(editMode){
    c.innerHTML=S.passions.map((p,i)=>`
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <input class="e-input w100" type="text" value="${esc(p.name)}" oninput="S.passions[${i}].name=this.value;save()">
        <input class="e-input num" type="number" min="0" max="100" value="${p.pct}" oninput="S.passions[${i}].pct=parseInt(this.value)||0;save()">
        <span style="font-size:11px;color:var(--muted)">%</span>
        <button class="del-btn" onclick="S.passions.splice(${i},1);save();renderPassions()">×</button>
      </div>`).join('');
  } else {
    c.innerHTML=S.passions.map(p=>`
      <div class="passion-row">
        <div class="passion-header"><span>${esc(p.name)}</span><span class="passion-pct">${p.pct}%</span></div>
        <div class="passion-bar-bg"><div class="passion-bar-fill" style="width:${Math.min(100,p.pct)}%"></div></div>
      </div>`).join('');
  }
  const a=document.getElementById('add-passion');
  if(a) a.innerHTML=editMode?`<button class="add-btn" onclick="S.passions.push({name:'Nouvelle passion',pct:50});save();renderPassions()">+ Ajouter</button>`:'';
}

function renderFolkSpells(){
  const c=document.getElementById('folk-spells');if(!c)return;
  if(editMode){
    c.innerHTML=S.folkSpells.map((s,i)=>`
      <div class="spell-card folk open" style="cursor:default">
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
          <div class="drag-handle" title="Glisser pour réordonner">⠿</div>
          <input class="e-input w100" type="text" value="${esc(s.name)}" oninput="S.folkSpells[${i}].name=this.value;save()" style="font-size:14px;font-weight:700">
          <input class="e-input sm" type="text" value="${esc(s.cost)}" oninput="S.folkSpells[${i}].cost=this.value;save()">
          <button class="del-btn" onclick="S.folkSpells.splice(${i},1);save();renderFolkSpells()">×</button>
        </div>
        <textarea class="e-ta" style="min-height:50px;margin-bottom:6px" oninput="S.folkSpells[${i}].desc=this.value;save()">${esc(s.desc)}</textarea>
        <textarea class="e-ta" style="min-height:40px" oninput="S.folkSpells[${i}].notes=this.value;save()">${esc(s.notes)}</textarea>
      </div>`).join('');
  } else {
    c.innerHTML=S.folkSpells.map(s=>`
      <div class="spell-card folk" onclick="this.classList.toggle('open')">
        <div class="spell-header"><div class="spell-name">${esc(s.name)}</div><div class="spell-cost folk">${esc(s.cost)}</div></div>
        <div class="spell-detail">
          <div class="spell-desc">${esc(s.desc)}</div>
          <div class="spell-notes">🌿 ${esc(s.notes)}</div>
          <div class="spell-cast-bar" onclick="event.stopPropagation()">
            <button class="cast-btn" onclick="change('mp',-1)">⚡ Lancer (1 MP)</button>
            <button class="cast-btn fumble" onclick="fumbleFolk()">💀 Fumble (1d3 MP)</button>
          </div>
        </div>
      </div>`).join('');
  }
  const a=document.getElementById('add-folk');
  if(a) a.innerHTML=editMode?`<button class="add-btn" onclick="S.folkSpells.push({name:'Nouveau sort',cost:'1 MP',desc:'',notes:''});save();renderFolkSpells()">+ Ajouter</button>`:'';
  initDrag('folk-spells','folkSpells','spell-card');
}

function renderSorcSpells(){
  const c=document.getElementById('sorc-spells'),q=document.getElementById('sorc-quote');if(!c)return;
  if(q) q.innerHTML=editMode
    ?`<textarea class="e-ta" style="margin-bottom:10px;min-height:50px" oninput="S.sorcSchoolQuote=this.value;save()">${esc(S.sorcSchoolQuote)}</textarea>`
    :`<div class="school-quote">${esc(S.sorcSchoolQuote)}</div>`;
  if(editMode){
    c.innerHTML=S.sorcSpells.map((s,i)=>`
      <div class="spell-card open" style="cursor:default">
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
          <div class="drag-handle" title="Glisser pour réordonner">⠿</div>
          <input class="e-input w100" type="text" value="${esc(s.name)}" oninput="S.sorcSpells[${i}].name=this.value;save()" style="font-size:14px;font-weight:700">
          <input class="e-input sm" type="text" value="${esc(s.cost)}" oninput="S.sorcSpells[${i}].cost=this.value;save()">
          <button class="del-btn" onclick="S.sorcSpells.splice(${i},1);save();renderSorcSpells()">×</button>
        </div>
        <textarea class="e-ta" style="min-height:50px;margin-bottom:6px" oninput="S.sorcSpells[${i}].desc=this.value;save()">${esc(s.desc)}</textarea>
        <textarea class="e-ta" style="min-height:40px" oninput="S.sorcSpells[${i}].notes=this.value;save()">${esc(s.notes)}</textarea>
      </div>`).join('');
  } else {
    c.innerHTML=S.sorcSpells.map(s=>`
      <div class="spell-card" onclick="this.classList.toggle('open')">
        <div class="spell-header"><div class="spell-name">${esc(s.name)}</div><div class="spell-cost">${esc(s.cost)}</div></div>
        <div class="spell-detail"><div class="spell-desc">${esc(s.desc)}</div><div class="spell-notes">⚡ ${esc(s.notes)}</div></div>
      </div>`).join('');
  }
  const a=document.getElementById('add-sorc');
  if(a) a.innerHTML=editMode?`<button class="add-btn" onclick="S.sorcSpells.push({name:'Nouveau sort',cost:'1+ MP',desc:'',notes:''});save();renderSorcSpells()">+ Ajouter</button>`:'';
  initDrag('sorc-spells','sorcSpells','spell-card');
  if(!editMode) renderSorcCalc();
}

function renderSorcCalc(){
  const c=document.getElementById('sorc-calc');if(!c)return;
  if(editMode){c.innerHTML='';return;}
  const pow=effStat('POW');
  const invocSkill=S.magicSkills.find(s=>s.name.toLowerCase().includes('invoc'));
  const shapingSkill=S.magicSkills.find(s=>s.name.toLowerCase().includes('shap'));
  const invocTotal=invocSkill?calcBase(invocSkill.formula)+(S.skillMods[invocSkill.name]||0):0;
  const shapingTotal=shapingSkill?calcBase(shapingSkill.formula)+(S.skillMods[shapingSkill.name]||0):0;
  calcMaxPts=Math.floor(shapingTotal/10);
  const intensite=Math.floor(invocTotal/10);
  const totalUsed=Object.values(calcPts).reduce((a,b)=>a+b,0);
  const mpCost=1+totalUsed;
  const mpCrit=Math.ceil(mpCost*0.5);
  const mpCurr=S.mp.current;
  const over=totalUsed>calcMaxPts;
  const castRounds=1+totalUsed;
  const castLabel=castRounds===1?'1 round':`${castRounds} rounds`;
  const RANGE_TABLE=['Toucher',`${pow} m`,`${5*pow} m`,`${10*pow} m`,`${50*pow} m`,`${100*pow} m`];
  const params=[
    {key:'combine',  label:'Combine',   eff:`${calcPts.combine+1} sort${calcPts.combine>0?'s':''}`},
    {key:'duration', label:'Durée',     eff:`${(calcPts.duration+1)*pow} min`},
    {key:'magnitude',label:'Magnitude', eff:`${calcPts.magnitude+1}`},
    {key:'range',    label:'Portée',    eff:RANGE_TABLE[Math.min(calcPts.range,5)]},
    {key:'targets',  label:'Cibles',    eff:`${calcPts.targets+1}`},
  ];
  c.innerHTML=`
    <div style="font-size:12px;font-weight:700;color:var(--green);margin-bottom:10px;letter-spacing:.5px">⚙️ CALCULATEUR SHAPING</div>
    <div class="calc-header">
      ${invocSkill?`<div class="calc-stat">Invocation <span>${invocTotal}%</span> — Intensité <span>${intensite}</span></div>`:'<div class="calc-stat" style="color:var(--muted)">Invocation non configurée</div>'}
      ${shapingSkill?`<div class="calc-stat">Shaping <span>${shapingTotal}%</span> — Max <span>${calcMaxPts} pts</span></div>`:'<div class="calc-stat" style="color:var(--muted)">Shaping non configuré</div>'}
    </div>
    ${params.map(p=>`
    <div class="calc-param-row">
      <div class="calc-param-name">${p.label}</div>
      <button class="adj-btn" onclick="adjCalc('${p.key}',-1)">−</button>
      <div style="min-width:20px;text-align:center;font-size:13px;font-weight:700;color:var(--green)">${calcPts[p.key]}</div>
      <button class="adj-btn" onclick="adjCalc('${p.key}',1)">+</button>
      <div class="calc-param-eff">${p.eff}</div>
    </div>`).join('')}
    <div class="calc-result">
      <div>
        <div class="calc-cost">${mpCost} <span style="font-size:13px;font-weight:400">MP</span></div>
        <div class="calc-cost-label">Coût de lancer</div>
      </div>
      <div style="font-size:12px;color:var(--muted);text-align:center">⏱ Temps<br><span style="font-weight:700;color:var(--yellow)">${castLabel}</span></div>
      <div class="calc-budget ${over?'over':''}">${totalUsed}/${calcMaxPts} pts${over?' ⚠️':''}</div>
      <div style="font-size:12px;color:var(--muted)">PM restants<br><span style="font-weight:700;color:${mpCurr-mpCost>=0?'var(--green)':'var(--red)'}">${mpCurr-mpCost}</span></div>
    </div>
    <div class="calc-actions">
      <button class="calc-btn cast" onclick="castSorcery(1)">⚡ Lancer (${mpCost} MP)</button>
      <button class="calc-btn crit" onclick="castSorcery(0.5)">✨ Critique (${mpCrit} MP)</button>
      <button class="calc-btn reset" onclick="Object.keys(calcPts).forEach(k=>calcPts[k]=0);renderSorcCalc()">↺ Reset</button>
    </div>`;
}

function adjCalc(param, delta){
  const totalUsed=Object.values(calcPts).reduce((a,b)=>a+b,0);
  if(delta>0 && totalUsed>=calcMaxPts) return;
  calcPts[param]=Math.max(0,calcPts[param]+delta);
  renderSorcCalc();
}

function castSorcery(factor){
  const totalUsed=Object.values(calcPts).reduce((a,b)=>a+b,0);
  const mpCost=Math.ceil((1+totalUsed)*factor);
  change('mp',-mpCost);
}

function fumbleFolk(){
  const loss=Math.ceil(Math.random()*3);
  change('mp',-loss);
}

function renderFatigue(){
  const states=[
    {name:'Fresh',effect:'Normal',d:false},{name:'Winded',effect:'Hard',d:false},
    {name:'Tired',effect:'Hard · −1m',d:false},{name:'Wearied',effect:'Formidable · −2m',d:false},
    {name:'Exhausted',effect:'Formidable · −3m',d:true},{name:'Debilitated',effect:'Herculean · −6m',d:true},
    {name:'Incapacitated',effect:'Aucune activité',d:true},{name:'Semi-Conscious',effect:'Aucune activité',d:true},
    {name:'Comatose',effect:'Aucune activité',d:true},{name:'Dead',effect:'☠️',d:true},
  ];
  const c=document.getElementById('fatigue-grid');if(!c)return;
  c.innerHTML=states.map(f=>`
    <div class="fatigue-state ${f.d?'danger':''} ${S.fatigue===f.name?'active':''}" onclick="setFatigue('${f.name}')">
      <div class="fatigue-name">${f.name}</div>
      <div class="fatigue-effect">${f.effect}</div>
    </div>`).join('');
}

function renderHitLocs(){
  const bsvg=document.getElementById('body-svg');
  if(bsvg){
    const ZONES=[
      {shape:'circle',cx:50,cy:16,r:13},
      {shape:'rect',x:72,y:32,w:16,h:45},
      {shape:'rect',x:12,y:32,w:16,h:45},
      {shape:'rect',x:30,y:32,w:40,h:36},
      {shape:'rect',x:30,y:70,w:40,h:28},
      {shape:'rect',x:52,y:100,w:18,h:65},
      {shape:'rect',x:30,y:100,w:18,h:65},
    ];
    const zoneColor=loc=>{
      if(!loc) return ['rgba(34,34,64,.4)','#222240'];
      if(loc.currentHP<-loc.maxHP) return ['rgba(255,77,109,.45)','#ff4d6d'];
      if(loc.currentHP<=0) return ['rgba(255,209,102,.4)','#ffd166'];
      return ['rgba(61,255,170,.25)','#1a6644'];
    };
    const shapes=ZONES.map((z,i)=>{
      const loc=S.hitLocations[i];
      const [fill,stroke]=zoneColor(loc);
      const click=loc?`onclick="changeHP(${i}, event.shiftKey?1:-1)" style="cursor:pointer"`:'';
      if(z.shape==='circle')
        return `<circle cx="${z.cx}" cy="${z.cy}" r="${z.r}" fill="${fill}" stroke="${stroke}" stroke-width="1.5" ${click}/>`;
      return `<rect x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" rx="4" fill="${fill}" stroke="${stroke}" stroke-width="1.5" ${click}/>`;
    }).join('');
    bsvg.innerHTML=`<svg viewBox="0 0 100 180" width="110" height="198" xmlns="http://www.w3.org/2000/svg">${shapes}</svg>`;
  }
  const c=document.getElementById('hit-locs');if(!c)return;
  c.innerHTML=S.hitLocations.map((loc,i)=>{
    const cls=loc.currentHP<-loc.maxHP?'mortal':loc.currentHP<=0?'wounded':'';
    const ap=loc.armor||0;
    const apCls=ap>0?' has':'';
    if(editMode){return `<div class="hit-location">
      <input class="e-input sm" type="text" value="${esc(loc.range)}" oninput="S.hitLocations[${i}].range=this.value;save()" style="width:38px;font-size:11px;color:var(--muted);text-align:center">
      <input class="e-input w100" type="text" value="${esc(loc.name)}" oninput="S.hitLocations[${i}].name=this.value;save()" style="font-size:13px">
      <div class="hit-hp-controls">
        <button class="hit-btn" onclick="changeHP(${i},-1)">−</button>
        <span style="font-size:13px;font-weight:700;color:var(--green)">${loc.currentHP}/</span><input class="e-input num" type="number" min="1" max="30" value="${loc.maxHP}" oninput="S.hitLocations[${i}].maxHP=parseInt(this.value)||1;save()" style="font-size:13px;font-weight:700;color:var(--green)">
        <button class="hit-btn" onclick="changeHP(${i},1)">+</button>
      </div>
      <div class="hit-armor" title="Points d'Armure">
        🛡<input class="e-input num" type="number" min="0" max="20" value="${ap}" oninput="S.hitLocations[${i}].armor=Math.max(0,parseInt(this.value)||0);save()" style="width:32px;font-size:13px;font-weight:700;color:var(--yellow)">
      </div>
      <button class="del-btn" onclick="S.hitLocations.splice(${i},1);save();renderHitLocs()">×</button>
    </div>`;}
    return `<div class="hit-location">
      <div class="hit-range">${esc(loc.range)}</div>
      <div class="hit-name">${esc(loc.name)}</div>
      <div class="hit-hp-controls">
        <button class="hit-btn" onclick="changeHP(${i},-1)">−</button>
        <div class="hit-hp-display ${cls}">${loc.currentHP}/${loc.maxHP}</div>
        <button class="hit-btn" onclick="changeHP(${i},1)">+</button>
      </div>
      <div class="hit-armor" title="Points d'Armure — clic pour ajuster">
        <button class="hit-armor-btn" onclick="changeArmor(${i},-1)">−</button>
        <span class="hit-armor-val${apCls}">🛡${ap}</span>
        <button class="hit-armor-btn" onclick="changeArmor(${i},1)">+</button>
      </div>
    </div>`;
  }).join('');
  const a=document.getElementById('add-hitlec');
  if(a) a.innerHTML=editMode?`<button class="add-btn" onclick="S.hitLocations.push({name:'Localisation',range:'--',maxHP:5,currentHP:5,armor:0});save();renderHitLocs()">+ Ajouter</button>`:'';
}

function renderWeapons(){
  const c=document.getElementById('weapons');if(!c)return;
  if(editMode){
    c.innerHTML=S.weapons.map((w,i)=>`
      <div class="weapon-card">
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
          <input class="e-input w100" type="text" value="${esc(w.name)}" oninput="S.weapons[${i}].name=this.value;save()" style="font-size:14px;font-weight:700">
          <button class="del-btn" onclick="S.weapons.splice(${i},1);save();renderWeapons()">×</button>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;font-size:11px;color:var(--muted);margin-bottom:6px">
          Dég: <input class="e-input sm" type="text" value="${esc(w.dmg)}" oninput="S.weapons[${i}].dmg=this.value;save()">
          Taille: <input class="e-input" type="text" value="${esc(w.size)}" oninput="S.weapons[${i}].size=this.value;save()" style="width:28px">
          Portée: <input class="e-input" type="text" value="${esc(w.range)}" oninput="S.weapons[${i}].range=this.value;save()" style="width:28px">
          AP/HP: <input class="e-input sm" type="text" value="${esc(w.apHP)}" oninput="S.weapons[${i}].apHP=this.value;save()" style="width:38px">
        </div>
        <input class="e-input w100" type="text" value="${esc(w.effects)}" oninput="S.weapons[${i}].effects=this.value;save()" placeholder="Effets spéciaux" style="font-size:11px">
      </div>`).join('');
  } else {
    c.innerHTML=S.weapons.map(w=>`
      <div class="weapon-card">
        <div class="weapon-name">${esc(w.name)}</div>
        <div class="weapon-stats">
          <div class="weapon-stat">Dégâts: <span>${esc(w.dmg)}</span></div>
          <div class="weapon-stat">Taille: <span>${esc(w.size)}</span></div>
          <div class="weapon-stat">Portée: <span>${esc(w.range)}</span></div>
          <div class="weapon-stat">AP/HP: <span>${esc(w.apHP)}</span></div>
        </div>
        ${w.effects?`<div class="weapon-effects">⚡ ${esc(w.effects)}</div>`:''}
      </div>`).join('');
  }
  const a=document.getElementById('add-weapon');
  if(a) a.innerHTML=editMode?`<button class="add-btn" onclick="S.weapons.push({name:'Arme',dmg:'1D6',size:'M',range:'M',apHP:'1/5',effects:''});save();renderWeapons()">+ Ajouter une arme</button>`:'';
}

function renderEquipment(){
  const c=document.getElementById('equipment');if(!c)return;
  const rows=S.equipment.map((e,i)=>{
    const qty=e.qty??1;
    const qtyCtrl=`<div style="display:flex;align-items:center;gap:3px;flex-shrink:0">
      <button onclick="adjEquipQty(${i},-1)" style="width:22px;height:22px;border-radius:4px;border:1px solid var(--border);background:var(--card);color:var(--text);font-size:14px;cursor:pointer;line-height:1;flex-shrink:0">−</button>
      <span style="font-size:13px;font-weight:700;color:var(--green);min-width:24px;text-align:center">${qty}</span>
      <button onclick="adjEquipQty(${i},1)" style="width:22px;height:22px;border-radius:4px;border:1px solid var(--border);background:var(--card);color:var(--text);font-size:14px;cursor:pointer;line-height:1;flex-shrink:0">+</button>
    </div>`;
    const encTag=`<span style="font-size:10px;color:var(--muted);flex-shrink:0">${editMode?`ENC <input class="e-input num" type="number" min="0" value="${esc(e.enc)}" oninput="S.equipment[${i}].enc=this.value;save()" style="width:30px">`:`ENC ${esc(e.enc)}`}</span>`;
    return `<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid rgba(34,34,64,.5)">
      <input style="flex:1;min-width:0;background:transparent;border:none;border-bottom:1px solid ${editMode?'var(--green-dim)':'transparent'};color:var(--text);font-size:13px;font-weight:500;outline:none;padding:1px 2px;transition:border-color .15s" type="text" value="${esc(e.name)}" oninput="S.equipment[${i}].name=this.value;save()" onfocus="this.style.borderBottomColor='var(--green-dim)'" onblur="this.style.borderBottomColor='${editMode?'var(--green-dim)':'transparent'}'">
      ${qtyCtrl}
      ${encTag}
      <button class="del-btn" onclick="S.equipment.splice(${i},1);save();renderEquipment()">×</button>
    </div>`;
  }).join('');
  const encBar=`<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);display:flex;justify-content:space-between;font-size:12px">
    ${editMode
      ?`<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <span style="color:var(--muted)">ENC:</span><input class="e-input sm" type="text" value="${esc(S.enc.current)}" oninput="S.enc.current=this.value;save()">
          <span style="color:var(--muted)">Encombré:</span><input class="e-input sm" type="text" value="${esc(S.enc.encumbered)}" oninput="S.enc.encumbered=this.value;save()">
          <span style="color:var(--muted)">Surchargé:</span><input class="e-input sm" type="text" value="${esc(S.enc.overloaded)}" oninput="S.enc.overloaded=this.value;save()">
        </div>`
      :`<span style="color:var(--muted)">ENC / Encombré / Surchargé</span>
        <span style="color:var(--green)">${esc(S.enc.current)} / ${esc(S.enc.encumbered)} / ${esc(S.enc.overloaded)}</span>`}
  </div>`;
  c.innerHTML=rows
    +`<button class="add-btn" style="margin-top:8px" onclick="S.equipment.push({name:'Nouvel objet',qty:1,enc:'0'});save();renderEquipment()">+ Ajouter un objet</button>`
    +encBar;
}

function adjEquipQty(i,delta){
  const e=S.equipment[i];if(!e)return;
  e.qty=Math.max(0,(e.qty??1)+delta);
  if(e.qty===0&&confirm('Quantité à 0 — supprimer l\'objet ?')){S.equipment.splice(i,1);}
  save();renderEquipment();
}

// ══ JOURNAL PAGES ══
let openCanvases=new Set();
let journalArchivesOpen=false;
const drawState={};

function renderJournal(){
  const el=document.getElementById('journal-pages');
  if(!el)return;
  const active=(S.pages||[]).filter(p=>!p.archived);
  const archived=(S.pages||[]).filter(p=>p.archived);
  let html='';
  if(!active.length) html+=`<div style="color:var(--muted);font-size:13px;text-align:center;padding:24px 0">📖 Aucune page — commence à écrire !</div>`;
  active.forEach(p=>{ html+=renderPageCard(p); });
  html+=`<button class="add-btn" onclick="addPage()">+ Nouvelle page</button>`;
  if(archived.length){
    html+=`<button class="archives-toggle" onclick="toggleJournalArchives()">${journalArchivesOpen?'▼':'▶'} Archives (${archived.length})</button>`;
    if(journalArchivesOpen) archived.forEach(p=>{ html+=renderPageCard(p); });
  }
  el.innerHTML=html;
  setTimeout(()=>{
    (S.pages||[]).forEach(p=>{
      if(openCanvases.has(p.id)) initCanvas(p.id);
    });
  },0);
}

function renderPageCard(page){
  const n=safeN(page.id);
  const hasCanvas=openCanvases.has(page.id);
  const colors=['#1a1a1a','#4a3728','#8b2635','#2d5a27','#1a3a5c','#c88e28'];
  const colorBtns=colors.map(c=>`<button class="draw-color-btn" style="background:${c}" onclick="setDrawColor('${n}','${c}')"></button>`).join('');
  const canvasHtml=hasCanvas?`
    <div class="canvas-wrap" data-noswipe>
      <div class="canvas-toolbar" id="toolbar_${page.id}">
        <button class="draw-tool-btn active" data-tool="pen" onclick="setDrawTool('${n}','pen')" title="Stylo">✏️</button>
        <button class="draw-tool-btn" data-tool="eraser" onclick="setDrawTool('${n}','eraser')" title="Gomme">🧹</button>
        <div class="draw-sep"></div>
        ${colorBtns}
        <div class="draw-sep"></div>
        <button class="draw-size-btn" onclick="setDrawSize('${n}',2)" title="Fin">·</button>
        <button class="draw-size-btn" onclick="setDrawSize('${n}',4)" title="Moyen">•</button>
        <button class="draw-size-btn" onclick="setDrawSize('${n}',8)" title="Épais">●</button>
        <div class="draw-sep"></div>
        <button class="draw-tool-btn" onclick="clearCanvas('${n}')" style="color:var(--red)" title="Tout effacer">🗑</button>
      </div>
      <canvas id="canvas_${page.id}" class="draw-canvas"></canvas>
    </div>`:'';
  return `<div class="journal-page${page.archived?' archived':''}">
    <div class="jpage-header">
      <input class="jpage-title" value="${esc(page.title)}" oninput="savePageField('${n}','title',this.value)" placeholder="Titre…">
      <span class="jpage-date">${esc(page.date)}</span>
      <div class="jpage-actions">
        <button class="q-btn ${page.archived?'green':'yellow'}" onclick="archivePage('${n}')" title="${page.archived?'Désarchiver':'Archiver'}">${page.archived?'📂':'📁'}</button>
        <button class="q-btn red" onclick="deletePage('${n}')" title="Supprimer">🗑</button>
      </div>
    </div>
    <textarea class="jpage-text" oninput="savePageField('${n}','content',this.value)" placeholder="Écris librement…" rows="5">${esc(page.content||'')}</textarea>
    <div class="jpage-draw-bar">
      <button class="q-btn${hasCanvas?' green':''}" onclick="toggleCanvas('${n}')">${hasCanvas?'🎨 Masquer':'🎨 Dessin'}</button>
      ${page.hasDrawing&&!hasCanvas?'<span style="font-size:11px;color:var(--muted)">· croquis enregistré</span>':''}
    </div>
    ${canvasHtml}
  </div>`;
}

function addPage(){
  const id='p_'+Date.now()+'_'+Math.random().toString(36).slice(2,5);
  if(!S.pages) S.pages=[];
  S.pages.unshift({id,title:'Nouvelle page',content:'',hasDrawing:false,date:new Date().toLocaleDateString('fr-FR'),archived:false});
  save();renderJournal();
}

function savePageField(id,field,value){
  const p=(S.pages||[]).find(p=>p.id===id);
  if(p){p[field]=value;save();}
}

function archivePage(id){
  const p=(S.pages||[]).find(p=>p.id===id);
  if(p){p.archived=!p.archived;openCanvases.delete(id);save();renderJournal();}
}

async function deletePage(id){
  if(!confirm('Supprimer cette page définitivement ?'))return;
  const page=(S.pages||[]).find(p=>p.id===id);
  if(page&&page.hasDrawing){
    try{await Drawings.del(activeCharId,id);}catch(e){console.error(e);}
  }
  S.pages=(S.pages||[]).filter(p=>p.id!==id);
  openCanvases.delete(id);save();renderJournal();
}

function toggleCanvas(id){
  if(openCanvases.has(id)) openCanvases.delete(id); else openCanvases.add(id);
  renderJournal();
}

function toggleJournalArchives(){
  journalArchivesOpen=!journalArchivesOpen;
  renderJournal();
}

async function initCanvas(pageId){
  const canvas=document.getElementById('canvas_'+pageId);
  if(!canvas)return;
  const w=canvas.offsetWidth||360;
  canvas.width=w; canvas.height=280;
  const ctx=canvas.getContext('2d');
  ctx.fillStyle='#fafafa';ctx.fillRect(0,0,w,280);
  // Charger depuis IDB (cache si dispo)
  let dataURL=Drawings.getCached(activeCharId,pageId);
  if(!dataURL){
    try{dataURL=await Drawings.get(activeCharId,pageId);}catch(e){console.error(e);}
  }
  if(dataURL){
    const img=new Image();
    img.onload=()=>ctx.drawImage(img,0,0);
    img.src=dataURL;
  }
  if(!drawState[pageId]) drawState[pageId]={tool:'pen',color:'#1a1a1a',size:3,isDrawing:false};
  const getPos=e=>{
    const r=canvas.getBoundingClientRect(),sx=canvas.width/r.width,sy=canvas.height/r.height;
    const src=e.touches?e.touches[0]:e;
    return {x:(src.clientX-r.left)*sx,y:(src.clientY-r.top)*sy};
  };
  canvas.onmousedown=canvas.ontouchstart=e=>{
    e.preventDefault();const ds=drawState[pageId];ds.isDrawing=true;
    const p=getPos(e);const ctx=canvas.getContext('2d');ctx.beginPath();ctx.moveTo(p.x,p.y);
  };
  canvas.onmousemove=canvas.ontouchmove=e=>{
    e.preventDefault();const ds=drawState[pageId];if(!ds.isDrawing)return;
    const p=getPos(e);const ctx=canvas.getContext('2d');
    if(ds.tool==='eraser'){ctx.globalCompositeOperation='destination-out';ctx.lineWidth=ds.size*5;}
    else{ctx.globalCompositeOperation='source-over';ctx.strokeStyle=ds.color;ctx.lineWidth=ds.size;}
    ctx.lineCap='round';ctx.lineJoin='round';ctx.lineTo(p.x,p.y);ctx.stroke();ctx.beginPath();ctx.moveTo(p.x,p.y);
  };
  canvas.onmouseup=canvas.onmouseleave=canvas.ontouchend=async e=>{
    const ds=drawState[pageId];if(!ds.isDrawing)return;ds.isDrawing=false;
    canvas.getContext('2d').globalCompositeOperation='source-over';
    const pg=(S.pages||[]).find(p=>p.id===pageId);
    if(pg){
      try{
        await Drawings.set(activeCharId,pageId,canvas.toDataURL());
        if(!pg.hasDrawing){pg.hasDrawing=true;save();}
      }catch(err){console.error('Drawing save failed:',err);}
    }
  };
}

function setDrawTool(pageId,tool){
  if(drawState[pageId]) drawState[pageId].tool=tool;
  const tb=document.getElementById('toolbar_'+pageId);
  if(tb) tb.querySelectorAll('.draw-tool-btn[data-tool]').forEach(b=>b.classList.toggle('active',b.dataset.tool===tool));
}
function setDrawColor(pageId,color){if(drawState[pageId]) drawState[pageId].color=color;}
function setDrawSize(pageId,size){if(drawState[pageId]) drawState[pageId].size=parseInt(size);}
async function clearCanvas(pageId){
  const canvas=document.getElementById('canvas_'+pageId);if(!canvas)return;
  const ctx=canvas.getContext('2d');ctx.globalCompositeOperation='source-over';
  ctx.fillStyle='#fafafa';ctx.fillRect(0,0,canvas.width,canvas.height);
  const pg=(S.pages||[]).find(p=>p.id===pageId);
  if(pg){
    try{await Drawings.del(activeCharId,pageId);}catch(e){console.error(e);}
    pg.hasDrawing=false;save();
  }
}

function loadBgNotes(){
  const bg=document.getElementById('bg-notes');if(bg)bg.value=S.bgNotes||'';
}

// ══ ACTIONS ══
function change(type,delta){
  if(type==='lp') S.lp.current=Math.max(0,Math.min(S.lp.max,S.lp.current+delta));
  if(type==='mp') S.mp.current=Math.max(0,Math.min(mpMax(),S.mp.current+delta));
  save();renderTrackers();renderMPDots();
}

function changeHP(idx,delta){
  const loc=S.hitLocations[idx];
  loc.currentHP=Math.min(loc.maxHP,loc.currentHP+delta);
  save();renderHitLocs();
}

function changeArmor(idx,delta){
  const loc=S.hitLocations[idx];
  loc.armor=Math.max(0,Math.min(20,(loc.armor||0)+delta));
  save();renderHitLocs();
}

function setFatigue(name){S.fatigue=name;save();renderFatigue();}

function adjMod(name,delta){
  if(!S.skillMods)S.skillMods={};
  S.skillMods[name]=(S.skillMods[name]||0)+delta;
  save();renderSkillSections();
}

function setMod(name,value){
  if(!S.skillMods)S.skillMods={};
  S.skillMods[name]=parseInt(value)||0;
  save();
}

function renderSkillSections(){
  renderResistances();renderStdSkills();renderProfSkills();renderMagicSkills();renderCombatStyles();
}

function renameSkill(type,idx,val){
  const oldName=S[type+'Skills'][idx].name;
  const oldMod=S.skillMods[oldName]||0;
  delete S.skillMods[oldName];
  S[type+'Skills'][idx].name=val;
  S.skillMods[val]=oldMod;
  save();
}

function renameCS(idx,val){
  const oldName=S.combatStyles[idx].name;
  const oldMod=S.skillMods[oldName]||0;
  delete S.skillMods[oldName];
  S.combatStyles[idx].name=val;
  S.skillMods[val]=oldMod;
  save();
}

function delSkill(type,idx){
  const name=S[type+'Skills'][idx].name;
  delete S.skillMods[name];
  S[type+'Skills'].splice(idx,1);
  save();renderSkillSections();
}

function addSkill(type){
  const sk={name:'Nouvelle compétence',formula:'INTx2'};
  if(type==='std')sk.trained=false;
  S[type+'Skills'].push(sk);
  save();renderSkillSections();
}

const TABS=['perso','skills','magie','combat','journal','dice'];

function showTab(tab,direction){
  if(tab===currentTab) return;
  const prevIdx=TABS.indexOf(currentTab);
  const nextIdx=TABS.indexOf(tab);
  if(!direction) direction=nextIdx>prevIdx?'right':'left';
  document.querySelectorAll('.tab').forEach(t=>{
    t.classList.remove('active','slide-left','slide-right');
  });
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  const tabEl=document.getElementById('tab-'+tab);
  tabEl.classList.add('active');
  // Force reflow pour redéclencher l'animation
  void tabEl.offsetWidth;
  tabEl.classList.add(direction==='left'?'slide-left':'slide-right');
  document.getElementById('nav-'+tab).classList.add('active');
  currentTab=tab;
  renderTab(tab);
  // Scroll up
  document.querySelector('.content')?.scrollTo(0,0);
}

function saveBgNotes(){S.bgNotes=document.getElementById('bg-notes').value;save();}

// ══ STAT TEMP MODS ══
function adjStatMod(k,delta){
  if(!S.statMods)S.statMods={};
  S.statMods[k]=(S.statMods[k]||0)+delta;
  save();renderStats();renderSkillSections();renderTrackers();renderMPDots();
}
function adjMPMod(delta){
  S.mp.modMax=(S.mp.modMax||0)+delta;
  S.mp.current=Math.min(S.mp.current,mpMax());
  save();renderTrackers();renderMPDots();
}

// ══ SKILL CHECKS ══
function toggleSkillCheck(n,type){
  if(!S.skillSuccesses)S.skillSuccesses={};
  const c=S.skillSuccesses[n]||{s:false,f:false};
  S.skillSuccesses[n]={...c,[type]:!c[type]};
  save();renderSkillSections();
}

// ══ HISTORIQUE ══
function getHistory(){return JSON.parse(localStorage.getItem('mythras_hist_'+activeCharId)||'[]');}
function setHistory(h){localStorage.setItem('mythras_hist_'+activeCharId,JSON.stringify(h));}

function saveCheckpoint(){
  const now=new Date();
  const label=now.toLocaleDateString('fr-FR')+' '+now.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
  const hist=getHistory();
  // Snapshot léger : pas les dessins (gérés par IDB séparément)
  const snap=JSON.parse(JSON.stringify(S));
  (snap.pages||[]).forEach(p=>{delete p._pendingDrawing;});
  hist.unshift({ts:now.getTime(),label,snap:JSON.stringify(snap)});
  setHistory(hist.slice(0,5));
  renderHistory();
  const el=document.getElementById('save-ind');
  if(el){el.textContent='📌 Point sauvegardé';el.style.opacity='1';el.style.color='var(--green)';clearTimeout(el._t);el._t=setTimeout(()=>{el.textContent='💾 Sauvegardé';el.style.opacity='0';},2000);}
}

function restoreCheckpoint(idx){
  const hist=getHistory();
  if(!hist[idx]) return;
  if(!confirm('Restaurer ce point de sauvegarde ? Les modifications actuelles seront perdues.')) return;
  Object.assign(S,migrateState(JSON.parse(hist[idx].snap)));
  save();renderHeader();renderTab(currentTab);
}

function renderHistory(){
  const c=document.getElementById('history-list');if(!c)return;
  const hist=getHistory();
  if(!hist.length){c.innerHTML='<div style="color:var(--muted);font-size:12px">Aucun point de sauvegarde</div>';return;}
  c.innerHTML=hist.map((h,i)=>`
    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-top:1px solid var(--border);gap:8px">
      <div>
        <div style="font-size:12px;font-weight:600">${esc(h.label)}</div>
        <div style="font-size:10px;color:var(--muted)">${esc(JSON.parse(h.snap).charName||'')}</div>
      </div>
      <button onclick="restoreCheckpoint(${i})" style="padding:5px 12px;border-radius:6px;border:1px solid var(--border);background:var(--card);color:var(--muted);font-size:11px;cursor:pointer;white-space:nowrap">Restaurer</button>
    </div>`).join('');
}

// ══ EXPORT ══
async function exportJSON(){
  // Inline les dessins depuis IDB pour produire un JSON portable
  const data=JSON.parse(JSON.stringify(S));
  for(const p of data.pages||[]){
    delete p._pendingDrawing;
    if(p.hasDrawing){
      try{p.drawing=await Drawings.get(activeCharId,p.id);}catch(e){p.drawing=null;}
    } else {
      p.drawing=null;
    }
  }
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download=(S.charName||'perso').replace(/[^a-z0-9]/gi,'_')+'_mythras.json';
  a.click();URL.revokeObjectURL(url);
}

function exportText(){
  const L=(n,v)=>`${n}: ${v}\n`;
  const HR=(n)=>`\n${'═'.repeat(40)}\n ${n}\n${'═'.repeat(40)}\n`;
  const hr=(n)=>`\n── ${n} ${'─'.repeat(Math.max(0,36-n.length))}\n`;
  let t=`FICHE PERSONNAGE — MYTHRAS\n${'═'.repeat(40)}\n`;
  t+=`${S.charName}\n${S.charSubtitle}\n\n`;
  t+=HR('CARACTÉRISTIQUES');
  Object.entries(S.stats).forEach(([k,v])=>t+=`  ${k}: ${v}  `);t+='\n';
  t+=hr('Attributs Dérivés');
  S.derivedAttrs.forEach(a=>t+=`  ${a.name}: ${a.value}\n`);
  t+=HR('IDENTITÉ');
  S.identity.forEach(r=>t+=L('  '+r.key,r.val));
  t+=`\n  Argent: ${S.money.po} PO  ${S.money.pa} PA  ${S.money.rc} RC\n`;
  t+=HR('COMPÉTENCES');
  t+=hr('Résistances');
  [{name:'Brawn',formula:'STR+SIZ'},{name:'Endurance',formula:'CONx2'},{name:'Evade',formula:'DEXx2'},{name:'Willpower',formula:'POWx2'}].forEach(r=>{
    const tot=calcBase(r.formula)+(S.skillMods[r.name]||0);
    t+=`  ${r.name}: ${tot}%\n`;
  });
  t+=hr('Standard');
  S.stdSkills.forEach(s=>{const tot=calcBase(s.formula)+(S.skillMods[s.name]||0);t+=`  ${s.trained?'●':'○'} ${s.name}: ${tot}%\n`;});
  t+=hr('Professionnel');
  S.profSkills.forEach(s=>{const tot=calcBase(s.formula)+(S.skillMods[s.name]||0);t+=`  ● ${s.name}: ${tot}%\n`;});
  t+=hr('Magie');
  S.magicSkills.forEach(s=>{const tot=calcBase(s.formula)+(S.skillMods[s.name]||0);t+=`  ● ${s.name}: ${tot}%\n`;});
  t+=hr('Styles de combat');
  S.combatStyles.forEach(cs=>{const tot=calcBase(cs.formula)+(S.skillMods[cs.name]||0);t+=`  ${cs.name}: ${tot}% (${cs.weapons}) [${cs.trait}]\n`;});
  t+=HR('MAGIE');
  t+=hr('Folk Magic');
  S.folkSpells.forEach(s=>t+=`  ${s.name} (${s.cost}) — ${s.desc}\n`);
  t+=hr('Sorcellerie');
  S.sorcSpells.forEach(s=>t+=`  ${s.name} (${s.cost}) — ${s.desc}\n`);
  t+=HR('COMBAT');
  t+=hr('Points de vie');
  S.hitLocations.forEach(l=>t+=`  ${l.range} ${l.name}: ${l.currentHP}/${l.maxHP} PV${l.armor?'  🛡'+l.armor+' PA':''}\n`);
  t+=hr('Armes');
  S.weapons.forEach(w=>t+=`  ${w.name}: ${w.dmg} | Taille:${w.size} Portée:${w.range} AP/HP:${w.apHP}${w.effects?' | '+w.effects:''}\n`);
  t+=HR('PASSIONS & CAPACITÉS');
  S.passions.forEach(p=>t+=`  ${p.name}: ${p.pct}%\n`);
  t+='\n';S.abilities.forEach(a=>t+=`  • ${a}\n`);
  if(S.bgNotes){t+=HR('BACKGROUND');t+=S.bgNotes+'\n';}
  const activePages=(S.pages||[]).filter(p=>!p.archived);
  if(activePages.length){t+=HR('JOURNAL');activePages.forEach(p=>{t+=hr(p.title||'Page');if(p.content)t+=p.content+'\n';});}
  t+=`\n${'═'.repeat(40)}\nGénéré depuis Fiche Mythras\n`;
  const blob=new Blob([t],{type:'text/plain;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download=(S.charName||'perso').replace(/[^a-z0-9]/gi,'_')+'_mythras.txt';
  a.click();URL.revokeObjectURL(url);
}

// ══ CHAR MANAGER ══
function openCharMgr(){
  renderCharMgr();
  document.getElementById('char-mgr').style.display='flex';
}
function closeCharMgr(){
  document.getElementById('char-mgr').style.display='none';
}
function renderCharMgr(){
  const list=getCharList();
  document.getElementById('char-mgr-list').innerHTML=list.map(ch=>`
    <div class="char-card ${ch.id===activeCharId?'active':''}">
      <div style="flex:1;min-width:0">
        <div style="font-size:15px;font-weight:700;color:${ch.id===activeCharId?'var(--green)':'var(--text)'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(ch.name)}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(ch.subtitle||'')}</div>
        ${ch.id===activeCharId?'<div style="font-size:10px;color:var(--green);margin-top:4px">● Actif</div>':''}
      </div>
      <div style="display:flex;flex-direction:column;gap:5px;flex-shrink:0">
        ${ch.id!==activeCharId?`<button class="q-btn green" style="font-size:12px" onclick="switchChar('${esc(ch.id)}')">▶ Jouer</button>`:''}
        <button class="q-btn" style="font-size:12px" onclick="duplicateChar('${esc(ch.id)}')">⧉ Copier</button>
        <button class="q-btn red" style="font-size:12px" onclick="deleteChar('${esc(ch.id)}')">🗑</button>
      </div>
    </div>`).join('');
}
async function switchChar(id){
  save();
  activeCharId=id;
  localStorage.setItem('mythras_active_char',id);
  S=loadStateForChar(id);
  await migratePendingDrawings(id,S);
  await preloadDrawings(id,S);
  editMode=false;
  closeCharMgr();
  renderHeader();
  renderTab(currentTab);
}
function createChar(){
  const id='char_'+Date.now();
  const newS=JSON.parse(JSON.stringify(D));
  localStorage.setItem('mythras_char_'+id,JSON.stringify(newS));
  const list=getCharList();
  list.push({id,name:newS.charName,subtitle:newS.charSubtitle});
  setCharList(list);
  switchChar(id);
}
async function duplicateChar(id){
  const raw=localStorage.getItem('mythras_char_'+id);
  if(!raw)return;
  const newId='char_'+Date.now();
  const data=JSON.parse(raw);
  data.charName=data.charName+' (copie)';
  // Dupliquer aussi les dessins
  for(const p of data.pages||[]){
    if(p.hasDrawing){
      try{
        const d=await Drawings.get(id,p.id);
        if(d) await Drawings.set(newId,p.id,d);
      }catch(e){console.error(e);}
    }
  }
  localStorage.setItem('mythras_char_'+newId,JSON.stringify(data));
  const list=getCharList();
  list.push({id:newId,name:data.charName,subtitle:data.charSubtitle||''});
  setCharList(list);
  renderCharMgr();
}
async function deleteChar(id){
  const list=getCharList();
  if(list.length<=1){alert('Impossible de supprimer le seul personnage.');return;}
  if(!confirm('Supprimer ce personnage définitivement ?'))return;
  const newList=list.filter(c=>c.id!==id);
  setCharList(newList);
  localStorage.removeItem('mythras_char_'+id);
  localStorage.removeItem('mythras_hist_'+id);
  try{await Drawings.delChar(id);}catch(e){console.error(e);}
  if(activeCharId===id) switchChar(newList[0].id);
  else renderCharMgr();
}
async function doImportChar(input){
  const file=input.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=async e=>{
    try{
      const raw=JSON.parse(e.target.result);
      const cleaned=sanitizeImported(raw);
      const id='char_'+Date.now();
      // Extraire les dessins importés vers IDB
      const pendingDrawings=[];
      (cleaned.pages||[]).forEach(p=>{
        if(p.drawing){pendingDrawings.push({pageId:p.id,data:p.drawing});p.drawing=null;p.hasDrawing=true;}
      });
      const migrated=migrateState(cleaned);
      // Stocker les dessins dans IDB
      for(const pd of pendingDrawings){
        try{await Drawings.set(id,pd.pageId,pd.data);}catch(err){console.error('Drawing import failed:',err);}
      }
      try{
        localStorage.setItem('mythras_char_'+id, JSON.stringify(migrated));
      }catch(q){alert('Stockage insuffisant pour importer.');return;}
      const list=getCharList();
      list.push({id,name:migrated.charName||'Importé',subtitle:migrated.charSubtitle||''});
      setCharList(list);
      closeCharMgr();
      switchChar(id);
    }catch(err){alert('Fichier JSON invalide : '+err.message);}
  };
  reader.readAsText(file);
  input.value='';
}

// ══ DICE ROLLER ══
const DICE_TYPES = [
  {faces:4,  icon:'🔺', label:'d4'},
  {faces:6,  icon:'⬡',  label:'d6'},
  {faces:8,  icon:'◆',  label:'d8'},
  {faces:10, icon:'🔷', label:'d10'},
  {faces:12, icon:'⬟',  label:'d12'},
  {faces:20, icon:'🔸', label:'d20'},
  {faces:100,icon:'💯', label:'d100'},
  {faces:3,  icon:'▲',  label:'d3'},
];
let DC = {type:20, count:1, mod:0, history:[]};

function initDiceTab(){
  const g=document.getElementById('dice-type-grid');
  if(!g)return;
  g.innerHTML=DICE_TYPES.map(d=>`
    <button class="die-btn${DC.type===d.faces?' sel':''}" onclick="selectDie(${d.faces})">
      <span class="die-icon">${d.icon}</span>
      <span>${d.label}</span>
    </button>`).join('');
  document.getElementById('dice-count-val').textContent=DC.count;
  document.getElementById('dice-mod-val').textContent=(DC.mod>=0?'+':'')+DC.mod;
  renderDiceHistory();
}

function selectDie(faces){
  DC.type=faces;
  initDiceTab();
}

function adjDice(what,delta){
  if(what==='count') DC.count=Math.max(1,Math.min(10,DC.count+delta));
  else DC.mod=Math.max(-20,Math.min(20,DC.mod+delta));
  document.getElementById('dice-count-val').textContent=DC.count;
  document.getElementById('dice-mod-val').textContent=(DC.mod>=0?'+':'')+DC.mod;
}

function rollDice(){
  const btn=document.getElementById('roll-btn');
  btn.classList.add('rolling');
  setTimeout(()=>btn.classList.remove('rolling'),420);

  const rolls=[];
  for(let i=0;i<DC.count;i++) rolls.push(Math.floor(Math.random()*DC.type)+1);
  const rawSum=rolls.reduce((a,b)=>a+b,0);
  const total=rawSum+DC.mod;

  const area=document.getElementById('dice-result-area');
  const dieName=DICE_TYPES.find(d=>d.faces===DC.type)?.label||'d'+DC.type;
  const modStr=DC.mod!==0?(DC.mod>0?' + '+DC.mod:' − '+Math.abs(DC.mod)):'';

  area.innerHTML=`<div class="dice-faces">${rolls.map(()=>`<div class="die-face">…</div>`).join('')}</div>`;

  let tick=0;
  const spin=setInterval(()=>{
    const faces=area.querySelector('.dice-faces');
    if(!faces){clearInterval(spin);return;}
    faces.innerHTML=rolls.map(()=>`<div class="die-face">${Math.floor(Math.random()*DC.type)+1}</div>`).join('');
    tick++;
    if(tick>=6){
      clearInterval(spin);
      showDiceResult(area, rolls, total, dieName, modStr);
    }
  },60);

  DC.history.unshift({dice:`${DC.count}${dieName}${modStr}`, rolls, total, ts:Date.now()});
  if(DC.history.length>12) DC.history.pop();
  renderDiceHistory();
}

function showDiceResult(area, rolls, total, dieName, modStr){
  const isCrit=DC.type>=10&&rolls.some(r=>r===DC.type);
  const isFumble=DC.type>=10&&rolls.some(r=>r===1);
  const faceClass=isCrit?'crit':isFumble?'fumble':'';

  area.innerHTML=`
    <div class="dice-faces">${rolls.map((r,i)=>`<div class="die-face ${faceClass}" style="animation-delay:${i*60}ms">${r}</div>`).join('')}</div>
    <div class="dice-total" style="animation-delay:${rolls.length*60}ms">${total}</div>
    <div class="dice-total-label">${DC.count}${dieName}${modStr}${isCrit?' ✨ Critique!':isFumble?' 💀 Fumble!':''}</div>
  `;
}

function renderDiceHistory(){
  const el=document.getElementById('dice-history');
  if(!el)return;
  if(!DC.history.length){el.innerHTML='<div style="color:var(--muted);font-size:12px">Aucun lancer</div>';return;}
  el.innerHTML=DC.history.map(h=>`
    <div class="dice-hist-row">
      <span class="dice-hist-dice">${esc(h.dice)}</span>
      <span class="dice-hist-rolls">[${h.rolls.join(', ')}]</span>
      <span class="dice-hist-total">${h.total}</span>
    </div>`).join('');
}

function clearDiceHistory(){
  DC.history=[];
  renderDiceHistory();
}

// ══ SERVICE WORKER & UPDATE ══
let _swWaiting=null;
if('serviceWorker' in navigator){
  navigator.serviceWorker.register('./sw.js').then(reg=>{
    if(reg.waiting) showUpdateBanner(reg.waiting);
    reg.addEventListener('updatefound',()=>{
      const nw=reg.installing;
      nw.addEventListener('statechange',()=>{
        if(nw.state==='installed'&&navigator.serviceWorker.controller) showUpdateBanner(nw);
      });
    });
  });
  navigator.serviceWorker.addEventListener('controllerchange',()=>location.reload());
}

function showUpdateBanner(worker){
  _swWaiting=worker;
  if(document.getElementById('update-banner')) return;
  const b=document.createElement('div');
  b.id='update-banner';
  b.style.cssText='position:fixed;bottom:64px;left:50%;transform:translateX(-50%);width:calc(100% - 32px);max-width:448px;background:var(--card2);border:1px solid var(--green-dim);border-radius:10px;padding:10px 14px;display:flex;justify-content:space-between;align-items:center;z-index:150;font-size:13px;gap:10px;box-shadow:0 4px 20px rgba(0,0,0,.4)';
  b.innerHTML='<span>✨ Nouvelle version disponible</span><button onclick="applyUpdate()" style="padding:6px 14px;border-radius:6px;border:1px solid var(--green-dim);background:rgba(61,255,170,.12);color:var(--green);font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap">Mettre à jour</button>';
  document.body.appendChild(b);
}

function applyUpdate(){
  if(_swWaiting) _swWaiting.postMessage({type:'SKIP_WAITING'});
}

async function forceUpdate(){
  if('serviceWorker' in navigator){
    const reg=await navigator.serviceWorker.getRegistration();
    if(reg) await reg.unregister();
  }
  const keys=await caches.keys();
  await Promise.all(keys.map(k=>caches.delete(k)));
  location.reload(true);
}

// ══ SWIPE ENTRE ONGLETS — avec garde sur éléments interactifs ══
(function(){
  let sx=0,sy=0,active=false;
  // Sélecteurs pour lesquels le swipe est ignoré (sliders, drag handles, canvas, range, etc.)
  const NOSWIPE='input,textarea,select,canvas,.drag-handle,.draw-canvas,.canvas-wrap,[data-noswipe]';
  function isInteractive(el){
    if(!el||!el.closest)return false;
    return !!el.closest(NOSWIPE);
  }
  document.addEventListener('DOMContentLoaded',()=>{
    const content=document.querySelector('.content');
    content.addEventListener('touchstart',e=>{
      if(isInteractive(e.target)){active=false;return;}
      sx=e.touches[0].clientX;sy=e.touches[0].clientY;active=true;
    },{passive:true});
    content.addEventListener('touchend',e=>{
      if(!active)return;
      active=false;
      if(isInteractive(e.target)) return;
      const dx=e.changedTouches[0].clientX-sx;
      const dy=Math.abs(e.changedTouches[0].clientY-sy);
      if(Math.abs(dx)<60||dy>80) return;
      const cur=TABS.indexOf(currentTab);
      const next=dx<0?Math.min(cur+1,TABS.length-1):Math.max(cur-1,0);
      if(next!==cur) showTab(TABS[next], dx<0?'right':'left');
    },{passive:true});
  });
})();

// ══ INIT ══
document.addEventListener('DOMContentLoaded',async()=>{
  renderHeader();
  // Migration des dessins inline → IndexedDB pour le perso actif
  try{
    await migratePendingDrawings(activeCharId,S);
    await preloadDrawings(activeCharId,S);
  }catch(e){console.error('Drawings init failed:',e);}
  renderTab(currentTab);
});
