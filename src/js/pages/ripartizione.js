import {
  aggiornaQuotePeriodo,
  reportRipartizioneSpeseConteggiate,
  reportRiepilogoRipartizione,
} from "../api.js";
import { chiediConferma } from "../conferma.js";

let root = null;
/** Ultimi dati caricati dal server (prima dei filtri). */
let datiCache = null;
/** Copia di lavoro in modifica multipla (null = sola lettura). */
let bozzaDati = null;
/** true = modalità modifica multipla attiva. */
let modoModificaMultipla = false;
/** true = modalità archivia periodi attiva. */
let modoArchivia = false;
/** Id periodi spuntati (number). */
let periodiSelezionati = new Set();
/** Nome tipologia (gruppoSpesa), oppure null = tutte. */
let filtroTipologia = null;
/** Nome proprietà selezionata, oppure null = tutte. */
let filtroProprieta = null;
/** Nominativo occupante selezionato, oppure null = tutti. */
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

function messaggioListaVuota() {
  const da = $("#rip-da")?.value;
  const a = $("#rip-a")?.value;
  if (da && a) {
    return "Nessuna spesa con periodi attivi in questo intervallo.";
  }
  return "Nessuna spesa attiva con periodi.";
}

function aggiornaPulsanteTogliDate() {
  const btn = $("#btn-togli-date");
  if (!btn) return;
  const attivo = Boolean($("#rip-da").value && $("#rip-a").value);
  btn.hidden = !attivo;
}

function nomeProprieta(q) {
  return (q.proprietaUnita || "").trim();
}

function nomeOccupante(q) {
  return (q.nominativo || "").trim();
}

/** Ordina le quote per Identificativo (poi Sub, Proprietà, Occupante). */
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
  return (
    filtroTipologia != null ||
    filtroProprieta != null ||
    filtroOccupante != null
  );
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
    if (!filtroTipologia) {
      bannerTip.hidden = true;
      nomeTip.textContent = "";
    } else {
      bannerTip.hidden = false;
      nomeTip.textContent = filtroTipologia;
    }
  }

  const bannerProp = $("#filtro-proprieta");
  const nomeProp = $("#filtro-proprieta-nome");
  if (bannerProp && nomeProp) {
    if (!filtroProprieta) {
      bannerProp.hidden = true;
      nomeProp.textContent = "";
    } else {
      bannerProp.hidden = false;
      nomeProp.textContent = filtroProprieta;
    }
  }

  const bannerOcc = $("#filtro-occupante");
  const nomeOcc = $("#filtro-occupante-nome");
  if (bannerOcc && nomeOcc) {
    if (!filtroOccupante) {
      bannerOcc.hidden = true;
      nomeOcc.textContent = "";
    } else {
      bannerOcc.hidden = false;
      nomeOcc.textContent = filtroOccupante;
    }
  }

  if (riga) {
    // Visibile solo se c’è almeno una chip attiva, sotto il testo descrittivo.
    riga.hidden = !(filtroTipologia || filtroProprieta || filtroOccupante);
  }
}

function aggiornaTotaleHeader(totale) {
  const box = $("#rip-totale-head");
  const val = $("#rip-totale-val");
  if (!box || !val) return;
  const n = Math.round(Number(totale || 0) * 100) / 100;
  val.textContent = `€ ${formatEuro(n)}`;
  box.hidden = false;
}

function quotePassanoFiltri(q) {
  if (filtroProprieta != null && nomeProprieta(q) !== filtroProprieta) {
    return false;
  }
  if (filtroOccupante != null && nomeOccupante(q) !== filtroOccupante) {
    return false;
  }
  return true;
}

function applicaFiltroTipologia(nome) {
  const pulito = (nome || "").trim();
  if (!pulito || pulito === "—") return;
  if (filtroTipologia === pulito) return;
  filtroTipologia = pulito;
  aggiornaBannerFiltro();
  if (datiAttivi()) renderDati(datiAttivi());
}

function applicaFiltroProprieta(nome) {
  const pulito = (nome || "").trim();
  if (!pulito || pulito === "—") return;
  if (filtroProprieta === pulito) return;
  filtroProprieta = pulito;
  aggiornaBannerFiltro();
  if (datiAttivi()) renderDati(datiAttivi());
}

function applicaFiltroOccupante(nome) {
  const pulito = (nome || "").trim();
  if (!pulito || pulito === "—") return;
  if (filtroOccupante === pulito) return;
  filtroOccupante = pulito;
  aggiornaBannerFiltro();
  if (datiAttivi()) renderDati(datiAttivi());
}

function togliFiltroTipologia() {
  if (!filtroTipologia) return;
  filtroTipologia = null;
  aggiornaBannerFiltro();
  if (datiAttivi()) renderDati(datiAttivi());
}

function togliFiltroProprieta() {
  if (!filtroProprieta) return;
  filtroProprieta = null;
  aggiornaBannerFiltro();
  if (datiAttivi()) renderDati(datiAttivi());
}

