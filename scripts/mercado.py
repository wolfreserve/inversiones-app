#!/usr/bin/env python3
"""
Foto del mercado para la app Inversiones (corre en GitHub Actions).

  python scripts/mercado.py precios   -> mercado.json  (precio y cambio del día de las ~500 del S&P 500)
  python scripts/mercado.py semanal   -> sp500.json (lista, sector, acciones en circulación) y simbolos.json (buscador)

Necesita la variable de entorno FINNHUB_KEY (secreto del repositorio).
El plan gratis de Finnhub permite 60 consultas por minuto: se espera ~1.05 s entre consultas.
Solo usa la biblioteca estándar de Python.
"""
import csv, io, json, os, sys, time, urllib.parse, urllib.request
from datetime import datetime, timezone

KEY = os.environ.get("FINNHUB_KEY", "").strip()
BASE = "https://finnhub.io/api/v1"
LISTA_SP500 = "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv"
PAUSA = 1.05
SECTORES = {
    "Information Technology": "Tecnología", "Communication Services": "Comunicaciones", "Consumer Discretionary": "Consumo discrecional",
    "Consumer Staples": "Consumo básico", "Health Care": "Salud", "Financials": "Finanzas", "Industrials": "Industria",
    "Energy": "Energía", "Materials": "Materiales", "Real Estate": "Bienes raíces", "Utilities": "Servicios públicos",
}


def get(url, intentos=4):
    for i in range(intentos):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "inversiones-app"}), timeout=30) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 429 and i < intentos - 1:
                time.sleep(20 * (i + 1)); continue
            if e.code in (401, 403):
                sys.exit("La llave de Finnhub no es válida (secreto FINNHUB_KEY).")
            if i == intentos - 1: raise
        except Exception:
            if i == intentos - 1: raise
            time.sleep(5)


def finnhub(ruta, **params):
    params["token"] = KEY
    time.sleep(PAUSA)
    return json.loads(get(f"{BASE}/{ruta}?{urllib.parse.urlencode(params)}"))


def guardar(nombre, obj):
    with open(nombre, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))


def semanal():
    filas = list(csv.DictReader(io.StringIO(get(LISTA_SP500).decode("utf-8"))))
    previo = {a["t"]: a for a in json.load(open("sp500.json"))["acciones"]} if os.path.exists("sp500.json") else {}
    acciones = []
    for f in filas:
        t = f["Symbol"].strip()
        a = {"t": t, "n": f["Security"].strip(), "s": SECTORES.get(f["GICS Sector"], f["GICS Sector"]), "i": f["GICS Sub-Industry"].strip()}
        try:
            p = finnhub("stock/profile2", symbol=t)
            if p.get("shareOutstanding"): a["sh"] = p["shareOutstanding"]  # millones
        except Exception:
            pass
        if "sh" not in a and previo.get(t, {}).get("sh"): a["sh"] = previo[t]["sh"]
        acciones.append(a)
    guardar("sp500.json", {"actualizado": datetime.now(timezone.utc).isoformat(timespec="minutes"), "acciones": acciones})

    sims = finnhub("stock/symbol", exchange="US")
    ok_tipo = {"Common Stock", "ADR", "ETP", "REIT"}
    ok_mic = {"XNYS", "XNAS", "ARCX", "BATS", "XASE"}
    lista = sorted({(s["symbol"], (s.get("description") or "").title()) for s in sims if s.get("type") in ok_tipo and s.get("mic") in ok_mic})
    guardar("simbolos.json", [[t, n] for t, n in lista])
    print(f"sp500.json: {len(acciones)} acciones · simbolos.json: {len(lista)} símbolos")


def precios():
    if not os.path.exists("sp500.json"): semanal()
    base = json.load(open("sp500.json"))["acciones"]
    previo = {a["t"]: a for a in json.load(open("mercado.json"))["acciones"]} if os.path.exists("mercado.json") else {}
    out, ok = [], 0
    for a in base:
        r = {"t": a["t"], "n": a["n"], "s": a["s"]}
        try:
            q = finnhub("quote", symbol=a["t"])
            if q.get("c"):
                r.update(c=round(q["c"], 2), dp=round(q.get("dp") or 0, 2)); ok += 1
        except Exception:
            pass
        if "c" not in r and previo.get(a["t"], {}).get("c"):
            r.update(c=previo[a["t"]]["c"], dp=previo[a["t"]].get("dp", 0))
        if "c" in r and a.get("sh"):
            r["mc"] = round(r["c"] * a["sh"])  # capitalización en millones de dólares
        out.append(r)
    if ok == 0:
        sys.exit("No se obtuvo ningún precio; se conserva la foto anterior.")
    guardar("mercado.json", {"hora": datetime.now(timezone.utc).isoformat(timespec="minutes"), "acciones": out})
    print(f"mercado.json: {ok}/{len(base)} precios")


if __name__ == "__main__":
    if not KEY: sys.exit("Falta el secreto FINNHUB_KEY.")
    {"precios": precios, "semanal": semanal}[sys.argv[1] if len(sys.argv) > 1 else "precios"]()
