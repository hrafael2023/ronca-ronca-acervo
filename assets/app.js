/* Acervo Ronca Ronca — tudo roda no navegador a partir de data/acervo.json e data/capas.json */
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
  const fmt1 = (n) => Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  const decada = (a) => (a ? Math.floor(a / 10) * 10 : null);
  const slug = (a) => encodeURIComponent(a.toLowerCase());
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
  };

  async function carregar() {
    const [acervo, capas] = await Promise.all([
      fetch("data/acervo.json", { cache: "no-cache" }).then((r) => r.json()),
      fetch("data/capas.json", { cache: "no-cache" }).then((r) => r.json()).catch(() => ({})),
    ]);
    const nomeDeezer = new Map();
    for (const [k, c] of Object.entries(capas)) {
      const art = k.split("|")[0];
      if (c[3] && norm(c[3]) === norm(art)) nomeDeezer.set(art, c[3]);
    }
    for (const p of acervo.programas) {
      const prog = { n: p.n, ano: p.ano, faixas: [] };
      p.f.forEach(([a, m, al], i) => {
        const k = `${a.toLowerCase()}|${m.toLowerCase()}`;
        const chaveA = a.toLowerCase().trim();
        const f = { p: p.n, ano: p.ano, a, m, al, k, pos: i + 1, chaveA };
        prog.faixas.push(f);
        D.faixas.push(f);
        let mu = D.musicas.get(k);
        if (!mu) {
          const c = capas[k];
          mu = { k, a, m, al, progs: [], capa: c ? c[0] : null, album: c ? c[1] : null, deezer: c ? c[2] : null, chaveA, n: norm(a + " " + m), na: norm(a), nm: norm(m) };
          D.musicas.set(k, mu);
        }
        if (!mu.al && al) mu.al = al;
        mu.progs.push(p.n);
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

  function capaHTML(mu, t = 250) {
    const md5 = mu && mu.capa;
    if (md5) return `<div class="capa"><img loading="lazy" src="${capaURL(md5, t)}" alt="${esc(mu.album || "")}" onerror="this.parentNode.classList.add('sem');this.remove()"></div>`;
    const ini = (mu ? nomeArtista(mu.a) : "?").replace(/^the /i, "").slice(0, 2);
    return `<div class="capa sem" data-ini="${esc(ini)}"></div>`;
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
      relevancia: (a, b) => b.s - a.s || b.mu.progs.length - a.mu.progs.length || b.mu.progs[0] - a.mu.progs[0],
      tocadas: (a, b) => b.mu.progs.length - a.mu.progs.length || b.mu.progs[0] - a.mu.progs[0],
      recentes: (a, b) => b.mu.progs[0] - a.mu.progs[0],
      antigas: (a, b) => (a.mu.al || 9999) - (b.mu.al || 9999),
      novas: (a, b) => (b.mu.al || 0) - (a.mu.al || 0),
      artista: (a, b) => a.mu.na.localeCompare(b.mu.na) || a.mu.nm.localeCompare(b.mu.nm),
    }[modo];
    return f ? lista.slice().sort(f) : lista;
  }

  function marcar(txt, termos) {
    let h = esc(txt);
    if (!termos || !termos.length) return h;
    // marca sem acento: compara caractere a caractere na versão normalizada
    const base = txt.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
    if (base.length !== txt.length) return h;
    const marcas = new Array(txt.length).fill(false);
    for (const t of termos) {
      let i = base.indexOf(t);
      while (i >= 0) { for (let j = i; j < i + t.length; j++) marcas[j] = true; i = base.indexOf(t, i + t.length); }
    }
    let out = "", aberto = false;
    for (let i = 0; i < txt.length; i++) {
      if (marcas[i] && !aberto) { out += "<mark>"; aberto = true; }
      if (!marcas[i] && aberto) { out += "</mark>"; aberto = false; }
      out += esc(txt[i]);
    }
    return out + (aberto ? "</mark>" : "");
  }

  function itemHTML(mu, termos, extra = "") {
    const progs = mu.progs.slice(0, 8).map((p) => `<a class="chip" href="#/programa/${p}">#${p}</a>`).join("");
    const resto = mu.progs.length > 8 ? `<span class="chip">+${mu.progs.length - 8}</span>` : "";
    const info = [mu.al ? `lançada em <a href="#/busca?c=ano&q=${mu.al}">${mu.al}</a>` : "", mu.album ? esc(mu.album) : "",
      mu.progs.length > 1 ? `tocada ${mu.progs.length}×` : "",
      mu.deezer ? `<a href="https://www.deezer.com/track/${mu.deezer}" target="_blank" rel="noopener">ouvir ↗</a>` : ""].filter(Boolean).join(" · ");
    return `<div class="item">${extra}${capaHTML(mu, 120)}
      <div><div class="t">${marcar(mu.m, termos)}</div>
      <div class="a"><a href="#/artista/${slug(mu.a.trim())}">${marcar(nomeArtista(mu.a), termos)}</a></div>
      <div class="info">${info}</div></div>
      <div class="progs">${progs}${resto}</div></div>`;
  }

  let estadoBusca = { pagina: 1 };
  function telaBusca(params) {
    const q = params.get("q") || "";
    const campo = params.get("c") || "tudo";
    const dec = params.get("d") || "";
    const ord = params.get("o") || "";
    $("#q").value = q;
    $("#campo").value = campo;
    const { c, lista: bruta, ordenado } = buscar(q, campo);
    if (!c) return telaInicio();
    let lista = bruta;
    if (dec) lista = lista.filter((r) => decada(r.mu.al) === +dec);
    const modo = ord || (ordenado ? "" : c.tipo === "texto" ? "relevancia" : "tocadas");
    lista = ordenar(lista, modo);
    const total = lista.length;
    const termos = c.tipo === "texto" ? c.termos : null;

    // cartão de artista quando a busca bate com um nome
    let artistaTopo = "";
    if (c.tipo === "texto" && c.campo !== "musica") {
      const cands = [...D.artistas.values()].filter((a) => a.na === c.q || (c.q.length > 3 && (" " + a.na).includes(" " + c.q))).sort((a, b) => b.total - a.total).slice(0, 3);
      if (cands.length) artistaTopo = `<div class="filtros">${cands.map((a) => `<a class="chip" style="font-size:14px;padding:6px 14px" href="#/artista/${slug(a.chave)}">${esc(a.nome)} — ${fmt(a.total)} execuções →</a>`).join("")}</div>`;
    }
    let titulo;
    if (c.tipo === "programa") titulo = c.de === c.ate ? `Programa <b>#${c.de}</b>` : `Programas <b>#${c.de}–#${c.ate}</b>`;
    else if (c.tipo === "ano") titulo = c.de === c.ate ? `Lançadas em <b>${c.de}</b>` : `Lançadas entre <b>${c.de}–${c.ate}</b>`;
    else titulo = `Resultados para <b>“${esc(q)}”</b>`;

    const decadas = [...new Set(bruta.map((r) => decada(r.mu.al)).filter(Boolean))].sort();
    const opt = (v, t, sel) => `<option value="${v}"${String(sel) === String(v) ? " selected" : ""}>${t}</option>`;
    estadoBusca = { lista, termos, pagina: 1 };
    app.innerHTML = `<section class="secao">
      <div class="secao-topo"><h2>${titulo}</h2>${c.tipo === "programa" && c.de === c.ate && D.porNumero.has(c.de) ? `<a class="mais" href="#/programa/${c.de}">ver página do programa →</a>` : ""}</div>
      ${artistaTopo}
      <div class="filtros">
        <span class="total">${fmt(total)} ${total === 1 ? "música" : "músicas"}</span>
        <select id="f-dec" aria-label="Década de lançamento">${opt("", "Todas as décadas", dec)}${decadas.map((d) => opt(d, `Anos ${String(d).slice(2)} (${d})`, dec)).join("")}</select>
        <select id="f-ord" aria-label="Ordenar">${opt("", ordenado ? "Ordem do setlist" : "Padrão", ord)}${opt("relevancia", "Relevância", ord)}${opt("tocadas", "Mais tocadas", ord)}${opt("recentes", "Tocadas recentemente", ord)}${opt("novas", "Lançamento: mais novas", ord)}${opt("antigas", "Lançamento: mais antigas", ord)}${opt("artista", "Artista A–Z", ord)}</select>
      </div>
      ${total ? `<div class="lista" id="lista"></div><div class="paginar" id="paginar"></div>` : `<div class="vazio cartao">Nada encontrado. Tente só o nome do artista, ou parte do título.</div>`}
    </section>`;
    const atualizarFiltro = () => {
      const p = new URLSearchParams({ q, c: campo });
      if ($("#f-dec").value) p.set("d", $("#f-dec").value);
      if ($("#f-ord").value) p.set("o", $("#f-ord").value);
      irPara("#/busca?" + p, true);
    };
    $("#f-dec").onchange = atualizarFiltro;
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
    const porDecada = new Map(), porAnoLanc = new Map(), porAnoRonca = new Map(), idade = new Map(), mapa = new Map();
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
          const kk = f.ano + "|" + d;
          mapa.set(kk, (mapa.get(kk) || 0) + 1);
        }
      }
    }
    const musicasTop = [...D.musicas.values()].sort((a, b) => b.progs.length - a.progs.length || b.progs[0] - a.progs[0]);
    let somaIdade = 0, nIdade = 0;
    for (const i of idade.values()) { somaIdade += i.s; nIdade += i.n; }
    const anosRonca = [...porAnoRonca.keys()].sort();
    D.est = { artistasTop, porDecada, porAnoLanc, porAnoRonca, idade, mapa, musicasTop, idadeMedia: somaIdade / nIdade, anosRonca };
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

  function mapaCalor(el, est) {
    const W = largura(el);
    const anos = est.anosRonca.filter((a) => est.idade.get(a));
    const decs = [...est.porDecada.keys()].filter((d) => d >= 1940).sort();
    const esq = 44, topo = 4, cw = (W - esq) / anos.length, ch = 20, H = topo + decs.length * ch + 22;
    let max = 0;
    const pct = (a, d) => { const t = est.idade.get(a).n; return (est.mapa.get(a + "|" + d) || 0) / t; };
    for (const a of anos) for (const d of decs) max = Math.max(max, pct(a, d));
    const cel = [];
    decs.forEach((d, j) => {
      cel.push(`<text x="${esq - 6}" y="${topo + j * ch + ch / 2 + 4}" text-anchor="end">${d < 2000 ? "’" + String(d).slice(2) : d}</text>`);
      anos.forEach((a, i) => {
        const p = pct(a, d);
        cel.push(`<g class="alvo" data-dica="<b>${a}</b> · músicas dos anos ${String(d).slice(2)}<br>${fmt1(p * 100)}% das faixas tocadas"><rect class="celula" x="${esq + i * cw + 1}" y="${topo + j * ch + 1}" width="${cw - 2}" height="${ch - 2}" rx="2" fill="var(--dado)" fill-opacity="${p === 0 ? 0.04 : 0.1 + 0.9 * (p / max)}"/></g>`);
      });
    });
    anos.forEach((a, i) => cel.push(`<text x="${esq + i * cw + cw / 2}" y="${H - 6}" text-anchor="middle">${W < 520 ? "’" + String(a).slice(2) : a}</text>`));
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img">${cel.join("")}</svg>`;
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
      <div class="kpi"><div class="v">${fmt(D.artistas.size)}</div><div class="r">artistas</div><div class="s">${fmt(D.musicas.size)} músicas diferentes</div></div>
      <div class="kpi"><div class="v">${Math.round(est.idadeMedia)} anos</div><div class="r">idade média da música</div><div class="s">entre lançamento e execução</div></div>
    </div>`;
  }

  function graficoDecadas(el, est) {
    const decs = [...est.porDecada.entries()].sort((a, b) => a[0] - b[0]);
    const tot = decs.reduce((s, d) => s + d[1], 0);
    colunas(el, decs.map(([d, v]) => ({ x: d, v, href: `#/busca?c=ano&q=${d}s`, dica: `<b>Anos ${String(d).slice(2)}</b><br>${fmt(v)} faixas · ${fmt1((v / tot) * 100)}%` })),
      { formatoX: (x) => (x < 2000 && x > 1900 ? "’" + String(x).slice(2) : String(x)), rotuloCada: largura(el) < 400 ? 2 : 1 });
  }

  function graficoTopArtistas(el, est, n) {
    barrasH(el, est.artistasTop.slice(0, n).map((a) => ({ r: a.nome, v: a.total, href: `#/artista/${slug(a.chave)}`, dica: `<b>${esc(a.nome)}</b><br>${fmt(a.total)} execuções em ${fmt(a.progs.size)} programas<br>${fmt(a.musicas.size)} músicas diferentes` })));
  }

  // ---------- telas ----------
  function telaInicio() {
    const est = estatisticas();
    const ult = D.programas[0];
    const estreias = new Set(ult.faixas.filter((f) => D.artistas.get(f.chaveA)?.primeiro === ult.n).map((f) => f.chaveA));
    const comAno = ult.faixas.filter((f) => f.al);
    const idadeUlt = comAno.length ? comAno.reduce((s, f) => s + (ult.ano - f.al), 0) / comAno.length : 0;
    const mosaico = ult.faixas.map((f) => D.musicas.get(f.k)).filter((m) => m.capa).slice(0, 9);
    const veterano = ult.faixas.map((f) => D.artistas.get(f.chaveA)).sort((a, b) => b.total - a.total)[0];

    app.innerHTML = `
    <section class="secao">
      <div class="secao-topo"><h2>Último programa: <b>#${ult.n}</b></h2><a class="mais" href="#/programas">todos os programas →</a></div>
      <div class="destaque-prog">
        <aside class="prog-card">
          <div class="num">#${ult.n}</div>
          <div class="ano">Ronca Ronca · ${ult.ano}</div>
          <div class="mosaico">${mosaico.map((m) => capaHTML(m, 120)).join("")}</div>
          <div class="stats">
            <div><b>${ult.faixas.length}</b>faixas</div>
            <div><b>${estreias.size}</b>artistas estreando</div>
            <div><b>${comAno.length ? Math.min(...comAno.map((f) => f.al)) : "–"}</b>a mais antiga</div>
            <div><b>${Math.round(idadeUlt)} anos</b>idade média</div>
          </div>
          ${veterano ? `<p style="font-size:13px;color:#bdc3e0;margin:14px 0 0">Figurinha carimbada: <a style="color:var(--amarelo)" href="#/artista/${slug(veterano.chave)}">${esc(veterano.nome)}</a>, ${fmt(veterano.total)} execuções na história do programa.</p>` : ""}
          <div class="botoes"><a class="btn" href="#/programa/${ult.n}">Ver setlist</a><a class="btn sec" href="https://www.roncaronca.com.br/" target="_blank" rel="noopener">Ouvir no site ↗</a></div>
        </aside>
        <div class="grade-capas">${ult.faixas.map((f) => cartaoFaixa(f, estreias.has(f.chaveA))).join("")}</div>
      </div>
    </section>
    <section class="secao">
      <div class="secao-topo"><h2>O Ronca em <b>números</b></h2><a class="mais" href="#/dashboard">dashboard completo →</a></div>
      ${kpisHTML(est)}
      <div class="graficos">
        <div class="cartao grafico"><h3>Artistas mais tocados</h3><div class="leg">execuções desde 2012 · clique para ver o artista</div><div id="g-top"></div></div>
        <div class="cartao grafico"><h3>De que década vem a música?</h3><div class="leg">faixas tocadas por década de lançamento</div><div id="g-dec"></div>
          <h3 style="margin-top:18px">Faixas por ano do programa</h3><div class="leg">total tocado em cada ano</div><div id="g-ano"></div></div>
      </div>
    </section>`;
    registrar(() => graficoTopArtistas($("#g-top"), est, 12));
    registrar(() => graficoDecadas($("#g-dec"), est));
    registrar(() => colunas($("#g-ano"), est.anosRonca.map((a) => ({ x: a, v: est.porAnoRonca.get(a), dica: `<b>${a}</b><br>${fmt(est.porAnoRonca.get(a))} faixas` })), { altura: 140, formatoX: (x) => "’" + String(x).slice(2), rotuloCada: largura($("#g-ano")) < 420 ? 2 : 1 }));
  }

  function cartaoFaixa(f, estreia) {
    const mu = D.musicas.get(f.k);
    const vezes = mu.progs.length;
    return `<div class="faixa-capa">${mu.deezer ? `<a href="https://www.deezer.com/track/${mu.deezer}" target="_blank" rel="noopener" title="Ouvir no Deezer">${capaHTML(mu)}</a>` : capaHTML(mu)}
      <div class="t">${esc(f.m)}</div><div class="a">${linkArtista(f.a)}</div>
      <div class="y">${[f.al, vezes > 1 ? `tocada ${vezes}×` : "", estreia ? `<span style="color:var(--destaque);font-weight:700">estreia</span>` : ""].filter(Boolean).join(" · ")}</div></div>`;
  }

  function telaPrograma(n) {
    const prog = D.porNumero.get(n);
    if (!prog) { app.innerHTML = `<div class="vazio">Programa #${n} não está no acervo.</div>`; return; }
    const nums = D.programas.map((p) => p.n);
    const i = nums.indexOf(n);
    const ant = nums[i + 1], prox = nums[i - 1];
    const estreias = new Set(prog.faixas.filter((f) => D.artistas.get(f.chaveA)?.primeiro === n).map((f) => f.chaveA));
    app.innerHTML = `<div class="cabeca"><div class="num">#${n}</div><div class="meta"><b>Ronca Ronca · ${prog.ano}</b><br>${prog.faixas.length} faixas · ${estreias.size} artistas estreando no programa</div>
      <div class="nav">${ant ? `<a href="#/programa/${ant}">← #${ant}</a>` : ""}${prox ? `<a href="#/programa/${prox}">#${prox} →</a>` : ""}</div></div>
      <div class="grade-capas" style="margin-bottom:28px">${prog.faixas.map((f) => cartaoFaixa(f, estreias.has(f.chaveA))).join("")}</div>
      <h2 style="margin-bottom:12px">Setlist</h2>
      <div class="lista setlist">${prog.faixas.map((f) => itemHTML(D.musicas.get(f.k), null, `<span class="n">${f.pos}</span>`)).join("")}</div>`;
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
    app.innerHTML = `<div class="cabeca">${capa ? `<div style="width:120px">${capaHTML(capa)}</div>` : ""}<div><h2><b>${esc(ar.nome)}</b></h2>
      <div class="meta" style="margin-top:6px">${fmt(ar.total)} execuções · ${fmt(ar.musicas.size)} músicas · ${fmt(ar.progs.size)} programas · ${rank}º mais tocado<br>
      Estreou no <a href="#/programa/${ar.primeiro}">#${ar.primeiro}</a> · última vez no <a href="#/programa/${ar.ultimo}">#${ar.ultimo}</a></div></div></div>
      <div class="graficos" style="margin-bottom:24px"><div class="cartao grafico largo"><h3>Execuções por ano do programa</h3><div class="leg">quantas faixas de ${esc(ar.nome)} tocaram em cada ano</div><div id="g-art"></div></div></div>
      <h2 style="margin-bottom:12px">Músicas tocadas</h2>
      <div class="lista">${musicas.map((m) => itemHTML(m)).join("")}</div>`;
    registrar(() => colunas($("#g-art"), est.anosRonca.map((a) => ({ x: a, v: porAno.get(a) || 0, dica: `<b>${a}</b><br>${fmt(porAno.get(a) || 0)} execuções` })), { altura: 150, formatoX: (x) => "’" + String(x).slice(2) }));
  }

  function telaProgramas() {
    const porAno = new Map();
    for (const p of D.programas) { if (!porAno.has(p.ano)) porAno.set(p.ano, []); porAno.get(p.ano).push(p); }
    app.innerHTML = `<div class="secao-topo"><h2>Todos os <b>programas</b></h2><span class="muted">${fmt(D.programas.length)} no acervo</span></div>` +
      [...porAno.entries()].map(([ano, ps]) => `<div class="programas-ano"><h3>${ano} <span class="muted" style="font-size:14px;font-weight:400">· ${ps.length} programas</span></h3><div class="prog-grade">${ps.map((p) => {
        const caps = p.faixas.map((f) => D.musicas.get(f.k)).filter((m) => m.capa).slice(0, 4);
        while (caps.length < 4) caps.push(null);
        return `<a class="prog-mini" href="#/programa/${p.n}"><div class="mosaico">${caps.map((m) => capaHTML(m, 120)).join("")}</div><b>#${p.n}</b><span>${p.faixas.length} faixas</span></a>`;
      }).join("")}</div></div>`).join("");
  }

  let letraAtual = "A";
  function telaArtistas() {
    const todos = [...D.artistas.values()].sort((a, b) => norm(a.nome.replace(/^the /i, "")).localeCompare(norm(b.nome.replace(/^the /i, ""))));
    const letraDe = (a) => { const c = norm(a.nome.replace(/^the /i, "")).charAt(0).toUpperCase(); return /[A-Z]/.test(c) ? c : "#"; };
    const letras = [..."#ABCDEFGHIJKLMNOPQRSTUVWXYZ"];
    const desenhar = () => {
      $("#letras").innerHTML = letras.map((l) => `<button class="${l === letraAtual ? "ativo" : ""}" data-l="${l}">${l}</button>`).join("");
      const lista = todos.filter((a) => letraDe(a) === letraAtual);
      $("#art-lista").innerHTML = lista.map((a) => `<a href="#/artista/${slug(a.chave)}">${esc(a.nome)}<span>${a.total}</span></a>`).join("") || `<div class="muted">Nenhum artista.</div>`;
    };
    app.innerHTML = `<div class="secao-topo"><h2>Todos os <b>artistas</b></h2><span class="muted">${fmt(todos.length)} artistas · o número é o total de execuções</span></div>
      <div class="letras" id="letras"></div><div class="cartao"><div class="artistas-lista" id="art-lista"></div></div>`;
    $("#letras").onclick = (e) => { const b = e.target.closest("button"); if (b) { letraAtual = b.dataset.l; desenhar(); } };
    desenhar();
  }

  function telaDashboard() {
    const est = estatisticas();
    const anosLanc = [];
    const minLanc = Math.min(...est.porAnoLanc.keys());
    for (let a = Math.max(1920, minLanc); a <= ANO_ATUAL; a++) anosLanc.push(a);
    const idadeDados = est.anosRonca.filter((a) => est.idade.get(a)).map((a) => { const i = est.idade.get(a); return { x: a, v: i.s / i.n, n: i.novas / i.n, dica: `<b>${a}</b><br>idade média: ${fmt1(i.s / i.n)} anos<br>${fmt1((i.novas / i.n) * 100)}% lançadas no ano ou no anterior` }; });
    const pico = [...est.porAnoLanc.entries()].sort((a, b) => b[1] - a[1])[0];
    const decTop = [...est.porDecada.entries()].sort((a, b) => b[1] - a[1])[0];
    const umaVez = [...D.artistas.values()].filter((a) => a.total === 1).length;
    app.innerHTML = `<div class="secao-topo"><h2>Dashboard do <b>acervo</b></h2></div>
      ${kpisHTML(est)}
      <div class="kpis">
        <div class="kpi"><div class="v">${decTop[0] < 2000 ? "Anos " + String(decTop[0]).slice(2) : decTop[0] + "s"}</div><div class="r">década favorita</div><div class="s">${fmt1((decTop[1] / D.faixas.length) * 100)}% das faixas</div></div>
        <div class="kpi"><div class="v">${pico[0]}</div><div class="r">ano de lançamento mais tocado</div><div class="s">${fmt(pico[1])} faixas</div></div>
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
        <div class="cartao grafico largo"><h3>Que décadas o Ronca tocou em cada ano</h3><div class="leg">% das faixas de cada ano do programa (coluna) vindas de cada década de lançamento (linha) · mais escuro = mais tocado</div><div id="d-mapa"></div></div>
        <div class="cartao grafico"><h3>Faixas por ano do programa</h3><div class="leg">total tocado em cada ano</div><div id="d-ano"></div></div>
        <div class="cartao grafico"><h3>O mais tocado de cada ano</h3><div class="leg">artista com mais execuções em cada ano do programa</div><div id="d-campeoes"></div></div>
      </div>`;
    registrar(() => graficoTopArtistas($("#d-top"), est, 25));
    registrar(() => barrasH($("#d-mus"), est.musicasTop.slice(0, 25).map((m) => ({ r: `${m.m} — ${nomeArtista(m.a)}`, v: m.progs.length, href: `#/artista/${slug(m.a.trim())}`, dica: `<b>${esc(m.m)}</b><br>${esc(nomeArtista(m.a))}${m.al ? " · " + m.al : ""}<br>tocada em ${m.progs.length} programas` })), { rotuloW: 230 }));
    registrar(() => { const el = $("#d-lanc"); const W = largura(el); colunas(el, anosLanc.map((a) => ({ x: a, v: est.porAnoLanc.get(a) || 0, href: `#/busca?c=ano&q=${a}`, dica: `<b>${a}</b><br>${fmt(est.porAnoLanc.get(a) || 0)} faixas` })), { altura: 200, rotuloCada: W < 500 ? 20 : 10 }); });
    registrar(() => graficoDecadas($("#d-dec"), est));
    registrar(() => linha($("#d-idade"), idadeDados));
    registrar(() => mapaCalor($("#d-mapa"), est));
    registrar(() => colunas($("#d-ano"), est.anosRonca.map((a) => ({ x: a, v: est.porAnoRonca.get(a), dica: `<b>${a}</b><br>${fmt(est.porAnoRonca.get(a))} faixas` })), { altura: 160, formatoX: (x) => "’" + String(x).slice(2), rotuloCada: largura($("#d-ano")) < 420 ? 2 : 1 }));
    // campeões por ano
    const camp = est.anosRonca.map((ano) => {
      const c = new Map();
      for (const f of D.faixas) if (f.ano === ano) c.set(f.chaveA, (c.get(f.chaveA) || 0) + 1);
      const [k, v] = [...c.entries()].sort((a, b) => b[1] - a[1])[0];
      return { ano, ar: D.artistas.get(k), v };
    }).reverse();
    $("#d-campeoes").innerHTML = `<table class="tabela-dados"><tbody>${camp.map((c) => `<tr><td>${c.ano}</td><td><a href="#/artista/${slug(c.ar.chave)}">${esc(c.ar.nome)}</a></td><td class="n">${c.v} faixas</td></tr>`).join("")}</tbody></table>`;
  }

  // ---------- rotas ----------
  function irPara(h, substituir) {
    if (substituir) { history.replaceState(null, "", h); rotear(); } else location.hash = h;
  }

  let rotaAnterior = null;
  function rotear() {
    desenhos = [];
    const h = location.hash.replace(/^#\/?/, "");
    const [caminho, qs] = h.split("?");
    const partes = caminho.split("/");
    document.querySelectorAll(".menu a").forEach((a) => a.classList.toggle("ativo", a.dataset.rota === partes[0]));
    if (partes[0] !== "busca") { $("#q").value = ""; }
    if (partes[0] === "busca") telaBusca(new URLSearchParams(qs || ""));
    else if (partes[0] === "programa") telaPrograma(+partes[1]);
    else if (partes[0] === "artista") telaArtista(decodeURIComponent(partes.slice(1).join("/")));
    else if (partes[0] === "programas") telaProgramas();
    else if (partes[0] === "artistas") telaArtistas();
    else if (partes[0] === "dashboard") telaDashboard();
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
  carregar().then(() => { dicas(); rotear(); }).catch((e) => {
    console.error(e);
    app.innerHTML = `<div class="vazio">Não deu para carregar o acervo. Recarregue a página.</div>`;
  });
})();