function togliFiltroOccupante() {
  if (!filtroOccupante) return;
  filtroOccupante = null;
  aggiornaBannerFiltro();
  if (datiAttivi()) renderDati(datiAttivi());
}

function datiAttivi() {
  return modoModificaMultipla && bozzaDati ? bozzaDati : datiCache;
}

function inModoSelezionePeriodi() {
  return modoModificaMultipla || modoArchivia;
}

function aggiornaUiModificaMultipla() {
  const pagina = root?.querySelector(".page-ripartizione") || root;
  pagina?.classList.toggle("is-multi-edit", modoModificaMultipla);
  pagina?.classList.toggle("is-archivia", modoArchivia);

  const hintMulti = $("#rip-multi-hint");
  if (hintMulti) hintMulti.hidden = !modoModificaMultipla;
  const hintArch = $("#rip-archivia-hint");
  if (hintArch) hintArch.hidden = !modoArchivia;

  const btnMod = $("#btn-modifica-multipla");
  const btnArch = $("#btn-archivia");
  const btnSalva = $("#btn-salva-multipla");
  const btnSalvaArch = $("#btn-salva-archivia");
  const btnAnnulla = $("#btn-annulla-multipla");
  const btnAnnullaArch = $("#btn-annulla-archivia");
  const btnStampa = $("#btn-stampa-rip");
  const boxRendiconto = $("#rip-rendiconto-archivia");

  const inModo = inModoSelezionePeriodi();
  if (btnMod) btnMod.hidden = inModo;
  if (btnArch) btnArch.hidden = inModo;
  if (btnSalva) btnSalva.hidden = !modoModificaMultipla;
  if (btnSalvaArch) btnSalvaArch.hidden = !modoArchivia;
  if (btnAnnulla) btnAnnulla.hidden = !modoModificaMultipla;
  if (btnAnnullaArch) btnAnnullaArch.hidden = !modoArchivia;
  if (btnStampa) btnStampa.hidden = inModo;
  if (boxRendiconto) boxRendiconto.hidden = !modoArchivia;
}

function entraModificaMultipla() {
  if (modoArchivia) {
    mostraErrore(
      $("#rip-error"),
      "Esci dalla modalità Archivia (Annulla) prima di modificare le quote."
    );
    return;
  }
  if (!datiCache?.spese?.length) {
    mostraErrore($("#rip-error"), "Non ci sono periodi da modificare.");
    return;
  }
  mostraErrore($("#rip-error"), "");
  modoModificaMultipla = true;
  bozzaDati = structuredClone(datiCache);
  periodiSelezionati = new Set();
  aggiornaUiModificaMultipla();
  renderDati(bozzaDati);
}

function esciModificaMultipla(ricaricaDopo) {
  modoModificaMultipla = false;
  bozzaDati = null;
  periodiSelezionati = new Set();
  aggiornaUiModificaMultipla();
  if (ricaricaDopo) {
    carica();
  } else if (datiCache) {
    renderDati(datiCache);
  }
}

function entraArchivia() {
  if (modoModificaMultipla) {
    mostraErrore(
      $("#rip-error"),
      "Esci dalla modifica multipla (Annulla o Salva) prima di archiviare."
    );
    return;
  }
  if (!datiCache?.spese?.length) {
    mostraErrore($("#rip-error"), "Non ci sono periodi da archiviare.");
    return;
  }
  mostraErrore($("#rip-error"), "");
  modoArchivia = true;
  periodiSelezionati = new Set();
  const inp = $("#rip-rendiconto-del");
  if (inp) inp.value = "";
  aggiornaUiModificaMultipla();
  renderDati(datiCache);
}

function esciArchivia(ricaricaDopo) {
  modoArchivia = false;
  periodiSelezionati = new Set();
  const inp = $("#rip-rendiconto-del");
  if (inp) inp.value = "";
  aggiornaUiModificaMultipla();
  if (ricaricaDopo) {
    carica();
  } else if (datiCache) {
    renderDati(datiCache);
  }
}

function trovaPeriodoInDati(dati, idPeriodo) {
  for (const spesa of dati?.spese || []) {
    for (const p of spesa.periodi || []) {
      if (p.idPeriodo === idPeriodo) return { spesa, periodo: p };
    }
  }
  return null;
}

