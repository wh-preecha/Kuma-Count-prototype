/* Auto Reconcile & Daily Stock Cycle Count
   Runs entirely in the browser. Data is stored locally on this device. */
(() => {
  'use strict';

  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const esc = (v) => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const num = (v) => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    let s = String(v ?? '').trim().replace(/[,$฿\s]/g, '');
    if (/^\(.*\)$/.test(s)) s = `-${s.slice(1, -1)}`;
    const n = Number(s); return Number.isFinite(n) ? n : 0;
  };
  const fmt = (v, d = 0) => num(v).toLocaleString('th-TH', {maximumFractionDigits:d, minimumFractionDigits:d});
  const money = (v) => `฿${Math.abs(num(v)).toLocaleString('th-TH', {maximumFractionDigits:0})}`;
  const today = () => new Date().toISOString().slice(0, 10);
  const dateTH = (d = new Date()) => new Intl.DateTimeFormat('th-TH', {day:'numeric',month:'short',year:'numeric'}).format(d);
  const keyText = (o) => [o.code,o.synnexId,o.brand,o.desc,o.group].join(' ').toLowerCase();
  const byId = (id) => document.getElementById(id);
  const storage = {master:'arcc_master_v3', counts:'arcc_counts_v3', history:'arcc_history_v3'};
  const readStore = (k, fallback) => { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } };
  const writeStore = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.warn(e); } };

  const state = {
    raw:{stocktake:[], inbound:[], outbound:[], master:[]}, items:[],
    masterEdits:readStore(storage.master, {}), counts:readStore(storage.counts, {}),
    history:readStore(storage.history, []), charts:{}, rawSource:'stocktake', countStrategy:'smart', fileName:'',
    plan:[]
  };

  if (window.Chart) {
    Chart.defaults.color = '#8298ae';
    Chart.defaults.borderColor = 'rgba(79,110,140,.2)';
    Chart.defaults.font.family = 'Segoe UI, Tahoma, sans-serif';
  }

  function toast(message, kind = 'ok') {
    let t = byId('toast');
    if (!t) { t = document.createElement('div'); t.id='toast'; document.body.appendChild(t); }
    t.textContent = message;
    Object.assign(t.style,{position:'fixed',right:'20px',bottom:'22px',zIndex:999,padding:'11px 16px',borderRadius:'10px',background:kind==='bad'?'#47212b':'#123b36',border:`1px solid ${kind==='bad'?'#844050':'#28675d'}`,color:'#fff',boxShadow:'0 12px 30px #0008',fontSize:'12px'});
    clearTimeout(t._timer); t._timer=setTimeout(()=>t.remove(),2800);
  }

  function switchTab(name) {
    $$('#tabs button[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    $$('.page').forEach(p => p.classList.toggle('active', p.id === `page-${name}`));
    render(name);
    window.scrollTo({top:0,behavior:'smooth'});
  }

  function render(name) {
    if (name === 'dashboard') renderDashboard();
    if (name === 'raw') renderRaw();
    if (name === 'master') renderMaster();
    if (name === 'summary') renderSummary();
    if (name === 'count') renderCount();
    if (name === 'compare') renderCompare();
    if (name === 'history') renderHistory();
  }

  const headers = {
    code:['stockcode','stock code','itemcode','item code','sku','material','productcode','product code','description'],
    synnexId:['synnexid','synnex id','barcode','partno','part no','code'],
    brand:['brand','vendor','maker'], desc:['productdescription','product description','description','itemname','item name','name'],
    group:['group','category','productgroup','product group'], cost:['cost','unitcost','unit cost','price','standardcost'],
    class:['class','abc','abcclass'], d365:['d365','erp','d365qty'], asrs:['asrs','asrsqty'],
    robot:['robot','robotminiload','miniload','robot qty'], onfloor:['onfloor','on floor','floor','onfloorqty'],
    qty:['qty','quantity','receiveqty','receive qty','salesqty','sales qty','outboundqty','inboundqty']
  };
  const norm = (v) => String(v ?? '').toLowerCase().replace(/[\r\n_-]/g,' ').replace(/\s+/g,' ').trim();
  function findColumn(row, aliases) {
    const clean = row.map(norm);
    for (const alias of aliases) { const i=clean.indexOf(norm(alias)); if (i>=0) return i; }
    for (const alias of aliases) { const i=clean.findIndex(x=>x.includes(norm(alias))); if (i>=0) return i; }
    return -1;
  }
  function detectHeader(rows) {
    let best=0, score=-1;
    rows.slice(0,30).forEach((r,i)=>{ const s=r.filter(v=>headers.code.some(a=>norm(v)===norm(a)||norm(v).includes(norm(a)))||headers.qty.some(a=>norm(v)===norm(a))).length; if(s>score){score=s;best=i;} });
    return best;
  }
  function rowsToObjects(rows, type) {
    if (!rows.length) return [];
    const hi=detectHeader(rows), h=rows[hi]||[];
    const idx={}; Object.keys(headers).forEach(k=>idx[k]=findColumn(h,headers[k]));
    if (type==='stocktake') { if(idx.d365<0)idx.d365=6;if(idx.asrs<0)idx.asrs=7;if(idx.robot<0)idx.robot=8;if(idx.onfloor<0)idx.onfloor=9; }
    return rows.slice(hi+1).map((r,n)=>{
      const code=String(r[idx.code]??'').trim(); if(!code)return null;
      const d365=num(r[idx.d365]), asrs=num(r[idx.asrs]), robot=num(r[idx.robot]);
      return {code,synnexId:String(r[idx.synnexId]??'').trim(),brand:String(r[idx.brand]??'').trim(),desc:String(r[idx.desc]??'').trim(),group:String(r[idx.group]??'').trim(),cost:num(r[idx.cost]),class:String(r[idx.class]??'').trim().toUpperCase(),d365,asrs,robot,onfloor:idx.onfloor>=0?num(r[idx.onfloor]):d365-asrs-robot,qty:num(r[idx.qty]),_row:n+hi+2};
    }).filter(Boolean);
  }
  function sheetType(name) {
    const n=norm(name); if(n.includes('stock')||n.includes('redbox')||n.includes('onhand'))return 'stocktake';
    if(n.includes('inbound')||n.includes('receive'))return 'inbound'; if(n.includes('outbound')||n.includes('sales'))return 'outbound'; if(n.includes('master'))return 'master'; return '';
  }
  async function importWorkbook(file) {
    if (!window.XLSX) return toast('ไม่สามารถโหลดตัวอ่าน Excel ได้ กรุณาเชื่อมต่ออินเทอร์เน็ตครั้งแรก', 'bad');
    try {
      const wb=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:true});
      state.raw={stocktake:[],inbound:[],outbound:[],master:[]};
      wb.SheetNames.forEach(name=>{const type=sheetType(name);if(!type)return;const rows=XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1,defval:'',raw:false});state.raw[type].push(...rowsToObjects(rows,type));});
      state.fileName=file.name; buildItems(); saveSnapshot(true); switchTab('dashboard'); toast(`นำเข้า ${fmt(state.items.length)} SKU เรียบร้อย`);
    } catch(e){console.error(e);toast(`อ่านไฟล์ไม่สำเร็จ: ${e.message}`,'bad');}
  }

  function aggregate(rows, qtyKey='qty') { const m={}; rows.forEach(r=>m[r.code]=(m[r.code]||0)+num(r[qtyKey])); return m; }
  function buildItems() {
    const inb=aggregate(state.raw.inbound), out=aggregate(state.raw.outbound), masters=new Map(state.raw.master.map(x=>[x.code,x]));
    const base=new Map(); [...state.raw.stocktake,...state.raw.inbound,...state.raw.outbound,...state.raw.master].forEach(x=>{if(!base.has(x.code))base.set(x.code,x);else base.set(x.code,{...base.get(x.code),...Object.fromEntries(Object.entries(x).filter(([,v])=>v!==''&&v!==0))});});
    state.items=[...base.values()].map(b=>{const m=masters.get(b.code)||{},edit=state.masterEdits[b.code]||{};const item={...b,...m,...edit,code:b.code,inbound:inb[b.code]||0,outbound:Math.abs(out[b.code]||0),cost:num(edit.cost??m.cost??b.cost),class:edit.class||m.class||b.class||'C',count:Object.prototype.hasOwnProperty.call(state.counts,b.code)?num(state.counts[b.code]):null};return enrich(item);});
    fillBrands(); createPlan(); updateStatus(); renderDashboard();
  }
  function enrich(i) {
    i.onfloor=Number.isFinite(num(i.onfloor))?num(i.onfloor):num(i.d365)-num(i.asrs)-num(i.robot);
    i.counted=i.count!==null&&i.count!==''; i.variance=i.counted?num(i.count)-i.onfloor:0; i.varianceValue=i.variance*num(i.cost); i.source=diagnose(i); return i;
  }
  function diagnose(i) {
    if(!i.counted||i.variance===0)return 'match';
    const tol=Math.max(1,Math.abs(i.variance)*.35);
    if(i.variance>0&&Math.abs(Math.abs(i.variance)-Math.abs(i.inbound))<=tol)return 'inbound';
    if(i.variance<0&&Math.abs(Math.abs(i.variance)-Math.abs(i.outbound))<=tol)return 'outbound';
    return 'system';
  }
  function updateStatus(){const el=byId('dataStatus');if(!el)return;el.textContent=state.items.length?`${fmt(state.items.length)} SKU · ${state.fileName||'พร้อมใช้งาน'}`:'ยังไม่มีข้อมูล';}
  function fillBrands(){const brands=[...new Set(state.items.map(x=>x.brand).filter(Boolean))].sort();['masterBrand','sumBrand','cmpBrand'].forEach(id=>{const el=byId(id);if(!el)return;const old=el.value;el.innerHTML=`<option value="">ทุก Brand</option>${brands.map(x=>`<option>${esc(x)}</option>`).join('')}`;el.value=old;});}

  function kpi(label,value,tone='accent',delta='') { return `<div class="kpi ${tone}"><div class="label">${label}</div><div class="val">${value}</div>${delta?`<div class="delta">${delta}</div>`:''}</div>`; }
  function metrics() {
    const counted=state.items.filter(x=>x.counted), diffs=counted.filter(x=>x.variance!==0), matches=counted.length-diffs.length;
    return {sku:state.items.length,onhand:state.items.reduce((s,x)=>s+x.onfloor,0),value:state.items.reduce((s,x)=>s+x.onfloor*x.cost,0),counted:counted.length,diffs:diffs.length,matches,accuracy:counted.length?matches/counted.length*100:0,varValue:diffs.reduce((s,x)=>s+Math.abs(x.varianceValue),0),positive:diffs.filter(x=>x.variance>0).reduce((s,x)=>s+x.varianceValue,0),negative:diffs.filter(x=>x.variance<0).reduce((s,x)=>s+x.varianceValue,0),inbound:state.items.reduce((s,x)=>s+x.inbound,0),outbound:state.items.reduce((s,x)=>s+x.outbound,0)};
  }
  function chart(id, config) { const canvas=byId(id);if(!canvas||!window.Chart)return;if(state.charts[id])state.charts[id].destroy();state.charts[id]=new Chart(canvas,config); }
  const chartOpts=(legend=true)=>({responsive:true,maintainAspectRatio:false,plugins:{legend:{display:legend,labels:{boxWidth:9,usePointStyle:true,font:{size:10}}}},scales:{x:{grid:{color:'rgba(55,83,109,.16)'}},y:{grid:{color:'rgba(55,83,109,.16)'},beginAtZero:true}}});

  function renderDashboard() {
    const m=metrics(), hist=state.history.slice(-14); byId('dashDate').textContent=`อัปเดต ${dateTH()} · ${new Date().toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'})}`;
    byId('dashKpis').innerHTML=[kpi('Inventory Accuracy',`${fmt(m.accuracy,1)}%`,m.accuracy>=98?'good':m.counted?'warn':'accent',m.counted?`${fmt(m.matches)} จาก ${fmt(m.counted)} SKU ตรง`:'รอผลการนับ'),kpi('Total On-floor',fmt(m.onhand),'accent',`${fmt(m.sku)} SKU ทั้งหมด`),kpi('Variance Items',fmt(m.diffs),m.diffs?'bad':'good',m.counted?`${fmt(m.diffs/Math.max(1,m.counted)*100,1)}% ของรายการที่นับ`:'ยังไม่มีรายการนับ'),kpi('Variance Value',money(m.varValue),m.varValue?'warn':'good','มูลค่าสัมบูรณ์รวม'),kpi('Count Progress',`${fmt(m.counted/Math.max(1,m.sku)*100,0)}%`,'purple',`${fmt(m.counted)} / ${fmt(m.sku)} SKU`)].join('');
    const locs=[['D365',state.items.reduce((s,x)=>s+x.d365,0)],['ASRS',state.items.reduce((s,x)=>s+x.asrs,0)],['Robot',state.items.reduce((s,x)=>s+x.robot,0)],['On-floor',m.onhand]],maxLoc=Math.max(1,...locs.map(x=>Math.abs(x[1])));
    byId('dashLocations').innerHTML=locs.map(([n,v])=>`<div class="location-row"><span>${n}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.min(100,Math.abs(v)/maxLoc*100)}%"></div></div><b class="num">${fmt(v)}</b></div>`).join('');
    chart('chartDashVariance',{type:'doughnut',data:{labels:['ตรง','เกิน','ขาด','ยังไม่นับ'],datasets:[{data:[m.matches,state.items.filter(x=>x.counted&&x.variance>0).length,state.items.filter(x=>x.counted&&x.variance<0).length,state.items.length-m.counted],backgroundColor:['#38d996','#ffb84d','#ff6072','#20364b'],borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,cutout:'68%',plugins:{legend:{position:'bottom',labels:{boxWidth:9,usePointStyle:true,font:{size:10}}}}}});
    byId('dashValueBreakdown').innerHTML=`<div class="metric-block positive"><span>เกิน (+)</span><strong>${money(m.positive)}</strong></div><div class="metric-block negative"><span>ขาด (−)</span><strong>${money(m.negative)}</strong></div>`;
    chart('chartDashValue',{type:'bar',data:{labels:['เกิน','ขาด'],datasets:[{data:[m.positive,Math.abs(m.negative)],backgroundColor:['#38d996','#ff6072'],borderRadius:7,barThickness:30}]},options:{...chartOpts(false),plugins:{legend:{display:false}}}});
    const hlabels=hist.map(x=>x.date.slice(5)), acc=hist.map(x=>x.accuracy), vv=hist.map(x=>x.varValue);
    chart('chartDashTrend',{type:'line',data:{labels:hlabels.length?hlabels:['วันนี้'],datasets:[{label:'Accuracy %',data:acc.length?acc:[m.accuracy],borderColor:'#28c8f5',backgroundColor:'rgba(40,200,245,.12)',fill:true,tension:.35,yAxisID:'y'},{label:'Variance Value',data:vv.length?vv:[m.varValue],borderColor:'#ffb84d',tension:.35,yAxisID:'y1'}]},options:{...chartOpts(),scales:{x:{grid:{display:false}},y:{beginAtZero:true,max:100,grid:{color:'rgba(55,83,109,.16)'}},y1:{beginAtZero:true,position:'right',grid:{display:false}}}}});
    const causes=['inbound','outbound','system'].map(s=>state.items.filter(x=>x.source===s).length);
    chart('chartDashCause',{type:'bar',data:{labels:['Inbound','Outbound','System / Count'],datasets:[{data:causes,backgroundColor:['#38d996','#ffb84d','#9a86ff'],borderRadius:7}]},options:{...chartOpts(false),indexAxis:'y',plugins:{legend:{display:false}}}});
    const top=state.items.filter(x=>x.counted&&x.variance!==0).sort((a,b)=>Math.abs(b.varianceValue)-Math.abs(a.varianceValue)).slice(0,8);
    table(byId('dashTopVariance'),['Stock Code','Description','Brand','Variance','Value','Cause'],top.map(x=>[x.code,x.desc||'—',x.brand||'—',signed(x.variance),money(x.varianceValue),sourcePill(x.source)]),[3,4]);
    const done=m.counted,total=Math.max(1,state.plan.length||m.sku),progress=Math.min(100,done/total*100);byId('dashToday').innerHTML=`<div class="today-ring" style="--progress:${progress}%"><strong>${fmt(progress)}%</strong></div><div class="today-stats"><div><b>${fmt(done)}</b>นับแล้ว</div><div><b>${fmt(Math.max(0,total-done))}</b>คงเหลือ</div><div><b>${fmt(m.diffs)}</b>พบ Diff</div></div>`;
    const high=top[0], repeats=repeatOffenders(), sugg=[];
    if(high)sugg.push(['!','ตรวจรายการมูลค่าผลต่างสูง',`${high.code} มีผลต่าง ${signed(high.variance)} คิดเป็น ${money(high.varianceValue)}`]);
    if(repeats[0])sugg.push(['↻','แก้ Repeat Offender',`${repeats[0].code} พบ Diff ซ้ำ ${repeats[0].days} วัน`]);
    if(state.items.length&&!m.counted)sugg.push(['✓','เริ่ม Daily Cycle Count','ระบบจัดลำดับรายการเสี่ยงไว้ให้แล้ว เลือก Daily Cycle Count เพื่อเริ่มนับ']);
    if(m.diffs)sugg.push(['⇄','ตรวจสอบ Movement ก่อนปรับยอด',`${causes[0]+causes[1]} รายการสัมพันธ์กับ Inbound / Outbound`]);
    if(!sugg.length)sugg.push(['●',state.items.length?'สถานะสต็อกปกติ':'นำเข้าข้อมูลเพื่อเริ่มวิเคราะห์',state.items.length?'ยังไม่พบประเด็นเร่งด่วนจากข้อมูลล่าสุด':'รองรับไฟล์ Excel ที่มี StockTake, Inbound, Outbound และ Master']);
    byId('dashSuggestions').innerHTML=sugg.slice(0,4).map(x=>`<div class="suggestion"><div class="ico">${x[0]}</div><div><b>${esc(x[1])}</b><small>${esc(x[2])}</small></div></div>`).join('');
  }

  function table(el, heads, rows, numeric=[]) { if(!el)return;el.innerHTML=`<thead><tr>${heads.map((h,i)=>`<th class="${numeric.includes(i)?'num':''}">${h}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.map(r=>`<tr>${r.map((v,i)=>`<td class="${numeric.includes(i)?'num':''}">${v??''}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${heads.length}" class="empty">ยังไม่มีข้อมูล</td></tr>`}</tbody>`; }
  const signed=(v)=>`${num(v)>0?'+':''}${fmt(v)}`;
  const sourcePill=(s)=>({inbound:'<span class="pill good">Inbound</span>',outbound:'<span class="pill warn">Outbound</span>',system:'<span class="pill bad">System / Count</span>',match:'<span class="pill good">ตรง</span>'}[s]||s);
  const matches=(x,q)=>!q||keyText(x).includes(q.toLowerCase());

  function renderRaw(){const rows=state.raw[state.rawSource]||[],q=byId('rawSearch').value.trim();byId('rawKpis').innerHTML=[kpi('StockTake Rows',fmt(state.raw.stocktake.length)),kpi('Inbound Qty',fmt(metrics().inbound),'good'),kpi('Outbound Qty',fmt(metrics().outbound),'warn'),kpi('Detected SKU',fmt(state.items.length),'purple')].join('');byId('filebar').innerHTML=state.fileName?`<div class="fileitem">✓ ${esc(state.fileName)} <span class="muted">${fmt(state.items.length)} SKU</span></div>`:'';byId('rawPreviewCard').style.display=rows.length?'block':'none';const filtered=rows.filter(x=>matches(x,q));byId('rawCount').textContent=`${fmt(filtered.length)} แถว`;table(byId('rawTable'),['Stock Code','Synnex ID','Brand','Description',state.rawSource==='stocktake'?'On-floor':'Qty'],filtered.slice(0,1000).map(x=>[esc(x.code),esc(x.synnexId),esc(x.brand),esc(x.desc),fmt(state.rawSource==='stocktake'?x.onfloor:x.qty)]),[4]);}

  function renderMaster(){const q=byId('masterSearch').value.trim(),brand=byId('masterBrand').value,cls=byId('masterClass').value;const rows=state.items.filter(x=>matches(x,q)&&(!brand||x.brand===brand)&&(!cls||x.class===cls));table(byId('masterTable'),['Stock Code','Description','Brand','On-floor','Cost','Class','Inventory Value'],rows.map(x=>[esc(x.code),esc(x.desc),esc(x.brand),fmt(x.onfloor),`<input class="master-cost" data-code="${esc(x.code)}" type="number" value="${x.cost}" style="width:90px">`,`<select class="master-class" data-code="${esc(x.code)}"><option ${x.class==='A'?'selected':''}>A</option><option ${x.class==='B'?'selected':''}>B</option><option ${x.class==='C'?'selected':''}>C</option></select>`,money(x.onfloor*x.cost)]),[3,4,6]);}
  function recalcABC(){const sorted=[...state.items].sort((a,b)=>b.onfloor*b.cost-a.onfloor*a.cost),total=sorted.reduce((s,x)=>s+Math.max(0,x.onfloor*x.cost),0);let cum=0;sorted.forEach(x=>{cum+=Math.max(0,x.onfloor*x.cost);const p=total?cum/total:1;x.class=p<=.8?'A':p<=.95?'B':'C';state.masterEdits[x.code]={...(state.masterEdits[x.code]||{}),class:x.class};});writeStore(storage.master,state.masterEdits);renderMaster();toast('คำนวณ ABC ใหม่แล้ว');}

  function filteredSummary(){const q=byId('sumSearch').value.trim(),brand=byId('sumBrand').value,f=byId('sumFilter').value,v=byId('sumVar').value;return state.items.filter(x=>matches(x,q)&&(!brand||x.brand===brand)&&(f==='all'||f==='counted'&&x.counted||f==='variance'&&x.counted&&x.variance!==0||f==='uncounted'&&!x.counted)&&(!v||v==='has'&&x.counted&&x.variance!==0||v==='pos'&&x.variance>0||v==='neg'&&x.variance<0||v==='match'&&x.counted&&x.variance===0));}
  function renderSummary(){const m=metrics();byId('sumKpis').innerHTML=[kpi('Counted',fmt(m.counted),'accent'),kpi('Accuracy',`${fmt(m.accuracy,1)}%`,m.accuracy>=98?'good':'warn'),kpi('Variance SKU',fmt(m.diffs),m.diffs?'bad':'good'),kpi('Variance Value',money(m.varValue),'warn')].join('');chart('chartAcc',{type:'doughnut',data:{labels:['ตรง','มีผลต่าง'],datasets:[{data:[m.matches,m.diffs],backgroundColor:['#38d996','#ff6072'],borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,cutout:'70%'}});chart('chartSrc',{type:'bar',data:{labels:['Inbound','Outbound','System / Count'],datasets:[{data:['inbound','outbound','system'].map(s=>state.items.filter(x=>x.source===s).length),backgroundColor:['#38d996','#ffb84d','#9a86ff'],borderRadius:7}]},options:{...chartOpts(false),plugins:{legend:{display:false}}}});const rows=filteredSummary();table(byId('reconTable'),['Stock Code','Description','Brand','D365','ASRS','Robot','On-floor','Count','Variance','Value','Diagnosis'],rows.map(x=>[esc(x.code),esc(x.desc),esc(x.brand),fmt(x.d365),fmt(x.asrs),fmt(x.robot),fmt(x.onfloor),x.counted?fmt(x.count):'—',x.counted?signed(x.variance):'—',x.counted?money(x.varianceValue):'—',x.counted?sourcePill(x.source):'<span class="pill mut">ยังไม่นับ</span>']),[3,4,5,6,7,8,9]);}

  function riskScore(x,strategy='smart'){const val=Math.abs(x.onfloor*x.cost),move=Math.abs(x.inbound)+Math.abs(x.outbound),anom=Math.abs(x.d365-(x.asrs+x.robot+x.onfloor)),never=x.counted?0:50;if(strategy==='value')return val;if(strategy==='movement')return move;if(strategy==='nomove')return move===0?val+100000:0;if(strategy==='anomaly')return anom*1000+Math.abs(x.varianceValue);return (x.class==='A'?90:x.class==='B'?50:20)+Math.log10(val+1)*14+Math.log10(move+1)*12+anom*10+never+Math.abs(x.varianceValue)/100;}
  function createPlan(){const n=Math.max(1,num(byId('planQty')?.value||30));state.plan=[...state.items].sort((a,b)=>riskScore(b,state.countStrategy)-riskScore(a,state.countStrategy)).slice(0,n);}
  function renderCount(){createPlan();const q=byId('countSearch').value.trim(),rows=state.plan.filter(x=>matches(x,q)),done=state.plan.filter(x=>x.counted).length,pct=state.plan.length?done/state.plan.length*100:0;byId('todayBadge').textContent=dateTH();byId('countProg').style.width=`${pct}%`;byId('countProgTxt').textContent=`${done}/${state.plan.length} รายการ`;byId('countList').innerHTML=rows.length?rows.map(x=>`<div class="count-card"><div class="top"><div><div class="sc">${esc(x.code)}</div><div class="meta">${esc(x.desc||'—')} · ${esc(x.brand||'—')} · Class ${esc(x.class)}</div></div><span class="pill ${x.counted?(x.variance?'bad':'good'):'info'}">${x.counted?(x.variance?signed(x.variance):'ตรง'):'รอนับ'}</span></div><div class="locs"><div class="locbox"><div class="l">D365</div><div class="v">${fmt(x.d365)}</div></div><div class="locbox"><div class="l">ASRS</div><div class="v">${fmt(x.asrs)}</div></div><div class="locbox"><div class="l">ROBOT</div><div class="v">${fmt(x.robot)}</div></div><div class="locbox"><div class="l">ON-FLOOR</div><div class="v">${fmt(x.onfloor)}</div></div></div><div class="count-input"><label class="fld">Count จริง<input class="count-value" data-code="${esc(x.code)}" type="number" step="any" value="${x.counted?x.count:''}" placeholder="—"></label><span class="muted mini">กด Enter เพื่อบันทึก</span></div></div>`).join(''):'<div class="empty">ไม่พบรายการในแผนวันนี้</div>';}
  function saveCount(code,value){if(value===''){delete state.counts[code];}else state.counts[code]=num(value);writeStore(storage.counts,state.counts);const x=state.items.find(i=>i.code===code);if(x){x.count=value===''?null:num(value);enrich(x);}saveSnapshot(true);renderCount();}

  function getSwaps(){const d=state.items.filter(x=>x.counted&&x.variance!==0),out=[];for(let i=0;i<d.length;i++)for(let j=i+1;j<d.length;j++){const a=d[i],b=d[j];if(a.variance===-b.variance&&(a.brand===b.brand||a.group&&a.group===b.group))out.push({a,b,qty:Math.abs(a.variance)});}return out;}
  function renderCompare(){const m=metrics(),swaps=getSwaps(),q=byId('cmpSearch').value.trim(),brand=byId('cmpBrand').value,src=byId('cmpSrc').value;byId('cmpKpis').innerHTML=[kpi('Variance Items',fmt(m.diffs),'bad'),kpi('Inbound Related',fmt(state.items.filter(x=>x.source==='inbound').length),'good'),kpi('Outbound Related',fmt(state.items.filter(x=>x.source==='outbound').length),'warn'),kpi('Possible Swap',fmt(swaps.length),'purple')].join('');const rows=state.items.filter(x=>x.counted&&x.variance!==0&&matches(x,q)&&(!brand||x.brand===brand)&&(!src||(src==='swap'?swaps.some(s=>s.a===x||s.b===x):x.source===src)));table(byId('cmpTable'),['Stock Code','Description','Brand','On-floor','Count','Variance','Inbound','Outbound','Value','Diagnosis'],rows.map(x=>[esc(x.code),esc(x.desc),esc(x.brand),fmt(x.onfloor),fmt(x.count),signed(x.variance),fmt(x.inbound),fmt(x.outbound),money(x.varianceValue),sourcePill(x.source)]),[3,4,5,6,7,8]);table(byId('swapTable'),['Item A','Variance A','Item B','Variance B','Brand / Group','คำแนะนำ'],swaps.map(s=>[esc(s.a.code),signed(s.a.variance),esc(s.b.code),signed(s.b.variance),esc(s.a.brand||s.a.group),'ตรวจตำแหน่งจัดเก็บ / การสแกน']),[1,3]);}

  function snapshot(){const m=metrics();return {date:today(),savedAt:new Date().toISOString(),sku:m.sku,onhand:m.onhand,counted:m.counted,matches:m.matches,diffs:m.diffs,accuracy:m.accuracy,varValue:m.varValue,inbound:m.inbound,outbound:m.outbound,items:state.items.map(x=>({code:x.code,desc:x.desc,brand:x.brand,onfloor:x.onfloor,inbound:x.inbound,outbound:x.outbound,count:x.count,variance:x.counted?x.variance:null,varianceValue:x.counted?x.varianceValue:null,source:x.source}))};}
  function saveSnapshot(silent=false){if(!state.items.length){if(!silent)toast('ยังไม่มีข้อมูลสำหรับบันทึก','bad');return;}const s=snapshot(),i=state.history.findIndex(x=>x.date===s.date);if(i>=0)state.history[i]=s;else state.history.push(s);state.history=state.history.sort((a,b)=>a.date.localeCompare(b.date)).slice(-120);writeStore(storage.history,state.history);if(!silent)toast('บันทึก Snapshot วันนี้แล้ว');}
  function repeatOffenders(){const map={};state.history.forEach(h=>(h.items||[]).forEach(x=>{if(x.variance){const e=map[x.code]||{code:x.code,desc:x.desc,brand:x.brand,days:0,last:0,value:0};e.days++;e.last=x.variance;e.value+=Math.abs(num(x.varianceValue));map[x.code]=e;}}));return Object.values(map).filter(x=>x.days>=2).sort((a,b)=>b.days-a.days||b.value-a.value);}
  function renderHistory(){const h=state.history,m=h[h.length-1]||metrics();byId('histDays').textContent=`${h.length} วัน`;byId('histKpis').innerHTML=[kpi('Days Recorded',fmt(h.length)),kpi('Latest Accuracy',`${fmt(m.accuracy,1)}%`,'good'),kpi('Latest Variance SKU',fmt(m.diffs),'bad'),kpi('Latest Variance Value',money(m.varValue),'warn')].join('');const labels=h.map(x=>x.date.slice(5));chart('chartTrendAcc',{type:'line',data:{labels,datasets:[{label:'Accuracy %',data:h.map(x=>x.accuracy),borderColor:'#28c8f5',backgroundColor:'rgba(40,200,245,.12)',fill:true,tension:.35}]},options:chartOpts()});chart('chartTrendFlow',{type:'bar',data:{labels,datasets:[{label:'Inbound',data:h.map(x=>x.inbound),backgroundColor:'#38d996'},{label:'Outbound',data:h.map(x=>x.outbound),backgroundColor:'#ffb84d'}]},options:chartOpts()});chart('chartTrendVarCnt',{type:'line',data:{labels,datasets:[{label:'Variance SKU',data:h.map(x=>x.diffs),borderColor:'#ff6072',tension:.35}]},options:chartOpts()});chart('chartTrendVarVal',{type:'bar',data:{labels,datasets:[{label:'Variance Value',data:h.map(x=>x.varValue),backgroundColor:'#9a86ff',borderRadius:6}]},options:chartOpts()});const reps=repeatOffenders();table(byId('repeatTable'),['Stock Code','Description','Brand','วันที่พบ Diff','Diff ล่าสุด','มูลค่ารวม'],reps.map(x=>[esc(x.code),esc(x.desc),esc(x.brand),fmt(x.days),signed(x.last),money(x.value)]),[3,4,5]);table(byId('dailyTable'),['วันที่','SKU','On-floor','Counted','Accuracy','Variance SKU','Variance Value','Inbound','Outbound'],[...h].reverse().map(x=>[x.date,fmt(x.sku),fmt(x.onhand),fmt(x.counted),`${fmt(x.accuracy,1)}%`,fmt(x.diffs),money(x.varValue),fmt(x.inbound),fmt(x.outbound)]),[1,2,3,4,5,6,7,8]);renderTrace();}
  function renderTrace(){const q=byId('traceSearch').value.trim().toLowerCase(),el=byId('traceResult');if(!q){el.innerHTML='<div class="empty">พิมพ์รหัสสินค้าเพื่อดูประวัติรายวัน (onhand / รับเข้า / จ่ายออก / ดิฟ)</div>';return;}let found=[];state.history.forEach(h=>(h.items||[]).forEach(x=>{if(keyText(x).includes(q))found.push({...x,date:h.date});}));found=found.slice(-200).reverse();if(!found.length){el.innerHTML='<div class="empty">ไม่พบประวัติรายการนี้</div>';return;}el.innerHTML='<div class="tblwrap"><table id="traceTable"></table></div>';table(byId('traceTable'),['วันที่','Stock Code','Description','On-floor','Inbound','Outbound','Count','Variance','Value'],found.map(x=>[x.date,esc(x.code),esc(x.desc),fmt(x.onfloor),fmt(x.inbound),fmt(x.outbound),x.count==null?'—':fmt(x.count),x.variance==null?'—':signed(x.variance),x.varianceValue==null?'—':money(x.varianceValue)]),[3,4,5,6,7,8]);}

  function exportRows(name,rows){if(!window.XLSX)return toast('ไม่สามารถโหลดตัวส่งออก Excel ได้','bad');const ws=XLSX.utils.json_to_sheet(rows),wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Data');XLSX.writeFile(wb,`${name}_${today()}.xlsx`);}
  function exportHistory(){if(!state.history.length)return toast('ยังไม่มีประวัติ','bad');const wb=XLSX.utils.book_new(),daily=state.history.map(({items,...x})=>x),detail=state.history.flatMap(h=>(h.items||[]).map(x=>({date:h.date,...x})));XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(daily),'Daily Summary');XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(detail),'Item History');XLSX.writeFile(wb,`Auto_Reconcile_History_${today()}.xlsx`);}
  async function importHistory(file){try{if(file.name.toLowerCase().endsWith('.json'))state.history=JSON.parse(await file.text());else{const wb=XLSX.read(await file.arrayBuffer(),{type:'array'}),daily=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]),detail=wb.SheetNames[1]?XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[1]]):[];state.history=daily.map(d=>({...d,items:detail.filter(x=>x.date===d.date)}));}writeStore(storage.history,state.history);renderHistory();toast('นำเข้าประวัติเรียบร้อย');}catch(e){toast(`นำเข้าประวัติไม่สำเร็จ: ${e.message}`,'bad');}}

  function bind() {
    byId('tabs').addEventListener('click',e=>{const b=e.target.closest('button[data-tab]');if(b)switchTab(b.dataset.tab);});
    const dz=byId('dropzone'),fi=byId('fileInput');dz.addEventListener('click',()=>fi.click());fi.addEventListener('change',()=>fi.files[0]&&importWorkbook(fi.files[0]));['dragenter','dragover'].forEach(n=>dz.addEventListener(n,e=>{e.preventDefault();dz.classList.add('drag');}));['dragleave','drop'].forEach(n=>dz.addEventListener(n,e=>{e.preventDefault();dz.classList.remove('drag');}));dz.addEventListener('drop',e=>e.dataTransfer.files[0]&&importWorkbook(e.dataTransfer.files[0]));
    byId('rawSeg').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;state.rawSource=b.dataset.src;$$('#rawSeg button').forEach(x=>x.classList.toggle('active',x===b));renderRaw();});
    ['rawSearch'].forEach(id=>byId(id).addEventListener('input',renderRaw));
    ['masterSearch','masterBrand','masterClass'].forEach(id=>byId(id).addEventListener(id==='masterSearch'?'input':'change',renderMaster));
    byId('masterTable').addEventListener('change',e=>{const code=e.target.dataset.code;if(!code)return;const edit=state.masterEdits[code]||{};if(e.target.classList.contains('master-cost'))edit.cost=num(e.target.value);if(e.target.classList.contains('master-class'))edit.class=e.target.value;state.masterEdits[code]=edit;writeStore(storage.master,state.masterEdits);buildItems();renderMaster();});
    byId('recalcABC').addEventListener('click',recalcABC);
    ['sumSearch','sumBrand','sumFilter','sumVar'].forEach(id=>byId(id).addEventListener(id==='sumSearch'?'input':'change',renderSummary));
    byId('countStrategy').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;state.countStrategy=b.dataset.s;$$('#countStrategy button').forEach(x=>x.classList.toggle('active',x===b));renderCount();});
    byId('regenPlan').addEventListener('click',()=>{createPlan();renderCount();toast('สร้างแผน Cycle Count ใหม่แล้ว');});byId('planQty').addEventListener('change',renderCount);byId('countSearch').addEventListener('input',renderCount);
    byId('countList').addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.classList.contains('count-value')){saveCount(e.target.dataset.code,e.target.value);}});byId('countList').addEventListener('change',e=>{if(e.target.classList.contains('count-value'))saveCount(e.target.dataset.code,e.target.value);});
    ['cmpSearch','cmpBrand','cmpSrc'].forEach(id=>byId(id).addEventListener(id==='cmpSearch'?'input':'change',renderCompare));
    ['saveSnapshot','histSaveNow'].forEach(id=>byId(id).addEventListener('click',()=>{saveSnapshot();renderDashboard();}));
    byId('mobileToggle').addEventListener('click',()=>document.body.classList.toggle('mobile'));
    byId('traceSearch').addEventListener('input',renderTrace);byId('histExport').addEventListener('click',exportHistory);byId('histImport').addEventListener('click',()=>byId('histImportFile').click());byId('histImportFile').addEventListener('change',()=>byId('histImportFile').files[0]&&importHistory(byId('histImportFile').files[0]));
    byId('histClear').addEventListener('click',()=>{if(confirm('ล้างประวัติทั้งหมดในเครื่องนี้หรือไม่?')){state.history=[];writeStore(storage.history,[]);renderHistory();renderDashboard();toast('ล้างประวัติแล้ว');}});
    byId('exportMaster').addEventListener('click',()=>exportRows('Item_Master',state.items.map(x=>({StockCode:x.code,SynnexID:x.synnexId,Description:x.desc,Brand:x.brand,Class:x.class,Cost:x.cost,Onfloor:x.onfloor}))));
    byId('exportRecon').addEventListener('click',()=>exportRows('Reconcile',filteredSummary().map(x=>({StockCode:x.code,Description:x.desc,Brand:x.brand,D365:x.d365,ASRS:x.asrs,Robot:x.robot,Onfloor:x.onfloor,Count:x.count,Variance:x.counted?x.variance:'',VarianceValue:x.counted?x.varianceValue:'',Diagnosis:x.source}))));
    byId('exportCmp').addEventListener('click',()=>exportRows('Compare_Tracking',state.items.filter(x=>x.counted&&x.variance).map(x=>({StockCode:x.code,Description:x.desc,Brand:x.brand,Onfloor:x.onfloor,Count:x.count,Variance:x.variance,Inbound:x.inbound,Outbound:x.outbound,VarianceValue:x.varianceValue,Diagnosis:x.source}))));
    byId('dailyExport').addEventListener('click',()=>exportRows('Daily_Log',state.history.map(({items,...x})=>x)));
  }

  bind(); updateStatus(); renderDashboard();
})();
