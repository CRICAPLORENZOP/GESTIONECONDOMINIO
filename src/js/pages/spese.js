import {
  aggiornaSpesa,
  allegaBollettaSpesa,
  apriBollettaSpesa,
  creaSpesa,
  eliminaSpesa,
  elencoSpese,
  elencoTipologieSpesa,
  rimuoviBollettaSpesa,
} from "../api.js";
import { chiediConferma } from "../conferma.js";

const STATO_DEFAULT = "ATTIVA";
const FILTRO_STATO_DEFAULT = "ATTIVA";
const COMPETENZA_DEFAULT = "INQUILINO";

let root = null;
let inModificaId = null;
let tipologieCache = [];
let filtroTipologiaId = null;
let filtroStato = FILTRO_STATO_DEFAULT;
/** Quota ricordata quando si sceglie «Entrambi», così non si perde cambiando voce. */
let quotaEntrambiMemorizzata = 50;

function chiaveDaRiparto() {
  return window.STORAGE_SPESE_DA_RIPARTO || "gestione.speseDaRipartoId";
}

function aggiornaPulsanteTornaRiparto() {
  const btn = $("#btn-torna-ripartizione");
  if (!btn) return;
  btn.hidden = !sessionStorage.getItem(chiaveDaRiparto());
}

function chiaveFiltroTipologia() {
  return window.STORAGE_SPESE_FILTRO_TIPLOGIA || "gestione.speseFiltroTipologiaId";
}

function chiaveFiltroStato() {
  return window.STORAGE_SPESE_FILTRO_STATO || "gestione.speseFiltroStato";
}

function leggiFiltroTipologia() {
  const grezzo = sessionStorage.getItem(chiaveFiltroTipologia());
  if (!grezzo) return null;
  const id = Number(grezzo);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function leggiFiltroStato() {
  const grezzo = sessionStorage.getItem(chiaveFiltroStato());
  if (grezzo === "ATTIVA" || grezzo === "ARCHIVIATA" || grezzo === "TUTTE") {
    return grezzo;
  }
  return FILTRO_STATO_DEFAULT;
}

function salvaFiltroStato(stato) {
  sessionStorage.setItem(chiaveFiltroStato(), stato);
  filtroStato = stato;
}

function togliFiltroTipologia() {
  sessionStorage.removeItem(chiaveFiltroTipologia());
  filtroTipologiaId = null;
}

function applicaFiltroTipologia(idTipologia) {
  sessionStorage.setItem(chiaveFiltroTipologia(), String(idTipologia));
  filtroTipologiaId = idTipologia;
}

function aggiornaBannerFiltro() {
  const banner = $("#filtro-categoria");
  const nomeEl = $("#filtro-categoria-nome");
  if (!banner || !nomeEl) return;

  if (filtroTipologiaId == null) {
    banner.hidden = true;
    nomeEl.textContent = "";
    return;
  }

  const tip = tipologieCache.find((t) => t.idTipologiaSpesa === filtroTipologiaId);
  nomeEl.textContent = tip?.gruppoSpesa || `#${filtroTipologiaId}`;
  banner.hidden = false;
}

function aggiornaPulsantiStato() {
  root.querySelectorAll(".btn-filtro-stato").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.stato === filtroStato);
  });
}

function aggiornaTotaleComplessivo(lista) {
  const elRip = $("#totale-ripartite");
  const elNon = $("#totale-non-ripartite");
  const piede = $("#piede-spese");
  if (!elRip || !elNon || !piede) return;

  let ripartite = 0;
  let nonRipartite = 0;
  for (const s of lista) {
    const tot = totaleSpesa(s.cifra, s.spesePagamento);
    if (s.haPeriodi) ripartite += tot;
    else nonRipartite += tot;
  }
  elRip.textContent = formatEuro(ripartite);
  elNon.textContent = formatEuro(nonRipartite);
  piede.hidden = lista.length === 0;
}

