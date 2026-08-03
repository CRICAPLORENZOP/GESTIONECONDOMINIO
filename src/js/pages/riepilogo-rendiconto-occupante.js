import { riepilogoRendicontoOccupante } from "../api.js";

const STORAGE_RATE_OCCUPANTE = "gestione.rateOccupanteId";
const STORAGE_RIEPILOGO_REND = "gestione.riepilogoRendicontoOccupante";

let root = null;

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
  return (
    "€ " +
    Number(valore).toLocaleString("it-IT", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

function tornaAlleRate() {
  sessionStorage.removeItem(STORAGE_RIEPILOGO_REND);
  window.mostraPaginaApp?.("rate-occupante");
}

export async function onEnter(pageRoot) {
  root = pageRoot;
  mostraErrore($("#pagina-error"), "");
  $("#pannello-riepilogo").hidden = true;

  $("#btn-torna-rate").addEventListener("click", tornaAlleRate);

  const rawId = sessionStorage.getItem(STORAGE_RATE_OCCUPANTE);
  const idOccupante = rawId ? Number(rawId) : null;
  // Vuoto = rendiconto attivo (periodi non archiviati) + rate senza rendiconto.
  const rendiconto = (sessionStorage.getItem(STORAGE_RIEPILOGO_REND) || "").trim();

  if (!idOccupante) {
    mostraErrore(
      $("#pagina-error"),
      "Nessun occupante selezionato. Torna alle Rate o all’elenco Occupanti."
    );
    return;
  }

  try {
    const dati = await riepilogoRendicontoOccupante(idOccupante, rendiconto);

    const pezzi = [
      dati.nominativo,
      (dati.proprietaUnita || "").trim(),
      (dati.identificativoUnita || "").trim()
        ? `ID ${(dati.identificativoUnita || "").trim()}`
        : "",
    ].filter(Boolean);

    $("#titolo-riepilogo").textContent = `Riepilogo — ${dati.nominativo}`;
    $("#sottotitolo-riepilogo").textContent = pezzi.slice(1).join(" · ");

    if (dati.attivo) {
      $("#lbl-tipo-rendiconto").textContent = "Ambito:";
      $("#val-rendiconto").textContent = "Rendiconto attivo (in corso)";
      $("#lbl-totale-rendiconto").textContent =
        "Totale periodi non archiviati";
      $("#lbl-rate-versate").textContent =
        "Somma rate senza rendiconto";
    } else {
      $("#lbl-tipo-rendiconto").textContent = "Rendiconto:";
      $("#val-rendiconto").textContent = dati.rendiconto;
      $("#lbl-totale-rendiconto").textContent = "Totale del rendiconto";
      $("#lbl-rate-versate").textContent = "Somma rate versate";
    }

    $("#val-totale-rendiconto").textContent = formatEuro(dati.totaleRendiconto);
    $("#val-quota-occupante").textContent = formatEuro(dati.quotaOccupante);
    $("#val-rate-versate").textContent = formatEuro(dati.totaleRateVersate);

    const diffEl = $("#val-differenza");
    // Schermo: versato − quota (positivo = verde, negativo = rosso con meno).
    const mostrato = -Number(dati.differenza);
    diffEl.textContent = formatEuro(mostrato);
    diffEl.classList.remove("diff-positiva", "diff-negativa", "diff-zero");
    if (mostrato > 0.004) {
      diffEl.classList.add("diff-positiva");
      $("#nota-differenza").textContent =
        "Le rate versate superano la quota ripartita (versato in più).";
    } else if (mostrato < -0.004) {
      diffEl.classList.add("diff-negativa");
      $("#nota-differenza").textContent =
        "C’è ancora un importo da versare rispetto alla quota ripartita.";
    } else {
      diffEl.classList.add("diff-zero");
      $("#nota-differenza").textContent =
        "Quota e versamenti coincidono (a meno di arrotondamenti).";
    }

    $("#pannello-riepilogo").hidden = false;
  } catch (err) {
    mostraErrore($("#pagina-error"), String(err));
  }
}

export function onLeave() {
  root = null;
}
