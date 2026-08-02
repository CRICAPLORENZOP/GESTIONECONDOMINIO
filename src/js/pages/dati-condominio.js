import {
  aggiornaCondominio,
  apriCartellaDatabase,
  elencoUnita,
  statoCondominio,
} from "../api.js";

export async function onEnter(root) {
  const info = await statoCondominio();
  if (!info) {
    window.location.href = "index.html";
    return;
  }

  const riepilogoNome = root.querySelector("#dc-riepilogo-nome");
  const riepilogoUnita = root.querySelector("#dc-riepilogo-unita");
  const idEl = root.querySelector("#dc-id-condominio");
  const nomeEl = root.querySelector("#dc-nome-condominio");
  const noteEl = root.querySelector("#dc-note-condominio");
  const percorsoEl = root.querySelector("#dc-info-percorso");
  const errEl = root.querySelector("#form-condominio-error");
  const okEl = root.querySelector("#form-condominio-ok");
  const form = root.querySelector("#form-condominio");
  const btnModifica = root.querySelector("#btn-modifica-anagrafica");
  const btnAnnulla = root.querySelector("#btn-annulla-anagrafica");
  const azioniModifica = root.querySelector("#dc-azioni-modifica");
  const btnApriCartella = root.querySelector("#btn-apri-cartella-db");
  const fileErrEl = root.querySelector("#dc-file-error");

  let snapshotNome = info.nomeCondominio;
  let snapshotNote = info.noteCondominio || "";
  let inModifica = false;

  function aggiornaRiepilogo(nome) {
    if (riepilogoNome) {
      riepilogoNome.textContent = `Stai lavorando su: ${nome}`;
    }
  }

  function setModalitaModifica(attiva) {
    inModifica = attiva;
    nomeEl.readOnly = !attiva;
    noteEl.readOnly = !attiva;
    form.classList.toggle("is-editing", attiva);
    if (btnModifica) btnModifica.hidden = attiva;
    if (azioniModifica) azioniModifica.hidden = !attiva;
    errEl.hidden = true;
    okEl.hidden = true;
  }

  function ripristinaSnapshot() {
    nomeEl.value = snapshotNome;
    noteEl.value = snapshotNote;
  }

  aggiornaRiepilogo(info.nomeCondominio);
  idEl.value = String(info.idCondominio);
  nomeEl.value = snapshotNome;
  noteEl.value = snapshotNote;
  percorsoEl.textContent = info.percorso;
  setModalitaModifica(false);

  try {
    const unita = await elencoUnita();
    riepilogoUnita.textContent =
      unita.length === 1
        ? "C’è 1 unità immobiliare."
        : `Ci sono ${unita.length} unità immobiliari.`;
  } catch {
    riepilogoUnita.textContent = "";
  }

  btnModifica?.addEventListener("click", () => {
    setModalitaModifica(true);
    nomeEl.focus();
  });

  btnAnnulla?.addEventListener("click", () => {
    ripristinaSnapshot();
    setModalitaModifica(false);
  });

  btnApriCartella?.addEventListener("click", async () => {
    if (fileErrEl) {
      fileErrEl.hidden = true;
      fileErrEl.textContent = "";
    }
    try {
      await apriCartellaDatabase();
    } catch (err) {
      if (fileErrEl) {
        fileErrEl.hidden = false;
        fileErrEl.textContent = String(err);
      }
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!inModifica) return;

    errEl.hidden = true;
    okEl.hidden = true;

    try {
      const aggiornato = await aggiornaCondominio(nomeEl.value, noteEl.value);
      snapshotNome = aggiornato.nomeCondominio;
      snapshotNote = aggiornato.noteCondominio || "";
      ripristinaSnapshot();
      aggiornaRiepilogo(aggiornato.nomeCondominio);

      const sidebarNome = document.querySelector("#nome-condominio");
      if (sidebarNome) {
        sidebarNome.textContent = aggiornato.nomeCondominio;
      }
      document.title = `${aggiornato.nomeCondominio} — Gestione Condominio`;
      okEl.hidden = false;
      setModalitaModifica(false);
    } catch (err) {
      errEl.hidden = false;
      errEl.textContent = String(err);
    }
  });
}

export function onLeave() {}
