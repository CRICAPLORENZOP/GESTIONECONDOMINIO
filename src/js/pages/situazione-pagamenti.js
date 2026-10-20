import {
  reportRendicontiArchiviatiOpzioni,
  reportRendicontoArchiviatoPiuRecente,
  situazionePagamenti,
} from "../api.js";

const STORAGE_RENDICONTO = "gestione.situazionePagamentiRendiconto";
const STORAGE_PROPRIETA = "gestione.pagamentoProprietaNome";
const STORAGE_RITORNO = "gestione.pagamentiRitorno";
const STORAGE_RATE_OCCUPANTE = "gestione.rateOccupanteId";

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

/** Backend: differenza = dovuto − versato. A schermo: versato − dovuto. */
function scriviSaldo(el, differenzaBackend) {
  const mostrato = -Number(differenzaBackend);
  el.textContent = formatEuro(mostrato);
  el.classList.remove("diff-positiva", "diff-negativa");
  if (mostrato > 0.004) el.classList.add("diff-positiva");
  else if (mostrato < -0.004) el.classList.add("diff-negativa");
}

function nomeProprieta(nome) {
  const pulito = (nome || "").trim();
  return pulito || "(senza nome)";
}

async function popolaRendiconto() {
  const sel = $("#rendiconto");
  const salvato = (sessionStorage.getItem(STORAGE_RENDICONTO) || "").trim();
  const opzioni = await reportRendicontiArchiviatiOpzioni();
  sel.innerHTML = `<option value="">— rendiconto attivo —</option>`;
  for (const v of opzioni || []) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    sel.appendChild(opt);
  }
  if (salvato && [...sel.options].some((o) => o.value === salvato)) {
    sel.value = salvato;
  }
}

function disegna(dati) {
  const corpoOcc = $("#corpo-occupanti");
  const corpoProp = $("#corpo-proprieta");
  corpoOcc.innerHTML = "";
  corpoProp.innerHTML = "";

  const occupanti = dati.occupanti || [];
  $("#vuoto-occupanti").hidden = occupanti.length > 0;
  $("#wrap-occupanti").hidden = occupanti.length === 0;
  for (const r of occupanti) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td></td>
      <td></td>
      <td class="num"></td>
      <td class="num"></td>
      <td class="num saldo"></td>
      <td class="azioni">
        <button type="button" class="btn btn-secondary btn-versamenti">Versamenti</button>
      </td>
    `;
    const td = tr.children;
    const id = (r.identificativoUnita || "").trim();
    td[0].textContent = id || "—";
    td[1].textContent = r.nominativo || "—";
    if (r.ancheProprietario) {
      const nota = document.createElement("span");
      nota.className = "nota-doppio";
      nota.textContent = "È anche proprietario: il conto proprietà è nella tabella sotto.";
      td[1].appendChild(nota);
    }
    td[2].textContent = formatEuro(r.dovuto);
    td[3].textContent = formatEuro(r.versato);
    scriviSaldo(td[4], r.differenza);
    tr.querySelector(".btn-versamenti").addEventListener("click", () => {
      sessionStorage.setItem(STORAGE_RITORNO, "situazione-pagamenti");
      sessionStorage.setItem(STORAGE_RATE_OCCUPANTE, String(r.idOccupante));
      window.mostraPaginaApp?.("rate-occupante");
    });
    corpoOcc.appendChild(tr);
  }
  $("#tot-dovuto-occ").textContent = formatEuro(dati.totaleDovutoOccupanti || 0);
  $("#tot-versato-occ").textContent = formatEuro(dati.totaleVersatoOccupanti || 0);
  scriviSaldo($("#tot-saldo-occ"), dati.totaleDifferenzaOccupanti || 0);

  const proprieta = dati.proprieta || [];
  $("#vuoto-proprieta").hidden = proprieta.length > 0;
  $("#wrap-proprieta").hidden = proprieta.length === 0;
  for (const r of proprieta) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td></td>
      <td class="num"></td>
      <td class="num"></td>
      <td class="num"></td>
      <td class="num saldo"></td>
      <td class="azioni">
        <button type="button" class="btn btn-secondary btn-versamenti">Versamenti</button>
      </td>
    `;
    const td = tr.children;
    td[0].textContent = nomeProprieta(r.proprieta);
    if (r.ancheOccupante) {
      const nota = document.createElement("span");
      nota.className = "nota-doppio";
      nota.textContent = "È anche occupante: i versamenti da inquilino stanno nella tabella sopra.";
      td[0].appendChild(nota);
    }
    td[1].textContent = String(r.nUnita || 0);
    td[2].textContent = formatEuro(r.dovuto);
    td[3].textContent = formatEuro(r.versato);
    scriviSaldo(td[4], r.differenza);
    tr.querySelector(".btn-versamenti").addEventListener("click", () => {
      sessionStorage.setItem(STORAGE_PROPRIETA, r.proprieta || "");
      window.mostraPaginaApp?.("pagamenti-proprieta");
    });
    corpoProp.appendChild(tr);
  }
  $("#tot-dovuto-prop").textContent = formatEuro(dati.totaleDovutoProprieta || 0);
  $("#tot-versato-prop").textContent = formatEuro(dati.totaleVersatoProprieta || 0);
  scriviSaldo($("#tot-saldo-prop"), dati.totaleDifferenzaProprieta || 0);
}

async function carica() {
  mostraErrore($("#pagina-error"), "");
  const rendiconto = ($("#rendiconto").value || "").trim();
  sessionStorage.setItem(STORAGE_RENDICONTO, rendiconto);
  try {
    const dati = await situazionePagamenti(rendiconto);
    disegna(dati);
  } catch (err) {
    mostraErrore($("#pagina-error"), String(err));
  }
}

export async function onEnter(pageRoot) {
  root = pageRoot;
  const forzaRecente =
    sessionStorage.getItem("gestione.apriRendicontoRecente") === "situazione-pagamenti";
  if (forzaRecente) {
    sessionStorage.removeItem("gestione.apriRendicontoRecente");
  }
  const maiScelto = sessionStorage.getItem(STORAGE_RENDICONTO) === null;
  try {
    if (forzaRecente || maiScelto) {
      const recente = ((await reportRendicontoArchiviatoPiuRecente()) || "").trim();
      if (recente) sessionStorage.setItem(STORAGE_RENDICONTO, recente);
    }
    await popolaRendiconto();
    await carica();
  } catch (err) {
    mostraErrore($("#pagina-error"), String(err));
  }
  $("#rendiconto")?.addEventListener("change", () => carica());
}

export function onLeave() {
  root = null;
}
