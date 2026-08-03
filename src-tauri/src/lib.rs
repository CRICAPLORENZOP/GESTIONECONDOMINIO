use chrono::Local;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

mod migrate;
mod rate;
mod report;
mod riparto;

const MAX_RECENTI: usize = 10;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CondominioInfo {
    pub id_condominio: i64,
    pub nome_condominio: String,
    pub note_condominio: String,
    pub percorso: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Recente {
    pub nome: String,
    pub percorso: String,
    pub aperto_il: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Unita {
    pub id_unita: i64,
    pub id_condominio: i64,
    pub proprieta: String,
    pub identificativo: String,
    pub subalterno: String,
    pub piano: String,
    pub millesimi: f64,
    pub uso: String,
    pub note_unita: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnitaInput {
    pub proprieta: String,
    pub identificativo: String,
    pub subalterno: String,
    pub piano: String,
    pub millesimi: f64,
    pub uso: String,
    pub note_unita: String,
}

pub struct AppState {
    pub db: Mutex<Option<Connection>>,
    pub percorso: Mutex<Option<PathBuf>>,
    pub info: Mutex<Option<CondominioInfo>>,
}

impl AppState {
    fn new() -> Self {
        Self {
            db: Mutex::new(None),
            percorso: Mutex::new(None),
            info: Mutex::new(None),
        }
    }
}

fn now_iso() -> String {
    Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

fn init_schema(conn: &Connection, nome: &str) -> Result<(), String> {
    migrate::crea_schema_attuale(conn)?;

    conn.execute(
        "INSERT INTO condominio (NomeCondominio, NoteCondominio) VALUES (?1, '')",
        params![nome],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

fn prepara_database(conn: &Connection) -> Result<(), String> {
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|e| e.to_string())?;
    migrate::migra_se_serve(conn)
}

fn leggi_info(conn: &Connection, percorso: &Path) -> Result<CondominioInfo, String> {
    prepara_database(conn)?;

    let (id_condominio, nome_condominio, note_condominio): (i64, String, String) = conn
        .query_row(
            "SELECT IdCondominio, NomeCondominio, NoteCondominio
             FROM condominio
             ORDER BY IdCondominio
             LIMIT 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|e| format!("File non valido (manca il condominio): {e}"))?;

    Ok(CondominioInfo {
        id_condominio,
        nome_condominio,
        note_condominio,
        percorso: percorso.to_string_lossy().to_string(),
    })
}

pub(crate) fn with_db<F, T>(state: &AppState, f: F) -> Result<T, String>
where
    F: FnOnce(&Connection, &CondominioInfo) -> Result<T, String>,
{
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let info = state.info.lock().map_err(|e| e.to_string())?;
    let conn = db.as_ref().ok_or("Nessun condominio aperto.")?;
    let info = info.as_ref().ok_or("Nessun condominio aperto.")?;
    f(conn, info)
}

fn recent_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Impossibile trovare la cartella dati app: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("recenti.json"))
}

fn carica_recenti(app: &AppHandle) -> Result<Vec<Recente>, String> {
    let path = recent_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let testo = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&testo).map_err(|e| format!("File recenti danneggiato: {e}"))
}

fn salva_recenti(app: &AppHandle, recenti: &[Recente]) -> Result<(), String> {
    let path = recent_path(app)?;
    let testo = serde_json::to_string_pretty(recenti).map_err(|e| e.to_string())?;
    fs::write(path, testo).map_err(|e| e.to_string())
}

fn aggiungi_recente(app: &AppHandle, info: &CondominioInfo) -> Result<(), String> {
    let mut lista = carica_recenti(app)?;
    lista.retain(|r| r.percorso != info.percorso);
    lista.insert(
        0,
        Recente {
            nome: info.nome_condominio.clone(),
            percorso: info.percorso.clone(),
            aperto_il: now_iso(),
        },
    );
    lista.truncate(MAX_RECENTI);
    salva_recenti(app, &lista)
}

fn set_aperto(state: &AppState, conn: Connection, info: CondominioInfo) -> Result<(), String> {
    let percorso = PathBuf::from(&info.percorso);
    *state.db.lock().map_err(|e| e.to_string())? = Some(conn);
    *state.percorso.lock().map_err(|e| e.to_string())? = Some(percorso);
    *state.info.lock().map_err(|e| e.to_string())? = Some(info);
    Ok(())
}

fn chiudi_interno(state: &AppState) -> Result<(), String> {
    *state.db.lock().map_err(|e| e.to_string())? = None;
    *state.percorso.lock().map_err(|e| e.to_string())? = None;
    *state.info.lock().map_err(|e| e.to_string())? = None;
    Ok(())
}

const USI_UNITA: &[&str] = &[
    "ABITAZIONE",
    "UFFICIO",
    "NEGOZIO",
    "DEPOSITO",
    "ARTIGIANALE",
    "LABORATORIO",
    "BOX",
];

fn normalizza_unita_input(input: UnitaInput) -> Result<UnitaInput, String> {
    let proprieta = input.proprieta.trim().to_string();
    if proprieta.is_empty() {
        return Err("Il campo Proprietà è obbligatorio (es. Int. 1, Box A).".into());
    }
    if !input.millesimi.is_finite() || input.millesimi < 0.0 {
        return Err("I millesimi devono essere un numero maggiore o uguale a zero.".into());
    }
    let uso = input.uso.trim().to_uppercase();
    if !USI_UNITA.iter().any(|v| *v == uso) {
        return Err(format!(
            "Uso non valido. Scegli uno tra: {}.",
            USI_UNITA.join(", ")
        ));
    }
    Ok(UnitaInput {
        proprieta,
        identificativo: input.identificativo.trim().to_string(),
        subalterno: input.subalterno.trim().to_string(),
        piano: input.piano.trim().to_string(),
        millesimi: input.millesimi,
        uso,
        note_unita: input.note_unita.trim().to_string(),
    })
}

fn mappa_unita(row: &rusqlite::Row<'_>) -> rusqlite::Result<Unita> {
    Ok(Unita {
        id_unita: row.get(0)?,
        id_condominio: row.get(1)?,
        proprieta: row.get(2)?,
        identificativo: row.get(3)?,
        subalterno: row.get(4)?,
        piano: row.get(5)?,
        millesimi: row.get(6)?,
        uso: row.get(7)?,
        note_unita: row.get(8)?,
    })
}

/// Crea un nuovo file database per un condominio.
#[tauri::command]
fn crea_condominio(
    app: AppHandle,
    state: State<AppState>,
    percorso: String,
    nome: String,
) -> Result<CondominioInfo, String> {
    let nome = nome.trim().to_string();
    if nome.is_empty() {
        return Err("Il nome del condominio è obbligatorio.".into());
    }

    let path = PathBuf::from(&percorso);
    if path.exists() {
        return Err("Esiste già un file in quella posizione. Scegli un altro nome.".into());
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Impossibile creare la cartella: {e}"))?;
    }

    let conn = Connection::open(&path).map_err(|e| format!("Impossibile creare il database: {e}"))?;
    init_schema(&conn, &nome)?;
    let info = leggi_info(&conn, &path)?;

    chiudi_interno(&state)?;
    set_aperto(&state, conn, info.clone())?;
    aggiungi_recente(&app, &info)?;

    Ok(info)
}

/// Apre un database condominio esistente.
#[tauri::command]
fn apri_condominio(
    app: AppHandle,
    state: State<AppState>,
    percorso: String,
) -> Result<CondominioInfo, String> {
    let path = PathBuf::from(&percorso);
    if !path.exists() {
        return Err("Il file selezionato non esiste.".into());
    }

    let conn = Connection::open(&path).map_err(|e| format!("Impossibile aprire il database: {e}"))?;
    let info = leggi_info(&conn, &path)?;

    chiudi_interno(&state)?;
    set_aperto(&state, conn, info.clone())?;
    aggiungi_recente(&app, &info)?;

    Ok(info)
}

#[tauri::command]
fn chiudi_condominio(state: State<AppState>) -> Result<(), String> {
    chiudi_interno(&state)
}

#[tauri::command]
fn stato_condominio(state: State<AppState>) -> Result<Option<CondominioInfo>, String> {
    Ok(state.info.lock().map_err(|e| e.to_string())?.clone())
}

/// Apre Esplora file (o equivalente) con il file database selezionato,
/// così puoi copiarlo facilmente.
#[tauri::command]
fn apri_cartella_database(state: State<AppState>) -> Result<(), String> {
    let percorso = state
        .percorso
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or_else(|| "Nessun condominio aperto.".to_string())?;

    if !percorso.exists() {
        return Err(format!(
            "Il file database non esiste più: {}",
            percorso.display()
        ));
    }

    tauri_plugin_opener::reveal_item_in_dir(&percorso)
        .map_err(|e| format!("Impossibile aprire la cartella del database: {e}"))
}

#[tauri::command]
fn aggiorna_condominio(
    app: AppHandle,
    state: State<AppState>,
    nome_condominio: String,
    note_condominio: String,
) -> Result<CondominioInfo, String> {
    let nome = nome_condominio.trim().to_string();
    if nome.is_empty() {
        return Err("Il nome del condominio è obbligatorio.".into());
    }
    let note = note_condominio.trim().to_string();

    let info = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let mut info_guard = state.info.lock().map_err(|e| e.to_string())?;
        let conn = db.as_ref().ok_or("Nessun condominio aperto.")?;
        let info = info_guard.as_mut().ok_or("Nessun condominio aperto.")?;

        conn.execute(
            "UPDATE condominio
             SET NomeCondominio = ?1, NoteCondominio = ?2
             WHERE IdCondominio = ?3",
            params![nome, note, info.id_condominio],
        )
        .map_err(|e| e.to_string())?;

        info.nome_condominio = nome;
        info.note_condominio = note;
        info.clone()
    };

    aggiungi_recente(&app, &info)?;
    Ok(info)
}

#[tauri::command]
fn elenco_unita(state: State<AppState>) -> Result<Vec<Unita>, String> {
    with_db(&state, |conn, info| {
        let mut stmt = conn
            .prepare(
                "SELECT IdUnita, IdCondominio, Proprieta, Identificativo, Subalterno,
                        Piano, Millesimi, Uso, NoteUnita
                 FROM unita
                 WHERE IdCondominio = ?1
                 ORDER BY Identificativo, Subalterno, Proprieta, IdUnita",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map(params![info.id_condominio], mappa_unita)
            .map_err(|e| e.to_string())?;

        let mut lista = Vec::new();
        for row in rows {
            lista.push(row.map_err(|e| e.to_string())?);
        }
        Ok(lista)
    })
}

#[tauri::command]
fn crea_unita(state: State<AppState>, dati: UnitaInput) -> Result<Unita, String> {
    let dati = normalizza_unita_input(dati)?;
    with_db(&state, |conn, info| {
        conn.execute(
            "INSERT INTO unita (
                IdCondominio, Proprieta, Identificativo, Subalterno,
                Piano, Millesimi, Uso, NoteUnita
             )
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                info.id_condominio,
                dati.proprieta,
                dati.identificativo,
                dati.subalterno,
                dati.piano,
                dati.millesimi,
                dati.uso,
                dati.note_unita
            ],
        )
        .map_err(|e| e.to_string())?;

        let id_unita = conn.last_insert_rowid();
        Ok(Unita {
            id_unita,
            id_condominio: info.id_condominio,
            proprieta: dati.proprieta,
            identificativo: dati.identificativo,
            subalterno: dati.subalterno,
            piano: dati.piano,
            millesimi: dati.millesimi,
            uso: dati.uso,
            note_unita: dati.note_unita,
        })
    })
}