/** Ricalcola parziali e importi delle quote di un periodo (in memoria). */
function ricalcolaQuoteInMemoria(quote, importoPeriodo) {
  for (const q of quote) {
    const peso = Number(q.peso);
    const perc = Number(q.percentuale);
    q.peso = Number.isFinite(peso) && peso >= 0 ? peso : 0;
    q.percentuale = Number.isFinite(perc) && perc >= 0 ? perc : 0;
    if (q.percentuale > 100) q.percentuale = 100;
    q.baseCalcolo = q.percentuale * q.peso;
  }

  const totale = quote.reduce((s, q) => s + q.baseCalcolo, 0);
  const importo = Number(importoPeriodo) || 0;
  if (totale <= 0) {
    const n = quote.length;
    const quota = n ? importo / n : 0;
    quote.forEach((q, i) => {
      q.importo =
        i === n - 1
          ? Math.round((importo - quota * (n - 1)) * 100) / 100
          : Math.round(quota * 100) / 100;
    });
  } else {
    let somma = 0;
    quote.forEach((q, i) => {
      if (i === quote.length - 1) {
        q.importo = Math.round((importo - somma) * 100) / 100;
      } else {
        q.importo = Math.round(((importo * q.baseCalcolo) / totale) * 100) / 100;
        somma += q.importo;
      }
    });
  }
}

/**
 * Applica peso/% a un’unità nei periodi selezionati (+ il periodo sorgente).
 * Poi aggiorna a schermo senza perdere il focus sull’input.
 */
function applicaValoreAiPeriodiSelezionati(idPeriodoSorgente, idUnita, campo, valore) {
  if (!bozzaDati) return;
  const ids = new Set(periodiSelezionati);
  ids.add(idPeriodoSorgente);

  for (const idP of ids) {
    const found = trovaPeriodoInDati(bozzaDati, idP);
    if (!found) continue;
    const { periodo: p } = found;
    let toccata = false;
    for (const q of p.quote || []) {
      if (Number(q.idUnita) !== Number(idUnita)) continue;
      q[campo] = valore;
      toccata = true;
    }
    if (toccata) {
      ricalcolaQuoteInMemoria(p.quote, p.importo);
      p.totaleQuote = (p.quote || []).reduce((s, q) => s + Number(q.importo || 0), 0);
    }
  }

  sincronizzaDomDopoEdit(idUnita, campo, valore, idPeriodoSorgente);
}

function sincronizzaDomDopoEdit(idUnita, campo, valore, idPeriodoFocus) {
  const idU = String(idUnita);
  for (const blocco of root.querySelectorAll(".periodo-blocco")) {
    const idP = Number(blocco.dataset.idPeriodo);
    if (!periodiSelezionati.has(idP) && idP !== idPeriodoFocus) continue;

    const found = trovaPeriodoInDati(bozzaDati, idP);
    if (!found) continue;
    const { periodo: p } = found;

    for (const tr of blocco.querySelectorAll("tbody tr")) {
      const idURow = Number(tr.dataset.idUnita);
      const q = (p.quote || []).find((x) => Number(x.idUnita) === idURow);
      if (!q) continue;

      if (String(idURow) === idU) {
        const inpPeso = tr.querySelector(".input-peso");
        const inpPerc = tr.querySelector(".input-perc");
        if (campo === "peso" && inpPeso && idP !== idPeriodoFocus) {
          inpPeso.value = String(valore);
        }
        if (campo === "percentuale" && inpPerc && idP !== idPeriodoFocus) {
          inpPerc.value = String(valore);
        }
      }

      const cellParz = tr.querySelector(".cell-parziale");
      const cellImp = tr.querySelector(".cell-importo");
      if (cellParz) cellParz.textContent = formatNum(q.baseCalcolo, 2);
      if (cellImp) cellImp.textContent = `€ ${formatEuro(q.importo)}`;
    }

    const footBox = blocco.querySelector(".tot-euro-box");
    if (footBox) {
      const visibili = (p.quote || []).filter(quotePassanoFiltri);
      const somma = visibili.reduce((s, q) => s + Number(q.importo || 0), 0);
      footBox.textContent = formatEuro(Math.round(somma * 100) / 100);
    }
  }
}

function selezionaPeriodoSeServe(idPeriodo, chk, blocco) {
  if (periodiSelezionati.has(idPeriodo)) return;
  periodiSelezionati.add(idPeriodo);
  if (chk) chk.checked = true;
  if (blocco) blocco.classList.add("is-selezionato");
}

async function salvaModificaMultipla() {
  mostraErrore($("#rip-error"), "");
  if (!bozzaDati) return;

  if (!periodiSelezionati.size) {
    mostraErrore($("#rip-error"), "Seleziona almeno un periodo da salvare.");
    return;
  }

  const n = periodiSelezionati.size;
  const ok = await chiediConferma(
    `Salvare le modifiche su ${n} period${n === 1 ? "o" : "i"} selezionat${n === 1 ? "o" : "i"}?`
  );
  if (!ok) return;

  const errori = [];
  let salvati = 0;

  for (const idP of periodiSelezionati) {
    const found = trovaPeriodoInDati(bozzaDati, idP);
    if (!found) {
      errori.push(`Periodo ${idP}: non trovato`);
      continue;
    }
    const { periodo: p } = found;
    const quote = p.quote || [];
    if (!quote.length) {
      errori.push(
        `${formatDataIt(p.periodoDa)}→${formatDataIt(p.periodoA)}: senza quote`
      );
      continue;
    }
    try {
      await aggiornaQuotePeriodo(p.idPeriodo, {
        quote: quote.map((q) => ({
          idRiparto: q.idRiparto,
          percentuale: Number(q.percentuale),
          peso: Number(q.peso),
        })),
        archivia: false,
        rendicontoDel: "",
      });
      salvati += 1;
    } catch (err) {
      errori.push(
        `${formatDataIt(p.periodoDa)}→${formatDataIt(p.periodoA)}: ${String(err)}`
      );
    }
  }

  if (errori.length) {
    mostraErrore(
      $("#rip-error"),
      `Salvati ${salvati}. Errori: ${errori.join("; ")}`
    );
  }

  modoModificaMultipla = false;
  bozzaDati = null;
  periodiSelezionati = new Set();
  aggiornaUiModificaMultipla();
  await carica();
}

