# Gestione Condominio

App desktop (Tauri) per gestire spese e ripartizioni condominiali.

Repository: https://github.com/CRICAPLORENZOP/GESTIONECONDOMINIO

## Sviluppo locale

```bash
npm install
npm run tauri dev
```

## Pubblicare una nuova versione (aggiornamento automatico)

1. Aumenta la versione in:
   - `package.json`
   - `src-tauri/tauri.conf.json`
   - `src-tauri/Cargo.toml` (campo `version`)
2. Fai commit e push su `main`
3. Pusha (o crea) il branch `release`, oppure avvia il workflow **Publish** da GitHub → Actions → Run workflow
4. GitHub costruisce l’installer Windows e crea una Release con `latest.json`
5. Le app già installate, all’avvio, chiedono se installare l’aggiornamento

### Secrets GitHub (obbligatori per firmare gli aggiornamenti)

In **Settings → Secrets and variables → Actions** crea:

| Secret | Contenuto |
|--------|-----------|
| `TAURI_SIGNING_PRIVATE_KEY` | Testo completo del file `keys/gestione-condominio.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password della chiave (vedi `keys/LEGGIMI.txt` sul tuo PC) |

La cartella `keys/` **non** va su GitHub (è esclusa dal repository).

### Permessi Actions

In **Settings → Actions → General → Workflow permissions** scegli **Read and write permissions**.