#[tauri::command]
fn aggiorna_unita(
    state: State<AppState>,
    id_unita: i64,
    dati: UnitaInput,
) -> Result<Unita, String> {
    let dati = normalizza_unita_input(dati)?;
    with_db(&state, |conn, info| {
        let aggiornate = conn
            .execute(
                "UPDATE unita
                 SET Proprieta = ?1, Identificativo = ?2, Subalterno = ?3,
                     Piano = ?4, Millesimi = ?5, Uso = ?6, NoteUnita = ?7
                 WHERE IdUnita = ?8 AND IdCondominio = ?9",
                params![
                    dati.proprieta,
                    dati.identificativo,
                    dati.subalterno,
                    dati.piano,
                    dati.millesimi,
                    dati.uso,
                    dati.note_unita,
                    id_unita,
                    info.id_condominio
                ],
            )
            .map_err(|e| e.to_string())?;

        if aggiornate == 0 {
            return Err("Unità non trovata.".into());
        }

        Ok(Unita {
            id_unita,
            id_condominio: info.id_condominio,
            proprieta: dati.proprieta,
            identificativo: dati.identificativo,
            subalterno: dati.subalterno,
            piano: dati.piano,
            millesimi: dati.millesimi,
            uso: dati.uso,
            note_unita: dati.note_unita,
        })
    })
}

