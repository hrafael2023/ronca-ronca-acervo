# Acervo Ronca Ronca

Todos os setlists do [Ronca Ronca](https://www.roncaronca.com.br/) desde 2012, com busca, capas dos discos e dashboard.

**Site:** https://hrafael2023.github.io/ronca-ronca-acervo/

## Como funciona

- **Fonte dos dados:** a planilha DataRonca (aba `FULL LIST`), que precisa continuar com acesso "Qualquer pessoa com o link: Leitor".
- **Atualização automática:** a Action [`Atualizar acervo`](.github/workflows/atualizar.yml) roda a cada 3 horas (ou na hora, pelo botão *Run workflow* na aba Actions). Ela roda `scripts/atualizar.py`, que:
  1. baixa a planilha em CSV e gera `data/acervo.json`;
  2. procura no Deezer a capa de cada música nova e guarda em `data/capas.json` (as não encontradas ficam em `data/capas-falhas.json` e são tentadas de novo depois de 30 dias);
  3. faz commit se algo mudou — o GitHub Pages republica sozinho.
- **Site:** HTML/CSS/JS puro (`index.html`, `assets/`), sem build. Toda a busca e os gráficos rodam no navegador.

## Busca

Um campo só, que entende:

| Digite | Encontra |
|---|---|
| `bowie`, `heroes` | artista ou música (sem ligar para acento) |
| `1977`, `1970s`, `anos 60` | ano ou década de lançamento |
| `#500`, `500-510` | programa ou faixa de programas |

O seletor ao lado força o tipo (só artista, só música, etc.).

## Rodar localmente

```bash
python3 scripts/atualizar.py          # atualiza os dados
python3 -m http.server 8000           # abre http://localhost:8000
```

Versão atual: veja o arquivo `VERSAO` (também aparece no rodapé do site).
