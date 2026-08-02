import { chiudiCondominio, statoCondominio } from "./api.js";
import { chiediConferma } from "./conferma.js";
import { controllaAggiornamenti } from "./aggiornamenti.js";

const STORAGE_OCCUPANTI_UNITA = "gestione.occupantiUnitaId";
const STORAGE_OCCUPANTI_MODIFICA = "gestione.occupantiModificaId";
const STORAGE_UNITA_MODIFICA = "gestione.unitaModificaId";
const STORAGE_RIPARTO_SPESA = "gestione.ripartoSpesaId";
const STORAGE_RIPARTO_PROVENIENZA = "gestione.ripartoProvenienza";
const STORAGE_SPESE_FILTRO_TIPLOGIA = "gestione.speseFiltroTipologiaId";
const STORAGE_SPESE_FILTRO_STATO = "gestione.speseFiltroStato";
const STORAGE_ARCHIVIO_RENDICONTO = "gestione.archivioRendicontoDel";

let cssCaricato = null;
let moduloPagina = null;

const PAGINE = {
  "dati-condominio": {
    html: "./pages/dati-condominio.html",
    css: "./css/pages/dati-condominio.css",
    js: "./pages/dati-condominio.js",
  },
  unita: {
    html: "./pages/unita.html",
    css: "./css/pages/unita.css",
    js: "./pages/unita.js",
  },
  occupazioni: {
    html: "./pages/occupazioni.html",
    css: "./css/pages/occupazioni.css",
    js: "./pages/occupazioni.js",
  },
  categorie: {
    html: "./pages/categorie.html",
    css: "./css/pages/categorie.css",
    js: "./pages/categorie.js",
  },
  spese: {
    html: "./pages/spese.html",
    css: "./css/pages/spese.css",
    js: "./pages/spese.js",
  },
  riparto: {
    html: "./pages/riparto.html",
    css: "./css/pages/riparto.css",
    js: "./pages/riparto.js",
  },
  report: {
    html: "./pages/report.html",
    css: "./css/pages/report.css",
    js: "./pages/report.js",
  },
  "archivio-rendiconti": {
    html: "./pages/archivio-rendiconti.html",
    css: "./css/pages/archivio-rendiconti.css",
    js: "./pages/archivio-rendiconti.js",
  },
  "archivio-ripartizione": {
    html: "./pages/archivio-ripartizione.html",
    css: "./css/pages/archivio-ripartizione.css",
    js: "./pages/archivio-ripartizione.js",
  },
  ripartizione: {
    html: "./pages/ripartizione.html",
    css: "./css/pages/ripartizione.css",
    js: "./pages/ripartizione.js",
  },
  riepilogo: {
    html: "./pages/riepilogo.html",
    css: "./css/pages/riepilogo.css",
    js: "./pages/riepilogo.js",
  },
};

function pageRootEl() {
  return document.querySelector("#page-root");
}

function mostraErroreAvvio(err) {
  const pageRoot = pageRootEl();
  const testo = err instanceof Error ? err.message : String(err);
  if (pageRoot) {
    pageRoot.innerHTML = `<p style="color:#9b2c2c">${testo}</p>`;
  }
}

function caricaCss(href) {
  if (cssCaricato) {
    cssCaricato.remove();
    cssCaricato = null;
  }
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
  cssCaricato = link;
}

async function attendiTauri(maxMs = 4000) {
  const inizio = Date.now();
  while (Date.now() - inizio < maxMs) {
    if (window.__TAURI__?.core?.invoke) {
      return;
    }
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error(
    "Tauri non è disponibile. Chiudi l’app e rilanciala con: npm run tauri dev"
  );
}

async function conTimeout(promessa, ms, messaggio) {
  let timer;
  try {
    return await Promise.race([
      promessa,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(messaggio)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function mostraPagina(nome) {
  const pagina = PAGINE[nome];
  if (!pagina) {
    return;
  }

  const pageRoot = pageRootEl();
  if (!pageRoot) {
    throw new Error("Elemento #page-root non trovato.");
  }

  const navItems = document.querySelectorAll(".nav-item");
  navItems.forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.page === nome);
  });

  // Occupanti non e' nel menu: Unita resta il contesto
  if (nome === "occupazioni") {
    navItems.forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.page === "unita");
    });
  }
  if (nome === "riparto") {
    navItems.forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.page === "spese");
    });
  }
  if (nome === "archivio-ripartizione") {
    navItems.forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.page === "archivio-rendiconti");
    });
  }

  const risposta = await fetch(pagina.html);
  if (!risposta.ok) {
    pageRoot.innerHTML = `<p class="muted">Impossibile caricare la pagina (${pagina.html}).</p>`;
    return;
  }

  pageRoot.innerHTML = await risposta.text();
  caricaCss(pagina.css);

  if (typeof moduloPagina?.onLeave === "function") {
    moduloPagina.onLeave();
  }

  // Evita ?t= che su alcuni WebView Tauri rompe l'import dei moduli
  moduloPagina = await import(pagina.js);
  if (typeof moduloPagina?.onEnter === "function") {
    await moduloPagina.onEnter(pageRoot);
  }
}