#[tauri::command]
fn elimina_unita(state: State<AppState>, id_unita: i64) -> Result<(), String> {
    with_db(&state, |conn, info| {
        let eliminate = conn
            .execute(
                "DELETE FROM unita WHERE IdUnita = ?1 AND IdCondominio = ?2",
                params![id_unita, info.id_condominio],
            )
            .map_err(|e| e.to_string())?;

        if eliminate == 0 {
            return Err("Unità non trovata.".into());
        }
        Ok(())
    })
}

#[tauri::command]
fn get_unita(state: State<AppState>, id_unita: i64) -> Result<Option<Unita>, String> {
    with_db(&state, |conn, info| {
        conn.query_row(
            "SELECT IdUnita, IdCondominio, Proprieta, Identificativo, Subalterno,
                    Piano, Millesimi, Uso, NoteUnita
             FROM unita
             WHERE IdUnita = ?1 AND IdCondominio = ?2",
            params![id_unita, info.id_condominio],
            mappa_unita,
        )
        .optional()
        .map_err(|e| e.to_string())
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Occupante {
    pub id_occupante: i64,
    pub id_unita: i64,
    pub nominativo: String,
    pub data_inizio: String,
    pub data_fine: String,
    pub num_componenti: i64,
    pub percentuale: f64,
    pub note_occupante: String,
    pub proprieta_unita: String,
    pub identificativo_unita: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OccupanteInput {
    pub id_unita: i64,
    pub nominativo: String,
    pub data_inizio: String,
    pub data_fine: String,
    pub num_componenti: i64,
    pub percentuale: f64,
    pub note_occupante: String,
}

fn data_valida(data: &str) -> bool {
    if data.len() != 10 {
        return false;
    }
    let b = data.as_bytes();
    b[4] == b'-'
        && b[7] == b'-'
        && data[0..4].chars().all(|c| c.is_ascii_digit())
        && data[5..7].chars().all(|c| c.is_ascii_digit())
        && data[8..10].chars().all(|c| c.is_ascii_digit())
}

fn fine_effettiva(data_fine: &str) -> &str {
    if data_fine.is_empty() {
        "9999-12-31"
    } else {
        data_fine
    }
}

fn periodi_si_sovrappongono(
    inizio_a: &str,
    fine_a: &str,
    inizio_b: &str,
    fine_b: &str,
) -> bool {
    inizio_a <= fine_effettiva(fine_b) && inizio_b <= fine_effettiva(fine_a)
}

fn normalizza_occupante_input(input: OccupanteInput) -> Result<OccupanteInput, String> {
    let nominativo = input.nominativo.trim().to_string();
    if nominativo.is_empty() {
        return Err("Il nominativo è obbligatorio.".into());
    }

    let data_inizio = input.data_inizio.trim().to_string();
    if !data_valida(&data_inizio) {
        return Err("Data inizio non valida. Usa il formato AAAA-MM-GG.".into());
    }

    let data_fine = input.data_fine.trim().to_string();
    if !data_fine.is_empty() {
        if !data_valida(&data_fine) {
            return Err("Data fine non valida. Usa il formato AAAA-MM-GG.".into());
        }
        if data_fine < data_inizio {
            return Err("La data fine non può essere precedente alla data inizio.".into());
        }
    }

    if input.num_componenti < 1 {
        return Err("Il numero componenti deve essere almeno 1.".into());
    }
    if !input.percentuale.is_finite() || input.percentuale < 0.0 || input.percentuale > 100.0 {
        return Err("La percentuale deve essere un numero tra 0 e 100.".into());
    }

    Ok(OccupanteInput {
        id_unita: input.id_unita,
        nominativo,
        data_inizio,
        data_fine,
        num_componenti: input.num_componenti,
        percentuale: input.percentuale,
        note_occupante: input.note_occupante.trim().to_string(),
    })
}

fn verifica_unita_del_condominio(
    conn: &Connection,
    id_unita: i64,
    id_condominio: i64,
) -> Result<(), String> {
    let esiste: Option<i64> = conn
        .query_row(
            "SELECT IdUnita FROM unita WHERE IdUnita = ?1 AND IdCondominio = ?2",
            params![id_unita, id_condominio],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    if esiste.is_none() {
        return Err("Unità non trovata in questo condominio.".into());
    }
    Ok(())
}

fn verifica_sovrapposizioni(
    conn: &Connection,
    id_unita: i64,
    data_inizio: &str,
    data_fine: &str,
    escludi_id: Option<i64>,
) -> Result<(), String> {
    let mut stmt = conn
        .prepare(
            "SELECT IdOccupante, Nominativo, DataInizio, DataFine
             FROM occupante
             WHERE IdUnita = ?1",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![id_unita], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    for row in rows {
        let (id, nominativo, inizio, fine) = row.map_err(|e| e.to_string())?;
        if escludi_id == Some(id) {
            continue;
        }
        if periodi_si_sovrappongono(data_inizio, data_fine, &inizio, &fine) {
            let periodo = if fine.is_empty() {
                format!("{inizio} → in corso")
            } else {
                format!("{inizio} → {fine}")
            };
            return Err(format!(
                "Periodo già occupato da «{nominativo}» ({periodo}). Controlla le date."
            ));
        }
    }
    Ok(())
}

fn mappa_occupante(row: &rusqlite::Row<'_>) -> rusqlite::Result<Occupante> {
    Ok(Occupante {
        id_occupante: row.get(0)?,
        id_unita: row.get(1)?,
        nominativo: row.get(2)?,
        data_inizio: row.get(3)?,
        data_fine: row.get(4)?,
        num_componenti: row.get(5)?,
        percentuale: row.get(6)?,
        note_occupante: row.get(7)?,
        proprieta_unita: row.get(8)?,
        identificativo_unita: row.get(9)?,
    })
}

#[tauri::command]
fn elenco_occupanti(state: State<AppState>) -> Result<Vec<Occupante>, String> {
    with_db(&state, |conn, info| {
        let mut stmt = conn
            .prepare(
                "SELECT o.IdOccupante, o.IdUnita, o.Nominativo, o.DataInizio, o.DataFine,
                        o.NumComponenti, o.Percentuale, o.NoteOccupante,
                        u.Proprieta, u.Identificativo
                 FROM occupante o
                 INNER JOIN unita u ON u.IdUnita = o.IdUnita
                 WHERE u.IdCondominio = ?1
                 ORDER BY o.DataInizio DESC, o.IdOccupante DESC",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map(params![info.id_condominio], mappa_occupante)
            .map_err(|e| e.to_string())?;

        let mut lista = Vec::new();
        for row in rows {
            lista.push(row.map_err(|e| e.to_string())?);
        }
        Ok(lista)
    })
}

#[tauri::command]
fn crea_occupante(state: State<AppState>, dati: OccupanteInput) -> Result<Occupante, String> {
    let dati = normalizza_occupante_input(dati)?;
    with_db(&state, |conn, info| {
        verifica_unita_del_condominio(conn, dati.id_unita, info.id_condominio)?;
        verifica_sovrapposizioni(conn, dati.id_unita, &dati.data_inizio, &dati.data_fine, None)?;

        conn.execute(
            "INSERT INTO occupante (
                IdUnita, Nominativo, DataInizio, DataFine, NumComponenti, Percentuale, NoteOccupante
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                dati.id_unita,
                dati.nominativo,
                dati.data_inizio,
                dati.data_fine,
                dati.num_componenti,
                dati.percentuale,
                dati.note_occupante
            ],
        )
        .map_err(|e| e.to_string())?;

        let id = conn.last_insert_rowid();
        conn.query_row(
            "SELECT o.IdOccupante, o.IdUnita, o.Nominativo, o.DataInizio, o.DataFine,
                    o.NumComponenti, o.Percentuale, o.NoteOccupante,
                    u.Proprieta, u.Identificativo
             FROM occupante o
             INNER JOIN unita u ON u.IdUnita = o.IdUnita
             WHERE o.IdOccupante = ?1",
            params![id],
            mappa_occupante,
        )
        .map_err(|e| e.to_string())
    })
}

#[tauri::command]
fn aggiorna_occupante(
    state: State<AppState>,
    id_occupante: i64,
    dati: OccupanteInput,
) -> Result<Occupante, String> {
    let dati = normalizza_occupante_input(dati)?;
    with_db(&state, |conn, info| {
        verifica_unita_del_condominio(conn, dati.id_unita, info.id_condominio)?;
        verifica_sovrapposizioni(
            conn,
            dati.id_unita,
            &dati.data_inizio,
            &dati.data_fine,
            Some(id_occupante),
        )?;

        let aggiornate = conn
            .execute(
                "UPDATE occupante
                 SET IdUnita = ?1, Nominativo = ?2, DataInizio = ?3, DataFine = ?4,
                     NumComponenti = ?5, Percentuale = ?6, NoteOccupante = ?7
                 WHERE IdOccupante = ?8
                   AND IdUnita IN (
                     SELECT IdUnita FROM unita WHERE IdCondominio = ?9
                   )",
                params![
                    dati.id_unita,
                    dati.nominativo,
                    dati.data_inizio,
                    dati.data_fine,
                    dati.num_componenti,
                    dati.percentuale,
                    dati.note_occupante,
                    id_occupante,
                    info.id_condominio
                ],
            )
            .map_err(|e| e.to_string())?;

        if aggiornate == 0 {
            return Err("Occupante non trovato.".into());
        }

        conn.query_row(
            "SELECT o.IdOccupante, o.IdUnita, o.Nominativo, o.DataInizio, o.DataFine,
                    o.NumComponenti, o.Percentuale, o.NoteOccupante,
                    u.Proprieta, u.Identificativo
             FROM occupante o
             INNER JOIN unita u ON u.IdUnita = o.IdUnita
             WHERE o.IdOccupante = ?1",
            params![id_occupante],
            mappa_occupante,
        )
        .map_err(|e| e.to_string())
    })
}

#[tauri::command]
fn elimina_occupante(state: State<AppState>, id_occupante: i64) -> Result<(), String> {
    with_db(&state, |conn, info| {
        let eliminate = conn
            .execute(
                "DELETE FROM occupante
                 WHERE IdOccupante = ?1
                   AND IdUnita IN (
                     SELECT IdUnita FROM unita WHERE IdCondominio = ?2
                   )",
                params![id_occupante, info.id_condominio],
            )
            .map_err(|e| e.to_string())?;

        if eliminate == 0 {
            return Err("Occupante non trovato.".into());
        }
        Ok(())
    })
}

const RIPARTIZIONI: &[&str] = &["Millesimi", "Parti"];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TipologiaSpesa {
    pub id_tipologia_spesa: i64,
    pub gruppo_spesa: String,
    pub ripartizione: String,
    pub note_tipologia_spesa: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TipologiaSpesaInput {
    pub gruppo_spesa: String,
    pub ripartizione: String,
    pub note_tipologia_spesa: String,
}

fn normalizza_tipologia_input(input: TipologiaSpesaInput) -> Result<TipologiaSpesaInput, String> {
    let gruppo_spesa = input.gruppo_spesa.trim().to_string();
    if gruppo_spesa.is_empty() {
        return Err("Il gruppo spesa è obbligatorio (es. Acqua, Luce, Pulizia).".into());
    }

    let ripartizione = input.ripartizione.trim().to_string();
    if !RIPARTIZIONI.iter().any(|v| *v == ripartizione) {
        return Err("Ripartizione non valida. Scegli Millesimi o Parti.".into());
    }

    Ok(TipologiaSpesaInput {
        gruppo_spesa,
        ripartizione,
        note_tipologia_spesa: input.note_tipologia_spesa.trim().to_string(),
    })
}

fn mappa_tipologia(row: &rusqlite::Row<'_>) -> rusqlite::Result<TipologiaSpesa> {
    Ok(TipologiaSpesa {
        id_tipologia_spesa: row.get(0)?,
        gruppo_spesa: row.get(1)?,
        ripartizione: row.get(2)?,
        note_tipologia_spesa: row.get(3)?,
    })
}

#[tauri::command]
fn elenco_tipologie_spesa(state: State<AppState>) -> Result<Vec<TipologiaSpesa>, String> {
    with_db(&state, |conn, _info| {
        let mut stmt = conn
            .prepare(
                "SELECT IdTipologiaSpesa, GruppoSpesa, Ripartizione, NoteTipologiaSpesa
                 FROM tipologia_spesa
                 ORDER BY GruppoSpesa, IdTipologiaSpesa",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], mappa_tipologia)
            .map_err(|e| e.to_string())?;

        let mut lista = Vec::new();
        for row in rows {
            lista.push(row.map_err(|e| e.to_string())?);
        }
        Ok(lista)
    })
}

#[tauri::command]
fn crea_tipologia_spesa(
    state: State<AppState>,
    dati: TipologiaSpesaInput,
) -> Result<TipologiaSpesa, String> {
    let dati = normalizza_tipologia_input(dati)?;
    with_db(&state, |conn, _info| {
        conn.execute(
            "INSERT INTO tipologia_spesa (GruppoSpesa, Ripartizione, NoteTipologiaSpesa)
             VALUES (?1, ?2, ?3)",
            params![dati.gruppo_spesa, dati.ripartizione, dati.note_tipologia_spesa],
        )
        .map_err(|e| e.to_string())?;

        let id = conn.last_insert_rowid();
        Ok(TipologiaSpesa {
            id_tipologia_spesa: id,
            gruppo_spesa: dati.gruppo_spesa,
            ripartizione: dati.ripartizione,
            note_tipologia_spesa: dati.note_tipologia_spesa,
        })
    })
}

#[tauri::command]
fn aggiorna_tipologia_spesa(
    state: State<AppState>,
    id_tipologia_spesa: i64,
    dati: TipologiaSpesaInput,
) -> Result<TipologiaSpesa, String> {
    let dati = normalizza_tipologia_input(dati)?;
    with_db(&state, |conn, _info| {
        let aggiornate = conn
            .execute(
                "UPDATE tipologia_spesa
                 SET GruppoSpesa = ?1, Ripartizione = ?2, NoteTipologiaSpesa = ?3
                 WHERE IdTipologiaSpesa = ?4",
                params![
                    dati.gruppo_spesa,
                    dati.ripartizione,
                    dati.note_tipologia_spesa,
                    id_tipologia_spesa
                ],
            )
            .map_err(|e| e.to_string())?;

        if aggiornate == 0 {
            return Err("Tipologia di spesa non trovata.".into());
        }

        Ok(TipologiaSpesa {
            id_tipologia_spesa,
            gruppo_spesa: dati.gruppo_spesa,
            ripartizione: dati.ripartizione,
            note_tipologia_spesa: dati.note_tipologia_spesa,
        })
    })
}

#[tauri::command]
fn elimina_tipologia_spesa(
    state: State<AppState>,
    id_tipologia_spesa: i64,
) -> Result<(), String> {
    with_db(&state, |conn, _info| {
        let in_uso: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM spesa WHERE IdTipologia = ?1",
                params![id_tipologia_spesa],
                |row| row.get(0),
            )
            .unwrap_or(0);
        if in_uso > 0 {
            return Err(
                "Non puoi eliminare questa categoria: ci sono spese collegate.".into(),
            );
        }

        let eliminate = conn
            .execute(
                "DELETE FROM tipologia_spesa WHERE IdTipologiaSpesa = ?1",
                params![id_tipologia_spesa],
            )
            .map_err(|e| e.to_string())?;

        if eliminate == 0 {
            return Err("Tipologia di spesa non trovata.".into());
        }
        Ok(())
    })
}

const STATI_SPESA: &[&str] = &["ATTIVA", "ARCHIVIATA"];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Spesa {
    pub id_spesa: i64,
    pub id_tipologia: i64,
    pub spesa_da: String,
    pub spesa_a: String,
    pub cifra: f64,
    pub spese_pagamento: f64,
    pub descrizione: String,
    pub stato: String,
    pub data_emissione: String,
    pub num_fattura: String,
    pub note_spesa: String,
    pub gestione: String,
    /// Nome file relativo nella cartella `{db}_allegati` (es. spesa_12.pdf).
    #[serde(default)]
    pub percorso_allegato: String,
    pub gruppo_spesa: String,
    pub giorni: i64,
    /// True se esiste almeno un periodo di riparto per questa spesa.
    #[serde(default)]
    pub ha_periodi: bool,
    /// True se ci sono periodi e solo alcuni sono archiviati (Stato resta ATTIVA, UI gialla).
    #[serde(default)]
    pub archivia_parziale: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpesaInput {
    pub id_tipologia: i64,
    pub spesa_da: String,
    pub spesa_a: String,
    pub cifra: f64,
    pub spese_pagamento: f64,
    pub descrizione: String,
    pub stato: String,
    pub data_emissione: String,
    pub num_fattura: String,
    pub note_spesa: String,
    #[serde(default)]
    pub gestione: String,
}

fn normalizza_spesa_input(input: SpesaInput) -> Result<SpesaInput, String> {
    let spesa_da = input.spesa_da.trim().to_string();
    let spesa_a = input.spesa_a.trim().to_string();
    if !data_valida(&spesa_da) || !data_valida(&spesa_a) {
        return Err("Le date SpesaDa e SpesaA devono essere nel formato AAAA-MM-GG.".into());
    }
    if spesa_a < spesa_da {
        return Err("SpesaA non può essere precedente a SpesaDa.".into());
    }
    if !input.cifra.is_finite() {
        return Err("La cifra deve essere un numero valido (può essere negativa per i rimborsi).".into());
    }
    if !input.spese_pagamento.is_finite() {
        return Err("Spese pagamento deve essere un numero valido.".into());
    }

    let stato = input.stato.trim().to_string();
    if !STATI_SPESA.iter().any(|v| *v == stato) {
        return Err(format!(
            "Stato non valido. Scegli uno tra: {}.",
            STATI_SPESA.join(", ")
        ));
    }

    let data_emissione = input.data_emissione.trim().to_string();
    if !data_emissione.is_empty() && !data_valida(&data_emissione) {
        return Err("Data emissione non valida. Usa AAAA-MM-GG oppure lasciala vuota.".into());
    }

    Ok(SpesaInput {
        id_tipologia: input.id_tipologia,
        spesa_da,
        spesa_a,
        cifra: input.cifra,
        spese_pagamento: input.spese_pagamento,
        descrizione: input.descrizione.trim().to_string(),
        stato,
        data_emissione,
        num_fattura: input.num_fattura.trim().to_string(),
        note_spesa: input.note_spesa.trim().to_string(),
        gestione: input.gestione.trim().to_string(),
    })
}

fn verifica_tipologia_esiste(conn: &Connection, id_tipologia: i64) -> Result<(), String> {
    let esiste: Option<i64> = conn
        .query_row(
            "SELECT IdTipologiaSpesa FROM tipologia_spesa WHERE IdTipologiaSpesa = ?1",
            params![id_tipologia],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if esiste.is_none() {
        return Err("Categoria/tipologia di spesa non trovata. Creane una prima.".into());
    }
    Ok(())
}

fn mappa_spesa(row: &rusqlite::Row<'_>) -> rusqlite::Result<Spesa> {
    let spesa_da: String = row.get(2)?;
    let spesa_a: String = row.get(3)?;
    let giorni = riparto::giorni_inclusivi(&spesa_da, &spesa_a).unwrap_or(0);
    Ok(Spesa {
        id_spesa: row.get(0)?,
        id_tipologia: row.get(1)?,
        spesa_da,
        spesa_a,
        cifra: row.get(4)?,
        spese_pagamento: row.get(5)?,
        descrizione: row.get(6)?,
        stato: row.get(7)?,
        data_emissione: row.get(8)?,
        num_fattura: row.get(9)?,
        note_spesa: row.get(10)?,
        gestione: row.get(11)?,
        percorso_allegato: row.get(12)?,
        gruppo_spesa: row.get(13)?,
        giorni,
        ha_periodi: false,
        archivia_parziale: false,
    })
}

fn arricchisci_flag_archivia_parziale(
    conn: &Connection,
    mut spesa: Spesa,
) -> Result<Spesa, String> {
    let (n, a) = riparto::conteggio_archivia_periodi(conn, spesa.id_spesa)?;
    spesa.ha_periodi = n > 0;
    spesa.archivia_parziale = n > 0 && a > 0 && a < n;
    Ok(spesa)
}

#[tauri::command]
fn elenco_spese(state: State<AppState>) -> Result<Vec<Spesa>, String> {
    with_db(&state, |conn, _info| {
        let mut stmt = conn
            .prepare(
                "SELECT s.IdSpesa, s.IdTipologia, s.SpesaDa, s.SpesaA, s.Cifra, s.SpesePagamento,
                        s.Descrizione, s.Stato, s.DataEmissione, s.NumFattura, s.NoteSpesa,
                        s.Gestione, s.PercorsoAllegato, t.GruppoSpesa
                 FROM spesa s
                 INNER JOIN tipologia_spesa t ON t.IdTipologiaSpesa = s.IdTipologia
                 ORDER BY t.GruppoSpesa ASC, s.SpesaDa ASC, s.IdSpesa ASC",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], mappa_spesa)
            .map_err(|e| e.to_string())?;

        let mut lista = Vec::new();
        for row in rows {
            let spesa = row.map_err(|e| e.to_string())?;
            lista.push(arricchisci_flag_archivia_parziale(conn, spesa)?);
        }
        Ok(lista)
    })
}

#[tauri::command]
fn crea_spesa(state: State<AppState>, dati: SpesaInput) -> Result<Spesa, String> {
    let dati = normalizza_spesa_input(dati)?;
    with_db(&state, |conn, _info| {
        verifica_tipologia_esiste(conn, dati.id_tipologia)?;

        conn.execute(
            "INSERT INTO spesa (
                IdTipologia, SpesaDa, SpesaA, Cifra, SpesePagamento,
                Descrizione, Stato, DataEmissione, NumFattura, NoteSpesa, Gestione
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                dati.id_tipologia,
                dati.spesa_da,
                dati.spesa_a,
                dati.cifra,
                dati.spese_pagamento,
                dati.descrizione,
                dati.stato,
                dati.data_emissione,
                dati.num_fattura,
                dati.note_spesa,
                dati.gestione
            ],
        )
        .map_err(|e| e.to_string())?;

        let id = conn.last_insert_rowid();
        let spesa = conn
            .query_row(
                "SELECT s.IdSpesa, s.IdTipologia, s.SpesaDa, s.SpesaA, s.Cifra, s.SpesePagamento,
                        s.Descrizione, s.Stato, s.DataEmissione, s.NumFattura, s.NoteSpesa,
                        s.Gestione, s.PercorsoAllegato, t.GruppoSpesa
                 FROM spesa s
                 INNER JOIN tipologia_spesa t ON t.IdTipologiaSpesa = s.IdTipologia
                 WHERE s.IdSpesa = ?1",
                params![id],
                mappa_spesa,
            )
            .map_err(|e| e.to_string())?;
        arricchisci_flag_archivia_parziale(conn, spesa)
    })
}

#[tauri::command]
fn aggiorna_spesa(
    state: State<AppState>,
    id_spesa: i64,
    dati: SpesaInput,
) -> Result<Spesa, String> {
    let dati = normalizza_spesa_input(dati)?;
    with_db(&state, |conn, _info| {
        verifica_tipologia_esiste(conn, dati.id_tipologia)?;

        let aggiornate = conn
            .execute(
                "UPDATE spesa
                 SET IdTipologia = ?1, SpesaDa = ?2, SpesaA = ?3, Cifra = ?4,
                     SpesePagamento = ?5, Descrizione = ?6, Stato = ?7,
                     DataEmissione = ?8, NumFattura = ?9, NoteSpesa = ?10, Gestione = ?11
                 WHERE IdSpesa = ?12",
                params![
                    dati.id_tipologia,
                    dati.spesa_da,
                    dati.spesa_a,
                    dati.cifra,
                    dati.spese_pagamento,
                    dati.descrizione,
                    dati.stato,
                    dati.data_emissione,
                    dati.num_fattura,
                    dati.note_spesa,
                    dati.gestione,
                    id_spesa
                ],
            )
            .map_err(|e| e.to_string())?;

        if aggiornate == 0 {
            return Err("Spesa non trovata.".into());
        }

        // Se ci sono periodi, lo stato segue le regole di archiviazione periodi.
        riparto::sincronizza_stato_spesa_da_periodi(conn, id_spesa)?;

        let spesa = conn
            .query_row(
                "SELECT s.IdSpesa, s.IdTipologia, s.SpesaDa, s.SpesaA, s.Cifra, s.SpesePagamento,
                        s.Descrizione, s.Stato, s.DataEmissione, s.NumFattura, s.NoteSpesa,
                        s.Gestione, s.PercorsoAllegato, t.GruppoSpesa
                 FROM spesa s
                 INNER JOIN tipologia_spesa t ON t.IdTipologiaSpesa = s.IdTipologia
                 WHERE s.IdSpesa = ?1",
                params![id_spesa],
                mappa_spesa,
            )
            .map_err(|e| e.to_string())?;
        arricchisci_flag_archivia_parziale(conn, spesa)
    })
}

#[tauri::command]
fn elimina_spesa(state: State<AppState>, id_spesa: i64) -> Result<(), String> {
    let db_path = state
        .percorso
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or_else(|| "Nessun condominio aperto.".to_string())?;

    let vecchio_rel = with_db(&state, |conn, _info| {
        let rel: String = conn
            .query_row(
                "SELECT PercorsoAllegato FROM spesa WHERE IdSpesa = ?1",
                params![id_spesa],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Spesa non trovata.".to_string())?;

        let eliminate = conn
            .execute("DELETE FROM spesa WHERE IdSpesa = ?1", params![id_spesa])
            .map_err(|e| e.to_string())?;
        if eliminate == 0 {
            return Err("Spesa non trovata.".into());
        }
        Ok(rel)
    })?;

    if !vecchio_rel.trim().is_empty() {
        let _ = elimina_file_allegato(&db_path, &vecchio_rel);
    }
    Ok(())
}

/* ——— Allegati bolletta (PDF in cartella accanto al database) ——— */

fn cartella_allegati(db_path: &Path) -> PathBuf {
    let stem = db_path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "condominio".into());
    let parent = db_path.parent().unwrap_or_else(|| Path::new("."));
    parent.join(format!("{stem}_allegati"))
}

fn assicura_cartella_allegati(db_path: &Path) -> Result<PathBuf, String> {
    let dir = cartella_allegati(db_path);
    fs::create_dir_all(&dir).map_err(|e| format!("Impossibile creare la cartella allegati: {e}"))?;
    Ok(dir)
}

/// Accetta solo un nome file semplice (niente percorsi), per sicurezza.
fn nome_allegato_sicuro(relativo: &str) -> Result<String, String> {
    let nome = relativo.trim().replace('\\', "/");
    if nome.is_empty() || nome.contains('/') || nome == "." || nome == ".." {
        return Err("Nome allegato non valido.".into());
    }
    if Path::new(&nome).file_name().and_then(|s| s.to_str()) != Some(nome.as_str()) {
        return Err("Nome allegato non valido.".into());
    }
    Ok(nome)
}

fn percorso_assoluto_allegato(db_path: &Path, relativo: &str) -> Result<PathBuf, String> {
    let nome = nome_allegato_sicuro(relativo)?;
    Ok(cartella_allegati(db_path).join(nome))
}

fn elimina_file_allegato(db_path: &Path, relativo: &str) -> Result<(), String> {
    let path = percorso_assoluto_allegato(db_path, relativo)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("Impossibile eliminare il file allegato: {e}"))?;
    }
    Ok(())
}

fn estensione_pdf(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("pdf"))
        .unwrap_or(false)
}

fn leggi_spesa_completa(conn: &Connection, id_spesa: i64) -> Result<Spesa, String> {
    let spesa = conn
        .query_row(
            "SELECT s.IdSpesa, s.IdTipologia, s.SpesaDa, s.SpesaA, s.Cifra, s.SpesePagamento,
                    s.Descrizione, s.Stato, s.DataEmissione, s.NumFattura, s.NoteSpesa,
                    s.Gestione, s.PercorsoAllegato, t.GruppoSpesa
             FROM spesa s
             INNER JOIN tipologia_spesa t ON t.IdTipologiaSpesa = s.IdTipologia
             WHERE s.IdSpesa = ?1",
            params![id_spesa],
            mappa_spesa,
        )
        .map_err(|_| "Spesa non trovata.".to_string())?;
    arricchisci_flag_archivia_parziale(conn, spesa)
}

/// Copia un PDF scelto dall’utente nella cartella allegati e lo collega alla spesa.
#[tauri::command]
fn allega_bolletta_spesa(
    app: AppHandle,
    state: State<AppState>,
    id_spesa: i64,
) -> Result<Spesa, String> {
    let db_path = state
        .percorso
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or_else(|| "Nessun condominio aperto.".to_string())?;

    // Verifica che la spesa esista prima del dialog.
    let vecchio_rel = with_db(&state, |conn, _info| {
        let rel: String = conn
            .query_row(
                "SELECT PercorsoAllegato FROM spesa WHERE IdSpesa = ?1",
                params![id_spesa],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Spesa non trovata.".to_string())?;
        Ok(rel)
    })?;

    let scelto = app
        .dialog()
        .file()
        .add_filter("Bolletta PDF", &["pdf"])
        .set_title("Seleziona bolletta PDF")
        .blocking_pick_file();

    let Some(fp) = scelto else {
        return Err("Nessun file selezionato.".into());
    };
    let sorgente = PathBuf::from(file_path_to_string(fp)?);
    if !sorgente.exists() {
        return Err("Il file selezionato non esiste.".into());
    }
    if !estensione_pdf(&sorgente) {
        return Err("Puoi allegare solo file PDF.".into());
    }

    let dir = assicura_cartella_allegati(&db_path)?;
    let nome_dest = format!("spesa_{id_spesa}.pdf");
    let destinazione = dir.join(&nome_dest);

    fs::copy(&sorgente, &destinazione)
        .map_err(|e| format!("Impossibile copiare il PDF nella cartella allegati: {e}"))?;

    // Se c’era un allegato con nome diverso, prova a rimuoverlo.
    if !vecchio_rel.trim().is_empty() && vecchio_rel.trim() != nome_dest {
        let _ = elimina_file_allegato(&db_path, &vecchio_rel);
    }

    with_db(&state, |conn, _info| {
        conn.execute(
            "UPDATE spesa SET PercorsoAllegato = ?1 WHERE IdSpesa = ?2",
            params![nome_dest, id_spesa],
        )
        .map_err(|e| e.to_string())?;
        leggi_spesa_completa(conn, id_spesa)
    })
}

/// Apre la bolletta con il programma predefinito del sistema.
#[tauri::command]
fn apri_bolletta_spesa(state: State<AppState>, id_spesa: i64) -> Result<(), String> {
    let db_path = state
        .percorso
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or_else(|| "Nessun condominio aperto.".to_string())?;

    let relativo = with_db(&state, |conn, _info| {
        conn.query_row(
            "SELECT PercorsoAllegato FROM spesa WHERE IdSpesa = ?1",
            params![id_spesa],
            |row| row.get::<_, String>(0),
        )
        .map_err(|_| "Spesa non trovata.".to_string())
    })?;

    if relativo.trim().is_empty() {
        return Err("Questa spesa non ha una bolletta allegata.".into());
    }

    let path = percorso_assoluto_allegato(&db_path, &relativo)?;
    if !path.exists() {
        return Err(format!(
            "File non trovato: {}. Controlla la cartella allegati accanto al database.",
            path.display()
        ));
    }

    tauri_plugin_opener::open_path(path, None::<&str>)
        .map_err(|e| format!("Impossibile aprire la bolletta: {e}"))
}

/// Rimuove il collegamento e cancella il file PDF dalla cartella allegati.
#[tauri::command]
fn rimuovi_bolletta_spesa(state: State<AppState>, id_spesa: i64) -> Result<Spesa, String> {
    let db_path = state
        .percorso
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or_else(|| "Nessun condominio aperto.".to_string())?;

    let vecchio_rel = with_db(&state, |conn, _info| {
        let rel: String = conn
            .query_row(
                "SELECT PercorsoAllegato FROM spesa WHERE IdSpesa = ?1",
                params![id_spesa],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Spesa non trovata.".to_string())?;

        conn.execute(
            "UPDATE spesa SET PercorsoAllegato = '' WHERE IdSpesa = ?1",
            params![id_spesa],
        )
        .map_err(|e| e.to_string())?;

        Ok(rel)
    })?;

    if !vecchio_rel.trim().is_empty() {
        let _ = elimina_file_allegato(&db_path, &vecchio_rel);
    }

    with_db(&state, |conn, _info| leggi_spesa_completa(conn, id_spesa))
}

#[tauri::command]
fn elenco_recenti(app: AppHandle) -> Result<Vec<Recente>, String> {
    let mut lista = carica_recenti(&app)?;
    lista.retain(|r| Path::new(&r.percorso).exists());
    salva_recenti(&app, &lista)?;
    Ok(lista)
}

#[tauri::command]
fn rimuovi_recente(app: AppHandle, percorso: String) -> Result<(), String> {
    let mut lista = carica_recenti(&app)?;
    lista.retain(|r| r.percorso != percorso);
    salva_recenti(&app, &lista)
}

fn file_path_to_string(file_path: tauri_plugin_dialog::FilePath) -> Result<String, String> {
    let path = file_path
        .into_path()
        .map_err(|e| format!("Percorso non valido: {e}"))?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn scegli_percorso_salvataggio(
    app: AppHandle,
    nome_default: String,
) -> Result<Option<String>, String> {
    let file_name = if nome_default.to_lowercase().ends_with(".db") {
        nome_default
    } else {
        format!("{nome_default}.db")
    };

    let scelto = app
        .dialog()
        .file()
        .add_filter("Database condominio", &["db"])
        .set_file_name(&file_name)
        .set_title("Salva database condominio")
        .blocking_save_file();

    match scelto {
        Some(fp) => Ok(Some(file_path_to_string(fp)?)),
        None => Ok(None),
    }
}

#[tauri::command]
fn scegli_percorso_apertura(app: AppHandle) -> Result<Option<String>, String> {
    let scelto = app
        .dialog()
        .file()
        .add_filter("Database condominio", &["db"])
        .set_title("Apri database condominio")
        .blocking_pick_file();

    match scelto {
        Some(fp) => Ok(Some(file_path_to_string(fp)?)),
        None => Ok(None),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(AppState::new())
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                use tauri::Manager;
                if let Some(win) = app.get_webview_window("main") {
                    win.open_devtools();
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            crea_condominio,
            apri_condominio,
            chiudi_condominio,
            stato_condominio,
            apri_cartella_database,
            aggiorna_condominio,
            elenco_unita,
            crea_unita,
            aggiorna_unita,
            elimina_unita,
            get_unita,
            elenco_occupanti,
            crea_occupante,
            aggiorna_occupante,
            elimina_occupante,
            elenco_tipologie_spesa,
            crea_tipologia_spesa,
            aggiorna_tipologia_spesa,
            elimina_tipologia_spesa,
            elenco_spese,
            crea_spesa,
            aggiorna_spesa,
            elimina_spesa,
            allega_bolletta_spesa,
            apri_bolletta_spesa,
            rimuovi_bolletta_spesa,
            riparto::dettaglio_riparto_spesa,
            riparto::proponi_periodo_spesa,
            riparto::crea_periodo_spesa,
            riparto::elimina_periodo_spesa,
            riparto::aggiorna_quote_periodo,
            report::report_spese_conteggiate,
            report::report_rendiconti_archiviati_opzioni,
            report::report_spese_archiviate_per_rendiconto,
            report::report_ripartizione_archiviati_per_rendiconto,
            report::report_ripartizione_spese_conteggiate,
            report::report_riepilogo_ripartizione,
            rate::elenco_occupanti_correnti,
            rate::elenco_rate_occupante,
            rate::crea_rata_condominiale,
            rate::aggiorna_rata_condominiale,
            rate::elimina_rata_condominiale,
            rate::riepilogo_rendiconto_occupante,
            rate::conguaglio_occupanti,
            elenco_recenti,
            rimuovi_recente,
            scegli_percorso_salvataggio,
            scegli_percorso_apertura,
        ])
        .run(tauri::generate_context!())
        .expect("errore durante l'avvio dell'applicazione");
}
