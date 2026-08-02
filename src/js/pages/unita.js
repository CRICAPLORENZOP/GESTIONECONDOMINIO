import {
  aggiornaUnita,
  creaUnita,
  eliminaUnita,
  elencoOccupanti,
  elencoUnita,
} from "../api.js";
import { chiediConferma } from "../conferma.js";

const USO_DEFAULT = "ABITAZIONE";

let root = null;
let inModificaId = null;

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

function formatMillesimi(valore) {
  return Number(valore).toLocaleString("it-IT", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

function oggiIso() {
  return new Date().toISOString().slice(0, 10);
}

function isAttuale(o) {
  if (!o.dataFine) {
    return true;
  }
  return o.dataFine >= oggiIso();
}

/** Trova l'occupante attuale di un'unità (il più recente se ce ne fossero più di uno). */
function occupanteAttualePerUnita(occupanti, idUnita) {
  const attuali = occupanti
    .filter((o) => o.idUnita === idUnita && isAttuale(o))
    .sort((a, b) => (a.dataInizio < b.dataInizio ? 1 : -1));
  return attuali[0] || null;
}

function testoOccupante(o) {
  const pezzi = [o.nominativo];
  pezzi.push(
    `${o.numComponenti} component${o.numComponenti === 1 ? "e" : "i"}`
  );
  const perc = Number(o.percentuale);
  if (Number.isFinite(perc) && perc > 0) {
    pezzi.push(`${perc}%`);
  }
  if (o.noteOccupante) {
    pezzi.push(o.noteOccupante);
  }
  return pezzi.join(" · ");
}

function apriForm(unita = null) {
  const pannello = $("#pannello-form");
  const titolo = $("#titolo-form");
  mostraErrore($("#form-error"), "");

  if (unita) {
    inModificaId = unita.idUnita;
    titolo.textContent = `Modifica unità #${unita.idUnita}`;
    $("#id-unita").value = String(unita.idUnita);
    $("#proprieta").value = unita.proprieta;
    $("#identificativo").value = unita.identificativo || "";
    $("#subalterno").value = unita.subalterno || "";
    $("#piano").value = unita.piano;
    $("#millesimi").value = String(unita.millesimi);
    $("#uso").value = unita.uso || USO_DEFAULT;
    $("#note-unita").value = unita.noteUnita;
  } else {
    inModificaId = null;
    titolo.textContent = "Nuova unità";
    $("#form-unita").reset();
    $("#id-unita").value = "";
    $("#millesimi").value = "0";
    $("#uso").value = USO_DEFAULT;
  }

  pannello.hidden = false;
  $("#proprieta").focus();
}

function chiudiForm() {
  $("#pannello-form").hidden = true;
  inModificaId = null;
  $("#form-unita").reset();
  $("#uso").value = USO_DEFAULT;
  mostraErrore($("#form-error"), "");
}

function leggiForm() {
  return {
    proprieta: $("#proprieta").value,
    identificativo: $("#identificativo").value,
    subalterno: $("#subalterno").value,
    piano: $("#piano").value,
    millesimi: Number($("#millesimi").value || 0),
    uso: $("#uso").value,
    noteUnita: $("#note-unita").value,
  };
}

async function ricaricaLista() {
  mostraErrore($("#lista-error"), "");
  try {
    const [lista, occupanti] = await Promise.all([
      elencoUnita(),
      elencoOccupanti(),
    ]);
    const corpo = $("#corpo-unita");
    const vuote = $("#unita-vuote");
    const wrap = $("#tabella-wrap");
    corpo.innerHTML = "";

    if (!lista.length) {
      vuote.hidden = false;
      wrap.hidden = true;
      return;
    }

    vuote.hidden = true;
    wrap.hidden = false;

    for (const u of lista) {
      const attuale = occupanteAttualePerUnita(occupanti, u.idUnita);

      const trDati = document.createElement("tr");
      trDati.className = "riga-unita-dati";
      trDati.innerHTML = `
        <td rowspan="2" class="cella-id">${u.idUnita}</td>
        <td rowspan="2" class="cella-proprieta">
          <div class="proprieta-nome"></div>
          <div class="proprieta-occupante"></div>
        </td>
        <td></td>
        <td></td>
        <td></td>
        <td class="num"></td>
        <td></td>
        <td rowspan="2" class="azioni">
          <button type="button" class="btn-icon btn-occupanti" title="Occupanti" aria-label="Occupanti">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8.5 13a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm7 0a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2.5 19.5c0-2.6 2.4-4.5 6-4.5s6 1.9 6 4.5V20H2.5v-.5Zm11.2 0c.4-1.5 1.5-2.7 3-3.4.9-.4 1.9-.6 2.8-.6 3.1 0 5 1.7 5 4V20h-10.8v-.5Z"/>
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

      const celle = trDati.querySelectorAll("td");
      // td: 0=id, 1=proprieta, 2=ident, 3=sub, 4=piano, 5=mill, 6=uso, 7=azioni
      trDati.querySelector(".proprieta-nome").textContent = u.proprieta;

      const occEl = trDati.querySelector(".proprieta-occupante");
      if (attuale) {
        occEl.textContent = testoOccupante(attuale);
        occEl.classList.add("has-occupante");
      } else {
        occEl.textContent = "Nessun occupante attuale";
        occEl.classList.add("senza-occupante");
      }

      celle[2].textContent = u.identificativo || "—";
      celle[3].textContent = u.subalterno || "—";
      celle[4].textContent = u.piano || "—";
      celle[5].textContent = formatMillesimi(u.millesimi);
      celle[6].textContent = u.uso || USO_DEFAULT;

      const trNote = document.createElement("tr");
      trNote.className = "riga-unita-note";
      trNote.innerHTML = `
        <td colspan="5" class="cella-note-unita">
          <span class="note-label">Note</span>
          <span class="note-testo"></span>
        </td>
      `;
      const noteTesto = trNote.querySelector(".note-testo");
      noteTesto.textContent = u.noteUnita ? u.noteUnita : "—";
      if (!u.noteUnita) {
        noteTesto.classList.add("note-vuota");
      }

      trDati.querySelector(".btn-occupanti").addEventListener("click", () => {
        if (typeof window.apriOccupantiPerUnita === "function") {
          window.apriOccupantiPerUnita(u.idUnita);
        }
      });
      trDati.querySelector(".btn-modifica").addEventListener("click", () => apriForm(u));
      trDati.querySelector(".btn-elimina").addEventListener("click", async () => {
        const ok = await chiediConferma(
          `Eliminare l'unità «${u.proprieta}» (ID ${u.idUnita})?`
        );
        if (!ok) return;
        try {
          await eliminaUnita(u.idUnita);
          if (inModificaId === u.idUnita) {
            chiudiForm();
          }
          await ricaricaLista();
        } catch (err) {
          mostraErrore($("#lista-error"), String(err));
        }
      });

      corpo.appendChild(trDati);
      corpo.appendChild(trNote);
    }
  } catch (err) {
    mostraErrore($("#lista-error"), String(err));
  }
}

