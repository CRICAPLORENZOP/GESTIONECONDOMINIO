import { reportRiepilogoRipartizione } from "../api.js";

let root = null;
let datiCache = null;
/** Id unità selezionata, oppure null = tutte. */
let filtroUnitaId = null;
/** Nome gestione selezionata, oppure null = tutte. */
let filtroGestione = null;
/** "unita" = una card per unità | "proprieta" = una card per nome proprietà */
let vista = "unita";

const SOTTOTITOLO_UNITA =
  "Quote ripartite (spese ATTIVA, periodi non archiviati) raggruppate per unità e gestione. Doppio clic su un’unità o su una gestione per filtrare.";
const SOTTOTITOLO_PROPRIETA =
  "Stesse quote, sommate per proprietà (tutte le unità con lo stesso nome). Doppio clic su una gestione per filtrare. Usa «Per unità» per tornare al dettaglio.";

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

function arrotondaEuro(valore) {
  return Math.round(Number(valore || 0) * 100) / 100;
}

function haFiltroAttivo() {
  return filtroUnitaId != null || filtroGestione != null;
}

function etichettaFiltriAttivi() {
  const pezzi = [];
  if (filtroUnitaId != null) {
    const u = datiCache?.unita?.find((x) => x.idUnita === filtroUnitaId);
    pezzi.push(
      u
        ? `unità «${u.proprieta}» (ID ${(u.identificativo || "").trim() || u.idUnita})`
        : `unità ID ${filtroUnitaId}`
    );
  }
  if (filtroGestione) pezzi.push(`gestione «${filtroGestione}»`);
  return pezzi.join(" e ");
}

function aggiornaBannerFiltro() {
  const riga = $("#filtri-riga");

  const chipUnita = $("#filtro-unita");
  const nomeUnita = $("#filtro-unita-nome");
  if (chipUnita && nomeUnita) {
    if (filtroUnitaId == null) {
      chipUnita.hidden = true;
      nomeUnita.textContent = "";
    } else {
      const u = datiCache?.unita?.find((x) => x.idUnita === filtroUnitaId);
      chipUnita.hidden = false;
      nomeUnita.textContent = u
        ? `${u.proprieta} (ID ${(u.identificativo || "").trim() || u.idUnita})`
        : `ID ${filtroUnitaId}`;
    }
  }

  const chipGest = $("#filtro-gestione");
  const nomeGest = $("#filtro-gestione-nome");
  if (chipGest && nomeGest) {
    if (!filtroGestione) {
      chipGest.hidden = true;
      nomeGest.textContent = "";
    } else {
      chipGest.hidden = false;
      nomeGest.textContent = filtroGestione;
    }
  }

  if (riga) {
    riga.hidden = !haFiltroAttivo();
  }
}

function aggiornaTotaleHeader(totale) {
  const box = $("#riep-totale-head");
  const val = $("#riep-totale-val");
  if (!box || !val) return;
  val.textContent = `€ ${formatEuro(arrotondaEuro(totale))}`;
  box.hidden = false;
}

function aggiornaPulsantiVista() {
  const btnUnita = $("#btn-vista-unita");
  const btnProp = $("#btn-vista-proprieta");
  const sotto = $("#riep-sottotitolo");
  btnUnita?.classList.toggle("is-active", vista === "unita");
  btnProp?.classList.toggle("is-active", vista === "proprieta");
  if (sotto) {
    sotto.textContent =
      vista === "proprieta" ? SOTTOTITOLO_PROPRIETA : SOTTOTITOLO_UNITA;
  }
}

function setVista(nuova) {
  if (vista === nuova) return;
  vista = nuova;
  aggiornaPulsantiVista();
  if (datiCache) renderDati(datiCache);
}

function applicaFiltroUnita(idUnita) {
  if (filtroUnitaId === idUnita) return;
  filtroUnitaId = idUnita;
  if (datiCache) renderDati(datiCache);
}

function applicaFiltroGestione(nome) {
  const pulito = (nome || "").trim();
  if (!pulito) return;
  if (filtroGestione === pulito) return;
  filtroGestione = pulito;
  if (datiCache) renderDati(datiCache);
}

