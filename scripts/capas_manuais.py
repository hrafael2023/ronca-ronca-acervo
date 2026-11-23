#!/usr/bin/env python3
"""Baixa as capas trocadas à mão (data/capas-manuais.json) para capas/manual/.

O site grava {"artista|música": {"url": "...", "em": "..."}}. Este script baixa
cada URL nova, salva como capas/manual/<id>.<ext> e completa a entrada com
"arquivo" (caminho servido pelo site) e "de" (a URL baixada). Se a URL mudar,
baixa de novo; arquivos que ninguém usa mais são apagados.
"""
import hashlib
import json
import sys
import urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
ARQ = RAIZ / "data" / "capas-manuais.json"
PASTA = RAIZ / "capas" / "manual"
MAX = 10 * 1024 * 1024
TIPOS = {"image/jpeg": ".jpg", "image/jpg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif"}
ASSINATURAS = [(b"\xff\xd8\xff", ".jpg"), (b"\x89PNG", ".png"), (b"GIF8", ".gif")]


def tipo_da_imagem(dados, content_type):
    for sig, ext in ASSINATURAS:
        if dados.startswith(sig):
            return ext
    if dados[:4] == b"RIFF" and dados[8:12] == b"WEBP":
        return ".webp"
    return TIPOS.get((content_type or "").split(";")[0].strip().lower())


def baixar(url):
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (acervo-ronca; capas manuais)",
        "Accept": "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8",
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        dados = r.read(MAX + 1)
        if len(dados) > MAX:
            raise ValueError("imagem maior que 10 MB")
        ext = tipo_da_imagem(dados, r.headers.get("Content-Type"))
        if not ext:
            raise ValueError("o endereço não devolveu uma imagem (jpg, png, webp ou gif)")
        return dados, ext


def main():
    try:
        capas = json.loads(ARQ.read_text() or "{}")
    except FileNotFoundError:
        capas = {}
    PASTA.mkdir(parents=True, exist_ok=True)
    mudou = False
    for chave, e in capas.items():
        url = e.get("url", "")
        if e.get("arquivo") and e.get("de") == url and (RAIZ / e["arquivo"]).exists():
            continue
        try:
            dados, ext = baixar(url)
        except Exception as erro:  # noqa: BLE001
            print(f"ERRO {chave}: {erro}")
            if e.get("erro") != str(erro):
                e["erro"] = str(erro)
                mudou = True
            continue
        nome = hashlib.sha1(chave.encode()).hexdigest()[:12] + "-" + hashlib.sha1(dados).hexdigest()[:8] + ext
        (PASTA / nome).write_bytes(dados)
        e.update({"arquivo": f"capas/manual/{nome}", "de": url})
        e.pop("erro", None)
        mudou = True
        print(f"ok {chave} -> {nome} ({len(dados) // 1024} KB)")

    usados = {Path(e["arquivo"]).name for e in capas.values() if e.get("arquivo")}
    for f in PASTA.iterdir():
        if f.name != ".gitkeep" and f.name not in usados:
            f.unlink()
            mudou = True
            print(f"apagado {f.name} (sem uso)")

    if mudou:
        ARQ.write_text(json.dumps(dict(sorted(capas.items())), ensure_ascii=False, indent=1) + "\n")
    print(f"{len(capas)} capas manuais; {'houve mudanças' if mudou else 'nada a fazer'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
