#!/usr/bin/env python3
"""Atualiza o acervo do Ronca Ronca a partir da planilha DataRonca.

1. Baixa a aba FULL LIST da planilha (CSV público).
2. Gera data/acervo.json com todas as faixas, agrupadas por programa.
3. Lê os posts "a bula do #N" do site oficial e guarda as fotos dos discos
   em data/fotos-site.json (elas têm prioridade sobre o Deezer no site).
4. Procura capas no Deezer para faixas novas e guarda em data/capas.json
   (cache: cada faixa é procurada uma vez; as não encontradas voltam a ser
   tentadas depois de DIAS_REPETIR dias).

Uso:  python3 scripts/atualizar.py [--limite N] [--csv arquivo.csv]
"""
import argparse
import csv
import difflib
import html as html_lib
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
MANUAIS = RAIZ / "data" / "capas-manuais.json"
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


def chave_base(artista, musica):
    """Chave tolerante: sem acento, caixa, pontuação, 'the' e o que vem entre parênteses.
    'Victoria' e 'victoria (exclusivo do #500)' do Autoramas dão a mesma chave."""
    return f"{norm(artista)}|{norm(limpar_musica(musica))}"


def mesma_musica(chave_a, chave_b):
    """Compara duas chaves 'artista|música' com folga, mas exigente: aceita erro de
    digitação e observação entre parênteses ('here come'/'here comes the nice'),
    não aceita músicas parecidas ('let it rain'/'make it rain')."""
    a1, m1 = chave_a.split("|", 1)
    a2, m2 = chave_b.split("|", 1)
    if not artista_bate(a1, a2):
        return False
    x, y = norm(limpar_musica(m1)), norm(limpar_musica(m2))
    return bool(x and y) and (x == y or difflib.SequenceMatcher(None, x, y).ratio() >= 0.85)


class Vinculos:
    """Liga nomes antigos (de capas manuais, cache do Deezer) às faixas atuais da planilha,
    para que corrigir um nome na planilha não perca a capa já escolhida."""

    def __init__(self, faixas):
        self.atuais = {chave(f["a"], f["m"]) for f in faixas}
        self.por_base, self.por_artista = {}, {}
        for k in self.atuais:
            a, m = k.split("|", 1)
            self.por_base.setdefault(chave_base(a, m), []).append(k)
            self.por_artista.setdefault(norm(a), []).append(k)

    def equivalentes(self, k):
        """Faixas atuais que são a 'mesma música' da chave k (pode ser mais de uma variação)."""
        if k in self.atuais:
            return [k]
        a, m = k.split("|", 1)
        achadas = self.por_base.get(chave_base(a, m))
        if achadas:
            return achadas
        candidatas = self.por_artista.get(norm(a)) or [c for c in self.atuais if artista_bate(a, c.split("|", 1)[0])]
        return [c for c in candidatas if mesma_musica(k, c)]


def migrar_manuais(vinc):
    """Capas trocadas à mão cujo nome sumiu da planilha passam para o nome novo (ou nomes)."""
    manuais = carregar(MANUAIS, {})
    mudou = False
    for k in [k for k in manuais if k not in vinc.atuais]:
        novos = [n for n in vinc.equivalentes(k) if n not in manuais]
        if not novos:
            continue
        for n in novos:
            manuais[n] = dict(manuais[k])
            print(f"  capa manual: '{k}' -> '{n}'")
        del manuais[k]
        mudou = True
    if mudou:
        MANUAIS.write_text(json.dumps(dict(sorted(manuais.items())), ensure_ascii=False, indent=1) + "\n")
    return mudou


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


# ---------- fotos dos discos publicadas no site oficial ----------
# Cada post "a bula do #N" traz o setlist e, desde o #126, fotos dos discos do
# acervo do Mauro na vitrola (arquivos N.1.jpg, N.2.jpg…). Cada foto vem logo
# DEPOIS das faixas que ilustra: ela vale para o último artista do bloco de
# faixas entre a foto anterior e ela.

API_POSTS = "https://www.roncaronca.com.br/wp-json/wp/v2/posts"
SITE = "https://www.roncaronca.com.br"
FOTOS = RAIZ / "data" / "fotos-site.json"
FOTO_DISCO = re.compile(r"^\d+\.\d+(?:-\d+)?\.(?:jpe?g|png|webp)$", re.I)  # 728.1.jpg, 427.2-1.jpg
# imagens com estes nomes são banners, apresentadores e convidados — nunca capas
NAO_CAPA = {"free", "radio", "weapon", "tico", "conecta", "musica", "sgr", "bula", "ronca", "nandao",
            "mauro", "emauro", "muzak", "tulio", "jb", "apoiase", "agenda", "vivo", "pgm", "capa"}
