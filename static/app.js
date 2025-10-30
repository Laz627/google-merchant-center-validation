(()=>{
const $=q=>document.querySelector(q), $$=q=>Array.from(document.querySelectorAll(q));
let SPEC=null, FILE=null;

function setTab(name){$$('.tabbtn').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));
$$('.panel').forEach(p=>p.classList.toggle('active',p.dataset.panel===name));}

async function loadSpec(){
  try{
    const r = await fetch('/api/spec');
    if(!r.ok){console.error('spec fetch failed', r.status); return;}
    SPEC = await r.json();
    renderSpec();
  }catch(e){console.error('spec fetch err', e);}
}

function renderSpec(){
  const grid = $('#specGrid'); if(!SPEC||!Array.isArray(SPEC.attributes)){grid.innerHTML=''; $('#count').textContent='0'; return;}
  const profile = $('#specProfile').value;
  const text = ($('#search').value||'').toLowerCase();
  const allowed = new Set(['required','conditional','recommended','optional']);
  const active = new Set($$('.filt:checked').map(x=>x.value).filter(v=>allowed.has(v)));
  const items = SPEC.attributes.filter(a => a.profiles.includes(profile) && active.has(a.status) && (!text || a.name.toLowerCase().includes(text) || (a.desc||'').toLowerCase().includes(text)));
  $('#count').textContent = items.length.toString();
  grid.innerHTML = items.map(a => `<div class="card"><div><span class="badge ${a.status}">${a.status.toUpperCase()}</span></div>
    <div><b>${a.name}</b></div><div class="muted">${(a.desc||'')}</div></div>`).join('');
}

function setCounts(r){$('#cErr').textContent=r.errors.length;$('#cWarn').textContent=r.warnings.length;$('#cOpp').textContent=r.opportunities.length;}
function renderRows(r){
  const tb = $('#tbody'); tb.innerHTML='';
  const all = [...r.errors, ...r.warnings, ...r.opportunities];
  if(!all.length){tb.innerHTML='<tr class="empty"><td colspan="4">No issues 🎉</td></tr>'; return;}
  for(const row of all){
    tb.insertAdjacentHTML('beforeend', `<tr>
      <td>${row.row}</td><td>${row.field}</td><td>${row.severity}</td><td>${row.message}</td></tr>`);
  }
}

async function run(kind){
  if(!FILE){alert('Select or drop a file first.');return;}
  const fd = new FormData(); fd.append('file', FILE); fd.append('profile', $('#profileSelect').value);
  const url = kind==='csv'?'/api/validate-csv':'/api/validate-json';
  const r = await fetch(url,{method:'POST',body:fd});
  if(!r.ok){const t=await r.text(); console.error('validate failed', t); alert('Validation failed. Check console.'); return;}
  const data = await r.json(); setCounts(data); renderRows(data);
}

document.addEventListener('DOMContentLoaded', ()=>{
  // tabs
  $$('.tabbtn').forEach(b=>b.addEventListener('click', ()=>setTab(b.dataset.tab)));
  // spec filters
  $('#specProfile').addEventListener('change', renderSpec);
  $$('.filt').forEach(c=>c.addEventListener('change', renderSpec));
  $('#search').addEventListener('input', renderSpec);

  // drag & drop
  const drop = $('#drop'), file = $('#file'), fname = $('#fname');
  $('#browse').addEventListener('click', ()=>file.click());
  file.addEventListener('change', ()=>{FILE=file.files[0]; fname.textContent=FILE?FILE.name:'No file selected';});
  ;['dragenter','dragover'].forEach(ev=>drop.addEventListener(ev, e=>{e.preventDefault(); drop.classList.add('hover');}));
  ;['dragleave','drop'].forEach(ev=>drop.addEventListener(ev, e=>{e.preventDefault(); drop.classList.remove('hover');}));
  drop.addEventListener('drop', e=>{const f = e.dataTransfer.files[0]; if(f){FILE=f; fname.textContent=f.name;}});

  $('#runCsv').addEventListener('click', ()=>run('csv'));
  $('#runJson').addEventListener('click', ()=>run('json'));
  loadSpec();
});
})();
