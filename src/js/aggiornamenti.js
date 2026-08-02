/**
 * Controlla se c’è una nuova versione su GitHub Releases.
 * Se sì, chiede conferma e installa (poi riavvia l’app).
 *
 * Usa le API globali Tauri (come il resto dell’app, senza bundler).
 */
import { chiediConferma } from "./conferma.js";

export async function controllaAggiornamenti() {
  try {
    const updater = window.__TAURI__?.updater;
    const processApi = window.__TAURI__?.process;
    if (!updater?.check || !processApi?.relaunch) {
      return;
    }

    const update = await updater.check();
    if (!update) return;

    const ok = await chiediConferma(
      `È disponibile la versione ${update.version}.\n\nVuoi scaricare e installare l’aggiornamento ora?\nL’app verrà riavviata.`,
      "Aggiornamento disponibile"
    );
    if (!ok) return;

    await update.downloadAndInstall();
    await processApi.relaunch();
  } catch (err) {
    // In sviluppo o senza rete non è un errore grave
    console.warn("Controllo aggiornamenti non riuscito:", err);
  }
}
