import {
  aggiornaRataCondominiale,
  creaRataCondominiale,
  eliminaRataCondominiale,
  elencoOccupantiCorrenti,
  elencoOccupanti,
  elencoRateOccupante,
  reportRendicontiArchiviatiOpzioni,
} from "../api.js";
import { chiediConferma } from "../conferma.js";

const STORAGE_RATE_OCCUPANTE = "gestione.rateOccupanteId";
const STORAGE_RIEPILOGO_REND = "gestione.riepilogoRendicontoOccupante";

let root = null;
let idOccupante = null;
let occupante = null;
let inModificaId = null;
let rendicontiOpzioni = [];

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

async function caricaOccupante() {
  // Prima tra i correnti, poi tra tutti (se non più “corrente”).
  let lista = await elencoOccupantiCorrenti();
  let trovato = lista.find((o) => o.idOccupante === idOccupante);
  if (!trovato) {
    lista = await elencoOccupanti();
    trovato = lista.find((o) => o.idOccupante === idOccupante);
  }
  return trovato || null;
}

function popolaSelectRendiconto(selezionato = "") {
  const sel = $("#rendiconto");
  if (!sel) return;
  sel.innerHTML = `<option value="">— nessuno —</option>`;
  for (const v of rendicontiOpzioni) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    sel.appendChild(opt);
  }
  // Se il valore salvato non è più tra le opzioni, lo aggiunge comunque.
  const scelto = (selezionato || "").trim();
  if (scelto && !rendicontiOpzioni.includes(scelto)) {
    const opt = document.createElement("option");
    opt.value = scelto;
    opt.textContent = `${scelto} (non più in archivio)`;
    sel.appendChild(opt);
  }
  sel.value = scelto;
}

function popolaSelectRiepilogo() {
  const sel = $("#rendiconto-riepilogo");
  if (!sel) return;
  const precedente = sel.value;
  sel.innerHTML = `<option value="">— rendiconto attivo —</option>`;
  for (const v of rendicontiOpzioni) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    sel.appendChild(opt);
  }
  if (precedente && rendicontiOpzioni.includes(precedente)) {
    sel.value = precedente;
  }
}

function apriRiepilogo() {
  mostraErrore($("#pagina-error"), "");
  // Vuoto = rendiconto attivo + rate senza rendiconto.
  const rendiconto = ($("#rendiconto-riepilogo")?.value || "").trim();
  sessionStorage.setItem(STORAGE_RATE_OCCUPANTE, String(idOccupante));
  sessionStorage.setItem(STORAGE_RIEPILOGO_REND, rendiconto);
  window.mostraPaginaApp?.("riepilogo-rendiconto-occupante");
}

function apriForm(rata = null) {
  const pannello = $("#pannello-form");
  const titolo = $("#titolo-form");
  mostraErrore($("#form-error"), "");

  if (rata) {
    inModificaId = rata.idRata;
    titolo.textContent = `Modifica rata #${rata.idRata}`;
    $("#id-rata").value = String(rata.idRata);
    $("#rata-da").value = rata.rataDa;
    $("#rata-a").value = rata.rataA;
    $("#versato").value = String(rata.versato);
    $("#note-rata").value = rata.noteRata || "";
    popolaSelectRendiconto(rata.rendiconto || "");
  } else {
    inModificaId = null;
    titolo.textContent = "Nuova rata";
    $("#form-rata").reset();
    $("#id-rata").value = "";
    $("#versato").value = "0";
    popolaSelectRendiconto("");
  }

  pannello.hidden = false;
  $("#rata-da").focus();
}

function chiudiForm() {
  $("#pannello-form").hidden = true;
  inModificaId = null;
  $("#form-rata").reset();
  mostraErrore($("#form-error"), "");
}

function leggiForm() {
  return {
    idOccupante,
    rataDa: $("#rata-da").value,
    rataA: $("#rata-a").value,
    versato: Number($("#versato").value || 0),
    noteRata: $("#note-rata").value,
    rendiconto: $("#rendiconto").value || "",
  };
}