export async function onEnter(pageRoot) {
  root = pageRoot;

  $("#btn-nuova-unita").addEventListener("click", () => apriForm());
  $("#btn-annulla-unita").addEventListener("click", () => chiudiForm());

  $("#form-unita").addEventListener("submit", async (event) => {
    event.preventDefault();
    mostraErrore($("#form-error"), "");
    const dati = leggiForm();

    try {
      if (inModificaId == null) {
        await creaUnita(dati);
      } else {
        await aggiornaUnita(inModificaId, dati);
      }
      chiudiForm();
      await ricaricaLista();
    } catch (err) {
      mostraErrore($("#form-error"), String(err));
    }
  });

  await ricaricaLista();

  const keyModifica =
    window.STORAGE_UNITA_MODIFICA || "gestione.unitaModificaId";
  const rawModifica = sessionStorage.getItem(keyModifica);
  sessionStorage.removeItem(keyModifica);
  if (rawModifica) {
    const idModifica = Number(rawModifica);
    try {
      const lista = await elencoUnita();
      const daModificare = lista.find((u) => u.idUnita === idModifica);
      if (daModificare) {
        apriForm(daModificare);
      } else {
        mostraErrore(
          $("#lista-error"),
          "Unità non trovata (forse è stata eliminata)."
        );
      }
    } catch (err) {
      mostraErrore($("#lista-error"), String(err));
    }
  }
}

export function onLeave() {
  root = null;
  inModificaId = null;
}
