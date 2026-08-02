import {
  apriCondominio,
  creaCondominio,
  elencoRecenti,
  rimuoviRecente,
  scegliPercorsoApertura,
  scegliPercorsoSalvataggio,
} from "./api.js";
import { controllaAggiornamenti } from "./aggiornamenti.js";

const listaRecenti = document.querySelector("#lista-recenti");
const recentiVuoti = document.querySelector("#recenti-vuoti");
const homeError = document.querySelector("#home-error");
const dialogNuovo = document.querySelector("#dialog-nuovo");
const formNuovo = document.querySelector("#form-nuovo");
const inputNome = document.querySelector("#input-nome");
const dialogError = document.querySelector("#dialog-error");

function mostraErrore(el, messaggio) {
  if (!messaggio) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.textContent = messaggio;
}

function vaiAllApp() {
  window.location.href = "./app.html";
}

function nomeFileSicuro(nome) {
  return nome
    .trim()
    .replace(/[<>:"/\\|?*]+/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 80) || "Condominio";
}

async function caricaRecenti() {
  try {
    const recenti = await elencoRecenti();
    listaRecenti.innerHTML = "";

    if (!recenti.length) {
      recentiVuoti.hidden = false;
      return;
    }

    recentiVuoti.hidden = true;

    for (const item of recenti) {
      const li = document.createElement("li");
      li.className = "recente-item";
      li.innerHTML = `
        <div>
          <p class="recente-nome"></p>
          <p class="recente-path"></p>
        </div>
        <div class="recente-azioni">
          <button type="button" class="btn btn-secondary btn-apri-recente">Apri</button>
          <button type="button" class="btn btn-ghost btn-rimuovi-recente" title="Togli dai recenti">✕</button>
        </div>
      `;
      li.querySelector(".recente-nome").textContent = item.nome;
      li.querySelector(".recente-path").textContent = item.percorso;

      li.querySelector(".btn-apri-recente").addEventListener("click", async () => {
        try {
          mostraErrore(homeError, "");
          await apriCondominio(item.percorso);
          vaiAllApp();
        } catch (err) {
          mostraErrore(homeError, String(err));
        }
      });

      li.querySelector(".btn-rimuovi-recente").addEventListener("click", async () => {
        try {
          await rimuoviRecente(item.percorso);
          await caricaRecenti();
        } catch (err) {
          mostraErrore(homeError, String(err));
        }
      });

      listaRecenti.appendChild(li);
    }
  } catch (err) {
    mostraErrore(homeError, String(err));
  }
}

document.querySelector("#btn-nuovo").addEventListener("click", () => {
  mostraErrore(dialogError, "");
  inputNome.value = "";
  dialogNuovo.showModal();
  inputNome.focus();
});

document.querySelector("#btn-annulla-nuovo").addEventListener("click", () => {
  dialogNuovo.close();
});

formNuovo.addEventListener("submit", async (event) => {
  event.preventDefault();
  mostraErrore(dialogError, "");

  const nome = inputNome.value.trim();
  if (!nome) {
    mostraErrore(dialogError, "Inserisci un nome.");
    return;
  }

  try {
    const percorso = await scegliPercorsoSalvataggio(nomeFileSicuro(nome));
    if (!percorso) {
      return;
    }
    await creaCondominio(percorso, nome);
    dialogNuovo.close();
    vaiAllApp();
  } catch (err) {
    mostraErrore(dialogError, String(err));
  }
});

document.querySelector("#btn-apri").addEventListener("click", async () => {
  try {
    mostraErrore(homeError, "");
    const percorso = await scegliPercorsoApertura();
    if (!percorso) {
      return;
    }
    await apriCondominio(percorso);
    vaiAllApp();
  } catch (err) {
    mostraErrore(homeError, String(err));
  }
});

caricaRecenti();
controllaAggiornamenti();