function messaggioListaVuota() {
  if (filtroTipologiaId != null && filtroStato !== "TUTTE") {
    return "Nessuna spesa per questa categoria con lo stato selezionato.";
  }
  if (filtroTipologiaId != null) {
    return "Nessuna spesa per questa categoria.";
  }
  if (filtroStato === "ATTIVA") {
    return "Nessuna spesa attiva.";
  }
  if (filtroStato === "ARCHIVIATA") {
    return "Nessuna spesa archiviata.";
  }
  return "Nessuna spesa ancora. Clicca «Nuova spesa» per iniziare.";
}

function $(sel) {
  return root.querySelector(sel);
}

function mostraErrore(el, messaggio) {
  if (!el) return;
  if (!messaggio) {
    el.hidden = true;
    el.textContent = "";
    el.style.color = "";
    return;
  }
  el.hidden = false;
  el.style.color = "";
  el.textContent = messaggio;
}

function formatEuro(valore) {
  return Number(valore).toLocaleString("it-IT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatQuota(valore) {
  const n = Number(valore);
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("it-IT", { maximumFractionDigits: 2 });
}

function competenzaValida(valore) {
  if (valore === "PROPRIETARIO" || valore === "ENTRAMBI" || valore === "INQUILINO") {
    return valore;
  }
  return COMPETENZA_DEFAULT;
}

/** Testo breve per la tabella, più una frase per il tooltip. */
function etichettaCompetenza(spesa) {
  const competenza = competenzaValida(spesa?.competenza);
  const quota = Number(spesa?.quotaInquilino);
  const inq = Number.isFinite(quota) ? quota : 100;
  const prop = Math.round((100 - inq) * 100) / 100;

  if (competenza === "PROPRIETARIO") {
    return {
      testo: "Proprietà",
      titolo: "Tutta la spesa è a carico della proprietà.",
    };
  }
  if (competenza === "ENTRAMBI") {
    return {
      testo: `${formatQuota(inq)}% / ${formatQuota(prop)}%`,
      titolo: `Inquilino ${formatQuota(inq)}% · Proprietà ${formatQuota(prop)}%`,
    };
  }
  return {
    testo: "Inquilino",
    titolo: "Tutta la spesa è a carico dell'inquilino.",
  };
}

function aggiornaCampoCompetenza({ scriviQuota = false } = {}) {
  const competenza = competenzaValida($("#competenza")?.value);
  const box = $("#campo-quota-inquilino");
  const input = $("#quota-inquilino");
  const hint = $("#quota-hint");

  if (box) box.hidden = false;
  if (input) {
    const soloLettura = competenza !== "ENTRAMBI";
    input.readOnly = soloLettura;
    input.required = !soloLettura;
    if (competenza === "PROPRIETARIO") {
      input.value = "0";
    } else if (competenza === "INQUILINO") {
      input.value = "100";
    } else if (scriviQuota) {
      input.value = String(quotaEntrambiMemorizzata);
    }
  }
  if (!hint) return;

  hint.hidden = false;
  if (competenza === "PROPRIETARIO") {
    hint.textContent =
      "Tutta la spesa è a carico della proprietà. L'inquilino non paga questa spesa.";
  } else if (competenza === "ENTRAMBI") {
    const inq = Number(quotaEntrambiMemorizzata);
    const quotaInq = Number.isFinite(inq) ? inq : 0;
    const prop = Math.round((100 - quotaInq) * 100) / 100;
    hint.textContent = `L'inquilino paga il ${formatQuota(quotaInq)}%. La proprietà paga il resto: ${formatQuota(prop)}%.`;
  } else {
    hint.textContent = "Tutta la spesa è a carico dell'inquilino (chi occupa l'unità).";
  }
}

function impostaCompetenza(competenza, quotaInquilino) {
  const scelta = competenzaValida(competenza);
  const select = $("#competenza");
  if (select) select.value = scelta;
  if (scelta === "ENTRAMBI") {
    const q = Number(quotaInquilino);
    quotaEntrambiMemorizzata = Number.isFinite(q) ? q : 50;
  } else {
    quotaEntrambiMemorizzata = 50;
  }
  aggiornaCampoCompetenza({ scriviQuota: true });
}

function totaleSpesa(cifra, spesePagamento) {
  return (Number(cifra) || 0) + (Number(spesePagamento) || 0);
}

function aggiornaCampoTotale() {
  const el = $("#totale-spesa");
  if (!el) return;
  el.value = String(
    Math.round(totaleSpesa($("#cifra").value, $("#spese-pagamento").value) * 100) / 100
  );
}

function formatDataIt(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function popolaTipologie(selezionato = null) {
  const select = $("#id-tipologia");
  select.innerHTML = "";

  if (!tipologieCache.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Nessuna categoria disponibile";
    select.appendChild(opt);
    select.disabled = true;
    return;
  }

  select.disabled = false;
  for (const t of tipologieCache) {
    const opt = document.createElement("option");
    opt.value = String(t.idTipologiaSpesa);
    opt.textContent = `${t.gruppoSpesa} (${t.ripartizione})`;
    select.appendChild(opt);
  }
  if (selezionato != null) {
    select.value = String(selezionato);
  }
}

function haBolletta(spesa) {
  return Boolean((spesa?.percorsoAllegato || "").trim());
}

function aggiornaUiAllegato(spesa) {
  const box = $("#allegato-box");
  const hint = $("#allegato-hint");
  const nome = $("#allegato-nome");
  const btnApri = $("#btn-apri-bolletta");
  const btnRimuovi = $("#btn-rimuovi-bolletta");
  if (!box) return;

  if (inModificaId == null) {
    box.hidden = true;
    return;
  }

  box.hidden = false;
  const file = (spesa?.percorsoAllegato || "").trim();
  if (file) {
    if (hint) hint.hidden = true;
    if (nome) {
      nome.hidden = false;
      nome.textContent = `Allegata: ${file}`;
    }
    if (btnApri) btnApri.hidden = false;
    if (btnRimuovi) btnRimuovi.hidden = false;
  } else {
    if (hint) {
      hint.hidden = false;
      hint.textContent =
        "Nessuna bolletta. Clicca «Allega / Sostituisci» per scegliere un PDF. I file stanno nella cartella «…_allegati» accanto al database.";
    }
    if (nome) {
      nome.hidden = true;
      nome.textContent = "";
    }
    if (btnApri) btnApri.hidden = true;
    if (btnRimuovi) btnRimuovi.hidden = true;
  }
}

function apriForm(spesa = null, opzioni = {}) {
  if (!tipologieCache.length) {
    mostraErrore(
      $("#lista-error"),
      "Crea prima almeno una categoria in Categorie spesa."
    );
    return;
  }

  const duplica = Boolean(opzioni.duplica);

  mostraErrore($("#form-error"), "");
  const pannello = $("#pannello-form");
  const titolo = $("#titolo-form");

  if (spesa && !duplica) {
    inModificaId = spesa.idSpesa;
    titolo.textContent = `Modifica spesa #${spesa.idSpesa}`;
    $("#id-spesa").value = String(spesa.idSpesa);
    popolaTipologie(spesa.idTipologia);
    $("#spesa-da").value = spesa.spesaDa;
    $("#spesa-a").value = spesa.spesaA;
    $("#cifra").value = String(spesa.cifra);
    $("#spese-pagamento").value = String(spesa.spesePagamento);
    $("#descrizione").value = spesa.descrizione || "";
    $("#stato").value = spesa.stato || STATO_DEFAULT;
    $("#data-emissione").value = spesa.dataEmissione || "";
    $("#num-fattura").value = spesa.numFattura || "";
    $("#note-spesa").value = spesa.noteSpesa || "";
    $("#gestione").value = spesa.gestione || "";
    impostaCompetenza(spesa.competenza, spesa.quotaInquilino);
    aggiornaCampoTotale();
    aggiornaUiAllegato(spesa);
  } else if (spesa && duplica) {
    inModificaId = null;
    titolo.textContent = `Nuova spesa (copia da #${spesa.idSpesa})`;
    $("#form-spesa").reset();
    $("#id-spesa").value = "";
    popolaTipologie(spesa.idTipologia);
    $("#spesa-da").value = spesa.spesaDa;
    $("#spesa-a").value = spesa.spesaA;
    $("#cifra").value = String(spesa.cifra);
    $("#spese-pagamento").value = String(spesa.spesePagamento);
    $("#descrizione").value = spesa.descrizione || "";
    $("#stato").value = STATO_DEFAULT;
    $("#data-emissione").value = "";
    $("#num-fattura").value = "";
    $("#note-spesa").value = spesa.noteSpesa || "";
    $("#gestione").value = spesa.gestione || "";
    impostaCompetenza(spesa.competenza, spesa.quotaInquilino);
    aggiornaCampoTotale();
    aggiornaUiAllegato(null);
  } else {
    inModificaId = null;
    titolo.textContent = "Nuova spesa";
    $("#form-spesa").reset();
    $("#id-spesa").value = "";
    $("#cifra").value = "0";
    $("#spese-pagamento").value = "0";
    $("#stato").value = STATO_DEFAULT;
    $("#gestione").value = "";
    quotaEntrambiMemorizzata = 50;
    popolaTipologie(filtroTipologiaId);
    impostaCompetenza(COMPETENZA_DEFAULT, 100);
    aggiornaCampoTotale();
    aggiornaUiAllegato(null);
  }

  pannello.hidden = false;

  if (spesa && !duplica) {
    $("#spesa-da").focus();
  } else if (spesa && duplica) {
    $("#spesa-da").focus();
  } else {
    // Nuova spesa: focus sulla tipologia e apre l’elenco (così non si dimentica).
    const selTipologia = $("#id-tipologia");
    selTipologia?.focus();
    try {
      selTipologia?.showPicker?.();
    } catch {
      // showPicker può fallire in alcuni contesti: resta comunque il focus.
    }
  }
}

function chiudiForm() {
  $("#pannello-form").hidden = true;
  inModificaId = null;
  $("#form-spesa").reset();
  $("#stato").value = STATO_DEFAULT;
  aggiornaUiAllegato(null);
  mostraErrore($("#form-error"), "");
}

function leggiForm() {
  return {
    idTipologia: Number($("#id-tipologia").value),
    spesaDa: $("#spesa-da").value,
    spesaA: $("#spesa-a").value,
    cifra: Number($("#cifra").value || 0),
    spesePagamento: Number($("#spese-pagamento").value || 0),
    descrizione: $("#descrizione").value,
    stato: $("#stato").value,
    dataEmissione: $("#data-emissione").value || "",
    numFattura: $("#num-fattura").value,
    noteSpesa: $("#note-spesa").value,
    gestione: $("#gestione").value,
    competenza: competenzaValida($("#competenza").value),
    quotaInquilino:
      $("#competenza").value === "ENTRAMBI"
        ? Number($("#quota-inquilino").value || 0)
        : $("#competenza").value === "PROPRIETARIO"
          ? 0
          : 100,
  };
}

function classeStato(stato) {
  if (stato === "ARCHIVIATA") return "is-archiviata";
  return "is-attiva";
}

/** M = Millesimi, P = Parti (dalla categoria della spesa). */
function siglaMetodo(spesa) {
  const tip = tipologieCache.find((t) => t.idTipologiaSpesa === spesa.idTipologia);
  const rip = tip?.ripartizione || "";
  if (rip === "Millesimi") return { sigla: "M", titolo: "Millesimi" };
  if (rip === "Parti") return { sigla: "P", titolo: "Parti" };
  return { sigla: "—", titolo: "Metodo non impostato" };
}

async function ricaricaLista() {
  mostraErrore($("#lista-error"), "");
  try {
    tipologieCache = await elencoTipologieSpesa();
    filtroTipologiaId = leggiFiltroTipologia();
    aggiornaBannerFiltro();
    aggiornaPulsantiStato();

    let lista = await elencoSpese();
    if (filtroTipologiaId != null) {
      lista = lista.filter((s) => s.idTipologia === filtroTipologiaId);
    }
    if (filtroStato !== "TUTTE") {
      lista = lista.filter((s) => s.stato === filtroStato);
    }

    const corpo = $("#corpo-spese");
    const vuote = $("#spese-vuote");
    const senzaCat = $("#senza-categorie");
    const wrap = $("#tabella-wrap");
    const btnNuovo = $("#btn-nuova-spesa");

    corpo.innerHTML = "";
    btnNuovo.disabled = tipologieCache.length === 0;

    if (!tipologieCache.length) {
      senzaCat.hidden = false;
      vuote.hidden = true;
      wrap.hidden = true;
      aggiornaTotaleComplessivo([]);
      return;
    }
    senzaCat.hidden = true;

    if (!lista.length) {
      vuote.hidden = false;
      vuote.textContent = messaggioListaVuota();
      wrap.hidden = true;
      aggiornaTotaleComplessivo([]);
      return;
    }

    vuote.hidden = true;
    wrap.hidden = false;
    aggiornaTotaleComplessivo(lista);

    for (const s of lista) {
      const tr = document.createElement("tr");
      if (s.haPeriodi) {
        tr.classList.add("has-periodi");
        tr.title = "Ha almeno un periodo di riparto";
      }
      tr.innerHTML = `
        <td>${s.idSpesa}</td>
        <td></td>
        <td></td>
        <td class="col-metodo"></td>
        <td class="num"></td>
        <td class="num"></td>
        <td class="num"></td>
        <td class="num"></td>
        <td><span class="badge-stato"></span></td>
        <td class="col-competenza"></td>
        <td></td>
        <td></td>
        <td class="azioni">
          <button type="button" class="btn-icon btn-modifica" title="Modifica" aria-label="Modifica">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 17.5V20h2.5L18.1 8.4l-2.5-2.5L4 17.5Zm14.7-10.2c.4-.4.4-1 0-1.4l-1.6-1.6a1 1 0 0 0-1.4 0l-1.3 1.3 2.5 2.5 1.8-1.8Z"/>
            </svg>
          </button>
          <button type="button" class="btn-icon btn-duplica" title="Duplica spesa" aria-label="Duplica spesa">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1Zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H8V7h11v14Z"/>
            </svg>
          </button>
          <button type="button" class="btn-icon btn-bolletta ${haBolletta(s) ? "has-allegato" : ""}" title="${haBolletta(s) ? "Apri bolletta PDF" : "Allega bolletta PDF"}" aria-label="Bolletta">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Zm0 2.5L17.5 8H14V4.5ZM8 12h8v1.5H8V12Zm0 3.5h8V17H8v-1.5Zm0-7h5V10H8V8.5Z"/>
            </svg>
          </button>
          <button type="button" class="btn-icon btn-riparto" title="Ripartisci periodi" aria-label="Ripartisci periodi">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm9 0h7v7h-7v-7Z"/>
            </svg>
          </button>
          <button type="button" class="btn-icon btn-elimina" title="Elimina" aria-label="Elimina">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6.7 5.3 12 10.6l5.3-5.3 1.4 1.4L13.4 12l5.3 5.3-1.4 1.4L12 13.4l-5.3 5.3-1.4-1.4L10.6 12 5.3 6.7l1.4-1.4Z"/>
            </svg>
          </button>
        </td>
      `;
      const celle = tr.querySelectorAll("td");
      celle[1].textContent = s.gruppoSpesa;
      celle[1].classList.add("cella-categoria");
      celle[1].title = "Doppio clic: filtra su questa categoria";
      celle[1].addEventListener("dblclick", async () => {
        if (filtroTipologiaId === s.idTipologia) return;
        applicaFiltroTipologia(s.idTipologia);
        await ricaricaLista();
      });
      celle[2].textContent = `${formatDataIt(s.spesaDa)} → ${formatDataIt(s.spesaA)}`;
      const metodo = siglaMetodo(s);
      celle[3].textContent = metodo.sigla;
      celle[3].title = metodo.titolo;
      celle[4].textContent = String(s.giorni ?? "—");
      celle[5].textContent = formatEuro(s.cifra);
      celle[6].textContent = formatEuro(s.spesePagamento);
      celle[7].textContent = formatEuro(totaleSpesa(s.cifra, s.spesePagamento));

      const badge = tr.querySelector(".badge-stato");
      badge.textContent = s.stato;
      const cls = classeStato(s.stato);
      if (cls) badge.classList.add(cls);
      if (s.archiviaParziale) {
        badge.classList.add("is-parziale");
        badge.title = "Alcuni periodi sono archiviati, altri no";
      }

      const competenza = etichettaCompetenza(s);
      celle[9].textContent = competenza.testo;
      celle[9].title = competenza.titolo;
      celle[10].textContent = s.gestione || "—";
      celle[11].textContent = s.descrizione || "—";

      tr.querySelector(".btn-bolletta").addEventListener("click", async () => {
        mostraErrore($("#lista-error"), "");
        try {
          if (haBolletta(s)) {
            await apriBollettaSpesa(s.idSpesa);
          } else {
            await allegaBollettaSpesa(s.idSpesa);
            await ricaricaLista();
            if (inModificaId === s.idSpesa) {
              const aggiornata = (await elencoSpese()).find((x) => x.idSpesa === s.idSpesa);
              if (aggiornata) aggiornaUiAllegato(aggiornata);
            }
          }
        } catch (err) {
          const msg = String(err);
          if (msg.includes("Nessun file selezionato")) return;
          mostraErrore($("#lista-error"), msg);
        }
      });
      tr.querySelector(".btn-riparto").addEventListener("click", () => {
        window.apriRipartoSpesa?.(s.idSpesa);
      });
      tr.querySelector(".btn-modifica").addEventListener("click", () => apriForm(s));
      tr.querySelector(".btn-duplica").addEventListener("click", () => {
        apriForm(s, { duplica: true });
      });
      tr.querySelector(".btn-elimina").addEventListener("click", async () => {
        const ok = await chiediConferma(`Eliminare la spesa #${s.idSpesa}?`);
        if (!ok) return;
        try {
          await eliminaSpesa(s.idSpesa);
          if (inModificaId === s.idSpesa) {
            chiudiForm();
          }
          await ricaricaLista();
        } catch (err) {
          mostraErrore($("#lista-error"), String(err));
        }
      });

      corpo.appendChild(tr);
    }
  } catch (err) {
    mostraErrore($("#lista-error"), String(err));
  }
}

export async function onEnter(pageRoot) {
  root = pageRoot;
  filtroTipologiaId = leggiFiltroTipologia();
  filtroStato = leggiFiltroStato();
  salvaFiltroStato(filtroStato);

  aggiornaPulsanteTornaRiparto();
  $("#btn-torna-ripartizione")?.addEventListener("click", () => {
    const id = Number(sessionStorage.getItem(chiaveDaRiparto()));
    if (!id) return;
    const provenienza =
      sessionStorage.getItem(
        window.STORAGE_RIPARTO_PROVENIENZA || "gestione.ripartoProvenienza"
      ) || "spese";
    window.apriRipartoSpesa?.(id, provenienza);
  });

  $("#btn-nuova-spesa").addEventListener("click", () => apriForm());
  $("#btn-annulla").addEventListener("click", () => chiudiForm());
  $("#cifra").addEventListener("input", aggiornaCampoTotale);
  $("#spese-pagamento").addEventListener("input", aggiornaCampoTotale);
  $("#competenza")?.addEventListener("change", () => {
    aggiornaCampoCompetenza({ scriviQuota: true });
  });
  $("#quota-inquilino")?.addEventListener("input", () => {
    const q = Number($("#quota-inquilino").value);
    if (Number.isFinite(q)) quotaEntrambiMemorizzata = q;
    aggiornaCampoCompetenza();
  });
  $("#btn-togli-filtro")?.addEventListener("click", async () => {
    togliFiltroTipologia();
    await ricaricaLista();
  });

  root.querySelectorAll(".btn-filtro-stato").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const nuovo = btn.dataset.stato;
      if (!nuovo || nuovo === filtroStato) return;
      salvaFiltroStato(nuovo);
      await ricaricaLista();
    });
  });

  $("#form-spesa").addEventListener("submit", async (event) => {
    event.preventDefault();
    mostraErrore($("#form-error"), "");
    const dati = leggiForm();

    try {
      if (inModificaId == null) {
        const creata = await creaSpesa(dati);
        // Resta in modifica così puoi allegare subito la bolletta.
        apriForm(creata);
        mostraErrore($("#form-error"), "");
        const okMsg = $("#form-error");
        if (okMsg) {
          okMsg.hidden = false;
          okMsg.style.color = "var(--accent)";
          okMsg.textContent =
            "Spesa salvata. Ora puoi allegare la bolletta PDF e aprire Riparto per i periodi.";
        }
        await ricaricaLista();
      } else {
        await aggiornaSpesa(inModificaId, dati);
        chiudiForm();
        await ricaricaLista();
      }
    } catch (err) {
      const errEl = $("#form-error");
      if (errEl) errEl.style.color = "";
      mostraErrore($("#form-error"), String(err));
    }
  });

  $("#btn-allega-bolletta")?.addEventListener("click", async () => {
    if (inModificaId == null) return;
    mostraErrore($("#form-error"), "");
    const errEl = $("#form-error");
    if (errEl) errEl.style.color = "";
    try {
      const aggiornata = await allegaBollettaSpesa(inModificaId);
      aggiornaUiAllegato(aggiornata);
      await ricaricaLista();
    } catch (err) {
      const msg = String(err);
      if (msg.includes("Nessun file selezionato")) return;
      mostraErrore($("#form-error"), msg);
    }
  });

  $("#btn-apri-bolletta")?.addEventListener("click", async () => {
    if (inModificaId == null) return;
    mostraErrore($("#form-error"), "");
    try {
      await apriBollettaSpesa(inModificaId);
    } catch (err) {
      mostraErrore($("#form-error"), String(err));
    }
  });

  $("#btn-rimuovi-bolletta")?.addEventListener("click", async () => {
    if (inModificaId == null) return;
    const ok = await chiediConferma("Rimuovere la bolletta allegata?");
    if (!ok) return;
    mostraErrore($("#form-error"), "");
    try {
      const aggiornata = await rimuoviBollettaSpesa(inModificaId);
      aggiornaUiAllegato(aggiornata);
      await ricaricaLista();
    } catch (err) {
      mostraErrore($("#form-error"), String(err));
    }
  });

  await ricaricaLista();

  const keyModifica = window.STORAGE_SPESE_MODIFICA || "gestione.speseModificaId";
  const rawModifica = sessionStorage.getItem(keyModifica);
  sessionStorage.removeItem(keyModifica);
  if (!rawModifica) return;

  const idModifica = Number(rawModifica);
  try {
    const lista = await elencoSpese();
    const daModificare = lista.find((s) => s.idSpesa === idModifica);
    if (daModificare) {
      apriForm(daModificare);
    } else {
      mostraErrore($("#lista-error"), "Spesa non trovata (forse è stata eliminata).");
    }
  } catch (err) {
    mostraErrore($("#lista-error"), String(err));
  }
}

export function onLeave() {
  sessionStorage.removeItem(chiaveDaRiparto());
  root = null;
  inModificaId = null;
  tipologieCache = [];
  filtroTipologiaId = null;
  filtroStato = FILTRO_STATO_DEFAULT;
}
