/**
 * Versione dell’app (da Tauri) e titoli con numero versione.
 */

let cacheVersione = null;

export async function getVersioneApp() {
  if (cacheVersione) return cacheVersione;
  try {
    const v = await window.__TAURI__?.app?.getVersion?.();
    if (v) {
      cacheVersione = String(v);
      return cacheVersione;
    }
  } catch {
    /* ignora */
  }
  cacheVersione = "0.1.1";
  return cacheVersione;
}

/** Es. "Gestione Condominio v0.1.1" */
export async function titoloAppBase() {
  const v = await getVersioneApp();
  return `Gestione Condominio v${v}`;
}

/**
 * Aggiorna document.title (e di solito anche la barra della finestra).
 * @param {string} [prefisso] es. nome condominio — se omesso usa solo il nome app
 */
export async function aggiornaTitoloFinestra(prefisso = null) {
  const base = await titoloAppBase();
  document.title = prefisso ? `${prefisso} — ${base}` : base;
  try {
    await window.__TAURI__?.webviewWindow
      ?.getCurrentWebviewWindow?.()
      ?.setTitle?.(document.title);
  } catch {
    /* ok se non disponibile */
  }
}
