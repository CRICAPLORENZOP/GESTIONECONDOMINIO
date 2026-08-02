/**
 * Chiede conferma all'utente (Sì / No).
 *
 * In Tauri non si può usare window.confirm del browser:
 * viene bloccato e genera l'errore "dialog.confirm not allowed".
 * Qui usiamo il plugin dialog di Tauri (funzione ask).
 *
 * @param {string} messaggio Testo mostrato nella finestra
 * @param {string} [titolo="Conferma"] Titolo della finestra
 * @returns {Promise<boolean>} true se l'utente conferma
 */
export async function chiediConferma(messaggio, titolo = "Conferma") {
  const ask = window.__TAURI__?.dialog?.ask;
  if (typeof ask === "function") {
    return await ask(messaggio, { title: titolo, kind: "warning" });
  }
  // Solo se non siamo in Tauri (es. prova nel browser)
  return window.confirm(messaggio);
}