function togliFiltroUnita() {
  if (filtroUnitaId == null) return;
  filtroUnitaId = null;
  if (datiCache) renderDati(datiCache);
}

function togliFiltroGestione() {
  if (!filtroGestione) return;
  filtroGestione = null;
  if (datiCache) renderDati(datiCache);
}

/**
 * Applica filtri unità/gestione e ricalcola i totali delle card.
 */
function listaFiltrata(dati) {
  let lista = dati.unita || [];

  if (filtroUnitaId != null) {
    lista = lista.filter((u) => u.idUnita === filtroUnitaId);
  }

  if (filtroGestione != null) {
    lista = lista
      .map((u) => {
        const gestioni = (u.gestioni || []).filter(
          (g) => (g.gestione || "").trim() === filtroGestione
        );
        if (!gestioni.length) return null;
        const totale = arrotondaEuro(
          gestioni.reduce((s, g) => s + (Number(g.totale) || 0), 0)
        );
        return { ...u, gestioni, totale };
      })
      .filter(Boolean);
  }

  return lista;
}

/**
 * Unisce le unità che hanno lo stesso nome «proprietà».
 * Somma i totali e le gestioni (es. Ordinaria + Ordinaria di un’altra unità).
 */
function raggruppaPerProprieta(listaUnita) {
  const map = new Map();

  for (const u of listaUnita) {
    const key = (u.proprieta || "(senza proprietà)").trim() || "(senza proprietà)";
    if (!map.has(key)) {
      map.set(key, {
        proprieta: key,
        totale: 0,
        gestioniMap: new Map(),
        unitaIds: [],
      });
    }
    const g = map.get(key);
    g.totale += Number(u.totale) || 0;
    g.unitaIds.push(u.idUnita);
    for (const gest of u.gestioni || []) {
      const prev = g.gestioniMap.get(gest.gestione) || 0;
      g.gestioniMap.set(gest.gestione, prev + (Number(gest.totale) || 0));
    }
  }

  return [...map.values()]
    .map((g) => ({
      proprieta: g.proprieta,
      totale: arrotondaEuro(g.totale),
      nUnita: g.unitaIds.length,
      unitaIds: g.unitaIds,
      gestioni: [...g.gestioniMap.entries()]
        .map(([gestione, totale]) => ({
          gestione,
          totale: arrotondaEuro(totale),
        }))
        .sort((a, b) => a.gestione.localeCompare(b.gestione, "it")),
    }))
    .sort((a, b) => a.proprieta.localeCompare(b.proprieta, "it"));
}

