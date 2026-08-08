const D = window.TOKEN_DATA;
const days = D.days.filter(d => d.tokens > 0);
const fmt = n => n.toLocaleString('en-US');
const fmtT = n => n >= 1e9 ? (n/1e9).toFixed(2)+'B' : n >= 1e6 ? (n/1e6).toFixed(1)+'M' : n >= 1e3 ? (n/1e3).toFixed(1)+'K' : String(n);
const usd = n => '$' + n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const tip = document.getElementById('tip');

// Editorial role colors (match DESIGN.md, no neon).
const TOKKEYS = ['input','cacheRead','cacheWrite','output','reasoning'];
const TOKCOL = {input:'var(--s-input)',cacheRead:'var(--s-cread)',cacheWrite:'var(--s-cwrite)',output:'var(--s-out)',reasoning:'var(--s-reason)'};

// ISO week key (Monday start).
function weekKey(dateStr){
  const dt = new Date(dateStr + 'T00:00:00Z');
  const day = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - day);
  return dt.toISOString().slice(0,10);
}

// Bucket days (or today's hours) by period.
function bucketize(mode){
  if(mode==='hour'){
    return (D.hours||[]).map(h=>({
      key:h.hour, label:h.hour.slice(11,16),
      tokens:h.tokens, cost:h.cost, messages:h.messages,
      input:h.input, output:h.output, cacheRead:h.cacheRead, cacheWrite:h.cacheWrite, reasoning:h.reasoning,
    })).sort((a,b)=>a.key<b.key?-1:1);
  }
  const map = new Map();
  for(const d of days){
    let key,label;
    if(mode==='day'){ key=d.date; label=d.date.slice(5); }
    else if(mode==='week'){ key=weekKey(d.date); label=key.slice(5); }
    else { key=d.date.slice(0,7); label=key; }
    if(!map.has(key)) map.set(key,{key,label,tokens:0,cost:0,messages:0,input:0,output:0,cacheRead:0,cacheWrite:0,reasoning:0});
    const b=map.get(key);
    b.tokens+=d.tokens; b.cost+=d.cost; b.messages+=d.messages;
    for(const k of TOKKEYS) b[k]+=d[k];
  }
  return [...map.values()].sort((a,b)=>a.key<b.key?-1:1);
}

function sumBuckets(buckets){
  const acc={tokens:0,cost:0,messages:0,input:0,output:0,cacheRead:0,cacheWrite:0,reasoning:0};
  for(const b of buckets){ acc.tokens+=b.tokens; acc.cost+=b.cost; acc.messages+=b.messages; for(const k of TOKKEYS) acc[k]+=b[k]; }
  return acc;
}

// ---- focus surface + number group ----
// hour ("今日") sums all of today's hours; day/week/month show the latest bucket.
function currentBucket(buckets){
  const empty={tokens:0,cost:0,messages:0,input:0,output:0,cacheRead:0,cacheWrite:0,reasoning:0,label:'—'};
  if(!buckets.length) return empty;
  if(mode==='hour') return {...sumBuckets(buckets),label:(D.today||'今日')};
  return buckets[buckets.length-1] || empty;
}
function renderFocus(b){
  const scope={hour:'今日',day:'当日',week:'本周',month:'本月'}[mode];
  document.getElementById('focus').innerHTML=
    `<div class="f-block"><div class="f-label">${scope}用量</div><div class="f-num">${fmtT(b.tokens)}</div><div class="f-sub">${fmt(b.tokens)} tok · ${fmt(b.messages)} 消息</div></div>`+
    `<div class="f-block"><div class="f-label">${scope}成本</div><div class="f-cost">${usd(b.cost)}</div><div class="f-sub">${b.label}</div></div>`;
}
function renderNumbers(b){
  const items=[
    ['输入',b.input],['输出',b.output],['缓存读',b.cacheRead],['缓存写',b.cacheWrite],
  ];
  document.getElementById('numgroup').innerHTML=items.map(it=>
    `<div class="n"><div class="nv">${fmtT(it[1])}</div><div class="nl">${it[0]}</div><div class="ns">${fmt(it[1])}</div></div>`
  ).join('');
}

// ---- stacked bar chart ----
function niceMax(v){
  if(v<=0) return 1;
  const exp=Math.floor(Math.log10(v));
  const base=Math.pow(10,exp);
  const f=v/base;
  const nf = f<=1?1 : f<=2?2 : f<=2.5?2.5 : f<=5?5 : 10;
  return nf*base;
}
function renderChart(buckets){
  const el=document.getElementById('chart');
  if(!buckets.length){ el.className='chart'; el.innerHTML='<div class="chart-empty">该周期暂无数据</div>'; return; }
  const dense = buckets.length > 14;
  el.className = 'chart' + (dense?' dense':'');
  const max=niceMax(Math.max(...buckets.map(b=>b.tokens),1));
  const ticks=[0,.25,.5,.75,1];
  const gl=ticks.map(t=>`<div class="gl" style="bottom:${t*100}%"><span class="glv">${fmtT(Math.round(max*t))}</span></div>`).join('');
  const cols=buckets.map(b=>{
    if(b.tokens<=0){
      // empty slot on a full axis (e.g. a quiet hour) — keep the gap, no tip
      return `<div class="col is-empty"><div class="stkwrap"></div></div>`;
    }
    const segs=TOKKEYS.map(k=>{
      const h=b[k]/max*100;
      return h>0?`<div class="stk" style="height:${h}%;background:${TOKCOL[k]}"></div>`:'';
    }).reverse().join('');
    return `<div class="col" data-tip="${b.label} · ${fmt(b.tokens)} tok · ${usd(b.cost)}"><div class="stkwrap">${segs}</div></div>`;
  }).join('');
  // On the dense 24-hour axis, label every 3rd hour so ticks stay readable.
  const stride = mode==='hour' ? 3 : 1;
  const xaxis=buckets.map((b,i)=>`<div class="xl">${i%stride===0?b.label:''}</div>`).join('');
  el.innerHTML=`<div class="plot">${gl}<div class="bars">${cols}</div></div><div class="xaxis">${xaxis}</div>`;
  el.querySelectorAll('.col[data-tip]').forEach(col=>{
    col.onmousemove=e=>{ tip.textContent=col.dataset.tip; tip.style.opacity=1; tip.style.left=(e.clientX+12)+'px'; tip.style.top=(e.clientY+12)+'px'; };
    col.onmouseleave=()=>tip.style.opacity=0;
  });
}