async function salvaArchivia() {
  mostraErrore($("#rip-error"), "");
  if (!datiCache) return;

  if (!periodiSelezionati.size) {
    mostraErrore($("#rip-error"), "Seleziona almeno un periodo da archiviare.");
    return;
  }

  const rendicontoDel = ($("#rip-rendiconto-del")?.value || "").trim();
  if (!rendicontoDel) {
    mostraErrore(
      $("#rip-error"),
      "Indica «Rendiconto del» (es. 31/12/2025) prima di archiviare."
    );
    return;
  }

  const n = periodiSelezionati.size;
  const ok = await chiediConferma(
    `Archiviare ${n} period${n === 1 ? "o" : "i"} nel rendiconto «${rendicontoDel}»? ` +
      `Sparir${n === 1 ? "à" : "anno"} da questo elenco.`
  );
  if (!ok) return;

  const errori = [];
  let salvati = 0;

  for (const idP of periodiSelezionati) {
    const found = trovaPeriodoInDati(datiCache, idP);
    if (!found) {
      errori.push(`Periodo ${idP}: non trovato`);
      continue;
    }
    const { periodo: p } = found;
    const quote = p.quote || [];
    if (!quote.length) {
      errori.push(
        `${formatDataIt(p.periodoDa)}→${formatDataIt(p.periodoA)}: senza quote`
      );
      continue;
    }
    try {
      await aggiornaQuotePeriodo(p.idPeriodo, {
        quote: quote.map((q) => ({
          idRiparto: q.idRiparto,
          percentuale: Number(q.percentuale),
          peso: Number(q.peso),
        })),
        archivia: true,
        rendicontoDel,
      });
      salvati += 1;
    } catch (err) {
      errori.push(
        `${formatDataIt(p.periodoDa)}→${formatDataIt(p.periodoA)}: ${String(err)}`
      );
    }
  }

  if (errori.length) {
    mostraErrore(
      $("#rip-error"),
      `Archiviati ${salvati}. Errori: ${errori.join("; ")}`
    );
  }

  modoArchivia = false;
  periodiSelezionati = new Set();
  const inp = $("#rip-rendiconto-del");
  if (inp) inp.value = "";
  aggiornaUiModificaMultipla();
  await carica();
}