/** Apre Occupanti per una unita; se passi idOccupante apre subito la modifica. */
export async function apriOccupantiPerUnita(idUnita, idOccupante = null) {
  sessionStorage.setItem(STORAGE_OCCUPANTI_UNITA, String(idUnita));
  if (idOccupante != null) {
    sessionStorage.setItem(STORAGE_OCCUPANTI_MODIFICA, String(idOccupante));
  } else {
    sessionStorage.removeItem(STORAGE_OCCUPANTI_MODIFICA);
  }
  await mostraPagina("occupazioni");
}

/** Apre Unita e apre subito la modifica dell'unita indicata. */
export async function apriModificaUnita(idUnita) {
  sessionStorage.setItem(STORAGE_UNITA_MODIFICA, String(idUnita));
  await mostraPagina("unita");
}

/** Apre la ripartizione periodi per una spesa.
 *  provenienza: "spese" | "ripartizione" — da dove tornare. */
export async function apriRipartoSpesa(idSpesa, provenienza = "spese") {
  sessionStorage.setItem(STORAGE_RIPARTO_SPESA, String(idSpesa));
  sessionStorage.setItem(STORAGE_RIPARTO_PROVENIENZA, provenienza);
  await mostraPagina("riparto");
}

/** Apre Spese filtrata su una categoria (tipologia). */
export async function apriSpesePerCategoria(idTipologia) {
  sessionStorage.setItem(STORAGE_SPESE_FILTRO_TIPLOGIA, String(idTipologia));
  sessionStorage.setItem(STORAGE_SPESE_FILTRO_STATO, "ATTIVA");
  await mostraPagina("spese");
}

window.apriOccupantiPerUnita = apriOccupantiPerUnita;
window.apriModificaUnita = apriModificaUnita;
window.apriRipartoSpesa = apriRipartoSpesa;
window.apriSpesePerCategoria = apriSpesePerCategoria;
window.mostraPaginaApp = mostraPagina;
window.STORAGE_OCCUPANTI_UNITA = STORAGE_OCCUPANTI_UNITA;
window.STORAGE_OCCUPANTI_MODIFICA = STORAGE_OCCUPANTI_MODIFICA;
window.STORAGE_UNITA_MODIFICA = STORAGE_UNITA_MODIFICA;
window.STORAGE_RIPARTO_SPESA = STORAGE_RIPARTO_SPESA;
window.STORAGE_RIPARTO_PROVENIENZA = STORAGE_RIPARTO_PROVENIENZA;
window.STORAGE_SPESE_FILTRO_TIPLOGIA = STORAGE_SPESE_FILTRO_TIPLOGIA;
window.STORAGE_SPESE_FILTRO_STATO = STORAGE_SPESE_FILTRO_STATO;
window.STORAGE_ARCHIVIO_RENDICONTO = STORAGE_ARCHIVIO_RENDICONTO;

async function avvia() {
  await attendiTauri();

  const info = await conTimeout(
    statoCondominio(),
    8000,
    "Timeout: il condominio non risponde. Torna alla home e riapri il file."
  );
  if (!info) {
    window.location.href = "./index.html";
    return;
  }

  const nomeEl = document.querySelector("#nome-condominio");
  const percorsoEl = document.querySelector("#percorso-condominio");
  if (nomeEl) nomeEl.textContent = info.nomeCondominio;
  if (percorsoEl) percorsoEl.textContent = info.percorso;
  document.title = `${info.nomeCondominio} — Gestione Condominio`;

  document.querySelectorAll(".nav-item[data-page]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.page === "unita") {
        sessionStorage.removeItem(STORAGE_OCCUPANTI_UNITA);
      }
      if (btn.dataset.page === "spese") {
        sessionStorage.removeItem(STORAGE_SPESE_FILTRO_TIPLOGIA);
        sessionStorage.setItem(STORAGE_SPESE_FILTRO_STATO, "ATTIVA");
      }
      mostraPagina(btn.dataset.page).catch(mostraErroreAvvio);
    });
  });

  document.querySelector("#btn-chiudi")?.addEventListener("click", async () => {
    const nome =
      document.querySelector("#nome-condominio")?.textContent?.trim() ||
      "questo condominio";
    const ok = await chiediConferma(
      `Chiudere «${nome}» e tornare alla home?\n\nI dati restano salvati nel file: potrai riaprirlo in seguito.`,
      "Chiudi condominio"
    );
    if (!ok) return;
    await chiudiCondominio();
    window.location.href = "./index.html";
  });

  await mostraPagina("dati-condominio");
  // Non blocca l’apertura della pagina: controlla in background
  controllaAggiornamenti();
}

avvia().catch(mostraErroreAvvio);
