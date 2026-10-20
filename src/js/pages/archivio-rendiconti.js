import {
  aggiornaQuotePeriodo,
  reportRendicontiArchiviatiOpzioni,
  reportRendicontoArchiviatoPiuRecente,
  reportRipartizioneArchiviatiPerRendiconto,
} from "../api.js";
import { chiediConferma } from "../conferma.js";

const STORAGE_RENDICONTO =
  window.STORAGE_ARCHIVIO_RENDICONTO || "gestione.archivioRendicontoDel";

let root = null;
let datiCache = null;
let rendicontoSelezionato = "";
let filtroTipologia = null;
let filtroProprieta = null;
let filtroOccupante = null;

function $(sel) {
  return root.querySelector(sel);
}

function mostraErrore(el, messaggio) {
  if (!el) return;
  if (!messaggio) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.textContent = messaggio;
}

function formatEuro(valore) {
  return Number(valore).toLocaleString("it-IT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatNum(valore, decimals = 2) {
  return Number(valore).toLocaleString("it-IT", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatDataIt(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function arrotondaEuro(valore) {
  return Math.round(Number(valore || 0) * 100) / 100;
}

function quotaInquilinoSpesa(spesa) {
  const competenza = spesa?.competenza || "INQUILINO";
  if (competenza === "PROPRIETARIO") return 0;
  if (competenza === "INQUILINO") return 100;
  const quota = Number(spesa?.quotaInquilino);
  if (!Number.isFinite(quota)) return 100;
  return Math.min(100, Math.max(0, quota));
}

function testoChiPaga(spesa) {
  const competenza = spesa?.competenza || "INQUILINO";
  const quota = quotaInquilinoSpesa(spesa);
  if (competenza === "PROPRIETARIO" || quota <= 0) return "Solo proprietà";
  if (competenza === "ENTRAMBI") {
    return `Entrambi ${formatNum(quota, 2)}% / ${formatNum(arrotondaEuro(100 - quota), 2)}%`;
  }
  return "Tutta inquilino";
}

function splitImporto(spesa, importo) {
  const tot = Number(importo) || 0;
  const occupante = arrotondaEuro((tot * quotaInquilinoSpesa(spesa)) / 100);
  const proprieta = arrotondaEuro(tot - occupante);
  return { occupante, proprieta };
}

function nomeProprieta(q) {
  return (q.proprietaUnita || "").trim();
}

function nomeOccupante(q) {
  return (q.nominativo || "").trim();
}

function ordinaQuotePerIdentificativo(quote) {
  return [...quote].sort((a, b) => {
    const idA = (a.identificativo || "").trim();
    const idB = (b.identificativo || "").trim();
    const cmpId = idA.localeCompare(idB, "it", { numeric: true, sensitivity: "base" });
    if (cmpId !== 0) return cmpId;
    const subA = (a.subalterno || "").trim();
    const subB = (b.subalterno || "").trim();
    const cmpSub = subA.localeCompare(subB, "it", { numeric: true, sensitivity: "base" });
    if (cmpSub !== 0) return cmpSub;
    const cmpProp = nomeProprieta(a).localeCompare(nomeProprieta(b), "it");
    if (cmpProp !== 0) return cmpProp;
    return nomeOccupante(a).localeCompare(nomeOccupante(b), "it");
  });
}

function haFiltroAttivo() {
  return filtroTipologia != null || filtroProprieta != null || filtroOccupante != null;
}

function etichettaFiltriAttivi() {
  const pezzi = [];
  if (filtroTipologia) pezzi.push(`tipologia «${filtroTipologia}»`);
  if (filtroProprieta) pezzi.push(`proprietà «${filtroProprieta}»`);
  if (filtroOccupante) pezzi.push(`occupante «${filtroOccupante}»`);
  return pezzi.join(" e ");
}

function aggiornaBannerFiltro() {
  const riga = $("#filtri-riga");

  const bannerTip = $("#filtro-tipologia");
  const nomeTip = $("#filtro-tipologia-nome");
  if (bannerTip && nomeTip) {
    bannerTip.hidden = !filtroTipologia;
    nomeTip.textContent = filtroTipologia || "";
  }

  const bannerProp = $("#filtro-proprieta");
  const nomeProp = $("#filtro-proprieta-nome");
  if (bannerProp && nomeProp) {
    bannerProp.hidden = !filtroProprieta;
    nomeProp.textContent = filtroProprieta || "";
  }

  const bannerOcc = $("#filtro-occupante");
  const nomeOcc = $("#filtro-occupante-nome");
  if (bannerOcc && nomeOcc) {
    bannerOcc.hidden = !filtroOccupante;
    nomeOcc.textContent = filtroOccupante || "";
  }

  if (riga) riga.hidden = !haFiltroAttivo();
}

function aggiornaTotaleHeader(occupanti, proprieta) {
  const box = $("#rip-totale-head");
  const valUnico = $("#rip-totale-unico");
  const valOcc = $("#rip-totale-occupanti");
  const valProp = $("#rip-totale-proprieta");
  if (!box || !valUnico || !valOcc || !valProp) return;
  const occ = arrotondaEuro(occupanti);
  const prop = arrotondaEuro(proprieta);
  valUnico.textContent = `€ ${formatEuro(arrotondaEuro(occ + prop))}`;
  valOcc.textContent = `€ ${formatEuro(occ)}`;
  valProp.textContent = `€ ${formatEuro(prop)}`;
  box.hidden = false;
}

function nascondiTotali() {
  const box = $("#rip-totale-head");
  if (box) box.hidden = true;
  const boxRiepiloghi = $("#rip-riepiloghi");
  if (boxRiepiloghi) {
    boxRiepiloghi.innerHTML = "";
    boxRiepiloghi.hidden = true;
  }
}

function quotePassanoFiltri(q) {
  if (filtroProprieta != null && nomeProprieta(q) !== filtroProprieta) return false;
  if (filtroOccupante != null && nomeOccupante(q) !== filtroOccupante) return false;
  return true;
}

function spesaSoloProprieta(spesa) {
  if ((spesa?.competenza || "") === "PROPRIETARIO") return true;
  const quota = Number(spesa?.quotaInquilino);
  return Number.isFinite(quota) && quota <= 0;
}

function nascondiSpesaPerOccupante(spesa) {
  return filtroOccupante != null && spesaSoloProprieta(spesa);
}

function applicaFiltroTipologia(nome) {
  const pulito = (nome || "").trim();
  if (!pulito || pulito === "—" || filtroTipologia === pulito) return;
  filtroTipologia = pulito;
  if (datiCache) renderDati(datiCache);
}

function applicaFiltroProprieta(nome) {
  const pulito = (nome || "").trim();
  if (!pulito || pulito === "—" || filtroProprieta === pulito) return;
  filtroProprieta = pulito;
  if (datiCache) renderDati(datiCache);
}

function applicaFiltroOccupante(nome) {
  const pulito = (nome || "").trim();
  if (!pulito || pulito === "—" || filtroOccupante === pulito) return;
  filtroOccupante = pulito;
  if (datiCache) renderDati(datiCache);
}

function togliFiltroTipologia() {
  if (!filtroTipologia) return;
  filtroTipologia = null;
  if (datiCache) renderDati(datiCache);
}

function togliFiltroProprieta() {
  if (!filtroProprieta) return;
  filtroProprieta = null;
  if (datiCache) renderDati(datiCache);
}

function togliFiltroOccupante() {
  if (!filtroOccupante) return;
  filtroOccupante = null;
  if (datiCache) renderDati(datiCache);
}

function azzeraFiltri() {
  filtroTipologia = null;
  filtroProprieta = null;
  filtroOccupante = null;
  aggiornaBannerFiltro();
}

async function popolaSelectRendiconti() {
  const sel = $("#filtro-rendiconto");
  if (!sel) return;

  const valorePrima = rendicontoSelezionato;
  sel.innerHTML = `<option value="">— Seleziona un rendiconto —</option>`;

  const opzioni = await reportRendicontiArchiviatiOpzioni();
  for (const v of opzioni || []) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    sel.appendChild(opt);
  }

  if (valorePrima && [...sel.options].some((o) => o.value === valorePrima)) {
    sel.value = valorePrima;
    rendicontoSelezionato = valorePrima;
  } else {
    sel.value = "";
    rendicontoSelezionato = "";
    sessionStorage.removeItem(STORAGE_RENDICONTO);
  }
}

async function ripristinaPeriodo(periodo) {
  const etichetta = `${formatDataIt(periodo.periodoDa)} → ${formatDataIt(periodo.periodoA)}`;
  const ok = await chiediConferma(
    `Ripristinare il periodo ${etichetta}?\n` +
      `Tornerà tra le spese attive (Ripartizione spese conteggiate) e sparirà da questo rendiconto.`
  );
  if (!ok) return;

  mostraErrore($("#rip-error"), "");
  const quote = periodo.quote || [];
  if (!quote.length) {
    mostraErrore($("#rip-error"), `Il periodo ${etichetta} non ha quote da ripristinare.`);
    return;
  }

  try {
    await aggiornaQuotePeriodo(periodo.idPeriodo, {
      quote: quote.map((q) => ({
        idRiparto: q.idRiparto,
        percentuale: Number(q.percentuale),
        peso: Number(q.peso),
      })),
      archivia: false,
      rendicontoDel: "",
    });
    await popolaSelectRendiconti();
    await carica();
  } catch (err) {
    mostraErrore($("#rip-error"), String(err));
  }
}

function renderDati(dati) {
  const corpo = $("#rip-corpo");
  const vuoto = $("#rip-vuoto");
  corpo.innerHTML = "";
  aggiornaBannerFiltro();

  if (!dati?.spese?.length) {
    vuoto.hidden = false;
    vuoto.textContent = `Nessuna spesa archiviata per il rendiconto «${rendicontoSelezionato}».`;
    aggiornaTotaleHeader(0, 0);
    aggiornaRiepiloghiVideo(dati);
    return;
  }

  let gestioneCorrente = null;
  let mostrate = 0;
  let totaleOccupanti = 0;
  let totaleProprieta = 0;

  for (const spesa of dati.spese) {
    if (filtroTipologia != null && (spesa.gruppoSpesa || "").trim() !== filtroTipologia) {
      continue;
    }
    if (nascondiSpesaPerOccupante(spesa)) continue;

    const usaMillesimi = spesa.ripartizione === "Millesimi";
    const periodiVisibili = [];
    for (const p of spesa.periodi) {
      const quote = ordinaQuotePerIdentificativo((p.quote || []).filter(quotePassanoFiltri));
      if (!quote.length) continue;
      periodiVisibili.push({ periodo: p, quote });
    }
    if (!periodiVisibili.length) continue;

    if (spesa.gestione !== gestioneCorrente) {
      gestioneCorrente = spesa.gestione;
      const sep = document.createElement("div");
      sep.className = "gestione-sep";
      sep.textContent = gestioneCorrente;
      corpo.appendChild(sep);
    }

    const card = document.createElement("article");
    card.className = "spesa-card";
    card.dataset.idSpesa = String(spesa.idSpesa);

    const head = document.createElement("div");
    head.className = "spesa-head";
    head.innerHTML = `
      <div class="campo"><span class="lbl">IdSpe</span><span class="val" data-k="id"></span></div>
      <div class="campo"><span class="lbl">Genere</span><span class="val val-genere" data-k="gen"></span></div>
      <div class="campo"><span class="lbl">Ripartizione</span><span class="val" data-k="rip"></span></div>
      <div class="campo"><span class="lbl">Chi paga</span><span class="val" data-k="paga"></span></div>
      <div class="campo"><span class="lbl">Da</span><span class="val" data-k="da"></span></div>
      <div class="campo"><span class="lbl">A</span><span class="val" data-k="a"></span></div>
      <div class="campo"><span class="lbl">Gg</span><span class="val" data-k="gg"></span></div>
      <div class="campo"><span class="lbl">Cifra</span><span class="val" data-k="cifra"></span></div>
      <div class="campo"><span class="lbl">Spese</span><span class="val" data-k="spese"></span></div>
      <div class="campo"><span class="lbl">Totale</span><span class="val val-euro" data-k="tot"></span></div>
    `;
    head.querySelector('[data-k="id"]').textContent = String(spesa.idSpesa);
    const genEl = head.querySelector('[data-k="gen"]');
    genEl.textContent = spesa.gruppoSpesa;
    genEl.title = "Doppio clic: mostra solo questa tipologia";
    genEl.addEventListener("dblclick", () => applicaFiltroTipologia(spesa.gruppoSpesa));
    head.querySelector('[data-k="rip"]').textContent = spesa.ripartizione || "—";
    head.querySelector('[data-k="paga"]').textContent = testoChiPaga(spesa);
    head.querySelector('[data-k="da"]').textContent = formatDataIt(spesa.spesaDa);
    head.querySelector('[data-k="a"]').textContent = formatDataIt(spesa.spesaA);
    head.querySelector('[data-k="gg"]').textContent = String(spesa.giorni);
    head.querySelector('[data-k="cifra"]').textContent = `€ ${formatEuro(spesa.cifra)}`;
    head.querySelector('[data-k="spese"]').textContent = `€ ${formatEuro(spesa.spesePagamento)}`;
    head.querySelector('[data-k="tot"]').textContent = `€ ${formatEuro(spesa.totale)}`;
    card.appendChild(head);

    let totaleOccupantiSpesa = 0;
    let totaleProprietaSpesa = 0;

    for (const { periodo: p, quote } of periodiVisibili) {
      const blocco = document.createElement("div");
      blocco.className = "periodo-blocco";

      const pHead = document.createElement("div");
      pHead.className = "periodo-head";
      pHead.innerHTML = `
        <div class="campo"><span class="lbl">Da</span><span class="val" data-k="da"></span></div>
        <div class="campo"><span class="lbl">A</span><span class="val" data-k="a"></span></div>
        <div class="campo"><span class="lbl">Giorni</span><span class="val" data-k="gg"></span></div>
        <span class="periodo-totale">Totale periodo conteggiato: € <span data-k="imp"></span></span>
        <button type="button" class="btn-ripristina-periodo" title="Riporta il periodo tra le spese attive">
          Ripristina
        </button>
      `;
      pHead.querySelector('[data-k="da"]').textContent = formatDataIt(p.periodoDa);
      pHead.querySelector('[data-k="a"]').textContent = formatDataIt(p.periodoA);
      pHead.querySelector('[data-k="gg"]').textContent = String(p.giorni);
      pHead.querySelector('[data-k="imp"]').textContent = formatEuro(p.importo);
      pHead.querySelector(".btn-ripristina-periodo").addEventListener("click", () => {
        ripristinaPeriodo(p);
      });
      blocco.appendChild(pHead);

      const table = document.createElement("table");
      table.className = "quote-table";
      table.innerHTML = `
        <thead>
          <tr>
            <th>ID</th>
            <th>Sub</th>
            <th>Proprietà</th>
            <th>Occupante</th>
            <th class="num">%</th>
            <th class="num">Parti</th>
            <th class="num">Millesimi</th>
            <th class="num">Quota</th>
            <th class="num">Importo occupante</th>
            <th class="num">Importo proprietà</th>
          </tr>
        </thead>
        <tbody></tbody>
      `;
      const tbody = table.querySelector("tbody");
      let sommaOccupanti = 0;
      let sommaProprieta = 0;
      for (const q of quote) {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td class="col-id"></td>
          <td class="col-sub"></td>
          <td class="col-proprieta"></td>
          <td class="col-nome"></td>
          <td class="num"></td>
          <td class="num"></td>
          <td class="num"></td>
          <td class="num"></td>
          <td class="num"></td>
          <td class="num"></td>
        `;
        const td = tr.children;
        const prop = nomeProprieta(q) || "—";
        const occ = nomeOccupante(q) || "—";
        td[0].textContent = (q.identificativo || "").trim() || "—";
        td[1].textContent = (q.subalterno || "").trim() || "—";
        td[2].textContent = prop;
        td[2].title = "Doppio clic: mostra solo questa proprietà";
        td[2].addEventListener("dblclick", () => applicaFiltroProprieta(prop));
        td[3].textContent = occ;
        td[3].title = "Doppio clic: mostra solo questo occupante";
        td[3].addEventListener("dblclick", () => applicaFiltroOccupante(occ));
        td[4].textContent = formatNum(q.percentuale, 2);
        if (usaMillesimi) {
          td[5].textContent = "";
          td[6].textContent = formatNum(q.peso, 2);
        } else {
          td[5].textContent = formatNum(q.peso, 0);
          td[6].textContent = "";
        }
        td[7].textContent = formatNum(q.baseCalcolo, 2);
        const split = splitImporto(spesa, q.importo);
        td[8].textContent = `€ ${formatEuro(split.occupante)}`;
        td[9].textContent = `€ ${formatEuro(split.proprieta)}`;
        sommaOccupanti += split.occupante;
        sommaProprieta += split.proprieta;
        tbody.appendChild(tr);
      }
      blocco.appendChild(table);

      sommaOccupanti = arrotondaEuro(sommaOccupanti);
      sommaProprieta = arrotondaEuro(sommaProprieta);
      totaleOccupantiSpesa += sommaOccupanti;
      totaleProprietaSpesa += sommaProprieta;

      const foot = document.createElement("div");
      foot.className = "periodo-foot";
      foot.innerHTML = `
        <span>Totale quote: ${quote.length}</span>
        <span>Occupanti</span>
        <span class="tot-euro-box tot-occupanti"></span>
        <span>Proprietà</span>
        <span class="tot-euro-box tot-proprieta"></span>
      `;
      foot.querySelector(".tot-occupanti").textContent = formatEuro(sommaOccupanti);
      foot.querySelector(".tot-proprieta").textContent = formatEuro(sommaProprieta);
      blocco.appendChild(foot);
      card.appendChild(blocco);
    }

    totaleOccupantiSpesa = arrotondaEuro(totaleOccupantiSpesa);
    totaleProprietaSpesa = arrotondaEuro(totaleProprietaSpesa);
    totaleOccupanti += totaleOccupantiSpesa;
    totaleProprieta += totaleProprietaSpesa;

    const sFoot = document.createElement("div");
    sFoot.className = "spesa-foot";
    sFoot.innerHTML = `
      <span>Totale occupanti</span>
      <span class="tot-euro-box tot-occupanti-spesa"></span>
      <span>Totale proprietà</span>
      <span class="tot-euro-box tot-proprieta-spesa"></span>
    `;
    sFoot.querySelector(".tot-occupanti-spesa").textContent =
      `€ ${formatEuro(totaleOccupantiSpesa)}`;
    sFoot.querySelector(".tot-proprieta-spesa").textContent =
      `€ ${formatEuro(totaleProprietaSpesa)}`;
    card.appendChild(sFoot);

    corpo.appendChild(card);
    mostrate += 1;
  }

  if (!mostrate) {
    vuoto.hidden = false;
    vuoto.textContent = haFiltroAttivo()
      ? `Nessuna ripartizione per ${etichettaFiltriAttivi()}.`
      : `Nessuna spesa archiviata per il rendiconto «${rendicontoSelezionato}».`;
    aggiornaTotaleHeader(0, 0);
    aggiornaRiepiloghiVideo(dati);
    return;
  }

  vuoto.hidden = true;
  aggiornaTotaleHeader(totaleOccupanti, totaleProprieta);
  aggiornaRiepiloghiVideo(dati);
}

async function carica() {
  mostraErrore($("#rip-error"), "");
  const corpo = $("#rip-corpo");
  const vuoto = $("#rip-vuoto");

  if (!rendicontoSelezionato) {
    datiCache = null;
    corpo.innerHTML = "";
    vuoto.hidden = false;
    vuoto.textContent = "Seleziona un rendiconto nell’elenco in alto per vedere le quote.";
    nascondiTotali();
    aggiornaBannerFiltro();
    return;
  }

  corpo.innerHTML = `<p class="muted">Caricamento…</p>`;
  vuoto.hidden = true;
  nascondiTotali();

  try {
    datiCache = await reportRipartizioneArchiviatiPerRendiconto(rendicontoSelezionato);
    renderDati(datiCache);
  } catch (err) {
    datiCache = null;
    corpo.innerHTML = "";
    nascondiTotali();
    mostraErrore($("#rip-error"), String(err));
  }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function pezziPerAnno(periodoDa, periodoA) {
  const da = dataUtc(periodoDa);
  const a = dataUtc(periodoA);
  if (da == null || a == null || a < da) return [{ anno: "—", giorni: 1 }];

  const pezzi = [];
  let cursor = da;
  while (cursor <= a) {
    const anno = new Date(cursor).getUTCFullYear();
    const fine = Math.min(Date.UTC(anno, 11, 31), a);
    const giorni = Math.round((fine - cursor) / 86400000) + 1;
    pezzi.push({ anno: String(anno), giorni });
    cursor = fine + 86400000;
  }
  return pezzi;
}

function dataUtc(iso) {
  if (!iso || String(iso).length < 10) return null;
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  return Date.UTC(y, m - 1, d);
}

function distribuisciPerAnni(periodoDa, periodoA, importo) {
  const pezzi = pezziPerAnno(periodoDa, periodoA);
  const totGiorni = pezzi.reduce((s, p) => s + p.giorni, 0) || 1;
  const tot = Number(importo) || 0;
  let assegnato = 0;
  return pezzi.map((p, i) => {
    const quota =
      i === pezzi.length - 1
        ? arrotondaEuro(tot - assegnato)
        : arrotondaEuro((tot * p.giorni) / totGiorni);
    assegnato += quota;
    return { anno: p.anno, importo: quota };
  });
}

function speseVisibili(dati) {
  const lista = [];
  for (const spesa of dati?.spese || []) {
    if (filtroTipologia != null && (spesa.gruppoSpesa || "").trim() !== filtroTipologia) {
      continue;
    }
    if (nascondiSpesaPerOccupante(spesa)) continue;
    lista.push(spesa);
  }
  return lista;
}

function aggregaChiPagaPerAnno(dati) {
  const map = new Map();
  for (const spesa of speseVisibili(dati)) {
    for (const p of spesa.periodi || []) {
      for (const q of p.quote || []) {
        if (!quotePassanoFiltri(q)) continue;
        const split = splitImporto(spesa, q.importo);
        const partiOcc = distribuisciPerAnni(p.periodoDa, p.periodoA, split.occupante);
        const partiProp = distribuisciPerAnni(p.periodoDa, p.periodoA, split.proprieta);
        const anni = new Set([
          ...partiOcc.map((x) => x.anno),
          ...partiProp.map((x) => x.anno),
        ]);
        for (const anno of anni) {
          if (!map.has(anno)) map.set(anno, { anno, occupanti: 0, proprietaEuro: 0 });
          const g = map.get(anno);
          g.occupanti += partiOcc.find((x) => x.anno === anno)?.importo || 0;
          g.proprietaEuro += partiProp.find((x) => x.anno === anno)?.importo || 0;
        }
      }
    }
  }
  return [...map.values()]
    .map((g) => ({
      anno: g.anno,
      occupanti: arrotondaEuro(g.occupanti),
      proprietaEuro: arrotondaEuro(g.proprietaEuro),
    }))
    .sort((a, b) => String(a.anno).localeCompare(String(b.anno), "it"));
}

function aggregaChiPagaPerProprieta(dati) {
  const map = new Map();
  for (const spesa of speseVisibili(dati)) {
    for (const p of spesa.periodi || []) {
      for (const q of p.quote || []) {
        if (!quotePassanoFiltri(q)) continue;
        const key = nomeProprieta(q) || "(senza proprietà)";
        if (!map.has(key)) map.set(key, { etichetta: key, anni: new Map() });
        const gruppo = map.get(key);
        const split = splitImporto(spesa, q.importo);
        const partiOcc = distribuisciPerAnni(p.periodoDa, p.periodoA, split.occupante);
        const partiProp = distribuisciPerAnni(p.periodoDa, p.periodoA, split.proprieta);
        const anni = new Set([
          ...partiOcc.map((x) => x.anno),
          ...partiProp.map((x) => x.anno),
        ]);
        for (const anno of anni) {
          if (!gruppo.anni.has(anno)) {
            gruppo.anni.set(anno, { anno, occupanti: 0, proprietaEuro: 0 });
          }
          const g = gruppo.anni.get(anno);
          g.occupanti += partiOcc.find((x) => x.anno === anno)?.importo || 0;
          g.proprietaEuro += partiProp.find((x) => x.anno === anno)?.importo || 0;
        }
      }
    }
  }
  return [...map.values()]
    .map((g) => {
      const anni = [...g.anni.values()]
        .map((a) => ({
          anno: a.anno,
          occupanti: arrotondaEuro(a.occupanti),
          proprietaEuro: arrotondaEuro(a.proprietaEuro),
        }))
        .sort((a, b) => String(a.anno).localeCompare(String(b.anno), "it"));
      return {
        etichetta: g.etichetta,
        anni,
        occupanti: arrotondaEuro(anni.reduce((s, a) => s + a.occupanti, 0)),
        proprietaEuro: arrotondaEuro(anni.reduce((s, a) => s + a.proprietaEuro, 0)),
      };
    })
    .sort((a, b) => a.etichetta.localeCompare(b.etichetta, "it"));
}

function aggiungiTabellaTotali(contenitore, titolo, nomePrimaColonna, righe) {
  contenitore.appendChild(el("h2", "rip-stampa-sez rip-stampa-sez-fine", titolo));
  if (!righe.length) {
    contenitore.appendChild(el("p", "rip-stampa-vuoto", "Nessun totale da stampare."));
    return;
  }

  const table = document.createElement("table");
  table.className = "rip-stampa-prop-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th></th>
        <th class="num">Totale occupanti</th>
        <th class="num">Totale proprietà</th>
        <th class="num">Totale</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  table.querySelector("th").textContent = nomePrimaColonna;
  const tbody = table.querySelector("tbody");
  for (const g of righe) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td></td><td class="num"></td><td class="num"></td><td class="num"></td>`;
    tr.children[0].textContent = g.etichetta;
    tr.children[1].textContent = `€ ${formatEuro(g.occupanti)}`;
    tr.children[2].textContent = `€ ${formatEuro(g.proprietaEuro)}`;
    tr.children[3].textContent = `€ ${formatEuro(arrotondaEuro(g.occupanti + g.proprietaEuro))}`;
    tbody.appendChild(tr);
  }

  const totOcc = arrotondaEuro(righe.reduce((acc, g) => acc + g.occupanti, 0));
  const totProp = arrotondaEuro(righe.reduce((acc, g) => acc + g.proprietaEuro, 0));
  const tfoot = document.createElement("tfoot");
  const trTot = document.createElement("tr");
  trTot.innerHTML = `<td>Totale</td><td class="num"></td><td class="num"></td><td class="num"></td>`;
  trTot.children[1].textContent = `€ ${formatEuro(totOcc)}`;
  trTot.children[2].textContent = `€ ${formatEuro(totProp)}`;
  trTot.children[3].textContent = `€ ${formatEuro(arrotondaEuro(totOcc + totProp))}`;
  tfoot.appendChild(trTot);
  table.appendChild(tfoot);
  contenitore.appendChild(table);
}

function aggiungiTabellaProprietaPerAnno(contenitore, gruppi) {
  contenitore.appendChild(el("h2", "rip-stampa-sez rip-stampa-sez-fine", "Riepilogo per proprietà"));
  if (!gruppi.length) {
    contenitore.appendChild(el("p", "rip-stampa-vuoto", "Nessun totale da stampare."));
    return;
  }

  const table = document.createElement("table");
  table.className = "rip-stampa-prop-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th>Proprietà</th>
        <th>Anno</th>
        <th class="num">Totale occupanti</th>
        <th class="num">Totale proprietà</th>
        <th class="num">Totale</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = table.querySelector("tbody");
  let totOcc = 0;
  let totProp = 0;

  for (const g of gruppi) {
    (g.anni || []).forEach((anno, i) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td></td><td></td><td class="num"></td><td class="num"></td><td class="num"></td>`;
      tr.children[0].textContent = i === 0 ? g.etichetta : "";
      tr.children[1].textContent = anno.anno;
      tr.children[2].textContent = `€ ${formatEuro(anno.occupanti)}`;
      tr.children[3].textContent = `€ ${formatEuro(anno.proprietaEuro)}`;
      tr.children[4].textContent = `€ ${formatEuro(arrotondaEuro(anno.occupanti + anno.proprietaEuro))}`;
      tbody.appendChild(tr);
    });

    if ((g.anni || []).length > 1) {
      const tr = document.createElement("tr");
      tr.className = "rip-stampa-prop-sub";
      tr.innerHTML = `<td></td><td></td><td class="num"></td><td class="num"></td><td class="num"></td>`;
      tr.children[1].textContent = "Totale";
      tr.children[2].textContent = `€ ${formatEuro(g.occupanti)}`;
      tr.children[3].textContent = `€ ${formatEuro(g.proprietaEuro)}`;
      tr.children[4].textContent = `€ ${formatEuro(arrotondaEuro(g.occupanti + g.proprietaEuro))}`;
      tbody.appendChild(tr);
    }

    totOcc += g.occupanti;
    totProp += g.proprietaEuro;
  }

  totOcc = arrotondaEuro(totOcc);
  totProp = arrotondaEuro(totProp);
  const tfoot = document.createElement("tfoot");
  const trTot = document.createElement("tr");
  trTot.innerHTML = `<td>Totale</td><td></td><td class="num"></td><td class="num"></td><td class="num"></td>`;
  trTot.children[2].textContent = `€ ${formatEuro(totOcc)}`;
  trTot.children[3].textContent = `€ ${formatEuro(totProp)}`;
  trTot.children[4].textContent = `€ ${formatEuro(arrotondaEuro(totOcc + totProp))}`;
  tfoot.appendChild(trTot);
  table.appendChild(tfoot);
  contenitore.appendChild(table);
}

function aggiornaRiepiloghiVideo(dati) {
  const box = $("#rip-riepiloghi");
  if (!box) return;
  box.innerHTML = "";

  const anni = aggregaChiPagaPerAnno(dati).map((g) => ({
    etichetta: g.anno,
    occupanti: g.occupanti,
    proprietaEuro: g.proprietaEuro,
  }));
  const proprieta = aggregaChiPagaPerProprieta(dati);
  if (!anni.length && !proprieta.length) {
    box.hidden = true;
    return;
  }

  box.hidden = false;
  const boxAnni = el("section", "rip-riepilogo-box");
  aggiungiTabellaTotali(boxAnni, "Riepilogo per anno", "Anno", anni);
  box.appendChild(boxAnni);

  const boxProp = el("section", "rip-riepilogo-box");
  aggiungiTabellaProprietaPerAnno(boxProp, proprieta);
  box.appendChild(boxProp);
}

function costruisciSezioneSpesePeriodi(contenitore, dati) {
  contenitore.appendChild(el("h2", "rip-stampa-sez", "Spese e periodi"));

  const spese = dati?.spese || [];
  if (!spese.length) {
    contenitore.appendChild(el("p", "rip-stampa-vuoto", "Nessuna spesa con periodi da stampare."));
    return { occupanti: 0, proprieta: 0 };
  }

  let gestioneCorrente = null;
  let totaleOccupanti = 0;
  let totaleProprieta = 0;
  let mostrate = 0;

  for (const spesa of spese) {
    if (filtroTipologia != null && (spesa.gruppoSpesa || "").trim() !== filtroTipologia) continue;
    if (nascondiSpesaPerOccupante(spesa)) continue;

    const usaMillesimi = spesa.ripartizione === "Millesimi";
    const periodiVisibili = [];
    for (const p of spesa.periodi || []) {
      const quote = ordinaQuotePerIdentificativo((p.quote || []).filter(quotePassanoFiltri));
      if (!quote.length) continue;
      periodiVisibili.push({ periodo: p, quote });
    }
    if (!periodiVisibili.length) continue;

    if (spesa.gestione !== gestioneCorrente) {
      gestioneCorrente = spesa.gestione;
      contenitore.appendChild(el("div", "rip-stampa-gestione", gestioneCorrente));
    }

    const card = el("article", "rip-stampa-spesa");
    const head = el("div", "rip-stampa-spesa-head");
    head.textContent = [
      `#${spesa.idSpesa}`,
      spesa.gruppoSpesa || "",
      spesa.ripartizione || "",
      testoChiPaga(spesa),
      `${formatDataIt(spesa.spesaDa)}–${formatDataIt(spesa.spesaA)}`,
      `${spesa.giorni} gg`,
      `€ ${formatEuro(spesa.totale)}`,
    ]
      .filter(Boolean)
      .join(" · ");
    card.appendChild(head);

    let totaleOccupantiSpesa = 0;
    let totaleProprietaSpesa = 0;

    for (const { periodo: p, quote } of periodiVisibili) {
      const blocco = el("div", "rip-stampa-periodo");
      const pHead = el("div", "rip-stampa-periodo-head");
      pHead.textContent = `Periodo ${formatDataIt(p.periodoDa)}–${formatDataIt(p.periodoA)} · ${p.giorni} gg · € ${formatEuro(p.importo)}`;
      blocco.appendChild(pHead);

      const table = document.createElement("table");
      table.className = "rip-stampa-quote";
      table.innerHTML = `
        <thead>
          <tr>
            <th>ID</th>
            <th>Sub</th>
            <th>Proprietà</th>
            <th>Occupante</th>
            <th class="num">%</th>
            <th class="num">${usaMillesimi ? "Mill." : "Parti"}</th>
            <th class="num">Quota</th>
            <th class="num">Imp. occupante</th>
            <th class="num">Imp. proprietà</th>
          </tr>
        </thead>
        <tbody></tbody>
      `;
      const tbody = table.querySelector("tbody");
      let sommaOccupanti = 0;
      let sommaProprieta = 0;
      for (const q of quote) {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td></td><td></td><td></td><td></td>
          <td class="num"></td><td class="num"></td>
          <td class="num"></td><td class="num"></td><td class="num"></td>
        `;
        const td = tr.children;
        td[0].textContent = (q.identificativo || "").trim() || "—";
        td[1].textContent = (q.subalterno || "").trim() || "—";
        td[2].textContent = nomeProprieta(q) || "—";
        td[3].textContent = nomeOccupante(q) || "—";
        td[4].textContent = formatNum(q.percentuale, 2);
        td[5].textContent = usaMillesimi ? formatNum(q.peso, 2) : formatNum(q.peso, 0);
        td[6].textContent = formatNum(q.baseCalcolo, 2);
        const split = splitImporto(spesa, q.importo);
        td[7].textContent = `€ ${formatEuro(split.occupante)}`;
        td[8].textContent = `€ ${formatEuro(split.proprieta)}`;
        sommaOccupanti += split.occupante;
        sommaProprieta += split.proprieta;
        tbody.appendChild(tr);
      }
      blocco.appendChild(table);
      totaleOccupantiSpesa += arrotondaEuro(sommaOccupanti);
      totaleProprietaSpesa += arrotondaEuro(sommaProprieta);
      card.appendChild(blocco);
    }

    totaleOccupanti += arrotondaEuro(totaleOccupantiSpesa);
    totaleProprieta += arrotondaEuro(totaleProprietaSpesa);
    contenitore.appendChild(card);
    mostrate += 1;
  }

  if (!mostrate) {
    contenitore.appendChild(
      el(
        "p",
        "rip-stampa-vuoto",
        haFiltroAttivo()
          ? `Nessuna ripartizione per ${etichettaFiltriAttivi()}.`
          : "Nessuna spesa con periodi da stampare."
      )
    );
  }

  return {
    occupanti: arrotondaEuro(totaleOccupanti),
    proprieta: arrotondaEuro(totaleProprieta),
  };
}

async function costruisciDocumentoStampa() {
  const box = $("#rip-stampa");
  if (!box) return;

  box.innerHTML = "";
  box.hidden = false;

  const condo =
    document.querySelector("#nome-condominio")?.textContent?.trim() || "Condominio";
  const dataOra = new Date().toLocaleString("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const intest = el("div", "rip-stampa-intestazione");
  intest.innerHTML = `<strong></strong><span></span>`;
  intest.querySelector("strong").textContent = condo;
  let meta = `Archivio rendiconto del ${rendicontoSelezionato} · ${dataOra}`;
  if (haFiltroAttivo()) meta += ` · ${etichettaFiltriAttivi()}`;
  intest.querySelector("span").textContent = meta;
  box.appendChild(intest);

  const titolo = el("h1", "rip-stampa-titolo", "Archivio Rendiconti");
  box.appendChild(titolo);

  const totSpese = costruisciSezioneSpesePeriodi(box, datiCache || { spese: [] });

  const totBox = el("div", "rip-stampa-totale-gen");
  totBox.innerHTML = `
    <div class="rip-stampa-totale-riga">
      <span>Totale occupanti</span><strong class="tot-occ"></strong>
      <span>Totale proprietà</span><strong class="tot-prop"></strong>
      <span>Totale</span><strong class="tot-unico"></strong>
    </div>
  `;
  totBox.querySelector(".tot-unico").textContent = `€ ${formatEuro(
    arrotondaEuro(totSpese.occupanti + totSpese.proprieta)
  )}`;
  totBox.querySelector(".tot-occ").textContent = `€ ${formatEuro(totSpese.occupanti)}`;
  totBox.querySelector(".tot-prop").textContent = `€ ${formatEuro(totSpese.proprieta)}`;
  titolo.after(totBox);

  const anni = aggregaChiPagaPerAnno(datiCache).map((g) => ({
    etichetta: g.anno,
    occupanti: g.occupanti,
    proprietaEuro: g.proprietaEuro,
  }));
  aggiungiTabellaTotali(box, "Riepilogo per anno", "Anno", anni);
  aggiungiTabellaProprietaPerAnno(box, aggregaChiPagaPerProprieta(datiCache));
}

async function stampaElenco() {
  if (!rendicontoSelezionato) {
    mostraErrore($("#rip-error"), "Seleziona prima un rendiconto da stampare.");
    return;
  }
  mostraErrore($("#rip-error"), "");

  const btn = $("#btn-stampa-archivio");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Preparazione…";
  }

  try {
    await costruisciDocumentoStampa();
    const titoloPrima = document.title;
    const condo =
      document.querySelector("#nome-condominio")?.textContent?.trim() || "Condominio";
    document.title = `Archivio rendiconto ${rendicontoSelezionato} — ${condo}`;

    let pulito = false;
    const afterPrint = () => {
      if (pulito) return;
      pulito = true;
      document.title = titoloPrima;
      const box = $("#rip-stampa");
      if (box) {
        box.innerHTML = "";
        box.hidden = true;
      }
      window.removeEventListener("afterprint", afterPrint);
    };
    window.addEventListener("afterprint", afterPrint);
    window.print();
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Stampa";
    }
  }
}

export async function onEnter(pageRoot) {
  root = pageRoot;
  datiCache = null;
  azzeraFiltri();
  rendicontoSelezionato = (sessionStorage.getItem(STORAGE_RENDICONTO) || "").trim();
  const forzaRecente =
    sessionStorage.getItem("gestione.apriRendicontoRecente") === "archivio-rendiconti";
  if (forzaRecente) {
    sessionStorage.removeItem("gestione.apriRendicontoRecente");
  }
  $("#filtro-rendiconto")?.addEventListener("change", async () => {
    rendicontoSelezionato = ($("#filtro-rendiconto").value || "").trim();
    if (rendicontoSelezionato) {
      sessionStorage.setItem(STORAGE_RENDICONTO, rendicontoSelezionato);
    } else {
      sessionStorage.removeItem(STORAGE_RENDICONTO);
    }
    azzeraFiltri();
    await carica();
  });
  $("#btn-togli-filtro-tipologia")?.addEventListener("click", () => togliFiltroTipologia());
  $("#btn-togli-filtro-proprieta")?.addEventListener("click", () => togliFiltroProprieta());
  $("#btn-togli-filtro-occupante")?.addEventListener("click", () => togliFiltroOccupante());
  $("#btn-stampa-archivio")?.addEventListener("click", () => stampaElenco());

  try {
    if (forzaRecente || !rendicontoSelezionato) {
      const recente = ((await reportRendicontoArchiviatoPiuRecente()) || "").trim();
      if (recente) {
        rendicontoSelezionato = recente;
        sessionStorage.setItem(STORAGE_RENDICONTO, recente);
      }
    }
    await popolaSelectRendiconti();
    await carica();
  } catch (err) {
    mostraErrore($("#rip-error"), String(err));
  }
}

export function onLeave() {
  root = null;
  datiCache = null;
  filtroTipologia = null;
  filtroProprieta = null;
  filtroOccupante = null;
}
