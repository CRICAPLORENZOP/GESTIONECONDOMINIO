import {
  elencoOccupantiCorrenti,
  reportRendicontiArchiviatiOpzioni,
} from "../api.js";

const STORAGE_RATE_OCCUPANTE = "gestione.rateOccupanteId";
const STORAGE_CONGUAGLIO_REND = "gestione.conguaglioOccupantiRendiconto";

let root = null;
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

function formatDataIt(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function formatNum(valore) {
  const n = Number(valore);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("it-IT", { maximumFractionDigits: 2 });
}

function apriRateOccupante(idOccupante) {
  sessionStorage.removeItem("gestione.pagamentiRitorno");
  sessionStorage.setItem(STORAGE_RATE_OCCUPANTE, String(idOccupante));
  window.mostraPaginaApp?.("rate-occupante");
}

function popolaSelectConguaglio() {
  const sel = $("#rendiconto-conguaglio");
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

function apriConguaglio() {
  mostraErrore($("#lista-error"), "");
  const rendiconto = ($("#rendiconto-conguaglio")?.value || "").trim();
  sessionStorage.setItem(STORAGE_CONGUAGLIO_REND, rendiconto);
  window.mostraPaginaApp?.("conguaglio-occupanti");
}

async function ricaricaLista() {
  mostraErrore($("#lista-error"), "");
  const corpo = $("#corpo-occupanti");
  const vuote = $("#lista-vuota");
  const wrap = $("#tabella-wrap");
  corpo.innerHTML = "";

  try {
    const lista = await elencoOccupantiCorrenti();
    if (!lista.length) {
      vuote.hidden = false;
      wrap.hidden = true;
      return;
    }
    vuote.hidden = true;
    wrap.hidden = false;

    for (const o of lista) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td></td>
        <td></td>
        <td></td>
        <td></td>
        <td></td>
        <td></td>
        <td class="num"></td>
        <td class="num"></td>
        <td class="azioni">
          <button type="button" class="btn btn-secondary btn-rate">Rate</button>
        </td>
      `;
      const td = tr.children;
      td[0].textContent = String(o.idOccupante);
      td[1].textContent = (o.identificativoUnita || "").trim() || "—";
      td[2].textContent = (o.proprietaUnita || "").trim() || "—";
      td[3].textContent = o.nominativo || "—";
      td[4].textContent = formatDataIt(o.dataInizio);
      td[5].textContent = o.dataFine ? formatDataIt(o.dataFine) : "in corso";
      td[6].textContent = String(o.numComponenti ?? "—");
      td[7].textContent = formatNum(o.percentuale);
      tr.querySelector(".btn-rate").addEventListener("click", () => {
        apriRateOccupante(o.idOccupante);
      });
      corpo.appendChild(tr);
    }
  } catch (err) {
    wrap.hidden = true;
    vuote.hidden = true;
    mostraErrore($("#lista-error"), String(err));
  }
}

export async function onEnter(pageRoot) {
  root = pageRoot;
  mostraErrore($("#lista-error"), "");

  try {
    rendicontiOpzioni = await reportRendicontiArchiviatiOpzioni();
    popolaSelectConguaglio();
  } catch (err) {
    mostraErrore($("#lista-error"), String(err));
  }

  $("#btn-conguaglio").addEventListener("click", () => apriConguaglio());
  await ricaricaLista();
}

export function onLeave() {
  root = null;
  rendicontiOpzioni = [];
}
