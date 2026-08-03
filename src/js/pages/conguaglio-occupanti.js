import { conguaglioOccupanti } from "../api.js";

const STORAGE_CONGUAGLIO_REND = "gestione.conguaglioOccupantiRendiconto";

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

/**
 * Backend: differenza = quota − versato.
 * In schermo mostriamo versato − quota:
 * - positivo (versato > quota) → verde
 * - negativo (quota > versato) → rosso con segno meno
 */
function applicaDiff(el, differenzaBackend) {
  const mostrato = -Number(differenzaBackend);
  el.textContent = formatEuro(mostrato);
  el.classList.remove("diff-positiva", "diff-negativa");
  if (mostrato > 0.004) {
    el.classList.add("diff-positiva");
  } else if (mostrato < -0.004) {
    el.classList.add("diff-negativa");
  }
}

export async function onEnter(pageRoot) {
  root = pageRoot;
  mostraErrore($("#pagina-error"), "");
  $("#tabella-wrap").hidden = true;
  $("#lista-vuota").hidden = true;

  $("#btn-torna-occupanti").addEventListener("click", () => {
    sessionStorage.removeItem(STORAGE_CONGUAGLIO_REND);
    window.mostraPaginaApp?.("elenco-occupanti");
  });

  const rendiconto = (sessionStorage.getItem(STORAGE_CONGUAGLIO_REND) || "").trim();

  try {
    const dati = await conguaglioOccupanti(rendiconto);

    if (dati.attivo) {
      $("#sottotitolo-conguaglio").textContent =
        "Rendiconto attivo (periodi non archiviati) · rate senza rendiconto";
    } else {
      $("#sottotitolo-conguaglio").textContent = `Rendiconto: ${dati.rendiconto}`;
    }

    const corpo = $("#corpo-conguaglio");
    corpo.innerHTML = "";

    if (!dati.righe.length) {
      $("#lista-vuota").hidden = false;
      return;
    }

    for (const r of dati.righe) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td></td>
        <td></td>
        <td></td>
        <td class="num"></td>
        <td class="num"></td>
        <td class="num"></td>
      `;
      const td = tr.children;
      td[0].textContent = (r.identificativoUnita || "").trim() || "—";
      td[1].textContent = (r.proprietaUnita || "").trim() || "—";
      td[2].textContent = r.nominativo || "—";
      td[3].textContent = formatEuro(r.quotaSpettante);
      td[4].textContent = formatEuro(r.totaleRateVersate);
      applicaDiff(td[5], r.differenza);
      corpo.appendChild(tr);
    }

    $("#tot-quote").textContent = formatEuro(dati.totaleQuote);
    $("#tot-rate").textContent = formatEuro(dati.totaleRate);
    applicaDiff($("#tot-diff"), dati.totaleDifferenza);

    $("#tabella-wrap").hidden = false;
  } catch (err) {
    mostraErrore($("#pagina-error"), String(err));
  }
}

export function onLeave() {
  root = null;
}
