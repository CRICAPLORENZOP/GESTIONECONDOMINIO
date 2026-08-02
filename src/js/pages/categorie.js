import {
  aggiornaTipologiaSpesa,
  creaTipologiaSpesa,
  eliminaTipologiaSpesa,
  elencoTipologieSpesa,
} from "../api.js";
import { chiediConferma } from "../conferma.js";

const RIPARTIZIONE_DEFAULT = "Millesimi";

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

function apriForm(voce = null) {
  const pannello = $("#pannello-form");
  const titolo = $("#titolo-form");
  mostraErrore($("#form-error"), "");

  if (voce) {
    inModificaId = voce.idTipologiaSpesa;
    titolo.textContent = `Modifica categoria #${voce.idTipologiaSpesa}`;
    $("#id-tipologia").value = String(voce.idTipologiaSpesa);
    $("#gruppo-spesa").value = voce.gruppoSpesa;
    $("#ripartizione").value =
      voce.ripartizione === "Percentuale"
        ? "Parti"
        : voce.ripartizione || RIPARTIZIONE_DEFAULT;
    $("#note-tipologia").value = voce.noteTipologiaSpesa || "";
  } else {
    inModificaId = null;
    titolo.textContent = "Nuova categoria";
    $("#form-tipologia").reset();
    $("#id-tipologia").value = "";
    $("#ripartizione").value = RIPARTIZIONE_DEFAULT;
  }

  pannello.hidden = false;
  $("#gruppo-spesa").focus();
}

function chiudiForm() {
  $("#pannello-form").hidden = true;
  inModificaId = null;
  $("#form-tipologia").reset();
  $("#ripartizione").value = RIPARTIZIONE_DEFAULT;
  mostraErrore($("#form-error"), "");
}

function leggiForm() {
  return {
    gruppoSpesa: $("#gruppo-spesa").value,
    ripartizione: $("#ripartizione").value,
    noteTipologiaSpesa: $("#note-tipologia").value,
  };
}

async function ricaricaLista() {
  mostraErrore($("#lista-error"), "");
  try {
    const lista = await elencoTipologieSpesa();
    const corpo = $("#corpo-categorie");
    const vuote = $("#categorie-vuote");
    const wrap = $("#tabella-wrap");
    corpo.innerHTML = "";

    if (!lista.length) {
      vuote.hidden = false;
      wrap.hidden = true;
      return;
    }

    vuote.hidden = true;
    wrap.hidden = false;

    for (const voce of lista) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${voce.idTipologiaSpesa}</td>
        <td></td>
        <td></td>
        <td></td>
        <td class="azioni">
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
      celle[1].textContent = voce.gruppoSpesa;
      celle[2].textContent = voce.ripartizione;
      celle[3].textContent = voce.noteTipologiaSpesa || "—";

      tr.classList.add("riga-cliccabile");
      tr.title = "Doppio clic: apri le spese di questa categoria";
      tr.addEventListener("dblclick", (event) => {
        if (event.target.closest("button")) return;
        window.apriSpesePerCategoria?.(voce.idTipologiaSpesa);
      });

      tr.querySelector(".btn-modifica").addEventListener("click", () => apriForm(voce));
      tr.querySelector(".btn-elimina").addEventListener("click", async () => {
        const ok = await chiediConferma(
          `Eliminare la categoria «${voce.gruppoSpesa}»?`
        );
        if (!ok) return;
        try {
          await eliminaTipologiaSpesa(voce.idTipologiaSpesa);
          if (inModificaId === voce.idTipologiaSpesa) {
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

  $("#btn-nuova-tipologia").addEventListener("click", () => apriForm());
  $("#btn-annulla").addEventListener("click", () => chiudiForm());

  $("#form-tipologia").addEventListener("submit", async (event) => {
    event.preventDefault();
    mostraErrore($("#form-error"), "");
    const dati = leggiForm();

    try {
      if (inModificaId == null) {
        await creaTipologiaSpesa(dati);
      } else {
        await aggiornaTipologiaSpesa(inModificaId, dati);
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
}
