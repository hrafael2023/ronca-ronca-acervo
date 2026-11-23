#!/usr/bin/env python3
"""Atualiza o acervo do Ronca Ronca a partir da planilha DataRonca.

1. Baixa a aba FULL LIST da planilha (CSV público).
2. Gera data/acervo.json com todas as faixas, agrupadas por programa.
3. Procura capas no Deezer para faixas novas e guarda em data/capas.json
   (cache: cada faixa é procurada uma vez; as não encontradas voltam a ser
   tentadas depois de DIAS_REPETIR dias).

Uso:  python3 scripts/atualizar.py [--limite N] [--csv arquivo.csv]
"""
import argparse
import csv
import difflib
import io
import json
import re
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
import time
import unicodedata
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

PLANILHA = "148SkL4ae68ZKFHottlhac6KvgxN848XZk9TasNomVoY"
CSV_URL = f"https://docs.google.com/spreadsheets/d/{PLANILHA}/export?format=csv&gid=0"
RAIZ = Path(__file__).resolve().parent.parent
ACERVO = RAIZ / "data" / "acervo.json"
CAPAS = RAIZ / "data" / "capas.json"
FALHAS = RAIZ / "data" / "capas-falhas.json"
DIAS_REPETIR = 30
UA = "acervo-ronca/1.0"


def baixar(url, tentativas=3):
    for i in range(tentativas):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read().decode("utf-8")
        except Exception as e:  # noqa: BLE001
            if i == tentativas - 1:
                raise
            time.sleep(2 + i * 3)