LINHA_FAIXA = re.compile(r"^(.+?)\s*[–—-]\s*[“\"″«]\s*(.+?)\s*[”\"″»]")


def posts_bula(paginas):
    """Lista os posts 'a bula do #N' (mais novos primeiro) com o conteúdo."""
    for pagina in range(1, paginas + 1):
        url = f"{API_POSTS}?search=bula&per_page=100&page={pagina}&_fields=id,title,content,link"
        try:
            lote = json.loads(baixar(url))
        except Exception:  # noqa: BLE001  (página além da última dá 400)
            return
        if not lote:
            return
        for p in lote:
            titulo = html_lib.unescape(p["title"]["rendered"])
            m = re.search(r"#\s*(\d+)", titulo)
            if "bula" in titulo.lower() and m:
                yield int(m.group(1)), p


def https(url):
    return re.sub(r"^http://", "https://", url)


def palavras_imagem(img):
    """Palavras do nome do arquivo e do alt: 'pogues.red_.roses_-1.jpg' → {pogues, red, roses}."""
    nome = img["src"].rsplit("/", 1)[-1].rsplit(".", 1)[0]
    nome = re.sub(r"-\d+x\d+$|-\d+$", "", nome)
    return set(norm(nome.replace("_", " ").replace(".", " ").replace("-", " ")).split()) | set(norm(img["alt"]).split())


def artista_na_imagem(artista, palavras):
    toks = [t for t in norm(artista).split() if t not in {"and", "os", "as", "o", "a", "e", "de", "da", "do", "dos"}]
    fortes = [t for t in toks if len(t) >= 4] or toks
    return bool(fortes) and any(t in palavras for t in fortes)


def tokens_post(conteudo):
    """Sequência, na ordem do post, de ('img', {src, pequena}) e ('faixa', (artista, musica))."""
    out = []
    for m in re.finditer(r"<img\b[^>]*>|<p\b[^>]*>(.*?)</p>", conteudo, re.S | re.I):
        tag = m.group(0)
        if tag.lower().startswith("<img"):
            src = re.search(r'\bsrc="([^"]+)"', tag)
            if not src:
                continue
            src = https(urllib.parse.urljoin(SITE, html_lib.unescape(src.group(1))))
            w = re.search(r'\bwidth="(\d+)"', tag)
            h = re.search(r'\bheight="(\d+)"', tag)
            alt = re.search(r'\balt="([^"]*)"', tag)
            pequena = None  # menor versão com pelo menos 300px de largura, para miniaturas
            ss = re.search(r'\bsrcset="([^"]+)"', tag)
            if ss:
                opcoes = []
                for parte in html_lib.unescape(ss.group(1)).split(","):
                    bits = parte.strip().split()
                    if len(bits) == 2 and bits[1].endswith("w"):
                        opcoes.append((int(bits[1][:-1]), https(urllib.parse.urljoin(SITE, bits[0]))))
                boas = sorted(o for o in opcoes if o[0] >= 300)
                if boas and boas[0][1] != src:
                    pequena = boas[0][1]
            out.append(("img", {"src": src, "p": pequena, "w": int(w.group(1)) if w else 0,
                                "h": int(h.group(1)) if h else 0,
                                "alt": html_lib.unescape(alt.group(1)) if alt else ""}))
            # imagem e texto podem estar no mesmo <p>: o texto vem depois
        if m.group(1) is not None:
            for linha in re.split(r"<br\s*/?>", m.group(1), flags=re.I):
                if re.search(r"<img\b", linha, re.I):
                    for im in re.finditer(r"<img\b[^>]*>", linha, re.I):
                        out.extend(tokens_post(f"{im.group(0)}"))
                texto = html_lib.unescape(re.sub(r"<[^>]+>", "", linha)).strip()
                f = LINHA_FAIXA.match(texto)
                if f:
                    out.append(("faixa", (f.group(1).strip(), f.group(2).strip())))
    return out


