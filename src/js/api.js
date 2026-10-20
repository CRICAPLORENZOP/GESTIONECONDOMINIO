/**
 * Piccola "centralina" per parlare con Rust (Tauri).
 * I comandi qui sotto sono funzioni scritte in lib.rs.
 */

function getInvoke() {
  const core = window.__TAURI__?.core;
  if (!core?.invoke) {
    throw new Error(
      "Tauri non è disponibile. Avvia l'app con: npm run tauri dev"
    );
  }
  return core.invoke;
}

export async function creaCondominio(percorso, nome) {
  return getInvoke()("crea_condominio", { percorso, nome });
}

export async function apriCondominio(percorso) {
  return getInvoke()("apri_condominio", { percorso });
}

export async function chiudiCondominio() {
  return getInvoke()("chiudi_condominio");
}

export async function statoCondominio() {
  return getInvoke()("stato_condominio");
}

/** Apre la cartella del file .db (con il file selezionato) per poterlo copiare. */
export async function apriCartellaDatabase() {
  return getInvoke()("apri_cartella_database");
}

export async function aggiornaCondominio(nomeCondominio, noteCondominio) {
  return getInvoke()("aggiorna_condominio", {
    nomeCondominio,
    noteCondominio,
  });
}

export async function elencoUnita() {
  return getInvoke()("elenco_unita");
}

export async function creaUnita(dati) {
  return getInvoke()("crea_unita", { dati });
}

export async function aggiornaUnita(idUnita, dati) {
  return getInvoke()("aggiorna_unita", { idUnita, dati });
}

export async function eliminaUnita(idUnita) {
  return getInvoke()("elimina_unita", { idUnita });
}

export async function elencoOccupanti() {
  return getInvoke()("elenco_occupanti");
}

export async function creaOccupante(dati) {
  return getInvoke()("crea_occupante", { dati });
}

export async function aggiornaOccupante(idOccupante, dati) {
  return getInvoke()("aggiorna_occupante", { idOccupante, dati });
}

export async function eliminaOccupante(idOccupante) {
  return getInvoke()("elimina_occupante", { idOccupante });
}

export async function elencoTipologieSpesa() {
  return getInvoke()("elenco_tipologie_spesa");
}

export async function creaTipologiaSpesa(dati) {
  return getInvoke()("crea_tipologia_spesa", { dati });
}

export async function aggiornaTipologiaSpesa(idTipologiaSpesa, dati) {
  return getInvoke()("aggiorna_tipologia_spesa", { idTipologiaSpesa, dati });
}

export async function eliminaTipologiaSpesa(idTipologiaSpesa) {
  return getInvoke()("elimina_tipologia_spesa", { idTipologiaSpesa });
}

export async function elencoSpese() {
  return getInvoke()("elenco_spese");
}

export async function creaSpesa(dati) {
  return getInvoke()("crea_spesa", { dati });
}

export async function aggiornaSpesa(idSpesa, dati) {
  return getInvoke()("aggiorna_spesa", { idSpesa, dati });
}

export async function eliminaSpesa(idSpesa) {
  return getInvoke()("elimina_spesa", { idSpesa });
}

export async function allegaBollettaSpesa(idSpesa) {
  return getInvoke()("allega_bolletta_spesa", { idSpesa });
}

export async function apriBollettaSpesa(idSpesa) {
  return getInvoke()("apri_bolletta_spesa", { idSpesa });
}

export async function rimuoviBollettaSpesa(idSpesa) {
  return getInvoke()("rimuovi_bolletta_spesa", { idSpesa });
}

export async function dettaglioRipartoSpesa(idSpesa) {
  return getInvoke()("dettaglio_riparto_spesa", { idSpesa });
}

export async function proponiPeriodoSpesa(idSpesa, dati) {
  return getInvoke()("proponi_periodo_spesa", { idSpesa, dati });
}

export async function creaPeriodoSpesa(idSpesa, dati) {
  return getInvoke()("crea_periodo_spesa", { idSpesa, dati });
}