function renderDati(dati) {
  const corpo = $("#rip-corpo");
  const vuoto = $("#rip-vuoto");
  corpo.innerHTML = "";
  aggiornaBannerFiltro();

  if (!dati.spese?.length) {
    vuoto.hidden = false;
    vuoto.textContent = messaggioListaVuota();
    aggiornaTotaleHeader(0);
    return;
  }

  let gestioneCorrente = null;
  let mostrate = 0;
  let totaleVisualizzato = 0;

  for (const spesa of dati.spese) {
    if (
      filtroTipologia != null &&
      (spesa.gruppoSpesa || "").trim() !== filtroTipologia
    ) {
      continue;
    }

    const usaMillesimi = spesa.ripartizione === "Millesimi";

    const periodiVisibili = [];
    for (const p of spesa.periodi) {
      const quote = ordinaQuotePerIdentificativo(p.quote.filter(quotePassanoFiltri));
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

    const head = document.createElement("div");
    head.className = "spesa-head";
    head.innerHTML = `
      <div class="campo"><span class="lbl">IdSpe</span><span class="val" data-k="id"></span></div>
      <div class="campo"><span class="lbl">Genere</span><span class="val val-genere" data-k="gen"></span></div>
      <div class="campo"><span class="lbl">Ripartizione</span><span class="val" data-k="rip"></span></div>
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
    genEl.addEventListener("dblclick", () => {
      applicaFiltroTipologia(spesa.gruppoSpesa);
    });
    head.querySelector('[data-k="rip"]').textContent = spesa.ripartizione || "—";
    head.querySelector('[data-k="da"]').textContent = formatDataIt(spesa.spesaDa);
    head.querySelector('[data-k="a"]').textContent = formatDataIt(spesa.spesaA);
    head.querySelector('[data-k="gg"]').textContent = String(spesa.giorni);
    head.querySelector('[data-k="cifra"]').textContent = `€ ${formatEuro(spesa.cifra)}`;
    head.querySelector('[data-k="spese"]').textContent = `€ ${formatEuro(spesa.spesePagamento)}`;
    head.querySelector('[data-k="tot"]').textContent = `€ ${formatEuro(spesa.totale)}`;
    card.appendChild(head);

    let totaleQuoteSpesaFiltrato = 0;

    for (const { periodo: p, quote } of periodiVisibili) {
      const blocco = document.createElement("div");
      blocco.className =
        "periodo-blocco" +
        (inModoSelezionePeriodi() && periodiSelezionati.has(p.idPeriodo)
          ? " is-selezionato"
          : "");
      blocco.dataset.idPeriodo = String(p.idPeriodo);

      const pHead = document.createElement("div");
      pHead.className = "periodo-head";
      pHead.innerHTML = `
        <label class="periodo-check" title="Seleziona periodo">
          <input type="checkbox" class="chk-periodo" />
        </label>
        <div class="campo"><span class="lbl">Da</span><span class="val" data-k="da"></span></div>
        <div class="campo"><span class="lbl">A</span><span class="val" data-k="a"></span></div>
        <div class="campo"><span class="lbl">Giorni</span><span class="val" data-k="gg"></span></div>
        <span class="periodo-totale">Totale periodo conteggiato: € <span data-k="imp"></span></span>
        <button type="button" class="btn-vai-spesa">Vai alla spesa</button>
      `;
      pHead.querySelector('[data-k="da"]').textContent = formatDataIt(p.periodoDa);
      pHead.querySelector('[data-k="a"]').textContent = formatDataIt(p.periodoA);
      pHead.querySelector('[data-k="gg"]').textContent = String(p.giorni);
      pHead.querySelector('[data-k="imp"]').textContent = formatEuro(p.importo);

      const chk = pHead.querySelector(".chk-periodo");
      chk.checked = periodiSelezionati.has(p.idPeriodo);
      chk.addEventListener("change", () => {
        if (chk.checked) periodiSelezionati.add(p.idPeriodo);
        else periodiSelezionati.delete(p.idPeriodo);
        blocco.classList.toggle("is-selezionato", chk.checked);
      });

      pHead.querySelector(".btn-vai-spesa").addEventListener("click", () => {
        if (modoModificaMultipla) {
          mostraErrore(
            $("#rip-error"),
            "Esci dalla modifica multipla (Annulla o Salva) prima di aprire la spesa."
          );
          return;
        }
        if (modoArchivia) {
          mostraErrore(
            $("#rip-error"),
            "Esci dalla modalità Archivia (Annulla) prima di aprire la spesa."
          );
          return;
        }
        window.apriRipartoSpesa?.(spesa.idSpesa, "ripartizione");
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
            <th class="num">Importo</th>
          </tr>
        </thead>
        <tbody></tbody>
      `;
      const tbody = table.querySelector("tbody");
      let sommaQuote = 0;
      for (const q of quote) {
        const tr = document.createElement("tr");
        tr.dataset.idUnita = String(q.idUnita ?? "");
        tr.dataset.idRiparto = String(q.idRiparto ?? "");
        tr.dataset.idOccupante = String(q.idOccupante ?? "");
        tr.innerHTML = `
          <td class="col-id"></td>
          <td class="col-sub"></td>
          <td class="col-proprieta"></td>
          <td class="col-nome"></td>
          <td class="num cell-perc"></td>
          <td class="num cell-parti"></td>
          <td class="num cell-mill"></td>
          <td class="num cell-parziale"></td>
          <td class="num cell-importo"></td>
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

        if (modoModificaMultipla) {
          const inpPerc = document.createElement("input");
          inpPerc.type = "number";
          inpPerc.className = "input-quota input-perc";
          inpPerc.min = "0";
          inpPerc.max = "100";
          inpPerc.step = "any";
          inpPerc.value = String(q.percentuale);
          td[4].textContent = "";
          td[4].appendChild(inpPerc);

          const inpPeso = document.createElement("input");
          inpPeso.type = "number";
          inpPeso.className = "input-quota input-peso";
          inpPeso.min = "0";
          inpPeso.step = "any";
          inpPeso.value = String(q.peso);

          if (usaMillesimi) {
            td[5].textContent = "";
            td[6].textContent = "";
            td[6].appendChild(inpPeso);
          } else {
            td[5].textContent = "";
            td[5].appendChild(inpPeso);
            td[6].textContent = "";
          }

          const onEdit = (campo, el) => {
            const raw = Number(el.value);
            const valore =
              campo === "percentuale"
                ? Number.isFinite(raw)
                  ? Math.min(100, Math.max(0, raw))
                  : 0
                : Number.isFinite(raw) && raw >= 0
                  ? raw
                  : 0;
            el.value = String(valore);
            selezionaPeriodoSeServe(p.idPeriodo, chk, blocco);
            applicaValoreAiPeriodiSelezionati(p.idPeriodo, q.idUnita, campo, valore);
          };
          inpPerc.addEventListener("change", () => onEdit("percentuale", inpPerc));
          inpPeso.addEventListener("change", () => onEdit("peso", inpPeso));
        } else {
          td[4].textContent = formatNum(q.percentuale, 2);
          if (usaMillesimi) {
            td[5].textContent = "";
            td[6].textContent = formatNum(q.peso, 2);
          } else {
            td[5].textContent = formatNum(q.peso, 0);
            td[6].textContent = "";
          }
        }

        td[7].textContent = formatNum(q.baseCalcolo, 2);
        td[8].textContent = `€ ${formatEuro(q.importo)}`;
        sommaQuote += Number(q.importo) || 0;
        tbody.appendChild(tr);
      }
      blocco.appendChild(table);

      sommaQuote = Math.round(sommaQuote * 100) / 100;
      totaleQuoteSpesaFiltrato += sommaQuote;

      const foot = document.createElement("div");
      foot.className = "periodo-foot";
      foot.innerHTML = `
        <span>Totale quote: ${quote.length}</span>
        <span>Tot €</span>
        <span class="tot-euro-box"></span>
      `;
      foot.querySelector(".tot-euro-box").textContent = formatEuro(sommaQuote);
      blocco.appendChild(foot);

      card.appendChild(blocco);
    }

    const sFoot = document.createElement("div");
    sFoot.className = "spesa-foot";
    sFoot.innerHTML = `<span></span><span></span>`;
    const haFiltroQuote = filtroProprieta != null || filtroOccupante != null;
    if (haFiltroQuote) {
      const pezzi = [];
      if (filtroProprieta) pezzi.push(`«${filtroProprieta}»`);
      if (filtroOccupante) pezzi.push(`«${filtroOccupante}»`);
      const totFiltrato = Math.round(totaleQuoteSpesaFiltrato * 100) / 100;
      sFoot.children[0].textContent = `Totale ${pezzi.join(" / ")}`;
      sFoot.children[1].textContent = `€ ${formatEuro(totFiltrato)}`;
      totaleVisualizzato += totFiltrato;
    } else {
      sFoot.children[0].textContent = "Totale spesa";
      sFoot.children[1].textContent = `€ ${formatEuro(spesa.totale)}`;
      totaleVisualizzato += Number(spesa.totale) || 0;
    }
    card.appendChild(sFoot);

    corpo.appendChild(card);
    mostrate += 1;
  }

  if (!mostrate) {
    vuoto.hidden = false;
    vuoto.textContent = haFiltroAttivo()
      ? `Nessuna ripartizione per ${etichettaFiltriAttivi()}.`
      : messaggioListaVuota();
    aggiornaTotaleHeader(0);
    return;
  }
  vuoto.hidden = true;
  aggiornaTotaleHeader(totaleVisualizzato);
}

async function carica() {
  // Un nuovo caricamento dal server chiude le modalità speciali.
  if (modoModificaMultipla || modoArchivia) {
    modoModificaMultipla = false;
    modoArchivia = false;
    bozzaDati = null;
    periodiSelezionati = new Set();
    const inp = $("#rip-rendiconto-del");
    if (inp) inp.value = "";
    aggiornaUiModificaMultipla();
  }

  mostraErrore($("#rip-error"), "");
  const da = ($("#rip-da").value || "").trim();
  const a = ($("#rip-a").value || "").trim();

  if ((da && !a) || (!da && a)) {
    mostraErrore($("#rip-error"), "Per filtrare indica entrambe le date Da e A.");
    return;
  }
  if (da && a && a < da) {
    mostraErrore($("#rip-error"), "La data «A» non può essere prima della data «Da».");
    return;
  }

  $("#rip-corpo").innerHTML = `<p class="muted">Caricamento…</p>`;
  $("#rip-vuoto").hidden = true;
  const boxTot = $("#rip-totale-head");
  if (boxTot) boxTot.hidden = true;
  aggiornaPulsanteTogliDate();

  try {
    datiCache = await reportRipartizioneSpeseConteggiate(da, a);
    renderDati(datiCache);
  } catch (err) {
    datiCache = null;
    $("#rip-corpo").innerHTML = "";
    aggiornaTotaleHeader(0);
    mostraErrore($("#rip-error"), String(err));
  }
}

function togliFiltroDate() {
  $("#rip-da").value = "";
  $("#rip-a").value = "";
  aggiornaPulsanteTogliDate();
  carica();
}

/* ——— Stampa PDF: spese+periodi (filtro attuale) + riepilogo proprietà ——— */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function raggruppaPerProprieta(listaUnita) {
  const map = new Map();
  for (const u of listaUnita) {
    const key = (u.proprieta || "(senza proprietà)").trim() || "(senza proprietà)";
    if (!map.has(key)) {
      map.set(key, {
        proprieta: key,
        totale: 0,
        gestioniMap: new Map(),
        unitaIds: [],
      });
    }
    const g = map.get(key);
    g.totale += Number(u.totale) || 0;
    g.unitaIds.push(u.idUnita);
    for (const gest of u.gestioni || []) {
      const prev = g.gestioniMap.get(gest.gestione) || 0;
      g.gestioniMap.set(gest.gestione, prev + (Number(gest.totale) || 0));
    }
  }
  return [...map.values()]
    .map((g) => ({
      proprieta: g.proprieta,
      totale: arrotondaEuro(g.totale),
      nUnita: g.unitaIds.length,
      gestioni: [...g.gestioniMap.entries()]
        .map(([gestione, totale]) => ({
          gestione,
          totale: arrotondaEuro(totale),
        }))
        .sort((a, b) => a.gestione.localeCompare(b.gestione, "it")),
    }))
    .sort((a, b) => a.proprieta.localeCompare(b.proprieta, "it"));
}

function costruisciSezioneSpesePeriodi(contenitore, dati) {
  contenitore.appendChild(el("h2", "rip-stampa-sez", "Spese e periodi"));

  const spese = dati?.spese || [];
  if (!spese.length) {
    contenitore.appendChild(
      el("p", "rip-stampa-vuoto", "Nessuna spesa con periodi da stampare.")
    );
    return 0;
  }

  let gestioneCorrente = null;
  let totaleVisualizzato = 0;
  let mostrate = 0;

  for (const spesa of spese) {
    if (
      filtroTipologia != null &&
      (spesa.gruppoSpesa || "").trim() !== filtroTipologia
    ) {
      continue;
    }

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
      `${formatDataIt(spesa.spesaDa)}–${formatDataIt(spesa.spesaA)}`,
      `${spesa.giorni} gg`,
      `€ ${formatEuro(spesa.totale)}`,
    ]
      .filter(Boolean)
      .join(" · ");
    card.appendChild(head);

    let totaleQuoteSpesaFiltrato = 0;

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
            <th class="num">Importo</th>
          </tr>
        </thead>
        <tbody></tbody>
      `;
      const tbody = table.querySelector("tbody");
      let sommaQuote = 0;
      for (const q of quote) {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td></td><td></td><td></td><td></td>
          <td class="num"></td><td class="num"></td>
          <td class="num"></td><td class="num"></td>
        `;
        const td = tr.children;
        td[0].textContent = (q.identificativo || "").trim() || "—";
        td[1].textContent = (q.subalterno || "").trim() || "—";
        td[2].textContent = nomeProprieta(q) || "—";
        td[3].textContent = nomeOccupante(q) || "—";
        td[4].textContent = formatNum(q.percentuale, 2);
        td[5].textContent = usaMillesimi
          ? formatNum(q.peso, 2)
          : formatNum(q.peso, 0);
        td[6].textContent = formatNum(q.baseCalcolo, 2);
        td[7].textContent = `€ ${formatEuro(q.importo)}`;
        sommaQuote += Number(q.importo) || 0;
        tbody.appendChild(tr);
      }
      blocco.appendChild(table);
      sommaQuote = arrotondaEuro(sommaQuote);
      totaleQuoteSpesaFiltrato += sommaQuote;
      card.appendChild(blocco);
    }

    if (haFiltroAttivo() && (filtroProprieta != null || filtroOccupante != null)) {
      totaleVisualizzato += arrotondaEuro(totaleQuoteSpesaFiltrato);
    } else {
      totaleVisualizzato += Number(spesa.totale) || 0;
    }

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

  return arrotondaEuro(totaleVisualizzato);
}

function costruisciSezioneProprieta(contenitore, listaUnita) {
  contenitore.appendChild(
    el("h2", "rip-stampa-sez rip-stampa-sez-fine", "Riepilogo per proprietà")
  );

  const gruppi = raggruppaPerProprieta(listaUnita || []);
  if (!gruppi.length) {
    contenitore.appendChild(
      el("p", "rip-stampa-vuoto", "Nessun totale per proprietà.")
    );
    return;
  }

  const table = document.createElement("table");
  table.className = "rip-stampa-prop-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th>Proprietà</th>
        <th class="num">Unità</th>
        <th>Gestioni</th>
        <th class="num">Totale</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = table.querySelector("tbody");
  for (const g of gruppi) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td></td><td class="num"></td><td></td><td class="num"></td>`;
    tr.children[0].textContent = g.proprieta;
    tr.children[1].textContent = String(g.nUnita);
    tr.children[2].textContent = g.gestioni
      .map((x) => `${x.gestione}: € ${formatEuro(x.totale)}`)
      .join(" · ");
    tr.children[3].textContent = `€ ${formatEuro(g.totale)}`;
    tbody.appendChild(tr);
  }
  contenitore.appendChild(table);

  const tot = arrotondaEuro(
    gruppi.reduce((acc, g) => acc + (Number(g.totale) || 0), 0)
  );
  const foot = el("div", "rip-stampa-prop-tot");
  foot.innerHTML = `<span>Totale generale</span><strong></strong>`;
  foot.querySelector("strong").textContent = `€ ${formatEuro(tot)}`;
  contenitore.appendChild(foot);
}

async function costruisciDocumentoStampa() {
  const box = $("#rip-stampa");
  if (!box) return;

  box.innerHTML = "";
  box.hidden = false;

  const condo =
    document.querySelector("#nome-condominio")?.textContent?.trim() ||
    "Condominio";
  const dataOra = new Date().toLocaleString("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const da = ($("#rip-da")?.value || "").trim();
  const a = ($("#rip-a")?.value || "").trim();

  const intest = el("div", "rip-stampa-intestazione");
  intest.innerHTML = `<strong></strong><span></span>`;
  intest.querySelector("strong").textContent = condo;
  let meta = `Ripartizione spese · ${dataOra}`;
  if (da && a) meta += ` · Da ${formatDataIt(da)} a ${formatDataIt(a)}`;
  if (haFiltroAttivo()) meta += ` · ${etichettaFiltriAttivi()}`;
  intest.querySelector("span").textContent = meta;
  box.appendChild(intest);

  const titolo = el("h1", "rip-stampa-titolo", "Ripartizione spese conteggiate");
  box.appendChild(titolo);

  const totSpese = costruisciSezioneSpesePeriodi(box, datiCache || { spese: [] });

  const totBox = el("div", "rip-stampa-totale-gen");
  totBox.innerHTML = `<span>Totale visualizzato</span><strong></strong>`;
  totBox.querySelector("strong").textContent = `€ ${formatEuro(totSpese)}`;
  titolo.after(totBox);

  let riepilogo;
  try {
    riepilogo = await reportRiepilogoRipartizione();
  } catch (err) {
    box.appendChild(
      el(
        "p",
        "rip-stampa-vuoto",
        `Impossibile caricare il riepilogo proprietà: ${String(err)}`
      )
    );
    riepilogo = { unita: [] };
  }
  costruisciSezioneProprieta(box, riepilogo.unita || []);
}

async function stampaRipartizione() {
  const btn = $("#btn-stampa-rip");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Preparazione…";
  }

  try {
    await costruisciDocumentoStampa();
    const titoloPrima = document.title;
    const condo =
      document.querySelector("#nome-condominio")?.textContent?.trim() ||
      "Condominio";
    document.title = `Ripartizione spese — ${condo}`;

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
  bozzaDati = null;
  modoModificaMultipla = false;
  modoArchivia = false;
  periodiSelezionati = new Set();
  filtroTipologia = null;
  filtroProprieta = null;
  filtroOccupante = null;
  aggiornaBannerFiltro();
  aggiornaUiModificaMultipla();

  const daEl = $("#rip-da");
  const aEl = $("#rip-a");
  daEl.value = "";
  aEl.value = "";
  aggiornaPulsanteTogliDate();

  $("#btn-filtra-date")?.addEventListener("click", () => carica());
  $("#btn-togli-date")?.addEventListener("click", () => togliFiltroDate());
  $("#btn-togli-filtro-tipologia")?.addEventListener("click", () => {
    togliFiltroTipologia();
  });
  $("#btn-togli-filtro-proprieta")?.addEventListener("click", () => {
    togliFiltroProprieta();
  });
  $("#btn-togli-filtro-occupante")?.addEventListener("click", () => {
    togliFiltroOccupante();
  });
  $("#btn-modifica-multipla")?.addEventListener("click", () => {
    entraModificaMultipla();
  });
  $("#btn-salva-multipla")?.addEventListener("click", () => {
    salvaModificaMultipla();
  });
  $("#btn-annulla-multipla")?.addEventListener("click", async () => {
    const ok = await chiediConferma(
      "Annullare la modifica multipla? Le modifiche non salvate andranno perse."
    );
    if (!ok) return;
    esciModificaMultipla(false);
  });
  $("#btn-archivia")?.addEventListener("click", () => {
    entraArchivia();
  });
  $("#btn-salva-archivia")?.addEventListener("click", () => {
    salvaArchivia();
  });
  $("#btn-annulla-archivia")?.addEventListener("click", async () => {
    const ok = await chiediConferma("Annullare l’archiviazione?");
    if (!ok) return;
    esciArchivia(false);
  });
  $("#btn-stampa-rip")?.addEventListener("click", () => {
    stampaRipartizione();
  });
  await carica();
}

export function onLeave() {
  root = null;
  datiCache = null;
  bozzaDati = null;
  modoModificaMultipla = false;
  modoArchivia = false;
  periodiSelezionati = new Set();
  filtroTipologia = null;
  filtroProprieta = null;
  filtroOccupante = null;
}
