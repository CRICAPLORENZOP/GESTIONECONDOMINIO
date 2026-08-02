import {
  aggiornaOccupante,
  creaOccupante,
  eliminaOccupante,
  elencoOccupanti,
  elencoUnita,
} from "../api.js";
import { chiediConferma } from "../conferma.js";

let root = null;
let inModificaId = null;
let idUnitaCorrente = null;
let unitaCorrente = null;

function $(sel) {
  return root.querySelector(sel);
}

function storageKey() {
  return window.STORAGE_OCCUPANTI_UNITA || "gestione.occupantiUnitaId";
}

function storageKeyModifica() {
  return window.STORAGE_OCCUPANTI_MODIFICA || "gestione.occupantiModificaId";
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

function oggiIso() {
  return new Date().toISOString().slice(0, 10);
}

/** Occupante attuale = senza data fine, oppure data fine ancora nel futuro/oggi. */
function isAttuale(o) {
  if (!o.dataFine) {
    return true;
  }
  return o.dataFine >= oggiIso();
}

function formatDataIt(iso) {
  if (!iso) return "in corso";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function formatPercentuale(valore) {
  const n = Number(valore);
  if (!Number.isFinite(n)) return "0";
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}

function etichettaUnita(u) {
  const pezzi = [u.proprieta];
  if (u.identificativo) {
    pezzi.push(`Identificativo ${u.identificativo}`);
  }
  if (u.subalterno) {
    pezzi.push(`Sub. ${u.subalterno}`);
  }
  return pezzi.join(" · ");
}

function apriForm(occupante = null) {
  mostraErrore($("#form-error"), "");
  const pannello = $("#pannello-form");
  const titolo = $("#titolo-form");

  $("#id-unita").value = String(idUnitaCorrente);

  if (occupante) {
    inModificaId = occupante.idOccupante;
    titolo.textContent = `Modifica occupante #${occupante.idOccupante}`;
    $("#id-occupante").value = String(occupante.idOccupante);
    $("#nominativo").value = occupante.nominativo;
    $("#data-inizio").value = occupante.dataInizio;
    $("#data-fine").value = occupante.dataFine || "";
    $("#num-componenti").value = String(occupante.numComponenti);
    $("#percentuale").value = String(occupante.percentuale ?? 0);
    $("#note-occupante").value = occupante.noteOccupante || "";
  } else {
    inModificaId = null;
    titolo.textContent = "Nuovo occupante";
    $("#form-occupante").reset();
    $("#id-occupante").value = "";
    $("#id-unita").value = String(idUnitaCorrente);
    $("#num-componenti").value = "1";
    $("#percentuale").value = "100";
  }

  pannello.hidden = false;
  $("#nominativo").focus();
}

function chiudiForm() {
  $("#pannello-form").hidden = true;
  inModificaId = null;
  $("#form-occupante").reset();
  $("#id-unita").value = String(idUnitaCorrente || "");
  mostraErrore($("#form-error"), "");
}

function leggiForm() {
  return {
    idUnita: Number($("#id-unita").value),
    nominativo: $("#nominativo").value,
    dataInizio: $("#data-inizio").value,
    dataFine: $("#data-fine").value || "",
    numComponenti: Number($("#num-componenti").value || 1),
    percentuale: Number($("#percentuale").value || 0),
    noteOccupante: $("#note-occupante").value,
  };
}

function renderAttuale(attuale) {
  const box = $("#box-attuale");
  box.innerHTML = "";

  if (!attuale) {
    box.innerHTML = `<p class="attuale-vuoto">Nessun occupante attuale. Aggiungine uno con «Nuovo occupante».</p>`;
    return;
  }

  const wrap = document.createElement("div");
  wrap.className = "attuale-card";
  wrap.innerHTML = `
    <p class="attuale-nome"></p>
    <p class="attuale-meta"></p>
    <p class="attuale-meta note"></p>
    <div class="attuale-azioni">
      <button type="button" class="btn btn-secondary btn-modifica">Modifica</button>
      <button type="button" class="btn btn-danger btn-elimina">Elimina</button>
    </div>
  `;
  wrap.querySelector(".attuale-nome").textContent = attuale.nominativo;
  wrap.querySelector(".attuale-meta").textContent =
    `Dal ${formatDataIt(attuale.dataInizio)}` +
    (attuale.dataFine ? ` al ${formatDataIt(attuale.dataFine)}` : " — in corso") +
    ` · ${attuale.numComponenti} component${attuale.numComponenti === 1 ? "e" : "i"}` +
    ` · ${formatPercentuale(attuale.percentuale)}%`;
  wrap.querySelector(".note").textContent = attuale.noteOccupante
    ? `Note: ${attuale.noteOccupante}`
    : "";

  wrap.querySelector(".btn-modifica").addEventListener("click", () => apriForm(attuale));
  wrap.querySelector(".btn-elimina").addEventListener("click", async () => {
    const ok = await chiediConferma(`Eliminare l’occupazione di «${attuale.nominativo}»?`);
    if (!ok) return;
    try {
      await eliminaOccupante(attuale.idOccupante);
      if (inModificaId === attuale.idOccupante) {
        chiudiForm();
      }
      await ricarica();
    } catch (err) {
      mostraErrore($("#pagina-error"), String(err));
    }
  });

  box.appendChild(wrap);
}

function renderPrecedenti(lista) {
  const corpo = $("#corpo-precedenti");
  const vuoti = $("#precedenti-vuoti");
  const wrap = $("#tabella-precedenti-wrap");
  corpo.innerHTML = "";

  if (!lista.length) {
    vuoti.hidden = false;
    wrap.hidden = true;
    return;
  }

  vuoti.hidden = true;
  wrap.hidden = false;

  for (const o of lista) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td></td>
      <td></td>
      <td></td>
      <td class="num"></td>
      <td class="num"></td>
      <td></td>
      <td class="azioni">
        <button type="button" class="btn btn-secondary btn-modifica">Modifica</button>
        <button type="button" class="btn btn-danger btn-elimina">Elimina</button>
      </td>
    `;
    const celle = tr.querySelectorAll("td");
    celle[0].textContent = o.nominativo;
    celle[1].textContent = formatDataIt(o.dataInizio);
    celle[2].textContent = formatDataIt(o.dataFine);
    celle[3].textContent = String(o.numComponenti);
    celle[4].textContent = formatPercentuale(o.percentuale);
    celle[5].textContent = o.noteOccupante || "—";

    tr.querySelector(".btn-modifica").addEventListener("click", () => apriForm(o));
    tr.querySelector(".btn-elimina").addEventListener("click", async () => {
      const ok = await chiediConferma(`Eliminare l’occupazione di «${o.nominativo}»?`);
      if (!ok) return;
      try {
        await eliminaOccupante(o.idOccupante);
        if (inModificaId === o.idOccupante) {
          chiudiForm();
        }
        await ricarica();
      } catch (err) {
        mostraErrore($("#pagina-error"), String(err));
      }
    });

    corpo.appendChild(tr);
  }
}

async function ricarica() {
  mostraErrore($("#pagina-error"), "");
  const tutti = await elencoOccupanti();
  const dellaUnita = tutti.filter((o) => o.idUnita === idUnitaCorrente);

  const attuali = dellaUnita.filter(isAttuale);
  attuali.sort((a, b) => (a.dataInizio < b.dataInizio ? 1 : -1));
  const attuale = attuali[0] || null;

  const soloPrecedenti = dellaUnita
    .filter((o) => !attuale || o.idOccupante !== attuale.idOccupante)
    .sort((a, b) => (a.dataInizio < b.dataInizio ? 1 : -1));

  renderAttuale(attuale);
  renderPrecedenti(soloPrecedenti);

  return { attuale, soloPrecedenti, dellaUnita };
}

export async function onEnter(pageRoot) {
  root = pageRoot;
  mostraErrore($("#pagina-error"), "");

  const rawId = sessionStorage.getItem(storageKey());
  idUnitaCorrente = rawId ? Number(rawId) : null;

  if (!idUnitaCorrente) {
    $("#titolo-occupanti").textContent = "Occupanti";
    $("#sottotitolo-unita").textContent =
      "Apri questa schermata dal pulsante Occupanti nella lista Unità.";
    $("#btn-nuovo-occupante").disabled = true;
    $("#box-attuale").innerHTML =
      `<p class="attuale-vuoto">Nessuna unità selezionata.</p>`;
    $("#precedenti-vuoti").hidden = false;
    $("#tabella-precedenti-wrap").hidden = true;

    $("#btn-torna-unita").addEventListener("click", () => {
      window.mostraPaginaApp?.("unita");
    });
    return;
  }

  const unita = await elencoUnita();
  unitaCorrente = unita.find((u) => u.idUnita === idUnitaCorrente) || null;

  if (!unitaCorrente) {
    sessionStorage.removeItem(storageKey());
    mostraErrore($("#pagina-error"), "Unità non trovata.");
    $("#btn-nuovo-occupante").disabled = true;
    $("#btn-torna-unita").addEventListener("click", () => {
      window.mostraPaginaApp?.("unita");
    });
    return;
  }

  $("#titolo-occupanti").textContent = `Occupanti — ${unitaCorrente.proprieta}`;
  $("#sottotitolo-unita").textContent = etichettaUnita(unitaCorrente);
  $("#id-unita").value = String(idUnitaCorrente);

  $("#btn-torna-unita").addEventListener("click", () => {
    sessionStorage.removeItem(storageKey());
    window.mostraPaginaApp?.("unita");
  });

  $("#btn-nuovo-occupante").addEventListener("click", () => apriForm());
  $("#btn-annulla").addEventListener("click", () => chiudiForm());

  $("#form-occupante").addEventListener("submit", async (event) => {
    event.preventDefault();
    mostraErrore($("#form-error"), "");
    const dati = leggiForm();

    try {
      if (inModificaId == null) {
        await creaOccupante(dati);
      } else {
        await aggiornaOccupante(inModificaId, dati);
      }
      chiudiForm();
      await ricarica();
    } catch (err) {
      mostraErrore($("#form-error"), String(err));
    }
  });

  await ricarica();

  // Se arriviamo da Riparto (doppio clic), apri subito la modifica.
  const rawModifica = sessionStorage.getItem(storageKeyModifica());
  sessionStorage.removeItem(storageKeyModifica());
  if (rawModifica) {
    const idModifica = Number(rawModifica);
    const tutti = await elencoOccupanti();
    const daModificare = tutti.find(
      (o) => o.idOccupante === idModifica && o.idUnita === idUnitaCorrente
    );
    if (daModificare) {
      apriForm(daModificare);
    } else {
      mostraErrore(
        $("#pagina-error"),
        "Occupante non trovato su questa unità (forse è stato eliminato)."
      );
    }
  }
}

export function onLeave() {
  root = null;
  inModificaId = null;
  idUnitaCorrente = null;
  unitaCorrente = null;
}