def fotos_do_post(n, conteudo, faixas_prog):
    """Devolve {chave_da_faixa: [foto, miniatura]} para um programa."""
    por_norm = {}
    for f in faixas_prog:
        por_norm.setdefault(norm(f["a"]), []).append(f)

    def achar(artista, musica):
        for f in por_norm.get(norm(artista), []):
            if musica_bate(musica, f["m"]):
                return f
        for f in faixas_prog:  # artista grafado diferente no post e na planilha
            if musica_bate(musica, f["m"]) and artista_bate(artista, f["a"]):
                return f
        return None

    resultado = {}
    bloco = []
    for tipo, valor in tokens_post(conteudo):
        if tipo == "faixa":
            bloco.append(valor)
            continue
        nome = valor["src"].rsplit("/", 1)[-1]
        alvo = None
        if bloco and FOTO_DISCO.match(nome):
            alvo = norm(bloco[-1][0])  # foto do disco na vitrola: último artista do bloco
        elif bloco and valor["w"] >= 200 and valor["h"] and 0.85 <= valor["w"] / valor["h"] <= 1.18:
            # capa escaneada (quadrada) com o nome do artista no arquivo — posts mais antigos
            palavras = palavras_imagem(valor)
            if not palavras & NAO_CAPA:
                for artista, _ in reversed(bloco):
                    if artista_na_imagem(artista, palavras):
                        alvo = norm(artista)
                        break
        if alvo:
            for artista, musica in bloco:
                if norm(artista) != alvo:
                    continue
                f = achar(artista, musica)
                if f:
                    resultado[chave(f["a"], f["m"])] = [valor["src"], valor["p"]]
        bloco = []  # qualquer imagem fecha o bloco
    return resultado


def atualizar_fotos(faixas, completo):
    """Lê os posts do site e grava data/fotos-site.json: {"N": {chave: [foto, mini]}}."""
    fotos = {} if completo else carregar(FOTOS, {})
    por_prog = {}
    for f in faixas:
        por_prog.setdefault(f["p"], []).append(f)
    vistos, novos = set(), 0
    for n, post in posts_bula(17 if completo or not fotos else 1):
        if n in vistos or n not in por_prog:
            continue  # o primeiro (mais novo) post de cada número vale
        vistos.add(n)
        achadas = fotos_do_post(n, post["content"]["rendered"], por_prog[n])
        if achadas:
            achadas["_post"] = post.get("link")
            if fotos.get(str(n)) != achadas:
                novos += 1
            fotos[str(n)] = achadas
    salvar_json(FOTOS, dict(sorted(fotos.items(), key=lambda x: -int(x[0]))), compacto=False)
    total = sum(len(v) - ("_post" in v) for v in fotos.values())
    print(f"fotos do site: {len(fotos)} programas, {total} faixas com foto ({novos} programas novos/alterados)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limite", type=int, default=2000, help="máximo de buscas de capa nesta rodada")
    ap.add_argument("--csv", help="usar um CSV local em vez de baixar")
    ap.add_argument("--fotos-completo", action="store_true", help="reler todos os posts do site (não só os 100 mais novos)")
    ap.add_argument("--so-fotos", action="store_true", help="só atualizar as fotos do site, sem buscar capas no Deezer")
    args = ap.parse_args()

    texto = Path(args.csv).read_text() if args.csv else baixar(CSV_URL)
    faixas = ler_planilha(texto)
    if len(faixas) < 1000:
        sys.exit(f"Planilha veio com só {len(faixas)} faixas — abortando para não apagar o acervo.")
    acervo = montar_acervo(faixas)

    antigo = carregar(ACERVO, {})
    planilha_mudou = antigo.get("programas") != acervo["programas"]
    if planilha_mudou:
        salvar_json(ACERVO, acervo)
        print(f"acervo.json: {len(faixas)} faixas, {len(acervo['programas'])} programas")
    else:
        print("acervo.json: sem mudanças")

    vinc = Vinculos(faixas)
    if migrar_manuais(vinc):
        print("capas manuais: nomes atualizados conforme a planilha")

    try:
        # Planilha mudou (nomes corrigidos, faixas novas): refaz a ligação foto→faixa de
        # TODOS os programas, comparando com folga o texto da bula com os nomes atuais.
        atualizar_fotos(faixas, args.fotos_completo or planilha_mudou)
    except Exception as e:  # noqa: BLE001  (site fora do ar não pode travar o resto)
        print(f"fotos do site: erro, mantendo as anteriores ({e})")
    if args.so_fotos:
        return

    capas = carregar(CAPAS, {})
    falhas = carregar(FALHAS, {})
    # nome mudou na planilha: reaproveita a capa do Deezer já achada para o nome antigo
    por_base, por_artista = {}, {}
    for k in capas:
        por_base.setdefault(chave_base(*k.split("|", 1)), k)
        por_artista.setdefault(norm(k.split("|", 1)[0]), []).append(k)
    herdadas = 0
    for k in vinc.atuais - capas.keys():
        antigo_k = por_base.get(chave_base(*k.split("|", 1)))
        if not antigo_k:  # erro de digitação corrigido: compara com folga entre as do mesmo artista
            antigo_k = next((c for c in por_artista.get(norm(k.split("|", 1)[0]), []) if mesma_musica(k, c)), None)
        if antigo_k:
            capas[k] = capas[antigo_k]
            falhas.pop(k, None)
            herdadas += 1
    if herdadas:
        print(f"capas: {herdadas} reaproveitadas de nomes antigos")
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
