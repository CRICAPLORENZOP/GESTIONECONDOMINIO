import {
  aggiornaPagamentoProprieta,
  creaPagamentoProprieta,
  eliminaPagamentoProprieta,
  elencoPagamentiProprieta,
  reportRendicontiArchiviatiOpzioni,
  situazionePagamenti,
} from "../api.js";
import { chiediConferma } from "../conferma.js";

const STORAGE_RENDICONTO = "gestione.situazionePagamentiRendiconto";
const STORAGE_PROPRIETA = "gestione.pagamentoProprietaNome";

let root = null;
let proprieta = "";
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

function formatEuroConSimbolo(valore) {
  return `€ ${formatEuro(valore)}`;
}

function formatDataIt(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function nomeVisibile() {
  return proprieta.trim() || "(senza nome)";
}

function scriviSaldo(el, differenzaBackend) {
  const mostrato = -Number(differenzaBackend);
  el.textContent = formatEuroConSimbolo(mostrato);
  el.classList.remove("diff-positiva", "diff-negativa");
  if (mostrato > 0.004) el.classList.add("diff-positiva");
  else if (mostrato < -0.004) el.classList.add("diff-negativa");
}

function popolaSelect(selezionato = "") {
  const sel = $("#rendiconto");
  sel.innerHTML = `<option value="">— rendiconto attivo —</option>`;
  for (const v of rendicontiOpzioni) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    sel.appendChild(opt);
  }
  const scelto = (selezionato || "").trim();
  if (scelto && !rendicontiOpzioni.includes(scelto)) {
    const opt = document.createElement("option");
    opt.value = scelto;
    opt.textContent = scelto;
    sel.appendChild(opt);
  }
  sel.value = scelto;
}

function chiudiForm() {
  inModificaId = null;
  $("#pannello-form").hidden = true;
  $("#form-pagamento").reset();
  $("#id-pagamento").value = "";
  mostraErrore($("#form-error"), "");
}

function apriForm(pagamento) {
  $("#pannello-form").hidden = false;
  mostraErrore($("#form-error"), "");
  if (!pagamento) {
    inModificaId = null;
    $("#titolo-form").textContent = "Nuovo versamento";
    $("#id-pagamento").value = "";
    $("#data-versamento").value = "";
    $("#importo").value = "0";
    $("#note").value = "";
    popolaSelect(sessionStorage.getItem(STORAGE_RENDICONTO) || "");
    return;
  }
  inModificaId = pagamento.idPagamento;
  $("#titolo-form").textContent = "Modifica versamento";
  $("#id-pagamento").value = String(pagamento.idPagamento);
  $("#data-versamento").value = pagamento.dataVersamento || "";
  $("#importo").value = String(pagamento.importo ?? 0);
  $("#note").value = pagamento.notePagamento || "";
  popolaSelect(pagamento.rendiconto || "");
}

async function aggiornaSaldi() {
  const rendiconto = (sessionStorage.getItem(STORAGE_RENDICONTO) || "").trim();
  const etichetta = rendiconto ? `Rendiconto ${rendiconto}` : "Rendiconto attivo";
  $("#sottotitolo").textContent = `${etichetta}. Ogni riga è un versamento: puoi aggiungerne quanti ne servono.`;
  try {
    const dati = await situazionePagamenti(rendiconto);
    const riga = (dati.proprieta || []).find(
      (p) => (p.proprieta || "").trim().toLowerCase() === proprieta.trim().toLowerCase()
    );
    $("#saldo-dovuto").textContent = formatEuroConSimbolo(riga?.dovuto || 0);
    $("#saldo-versato").textContent = formatEuroConSimbolo(riga?.versato || 0);
    scriviSaldo($("#saldo-diff"), riga?.differenza || 0);
  } catch (err) {
    mostraErrore($("#pagina-error"), String(err));
  }
}

async function ricaricaLista() {
  const corpo = $("#corpo");
  const vuota = $("#lista-vuota");
  const wrap = $("#tabella-wrap");
  corpo.innerHTML = "";
  const lista = await elencoPagamentiProprieta(proprieta);
  if (!lista.length) {
    vuota.hidden = false;
    wrap.hidden = true;
    return;
  }
  vuota.hidden = true;
  wrap.hidden = false;
  for (const p of lista) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td></td>
      <td class="num"></td>
      <td></td>
      <td></td>
      <td class="azioni">
        <button type="button" class="btn btn-secondary btn-piccolo">Modifica</button>
        <button type="button" class="btn btn-secondary btn-piccolo btn-elimina">Elimina</button>
      </td>
    `;
    const td = tr.children;
    td[0].textContent = formatDataIt(p.dataVersamento);
    td[1].textContent = formatEuroConSimbolo(p.importo);
    td[2].textContent = (p.rendiconto || "").trim() || "attivo";
    td[3].textContent = (p.notePagamento || "").trim() || "—";
    tr.querySelector(".btn-piccolo").addEventListener("click", () => apriForm(p));
    tr.querySelector(".btn-elimina").addEventListener("click", async () => {
      const ok = await chiediConferma(
        `Eliminare il versamento del ${formatDataIt(p.dataVersamento)} di € ${formatEuro(p.importo)}?`
      );
      if (!ok) return;
      try {
        await eliminaPagamentoProprieta(p.idPagamento);
        if (inModificaId === p.idPagamento) chiudiForm();
        await ricaricaLista();
        await aggiornaSaldi();
      } catch (err) {
        mostraErrore($("#pagina-error"), String(err));
      }
    });
    corpo.appendChild(tr);
  }
}

export async function onEnter(pageRoot) {
  root = pageRoot;
  inModificaId = null;
  proprieta = sessionStorage.getItem(STORAGE_PROPRIETA) ?? "";
  if (proprieta === null) proprieta = "";
  $("#titolo").textContent = `Versamenti — ${nomeVisibile()}`;
  mostraErrore($("#pagina-error"), "");

  $("#btn-torna").addEventListener("click", () => {
    window.mostraPaginaApp?.("situazione-pagamenti");
  });
  $("#btn-nuovo").addEventListener("click", () => apriForm(null));
  $("#btn-annulla").addEventListener("click", () => chiudiForm());
  $("#form-pagamento").addEventListener("submit", async (event) => {
    event.preventDefault();
    mostraErrore($("#form-error"), "");
    const dati = {
      proprieta,
      dataVersamento: $("#data-versamento").value,
      importo: Number($("#importo").value || 0),
      notePagamento: $("#note").value,
      rendiconto: $("#rendiconto").value || "",
    };
    try {
      if (inModificaId == null) await creaPagamentoProprieta(dati);
      else await aggiornaPagamentoProprieta(inModificaId, dati);
      chiudiForm();
      await ricaricaLista();
      await aggiornaSaldi();
    } catch (err) {
      mostraErrore($("#form-error"), String(err));
    }
  });

  try {
    rendicontiOpzioni = (await reportRendicontiArchiviatiOpzioni()) || [];
    await aggiornaSaldi();
    await ricaricaLista();
  } catch (err) {
    mostraErrore($("#pagina-error"), String(err));
  }
}

export function onLeave() {
  root = null;
  inModificaId = null;
  rendicontiOpzioni = [];
}