// ---- period detail table (sortable) ----
const PCOLS=[
  ['label','周期'],['tokens','总 Token'],['input','输入'],['output','输出'],
  ['cacheRead','缓存读'],['reasoning','推理'],['messages','消息'],['cost','成本'],
];
let pSort={key:'key',dir:-1};
let curBuckets=[];
function renderPeriodTable(buckets){
  curBuckets=buckets;
  // the chart keeps a full 24h axis; the detail table lists only real rows
  const rowsData = buckets.filter(b=>b.tokens>0);
  const sortKey = pSort.key==='label' ? 'key' : pSort.key;
  const sorted=[...rowsData].sort((a,b)=>{
    const av=a[sortKey], bv=b[sortKey];
    const cmp = typeof av==='string' ? (av<bv?-1:av>bv?1:0) : av-bv;
    return cmp*pSort.dir;
  });
  const head=PCOLS.map(c=>`<th data-k="${c[0]}">${c[1]}${pSort.key===c[0]?(pSort.dir<0?' ↓':' ↑'):''}</th>`).join('');
  const rows=sorted.map(b=>
    `<tr><td>${b.label}</td><td>${fmt(b.tokens)}</td><td>${fmt(b.input)}</td><td>${fmt(b.output)}</td><td>${fmt(b.cacheRead)}</td><td>${fmt(b.reasoning)}</td><td>${b.messages}</td><td class="cost">${usd(b.cost)}</td></tr>`
  ).join('');
  document.getElementById('periodTable').innerHTML=`<thead><tr>${head}</tr></thead><tbody>${rows}</tbody>`;
  document.querySelectorAll('#periodTable th').forEach(th=>th.onclick=()=>{
    const k=th.dataset.k;
    if(pSort.key===k) pSort.dir*=-1; else { pSort.key=k; pSort.dir=-1; }
    renderPeriodTable(curBuckets);
  });
}

// ---- model & client aggregate (whole range) ----
function aggBy(field){
  const map=new Map();
  for(const d of days) for(const c of d.clients){
    const key=field==='model'?c.model:c.client;
    if(!map.has(key)) map.set(key,{key,tokens:0,cost:0,messages:0});
    const m=map.get(key); m.tokens+=c.tokens; m.cost+=c.cost; m.messages+=c.messages;
  }
  return [...map.values()].sort((a,b)=>b.tokens-a.tokens);
}
function renderAggTable(id,field,head){
  const rows=aggBy(field);
  const max=Math.max(...rows.map(r=>r.tokens),1);
  document.getElementById(id).innerHTML =
    `<thead><tr><th>${head}</th><th>Token</th><th>占比</th><th>成本</th></tr></thead><tbody>`+
    rows.map(r=>`<tr><td>${r.key}</td><td>${fmt(r.tokens)}</td><td style="width:120px"><span class="bar"><span style="width:${r.tokens/max*100}%"></span></span></td><td class="cost">${usd(r.cost)}</td></tr>`).join('')+
    `</tbody>`;
}

// ---- tabs / draw ----
let mode='day';
const MODES=[['day','按日'],['week','按周'],['month','按月'],['hour','今日·小时']];
function draw(){
  const buckets=bucketize(mode);
  const b=currentBucket(buckets);
  document.getElementById('chartTitle').textContent={hour:'今日 · 按小时',day:'按日趋势',week:'按周趋势',month:'按月趋势'}[mode];
  // hour axis is always 24 slots; report only the hours that actually have data
  const active = mode==='hour' ? buckets.filter(x=>x.tokens>0).length : buckets.length;
  const unit = mode==='hour' ? '个活跃小时' : '个周期';
  document.getElementById('chartMeta').textContent=active?`${active} ${unit}`:'';
  renderFocus(b); renderNumbers(b); renderChart(buckets); renderPeriodTable(buckets);
}

// Format the UTC generatedAt into the viewer's local wall-clock time.
function localSnap(iso){
  const d=new Date(iso);
  if(isNaN(d)) return iso.slice(0,16).replace('T',' ');
  const p=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function init(){
  document.getElementById('snap').textContent=`${localSnap(D.generatedAt)}（本地，非实时）`;
  document.getElementById('rangeNote').innerHTML=
    `范围 ${D.range.start} 至 ${D.range.end}，全量合计 <b>${fmtT(D.summary.totalTokens)}</b> tok / <b>${usd(D.summary.totalCost)}</b>。数值为静态快照，重跑 <b>scripts/gen-token-dashboard.sh</b> 刷新。`;
  document.getElementById('tabs').innerHTML=MODES.map(m=>`<button class="tab${m[0]===mode?' active':''}" data-m="${m[0]}">${m[1]}</button>`).join('');
  document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>{
    mode=t.dataset.m;
    document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x===t));
    draw();
  });
  renderAggTable('modelTable','model','模型'); renderAggTable('clientTable','client','客户端'); draw();
}
init();
