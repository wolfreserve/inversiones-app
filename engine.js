// Motor de valoración — modelos documentados por Morningstar, GuruFocus, InvestingPro, Simply Wall St, Alpha Spread
const MKT = { rf: 5.05, erp: 4.20, tg: 3.0 }; // 10Y UST 19-nov-2026; ERP implícito Damodaran 1-oct-2026; crecimiento terminal

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const med = a => { const s = a.filter(v => v != null && isFinite(v)).sort((x, y) => x - y); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;

function ke(s, m) { const b = clamp(s.beta, 0.8, 2.0); return (m.rf + b * m.erp) / 100; }
function gBase(s) { return s.gHist != null ? s.gHist : s.epsG3; }
function msCOE(beta) { // categorías de Morningstar (beta implícita 0.67/1.00/1.44/2.00)
  if (beta < 0.835) return 0.075; if (beta < 1.22) return 0.09; if (beta < 1.72) return 0.11; return 0.135; }
function moatYears(s, m) { const spread = s.roic - ke(s, m) * 100; return spread > 10 ? 12 : spread > 0 ? 5 : 1; }

function models(s, m = MKT) {
  const out = []; const k = ke(s, m); const tg = m.tg / 100; const sh = s.shares; const netCash = (s.cash - s.debt) / sh;
  const add = (id, grp, name, src, val, note) => out.push({ id, grp, name, src, val: (val != null && isFinite(val) && val > 0) ? val : null, note });

  // 1. DCF de flujo de caja libre (apalancado) 2 etapas, 10 años
  if (s.fcf > 0) {
    const g1 = clamp(s.epsG3, -10, 20) / 100; let cf = s.fcf / sh, pv = 0, g = g1;
    for (let t = 1; t <= 10; t++) { if (t > 5) g = g1 + (tg - g1) * (t - 5) / 5; cf *= 1 + g; pv += cf / (1 + k) ** t; }
    const tv = cf * (1 + tg) / (k - tg) / (1 + k) ** 10;
    add('dcf', 'int', 'DCF de flujo de caja libre (2 etapas, 10 años)', 'Simply Wall St · InvestingPro · Alpha Spread', pv + tv,
      `FCF/acción ${(s.fcf / sh).toFixed(2)} · crec. ${(g1 * 100).toFixed(1)}% años 1–5, baja a ${m.tg}% · descuento ${(k * 100).toFixed(2)}%`);
  } else add('dcf', 'int', 'DCF de flujo de caja libre (2 etapas, 10 años)', 'Simply Wall St · InvestingPro · Alpha Spread', null, 'No aplica: flujo de caja libre negativo');

  // 2. DCF de ganancias (GuruFocus): EPS sin partidas no recurrentes, 10+10 años, terminal 4%, descuento = rf redondeado + 6%
  { const d = (Math.ceil(m.rf) + 6) / 100, g1 = clamp(gBase(s), 5, 20) / 100, g2 = 0.04;
    const x = (1 + g1) / (1 + d), y = (1 + g2) / (1 + d), E = s.epsN;
    const v = E * x * (1 - x ** 10) / (1 - x) + E * x ** 10 * y * (1 - y ** 10) / (1 - y) + (s.tbvps || 0);
    add('gfdcf', 'int', 'DCF de ganancias (método GuruFocus)', 'GuruFocus', E > 0 ? v : null,
      `EPS ${E} · crec. ${(g1 * 100).toFixed(1)}% x10 años, 4% x10 años · descuento ${(d * 100).toFixed(0)}% · + valor tangible ${(s.tbvps || 0).toFixed(2)}`); }

  // 3. DCF 3 etapas (marco Morningstar): explícita 5 años, desvanecimiento según foso, perpetuidad ROE = costo del capital
  { const coe = msCOE(s.beta), L = s.moatYrs || moatYears(s, m), g1 = clamp(gBase(s), 0, 20) / 100, roe0 = Math.max(s.roe, coe * 100 + 0.01) / 100;
    let E = s.epsN, pv = 0, t = 0;
    const step = (g, roe) => { t++; E *= 1 + g; const re = clamp(g / roe, 0, 0.9); pv += E * (1 - re) / (1 + coe) ** t; };
    for (let i = 0; i < 5; i++) step(g1, roe0);
    for (let i = 1; i <= L; i++) { const f = i / (L + 1); step(g1 + (tg - g1) * f, roe0 + (coe - roe0) * f); }
    const tv = E * (1 + tg) / coe / (1 + coe) ** t; // RONIC = COE → el crecimiento no crea valor
    add('ms3', 'int', 'DCF de 3 etapas con foso (marco Morningstar)', 'Morningstar', s.epsN > 0 ? pv + tv : null,
      `Costo del capital ${(coe * 100).toFixed(1)}% · etapa II ${L} año(s) · ROE ${s.roe}% converge al costo del capital`); }

  // 4. Valor del poder de ganancias (EPV): ganancias normalizadas / costo del capital, sin crecimiento
  add('epv', 'int', 'Valor del poder de ganancias (EPV)', 'InvestingPro · GuruFocus', s.epsN > 0 ? s.epsN / k : null, `EPS ${s.epsN} ÷ ${(k * 100).toFixed(2)}% (sin crecimiento)`);

  // 5. Número de Graham
  add('graham', 'int', 'Número de Graham', 'GuruFocus · InvestingPro', s.epsN > 0 && s.bvps > 0 ? Math.sqrt(22.5 * s.epsN * s.bvps) : null, `√(22.5 × EPS ${s.epsN} × libro ${s.bvps})`);

  // 6. Modelo de descuento de dividendos (2 etapas) — solo si el pago es significativo
  { const payout = s.div / s.epsN;
    if (s.div > 0 && payout >= 0.25) { const g1 = clamp(gBase(s), 0, 20) / 100; let D = s.div, pv = 0;
      for (let t = 1; t <= 5; t++) { D *= 1 + g1; pv += D / (1 + k) ** t; }
      add('ddm', 'int', 'Descuento de dividendos (2 etapas)', 'InvestingPro · Simply Wall St', pv + D * (1 + tg) / (k - tg) / (1 + k) ** 5, `Dividendo ${s.div} · pago ${(payout * 100).toFixed(0)}% de las ganancias`);
    } else add('ddm', 'int', 'Descuento de dividendos (2 etapas)', 'InvestingPro · Simply Wall St', null, s.div > 0 ? `No aplica: paga solo ${(payout * 100).toFixed(0)}% de sus ganancias` : 'No aplica: no paga dividendo'); }

  // Relativos
  const ps = s.rev / sh, fps = s.fcf / sh;
  add('pe_h', 'rel', 'P/E mediano histórico (5 años)', 'GuruFocus (GF Value) · Alpha Spread', s.mPE ? s.mPE * s.epsN : null, s.mPE ? `${s.mPE}× EPS ${s.epsN}` : 'Sin historial de P/E positivo');
  add('ps_h', 'rel', 'P/S mediano histórico (5 años)', 'GuruFocus (GF Value)', s.mPS ? s.mPS * ps : null, s.mPS ? `${s.mPS}× ventas/acción ${ps.toFixed(2)}` : 'Sin datos');
  add('pb_h', 'rel', 'P/B mediano histórico (5 años)', 'GuruFocus (GF Value)', s.mPB ? s.mPB * s.bvps : null, s.mPB ? `${s.mPB}× libro ${s.bvps}` : 'No aplica: patrimonio distorsionado por recompras');
  add('pfcf_h', 'rel', 'P/FCF mediano histórico', 'GuruFocus (GF Value)', s.mPFCF && fps > 0 ? s.mPFCF * fps : null, s.mPFCF && fps > 0 ? `${s.mPFCF}× FCF/acción ${fps.toFixed(2)}` : 'No aplica: FCF negativo o sin historial');
  { const p = med(s.peers.map(x => x.fpe)); add('pe_p', 'rel', 'P/E forward de competidores', 'InvestingPro · Simply Wall St · Alpha Spread', p * s.epsFwd, `Mediana ${p.toFixed(2)}× (${s.peers.map(x => x.t).join(', ')}) × EPS próximo ${s.epsFwd.toFixed(2)}`); }
  { const e = med(s.peers.filter(x => x.eve).map(x => x.eve)); add('eve_p', 'rel', 'EV/EBITDA de competidores', 'InvestingPro · Alpha Spread', (e * s.ebitda + s.cash - s.debt) / sh, `Mediana ${e.toFixed(2)}× EBITDA ${s.ebitda}B ± caja neta ${(s.cash - s.debt).toFixed(2)}B`); }
  { const g = clamp(gBase(s), 5, 20); add('lynch', 'rel', 'Valor justo de Peter Lynch (PEG = 1)', 'GuruFocus · Simply Wall St (PEG)', gBase(s) >= 5 ? g * s.epsN : null, `Crec. ${g.toFixed(1)}% (tope 20) × EPS ${s.epsN}`); }
  return out;
}

function summarize(s, m = MKT, excl = true) {
  const ms = models(s, m), P = s.price;
  ms.forEach(x => { x.out = x.val != null && excl && (x.val > 2 * P || x.val < 0.4 * P); x.used = x.val != null && !x.out; });
  const vi = mean(ms.filter(x => x.used && x.grp === 'int').map(x => x.val));
  const rv = mean(ms.filter(x => x.used && x.grp === 'rel').map(x => x.val));
  const fv = mean(ms.filter(x => x.used).map(x => x.val));
  return { ms, vi, rv, fv, med: med(ms.filter(x => x.used).map(x => x.val)), as: vi != null && rv != null ? (vi + rv) / 2 : null };
}
if (typeof module !== 'undefined') module.exports = { models, summarize, MKT };
