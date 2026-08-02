import {
  reportRendicontiArchiviatiOpzioni,
  reportSpeseArchiviatePerRendiconto,
} from "../api.js";

let root = null;
/** Valore «Rendiconto del» attualmente selezionato. */
let rendicontoSelezionato = "";

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
  }
}

function renderReport(dati) {
  const corpo = $("#archivio-corpo");
  const vuoto = $("#archivio-vuoto");
  const colonne = $("#archivio-colonne");
  const totaleEl = $("#totale-generale");

  corpo.innerHTML = "";
  totaleEl.textContent = `€ ${formatEuro(dati.totaleGenerale || 0)}`;

  if (!dati.gruppi?.length) {
    vuoto.hidden = false;
    vuoto.textContent = rendicontoSelezionato
      ? `Nessuna spesa archiviata per il rendiconto «${rendicontoSelezionato}».`
      : "Seleziona un rendiconto nell’elenco in alto per vedere i dati.";
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
    sezione.appendChild(titoloGestione);

    for (const tip of gruppo.tipologie || []) {
      const bloccoTip = document.createElement("div");
      bloccoTip.className = "gruppo-tipologia";

      const titoloTip = document.createElement("h4");
      titoloTip.className = "gruppo-tipologia-titolo";
      titoloTip.textContent = tip.gruppoSpesa;
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
          </span>
        `;
        const celle = riga.children;
        celle[0].textContent = String(spesa.idSpesa);
        celle[1].textContent = formatDataIt(spesa.dataEmissione);
        celle[2].textContent = formatDataIt(spesa.spesaDa);
        celle[3].textContent = formatDataIt(spesa.spesaA);
        celle[4].textContent = String(spesa.giorni);
        riga.querySelector(".importo-val").textContent = `€ ${formatEuro(spesa.totale)}`;
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
            <span class="badge-periodo is-archiviato"></span>
          `;
          const pc = pr.children;
          pc[2].textContent = formatDataIt(p.periodoDa);
          pc[3].textContent = formatDataIt(p.periodoA);
          pc[4].textContent = String(p.giorni);
          pc[5].textContent = `€ ${formatEuro(p.importo)}`;
          pr.querySelector(".badge-periodo").textContent = p.stato || "ARCHIVIATO";
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
  mostraErrore($("#archivio-error"), "");
  const corpo = $("#archivio-corpo");
  const vuoto = $("#archivio-vuoto");
  const colonne = $("#archivio-colonne");
  const totaleEl = $("#totale-generale");
  aggiornaPulsanteRipartizione();

  if (!rendicontoSelezionato) {
    corpo.innerHTML = "";
    colonne.hidden = true;
    totaleEl.textContent = "€ 0,00";
    vuoto.hidden = false;
    vuoto.textContent =
      "Seleziona un rendiconto nell’elenco in alto per vedere i dati.";
    return;
  }

  corpo.innerHTML = `<p class="muted">Caricamento…</p>`;
  colonne.hidden = true;
  vuoto.hidden = true;

  try {
    const dati = await reportSpeseArchiviatePerRendiconto(rendicontoSelezionato);
    renderReport(dati);
  } catch (err) {
    corpo.innerHTML = "";
    totaleEl.textContent = "€ 0,00";
    mostraErrore($("#archivio-error"), String(err));
  }
}

function aggiornaPulsanteRipartizione() {
  const btn = $("#btn-ripartizione-archivio");
  if (btn) btn.disabled = !rendicontoSelezionato;
}

function apriRipartizioneArchivio() {
  if (!rendicontoSelezionato) {
    mostraErrore(
      $("#archivio-error"),
      "Seleziona prima un rendiconto."
    );
    return;
  }
  mostraErrore($("#archivio-error"), "");
  const key =
    window.STORAGE_ARCHIVIO_RENDICONTO || "gestione.archivioRendicontoDel";
  sessionStorage.setItem(key, rendicontoSelezionato);
  window.mostraPaginaApp?.("archivio-ripartizione");
}

function stampaElenco() {
  if (!rendicontoSelezionato) {
    mostraErrore(
      $("#archivio-error"),
      "Seleziona prima un rendiconto da stampare."
    );
    return;
  }
  mostraErrore($("#archivio-error"), "");

  const condo =
    document.querySelector("#nome-condominio")?.textContent?.trim() ||
    "Condominio";
  const elCondo = $("#archivio-stampa-condo");
  const elData = $("#archivio-stampa-data");
  if (elCondo) elCondo.textContent = condo;
  if (elData) {
    elData.textContent = `Rendiconto del ${rendicontoSelezionato} · Stampato il ${new Date().toLocaleString(
      "it-IT",
      {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }
    )}`;
  }

  const titoloPrima = document.title;
  document.title = `Archivio rendiconto ${rendicontoSelezionato} — ${condo}`;
  window.print();
  document.title = titoloPrima;
}

export async function onEnter(pageRoot) {
  root = pageRoot;

  const key =
    window.STORAGE_ARCHIVIO_RENDICONTO || "gestione.archivioRendicontoDel";
  rendicontoSelezionato = (sessionStorage.getItem(key) || "").trim();

  $("#filtro-rendiconto")?.addEventListener("change", async () => {
    rendicontoSelezionato = ($("#filtro-rendiconto").value || "").trim();
    if (rendicontoSelezionato) {
      sessionStorage.setItem(key, rendicontoSelezionato);
    } else {
      sessionStorage.removeItem(key);
    }
    await caricaElenco();
  });
  $("#btn-stampa-archivio")?.addEventListener("click", () => {
    stampaElenco();
  });
  $("#btn-ripartizione-archivio")?.addEventListener("click", () => {
    apriRipartizioneArchivio();
  });

  try {
    await popolaSelectRendiconti();
    await caricaElenco();
  } catch (err) {
    mostraErrore($("#archivio-error"), String(err));
  }
}

export function onLeave() {
  root = null;
}
