import {
  aggiornaQuotePeriodo,
  creaPeriodoSpesa,
  dettaglioRipartoSpesa,
  eliminaPeriodoSpesa,
  proponiPeriodoSpesa,
} from "../api.js";
import { chiediConferma } from "../conferma.js";

let root = null;
let idSpesa = null;
let dettaglio = null;
/** Ultima proposta mostrata in anteprima (con eventuali modifiche). */
let propostaCorrente = null;

function $(sel) {
  return root.querySelector(sel);
}

function storageKey() {
  return window.STORAGE_RIPARTO_SPESA || "gestione.ripartoSpesaId";
}

function provenienzaKey() {
  return window.STORAGE_RIPARTO_PROVENIENZA || "gestione.ripartoProvenienza";
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

/** Divide l'importo dell'unità tra inquilino e proprietà, in base alla spesa. */
function splitCompetenza(importo) {
  const perc = Number(dettaglio?.spesa?.quotaInquilino);
  const quota = Number.isFinite(perc) ? Math.min(100, Math.max(0, perc)) : 100;
  const tot = Number(importo) || 0;
  const inquilino = Math.round(((tot * quota) / 100) * 100) / 100;
  const proprieta = Math.round((tot - inquilino) * 100) / 100;
  return { inquilino, proprieta };
}

function testoCompetenzaSpesa(spesa) {
  const competenza = spesa?.competenza || "INQUILINO";
  const quota = Number(spesa?.quotaInquilino);
  const inq = Number.isFinite(quota) ? quota : 100;
  const prop = Math.round((100 - inq) * 100) / 100;
  const fmt = (n) =>
    n.toLocaleString("it-IT", { maximumFractionDigits: 2 });
  if (competenza === "PROPRIETARIO") return "Solo proprietà";
  if (competenza === "ENTRAMBI") {
    return `Entrambi · inquilino ${fmt(inq)}% · proprietà ${fmt(prop)}%`;
  }
  return "Tutta all'inquilino";
}

function formatDataIt(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function formatNumero(valore) {
  const n = Number(valore);
  if (!Number.isFinite(n)) return "—";
  return Number.isInteger(n)
    ? String(n)
    : n.toLocaleString("it-IT", { maximumFractionDigits: 4 });
}

/** Intestazione colonna peso: Millesimi oppure Parti. */
function etichettaPeso(ripartizione) {
  return ripartizione === "Millesimi" ? "Millesimi" : "Parti";
}

/** Giorno successivo a una data AAAA-MM-GG (locale). */
function giornoSuccessivo(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + 1);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * Propone le date del nuovo periodo (sempre modificabili):
 * - primo periodo: da inizio spesa a fine spesa
 * - periodi successivi: da giorno dopo la fine dell’ultimo periodo a fine spesa
 */
function suggerisciDateNuovoPeriodo() {
  const s = dettaglio?.spesa;
  const daEl = $("#periodo-da");
  const aEl = $("#periodo-a");
  if (!s || !daEl || !aEl) return;

  daEl.min = s.spesaDa;
  daEl.max = s.spesaA;
  aEl.min = s.spesaDa;
  aEl.max = s.spesaA;

  let suggeritoDa = s.spesaDa;
  const periodi = dettaglio.periodi || [];
  if (periodi.length) {
    let maxFine = periodi[0].periodoA;
    for (const p of periodi) {
      if (p.periodoA > maxFine) maxFine = p.periodoA;
    }
    suggeritoDa = giornoSuccessivo(maxFine);
    // Se l’ultimo periodo arriva già a fine spesa, resta sulla data di fine
    // (l’utente può comunque cambiare le date a mano).
    if (suggeritoDa > s.spesaA) {
      suggeritoDa = s.spesaA;
    }
  }

  daEl.value = suggeritoDa;
  aEl.value = s.spesaA;
}

function renderRiepilogo() {
  const s = dettaglio.spesa;
  $("#titolo-riparto").textContent = `Ripartizione — ${s.gruppoSpesa}`;
  $("#sottotitolo-riparto").textContent =
    `${formatDataIt(s.spesaDa)} → ${formatDataIt(s.spesaA)} · ${s.descrizione || "Senza descrizione"}`;

  $("#riepilogo-spesa").innerHTML = `
    <div class="riepilogo-item"><span>Cifra</span><strong>${formatEuro(s.cifra)} €</strong></div>
    <div class="riepilogo-item"><span>Spese pagamento</span><strong>${formatEuro(s.spesePagamento)} €</strong></div>
    <div class="riepilogo-item"><span>Totale</span><strong>${formatEuro(Number(s.cifra) + Number(s.spesePagamento))} €</strong></div>
    <div class="riepilogo-item"><span>Giorni spesa</span><strong>${dettaglio.giorni}</strong></div>
    <div class="riepilogo-item"><span>Ripartizione</span><strong>${dettaglio.ripartizione}</strong></div>
    <div class="riepilogo-item"><span>Chi paga</span><strong>${testoCompetenzaSpesa(s)}</strong></div>
    <div class="riepilogo-item"><span>Stato</span><strong>${s.stato}</strong></div>
    <div class="riepilogo-item"><span>Totale periodi</span><strong>${formatEuro(dettaglio.totaleRiparto)} €</strong></div>
  `;

  suggerisciDateNuovoPeriodo();
}

/** Ricalcola parziali e importi su un elenco quote (in memoria). */
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
  if (totale <= 0) {
    const n = quote.length;
    const quota = importoPeriodo / n;
    quote.forEach((q, i) => {
      q.importo =
        i === n - 1
          ? Math.round((importoPeriodo - quota * (n - 1)) * 100) / 100
          : Math.round(quota * 100) / 100;
    });
  } else {
    let somma = 0;
    quote.forEach((q, i) => {
      if (i === quote.length - 1) {
        q.importo = Math.round((importoPeriodo - somma) * 100) / 100;
      } else {
        q.importo = Math.round(((importoPeriodo * q.baseCalcolo) / totale) * 100) / 100;
        somma += q.importo;
      }
    });
  }
}

function aggiornaCelleCalcolate(tbody, quote) {
  for (const tr of tbody.querySelectorAll("tr")) {
    const idOcc = tr.dataset.idOccupante ? Number(tr.dataset.idOccupante) : null;
    const idRip = tr.dataset.idRiparto ? Number(tr.dataset.idRiparto) : null;
    const q = quote.find(
      (x) =>
        (idOcc != null && x.idOccupante === idOcc) ||
        (idRip != null && x.idRiparto === idRip)
    );
    if (!q) continue;
    const cellP = tr.querySelector(".cell-parziale");
    const cellI = tr.querySelector(".cell-importo");
    const cellInq = tr.querySelector(".cell-inquilino");
    const cellProp = tr.querySelector(".cell-proprieta");
    if (cellP) cellP.textContent = formatNumero(q.baseCalcolo);
    if (cellI) cellI.textContent = formatEuro(q.importo);
    const split = splitCompetenza(q.importo);
    if (cellInq) cellInq.textContent = formatEuro(split.inquilino);
    if (cellProp) cellProp.textContent = formatEuro(split.proprieta);
  }
}

function ricalcolaAnteprima() {
  if (!propostaCorrente?.quote?.length) return;
  ricalcolaQuoteInMemoria(
    propostaCorrente.quote,
    Number(propostaCorrente.importoPeriodo)
  );
  aggiornaCelleCalcolate($("#corpo-anteprima"), propostaCorrente.quote);
}

function collegaDoppioClicOccupante(cella, q) {
  cella.classList.add("cell-occupante");
  cella.title = "Doppio clic per modificare l’occupante";
  cella.addEventListener("dblclick", () => {
    if (typeof window.apriOccupantiPerUnita !== "function") return;
    window.apriOccupantiPerUnita(q.idUnita, q.idOccupante);
  });
}

function collegaDoppioClicProprieta(cella, q) {
  cella.classList.add("cell-proprieta");
  cella.title = "Doppio clic per modificare l’unità";
  cella.addEventListener("dblclick", () => {
    if (typeof window.apriModificaUnita !== "function") return;
    window.apriModificaUnita(q.idUnita);
  });
}

function rigaQuotaModificabile(q, { usaIdRiparto = false, onChange } = {}) {
  const tr = document.createElement("tr");
  tr.dataset.idOccupante = String(q.idOccupante);
  tr.dataset.idUnita = String(q.idUnita);
  if (usaIdRiparto) {
    tr.dataset.idRiparto = String(q.idRiparto);
  }
  tr.innerHTML = `
    <td></td>
    <td></td>
    <td class="num">
      <input type="number" class="input-quota input-peso" min="0" step="any" />
    </td>
    <td class="num">
      <input type="number" class="input-quota input-perc" min="0" max="100" step="any" />
    </td>
    <td class="num cell-parziale"></td>
    <td class="num cell-importo"></td>
    <td class="num cell-inquilino"></td>
    <td class="num cell-proprieta"></td>
  `;
  const celle = tr.querySelectorAll("td");
  celle[0].textContent = q.proprietaUnita;
  celle[1].textContent = q.nominativo;
  collegaDoppioClicProprieta(celle[0], q);
  collegaDoppioClicOccupante(celle[1], q);

  const inpPeso = tr.querySelector(".input-peso");
  const inpPerc = tr.querySelector(".input-perc");
  inpPeso.value = String(q.peso);
  inpPerc.value = String(q.percentuale);
  tr.querySelector(".cell-parziale").textContent = formatNumero(q.baseCalcolo);
  tr.querySelector(".cell-importo").textContent = formatEuro(q.importo);
  const splitRiga = splitCompetenza(q.importo);
  tr.querySelector(".cell-inquilino").textContent = formatEuro(splitRiga.inquilino);
  tr.querySelector(".cell-proprieta").textContent = formatEuro(splitRiga.proprieta);

  const applica = () => {
    q.peso = Number(inpPeso.value);
    q.percentuale = Number(inpPerc.value);
    onChange?.();
  };
  inpPeso.addEventListener("input", applica);
  inpPerc.addEventListener("input", applica);

  return tr;
}

function raccogliQuoteOverride() {
  if (!propostaCorrente?.quote?.length) return null;
  return propostaCorrente.quote.map((q) => ({
    idOccupante: q.idOccupante,
    percentuale: Number(q.percentuale),
    peso: Number(q.peso),
  }));
}

function renderAnteprima(proposta) {
  propostaCorrente = {
    ...proposta,
    quote: proposta.quote.map((q) => ({ ...q })),
  };

  const panel = $("#panel-anteprima");
  panel.hidden = false;
  $("#anteprima-meta").textContent =
    `Periodo ${formatDataIt(proposta.periodoDa)} → ${formatDataIt(proposta.periodoA)} · ` +
    `${proposta.giorniPeriodo} giorni su ${proposta.giorniSpesa} · ` +
    `Importo periodo ${formatEuro(proposta.importoPeriodo)} € · ${proposta.ripartizione}`;

  $("#th-anteprima-peso").textContent = etichettaPeso(proposta.ripartizione);

  if (proposta.avviso) {
    mostraErrore($("#anteprima-avviso"), proposta.avviso);
  } else {
    mostraErrore($("#anteprima-avviso"), "");
  }

  const corpo = $("#corpo-anteprima");
  corpo.innerHTML = "";
  if (!propostaCorrente.quote.length) {
    corpo.innerHTML = `<tr><td colspan="8">Nessuna quota proposta.</td></tr>`;
    return;
  }
  for (const q of propostaCorrente.quote) {
    corpo.appendChild(
      rigaQuotaModificabile(q, { onChange: () => ricalcolaAnteprima() })
    );
  }
}

function rigaQuotaSolaLettura(q) {
  const tr = document.createElement("tr");
  tr.dataset.idRiparto = String(q.idRiparto ?? "");
  tr.dataset.idOccupante = String(q.idOccupante);
  tr.dataset.idUnita = String(q.idUnita);
  tr.innerHTML =
    `<td></td><td></td>` +
    `<td class="num"></td><td class="num"></td>` +
    `<td class="num"></td><td class="num"></td>` +
    `<td class="num"></td><td class="num"></td>`;
  const c = tr.querySelectorAll("td");
  c[0].textContent = q.proprietaUnita;
  c[1].textContent = q.nominativo;
  collegaDoppioClicProprieta(c[0], q);
  collegaDoppioClicOccupante(c[1], q);
  c[2].textContent = formatNumero(q.peso);
  c[3].textContent = formatNumero(q.percentuale);
  c[4].textContent = formatNumero(q.baseCalcolo);
  c[5].textContent = formatEuro(q.importo);
  const splitLetto = splitCompetenza(q.importo);
  c[6].textContent = formatEuro(splitLetto.inquilino);
  c[7].textContent = formatEuro(splitLetto.proprieta);
  return tr;
}

function sommaImporti(quote) {
  return quote.reduce((s, q) => s + Number(q.importo || 0), 0);
}

function aggiornaTotalePeriodo(card, quote, importoPeriodo) {
  const totale = Math.round(sommaImporti(quote) * 100) / 100;
  const atteso = Math.round(Number(importoPeriodo) * 100) / 100;
  const elTot = card.querySelector(".periodo-totale-val");
  const elCheck = card.querySelector(".periodo-totale-check");
  if (elTot) elTot.textContent = `${formatEuro(totale)} €`;
  if (!elCheck) return;
  const ok = Math.abs(totale - atteso) < 0.005;
  elCheck.textContent = ok
    ? `= importo periodo (${formatEuro(atteso)} €)`
    : `≠ importo periodo (${formatEuro(atteso)} €) — differenza ${formatEuro(totale - atteso)} €`;
  elCheck.classList.toggle("is-ok", ok);
  elCheck.classList.toggle("is-ko", !ok);
}

function renderPeriodi() {
  const lista = $("#lista-periodi");
  const vuoti = $("#periodi-vuoti");
  const boxTotale = $("#periodi-totale-finale");
  lista.innerHTML = "";

  if (!dettaglio.periodi.length) {
    vuoti.hidden = false;
    if (boxTotale) boxTotale.hidden = true;
    return;
  }
  vuoti.hidden = true;

  const labelPeso = etichettaPeso(dettaglio.ripartizione);

  for (const p of dettaglio.periodi) {
    let quoteLocali = p.quote.map((q) => ({ ...q }));
    let inModifica = false;

    const card = document.createElement("div");
    card.className = "periodo-card" + (p.archivia ? " is-archiviato" : "");
    card.dataset.idPeriodo = String(p.idPeriodo);
    card.innerHTML = `
      <div class="periodo-head">
        <div class="periodo-titolo">
          <h3></h3>
          <p class="periodo-meta"></p>
          <p class="muted periodo-edit-hint" hidden>
            Modifica ${labelPeso} e %, poi Salva.
          </p>
        </div>
        <div class="periodo-azioni">
          <button type="button" class="btn btn-secondary btn-modifica-periodo">
            Modifica
          </button>
          <button type="button" class="btn btn-salva-periodo" hidden>
            Salva
          </button>
          <button type="button" class="btn btn-ghost btn-annulla-periodo" hidden>
            Annulla
          </button>
          <button type="button" class="btn btn-danger btn-elimina-periodo">
            Elimina
          </button>
        </div>
      </div>
      <div class="periodo-meta-campi">
        <label class="campo-archivia">
          <input type="checkbox" class="input-archivia" disabled />
          <span>ARCHIVIA</span>
        </label>
        <label class="campo-rendiconto">
          <span>Rendiconto del</span>
          <input type="text" class="input-rendiconto" maxlength="200" disabled />
        </label>
      </div>
      <p class="form-error periodo-error" hidden></p>
      <div class="table-wrap">
        <table class="data-table data-table-compatta">
          <thead>
            <tr>
              <th>Proprietà</th>
              <th>Occupante</th>
              <th class="num">${labelPeso}</th>
              <th class="num">%</th>
              <th class="num">Parziale</th>
              <th class="num">Importo €</th>
              <th class="num">Inquilino €</th>
              <th class="num">Proprietà €</th>
            </tr>
          </thead>
          <tbody></tbody>
          <tfoot>
            <tr class="periodo-totale-row">
              <td colspan="5">Totale ripartizioni</td>
              <td class="num">
                <strong class="periodo-totale-val"></strong>
                <span class="periodo-totale-check"></span>
              </td>
              <td colspan="2"></td>
            </tr>
          </tfoot>
        </table>
      </div>
    `;
    card.querySelector("h3").textContent =
      `${formatDataIt(p.periodoDa)} → ${formatDataIt(p.periodoA)}`;
    card.querySelector(".periodo-meta").textContent =
      `${p.giorni} gg · ${formatEuro(p.importo)} €`;

    const inpArchivia = card.querySelector(".input-archivia");
    const inpRendiconto = card.querySelector(".input-rendiconto");
    inpArchivia.checked = Boolean(p.archivia);
    inpRendiconto.value = p.rendicontoDel || "";

    const tbody = card.querySelector("tbody");
    const errEl = card.querySelector(".periodo-error");
    const hintEl = card.querySelector(".periodo-edit-hint");
    const btnModifica = card.querySelector(".btn-modifica-periodo");
    const btnSalva = card.querySelector(".btn-salva-periodo");
    const btnAnnulla = card.querySelector(".btn-annulla-periodo");
    const btnElimina = card.querySelector(".btn-elimina-periodo");

    function disegnaTabella() {
      tbody.innerHTML = "";
      if (!quoteLocali.length) {
        tbody.innerHTML = `<tr><td colspan="6">Nessun occupante in questo periodo.</td></tr>`;
        aggiornaTotalePeriodo(card, [], p.importo);
        return;
      }

      if (inModifica) {
        const ricalcolaLocale = () => {
          ricalcolaQuoteInMemoria(quoteLocali, Number(p.importo));
          aggiornaCelleCalcolate(tbody, quoteLocali);
          aggiornaTotalePeriodo(card, quoteLocali, p.importo);
        };
        for (const q of quoteLocali) {
          tbody.appendChild(
            rigaQuotaModificabile(q, {
              usaIdRiparto: true,
              onChange: ricalcolaLocale,
            })
          );
        }
      } else {
        for (const q of quoteLocali) {
          tbody.appendChild(rigaQuotaSolaLettura(q));
        }
      }
      aggiornaTotalePeriodo(card, quoteLocali, p.importo);
    }

    function impostaModo(modifica) {
      inModifica = modifica;
      card.classList.toggle("is-editing", modifica);
      btnModifica.hidden = modifica;
      btnSalva.hidden = !modifica;
      btnAnnulla.hidden = !modifica;
      btnElimina.hidden = modifica;
      hintEl.hidden = !modifica;
      inpArchivia.disabled = !modifica;
      inpRendiconto.disabled = !modifica;
      mostraErrore(errEl, "");
      disegnaTabella();
    }

    btnModifica.addEventListener("click", () => {
      quoteLocali = p.quote.map((q) => ({ ...q }));
      inpArchivia.checked = Boolean(p.archivia);
      inpRendiconto.value = p.rendicontoDel || "";
      impostaModo(true);
    });

    btnAnnulla.addEventListener("click", () => {
      quoteLocali = p.quote.map((q) => ({ ...q }));
      inpArchivia.checked = Boolean(p.archivia);
      inpRendiconto.value = p.rendicontoDel || "";
      impostaModo(false);
    });

    btnSalva.addEventListener("click", async () => {
      mostraErrore(errEl, "");
      if (!quoteLocali.length) return;
      try {
        await aggiornaQuotePeriodo(p.idPeriodo, {
          quote: quoteLocali.map((q) => ({
            idRiparto: q.idRiparto,
            percentuale: Number(q.percentuale),
            peso: Number(q.peso),
          })),
          archivia: inpArchivia.checked,
          rendicontoDel: inpRendiconto.value.trim(),
        });
        await ricarica(false);
      } catch (err) {
        mostraErrore(errEl, String(err));
      }
    });

    btnElimina.addEventListener("click", async () => {
      const ok = await chiediConferma(
        `Eliminare il periodo ${formatDataIt(p.periodoDa)} → ${formatDataIt(p.periodoA)}?`
      );
      if (!ok) return;
      try {
        await eliminaPeriodoSpesa(p.idPeriodo);
        await ricarica();
      } catch (err) {
        mostraErrore($("#pagina-error"), String(err));
      }
    });

    disegnaTabella();
    lista.appendChild(card);
  }

  // Totale di tutti i periodi in fondo (controllo vs Totale spesa).
  const sommaPeriodi = Math.round(
    dettaglio.periodi.reduce((s, p) => s + Number(p.importo || 0), 0) * 100
  ) / 100;
  const totaleSpesa =
    Math.round(
      (Number(dettaglio.spesa.cifra) + Number(dettaglio.spesa.spesePagamento)) * 100
    ) / 100;

  if (boxTotale) {
    boxTotale.hidden = false;
    $("#periodi-totale-val").textContent = `${formatEuro(sommaPeriodi)} €`;
    const check = $("#periodi-totale-check");
    const ok = Math.abs(sommaPeriodi - totaleSpesa) < 0.005;
    check.textContent = ok
      ? `= totale spesa (${formatEuro(totaleSpesa)} €)`
      : `≠ totale spesa (${formatEuro(totaleSpesa)} €) — diff. ${formatEuro(sommaPeriodi - totaleSpesa)} €`;
    check.classList.toggle("is-ok", ok);
    check.classList.toggle("is-ko", !ok);
  }
}

async function ricarica(nascondiAnteprima = true) {
  dettaglio = await dettaglioRipartoSpesa(idSpesa);
  renderRiepilogo();
  renderPeriodi();
  if (nascondiAnteprima) {
    propostaCorrente = null;
    $("#panel-anteprima").hidden = true;
  }
}

export async function onEnter(pageRoot) {
  root = pageRoot;
  propostaCorrente = null;
  mostraErrore($("#pagina-error"), "");

  const raw = sessionStorage.getItem(storageKey());
  idSpesa = raw ? Number(raw) : null;
  const provenienza = sessionStorage.getItem(provenienzaKey()) || "spese";

  const btnTornaRip = $("#btn-torna-ripartizione");
  if (btnTornaRip) {
    btnTornaRip.hidden = provenienza !== "ripartizione";
    btnTornaRip.addEventListener("click", () => {
      sessionStorage.removeItem(storageKey());
      sessionStorage.removeItem(provenienzaKey());
      window.mostraPaginaApp?.("ripartizione");
    });
  }

  $("#btn-torna-spese").addEventListener("click", () => {
    sessionStorage.removeItem(storageKey());
    sessionStorage.removeItem(provenienzaKey());
    window.mostraPaginaApp?.("spese");
  });

  if (!idSpesa) {
    mostraErrore(
      $("#pagina-error"),
      "Nessuna spesa selezionata. Torna a Spese e usa il pulsante Ripartisci."
    );
    return;
  }

  $("#btn-aiuto-periodo").addEventListener("click", () => {
    const aiuto = $("#aiuto-periodo");
    const btn = $("#btn-aiuto-periodo");
    const aperto = aiuto.hidden;
    aiuto.hidden = !aperto;
    btn.setAttribute("aria-expanded", aperto ? "true" : "false");
  });

  $("#form-periodo").addEventListener("submit", async (event) => {
    event.preventDefault();
    mostraErrore($("#form-error"), "");
    try {
      const quote = raccogliQuoteOverride();
      if (!quote) {
        const proposta = await proponiPeriodoSpesa(idSpesa, {
          periodoDa: $("#periodo-da").value,
          periodoA: $("#periodo-a").value,
        });
        renderAnteprima(proposta);
        mostraErrore(
          $("#form-error"),
          "Controlla l’anteprima (puoi modificare Parti/Millesimi e %), poi premi di nuovo «Crea periodo»."
        );
        return;
      }

      await creaPeriodoSpesa(idSpesa, {
        periodoDa: $("#periodo-da").value,
        periodoA: $("#periodo-a").value,
        quote,
      });
      mostraErrore($("#form-error"), "");
      await ricarica();
    } catch (err) {
      mostraErrore($("#form-error"), String(err));
    }
  });

  try {
    await ricarica();
  } catch (err) {
    mostraErrore($("#pagina-error"), String(err));
  }
}

export function onLeave() {
  root = null;
  idSpesa = null;
  dettaglio = null;
  propostaCorrente = null;
}
