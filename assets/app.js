/* Acervo roNca roNca — tudo roda no navegador a partir de data/acervo.json e data/capas.json */
(() => {
  "use strict";

  const $ = (s, el = document) => el.querySelector(s);
  const app = $("#app");
  const POR_PAGINA = 60;
  const ANO_ATUAL = new Date().getFullYear();

  // ---------- utilidades ----------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const norm = (s) => String(s ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[’`´]/g, "'").replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();
  const fmt = (n) => Number(n).toLocaleString("pt-BR");
  // número + palavra no singular ou plural: qtd(1, "faixa") → "1 faixa"; qtd(2, "música") → "2 músicas"
  const qtd = (n, sing, plur = sing + "s", f = fmt) => `${f(n)} ${Math.round(n * 10) / 10 === 1 ? sing : plur}`;
  const fmt1 = (n) => Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  const decada = (a) => (a ? Math.floor(a / 10) * 10 : null);
  const slug = (a) => encodeURIComponent(a.toLowerCase());
  // chave tolerante: sem acento/caixa/pontuação/"the" e sem o que vem entre parênteses,
  // para "Victoria" e "victoria (exclusivo do #500)" serem a mesma música
  const chaveBase = (a, m) => norm(String(a).replace(/^\s*the\s+/i, "")) + "|" + (norm(String(m).replace(/\s*[\(\[][^\)\]]*[\)\]]/g, " ")) || norm(m));
  const capaURL = (md5, t = 250) => `https://cdn-images.dzcdn.net/images/cover/${md5}/${t}x${t}-000000-80-0-0.jpg`;

  // "mundo livre s/a" → "Mundo Livre S/A" (quando o Deezer não deu o nome certinho)
  const MINUS = new Set(["de", "da", "do", "das", "dos", "e", "the", "of", "and", "a", "o", "in", "on", "at", "to", "for", "y", "el", "la", "le", "les", "du", "von", "van"]);
  function titulo(s) {
    return s.split(/(\s+|-|\/|\()/).map((w, i) => {
      if (!w.trim() || /^[\s\-/(]$/.test(w)) return w;
      if (i > 0 && MINUS.has(w)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1);
    }).join("").replace(/\bS\/a\b/g, "S/A").replace(/\bDj\b/g, "DJ").replace(/\bMc\b/g, "MC");
  }

  // ---------- dados ----------
  const D = {
    programas: [], // {n, ano, faixas:[faixa]}
    faixas: [], // {p, ano, a, m, al, k, pos}
    musicas: new Map(), // k → {k, a, m, al, progs:[n], capa}
    artistas: new Map(), // chave → {chave, nome, total, musicas:Set, progs:Set, primeiro, ultimo}
    porNumero: new Map(),
    manuais: {}, // chave → {url, arquivo?, erro?}
    manuaisBase: {}, // mesma coisa, pela chave tolerante
    admin: false,
  };

  async function carregar() {
    const [acervo, capas, fotos] = await Promise.all([
      fetch("data/acervo.json", { cache: "no-cache" }).then((r) => r.json()),
      fetch("data/capas.json", { cache: "no-cache" }).then((r) => r.json()).catch(() => ({})),
      // fotos dos discos publicadas nas bulas do site oficial: têm prioridade sobre o Deezer
      fetch("data/fotos-site.json", { cache: "no-cache" }).then((r) => r.json()).catch(() => ({})),
      // capas trocadas à mão pelo administrador: têm prioridade sobre tudo
      fetch("data/capas-manuais.json", { cache: "no-cache" }).then((r) => r.json()).catch(() => ({})),
    ]).then(([a, c, f, m]) => {
      D.manuais = m || {};
      D.manuaisBase = {};
      for (const [k, v] of Object.entries(D.manuais)) { const i = k.indexOf("|"); D.manuaisBase[chaveBase(k.slice(0, i), k.slice(i + 1))] = v; }
      return [a, c, f];
    });
    D.fotos = fotos;
    const nomeDeezer = new Map();
    for (const [k, c] of Object.entries(capas)) {
      const art = k.split("|")[0];
      if (c[3] && norm(c[3]) === norm(art)) nomeDeezer.set(art, c[3]);
    }
    for (const p of acervo.programas) {
      const prog = { n: p.n, ano: p.ano, faixas: [], bula: (fotos[p.n] || {})._post || null };
      p.f.forEach(([a, m, al], i) => {
        const k = `${a.toLowerCase()}|${m.toLowerCase()}`;
        const chaveA = a.toLowerCase().trim();
        const foto = (fotos[p.n] || {})[k];
        const f = { p: p.n, ano: p.ano, a, m, al, k, pos: i + 1, chaveA, foto: foto ? { g: foto[0], p: foto[1] || foto[0] } : null };
        prog.faixas.push(f);
        D.faixas.push(f);
        let mu = D.musicas.get(k);
        if (!mu) {
          const c = capas[k];
          mu = { k, base: chaveBase(a, m), a, m, al, progs: [], capa: c ? c[0] : null, album: c ? c[1] : null, deezer: c ? c[2] : null, chaveA, n: norm(a + " " + m), na: norm(a), nm: norm(m) };
          D.musicas.set(k, mu);
        }
        if (!mu.al && al) mu.al = al;
        mu.progs.push(p.n);
        if (f.foto && !mu.foto) mu.foto = f.foto; // programas vêm do mais novo para o mais antigo
        let ar = D.artistas.get(chaveA);
        if (!ar) {
          ar = { chave: chaveA, nome: nomeDeezer.get(chaveA) || titulo(a.trim()), total: 0, musicas: new Set(), progs: new Set(), primeiro: p.n, ultimo: p.n, na: norm(a) };
          D.artistas.set(chaveA, ar);
        }
        ar.total++;
        ar.musicas.add(k);
        ar.progs.add(p.n);
        ar.primeiro = Math.min(ar.primeiro, p.n);
        ar.ultimo = Math.max(ar.ultimo, p.n);
      });
      D.programas.push(prog);
      D.porNumero.set(p.n, prog);
    }
    D.programas.sort((a, b) => b.n - a.n);
    for (const mu of D.musicas.values()) mu.progs.sort((a, b) => b - a);
    const dt = new Date(acervo.atualizado);
    $("#atualizado").textContent = "Atualizado em " + dt.toLocaleDateString("pt-BR") + " " + dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }

  const nomeArtista = (a) => (D.artistas.get(a.toLowerCase().trim()) || {}).nome || titulo(a);
  const linkArtista = (a) => `<a href="#/artista/${slug(a.trim())}">${esc(nomeArtista(a))}</a>`;

  // f (opcional) = a faixa num programa específico, que pode ter a foto daquele programa
  const ICONE_EDITAR = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;

  // Qual imagem mostrar: capa manual > foto do site (do programa, ou a mais recente) > Deezer
  function fonteCapa(mu, t = 250, f = null) {
    // capa escolhida à mão para esta faixa ou para outra variação do nome da mesma música
    const man = mu && (D.manuais[mu.k] || D.manuaisBase[mu.base]);
    // foto de vitrola vinda do site do roNca: enquadra pela direita, como as outras fotos do site
    if (man) return { src: man.arquivo || man.url, cls: "manual" + (/roncaronca\.com\.br/.test(man.de || man.url) ? " foto-site" : ""), titulo: "Capa escolhida à mão" };
    const foto = (f && f.foto) || (mu && mu.foto);
    if (foto) return { src: t > 150 ? foto.g : foto.p, cls: "foto-site", titulo: "Foto do disco publicada no site do roNca roNca" };
    if (mu && mu.capa) return { src: capaURL(mu.capa, t), cls: "", titulo: "" };
    return null;
  }

  // f (opcional) = a faixa num programa específico, que pode ter a foto daquele programa
  function capaHTML(mu, t = 250, f = null) {
    const fonte = fonteCapa(mu, t, f);
    const ini = (mu ? nomeArtista(mu.a) : "?").replace(/^the /i, "").slice(0, 2);
    const editar = D.admin && mu ? `<button class="capa-editar" type="button" data-k="${esc(mu.k)}"${f ? ` data-p="${f.p}"` : ""} title="Trocar capa" aria-label="Trocar capa de ${esc(mu.m)}">${ICONE_EDITAR}</button>` : "";
    if (!fonte) return `<div class="capa sem" data-ini="${esc(ini)}">${editar}</div>`;
    return `<div class="capa ${fonte.cls}" data-ini="${esc(ini)}"${fonte.titulo ? ` title="${fonte.titulo}"` : ""}><img loading="lazy" src="${esc(fonte.src)}" alt="" onerror="this.parentNode.classList.add('sem');this.remove()">${editar}</div>`;
  }

  // ---------- busca ----------
  function interpretar(q, campo) {
    q = q.trim();
    if (!q) return null;
    if (campo === "programa" || (campo === "tudo" && /^#?\d{1,3}$/.test(q))) {
      const nums = q.replace(/[^\d,\- ]/g, "");
      const m = nums.match(/^(\d+)\s*-\s*(\d+)$/);
      if (m) return { tipo: "programa", de: +m[1], ate: +m[2] };
      return { tipo: "programa", de: +nums.replace(/\D/g, ""), ate: +nums.replace(/\D/g, "") };
    }
    if (campo === "ano" || (campo === "tudo" && /^(19|20)\d{2}s?$|^anos? \d{2}$/i.test(q))) {
      let m = q.match(/^((?:19|20)\d)0s$/i);
      if (m) return { tipo: "ano", de: +m[1] * 10, ate: +m[1] * 10 + 9 };
      m = q.match(/^anos? (\d)0$/i);
      if (m) { const d = (+m[1] >= 3 ? 1900 : 2000) + +m[1] * 10; return { tipo: "ano", de: d, ate: d + 9 }; }
      m = q.match(/(\d{4})\s*-\s*(\d{4})/);
      if (m) return { tipo: "ano", de: +m[1], ate: +m[2] };
      const a = +q.replace(/\D/g, "").slice(0, 4);
      return { tipo: "ano", de: a, ate: a };
    }
    return { tipo: "texto", campo, termos: norm(q).split(" ").filter(Boolean), q: norm(q) };
  }

  function buscar(q, campo) {
    const c = interpretar(q, campo);
    if (!c) return { c, lista: [] };
    const lista = [];
    if (c.tipo === "programa") {
      for (const mu of D.musicas.values()) {
        const hits = mu.progs.filter((p) => p >= c.de && p <= c.ate);
        if (hits.length) lista.push({ mu, s: 0, hits });
      }
      // ordem do setlist
      const ordem = new Map();
      for (let n = c.ate; n >= c.de; n--) (D.porNumero.get(n)?.faixas || []).forEach((f, i) => ordem.has(f.k) || ordem.set(f.k, (c.ate - n) * 1000 + i));
      lista.sort((x, y) => ordem.get(x.mu.k) - ordem.get(y.mu.k));
      return { c, lista, ordenado: true };
    }
    if (c.tipo === "ano") {
      for (const mu of D.musicas.values()) if (mu.al >= c.de && mu.al <= c.ate) lista.push({ mu, s: 0 });
      return { c, lista };
    }
    const { termos, q: qq } = c;
    for (const mu of D.musicas.values()) {
      const alvo = c.campo === "artista" ? mu.na : c.campo === "musica" ? mu.nm : mu.n;
      if (!termos.every((t) => alvo.includes(t))) continue;
      let s = 1;
      if (mu.na === qq) s += 6; else if (mu.na.startsWith(qq)) s += 3;
      if (mu.nm === qq) s += 6; else if (mu.nm.startsWith(qq)) s += 3;
      if ((" " + mu.na + " ").includes(" " + qq + " ")) s += 1;
      if ((" " + mu.nm + " ").includes(" " + qq + " ")) s += 1;
      lista.push({ mu, s });
    }
    return { c, lista };
  }

  function ordenar(lista, modo) {
    const f = {
      tocadas: (a, b) => b.mu.progs.length - a.mu.progs.length || b.mu.progs[0] - a.mu.progs[0],
      recentes: (a, b) => b.mu.progs[0] - a.mu.progs[0] || b.s - a.s || b.mu.progs.length - a.mu.progs.length,
      antigas: (a, b) => (a.mu.al || 9999) - (b.mu.al || 9999),
      novas: (a, b) => (b.mu.al || 0) - (a.mu.al || 0),
      artista: (a, b) => a.mu.na.localeCompare(b.mu.na) || a.mu.nm.localeCompare(b.mu.nm),
    }[modo];
    return f ? lista.slice().sort(f) : lista;
  }



  function itemHTML(mu, termos, extra = "", f = null) {
    const progs = mu.progs.slice(0, 8).map((p) => `<a class="chip" href="#/programa/${p}">#${p}</a>`).join("");
    const resto = mu.progs.length > 8 ? `<span class="chip">+${mu.progs.length - 8}</span>` : "";
    // sem o nome do álbum do Deezer: não dá para saber se tocou a edição original ou um relançamento
    const info = mu.al ? `lançada em <a href="#/busca?c=ano&q=${mu.al}">${mu.al}</a>` : "";
    return `<div class="item">${extra}${capaHTML(mu, 120, f)}
      <div><div class="t">${esc(mu.m)}</div>
      <div class="a"><a href="#/artista/${slug(mu.a.trim())}">${esc(nomeArtista(mu.a))}</a></div>
      <div class="info">${info}</div></div>
      <div class="progs">${progs}${resto}</div></div>`;
  }

  const opt = (v, t, sel) => `<option value="${v}"${String(sel) === String(v) ? " selected" : ""}>${t}</option>`;

  let estadoBusca = { pagina: 1 };
  function telaBusca(params) {
    const q = params.get("q") || "";
    const campo = params.get("c") || "tudo";
    const ord = params.get("o") || "";
    $("#q").value = q;
    $("#campo").value = campo;
    const { c, lista: bruta, ordenado } = buscar(q, campo);
    if (!c) return telaInicio();
    let lista = bruta;
    const modo = ord || "recentes";
    lista = ordenar(lista, modo);
    const total = lista.length;
    const termos = c.tipo === "texto" ? c.termos : null;

    // cartão de artista quando a busca bate com um nome
    let artistaTopo = "";
    if (c.tipo === "texto" && c.campo !== "musica") {
      const cands = [...D.artistas.values()].filter((a) => a.na === c.q || (c.q.length > 3 && (" " + a.na).includes(" " + c.q))).sort((a, b) => b.total - a.total).slice(0, 3);
      if (cands.length) artistaTopo = `<div class="filtros">${cands.map((a) => `<a class="chip" style="font-size:14px;padding:6px 14px" href="#/artista/${slug(a.chave)}">${esc(a.nome)} — ${qtd(a.total, "execução", "execuções")} →</a>`).join("")}</div>`;
    }
    let titulo;
    if (c.tipo === "programa") titulo = c.de === c.ate ? `Programa <b>#${c.de}</b>` : `Programas <b>#${c.de}–#${c.ate}</b>`;
    else if (c.tipo === "ano") titulo = c.de === c.ate ? `Lançadas em <b>${c.de}</b>` : `Lançadas entre <b>${c.de}–${c.ate}</b>`;
    else titulo = `Resultados para <b>“${esc(q)}”</b>`;

    estadoBusca = { lista, termos, pagina: 1 };
    app.innerHTML = `<section class="secao">
      <div class="secao-topo"><h2>${titulo}</h2>${c.tipo === "programa" && c.de === c.ate && D.porNumero.has(c.de) ? `<a class="mais" href="#/programa/${c.de}">ver página do programa →</a>` : ""}</div>
      ${artistaTopo}
      <div class="filtros">
        <span class="total">${qtd(total, "música")}</span>
        <select id="f-ord" aria-label="Ordenar">${opt("", "Tocadas recentemente", ord)}${ordenado ? opt("setlist", "Ordem do setlist", ord) : ""}${opt("tocadas", "Mais tocadas", ord)}${opt("novas", "Lançamento: mais novas", ord)}${opt("antigas", "Lançamento: mais antigas", ord)}${opt("artista", "Artista A–Z", ord)}</select>
      </div>
      ${total ? `<div class="lista" id="lista"></div><div class="paginar" id="paginar"></div>` : `<div class="vazio cartao">Nada encontrado. Tente só o nome do artista, ou parte do título.</div>`}
    </section>`;
    const atualizarFiltro = () => {
      const p = new URLSearchParams({ q, c: campo });
      if ($("#f-ord").value) p.set("o", $("#f-ord").value);
      irPara("#/busca?" + p, true);
    };
    $("#f-ord").onchange = atualizarFiltro;
    if (total) desenharPagina();
  }

  function desenharPagina() {
    const { lista, termos, pagina } = estadoBusca;
    const ini = (pagina - 1) * POR_PAGINA;
    $("#lista").insertAdjacentHTML("beforeend", lista.slice(ini, ini + POR_PAGINA).map((r) => itemHTML(r.mu, termos)).join(""));
    const resta = lista.length - pagina * POR_PAGINA;
    $("#paginar").innerHTML = resta > 0 ? `<button id="mais">Mostrar mais (${fmt(resta)})</button>` : "";
    if (resta > 0) $("#mais").onclick = () => { estadoBusca.pagina++; desenharPagina(); };
  }

  // ---------- estatísticas ----------
  function estatisticas() {
    if (D.est) return D.est;
    const artistasTop = [...D.artistas.values()].sort((a, b) => b.total - a.total);
    const porDecada = new Map(), porAnoLanc = new Map(), porAnoRonca = new Map(), idade = new Map();
    for (const f of D.faixas) {
      if (f.ano) porAnoRonca.set(f.ano, (porAnoRonca.get(f.ano) || 0) + 1);
      if (f.al && f.al >= 1900 && f.al <= ANO_ATUAL) {
        const d = decada(f.al);
        porDecada.set(d, (porDecada.get(d) || 0) + 1);
        porAnoLanc.set(f.al, (porAnoLanc.get(f.al) || 0) + 1);
        if (f.ano && f.ano >= f.al) {
          const i = idade.get(f.ano) || { s: 0, n: 0, novas: 0 };
          i.s += f.ano - f.al; i.n++; if (f.ano - f.al <= 1) i.novas++;
          idade.set(f.ano, i);
        }
      }
    }
    const musicasTop = [...D.musicas.values()].sort((a, b) => b.progs.length - a.progs.length || b.progs[0] - a.progs[0]);
    let somaIdade = 0, nIdade = 0;
    for (const i of idade.values()) { somaIdade += i.s; nIdade += i.n; }
    const anosRonca = [...porAnoRonca.keys()].sort();
    D.est = { artistasTop, porDecada, porAnoLanc, porAnoRonca, idade, musicasTop, idadeMedia: somaIdade / nIdade, anosRonca };
    return D.est;
  }

  // ---------- gráficos (SVG à mão) ----------
  const largura = (el) => Math.max(280, el.clientWidth || 500);

  function barrasH(el, dados, { rotuloW = 150, altura = 22, max } = {}) {
    const W = largura(el), lw = Math.min(rotuloW, W * 0.42), vw = 40;
    const m = max || Math.max(...dados.map((d) => d.v));
    const bw = W - lw - vw - 8;
    const H = dados.length * altura;
    const linhas = dados.map((d, i) => {
      const y = i * altura, w = Math.max(2, (d.v / m) * bw);
      const rot = `<text class="rot" x="${lw - 8}" y="${y + altura / 2 + 4}" text-anchor="end">${esc(corta(d.r, lw / 6.6))}</text>`;
      return `<g class="alvo" data-dica="${esc(d.dica || `<b>${esc(d.r)}</b><br>${fmt(d.v)}`)}">
        <rect x="0" y="${y}" width="${W}" height="${altura}" fill="transparent"/>
        ${d.href ? `<a href="${d.href}">${rot}</a>` : rot}
        <path class="barra${d.fraca ? " fraca" : ""}" d="${barraDir(lw, y + 4, w, altura - 8)}"/>
        <text class="val" x="${lw + w + 6}" y="${y + altura / 2 + 4}">${fmt(d.v)}</text></g>`;
    }).join("");
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img">${linhas}</svg>`;
  }
  // barra horizontal com a ponta direita arredondada (4px), presa na base
  function barraDir(x, y, w, h) {
    const r = Math.min(4, w / 2, h / 2);
    return `M${x},${y}h${w - r}a${r},${r} 0 0 1 ${r},${r}v${h - 2 * r}a${r},${r} 0 0 1 -${r},${r}h-${w - r}z`;
  }
  // coluna com o topo arredondado
  function colunaTopo(x, y, w, h) {
    const r = Math.min(3, w / 2, h);
    return `M${x},${y + h}v-${h - r}a${r},${r} 0 0 1 ${r},-${r}h${w - 2 * r}a${r},${r} 0 0 1 ${r},${r}v${h - r}z`;
  }
  const corta = (s, n) => (s.length > n ? s.slice(0, Math.max(3, Math.floor(n) - 1)) + "…" : s);

  function colunas(el, dados, { altura = 180, rotuloCada = 1, formatoX = (x) => x, destaque } = {}) {
    const W = largura(el), esq = 34, base = altura - 22, topo = 8;
    const m = Math.max(...dados.map((d) => d.v)) || 1;
    const passo = (W - esq) / dados.length, bw = Math.max(1, passo - (passo > 6 ? 2 : 0.5));
    const ticks = escalaTicks(m);
    const grade = ticks.map((t) => { const y = base - (t / ticks[ticks.length - 1]) * (base - topo); return `<line class="grade" x1="${esq}" x2="${W}" y1="${y}" y2="${y}"/><text x="${esq - 6}" y="${y + 4}" text-anchor="end">${fmt(t)}</text>`; }).join("");
    const top = ticks[ticks.length - 1];
    const cols = dados.map((d, i) => {
      const h = (d.v / top) * (base - topo), x = esq + i * passo;
      const rot = i % rotuloCada === 0 ? `<text x="${x + bw / 2}" y="${altura - 6}" text-anchor="middle">${esc(formatoX(d.x))}</text>` : "";
      return `<g class="alvo" data-dica="${esc(d.dica || `<b>${esc(d.x)}</b><br>${fmt(d.v)}`)}">${d.href ? `<a href="${d.href}">` : ""}
        <rect x="${x}" y="${topo}" width="${passo}" height="${base - topo}" fill="transparent"/>
        ${h > 0 ? `<path class="barra${destaque && !destaque(d) ? " fraca" : ""}" d="${colunaTopo(x, base - h, bw, h)}"/>` : ""}${d.href ? "</a>" : ""}${rot}</g>`;
    }).join("");
    el.innerHTML = `<svg viewBox="0 0 ${W} ${altura}" width="${W}" height="${altura}" role="img">${grade}<line x1="${esq}" x2="${W}" y1="${base}" y2="${base}" stroke="var(--texto-3)"/>${cols}</svg>`;
  }

  function escalaTicks(m) {
    const p = Math.pow(10, Math.floor(Math.log10(m)));
    const passo = [1, 2, 2.5, 5, 10].map((k) => k * p).find((s) => m / s <= 4) || p * 10;
    const t = [];
    for (let v = 0; v <= m + passo * 0.999; v += passo) t.push(Math.round(v));
    if (t[t.length - 1] < m) t.push(t[t.length - 1] + passo);
    return t;
  }

  function linha(el, dados, { altura = 180, sufixo = "" } = {}) {
    const W = largura(el), esq = 34, dir = 12, base = altura - 22, topo = 10;
    const m = Math.max(...dados.map((d) => d.v));
    const ticks = escalaTicks(m), top = ticks[ticks.length - 1];
    const X = (i) => esq + (i / (dados.length - 1)) * (W - esq - dir);
    const Y = (v) => base - (v / top) * (base - topo);
    const grade = ticks.map((t) => `<line class="grade" x1="${esq}" x2="${W - dir}" y1="${Y(t)}" y2="${Y(t)}"/><text x="${esq - 6}" y="${Y(t) + 4}" text-anchor="end">${fmt(t)}</text>`).join("");
    const caminho = dados.map((d, i) => `${i ? "L" : "M"}${X(i)},${Y(d.v)}`).join("");
    const meio = (W - esq - dir) / (dados.length - 1) / 2;
    const pts = dados.map((d, i) => `<g class="alvo" data-dica="${esc(d.dica)}"><rect x="${X(i) - meio}" y="${topo}" width="${meio * 2}" height="${base - topo}" fill="transparent"/><circle class="ponto" cx="${X(i)}" cy="${Y(d.v)}" r="4.5"/>
      <text x="${X(i)}" y="${altura - 6}" text-anchor="middle">${dados.length > 10 && W < 520 && i % 2 ? "" : esc(String(d.x).slice(-2) === String(d.x) ? d.x : "’" + String(d.x).slice(2))}</text></g>`).join("");
    el.innerHTML = `<svg viewBox="0 0 ${W} ${altura}" width="${W}" height="${altura}" role="img">${grade}<path class="linha" d="${caminho}"/>${pts}</svg>`;
  }

  // dica flutuante para qualquer [data-dica]
  const dica = $("#dica");
  document.addEventListener("mousemove", (e) => {
    const g = e.target.closest && e.target.closest("[data-dica]");
    if (!g) { dica.style.opacity = 0; return; }
    dica.innerHTML = g.getAttribute("data-dica");
    const r = dica.getBoundingClientRect();
    let x = e.clientX + 14, y = e.clientY + 14;
    if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
    if (y + r.height > innerHeight - 8) y = e.clientY - r.height - 14;
    dica.style.left = x + "px"; dica.style.top = y + "px"; dica.style.opacity = 1;
  });

  // gráficos redesenham ao redimensionar
  let desenhos = [];
  const registrar = (fn) => { desenhos.push(fn); fn(); };
  let tRes;
  addEventListener("resize", () => { clearTimeout(tRes); tRes = setTimeout(() => desenhos.forEach((f) => f()), 150); });

  function tabela(cab, linhas) {
    return `<details class="tabela"><summary>ver tabela</summary><table class="tabela-dados"><thead><tr>${cab.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${linhas.map((l) => `<tr>${l.map((c, i) => `<td${i ? ' class="n"' : ""}>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></details>`;
  }

  function kpisHTML(est) {
    const anos = est.anosRonca;
    return `<div class="kpis">
      <div class="kpi"><div class="v">${fmt(D.programas.length)}</div><div class="r">programas</div><div class="s">de ${anos[0]} a ${anos[anos.length - 1]}</div></div>
      <div class="kpi"><div class="v">${fmt(D.faixas.length)}</div><div class="r">faixas tocadas</div><div class="s">${fmt1(D.faixas.length / D.programas.length)} por programa</div></div>
      <div class="kpi"><div class="v">${fmt(D.artistas.size)}</div><div class="r">artistas</div><div class="s">${qtd(D.musicas.size, "música diferente", "músicas diferentes")}</div></div>
      <div class="kpi"><div class="v">${qtd(Math.round(est.idadeMedia), "ano")}</div><div class="r">idade média da música</div><div class="s">entre lançamento e execução</div></div>
    </div>`;
  }

  function graficoDecadas(el, est) {
    const decs = [...est.porDecada.entries()].sort((a, b) => a[0] - b[0]);
    const tot = decs.reduce((s, d) => s + d[1], 0);
    colunas(el, decs.map(([d, v]) => ({ x: d, v, href: `#/busca?c=ano&q=${d}s`, dica: `<b>Anos ${String(d).slice(2)}</b><br>${qtd(v, "faixa")} · ${fmt1((v / tot) * 100)}%` })),
      { formatoX: (x) => (x < 2000 && x > 1900 ? "’" + String(x).slice(2) : String(x)), rotuloCada: largura(el) < 400 ? 2 : 1 });
  }

  function graficoTopArtistas(el, est, n) {
    barrasH(el, est.artistasTop.slice(0, n).map((a) => ({ r: a.nome, v: a.total, href: `#/artista/${slug(a.chave)}`, dica: `<b>${esc(a.nome)}</b><br>${qtd(a.total, "execução", "execuções")} em ${qtd(a.progs.size, "programa")}<br>${qtd(a.musicas.size, "música diferente", "músicas diferentes")}` })));
  }

  // ---------- telas ----------
  function telaInicio() {
    const est = estatisticas();
    const ult = D.programas[0];
    const estreias = new Set(ult.faixas.filter((f) => D.artistas.get(f.chaveA)?.primeiro === ult.n).map((f) => f.chaveA));
    const comAno = ult.faixas.filter((f) => f.al);
    const idadeUlt = comAno.length ? comAno.reduce((s, f) => s + (ult.ano - f.al), 0) / comAno.length : 0;
    const mosaico = ult.faixas.filter((f) => f.foto || D.musicas.get(f.k).capa).slice(0, 9);
    const veterano = ult.faixas.map((f) => D.artistas.get(f.chaveA)).sort((a, b) => b.total - a.total)[0];

    app.innerHTML = `
    <section class="secao">
      <div class="secao-topo"><h2>Último programa: <b>#${ult.n}</b></h2><a class="mais" href="#/programas">todos os programas →</a></div>
      <div class="destaque-prog">
        <aside class="prog-card">
          <div class="num">#${ult.n}</div>
          <div class="ano">roNca roNca · ${ult.ano}</div>
          <div class="mosaico">${mosaico.map((f) => capaHTML(D.musicas.get(f.k), 120, f)).join("")}</div>
          <div class="stats">
            <div><b>${ult.faixas.length}</b>faixas</div>
            <div><b>${estreias.size}</b>artistas estreando</div>
            <div><b>${comAno.length ? Math.min(...comAno.map((f) => f.al)) : "–"}</b>a mais antiga</div>
            <div><b>${qtd(Math.round(idadeUlt), "ano")}</b>idade média</div>
          </div>
          ${veterano ? `<p style="font-size:13px;color:#bdc3e0;margin:14px 0 0">Figurinha carimbada: <a style="color:var(--amarelo)" href="#/artista/${slug(veterano.chave)}">${esc(veterano.nome)}</a>, ${qtd(veterano.total, "execução", "execuções")} na história do programa.</p>` : ""}
          <div class="botoes"><a class="btn" href="#/programa/${ult.n}">Ver setlist</a><a class="btn sec" href="${esc(ult.bula || "https://www.roncaronca.com.br/")}" target="_blank" rel="noopener">Bula no site ↗</a></div>
        </aside>
        <div class="grade-capas">${ult.faixas.map((f) => cartaoFaixa(f)).join("")}</div>
      </div>
    </section>
    <section class="secao">
      <div class="secao-topo"><h2>O roNca em <b>números</b></h2><a class="mais" href="#/numeros">mais números →</a></div>
      ${kpisHTML(est)}
      <div class="graficos">
        <div class="cartao grafico"><h3>Artistas mais tocados</h3><div class="leg">execuções desde 2012 · clique para ver o artista</div><div id="g-top"></div></div>
        <div class="cartao grafico"><h3>De que década vem a música?</h3><div class="leg">faixas tocadas por década de lançamento</div><div id="g-dec"></div>
          <h3 style="margin-top:18px">Faixas por ano do programa</h3><div class="leg">total tocado em cada ano</div><div id="g-ano"></div></div>
      </div>
    </section>`;
    registrar(() => graficoTopArtistas($("#g-top"), est, 12));
    registrar(() => graficoDecadas($("#g-dec"), est));
    registrar(() => colunas($("#g-ano"), est.anosRonca.map((a) => ({ x: a, v: est.porAnoRonca.get(a), dica: `<b>${a}</b><br>${qtd(est.porAnoRonca.get(a), "faixa")}` })), { altura: 140, formatoX: (x) => "’" + String(x).slice(2), rotuloCada: largura($("#g-ano")) < 420 ? 2 : 1 }));
  }

  function cartaoFaixa(f) {
    const mu = D.musicas.get(f.k);
    const capa = capaHTML(mu, 250, f);
    return `<div class="faixa-capa">${capa}
      <div class="t">${esc(f.m)}</div><div class="a">${linkArtista(f.a)}</div>
      <div class="y">${f.al || ""}</div></div>`;
  }

  function telaPrograma(n) {
    const prog = D.porNumero.get(n);
    if (!prog) { app.innerHTML = `<div class="vazio">Programa #${n} não está no Na UÉBI.</div>`; return; }
    const nums = D.programas.map((p) => p.n);
    const i = nums.indexOf(n);
    const ant = nums[i + 1], prox = nums[i - 1];
    const estreias = new Set(prog.faixas.filter((f) => D.artistas.get(f.chaveA)?.primeiro === n).map((f) => f.chaveA));
    app.innerHTML = `<div class="cabeca"><div class="num">#${n}</div><div class="meta"><b>roNca roNca · ${prog.ano}</b><br>${qtd(prog.faixas.length, "faixa")} · ${qtd(estreias.size, "artista estreando", "artistas estreando")} no programa</div>
      <div class="nav">${prog.bula ? `<a href="${esc(prog.bula)}" target="_blank" rel="noopener">bula no site ↗</a>` : ""}${ant ? `<a href="#/programa/${ant}">← #${ant}</a>` : ""}${prox ? `<a href="#/programa/${prox}">#${prox} →</a>` : ""}</div></div>
      <div class="grade-capas" style="margin-bottom:28px">${prog.faixas.map((f) => cartaoFaixa(f)).join("")}</div>
      <h2 style="margin-bottom:12px">Setlist</h2>
      <div class="lista setlist">${prog.faixas.map((f) => itemHTML(D.musicas.get(f.k), null, `<span class="n">${f.pos}</span>`, f)).join("")}</div>`;
  }

  function telaArtista(chave) {
    const ar = D.artistas.get(chave);
    if (!ar) { app.innerHTML = `<div class="vazio">Artista não encontrado.</div>`; return; }
    const est = estatisticas();
    const rank = est.artistasTop.indexOf(ar) + 1;
    const musicas = [...ar.musicas].map((k) => D.musicas.get(k)).sort((a, b) => b.progs.length - a.progs.length || b.progs[0] - a.progs[0]);
    const porAno = new Map();
    for (const p of ar.progs) { const a = D.porNumero.get(p).ano; porAno.set(a, (porAno.get(a) || 0) + D.porNumero.get(p).faixas.filter((f) => f.chaveA === chave).length); }
    const capa = musicas.find((m) => m.capa);
    const letra = letraDoArtista(ar.nome);
    app.innerHTML = `<div class="cabeca">${capa ? `<div style="width:120px">${capaHTML(capa)}</div>` : ""}<div><h2><b>${esc(ar.nome)}</b></h2>
      <div class="meta" style="margin-top:6px">${qtd(ar.total, "execução", "execuções")} · ${qtd(ar.musicas.size, "música")} · ${qtd(ar.progs.size, "programa")} · ${rank}º mais tocado<br>
      Estreou no <a href="#/programa/${ar.primeiro}">#${ar.primeiro}</a> · última vez no <a href="#/programa/${ar.ultimo}">#${ar.ultimo}</a></div></div>
      <div class="nav"><a href="#/artistas?l=${encodeURIComponent(letra)}" title="Voltar à lista de artistas com ${letra}">← Artistas · ${letra}</a></div></div>
      <div class="graficos" style="margin-bottom:24px"><div class="cartao grafico largo"><h3>Execuções por ano do programa</h3><div class="leg">quantas faixas de ${esc(ar.nome)} tocaram em cada ano</div><div id="g-art"></div></div></div>
      <div class="secao-topo"><h2>Músicas tocadas</h2></div>
      <div class="filtros">
        <span class="total">${qtd(musicas.length, "música")}</span>
        <select id="f-ord" aria-label="Ordenar">${opt("", "Tocadas recentemente", "")}${opt("tocadas", "Mais tocadas", "")}${opt("novas", "Lançamento: mais novas", "")}${opt("antigas", "Lançamento: mais antigas", "")}${opt("artista", "Música A–Z", "")}</select>
      </div>
      <div class="lista" id="lista"></div>`;
    // mesma ordenação da busca; aqui só reordena a lista, sem recarregar a página
    const linhas = musicas.map((mu) => ({ mu, s: 0 }));
    const listar = () => { $("#lista").innerHTML = ordenar(linhas, $("#f-ord").value || "recentes").map((r) => itemHTML(r.mu)).join(""); };
    $("#f-ord").onchange = listar;
    listar();
    registrar(() => colunas($("#g-art"), est.anosRonca.map((a) => ({ x: a, v: porAno.get(a) || 0, dica: `<b>${a}</b><br>${qtd(porAno.get(a) || 0, "execução", "execuções")}` })), { altura: 150, formatoX: (x) => "’" + String(x).slice(2) }));
  }

  function telaProgramas() {
    const porAno = new Map();
    for (const p of D.programas) { if (!porAno.has(p.ano)) porAno.set(p.ano, []); porAno.get(p.ano).push(p); }
    app.innerHTML = `<div class="secao-topo"><h2>Todos os <b>programas</b></h2><span class="muted">${fmt(D.programas.length)} no Na UÉBI</span></div>` +
      [...porAno.entries()].map(([ano, ps]) => `<div class="programas-ano"><h3>${ano} <span class="muted" style="font-size:14px;font-weight:400">· ${qtd(ps.length, "programa")}</span></h3><div class="prog-grade">${ps.map((p) => {
        const caps = p.faixas.filter((f) => f.foto || D.musicas.get(f.k).capa).slice(0, 4);
        while (caps.length < 4) caps.push(null);
        return `<a class="prog-mini" href="#/programa/${p.n}"><div class="mosaico">${caps.map((f) => (f ? capaHTML(D.musicas.get(f.k), 120, f) : capaHTML(null))).join("")}</div><b>#${p.n}</b><span>${qtd(p.faixas.length, "faixa")}</span></a>`;
      }).join("")}</div></div>`).join("");
  }

  // letra do índice de artistas: ignora "the" e acentos; números e símbolos vão para "#"
  const letraDoArtista = (nome) => { const c = norm(nome.replace(/^the /i, "")).charAt(0).toUpperCase(); return /[A-Z]/.test(c) ? c : "#"; };
  let letraAtual = "A";
  function telaArtistas(letra) {
    if (letra && /^[A-Z#]$/.test(letra)) letraAtual = letra;
    const todos = [...D.artistas.values()].sort((a, b) => norm(a.nome.replace(/^the /i, "")).localeCompare(norm(b.nome.replace(/^the /i, ""))));
    const letraDe = (a) => letraDoArtista(a.nome);
    const letras = [..."#ABCDEFGHIJKLMNOPQRSTUVWXYZ"];
    const desenhar = () => {
      $("#letras").innerHTML = letras.map((l) => `<button class="${l === letraAtual ? "ativo" : ""}" data-l="${l}">${l}</button>`).join("");
      const lista = todos.filter((a) => letraDe(a) === letraAtual);
      $("#art-lista").innerHTML = lista.map((a) => `<a href="#/artista/${slug(a.chave)}">${esc(a.nome)}<span>${a.total}</span></a>`).join("") || `<div class="muted">Nenhum artista.</div>`;
    };
    app.innerHTML = `<div class="secao-topo"><h2>Todos os <b>artistas</b></h2><span class="muted">${qtd(todos.length, "artista")} · o número é o total de execuções</span></div>
      <div class="letras" id="letras"></div><div class="cartao"><div class="artistas-lista" id="art-lista"></div></div>`;
    $("#letras").onclick = (e) => { const b = e.target.closest("button"); if (b) { letraAtual = b.dataset.l; history.replaceState(null, "", "#/artistas?l=" + encodeURIComponent(letraAtual)); desenhar(); } };
    desenhar();
  }

  function telaDashboard() {
    const est = estatisticas();
    const anosLanc = [];
    const minLanc = Math.min(...est.porAnoLanc.keys());
    for (let a = Math.max(1920, minLanc); a <= ANO_ATUAL; a++) anosLanc.push(a);
    const idadeDados = est.anosRonca.filter((a) => est.idade.get(a)).map((a) => { const i = est.idade.get(a); return { x: a, v: i.s / i.n, n: i.novas / i.n, dica: `<b>${a}</b><br>idade média: ${qtd(i.s / i.n, "ano", "anos", fmt1)}<br>${fmt1((i.novas / i.n) * 100)}% lançadas no ano ou no anterior` }; });
    const pico = [...est.porAnoLanc.entries()].sort((a, b) => b[1] - a[1])[0];
    const decTop = [...est.porDecada.entries()].sort((a, b) => b[1] - a[1])[0];
    const umaVez = [...D.artistas.values()].filter((a) => a.total === 1).length;
    app.innerHTML = `<div class="secao-topo"><h2>O Na UÉBI em <b>números</b></h2></div>
      ${kpisHTML(est)}
      <div class="kpis">
        <div class="kpi"><div class="v">${decTop[0] < 2000 ? "Anos " + String(decTop[0]).slice(2) : decTop[0] + "s"}</div><div class="r">década favorita</div><div class="s">${fmt1((decTop[1] / D.faixas.length) * 100)}% das faixas</div></div>
        <div class="kpi"><div class="v">${pico[0]}</div><div class="r">ano de lançamento mais tocado</div><div class="s">${qtd(pico[1], "faixa")}</div></div>
        <div class="kpi"><div class="v">${fmt(umaVez)}</div><div class="r">artistas tocados uma única vez</div><div class="s">${fmt1((umaVez / D.artistas.size) * 100)}% do total</div></div>
        <div class="kpi"><div class="v">${fmt(est.musicasTop[0].progs.length)}×</div><div class="r">a música mais repetida</div><div class="s">${esc(est.musicasTop[0].m)} — ${esc(nomeArtista(est.musicasTop[0].a))}</div></div>
      </div>
      <div class="graficos">
        <div class="cartao grafico"><h3>Os 25 artistas mais tocados</h3><div class="leg">execuções desde 2012 · clique para ver o artista</div><div id="d-top"></div>
          ${tabela(["Artista", "Execuções", "Músicas", "Programas"], est.artistasTop.slice(0, 25).map((a) => [esc(a.nome), a.total, a.musicas.size, a.progs.size]))}</div>
        <div class="cartao grafico"><h3>As músicas que mais voltaram</h3><div class="leg">número de programas em que a faixa tocou</div><div id="d-mus"></div></div>
        <div class="cartao grafico largo"><h3>Ano de lançamento das faixas tocadas</h3><div class="leg">cada coluna é um ano · clique para ver as músicas daquele ano</div><div id="d-lanc"></div></div>
        <div class="cartao grafico"><h3>Por década de lançamento</h3><div class="leg">faixas tocadas</div><div id="d-dec"></div>
          ${tabela(["Década", "Faixas"], [...est.porDecada.entries()].sort((a, b) => a[0] - b[0]).map(([d, v]) => [d + "s", fmt(v)]))}</div>
        <div class="cartao grafico"><h3>Idade média da música tocada</h3><div class="leg">anos entre o lançamento e a execução, por ano do programa</div><div id="d-idade"></div>
          ${tabela(["Ano", "Idade média", "% lançamentos"], idadeDados.map((d) => [d.x, fmt1(d.v), fmt1(d.n * 100) + "%"]))}</div>
        <div class="cartao grafico"><h3>Faixas por ano do programa</h3><div class="leg">total tocado em cada ano</div><div id="d-ano"></div></div>
        <div class="cartao grafico"><h3>O mais tocado de cada ano</h3><div class="leg">artista com mais execuções em cada ano do programa</div><div id="d-campeoes"></div></div>
      </div>`;
    registrar(() => graficoTopArtistas($("#d-top"), est, 25));
    registrar(() => barrasH($("#d-mus"), est.musicasTop.slice(0, 25).map((m) => ({ r: `${m.m} — ${nomeArtista(m.a)}`, v: m.progs.length, href: `#/artista/${slug(m.a.trim())}`, dica: `<b>${esc(m.m)}</b><br>${esc(nomeArtista(m.a))}${m.al ? " · " + m.al : ""}<br>tocada em ${qtd(m.progs.length, "programa")}` })), { rotuloW: 230 }));
    registrar(() => { const el = $("#d-lanc"); const W = largura(el); colunas(el, anosLanc.map((a) => ({ x: a, v: est.porAnoLanc.get(a) || 0, href: `#/busca?c=ano&q=${a}`, dica: `<b>${a}</b><br>${qtd(est.porAnoLanc.get(a) || 0, "faixa")}` })), { altura: 200, rotuloCada: W < 500 ? 20 : 10 }); });
    registrar(() => graficoDecadas($("#d-dec"), est));
    registrar(() => linha($("#d-idade"), idadeDados));
    registrar(() => colunas($("#d-ano"), est.anosRonca.map((a) => ({ x: a, v: est.porAnoRonca.get(a), dica: `<b>${a}</b><br>${qtd(est.porAnoRonca.get(a), "faixa")}` })), { altura: 160, formatoX: (x) => "’" + String(x).slice(2), rotuloCada: largura($("#d-ano")) < 420 ? 2 : 1 }));
    // campeões por ano
    const camp = est.anosRonca.map((ano) => {
      const c = new Map();
      for (const f of D.faixas) if (f.ano === ano) c.set(f.chaveA, (c.get(f.chaveA) || 0) + 1);
      const [k, v] = [...c.entries()].sort((a, b) => b[1] - a[1])[0];
      return { ano, ar: D.artistas.get(k), v };
    }).reverse();
    $("#d-campeoes").innerHTML = `<table class="tabela-dados"><tbody>${camp.map((c) => `<tr><td>${c.ano}</td><td><a href="#/artista/${slug(c.ar.chave)}">${esc(c.ar.nome)}</a></td><td class="n">${qtd(c.v, "faixa")}</td></tr>`).join("")}</tbody></table>`;
  }

  // ---------- rotas ----------
  function irPara(h, substituir) {
    if (substituir) { history.replaceState(null, "", h); rotear(); } else location.hash = h;
  }

  let rotaAnterior = null;
  function rotear() {
    if (!D.pronto) return;
    desenhos = [];
    const h = location.hash.replace(/^#\/?/, "");
    const [caminho, qs] = h.split("?");
    const partes = caminho.split("/");
    document.querySelectorAll(".menu a").forEach((a) => a.classList.toggle("ativo", a.dataset.rota === (partes[0] === "dashboard" ? "numeros" : partes[0])));
    if (partes[0] !== "busca") { $("#q").value = ""; }
    if (partes[0] === "busca") telaBusca(new URLSearchParams(qs || ""));
    else if (partes[0] === "programa") telaPrograma(+partes[1]);
    else if (partes[0] === "artista") telaArtista(decodeURIComponent(partes.slice(1).join("/")));
    else if (partes[0] === "programas") telaProgramas();
    else if (partes[0] === "artistas") telaArtistas(new URLSearchParams(qs || "").get("l"));
    else if (partes[0] === "numeros" || partes[0] === "dashboard") telaDashboard();
    else telaInicio();
    if (partes[0] !== "busca" || rotaAnterior !== "busca") scrollTo(0, 0);
    rotaAnterior = partes[0];
  }

  // busca enquanto digita
  let tDig;
  const disparar = () => {
    const q = $("#q").value.trim();
    const c = $("#campo").value;
    if (!q) { if (location.hash.startsWith("#/busca")) irPara("#/", true); return; }
    const p = new URLSearchParams({ q, c });
    if (location.hash.startsWith("#/busca")) irPara("#/busca?" + p, true);
    else location.hash = "#/busca?" + p;
  };
  $("#q").addEventListener("input", () => { clearTimeout(tDig); tDig = setTimeout(disparar, 220); });
  $("#campo").addEventListener("change", disparar);
  $("#busca").addEventListener("submit", (e) => { e.preventDefault(); clearTimeout(tDig); disparar(); });

  function dicas() {
    const est = estatisticas();
    const ex = [est.artistasTop[0].nome, est.artistasTop[3].nome, "1977", "anos 60", "#" + D.programas[0].n, "#500"];
    $("#dicas").innerHTML = `Experimente: ${ex.map((e) => `<button type="button">${esc(e)}</button>`).join("")}`;
    $("#dicas").onclick = (e) => { const b = e.target.closest("button"); if (b) { $("#q").value = b.textContent; $("#campo").value = "tudo"; disparar(); } };
  }

  addEventListener("hashchange", rotear);
  // ---------- troca de capa (só administrador) ----------
  // O navegador grava a URL em data/capas-manuais.json pela API do GitHub, com um
  // token do próprio administrador (guardado só neste aparelho). A Action
  // "Capas manuais" então baixa a imagem para capas/manual/ e aponta o arquivo.
  const REPO = "hrafael2023/ronca-ronca-acervo";
  const ARQ_MANUAIS = "data/capas-manuais.json";
  const CHAVE_TOKEN = "ronca-gh-token";
  const tokenGH = () => { try { return localStorage.getItem(CHAVE_TOKEN) || ""; } catch { return ""; } };
  const b64 = (txt) => { const by = new TextEncoder().encode(txt); let s = ""; by.forEach((b) => (s += String.fromCharCode(b))); return btoa(s); };
  const deB64 = (b) => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\s/g, "")), (c) => c.charCodeAt(0)));

  async function gravarManual(k, entrada, token, mensagem) {
    const url = `https://api.github.com/repos/${REPO}/contents/${ARQ_MANUAIS}`;
    const cab = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" };
    for (let tentativa = 0; tentativa < 4; tentativa++) {
      const r = await fetch(`${url}?ref=main&t=${Date.now()}`, { headers: cab, cache: "no-store" });
      if (r.status === 401 || r.status === 403) throw Object.assign(new Error("token"), { token: true });
      let sha, dados = {};
      if (r.ok) { const j = await r.json(); sha = j.sha; dados = JSON.parse(deB64(j.content) || "{}"); }
      else if (r.status !== 404) throw new Error(`GitHub respondeu ${r.status}`);
      if (entrada) dados[k] = entrada; else delete dados[k];
      const ordenado = Object.fromEntries(Object.entries(dados).sort(([a], [b]) => a.localeCompare(b)));
      const p = await fetch(url, {
        method: "PUT", headers: cab,
        body: JSON.stringify({ message: mensagem, branch: "main", content: b64(JSON.stringify(ordenado, null, 1) + "\n"), ...(sha ? { sha } : {}) }),
      });
      if (p.ok) return ordenado;
      if (p.status === 401 || p.status === 403) throw Object.assign(new Error("token"), { token: true });
      if (p.status !== 409 && p.status !== 422) throw new Error(`GitHub respondeu ${p.status}`);
      // 409/422: alguém (a Action) gravou no meio do caminho; lê de novo e tenta outra vez
    }
    throw new Error("o arquivo mudou várias vezes seguidas; tente de novo");
  }

  // ---- candidatas: catálogos abertos que o navegador consegue consultar ----
  function jsonp(url, ms = 9000) {
    return new Promise((ok, falha) => {
      const cb = "cb" + Math.random().toString(36).slice(2);
      const s = document.createElement("script");
      const fim = () => { delete window[cb]; s.remove(); clearTimeout(t); };
      const t = setTimeout(() => { fim(); falha(new Error("tempo esgotado")); }, ms);
      window[cb] = (d) => { fim(); ok(d); };
      s.onerror = () => { fim(); falha(new Error("falhou")); };
      s.src = url + (url.includes("?") ? "&" : "?") + "callback=" + cb;
      document.head.appendChild(s);
    });
  }

  async function candidatasApple(artista, musica) {
    const d = await jsonp(`https://itunes.apple.com/search?entity=song&limit=20&country=BR&term=${encodeURIComponent(artista + " " + musica)}`);
    return (d.results || []).map((r) => ({
      mini: r.artworkUrl100.replace("100x100bb", "250x250bb"), grande: r.artworkUrl100.replace("100x100bb", "1000x1000bb"),
      titulo: r.collectionName, ano: (r.releaseDate || "").slice(0, 4), fonte: "Apple Music", artista: r.artistName,
    }));
  }
  async function candidatasDeezer(artista, musica) {
    const d = await jsonp(`https://api.deezer.com/search?output=jsonp&limit=20&q=${encodeURIComponent(artista + " " + musica)}`);
    return (d.data || []).map((r) => ({
      mini: r.album.cover_medium, grande: r.album.cover_xl || r.album.cover_big,
      titulo: r.album.title, ano: "", fonte: "Deezer", artista: r.artist.name,
    }));
  }
  async function candidatasMusicBrainz(artista, musica) {
    const limpa = (t) => t.replace(/[\(\[].*?[\)\]]/g, " ").replace(/["\\]/g, " ").trim();
    const q = `recording:"${limpa(musica)}" AND artist:"${limpa(artista)}"`;
    const r = await fetch(`https://musicbrainz.org/ws/2/recording/?fmt=json&limit=25&query=${encodeURIComponent(q)}`);
    const d = await r.json();
    const vistos = new Set(), out = [];
    for (const rec of d.recordings || []) for (const rel of rec.releases || []) {
      if (vistos.has(rel.id) || out.length >= 16) continue;
      vistos.add(rel.id);
      out.push({ mini: `https://coverartarchive.org/release/${rel.id}/front-250`, grande: `https://coverartarchive.org/release/${rel.id}/front-1200`,
        titulo: rel.title, ano: (rel.date || "").slice(0, 4), fonte: "MusicBrainz", artista: (rec["artist-credit"] || []).map((c) => c.name).join(" & "), pais: rel.country || "" });
    }
    return out;
  }

  let buscaCandidatas = 0;
  async function mostrarCandidatas(mu) {
    const id = ++buscaCandidatas;
    const caixa = $("#ed-opcoes");
    candidatas = [];
    caixa.innerHTML = `<p class="ed-carregando">Procurando capas…</p>`;
    const artista = nomeArtista(mu.a), musica = mu.m.replace(/\s*[\(\[].*$/, "");
    const fontes = await Promise.allSettled([candidatasApple(artista, musica), candidatasMusicBrainz(artista, musica), candidatasDeezer(artista, musica)]);
    if (id !== buscaCandidatas) return; // usuário já abriu outra capa
    const vistas = new Set(), lista = [];
    for (const f of fontes) if (f.status === "fulfilled") for (const c of f.value) {
      const chave = c.grande;
      if (!c.mini || vistas.has(chave)) continue;
      // só capas do artista certo (parcerias contam)
      if (c.artista && !norm(c.artista).split(" ").some((p) => p.length > 2 && norm(artista).includes(p))) continue;
      vistas.add(chave);
      lista.push(c);
    }
    // capas do ano de lançamento da planilha primeiro; as sem ano vão para o fim
    if (mu.al) {
      const dist = (c) => (/^\d{4}$/.test(c.ano) ? Math.abs(+c.ano - mu.al) : 999);
      lista.sort((a, b) => dist(a) - dist(b));
    }
    candidatas = [...candidatas.filter((c) => c.fonte.startsWith("Site do roNca")), ...lista.slice(0, 36)];
    desenharCandidatas();
  }

  let candidatas = [];
  function desenharCandidatas() {
    const caixa = $("#ed-opcoes");
    if (!candidatas.length) {
      caixa.innerHTML = `<p class="ed-carregando">Nenhuma capa encontrada. Tente o site do roNca ou o Google Imagens (e cole o endereço abaixo).</p>`;
      return;
    }
    caixa.innerHTML = candidatas.map((c, i) => `<button type="button" class="ed-opcao${c.provavel ? " provavel" : ""}" data-i="${i}" title="${esc(c.titulo || "")}${c.ano ? " (" + c.ano + ")" : ""} · ${esc(c.fonte)}">
      <img src="${esc(c.mini)}" alt="" loading="lazy" onerror="this.closest('.ed-opcao').remove()">
      ${c.provavel ? `<b class="selo">★ provável</b>` : ""}<span>${esc(c.titulo || "")}${c.ano ? ` <i>${c.ano}</i>` : ""}</span><small>${esc(c.fonte)}${c.pais ? " · " + esc(c.pais) : ""}</small></button>`).join("");
    caixa.onclick = (e) => {
      const b = e.target.closest(".ed-opcao");
      if (!b) return;
      $("#ed-url").value = candidatas[+b.dataset.i].grande;
      salvarEditor(false);
    };
  }

  // ---- imagens das bulas do site do roNca (a API do WordPress deles libera o acesso) ----
  const SITE_RONCA = "https://www.roncaronca.com.br";
  const IMG_NAO_CAPA = /free_?radio|weapon_?tico|musica\.conecta|apoiase|^\d+(?:-\d+)?\.(?:jpe?g|png)$/i;
  async function bulaDoPrograma(n) {
    const r = await fetch(`${SITE_RONCA}/wp-json/wp/v2/posts?per_page=10&_fields=title,content,link&search=${encodeURIComponent("bula #" + n)}`);
    const posts = await r.json();
    const div = document.createElement("div");
    return (posts || []).find((p) => {
      div.innerHTML = p.title.rendered;
      const t = div.textContent.toLowerCase();
      return t.includes("bula") && new RegExp("#\\s*" + n + "(?!\\d)").test(t);
    }) || null;
  }

  function imagensDaBula(post, mu, n) {
    const doc = new DOMParser().parseFromString(post.content.rendered, "text/html");
    const alvoA = norm(mu.a), alvoM = norm(mu.m.replace(/\s*[\(\[].*$/, ""));
    const out = [];
    let bloco = [];
    const absoluto = (u) => new URL(u, SITE_RONCA).href.replace(/^http:/, "https:");
    doc.body.querySelectorAll("p, img").forEach((el) => {
      if (el.tagName === "P") {
        // um <p> pode ter várias linhas separadas por <br>
        el.innerHTML.split(/<br\s*\/?>/i).forEach((html) => {
          const t = new DOMParser().parseFromString(html, "text/html").body.textContent.trim();
          const m = t.match(/^(.+?)\s*[–—-]\s*[“"″«]\s*(.+?)\s*[”"″»]/);
          if (m) bloco.push({ a: norm(m[1]), m: norm(m[2]) });
        });
        return;
      }
      const src = el.getAttribute("src");
      if (!src) return;
      const nome = src.split("/").pop();
      const w = +el.getAttribute("width") || 999;
      const ehDaFaixa = bloco.some((b) => b.a === alvoA && (b.m.startsWith(alvoM) || alvoM.startsWith(b.m)));
      bloco = [];
      if (IMG_NAO_CAPA.test(nome) || w < 200) return;
      let mini = absoluto(src);
      const ss = el.getAttribute("srcset");
      if (ss) {
        const op = ss.split(",").map((x) => x.trim().split(/\s+/)).filter((x) => /w$/.test(x[1] || "")).map((x) => [parseInt(x[1]), x[0]]).filter((x) => x[0] >= 300).sort((a, b) => a[0] - b[0]);
        if (op.length) mini = absoluto(op[0][1]);
      }
      out.push({ mini, grande: absoluto(src), titulo: ehDaFaixa ? "logo depois da faixa" : nome, ano: "", fonte: `Site do roNca · #${n}`, provavel: ehDaFaixa });
    });
    return out;
  }

  async function buscarNoRonca() {
    const mu = editando;
    const progs = [...new Set([editandoProg, ...mu.progs].filter(Boolean))].slice(0, 6);
    const btn = $("#ed-ronca");
    btn.disabled = true;
    mensagemEd(`Procurando nas bulas ${progs.map((p) => "#" + p).join(", ")}…`);
    try {
      const achadas = [];
      for (const n of progs) {
        const p = await bulaDoPrograma(n).catch(() => null);
        if (p) achadas.push(...imagensDaBula(p, mu, n));
        if (achadas.some((c) => c.provavel)) break; // achou a foto da faixa: não precisa abrir mais bulas
      }
      if (editando !== mu) return;
      const vistas = new Set();
      const unicas = achadas.sort((a, b) => b.provavel - a.provavel).filter((c) => !vistas.has(c.grande) && vistas.add(c.grande));
      if (!unicas.length) { mensagemEd(`Nenhuma imagem de disco nas bulas ${progs.map((p) => "#" + p).join(", ")}.`, "erro"); return; }
      candidatas = [...unicas, ...candidatas.filter((c) => !c.fonte.startsWith("Site do roNca"))];
      desenharCandidatas();
      $("#ed-opcoes").scrollTop = 0;
      mensagemEd(unicas.some((c) => c.provavel) ? "Imagens do site do roNca no topo; a marcada com ★ vem logo depois da faixa na bula." : "Imagens do site do roNca no topo (nenhuma colada à faixa; confira).");
    } catch (e) {
      mensagemEd("Não deu para consultar o site do roNca: " + e.message, "erro");
    } finally {
      btn.disabled = false;
    }
  }

  let editando = null, editandoProg = null;
  function abrirEditor(k, prog = null) {
    const mu = D.musicas.get(k);
    if (!mu) return;
    editando = mu;
    editandoProg = prog;
    const dlg = $("#editor");
    $("#ed-faixa").innerHTML = `<b>${esc(mu.m)}</b> — ${esc(nomeArtista(mu.a))}${mu.al ? ` · ${mu.al}` : ""}`;
    $("#ed-atual").innerHTML = capaHTML({ ...mu }, 250).replace(/<button[\s\S]*?<\/button>/, "");
    $("#ed-nova").innerHTML = `<div class="capa sem" data-ini="?"></div>`;
    $("#ed-url").value = "";
    $("#ed-msg").textContent = "";
    $("#ed-msg").className = "ed-msg";
    $("#ed-token-box").hidden = !!tokenGH();
    $("#ed-restaurar").hidden = !D.manuais[k]; // só desfaz a escolha feita para este nome exato
    $("#ed-salvar").hidden = true;
    $("#ed-manual").open = false;
    // Google Imagens: "álbum artista ano" (sem álbum conhecido, usa o nome da música)
    const album = (mu.album || mu.m).replace(/\s*[\(\[][^\)\]]*[\)\]]/g, "").trim() || mu.m;
    $("#ed-google").href = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent([album, nomeArtista(mu.a), mu.al].filter(Boolean).join(" "))}`;
    dlg.showModal();
    mostrarCandidatas(mu);
  }

  function mensagemEd(txt, tipo = "") { $("#ed-msg").textContent = txt; $("#ed-msg").className = "ed-msg " + tipo; }

  async function salvarEditor(remover) {
    const mu = editando;
    const url = $("#ed-url").value.trim();
    if (!remover && !/^https?:\/\/\S+$/i.test(url)) return mensagemEd("Cole o endereço completo da imagem (começando com https://).", "erro");
    const token = tokenGH() || $("#ed-token").value.trim();
    if (!token) {
      $("#ed-token-box").hidden = false;
      $("#ed-salvar").hidden = false;
      $("#ed-token").focus();
      return mensagemEd("Falta o token do GitHub (só na primeira vez). Cole e clique em Salvar.", "erro");
    }
    const botoes = document.querySelectorAll("#editor button");
    botoes.forEach((b) => (b.disabled = true));
    mensagemEd("Salvando…");
    try {
      const entrada = remover ? null : { url, em: new Date().toISOString() };
      const msg = `${remover ? "Volta a capa original de" : "Troca a capa de"} ${nomeArtista(mu.a)} – ${mu.m}`;
      await gravarManual(mu.k, entrada, token, msg);
      try { localStorage.setItem(CHAVE_TOKEN, token); } catch { /* sem armazenamento: pede de novo da próxima vez */ }
      if (remover) { delete D.manuais[mu.k]; delete D.manuaisBase[mu.base]; }
      else { D.manuais[mu.k] = { url }; D.manuaisBase[mu.base] = { url }; }
      $("#editor").close();
      rotear();
      aviso(remover ? "Capa original de volta. O site publicado atualiza em 1 a 2 minutos." : "Capa trocada! O site baixa e guarda a imagem em 1 a 2 minutos.");
    } catch (e) {
      if (e.token) {
        $("#ed-salvar").hidden = false;
        try { localStorage.removeItem(CHAVE_TOKEN); } catch { /* idem */ }
        $("#ed-token-box").hidden = false;
        $("#ed-token").value = "";
        mensagemEd("O GitHub recusou o token. Confira se ele tem permissão de escrita (Contents) neste repositório.", "erro");
      } else mensagemEd("Não deu para salvar: " + e.message, "erro");
    } finally {
      botoes.forEach((b) => (b.disabled = false));
    }
  }

  function aviso(txt) {
    const a = $("#aviso");
    a.textContent = txt;
    a.classList.add("visivel");
    clearTimeout(aviso.t);
    aviso.t = setTimeout(() => a.classList.remove("visivel"), 6000);
  }

  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest(".capa-editar");
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    abrirEditor(b.dataset.k, b.dataset.p ? +b.dataset.p : null);
  }, true);
  $("#ed-url").addEventListener("input", () => {
    const u = $("#ed-url").value.trim();
    $("#ed-salvar").hidden = !u;
    $("#ed-nova").innerHTML = /^https?:\/\//i.test(u)
      ? `<div class="capa" data-ini="?"><img src="${esc(u)}" alt="" onerror="this.parentNode.classList.add('sem');this.remove()"></div>`
      : `<div class="capa sem" data-ini="?"></div>`;
  });
  $("#editor form").addEventListener("submit", (e) => { e.preventDefault(); salvarEditor(false); }); // Salvar ou Enter
  $("#ed-restaurar").addEventListener("click", (e) => { e.preventDefault(); salvarEditor(true); });
  $("#ed-cancelar").addEventListener("click", (e) => { e.preventDefault(); $("#editor").close(); });
  $("#ed-ronca").addEventListener("click", (e) => { e.preventDefault(); buscarNoRonca(); });

  // ---------- atualizar o site agora (só administrador) ----------
  // Dispara a Action "Atualizar acervo" pela API do GitHub e acompanha até o fim.
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));
  async function ghApi(caminho, token, opcoes = {}) {
    const r = await fetch(`https://api.github.com/repos/${REPO}/${caminho}`, {
      ...opcoes, cache: "no-store",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", ...(opcoes.body ? { "Content-Type": "application/json" } : {}) },
    });
    if (r.status === 401) throw Object.assign(new Error("O GitHub recusou o token."), { token: true });
    return r;
  }
  const PASSOS = ["Pedir a atualização ao GitHub", "Ler a planilha e buscar capas novas", "Publicar o site"];
  function passo(i, extra = "") {
    const ol = $("#at-passos");
    ol.hidden = false;
    ol.innerHTML = PASSOS.map((p, j) => `<li class="${j < i ? "feito" : j === i ? "agora" : ""}">${j < i ? "✓ " : ""}${p}${j === i && extra ? ` <small>${esc(extra)}</small>` : ""}</li>`).join("");
  }
  const msgAt = (t, tipo = "") => { $("#at-msg").textContent = t; $("#at-msg").className = "ed-msg " + tipo; };
  let atualizando = false;

  function abrirAtualizar() {
    if (!atualizando) {
      $("#at-token-box").hidden = !!tokenGH();
      $("#at-passos").hidden = true;
      $("#at-ir").hidden = false;
      $("#at-ir").disabled = false;
      msgAt("");
    }
    $("#dlg-atualizar").showModal();
  }

  async function rodarAtualizacao() {
    const token = tokenGH() || $("#at-token").value.trim();
    if (!token) { $("#at-token-box").hidden = false; $("#at-token").focus(); return msgAt("Cole o token do GitHub para continuar.", "erro"); }
    atualizando = true;
    $("#at-ir").disabled = true;
    $("#atualizar").classList.add("girando");
    msgAt("");
    try {
      passo(0);
      const shaDe = async () => { const r = await ghApi("commits/main", token); if (!r.ok) throw new Error(`GitHub respondeu ${r.status}`); return (await r.json()).sha; };
      const antes = await shaDe();
      const inicio = new Date(Date.now() - 10000).toISOString();
      const d = await ghApi("actions/workflows/atualizar.yml/dispatches", token, { method: "POST", body: JSON.stringify({ ref: "main", return_run_details: true }) });
      if (d.status === 403 || d.status === 404) throw Object.assign(new Error("O token não tem permissão para rodar a atualização. Edite o token no GitHub e dê a permissão Actions: Read and write."), { token: true });
      if (!d.ok) throw new Error(`GitHub respondeu ${d.status}`);
      try { localStorage.setItem(CHAVE_TOKEN, token); } catch { /* idem */ }
      $("#at-token-box").hidden = true;
      let runId = null;
      try { runId = (await d.json()).workflow_run_id || null; } catch { /* resposta sem corpo: acha a execução pela lista */ }

      const t0 = Date.now();
      let run = null;
      while (Date.now() - t0 < 12 * 60 * 1000) {
        await espera(5000);
        const seg = Math.round((Date.now() - t0) / 1000);
        if (runId) run = await (await ghApi(`actions/runs/${runId}`, token)).json();
        else {
          const l = await (await ghApi(`actions/workflows/atualizar.yml/runs?event=workflow_dispatch&per_page=1&created=%3E%3D${encodeURIComponent(inicio)}`, token)).json();
          run = (l.workflow_runs || [])[0] || null;
          if (run) runId = run.id;
        }
        passo(1, run ? (run.status === "queued" ? `na fila… ${seg}s` : `${seg}s`) : `aguardando o GitHub… ${seg}s`);
        if (run && run.status === "completed") break;
      }
      if (!run || run.status !== "completed") throw new Error("a atualização está demorando mais que o normal. Confira a aba Actions do repositório.");
      if (run.conclusion !== "success") throw new Error(`a atualização falhou (${run.conclusion}). Veja os detalhes em ${run.html_url}`);

      if ((await shaDe()) === antes) {
        passo(3);
        msgAt("Nada novo na planilha — o site já está em dia.");
        return;
      }
      // houve commit: o GitHub Pages republica em cerca de um minuto
      for (let s = 75; s > 0; s--) { passo(2, `recarregando em ${s}s`); await espera(1000); }
      location.reload();
    } catch (e) {
      if (e.token) {
        try { localStorage.removeItem(CHAVE_TOKEN); } catch { /* idem */ }
        $("#at-token-box").hidden = false;
        $("#at-token").value = "";
      }
      msgAt(e.message.charAt(0).toUpperCase() + e.message.slice(1), "erro");
    } finally {
      atualizando = false;
      $("#at-ir").disabled = false;
      $("#atualizar").classList.remove("girando");
    }
  }
  $("#atualizar").addEventListener("click", abrirAtualizar);
  $("#dlg-atualizar form").addEventListener("submit", (e) => { e.preventDefault(); if (!atualizando) rodarAtualizacao(); });
  $("#at-fechar").addEventListener("click", () => $("#dlg-atualizar").close());

  // ---------- acesso restrito ----------
  // Só a impressão digital (SHA-256) de "usuário:senha" fica no código, nunca a senha.
  const ACESSO = "f783f921ecda562c78ed26db4353c58818d32d4c27dbac57c82895d08649957d";
  const ADMIN = "41ec4ae270e40595a8848dea34c3c5b6638d84c7d7c03803c340db013d8fffae"; // pode trocar capas
  // ---------- claro / escuro (botão no rodapé) ----------
  // Sem escolha salva, segue o sistema. O ícone mostra o modo atual (sol = claro, lua = escuro).
  const sistemaEscuro = matchMedia("(prefers-color-scheme: dark)");
  const temaAtual = () => document.documentElement.dataset.tema || (sistemaEscuro.matches ? "escuro" : "claro");
  function pintarBotaoTema() {
    const escuro = temaAtual() === "escuro";
    const b = $("#tema");
    b.classList.toggle("escuro", escuro);
    b.title = escuro ? "Mudar para o modo claro" : "Mudar para o modo escuro";
    b.setAttribute("aria-label", b.title);
  }
  $("#tema").addEventListener("click", () => {
    const novo = temaAtual() === "escuro" ? "claro" : "escuro";
    document.documentElement.dataset.tema = novo;
    try { localStorage.setItem("ronca-tema", novo); } catch { /* sem armazenamento: vale só nesta visita */ }
    pintarBotaoTema();
  });
  sistemaEscuro.addEventListener("change", pintarBotaoTema);
  pintarBotaoTema();

  const CHAVE_ACESSO = "ronca-acesso";
  const guardado = (onde) => { try { return onde.getItem(CHAVE_ACESSO); } catch { return null; } };
  const guardar = (onde, v) => { try { onde.setItem(CHAVE_ACESSO, v); } catch { /* navegador sem armazenamento */ } };

  async function impressao(texto) {
    const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
    return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
  }

  function iniciar(acesso) {
    D.admin = acesso === ADMIN;
    document.body.classList.toggle("admin", D.admin);
    document.body.classList.remove("bloqueado");
    carregar().then(() => { D.pronto = true; dicas(); rotear(); }).catch((e) => {
      console.error(e);
      app.innerHTML = `<div class="vazio">Não deu para carregar o Na UÉBI. Recarregue a página.</div>`;
    });
  }

  document.querySelectorAll(".sair").forEach((el) => el.addEventListener("click", (e) => {
    e.preventDefault();
    try { localStorage.removeItem(CHAVE_ACESSO); sessionStorage.removeItem(CHAVE_ACESSO); } catch { /* idem */ }
    location.replace(location.pathname);
  }));

  const salvo = [guardado(localStorage), guardado(sessionStorage)].find((v) => v === ACESSO || v === ADMIN);
  if (salvo) {
    iniciar(salvo);
  } else {
    $("#login-usuario").focus();
    $("#login-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const usuario = $("#login-usuario").value.trim().toLowerCase();
      const senha = $("#login-senha").value;
      const acesso = await impressao(`${usuario}:${senha}`);
      if (acesso !== ACESSO && acesso !== ADMIN) {
        $("#login-erro").textContent = "Usuário ou senha incorretos.";
        $("#login-senha").value = "";
        $("#login-senha").focus();
        return;
      }
      guardar($("#login-lembrar").checked ? localStorage : sessionStorage, acesso);
      iniciar(acesso);
    });
  }
})();
