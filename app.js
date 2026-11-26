{
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $ = id => document.getElementById(id);
const money = (v, p) => v == null ? '—' : '$' + v.toLocaleString('es-US', {minimumFractionDigits: p < 10 ? 2 : 2, maximumFractionDigits: 2});
const pct = v => (v > 0 ? '+' : '') + (v * 100).toFixed(0) + '%';
const store = { get(k){ try { return JSON.parse(localStorage.getItem(k)); } catch(e){ return null; } }, set(k,v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch(e){} } };
let D, base, edits = {}, mkt, excl = true;

const PARAMS = [
 ['Flujo de caja libre futuro descontado (DCF)','✓','✓','✓','✓','✓'],
 ['Ganancias por acción normalizadas (sin partidas únicas)','✓','✓','✓','✓','—'],
 ['Tasa libre de riesgo (bono a 10 años)','✓','✓','—','✓','—'],
 ['Prima de riesgo del mercado','✓','✓','—','✓','—'],
 ['Beta / riesgo sistemático','✓','—','—','✓','—'],
 ['Estimados de crecimiento de analistas','✓','✓','—','✓','✓'],
 ['Crecimiento histórico','—','✓','—','✓','✓'],
 ['Valor terminal / perpetuidad','✓','✓','✓','✓','✓'],
 ['Horizonte de proyección 5–10 años','✓','✓','✓','✓','—'],
 ['Ventaja competitiva: ROIC vs. costo del capital','✓','—','—','—','—'],
 ['Múltiplos históricos propios (P/E, P/S, P/B, P/FCF)','—','✓','—','—','✓'],
 ['Múltiplos de competidores (P/E, EV/EBITDA, EV/ventas)','—','—','✓','✓','✓'],
 ['Valor en libros / tangible','—','✓','—','✓','—'],
 ['Dividendos (modelo de descuento)','—','✓','✓','✓','—'],
 ['Caja y deuda neta (de valor empresa a valor por acción)','✓','—','✓','—','✓'],
 ['Acciones en circulación','✓','✓','✓','✓','✓'],
 ['Escenarios bajista / base / alcista','✓','—','—','—','✓'],
 ['Margen de seguridad / incertidumbre','✓','✓','—','✓','—'],
 ['Excluir modelos que no aplican al sector o a los datos','✓','✓','✓','✓','—'],
 ['Combinar varios modelos en una cifra','—','✓','✓','—','✓']];

function stock(t){ const s = JSON.parse(JSON.stringify(base.find(x => x.t === t))); Object.assign(s, edits[t] || {}); return s; }
function verdict(fv, p){ if (fv == null) return ['Sin datos suficientes','']; const d = (fv - p) / fv;
  if (d >= .4) return ['Muy infravalorada · ' + pct(fv/p-1) + ' de potencial','v-up']; if (d >= .2) return ['Infravalorada · ' + pct(fv/p-1),'v-up'];
  if (d >= 0) return ['Cerca del valor justo · sin margen de seguridad','']; return ['Sobrevalorada · precio ' + pct(p/fv-1) + ' sobre el valor','v-dn']; }

function strip(r, P){
  const vals = r.ms.filter(x => x.val != null).map(x => x.val).concat([P]); let lo = Math.min(...vals), hi = Math.max(...vals); const pad = (hi - lo) * .06 || 1; lo -= pad; hi += pad;
  const x = v => ((v - lo) / (hi - lo) * 100).toFixed(2) + '%';
  const ticks = r.ms.filter(m => m.val != null).map(m => `<i style="left:${x(m.val)}" title="${esc(m.name)}"></i>`).join('');
  const lab = (v, c) => v == null ? '' : `<span class="nd ${c}" style="left:${x(v)}"></span>`;
  return `<div class="strip" aria-hidden="true"><div class="ax"></div>${ticks}${lab(r.vi,'v')}${lab(r.fv,'f')}${lab(P,'p')}<span class="ends" style="left:0">${money(lo+pad)}</span><span class="ends" style="right:0">${money(hi-pad)}</span></div>
   <div class="leg"><span><i class="p"></i>Precio</span><span><i class="v"></i>Intrínseco</span><span><i class="f"></i>Justo</span><span><i></i>Cada modelo</span></div>`;
}

function ledger(){
  $('ledger').innerHTML = base.map(b => { const s = stock(b.t), r = summarize(s, mkt, excl), [v, c] = verdict(r.fv, s.price);
    return `<button class="row" data-t="${esc(s.t)}"><div><div class="tk">${esc(s.t)}</div><div class="nm">${esc(s.n)} · precio al ${esc(s.pDate)}${edits[s.t] ? ' · editado' : ''}</div>
      <div class="figs"><div class="fig"><b>${money(s.price)}</b><span>Precio</span></div><div class="fig"><b>${money(r.vi)}</b><span>Intrínseco</span></div><div class="fig"><b>${money(r.fv)}</b><span>Justo</span></div></div>
      <span class="verd ${c}">${esc(v)}</span></div>${strip(r, s.price)}</button>`; }).join('');
  for (const b of document.querySelectorAll('.row')) b.onclick = () => detail(b.dataset.t);
}

const FIELDS = [['price','Precio $'],['epsN','EPS normalizado $'],['epsFwd','EPS próximo año $'],['epsG3','Crec. EPS consenso 3 años %'],['gHist','Crec. histórico %'],['fcf','Flujo de caja libre (mil M $)'],['beta','Beta'],['roe','ROE %'],['shares','Acciones (mil M)'],['moatYrs','Años de ventaja (etapa II)']];
function detail(t){
  const s = stock(t), r = summarize(s, mkt, excl), [v, c] = verdict(r.fv, s.price);
  const rows = g => r.ms.filter(m => m.grp === g).map(m => `<tr><td data-l="Modelo"><b>${esc(m.name)}</b><div class="src">${esc(m.src)}</div><div class="note">${esc(m.note)}</div></td>
    <td class="n" data-l="Valor">${m.val == null ? '<span class="note">No aplica</span>' : m.out ? `<span class="x">${money(m.val)}</span><div class="note">excluido (extremo)</div>` : money(m.val)}</td>
    <td class="n" data-l="vs. precio">${m.val == null ? '' : pct(m.val / s.price - 1)}</td></tr>`).join('');
  $('v-detalle').innerHTML = `<button class="back" id="bk">← Todas las acciones</button>
   <h2 style="margin-top:4px">${esc(s.n)} (${esc(s.t)})</h2><span class="verd ${c}">${esc(v)}</span>
   <div class="big"><div class="p"><span class="note">Precio (${esc(s.pDate)})</span><b>${money(s.price)}</b></div><div><span class="note">Valor intrínseco</span><b>${money(r.vi)}</b></div><div class="f"><span class="note">Valor justo</span><b>${money(r.fv)}</b></div></div>
   ${strip(r, s.price)}
   <p class="note">Mediana de los modelos: ${money(r.med)} · Fórmula Alpha Spread (intrínseco + relativo ÷ 2): ${money(r.as)} · Objetivo promedio de analistas a 12 meses: ${money(s.target)} (referencia, no entra en el cálculo).</p>
   <div class="panel"><b>Ojo:</b> ${esc(s.flag)}<br><span class="note">EPS usado: ${esc(s.epsNnote)}. Crecimiento: ${esc(s.gHistNote)}.</span></div>
   <h3>Modelos absolutos → valor intrínseco</h3><table class="stack"><thead><tr><th>Modelo</th><th>Valor</th><th>vs. precio</th></tr></thead><tbody>${rows('int')}</tbody></table>
   <h3 style="margin-top:22px">Modelos relativos → se suman al valor justo</h3><table class="stack"><thead><tr><th>Modelo</th><th>Valor</th><th>vs. precio</th></tr></thead><tbody>${rows('rel')}</tbody></table>
   <h3 style="margin-top:22px">Ajusta los números</h3><p class="note">Cambia cualquier dato (por ejemplo el precio de hoy) y todo se recalcula. Se guarda en este teléfono.</p>
   <div class="grid">${FIELDS.map(([k, l]) => `<div><label for="f-${k}">${l}</label><input id="f-${k}" data-k="${k}" type="number" step="any" inputmode="decimal" value="${s[k] ?? ''}" placeholder="${k === 'moatYrs' ? 'automático' : ''}"></div>`).join('')}</div>
   <p><button class="btn g" id="rst">Restaurar datos originales de ${esc(s.t)}</button></p>`;
  show('detalle');
  $('bk').onclick = () => { show('cartera'); ledger(); };
  $('rst').onclick = () => { delete edits[t]; store.set('vj-edits', edits); detail(t); };
  for (const i of document.querySelectorAll('#v-detalle input[data-k]')) i.onchange = () => { const k = i.dataset.k, val = i.value === '' ? null : +i.value;
    edits[t] = edits[t] || {}; edits[t][k] = val; store.set('vj-edits', edits); const y = scrollY; detail(t); scrollTo(0, y); };
  scrollTo(0, 0);
}

function show(v){ for (const s of ['cartera','detalle','metodo','ajustes','historial']) $('v-' + s).hidden = s !== v;
  for (const b of document.querySelectorAll('nav button')) b.setAttribute('aria-selected', b.dataset.v === v || (v === 'detalle' && b.dataset.v === 'cartera')); }

function statics(){
  $('params').innerHTML = '<thead><tr><th>Parámetro</th><th>M</th><th>G</th><th>I</th><th>S</th><th>A</th></tr></thead><tbody>' +
    PARAMS.map(p => `<tr><td>${esc(p[0])}</td>${p.slice(1).map(x => `<td class="${x === '✓' ? 'ok' : 'no'}">${x}</td>`).join('')}</tr>`).join('') + '</tbody>';
  $('mlist').innerHTML = '<table class="stack"><thead><tr><th>Modelo</th><th>Lo usa</th></tr></thead><tbody>' + models(base[0], mkt).map(m => `<tr><td data-l="Modelo">${esc(m.name)} <span class="note">(${m.grp === 'int' ? 'absoluto' : 'relativo'})</span></td><td data-l="Plataforma">${esc(m.src)}</td></tr>`).join('') + '</tbody></table>';
  const h = D.historial || [];
  $('hist').innerHTML = '<thead><tr><th>Fecha</th><th>Acción</th><th>Precio</th><th>Intrínseco</th><th>Justo</th><th>Motivo</th></tr></thead><tbody>' +
    (h.length ? h.slice().reverse().map(e => `<tr><td data-l="Fecha">${esc(e.fecha)}</td><td data-l="Acción">${esc(e.t)}</td><td class="n" data-l="Precio">${money(e.precio)}</td><td class="n" data-l="Intrínseco">${money(e.vi)}</td><td class="n" data-l="Justo">${money(e.fv)}</td><td data-l="Motivo">${esc(e.motivo)}</td></tr>`).join('') : '<tr><td colspan="6">Aún no hay actualizaciones.</td></tr>') + '</tbody>';
  $('next').innerHTML = '<table class="stack"><tbody>' + base.map(s => `<tr><td data-l="Acción"><b>${esc(s.t)}</b></td><td data-l="Reporta">${esc(s.nextER)}</td></tr>`).join('') + '</tbody></table>';
}

function setMkt(){ $('rf').value = mkt.rf; $('erp').value = mkt.erp; $('tg').value = mkt.tg; $('excl').checked = excl;
  $('mktsrc').textContent = `${D.mercado.rf_fuente}. ${D.mercado.erp_fuente}. ${D.mercado.tg_fuente}.`; }

fetch('data.json?t=' + Date.now(), {cache: 'no-store'}).catch(() => caches.match('data.json')).then(r => r.json()).then(d => {
  D = d; base = d.acciones; edits = store.get('vj-edits') || {}; const sm = store.get('vj-mkt');
  if (sm && sm.v === d.actualizado) { mkt = sm.m; excl = sm.e; } else { mkt = {...d.mercado}; }
  if (store.get('vj-ver') !== d.actualizado) { edits = {}; store.set('vj-edits', edits); store.set('vj-ver', d.actualizado); }
  $('lede').textContent = `Datos actualizados el ${d.actualizado} con los últimos resultados trimestrales de cada empresa. 13 modelos, los mismos que usan Morningstar, GuruFocus, InvestingPro, Simply Wall St y Alpha Spread.`;
  setMkt(); statics(); ledger();
  for (const k of ['rf','erp','tg']) $(k).onchange = () => { mkt[k] = +$(k).value; store.set('vj-mkt', {v: d.actualizado, m: mkt, e: excl}); ledger(); };
  $('excl').onchange = () => { excl = $('excl').checked; store.set('vj-mkt', {v: d.actualizado, m: mkt, e: excl}); ledger(); };
  $('resetAll').onclick = () => { edits = {}; mkt = {...d.mercado}; excl = true; store.set('vj-edits', edits); store.set('vj-mkt', null); setMkt(); ledger(); };
}).catch(() => { $('lede').textContent = 'No se pudieron cargar los datos. Cierra y vuelve a abrir la página.'; });

for (const b of document.querySelectorAll('nav button')) b.onclick = () => { show(b.dataset.v); if (b.dataset.v === 'cartera') ledger(); };
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