function appendGestioniTable(card, gestioni) {
  const table = document.createElement("table");
  table.className = "gestione-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th>Gestione</th>
        <th class="num">Totale</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = table.querySelector("tbody");
  for (const g of gestioni) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td class="col-gestione"></td><td class="num"></td>`;
    tr.children[0].textContent = g.gestione;
    tr.children[0].title = "Doppio clic: mostra solo questa gestione";
    tr.children[0].addEventListener("dblclick", () => {
      applicaFiltroGestione(g.gestione);
    });
    tr.children[1].textContent = `€ ${formatEuro(g.totale)}`;
    tbody.appendChild(tr);
  }
  card.appendChild(table);
}

function appendFoot(card, etichetta, totale) {
  const foot = document.createElement("div");
  foot.className = "unita-foot";
  foot.innerHTML = `<span></span><span class="tot-box"></span>`;
  foot.querySelector("span").textContent = etichetta;
  foot.querySelector(".tot-box").textContent = `€ ${formatEuro(totale)}`;
  card.appendChild(foot);
}

function etichettaFootCard() {
  if (filtroGestione) return `Totale ${filtroGestione}`;
  return "Totale proprietà";
}

function renderCardUnita(u, corpo) {
  const card = document.createElement("article");
  card.className = "unita-card";

  const head = document.createElement("div");
  head.className = "unita-head";
  head.title = "Doppio clic: mostra solo questa unità";
  head.innerHTML = `
    <div>
      <p class="unita-proprieta"></p>
      <p class="unita-meta"></p>
    </div>
    <span class="unita-totale"></span>
  `;
  head.querySelector(".unita-proprieta").textContent = u.proprieta;
  const ident = (u.identificativo || "").trim();
  head.querySelector(".unita-meta").textContent = ident
    ? `ID ${ident}`
    : `ID —`;
  head.querySelector(".unita-totale").textContent = `€ ${formatEuro(u.totale)}`;
  head.addEventListener("dblclick", () => {
    applicaFiltroUnita(u.idUnita);
  });
  card.appendChild(head);

  appendGestioniTable(card, u.gestioni || []);
  appendFoot(card, etichettaFootCard(), u.totale);
  corpo.appendChild(card);
}

function renderCardProprieta(g, corpo) {
  const card = document.createElement("article");
  card.className = "unita-card proprieta-card";

  const head = document.createElement("div");
  head.className = "unita-head unita-head-static";
  head.innerHTML = `
    <div>
      <p class="unita-proprieta"></p>
      <p class="unita-meta"></p>
    </div>
    <span class="unita-totale"></span>
  `;
  head.querySelector(".unita-proprieta").textContent = g.proprieta;
  const n = g.nUnita;
  head.querySelector(".unita-meta").textContent =
    n === 1 ? "1 unità" : `${n} unità`;
  head.querySelector(".unita-totale").textContent = `€ ${formatEuro(g.totale)}`;
  card.appendChild(head);

  appendGestioniTable(card, g.gestioni);
  appendFoot(card, etichettaFootCard(), g.totale);
  corpo.appendChild(card);
}

function renderDati(dati) {
  const corpo = $("#riep-corpo");
  const vuoto = $("#riep-vuoto");
  corpo.innerHTML = "";
  aggiornaBannerFiltro();
  aggiornaPulsantiVista();

  const lista = listaFiltrata(dati);

  if (!lista.length) {
    vuoto.hidden = false;
    vuoto.textContent = haFiltroAttivo()
      ? `Nessun dato per ${etichettaFiltriAttivi()}.`
      : "Nessuna quota ripartita da mostrare.";
    aggiornaTotaleHeader(0);
    return;
  }
  vuoto.hidden = true;

  let totaleVisualizzato = 0;
  for (const u of lista) {
    totaleVisualizzato += Number(u.totale) || 0;
  }

  if (vista === "proprieta") {
    const gruppi = raggruppaPerProprieta(lista);
    for (const g of gruppi) {
      renderCardProprieta(g, corpo);
    }
  } else {
    for (const u of lista) {
      renderCardUnita(u, corpo);
    }
  }

  aggiornaTotaleHeader(
    haFiltroAttivo() ? totaleVisualizzato : dati.totaleGenerale
  );
}

async function carica() {
  mostraErrore($("#riep-error"), "");
  $("#riep-corpo").innerHTML = `<p class="muted">Caricamento…</p>`;
  $("#riep-vuoto").hidden = true;
  const boxTot = $("#riep-totale-head");
  if (boxTot) boxTot.hidden = true;

  try {
    datiCache = await reportRiepilogoRipartizione();
    renderDati(datiCache);
  } catch (err) {
    datiCache = null;
    $("#riep-corpo").innerHTML = "";
    aggiornaTotaleHeader(0);
    mostraErrore($("#riep-error"), String(err));
  }
}

export async function onEnter(pageRoot) {
  root = pageRoot;
  datiCache = null;
  filtroUnitaId = null;
  filtroGestione = null;
  vista = "unita";
  aggiornaBannerFiltro();
  aggiornaPulsantiVista();
  $("#btn-togli-filtro-unita")?.addEventListener("click", () => {
    togliFiltroUnita();
  });
  $("#btn-togli-filtro-gestione")?.addEventListener("click", () => {
    togliFiltroGestione();
  });
  $("#btn-vista-unita")?.addEventListener("click", () => {
    setVista("unita");
  });
  $("#btn-vista-proprieta")?.addEventListener("click", () => {
    setVista("proprieta");
  });
  await carica();
}

export function onLeave() {
  root = null;
  datiCache = null;
  filtroUnitaId = null;
  filtroGestione = null;
  vista = "unita";
}