def norm(s):
    s = unicodedata.normalize("NFKD", s.lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.replace("’", "'").replace("&", " and ")
    s = re.sub(r"^the ", "", s.strip())
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def limpar_musica(s):
    """Tira observações entre parênteses/colchetes: (ao vivo), (peel session, 1980)…"""
    s = re.sub(r"[\(\[][^\)\]]*[\)\]]", " ", s)
    s = re.sub(r"\s+-\s+.*$", "", s)
    return re.sub(r"\s+", " ", s).strip() or s


def chave(artista, musica):
    return f"{artista.strip().lower()}|{musica.strip().lower()}"


def ler_planilha(texto):
    linhas = list(csv.reader(io.StringIO(texto)))
    programa = None
    faixas = []
    for l in linhas[1:]:
        l = (l + [""] * 5)[:5]
        show, artista, musica, ano_ronca, ano_lanc = (c.strip() for c in l)
        if show:
            m = re.search(r"\d+", show)
            programa = int(m.group()) if m else None
        if not artista and not musica:
            continue
        if programa is None:
            continue
        faixas.append({
            "p": programa,
            "a": artista,
            "m": musica,
            "ar": int(ano_ronca) if ano_ronca.isdigit() else None,
            "al": int(ano_lanc) if ano_lanc.isdigit() else None,
        })
    return faixas


def montar_acervo(faixas):
    progs = {}
    for f in faixas:
        p = progs.setdefault(f["p"], {"n": f["p"], "ano": f["ar"], "f": []})
        if p["ano"] is None:
            p["ano"] = f["ar"]
        p["f"].append([f["a"], f["m"], f["al"]])
    lista = sorted(progs.values(), key=lambda p: -p["n"])
    return {
        "atualizado": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "fonte": f"https://docs.google.com/spreadsheets/d/{PLANILHA}",
        "programas": lista,
    }


# ---------- capas ----------

def _um_artista_bate(a, b):
    a, b = norm(a), norm(b)
    if not a or not b:
        return False
    return a == b or a in b or b in a or difflib.SequenceMatcher(None, a, b).ratio() >= 0.85


def artista_bate(a, b):
    """Aceita parcerias: 'herbie hancock & tinariwen' bate com 'Herbie Hancock'."""
    partes = re.split(r"\s+(?:&|e|and|feat\.?|ft\.?|with|x|vs\.?)\s+|,\s*|/", a.lower())
    return _um_artista_bate(a, b) or any(_um_artista_bate(p, b) for p in partes if len(norm(p)) > 2)


def musica_bate(a, b):
    a, b = norm(limpar_musica(a)), norm(limpar_musica(b))
    if not a or not b:
        return False
    return a == b or a.startswith(b) or b.startswith(a) or difflib.SequenceMatcher(None, a, b).ratio() >= 0.75


def md5_capa(url):
    m = re.search(r"/images/cover/([0-9a-f]{32})/", url or "")
    return m.group(1) if m else None


ultimo_pedido = [0.0]
trava = threading.Lock()


def deezer(q):
    # Deezer aceita ~50 pedidos a cada 5 s; ficamos em ~8/s somando as threads.
    with trava:
        espera = 0.125 - (time.time() - ultimo_pedido[0])
        if espera > 0:
            time.sleep(espera)
        ultimo_pedido[0] = time.time()
    url = "https://api.deezer.com/search?limit=15&q=" + urllib.parse.quote(q)
    for _ in range(5):
        d = json.loads(baixar(url))
        if "error" in d:  # cota estourada: espera e tenta de novo
            time.sleep(5)
            continue
        return d.get("data", [])
    return []


def procurar_capa(artista, musica):
    limpa = limpar_musica(musica)
    for q in (f"{artista} {limpa}", f"{limpa} {artista}"):
        res = deezer(q)
        for r in res:
            if artista_bate(artista, r["artist"]["name"]) and musica_bate(musica, r.get("title_short") or r["title"]):
                capa = md5_capa(r["album"].get("cover_medium"))
                if capa:
                    return [capa, r["album"]["title"], r["id"], r["artist"]["name"]]
        if res:
            break
    # Sem a música: pelo menos uma capa do artista não ajuda (seria enganosa). Ignora.
    return None


def carregar(p, padrao):
    try:
        return json.loads(p.read_text())
    except Exception:  # noqa: BLE001
        return padrao


def salvar_json(p, obj, compacto=True):
    if compacto:
        txt = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    else:  # uma entrada por linha, para diffs legíveis no git
        txt = json.dumps(obj, ensure_ascii=False, indent=0, sort_keys=True)
    p.write_text(txt + "\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limite", type=int, default=2000, help="máximo de buscas de capa nesta rodada")
    ap.add_argument("--csv", help="usar um CSV local em vez de baixar")
    args = ap.parse_args()

    texto = Path(args.csv).read_text() if args.csv else baixar(CSV_URL)
    faixas = ler_planilha(texto)
    if len(faixas) < 1000:
        sys.exit(f"Planilha veio com só {len(faixas)} faixas — abortando para não apagar o acervo.")
    acervo = montar_acervo(faixas)

    antigo = carregar(ACERVO, {})
    if antigo.get("programas") != acervo["programas"]:
        salvar_json(ACERVO, acervo)
        print(f"acervo.json: {len(faixas)} faixas, {len(acervo['programas'])} programas")
    else:
        print("acervo.json: sem mudanças")

    capas = carregar(CAPAS, {})
    falhas = carregar(FALHAS, {})
    hoje = datetime.now(timezone.utc).date()
    pendentes = []
    vistas = set()
    for f in faixas:  # mais recentes primeiro
        k = chave(f["a"], f["m"])
        if k in vistas or k in capas:
            continue
        vistas.add(k)
        quando = falhas.get(k)
        if quando and (hoje - datetime.fromisoformat(quando).date()) < timedelta(days=DIAS_REPETIR):
            continue
        pendentes.append((k, f["a"], f["m"]))

    print(f"capas: {len(capas)} em cache, {len(pendentes)} para procurar (limite {args.limite})")
    achadas = 0

    def tentar(item):
        k, a, m = item
        try:
            return k, procurar_capa(a, m), None
        except Exception as e:  # noqa: BLE001
            return k, None, e

    with ThreadPoolExecutor(max_workers=6) as ex:
        resultados = ex.map(tentar, pendentes[: args.limite])
        for i, (k, r, erro) in enumerate(resultados, 1):
            if erro:
                print(f"  erro em {k}: {erro}")
                continue
            if r:
                capas[k] = r
                falhas.pop(k, None)
                achadas += 1
            else:
                falhas[k] = hoje.isoformat()
            if i % 200 == 0:
                print(f"  {i}/{min(len(pendentes), args.limite)} — {achadas} achadas", flush=True)
                salvar_json(CAPAS, capas, compacto=False)
                salvar_json(FALHAS, falhas, compacto=False)
    salvar_json(CAPAS, capas, compacto=False)
    salvar_json(FALHAS, falhas, compacto=False)
    print(f"capas: +{achadas} novas, total {len(capas)}")


if __name__ == "__main__":
    main()
