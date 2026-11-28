/*
 * Inversiones — valor intrínseco y valor justo de mi portafolio.
 * Seguridad igual a Patrimonio: código de acceso, cifrado AES-256-GCM con llave derivada
 * por PBKDF2-SHA256 (600,000 iteraciones). La llave solo vive en memoria; la app se bloquea
 * tras 2 minutos en segundo plano. Lo que se cifra en el teléfono: tus ajustes y supuestos.
 */
(() => {
  "use strict";
  const ITERACIONES = 600000;
  const BLOQUEO_MS = 2 * 60 * 1000;
  const enc = new TextEncoder(), dec = new TextDecoder();
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const desdeB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const dinero = (v) => (v == null || !isFinite(v) ? "—" : "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const pct = (v) => (v > 0 ? "+" : "") + (v * 100).toFixed(0) + "%";
  const fechaLarga = (iso) => { const [a, m, d] = iso.split("-").map(Number); return new Date(a, m - 1, d).toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric" }); };

  // ── Estado
  let llave = null, sal = null, privado = null; // privado = { edits, mkt, excl } descifrado, solo en memoria
  let vivos = {}, horaVivo = null, relojVivo = null, M = null, SIMS = null, fichas = {}, fichaDe = null, pila = [], menuAbierto = false;
  let D = null, vista = "mercado", detalleDe = null, ocultoDesde = 0, intentos = 0, esperaHasta = 0;

  // ── Almacén cifrado (IndexedDB)
  const almacen = {
    db: null,
    abrir() { if (this.db) return Promise.resolve(this.db); return new Promise((ok, mal) => { const r = indexedDB.open("inversiones", 1); r.onupgradeneeded = () => r.result.createObjectStore("kv"); r.onsuccess = () => ok((this.db = r.result)); r.onerror = () => mal(r.error); }); },
    async obtener(k) { const db = await this.abrir(); return new Promise((ok, mal) => { const r = db.transaction("kv").objectStore("kv").get(k); r.onsuccess = () => ok(r.result); r.onerror = () => mal(r.error); }); },
    async guardar(k, v) { const db = await this.abrir(); return new Promise((ok, mal) => { const t = db.transaction("kv", "readwrite"); t.objectStore("kv").put(v, k); t.oncomplete = () => ok(); t.onerror = () => mal(t.error); }); },
    async borrar(k) { const db = await this.abrir(); return new Promise((ok) => { const t = db.transaction("kv", "readwrite"); t.objectStore("kv").delete(k); t.oncomplete = () => ok(); }); },
  };
  async function derivarLlave(codigo, s) {
    const base = await crypto.subtle.importKey("raw", enc.encode(codigo), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt: s, iterations: ITERACIONES, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function cifrar(k, obj) { const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, enc.encode(JSON.stringify(obj))); return { iv: b64(iv), ct: b64(ct) }; }
  async function descifrar(k, iv, ct) { const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: desdeB64(iv) }, k, desdeB64(ct)); return JSON.parse(dec.decode(pt)); }
  const vacio = () => ({ version: 1, edits: {}, mkt: null, mktDe: null, excl: true });
  async function guardarPrivado() { const { iv, ct } = await cifrar(llave, privado); await almacen.guardar("boveda", { v: 1, sal: b64(sal), iv, ct }); }
  async function crearBoveda(codigo) { sal = crypto.getRandomValues(new Uint8Array(16)); llave = await derivarLlave(codigo, sal); privado = vacio(); await guardarPrivado(); }
  async function abrirBoveda(codigo) { const b = await almacen.obtener("boveda"); const s = desdeB64(b.sal); const k = await derivarLlave(codigo, s); privado = await descifrar(k, b.iv, b.ct); sal = s; llave = k; }
  function bloquear() { clearInterval(relojVivo); vivos = {}; llave = null; privado = null; detalleDe = null; pintarBloqueo(); }

  // ── Íconos
  const IC = {
    portafolio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/></svg>',
    historial: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    supuestos: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>',
    metodo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2z"/><path d="M8 7h6M8 11h6"/></svg>',
    candado: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  };
  IC.mercado = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="8" height="10" rx="1.5"/><rect x="13" y="3" width="8" height="6" rx="1.5"/><rect x="13" y="11" width="8" height="10" rx="1.5"/><rect x="3" y="15" width="8" height="6" rx="1.5"/></svg>';
  IC.buscar = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>';
  IC.menu = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
  IC.ajustes = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';
  IC.perfil = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>';
  const NOMBRES = { mercado: "Mercado", portafolio: "Mi portafolio" };
  const PAGINAS = { ajustes: "Ajustes", perfil: "Perfil", supuestos: "Supuestos", metodo: "Cómo se calcula", historial: "Historial" };
  const INDICES = [["SPY", "S&P 500"], ["QQQ", "Nasdaq 100"], ["DIA", "Dow Jones"], ["IWM", "Russell 2000"], ["BINANCE:BTCUSDT", "Bitcoin"]];

  // ── Bloqueo (teclado propio, igual que Patrimonio)
  const teclado = () => `<div class="teclado">${["1","2","3","4","5","6","7","8","9"].map((d) => `<button class="tecla" data-d="${d}">${d}</button>`).join("")}<button class="tecla tenue" data-d="borrar" aria-label="Borrar">⌫</button><button class="tecla" data-d="0">0</button><button class="tecla tenue" data-d="limpiar" aria-label="Limpiar">C</button></div>`;
  function conectarTeclado(campo) {
    $$(".tecla").forEach((t) => (t.onclick = () => { const c = $(campo); if (t.dataset.d === "borrar") c.value = c.value.slice(0, -1); else if (t.dataset.d === "limpiar") c.value = ""; else if (c.value.length < 64) c.value += t.dataset.d; $("#err").textContent = ""; }));
  }
  function tecladoSistema(id, auto) {
    const n = document.createElement("input"); Object.assign(n, { id, type: "password", autocomplete: auto, value: "" });
    $("#" + id).replaceWith(n); $(".teclado")?.classList.add("oculto"); $("#cambiar")?.classList.add("oculto"); $("#err").textContent = "Toca el campo y escribe tu código.";
  }
  async function pintarBloqueo() {
    $(".nav")?.remove();
    const existe = await almacen.obtener("boveda"), app = $("#app");
    if (!existe) {
      let primero = null;
      app.innerHTML = `<div class="bloqueo"><img src="iconos/icono-192.png" alt=""><h1>Inversiones</h1>
        <p class="tenue" id="ins">Crea un código de al menos 6 números para proteger la app.</p>
        <input id="c1" type="password" autocomplete="off" readonly aria-label="Código"><div class="error" id="err"></div>${teclado()}
        <button class="btn" id="crear">Continuar</button><button class="btn secundario" id="cambiar">Prefiero un código con letras</button>
        <div class="nota"><strong>Importante:</strong> si olvidas el código puedes empezar de cero; solo perderías tus ajustes guardados en este teléfono.</div></div>`;
      conectarTeclado("#c1"); $("#cambiar").onclick = () => tecladoSistema("c1", "new-password");
      $("#crear").onclick = async () => {
        const v = $("#c1").value;
        if (primero === null) { if (v.length < 6) return ($("#err").textContent = "El código debe tener al menos 6 caracteres."); primero = v; $("#c1").value = ""; $("#ins").textContent = "Escribe el mismo código otra vez para confirmarlo."; $("#crear").textContent = "Crear y entrar"; return; }
        if (v !== primero) { primero = null; $("#c1").value = ""; $("#ins").textContent = "Crea un código de al menos 6 números."; $("#crear").textContent = "Continuar"; return ($("#err").textContent = "Los códigos no coinciden. Empieza de nuevo."); }
        $("#crear").disabled = true; $("#crear").textContent = "Protegiendo…";
        await crearBoveda(v); navigator.storage?.persist?.().catch(() => {}); entrar();
      };
      return;
    }
    app.innerHTML = `<div class="bloqueo"><img src="iconos/icono-192.png" alt=""><h1>Inversiones</h1><p class="tenue">Escribe tu código para abrir.</p>
      <input id="cod" type="password" autocomplete="off" readonly aria-label="Código"><div class="error" id="err"></div>${teclado()}
      <button class="btn" id="abrir">Abrir</button><button class="btn secundario" id="cambiar">Mi código tiene letras: usar teclado</button>
      <button class="btn peligro" id="empezar">Olvidé mi código: empezar de cero</button></div>`;
    conectarTeclado("#cod"); $("#cambiar").onclick = () => tecladoSistema("cod", "current-password");
    $("#empezar").onclick = async () => { if (!confirm("Empezar de cero borra tus ajustes guardados en este teléfono y te pide un código nuevo. Los datos de las acciones no se pierden. ¿Continuar?")) return; await almacen.borrar("boveda"); pintarBloqueo(); };
    const intentar = async () => {
      if (Date.now() < esperaHasta) return ($("#err").textContent = `Espera ${Math.ceil((esperaHasta - Date.now()) / 1000)} segundos.`);
      $("#abrir").disabled = true; $("#abrir").textContent = "Abriendo…";
      try { await abrirBoveda($("#cod").value); intentos = 0; entrar(); }
      catch { intentos++; if (intentos >= 5) esperaHasta = Date.now() + 30000 * 2 ** (intentos - 5); $("#err").textContent = "Código incorrecto."; $("#abrir").disabled = false; $("#abrir").textContent = "Abrir"; $("#cod").value = ""; }
    };
    $("#abrir").onclick = intentar; $("#cod").onkeydown = (e) => e.key === "Enter" && intentar();
  }

  // ── Datos y cálculos
  const mercado = () => (privado.mkt && privado.mktDe === D.actualizado ? privado.mkt : { ...D.mercado });
  function accion(t) {
    const s = JSON.parse(JSON.stringify(D.acciones.find((x) => x.t === t)));
    if (vivos[t]) { s.price = vivos[t].c; s.enVivo = vivos[t]; }
    Object.assign(s, privado.edits[t] || {});
    if (privado.edits[t]?.price != null) s.enVivo = null;
    return s;
  }
  // ── Precios en vivo (Finnhub, llave gratuita guardada cifrada en este teléfono)
  async function cargarVivos() {
    const k = privado?.finnhub; if (!k || !D) return;
    const lista = [...new Set([...D.acciones.map((a) => a.t), ...INDICES.map((i) => i[0]), ...top10().map((a) => a.t), ...(fichaDe ? [fichaDe] : [])])];
    const res = await Promise.all(lista.map((t) => cotizar(t).then((q) => [t, q]).catch((e) => [t, { error: e }])));
    let ok = 0;
    for (const [t, q] of res) if (q && typeof q.c === "number" && q.c > 0) { vivos[t] = q; ok++; }
    privado.vivoError = ok ? null : "No se pudieron obtener precios en vivo. Revisa tu llave de Finnhub.";
    if (ok) horaVivo = new Date();
    if (llave && !document.hidden && !menuAbierto && (["mercado", "portafolio"].includes(vista) || detalleDe || fichaDe) && !document.activeElement?.matches("input")) { const y = scrollY; pintar(); scrollTo(0, y); }
  }
  const api = (ruta, q) => fetch(`https://finnhub.io/api/v1/${ruta}?${new URLSearchParams({ ...q, token: privado.finnhub })}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : Promise.reject(r.status)));
  const cotizar = (t) => api("quote", { symbol: t });
  const top10 = () => (M ? M.acciones.filter((a) => a.mc).sort((a, b) => b.mc - a.mc).slice(0, 10) : []);
  const precioDe = (t) => vivos[t] || (M && M.acciones.find((a) => a.t === t)) || null;
  function iniciarVivos() { clearInterval(relojVivo); if (!privado?.finnhub) return; cargarVivos(); relojVivo = setInterval(() => !document.hidden && llave && cargarVivos(), 60000); }
  const calc = (s) => summarize(s, mercado(), privado.excl);
  function veredicto(fv, p) {
    if (fv == null) return ["Sin datos suficientes", ""];
    const d = (fv - p) / fv;
    if (d >= 0.4) return ["Muy infravalorada", "sube"]; if (d >= 0.2) return ["Infravalorada", "sube"];
    if (d >= 0) return ["Cerca del valor justo", ""]; return ["Sobrevalorada", "baja"];
  }
  function toast(t) { const e = document.createElement("div"); e.className = "toast"; e.textContent = t; document.body.appendChild(e); setTimeout(() => e.remove(), 2200); }

  // ── Estructura
  function entrar() {
    if (privado.edits && privado.verDatos !== D.actualizado) { privado.edits = {}; privado.verDatos = D.actualizado; guardarPrivado(); }
    vista = "mercado"; detalleDe = null; fichaDe = null; pila = []; pintarNav(); pintar(); iniciarVivos();
  }
  function pintarNav() {
    $(".nav")?.remove(); const n = document.createElement("nav"); n.className = "nav";
    n.innerHTML = `<button data-v="mercado">${IC.mercado}Mercado</button><button data-v="portafolio">${IC.portafolio}Mi portafolio</button>`;
    document.body.appendChild(n); $$("button", n).forEach((b) => (b.onclick = () => { vista = b.dataset.v; detalleDe = null; fichaDe = null; pila = []; pintar(); }));
  }
  const cabeza = (t, sub) => `${pila.length ? '<button class="volver" id="volver">‹ Volver</button>' : ""}<div class="cabeza"><div><h1>${t}</h1>${sub ? `<div class="sub">${sub}</div>` : ""}</div>
    <div class="acciones-cab"><button class="icono-btn" id="bBuscar" aria-label="Buscar acciones">${IC.buscar}</button><button class="icono-btn" id="bMenu" aria-label="Menú">${IC.menu}</button></div></div>`;
  // Navegación: ir() guarda dónde estabas para que "Volver" regrese ahí.
  function ir(estado) { pila.push({ vista, detalleDe, fichaDe }); Object.assign({}, estado); vista = estado.vista ?? vista; detalleDe = estado.detalleDe ?? null; fichaDe = estado.fichaDe ?? null; pintar(); }
  function volver() { const e = pila.pop(); if (!e) return; vista = e.vista; detalleDe = e.detalleDe; fichaDe = e.fichaDe; pintar(); }
  function pintar() {
    cerrarMenu();
    $$(".nav button").forEach((b) => b.classList.toggle("activo", b.dataset.v === vista && !detalleDe && !fichaDe));
    if (fichaDe) pintarFicha(fichaDe);
    else if (detalleDe) pintarDetalle(detalleDe);
    else ({ mercado: pintarMercado, portafolio: pintarPortafolio, buscar: pintarBuscar, historial: pintarHistorial, supuestos: pintarSupuestos, metodo: pintarMetodo, ajustes: pintarAjustes, perfil: pintarPerfil })[vista]();
    enlazarCabeza();
    if (vista !== "buscar") window.scrollTo(0, 0);
  }
  function enlazarCabeza() {
    $("#volver") && ($("#volver").onclick = volver);
    $("#bBuscar") && ($("#bBuscar").onclick = () => (vista !== "buscar" || fichaDe || detalleDe) && ir({ vista: "buscar" }));
    $("#bMenu") && ($("#bMenu").onclick = abrirMenu);
  }
  function abrirMenu() {
    menuAbierto = true; const f = document.createElement("div"); f.className = "velo"; f.id = "velo";
    f.innerHTML = `<div class="menu" role="menu">${Object.entries({ ajustes: IC.ajustes, perfil: IC.perfil, supuestos: IC.supuestos, metodo: IC.metodo, historial: IC.historial }).map(([v, ic]) => `<button role="menuitem" data-v="${v}">${ic}<span>${PAGINAS[v]}</span></button>`).join("")}
      <button role="menuitem" data-v="bloquear">${IC.candado}<span>Bloquear</span></button></div>`;
    document.body.appendChild(f);
    f.onclick = (e) => { const b = e.target.closest("button"); if (!b) return cerrarMenu(); if (b.dataset.v === "bloquear") { cerrarMenu(); return bloquear(); } cerrarMenu(); ir({ vista: b.dataset.v }); };
  }
  function cerrarMenu() { menuAbierto = false; $("#velo")?.remove(); }

  // ── Mercado
  const colorCambio = (dp) => { const x = Math.max(-3, Math.min(3, dp || 0)) / 3, a = [65, 69, 84], r = x < 0 ? [246, 53, 56] : [48, 204, 90], k = Math.abs(x);
    return `rgb(${a.map((v, i) => Math.round(v + (r[i] - v) * k)).join(",")})`; };
  const pctDia = (dp) => (dp == null ? "" : (dp >= 0 ? "+" : "") + dp.toFixed(2) + "%");
  function squarify(items, x, y, w, h) {
    const tot = items.reduce((a, i) => a + i.v, 0); if (!tot || w <= 0 || h <= 0) return [];
    const k = (w * h) / tot, nodos = items.map((i) => ({ ...i, a: i.v * k })), out = [];
    const peor = (fila, lado) => { const s = fila.reduce((a, r) => a + r.a, 0), mx = Math.max(...fila.map((r) => r.a)), mn = Math.min(...fila.map((r) => r.a)); return Math.max((lado * lado * mx) / (s * s), (s * s) / (lado * lado * mn)); };
    const colocar = (fila) => { const s = fila.reduce((a, r) => a + r.a, 0);
      if (w >= h) { const cw = s / h; let cy = y; for (const r of fila) { const rh = r.a / cw; out.push({ ...r, x, y: cy, w: cw, h: rh }); cy += rh; } x += cw; w -= cw; }
      else { const rh = s / w; let cx = x; for (const r of fila) { const rw = r.a / rh; out.push({ ...r, x: cx, y, w: rw, h: rh }); cx += rw; } y += rh; h -= rh; } };
    let fila = [], resto = nodos.slice();
    while (resto.length) { const lado = Math.min(w, h), n = resto[0]; if (!fila.length || peor([...fila, n], lado) <= peor(fila, lado)) { fila.push(n); resto.shift(); } else { colocar(fila); fila = []; } }
    if (fila.length) colocar(fila);
    return out;
  }
  function dibujarMapa() {
    const caja = $("#mapa"); if (!caja || !M) return;
    const W = caja.clientWidth, H = caja.clientHeight, porSector = {};
    for (const a of M.acciones) if (a.mc) { const p = precioDe(a.t); (porSector[a.s] = porSector[a.s] || []).push({ t: a.t, v: a.mc, dp: p?.dp ?? a.dp }); }
    const sectores = Object.entries(porSector).map(([s, xs]) => ({ s, xs: xs.sort((a, b) => b.v - a.v), v: xs.reduce((a, b) => a + b.v, 0) })).sort((a, b) => b.v - a.v);
    let html = "";
    for (const sec of squarify(sectores, 0, 0, W, H)) {
      const cab = sec.h > 44 && sec.w > 60 ? 15 : 0;
      if (cab) html += `<div class="sec" style="left:${sec.x}px;top:${sec.y}px;width:${sec.w}px">${esc(sec.s)}</div>`;
      for (const c of squarify(sec.xs, sec.x, sec.y + cab, sec.w, sec.h - cab)) {
        const fs = Math.max(9, Math.min(22, Math.min(c.w / 3.4, c.h / 2.4)));
        const txt = c.w >= 24 && c.h >= 15 ? `<b style="font-size:${fs}px">${esc(c.t)}</b>${c.h >= 34 && c.w >= 36 ? `<small>${pctDia(c.dp)}</small>` : ""}` : "";
        html += `<button class="celda" data-t="${esc(c.t)}" aria-label="${esc(c.t)} ${pctDia(c.dp)}" style="left:${c.x}px;top:${c.y}px;width:${c.w}px;height:${c.h}px;background:${colorCambio(c.dp)}">${txt}</button>`;
      }
    }
    caja.innerHTML = html;
    caja.onclick = (e) => { const b = e.target.closest(".celda"); if (b) ir({ fichaDe: b.dataset.t }); };
  }
  function pintarMercado() {
    const hora = M ? new Date(M.hora).toLocaleTimeString("es", { hour: "numeric", minute: "2-digit" }) + " · " + new Date(M.hora).toLocaleDateString("es", { day: "numeric", month: "short" }) : null;
    const saludo = privado.nombre ? `Hola, ${esc(privado.nombre)}` : "Bolsa de EE. UU.";
    $("#app").innerHTML = cabeza("Mercado", horaVivo ? `${saludo} · <span class="punto"></span>en vivo ${horaVivo.toLocaleTimeString("es", { hour: "numeric", minute: "2-digit" })}` : saludo) + `
      <div class="indices">${INDICES.map(([t, n]) => { const q = vivos[t]; return `<div class="indice"><span class="tenue">${esc(n)}</span><b class="${q ? (q.dp >= 0 ? "sube" : "baja") : ""}">${q ? pctDia(q.dp) : "—"}</b><small class="tenue num">${q ? (t.includes(":") ? "" : t + " ") + dinero(q.c) : "sin conexión"}</small></div>`; }).join("")}</div>
      <div class="contenedor">
      ${privado.finnhub ? "" : '<div class="aviso-caja">Activa los precios en vivo en el menú → Ajustes para ver índices y precios del día.</div>'}
      <div class="titulo-sec"><h2>Mapa del S&P 500</h2><span class="tenue">${hora ? "Foto " + hora : ""}</span></div>
      ${M ? '<div id="mapa" class="mapa"></div><div class="escala"><span>−3%</span><i></i><span>+3%</span></div>' : '<div class="tarjeta tenue">El mapa aparece en cuanto se active la foto automática del mercado en GitHub.</div>'}
      <div class="titulo-sec"><h2>Las 10 más grandes</h2><span class="tenue">S&P 500</span></div>
      <div class="lista">${top10().map((a, i) => { const p = precioDe(a.t); return `<button class="fila" data-t="${esc(a.t)}"><span class="rk">${i + 1}</span><div><div class="tk">${esc(a.t)}</div><div class="nm">${esc(a.n)}</div></div><div class="c"><b>${dinero(p?.c)}</b><small class="${(p?.dp ?? 0) >= 0 ? "sube" : "baja"}">${pctDia(p?.dp)}</small></div></button>`; }).join("") || '<div class="fila tenue">Disponible con la foto del mercado.</div>'}</div>
      <p class="leyenda">Los índices se siguen a través de sus fondos (SPY, QQQ, DIA, IWM), que se mueven casi igual que el índice. Toca cualquier acción para ver su ficha.</p></div>`;
    dibujarMapa();
    $$(".fila[data-t]").forEach((b) => (b.onclick = () => ir({ fichaDe: b.dataset.t })));
  }

  // ── Buscador (todas las acciones de EE. UU.)
  async function cargarSimbolos() {
    if (SIMS) return SIMS;
    try { SIMS = await fetch("simbolos.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : Promise.reject())); }
    catch { SIMS = [...new Map([...(M?.acciones || []).map((a) => [a.t, [a.t, a.n]]), ...D.acciones.map((a) => [a.t, [a.t, a.n]])]).values()]; }
    return SIMS;
  }
  function pintarBuscar() {
    $("#app").innerHTML = cabeza("Buscar", "Todas las acciones de EE. UU.") + `<div class="contenedor"><input id="q" class="buscador" type="search" placeholder="Ticker o nombre (ej. AAPL, Nvidia)" autocomplete="off" autocapitalize="characters" spellcheck="false"><div id="res" class="lista"></div></div>`;
    const q = $("#q"), res = $("#res");
    const mostrar = async () => {
      const t = q.value.trim().toUpperCase(); if (!t) { res.innerHTML = '<div class="fila tenue">Escribe para buscar.</div>'; return; }
      const sims = await cargarSimbolos(), tn = t.toLowerCase();
      const exactos = sims.filter(([s]) => s === t), pref = sims.filter(([s]) => s !== t && s.startsWith(t)), nom = sims.filter(([s, n]) => !s.startsWith(t) && n.toLowerCase().includes(tn));
      const r = [...exactos, ...pref.sort((a, b) => a[0].length - b[0].length), ...nom].slice(0, 40);
      res.innerHTML = r.map(([s, n]) => `<button class="fila" data-t="${esc(s)}"><div><div class="tk">${esc(s)}</div><div class="nm">${esc(n)}</div></div>${D.acciones.some((a) => a.t === s) ? '<span class="chip">En tu portafolio</span>' : ""}</button>`).join("") || '<div class="fila tenue">Sin resultados.</div>';
    };
    q.oninput = mostrar; res.onclick = (e) => { const b = e.target.closest(".fila[data-t]"); if (b) ir({ fichaDe: b.dataset.t }); };
    mostrar(); setTimeout(() => q.focus(), 50);
  }

  // ── Ficha de cualquier acción
  async function cargarFicha(t) {
    if (!privado.finnhub) return;
    const f = (fichas[t] = fichas[t] || {});
    const [q, p, m] = await Promise.all([cotizar(t).catch(() => null), f.p ? f.p : api("stock/profile2", { symbol: t }).catch(() => null), f.m ? f.m : api("stock/metric", { symbol: t, metric: "all" }).catch(() => null)]);
    if (q?.c) vivos[t] = q; if (p) f.p = p; if (m) f.m = m; f.listo = true;
    if (fichaDe === t && !menuAbierto) { const y = scrollY; pintarFicha(t); scrollTo(0, y); }
  }
  function pintarFicha(t) {
    const f = fichas[t] || {}, q = precioDe(t), p = f.p || {}, m = f.m?.metric || {}, base = M?.acciones.find((a) => a.t === t), enPort = D.acciones.find((a) => a.t === t);
    const nombre = p.name || base?.n || enPort?.n || (SIMS || []).find((x) => x[0] === t)?.[1] || t;
    const dato = (l, v) => `<div><span class="etiqueta">${l}</span><b class="num">${v ?? "—"}</b></div>`;
    const mc = p.marketCapitalization || m.marketCapitalization, mcTxt = mc ? (mc >= 1e6 ? "$" + (mc / 1e6).toFixed(2) + " billones" : mc >= 1e3 ? "$" + (mc / 1e3).toFixed(1) + " mil millones" : "$" + mc.toFixed(0) + " millones") : null;
    const pe = m.peTTM ?? m.peBasicExclExtraTTM ?? m.peNormalizedAnnual;
    $("#app").innerHTML = cabeza(esc(nombre), `${esc(t)}${p.exchange ? " · " + esc(p.exchange) : ""}${p.finnhubIndustry || base?.s ? " · " + esc(p.finnhubIndustry || base.s) : ""}`) + `<div class="contenedor">
      <div class="precio-grande"><b class="num">${dinero(q?.c)}</b><span class="${(q?.dp ?? 0) >= 0 ? "sube" : "baja"} num">${q?.d != null ? (q.d >= 0 ? "+" : "") + q.d.toFixed(2) + " " : ""}${pctDia(q?.dp)} hoy</span></div>
      ${enPort ? '<button class="btn" id="verValor">Ver valor justo e intrínseco</button>' : '<div class="aviso-caja">El valor justo e intrínseco de esta acción llegará en la siguiente etapa. Por ahora está disponible para las acciones de tu portafolio.</div>'}
      <div class="tarjeta"><div class="datos">${dato("Apertura", q?.o ? dinero(q.o) : null)}${dato("Cierre anterior", q?.pc ? dinero(q.pc) : null)}${dato("Máximo del día", q?.h ? dinero(q.h) : null)}${dato("Mínimo del día", q?.l ? dinero(q.l) : null)}
        ${dato("Máximo 52 semanas", m["52WeekHigh"] ? dinero(m["52WeekHigh"]) : null)}${dato("Mínimo 52 semanas", m["52WeekLow"] ? dinero(m["52WeekLow"]) : null)}${dato("Capitalización", mcTxt)}${dato("P/E (12 meses)", pe ? pe.toFixed(1) + "×" : null)}
        ${dato("Beta", m.beta ? m.beta.toFixed(2) : null)}${dato("Dividendo anual", m.dividendYieldIndicatedAnnual ? m.dividendYieldIndicatedAnnual.toFixed(2) + "%" : "—")}</div></div>
      <p class="tenue">${privado.finnhub ? (f.listo ? "Datos de Finnhub." : "Cargando datos…") : "Activa los precios en vivo en el menú → Ajustes para ver todos los datos."}</p></div>`;
    enlazarCabeza();
    $("#verValor") && ($("#verValor").onclick = () => { pila.push({ vista, detalleDe, fichaDe }); fichaDe = null; detalleDe = t; pintar(); });
    if (privado.finnhub && !f.listo && !f.cargando) { f.cargando = true; fichas[t] = f; cargarFicha(t).finally(() => (f.cargando = false)); }
  }

  // ── Portafolio
  // Verde: el valor está 10% o más por encima del precio. Rojo: 10% o más por debajo. Amarillo: entre −9.99% y +9.99%.
  const tono = (v, p) => { if (v == null) return ""; const d = v / p - 1; return d >= 0.10 ? "t-verde" : d <= -0.10 ? "t-rojo" : "t-amar"; };
  const celda = (v, p) => `<div class="c ${tono(v, p)}"><b>${dinero(v)}</b><small>${v == null ? "" : pct(v / p - 1)}</small></div>`;
  function pintarPortafolio() {
    const filas = D.acciones.map((b) => { const s = accion(b.t), r = calc(s); return { s, r, d: r.fv != null ? r.fv / s.price - 1 : null }; });
    const bajo = filas.filter((f) => f.d != null && f.d > 0).length;
    const prom = filas.filter((f) => f.d != null).reduce((a, f) => a + f.d, 0) / filas.length;
    $("#app").innerHTML = cabeza("Mi portafolio", horaVivo ? `<span class="punto"></span>Precios en vivo · ${horaVivo.toLocaleTimeString("es", { hour: "numeric", minute: "2-digit" })} · Valores al ${fechaLarga(D.actualizado)}` : `Valores al ${fechaLarga(D.actualizado)}${privado.finnhub ? "" : " · Activa los precios en vivo en Ajustes"}`) + `<div class="contenedor">
      <div class="resumen"><div><b>${filas.length}</b><span>Acciones</span></div><div><b>${bajo}</b><span>Bajo su valor justo</span></div><div><b class="${prom >= 0 ? "sube" : "baja"}">${pct(prom)}</b><span>Potencial promedio</span></div></div>
      <div class="lista"><div class="enc"><span>Acción</span><span>Precio</span><span>Valor justo</span><span>Intrínseco</span></div>
      ${filas.map(({ s, r, d }) => `<button class="accion" data-t="${esc(s.t)}"><div><div class="tk">${esc(s.t)}</div><div class="nm">${esc(s.n)}</div></div>
        <div class="c"><b>${dinero(s.price)}</b>${s.enVivo ? `<small class="vivo ${s.enVivo.dp >= 0 ? "sube" : "baja"}">${s.enVivo.dp >= 0 ? "+" : ""}${(s.enVivo.dp ?? 0).toFixed(2)}% hoy</small>` : ""}</div>
        ${celda(r.fv, s.price)}${celda(r.vi, s.price)}</button>`).join("")}</div>
      <p class="leyenda"><span class="t-verde"><b>Verde</b></span>: el valor está 10% o más por encima del precio (barata). <span class="t-amar"><b>Amarillo</b></span>: a menos de 10%. <span class="t-rojo"><b>Rojo</b></span>: el precio está 10% o más por encima del valor (cara). Toca una acción para ver sus 13 modelos.</p></div>`;
    $$(".accion").forEach((b) => (b.onclick = () => ir({ detalleDe: b.dataset.t })));
  }

  // ── Detalle
  const CAMPOS = [["price", "Precio actual $"], ["epsN", "EPS normalizado $"], ["epsFwd", "EPS próximo año $"], ["epsG3", "Crec. EPS consenso 3 años %"], ["gHist", "Crec. histórico %"], ["fcf", "Flujo de caja libre (mil M $)"], ["beta", "Beta"], ["roe", "ROE %"], ["shares", "Acciones (mil M)"], ["moatYrs", "Años de ventaja (etapa II)"]];
  function franja(r, P) {
    const vals = r.ms.filter((m) => m.val != null).map((m) => m.val).concat([P]);
    let lo = Math.min(...vals), hi = Math.max(...vals); const pad = (hi - lo) * 0.05 || 1;
    const x = (v) => (((v - lo + pad) / (hi - lo + 2 * pad)) * 100).toFixed(2) + "%";
    const ag = (v, c) => (v == null ? "" : `<span class="ag ${c}" style="left:${x(v)}"></span>`);
    return `<div class="franja" aria-hidden="true"><div class="eje"></div>${r.ms.filter((m) => m.val != null).map((m) => `<i style="left:${x(m.val)}"></i>`).join("")}${ag(r.vi, "i")}${ag(r.fv, "j")}${ag(P, "p")}</div>
      <div class="extremos"><span>${dinero(lo)}</span><span>${dinero(hi)}</span></div>
      <div class="ley"><span><i class="p"></i>Precio</span><span><i class="j"></i>Valor justo</span><span><i class="i"></i>Intrínseco</span><span><i></i>Cada modelo</span></div>`;
  }
  function pintarDetalle(t) {
    const s = accion(t), r = calc(s), [v, c] = veredicto(r.fv, s.price);
    const filas = (g) => r.ms.filter((m) => m.grp === g).map((m) => `<div class="modelo"><div class="n">${esc(m.name)}</div>
      <div class="v">${m.val == null ? '<span class="tenue">No aplica</span>' : m.out ? `<span class="tachado">${dinero(m.val)}</span>` : dinero(m.val)}</div>
      <div class="f">${esc(m.note)}${m.out ? " · Excluido por extremo" : ""}</div><div class="s">${esc(m.src)}</div></div>`).join("");
    $("#app").innerHTML = cabeza(esc(s.n), `${esc(s.t)} · ${s.enVivo ? "precio en vivo" : "precio al " + fechaLarga(s.pDate)}${privado.edits[t] ? " · con tus ajustes" : ""}`) + `<div class="contenedor">
      <span class="chip ${c}">${v}${r.fv ? " · " + pct(r.fv / s.price - 1) : ""}</span>
      <div class="cifras"><div class="p"><span class="etiqueta">Precio</span><b>${dinero(s.price)}</b></div><div class="j ${tono(r.fv, s.price)}"><span class="etiqueta">Valor justo</span><b>${dinero(r.fv)}</b><small>${r.fv == null ? "" : pct(r.fv / s.price - 1)}</small></div><div class="i ${tono(r.vi, s.price)}"><span class="etiqueta">Intrínseco</span><b>${dinero(r.vi)}</b><small>${r.vi == null ? "" : pct(r.vi / s.price - 1)}</small></div></div>
      ${franja(r, s.price)}
      <div class="tarjeta"><div class="etiqueta">Otras referencias</div><p style="margin:6px 0 0">Mediana de los modelos <b class="num">${dinero(r.med)}</b> · Método Alpha Spread <b class="num">${dinero(r.as)}</b> · Objetivo de analistas a 12 meses <b class="num">${dinero(s.target)}</b> <span class="tenue">(no entra en el cálculo)</span></p></div>
      <div class="aviso-caja">${esc(s.flag)}<div class="tenue" style="margin-top:6px">EPS usado: ${esc(s.epsNnote)}. Crecimiento: ${esc(s.gHistNote)}. Próximos resultados: ${esc(s.nextER)}.</div></div>
      <h2>Valor intrínseco</h2><p class="tenue">Promedio de los modelos absolutos: solo lo que el negocio gana y produce en efectivo.</p><div class="lista">${filas("int")}</div>
      <h2>Valoración relativa</h2><p class="tenue">Se suman a los anteriores para obtener el valor justo.</p><div class="lista">${filas("rel")}</div>
      <h2>Ajusta los números</h2><p class="tenue">Cambia un dato y todo se recalcula. Se guarda cifrado en este teléfono hasta la próxima actualización mensual.</p>
      <div class="tarjeta"><div class="campos">${CAMPOS.map(([k, l]) => `<div><label for="f-${k}">${l}</label><input id="f-${k}" data-k="${k}" type="number" step="any" inputmode="decimal" value="${s[k] ?? ""}" placeholder="${k === "moatYrs" ? "automático" : ""}"></div>`).join("")}</div>
      <button class="btn secundario" id="restaurar">Restaurar datos originales</button></div></div>`;
    enlazarCabeza();
    $("#restaurar").onclick = async () => { delete privado.edits[t]; await guardarPrivado(); pintar(); toast("Datos restaurados"); };
    $$("input[data-k]").forEach((i) => (i.onchange = async () => { privado.edits[t] = privado.edits[t] || {}; privado.edits[t][i.dataset.k] = i.value === "" ? null : +i.value; await guardarPrivado(); const y = scrollY; pintarDetalle(t); scrollTo(0, y); }));
  }

  // ── Historial
  function pintarHistorial() {
    const h = (D.historial || []).slice().reverse(), porFecha = {};
    h.forEach((e) => (porFecha[e.fecha] = porFecha[e.fecha] || []).push(e));
    $("#app").innerHTML = cabeza("Historial", "Cómo cambia el valor con cada actualización") + `<div class="contenedor">
      <p class="tenue">El día 20 de cada mes se revisan resultados trimestrales, precios, tasas, estimados de analistas, competidores y noticias, como hacen Morningstar, GuruFocus y Simply Wall St. Cada cambio queda aquí.</p>
      ${Object.entries(porFecha).map(([f, es]) => `<div class="fecha-hist">${fechaLarga(f)}</div><div class="lista"><div class="hist tenue" style="font-size:12px"><span>Acción</span><span class="r">Precio</span><span class="r">Justo</span><span class="r">Intrínseco</span></div>
        ${es.map((e) => `<div class="hist"><b>${esc(e.t)}</b><span class="r">${dinero(e.precio)}</span><span class="r" style="color:var(--oro)">${dinero(e.fv)}</span><span class="r">${dinero(e.vi)}</span><span class="motivo">${esc(e.motivo)}</span></div>`).join("")}</div>`).join("") || '<p class="tenue">Aún no hay actualizaciones.</p>'}
      <h2>Próximos resultados</h2><div class="lista">${D.acciones.map((s) => `<div class="hist"><b>${esc(s.t)}</b><span style="grid-column:2/-1" class="tenue">${esc(s.nextER)}</span></div>`).join("")}</div></div>`;
  }

  // ── Supuestos
  function pintarSupuestos() {
    const m = mercado();
    $("#app").innerHTML = cabeza("Supuestos", "Tasas que usan los modelos") + `<div class="contenedor">
      <div class="tarjeta"><div class="campos">
        <div><label for="rf">Tasa libre de riesgo %</label><input id="rf" type="number" step="0.01" inputmode="decimal" value="${m.rf}"></div>
        <div><label for="erp">Prima de riesgo %</label><input id="erp" type="number" step="0.01" inputmode="decimal" value="${m.erp}"></div>
        <div><label for="tg">Crecimiento perpetuo %</label><input id="tg" type="number" step="0.1" inputmode="decimal" value="${m.tg}"></div></div>
        <p class="tenue">${esc(D.mercado.rf_fuente)}. ${esc(D.mercado.erp_fuente)}. ${esc(D.mercado.tg_fuente)}.</p>
        <label class="interruptor"><span>Excluir resultados extremos (regla de InvestingPro: más de 100% arriba o 60% abajo del precio)</span><input type="checkbox" id="excl" ${privado.excl ? "checked" : ""}></label>
        <button class="btn secundario" id="reset">Volver a los valores originales</button></div>
</div>`;
    for (const k of ["rf", "erp", "tg"]) $("#" + k).onchange = async () => { privado.mkt = { ...mercado(), [k]: +$("#" + k).value }; privado.mktDe = D.actualizado; await guardarPrivado(); toast("Guardado"); };
    $("#excl").onchange = async () => { privado.excl = $("#excl").checked; await guardarPrivado(); toast("Guardado"); };
    $("#reset").onclick = async () => { privado.mkt = null; privado.excl = true; privado.edits = {}; await guardarPrivado(); pintar(); toast("Valores originales"); };
  }


  // ── Ajustes
  function pintarAjustes() {
    $("#app").innerHTML = cabeza("Ajustes", "Precios en vivo y seguridad") + `<div class="contenedor">
      <h2>Precios en vivo</h2><div class="tarjeta">
        <p class="tenue" style="margin:0 0 8px">Yahoo Finance y Google Finance no permiten que una app personal lea sus precios directamente, así que la app usa <b>Finnhub</b>, que es gratis. Crea una cuenta en finnhub.io, copia tu “API key” del panel y pégala aquí. Se guarda cifrada en este teléfono y los precios se actualizan cada minuto mientras la app está abierta.</p>
        <label for="fk">Llave de Finnhub (API key)</label><input id="fk" type="password" autocomplete="off" value="${esc(privado.finnhub || "")}">
        <div class="error" id="errk">${esc(privado.vivoError || "")}</div><button class="btn" id="guardarK">Guardar y conectar</button>
        ${privado.finnhub ? '<button class="btn secundario" id="quitarK">Desconectar precios en vivo</button>' : ""}</div>
      <h2>Seguridad</h2><div class="tarjeta"><p class="tenue" style="margin:0 0 8px">Tus ajustes se guardan cifrados (AES-256) en este teléfono. La app se bloquea sola después de 2 minutos en segundo plano.</p>
        <label for="ca">Código actual</label><input id="ca" type="password" autocomplete="current-password">
        <label for="cn" style="margin-top:10px">Nuevo código (mínimo 6)</label><input id="cn" type="password" autocomplete="new-password">
        <label for="cr" style="margin-top:10px">Repite el nuevo código</label><input id="cr" type="password" autocomplete="new-password">
        <div class="error" id="err"></div><button class="btn" id="cambiarCod">Cambiar código</button></div>
      <button class="btn peligro" id="bloq">Bloquear ahora</button></div>`;
    $("#guardarK").onclick = async () => { privado.finnhub = $("#fk").value.trim() || null; privado.vivoError = null; await guardarPrivado(); vivos = {}; horaVivo = null; toast(privado.finnhub ? "Conectando…" : "Guardado"); iniciarVivos(); setTimeout(() => vista === "ajustes" && pintar(), 2500); };
    $("#quitarK") && ($("#quitarK").onclick = async () => { privado.finnhub = null; clearInterval(relojVivo); vivos = {}; horaVivo = null; await guardarPrivado(); pintar(); });
    $("#cambiarCod").onclick = async () => {
      const ca = $("#ca").value, cn = $("#cn").value, cr = $("#cr").value;
      if (cn.length < 6) return ($("#err").textContent = "Mínimo 6 caracteres.");
      if (cn !== cr) return ($("#err").textContent = "Los códigos nuevos no coinciden.");
      try { const b = await almacen.obtener("boveda"); await descifrar(await derivarLlave(ca, desdeB64(b.sal)), b.iv, b.ct); } catch { return ($("#err").textContent = "El código actual no es correcto."); }
      $("#cambiarCod").disabled = true; sal = crypto.getRandomValues(new Uint8Array(16)); llave = await derivarLlave(cn, sal); await guardarPrivado(); pintar(); toast("Código cambiado");
    };
    $("#bloq").onclick = bloquear;
  }

  // ── Perfil
  function pintarPerfil() {
    $("#app").innerHTML = cabeza("Perfil", "Tus datos en este teléfono") + `<div class="contenedor">
      <div class="tarjeta"><label for="nom">Tu nombre</label><input id="nom" type="text" autocomplete="given-name" value="${esc(privado.nombre || "")}" placeholder="Para saludarte en la pantalla principal">
      <button class="btn" id="gNom">Guardar</button></div>
      <div class="tarjeta"><div class="datos"><div><span class="etiqueta">Acciones en tu portafolio</span><b>${D.acciones.length}</b></div><div><span class="etiqueta">Precios en vivo</span><b>${privado.finnhub ? "Conectados" : "Sin conectar"}</b></div>
      <div><span class="etiqueta">Última actualización de valores</span><b>${fechaLarga(D.actualizado)}</b></div><div><span class="etiqueta">Próxima actualización</span><b>Día 20 de cada mes</b></div></div></div>
      <p class="tenue">Todo lo de tu perfil se guarda cifrado solo en este teléfono.</p></div>`;
    $("#gNom").onclick = async () => { privado.nombre = $("#nom").value.trim().slice(0, 40) || null; await guardarPrivado(); toast("Guardado"); };
  }

  // ── Método
  const PARAMS = [["Flujo de caja libre futuro descontado (DCF)","✓","✓","✓","✓","✓"],["Ganancias por acción normalizadas","✓","✓","✓","✓","—"],["Tasa libre de riesgo (bono a 10 años)","✓","✓","—","✓","—"],["Prima de riesgo del mercado","✓","✓","—","✓","—"],["Beta / riesgo sistemático","✓","—","—","✓","—"],["Estimados de crecimiento de analistas","✓","✓","—","✓","✓"],["Crecimiento histórico","—","✓","—","✓","✓"],["Valor terminal / perpetuidad","✓","✓","✓","✓","✓"],["Horizonte de proyección 5–10 años","✓","✓","✓","✓","—"],["Ventaja competitiva: ROIC vs. costo del capital","✓","—","—","—","—"],["Múltiplos históricos propios","—","✓","—","—","✓"],["Múltiplos de competidores","—","—","✓","✓","✓"],["Valor en libros / tangible","—","✓","—","✓","—"],["Dividendos (modelo de descuento)","—","✓","✓","✓","—"],["Caja y deuda neta","✓","—","✓","—","✓"],["Acciones en circulación","✓","✓","✓","✓","✓"],["Escenarios bajista / base / alcista","✓","—","—","—","✓"],["Margen de seguridad / incertidumbre","✓","✓","—","✓","—"],["Excluir modelos que no aplican","✓","✓","✓","✓","—"],["Combinar varios modelos en una cifra","—","✓","✓","—","✓"]];
  function pintarMetodo() {
    $("#app").innerHTML = cabeza("Cómo se calcula", "Valor intrínseco y valor justo") + `<div class="contenedor">
      <div class="tarjeta"><div class="etiqueta">Valor intrínseco</div><p style="margin:6px 0 0">Lo que vale el negocio solo por lo que gana y produce en efectivo, sin mirar cómo cotizan otras acciones. Promedio de los modelos absolutos (DCF, EPV, Graham y dividendos). Es lo que Morningstar llama su “fair value estimate”.</p></div>
      <div class="tarjeta"><div class="etiqueta" style="color:var(--oro)">Valor justo</div><p style="margin:6px 0 0">Promedio simple de todos los modelos que aplican, absolutos y relativos (múltiplos históricos y de competidores), como InvestingPro (hasta 17 modelos) y Alpha Spread (DCF + valoración relativa).</p></div>
      <div class="tarjeta"><div class="etiqueta">Reglas</div><p style="margin:6px 0 0">Un modelo se omite si no aplica (por ejemplo, flujo de caja negativo o dividendo pequeño). Como InvestingPro, se excluyen resultados extremos (lo puedes cambiar en el menú → Supuestos). Veredicto según Simply Wall St: 20% bajo el valor = infravalorada; 40% = muy infravalorada.</p></div>
      <h2>Parámetros comunes</h2><p class="tenue">✓ documentado públicamente · — no lo publican. M Morningstar · G GuruFocus · I InvestingPro · S Simply Wall St · A Alpha Spread.</p>
      <div class="tarjeta" style="padding:6px 8px"><table class="tabla"><thead><tr><th>Parámetro</th><th>M</th><th>G</th><th>I</th><th>S</th><th>A</th></tr></thead><tbody>${PARAMS.map((p) => `<tr><td>${esc(p[0])}</td>${p.slice(1).map((x) => `<td class="m ${x === "✓" ? "ok" : "no"}">${x}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
      <h2>Los 13 modelos</h2><div class="lista">${models(D.acciones[0], D.mercado).map((m) => `<div class="modelo"><div class="n">${esc(m.name)}</div><div class="v tenue" style="font-weight:400">${m.grp === "int" ? "Intrínseco" : "Relativo"}</div><div class="s">${esc(m.src)}</div></div>`).join("")}</div>
      <p class="tenue">Los datos de las acciones son públicos (vienen de los reportes de cada empresa). Lo único privado son tus ajustes, que se guardan cifrados en este teléfono.</p></div>`;
  }

  // ── Arranque
  document.addEventListener("visibilitychange", () => { if (document.hidden) ocultoDesde = Date.now(); else if (llave && Date.now() - ocultoDesde > BLOQUEO_MS) bloquear(); else if (llave) cargarVivos(); });
  const cargarMercado = () => fetch("mercado.json?t=" + Date.now(), { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((m) => { if (m?.acciones) M = m; }).catch(() => {});
  let tamAnt = innerWidth; addEventListener("resize", () => { if (innerWidth !== tamAnt) { tamAnt = innerWidth; dibujarMapa(); } });
  setInterval(() => !document.hidden && llave && cargarMercado().then(() => vista === "mercado" && !fichaDe && !menuAbierto && dibujarMapa()), 5 * 60000);
  Promise.all([fetch("data.json?t=" + Date.now(), { cache: "no-store" }).then((r) => r.json()), cargarMercado()]).then(([d]) => { D = d; pintarBloqueo(); })
    .catch(() => { $("#app").innerHTML = '<div class="bloqueo"><h1>Inversiones</h1><p class="tenue">No se pudieron cargar los datos. Revisa tu conexión y vuelve a abrir la app.</p></div>'; });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