async function ricaricaLista() {
  mostraErrore($("#pagina-error"), "");
  const corpo = $("#corpo-rate");
  const vuote = $("#rate-vuote");
  const wrap = $("#tabella-wrap");
  corpo.innerHTML = "";

  try {
    const lista = await elencoRateOccupante(idOccupante);
    if (!lista.length) {
      vuote.hidden = false;
      wrap.hidden = true;
      return;
    }
    vuote.hidden = true;
    wrap.hidden = false;

    for (const r of lista) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td></td>
        <td></td>
        <td></td>
        <td class="num"></td>
        <td></td>
        <td></td>
        <td class="azioni">
          <button type="button" class="btn-icon btn-modifica" title="Modifica" aria-label="Modifica">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 17.5V20h2.5L18.1 8.4l-2.5-2.5L4 17.5Zm14.7-10.2c.4-.4.4-1 0-1.4l-1.6-1.6a1 1 0 0 0-1.4 0l-1.3 1.3 2.5 2.5 1.8-1.8Z"/>
            </svg>
          </button>
          <button type="button" class="btn-icon btn-elimina" title="Elimina" aria-label="Elimina">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6.7 5.3 12 10.6l5.3-5.3 1.4 1.4L13.4 12l5.3 5.3-1.4 1.4L12 13.4l-5.3 5.3-1.4-1.4L10.6 12 5.3 6.7l1.4-1.4Z"/>
            </svg>
          </button>
        </td>
      `;
      const td = tr.children;
      td[0].textContent = String(r.idRata);
      td[1].textContent = formatDataIt(r.rataDa);
      td[2].textContent = formatDataIt(r.rataA);
      td[3].textContent = formatEuro(r.versato);
      td[4].textContent = (r.rendiconto || "").trim() || "—";
      td[5].textContent = (r.noteRata || "").trim() || "—";
      tr.querySelector(".btn-modifica").addEventListener("click", () => apriForm(r));
      tr.querySelector(".btn-elimina").addEventListener("click", async () => {
        const ok = await chiediConferma(
          `Eliminare la rata ${formatDataIt(r.rataDa)} → ${formatDataIt(r.rataA)}?`
        );
        if (!ok) return;
        try {
          await eliminaRataCondominiale(r.idRata);
          if (inModificaId === r.idRata) chiudiForm();
          await ricaricaLista();
        } catch (err) {
          mostraErrore($("#pagina-error"), String(err));
        }
      });
      corpo.appendChild(tr);
    }
  } catch (err) {
    wrap.hidden = true;
    vuote.hidden = true;
    mostraErrore($("#pagina-error"), String(err));
  }
}

export async function onEnter(pageRoot) {
  root = pageRoot;
  inModificaId = null;
  mostraErrore($("#pagina-error"), "");

  const raw = sessionStorage.getItem(STORAGE_RATE_OCCUPANTE);
  idOccupante = raw ? Number(raw) : null;

  $("#btn-torna-occupanti").addEventListener("click", () => {
    sessionStorage.removeItem(STORAGE_RATE_OCCUPANTE);
    window.mostraPaginaApp?.("elenco-occupanti");
  });

  if (!idOccupante) {
    mostraErrore(
      $("#pagina-error"),
      "Nessun occupante selezionato. Torna a Elenco Occupanti."
    );
    $("#btn-nuova-rata").disabled = true;
    return;
  }

  try {
    occupante = await caricaOccupante();
    if (!occupante) {
      mostraErrore($("#pagina-error"), "Occupante non trovato.");
      $("#btn-nuova-rata").disabled = true;
      return;
    }

    const pezzi = [
      occupante.nominativo,
      (occupante.proprietaUnita || "").trim(),
      (occupante.identificativoUnita || "").trim()
        ? `ID ${(occupante.identificativoUnita || "").trim()}`
        : "",
    ].filter(Boolean);
    $("#titolo-rate").textContent = `Rate — ${occupante.nominativo}`;
    $("#sottotitolo-rate").textContent = pezzi.slice(1).join(" · ");

    rendicontiOpzioni = await reportRendicontiArchiviatiOpzioni();
    popolaSelectRiepilogo();
  } catch (err) {
    mostraErrore($("#pagina-error"), String(err));
    return;
  }

  $("#btn-nuova-rata").addEventListener("click", () => apriForm());
  $("#btn-annulla").addEventListener("click", () => chiudiForm());
  $("#btn-apri-riepilogo").addEventListener("click", () => apriRiepilogo());
  $("#form-rata").addEventListener("submit", async (event) => {
    event.preventDefault();
    mostraErrore($("#form-error"), "");
    const dati = leggiForm();
    try {
      if (inModificaId == null) {
        await creaRataCondominiale(dati);
      } else {
        await aggiornaRataCondominiale(inModificaId, dati);
      }
      chiudiForm();
      await ricaricaLista();
    } catch (err) {
      mostraErrore($("#form-error"), String(err));
    }
  });

  await ricaricaLista();
}

export function onLeave() {
  root = null;
  idOccupante = null;
  occupante = null;
  inModificaId = null;
  rendicontiOpzioni = [];
}
