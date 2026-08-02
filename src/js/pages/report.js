import { reportSpeseConteggiate } from "../api.js";

let root = null;
/** Ultimi dati dal server (prima dei filtri). */
let datiCache = null;
/** Nome gestione selezionata, oppure null = tutte. */
let filtroGestione = null;
/** Nome tipologia (gruppoSpesa) selezionata, oppure null = tutte. */
let filtroTipologia = null;

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

function formatDataIt(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function haFiltroAttivo() {
  return filtroGestione != null || filtroTipologia != null;
}

function etichettaFiltriAttivi() {
  const pezzi = [];
  if (filtroGestione) pezzi.push(`gestione «${filtroGestione}»`);
  if (filtroTipologia) pezzi.push(`tipologia «${filtroTipologia}»`);
  return pezzi.join(" e ");
}

function aggiornaBannerFiltro() {
  const riga = $("#filtri-riga");

  const chipGest = $("#filtro-gestione");
  const nomeGest = $("#filtro-gestione-nome");
  if (chipGest && nomeGest) {
    if (!filtroGestione) {
      chipGest.hidden = true;
      nomeGest.textContent = "";
    } else {
      chipGest.hidden = false;
      nomeGest.textContent = filtroGestione;
    }
  }

  const chipTip = $("#filtro-tipologia");
  const nomeTip = $("#filtro-tipologia-nome");
  if (chipTip && nomeTip) {
    if (!filtroTipologia) {
      chipTip.hidden = true;
      nomeTip.textContent = "";
    } else {
      chipTip.hidden = false;
      nomeTip.textContent = filtroTipologia;
    }
  }

  if (riga) {
    riga.hidden = !haFiltroAttivo();
  }
}

function applicaFiltroGestione(nome) {
  const pulito = (nome || "").trim();
  if (!pulito) return;
  if (filtroGestione === pulito) return;
  filtroGestione = pulito;
  if (datiCache) renderReport(datiCache);
}

function applicaFiltroTipologia(nome) {
  const pulito = (nome || "").trim();
  if (!pulito) return;
  if (filtroTipologia === pulito) return;
  filtroTipologia = pulito;
  if (datiCache) renderReport(datiCache);
}

function togliFiltroGestione() {
  if (!filtroGestione) return;
  filtroGestione = null;
  if (datiCache) renderReport(datiCache);
}

function togliFiltroTipologia() {
  if (!filtroTipologia) return;
  filtroTipologia = null;
  if (datiCache) renderReport(datiCache);
}

/**
 * Applica i filtri gestione/tipologia e ricalcola i totali dei gruppi visibili.
 */
function datiFiltrati(dati) {
  if (!haFiltroAttivo()) return dati;

  const gruppi = [];
  for (const g of dati.gruppi || []) {
    if (
      filtroGestione != null &&
      (g.gestione || "").trim() !== filtroGestione
    ) {
      continue;
    }

    let tipologie = g.tipologie || [];
    if (filtroTipologia != null) {
      tipologie = tipologie.filter(
        (t) => (t.gruppoSpesa || "").trim() === filtroTipologia
      );
    }
    if (!tipologie.length) continue;

    const tipologieConTotale = tipologie.map((t) => ({
      ...t,
      totale: (t.spese || []).reduce((s, x) => s + (Number(x.totale) || 0), 0),
    }));
    const totaleGestione = tipologieConTotale.reduce(
      (s, t) => s + (Number(t.totale) || 0),
      0
    );
    gruppi.push({
      ...g,
      tipologie: tipologieConTotale,
      totale: totaleGestione,
    });
  }

  const totaleGenerale = gruppi.reduce((s, g) => s + (Number(g.totale) || 0), 0);
  return { totaleGenerale, gruppi };
}

function renderReport(datiSorgente) {
  const dati = datiFiltrati(datiSorgente);
  const corpo = $("#report-corpo");
  const vuoto = $("#report-vuoto");
  const colonne = $("#report-colonne");
  const totaleEl = $("#totale-generale");

  corpo.innerHTML = "";
  aggiornaBannerFiltro();
  totaleEl.textContent = `€ ${formatEuro(dati.totaleGenerale)}`;

  if (!dati.gruppi?.length) {
    vuoto.hidden = false;
    vuoto.textContent = haFiltroAttivo()
      ? `Nessuna spesa per ${etichettaFiltriAttivi()}.`
      : "Nessuna spesa con periodi attivi da mostrare.";
    colonne.hidden = true;
    return;
  }

  vuoto.hidden = true;
  colonne.hidden = false;

  for (const gruppo of dati.gruppi) {
    const sezione = document.createElement("section");
    sezione.className = "gruppo-gestione";

    const titoloGestione = document.createElement("h3");
    titoloGestione.className = "gruppo-gestione-titolo";
    titoloGestione.textContent = gruppo.gestione;
    titoloGestione.title = "Doppio clic: mostra solo questa gestione";
    titoloGestione.addEventListener("dblclick", () => {
      applicaFiltroGestione(gruppo.gestione);
    });
    sezione.appendChild(titoloGestione);

    for (const tip of gruppo.tipologie || []) {
      const bloccoTip = document.createElement("div");
      bloccoTip.className = "gruppo-tipologia";

      const titoloTip = document.createElement("h4");
      titoloTip.className = "gruppo-tipologia-titolo";
      titoloTip.textContent = tip.gruppoSpesa;
      titoloTip.title = "Doppio clic: mostra solo questa tipologia";
      titoloTip.addEventListener("dblclick", () => {
        applicaFiltroTipologia(tip.gruppoSpesa);
      });
      bloccoTip.appendChild(titoloTip);

      for (const spesa of tip.spese) {
        const blocco = document.createElement("article");
        blocco.className = "spesa-blocco";

        const riga = document.createElement("div");
        riga.className = "spesa-riga";
        riga.innerHTML = `
          <span></span>
          <span></span>
          <span></span>
          <span></span>
          <span class="num"></span>
          <span class="spesa-importo">
            <span class="importo-val"></span>
            <span class="suddivisa">Suddivisa come segue</span>
            <span class="gia-conteggiati" hidden></span>
          </span>
        `;
        const celle = riga.children;
        celle[0].textContent = String(spesa.idSpesa);
        celle[1].textContent = formatDataIt(spesa.dataEmissione);
        celle[2].textContent = formatDataIt(spesa.spesaDa);
        celle[3].textContent = formatDataIt(spesa.spesaA);
        celle[4].textContent = String(spesa.giorni);
        riga.querySelector(".importo-val").textContent = `€ ${formatEuro(spesa.totale)}`;
        const giaEl = riga.querySelector(".gia-conteggiati");
        const gia = Number(spesa.totaleGiaConteggiato) || 0;
        if (gia > 0.00001) {
          giaEl.hidden = false;
          giaEl.textContent = `(di cui Euro ${formatEuro(gia)} già conteggiati precedentemente)`;
        }
        blocco.appendChild(riga);

        if (spesa.noteSpesa || spesa.descrizione) {
          const note = document.createElement("p");
          note.className = "spesa-note";
          const testo = [spesa.descrizione, spesa.noteSpesa]
            .filter(Boolean)
            .join(" — ");
          note.innerHTML = "<strong>Note</strong>";
          note.appendChild(document.createTextNode(testo));
          blocco.appendChild(note);
        }

        for (const p of spesa.periodi) {
          const pr = document.createElement("div");
          pr.className = "periodo-riga";
          pr.innerHTML = `
            <span></span>
            <span></span>
            <span></span>
            <span></span>
            <span class="num"></span>
            <span class="num"></span>
            <span class="badge-periodo"></span>
            <button type="button" class="btn-quota" disabled title="Disponibile in seguito">Quota</button>
          `;
          const pc = pr.children;
          pc[2].textContent = formatDataIt(p.periodoDa);
          pc[3].textContent = formatDataIt(p.periodoA);
          pc[4].textContent = String(p.giorni);
          pc[5].textContent = `€ ${formatEuro(p.importo)}`;
          const badge = pr.querySelector(".badge-periodo");
          badge.textContent = p.stato;
          if (p.archivia) badge.classList.add("is-archiviato");
          blocco.appendChild(pr);
        }

        const sub = document.createElement("div");
        sub.className = "spesa-subtotale";
        sub.innerHTML = `
          <span>${spesa.giorniPeriodi} gg</span>
          <span>€ ${formatEuro(spesa.totalePeriodi)}</span>
        `;
        blocco.appendChild(sub);

        bloccoTip.appendChild(blocco);
      }

      const totTip = document.createElement("div");
      totTip.className = "gruppo-totale gruppo-totale-tipologia";
      totTip.innerHTML = `
        <span>Totale spesa per</span>
        <span class="gruppo-totale-nome"></span>
        <span class="gruppo-totale-importo"></span>
      `;
      totTip.querySelector(".gruppo-totale-nome").textContent = tip.gruppoSpesa;
      totTip.querySelector(".gruppo-totale-importo").textContent =
        `€ ${formatEuro(tip.totale)}`;
      bloccoTip.appendChild(totTip);

      sezione.appendChild(bloccoTip);
    }

    const totGest = document.createElement("div");
    totGest.className = "gruppo-totale gruppo-totale-gestione";
    totGest.innerHTML = `
      <span>Totale gestione</span>
      <span class="gruppo-totale-nome"></span>
      <span class="gruppo-totale-importo"></span>
    `;
    totGest.querySelector(".gruppo-totale-nome").textContent = gruppo.gestione;
    totGest.querySelector(".gruppo-totale-importo").textContent =
      `€ ${formatEuro(gruppo.totale)}`;
    sezione.appendChild(totGest);

    corpo.appendChild(sezione);
  }
}

async function caricaElenco() {
  mostraErrore($("#report-error"), "");
  $("#report-corpo").innerHTML = `<p class="muted">Caricamento…</p>`;
  $("#report-colonne").hidden = true;
  $("#report-vuoto").hidden = true;

  try {
    datiCache = await reportSpeseConteggiate();
    renderReport(datiCache);
  } catch (err) {
    datiCache = null;
    $("#report-corpo").innerHTML = "";
    mostraErrore($("#report-error"), String(err));
  }
}

/** Apre la finestra di stampa (da lì puoi salvare in PDF A4). */
function stampaElenco() {
  const condo =
    document.querySelector("#nome-condominio")?.textContent?.trim() ||
    "Condominio";
  const elCondo = $("#report-stampa-condo");
  const elData = $("#report-stampa-data");
  if (elCondo) elCondo.textContent = condo;
  if (elData) {
    let testo = `Stampato il ${new Date().toLocaleString("it-IT", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })}`;
    if (filtroGestione) testo += ` · Gestione «${filtroGestione}»`;
    if (filtroTipologia) testo += ` · Tipologia «${filtroTipologia}»`;
    elData.textContent = testo;
  }

  const titoloPrima = document.title;
  document.title = `Elenco spese conteggiate — ${condo}`;
  window.print();
  document.title = titoloPrima;
}

export async function onEnter(pageRoot) {
  root = pageRoot;
  datiCache = null;
  filtroGestione = null;
  filtroTipologia = null;
  aggiornaBannerFiltro();
  $("#btn-stampa-report")?.addEventListener("click", () => {
    stampaElenco();
  });
  $("#btn-togli-filtro-gestione")?.addEventListener("click", () => {
    togliFiltroGestione();
  });
  $("#btn-togli-filtro-tipologia")?.addEventListener("click", () => {
    togliFiltroTipologia();
  });
  await caricaElenco();
}

export function onLeave() {
  root = null;
  datiCache = null;
  filtroGestione = null;
  filtroTipologia = null;
}