export async function eliminaPeriodoSpesa(idPeriodo) {
  return getInvoke()("elimina_periodo_spesa", { idPeriodo });
}

export async function aggiornaQuotePeriodo(idPeriodo, dati) {
  return getInvoke()("aggiorna_quote_periodo", { idPeriodo, dati });
}

export async function reportSpeseConteggiate() {
  return getInvoke()("report_spese_conteggiate");
}

export async function reportRendicontiArchiviatiOpzioni() {
  return getInvoke()("report_rendiconti_archiviati_opzioni");
}

/** Nome del rendiconto archiviato più recente, oppure stringa vuota. */
export async function reportRendicontoArchiviatoPiuRecente() {
  return getInvoke()("report_rendiconto_archiviato_piu_recente");
}

export async function reportSpeseArchiviatePerRendiconto(rendicontoDel = "") {
  return getInvoke()("report_spese_archiviate_per_rendiconto", {
    rendicontoDel: rendicontoDel || "",
  });
}

export async function reportRipartizioneArchiviatiPerRendiconto(rendicontoDel = "") {
  return getInvoke()("report_ripartizione_archiviati_per_rendiconto", {
    rendicontoDel: rendicontoDel || "",
  });
}

export async function reportRipartizioneSpeseConteggiate(da = "", a = "") {
  return getInvoke()("report_ripartizione_spese_conteggiate", {
    da: da || "",
    a: a || "",
  });
}

export async function reportRiepilogoRipartizione() {
  return getInvoke()("report_riepilogo_ripartizione");
}

export async function elencoOccupantiCorrenti() {
  return getInvoke()("elenco_occupanti_correnti");
}

export async function elencoRateOccupante(idOccupante) {
  return getInvoke()("elenco_rate_occupante", { idOccupante });
}

export async function creaRataCondominiale(dati) {
  return getInvoke()("crea_rata_condominiale", { dati });
}

export async function aggiornaRataCondominiale(idRata, dati) {
  return getInvoke()("aggiorna_rata_condominiale", { idRata, dati });
}

export async function eliminaRataCondominiale(idRata) {
  return getInvoke()("elimina_rata_condominiale", { idRata });
}

export async function riepilogoRendicontoOccupante(idOccupante, rendiconto) {
  return getInvoke()("riepilogo_rendiconto_occupante", {
    idOccupante,
    rendiconto: rendiconto || "",
  });
}

export async function conguaglioOccupanti(rendiconto) {
  return getInvoke()("conguaglio_occupanti", {
    rendiconto: rendiconto || "",
  });
}

export async function situazionePagamenti(rendiconto) {
  return getInvoke()("situazione_pagamenti", {
    rendiconto: rendiconto || "",
  });
}

export async function elencoPagamentiProprieta(proprieta) {
  return getInvoke()("elenco_pagamenti_proprieta", {
    proprieta: proprieta || "",
  });
}

export async function creaPagamentoProprieta(dati) {
  return getInvoke()("crea_pagamento_proprieta", { dati });
}

export async function aggiornaPagamentoProprieta(idPagamento, dati) {
  return getInvoke()("aggiorna_pagamento_proprieta", { idPagamento, dati });
}

export async function eliminaPagamentoProprieta(idPagamento) {
  return getInvoke()("elimina_pagamento_proprieta", { idPagamento });
}

export async function elencoRecenti() {
  return getInvoke()("elenco_recenti");
}

export async function rimuoviRecente(percorso) {
  return getInvoke()("rimuovi_recente", { percorso });
}

/** Chiede all'utente dove salvare il nuovo file .db */
export async function scegliPercorsoSalvataggio(nomeSuggerito) {
  return getInvoke()("scegli_percorso_salvataggio", {
    nomeDefault: nomeSuggerito,
  });
}

/** Chiede all'utente quale file .db aprire */
export async function scegliPercorsoApertura() {
  return getInvoke()("scegli_percorso_apertura");
}
