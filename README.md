# roNca roNca · Na UÉBI

Todos os setlists do [roNca roNca](https://www.roncaronca.com.br/) desde 2012, com busca, capas dos discos e dashboard.

**Site:** https://hrafael2023.github.io/ronca-ronca-acervo/

## Como funciona

- **Fonte dos dados:** a planilha DataRonca (aba `FULL LIST`), que precisa continuar com acesso "Qualquer pessoa com o link: Leitor".
- **Atualização (manual):** a Action [`Atualizar acervo`](.github/workflows/atualizar.yml) só roda quando o administrador clica no ícone de atualizar no topo do site (ou no botão *Run workflow* na aba Actions). Não há agendamento. Ela roda `scripts/atualizar.py`, que:
  1. baixa a planilha em CSV e gera `data/acervo.json`;
  2. lê os posts "a bula do #N" do site oficial e guarda as fotos dos discos em `data/fotos-site.json` — **elas têm prioridade** sobre o Deezer, porque mostram a edição exata que tocou (fotos na vitrola a partir do #300 e capas escaneadas nos anos anteriores);
  3. procura no Deezer a capa de cada música nova e guarda em `data/capas.json` (as não encontradas ficam em `data/capas-falhas.json` e são tentadas de novo depois de 30 dias);
  4. faz commit se algo mudou — o GitHub Pages republica sozinho.
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
