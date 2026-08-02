import {
  aggiornaSpesa,
  creaSpesa,
  eliminaSpesa,
  elencoSpese,
  elencoTipologieSpesa,
} from "../api.js";
import { chiediConferma } from "../conferma.js";

const STATO_DEFAULT = "ATTIVA";
const FILTRO_STATO_DEFAULT = "ATTIVA";

let root = null;
let inModificaId = null;
let tipologieCache = [];
let filtroTipologiaId = null;
let filtroStato = FILTRO_STATO_DEFAULT;

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
  const el = $("#totale-complessivo");
  const piede = $("#piede-spese");
  if (!el || !piede) return;

  const somma = lista.reduce(
    (acc, s) => acc + totaleSpesa(s.cifra, s.spesePagamento),
    0
  );
  el.textContent = formatEuro(somma);
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

function apriForm(spesa = null) {
  if (!tipologieCache.length) {
    mostraErrore(
      $("#lista-error"),
      "Crea prima almeno una categoria in Categorie spesa."
    );
    return;
  }

  mostraErrore($("#form-error"), "");
  const pannello = $("#pannello-form");
  const titolo = $("#titolo-form");

  if (spesa) {
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
    aggiornaCampoTotale();
  } else {
    inModificaId = null;
    titolo.textContent = "Nuova spesa";
    $("#form-spesa").reset();
    $("#id-spesa").value = "";
    $("#cifra").value = "0";
    $("#spese-pagamento").value = "0";
    $("#stato").value = STATO_DEFAULT;
    $("#gestione").value = "";
    popolaTipologie(filtroTipologiaId);
    aggiornaCampoTotale();
  }

  pannello.hidden = false;
  $("#spesa-da").focus();
}

function chiudiForm() {
  $("#pannello-form").hidden = true;
  inModificaId = null;
  $("#form-spesa").reset();
  $("#stato").value = STATO_DEFAULT;
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
        <td></td>
        <td></td>
        <td class="azioni">
          <button type="button" class="btn-icon btn-riparto" title="Ripartisci periodi" aria-label="Ripartisci periodi">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm9 0h7v7h-7v-7Z"/>
            </svg>
          </button>
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

      celle[9].textContent = s.gestione || "—";
      celle[10].textContent = s.descrizione || "—";

      tr.querySelector(".btn-riparto").addEventListener("click", () => {
        window.apriRipartoSpesa?.(s.idSpesa);
      });
      tr.querySelector(".btn-modifica").addEventListener("click", () => apriForm(s));
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

  $("#btn-nuova-spesa").addEventListener("click", () => apriForm());
  $("#btn-annulla").addEventListener("click", () => chiudiForm());
  $("#cifra").addEventListener("input", aggiornaCampoTotale);
  $("#spese-pagamento").addEventListener("input", aggiornaCampoTotale);
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
        await creaSpesa(dati);
      } else {
        await aggiornaSpesa(inModificaId, dati);
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
  inModificaId = null;
  tipologieCache = [];
  filtroTipologiaId = null;
  filtroStato = FILTRO_STATO_DEFAULT;
}
