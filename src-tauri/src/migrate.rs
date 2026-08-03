//! Aggiornamento automatico della struttura del database.
//!
//! Quando aggiungi un campo o una tabella:
//! 1. Alza `SCHEMA_VERSION` di 1
//! 2. Aggiungi una funzione `migrate_to_N` qui sotto
//! 3. Registrala in `applica_migrazione`
//!
//! All'apertura di un file vecchio l'app esegue le migrazioni mancanti
//! e i dati già salvati restano disponibili.

use rusqlite::{Connection, OptionalExtension, params};

/// Versione attuale dello schema. Aumentala quando cambi le tabelle.
pub const SCHEMA_VERSION: i32 = 15;

pub fn leggi_versione(conn: &Connection) -> Result<i32, String> {
    let valore: Option<String> = conn
        .query_row(
            "SELECT valore FROM meta WHERE chiave = 'schema_version'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    match valore {
        Some(v) => v
            .parse::<i32>()
            .map_err(|_| format!("Versione database non valida: {v}")),
        None => Ok(0),
    }
}

pub fn imposta_versione(conn: &Connection, versione: i32) -> Result<(), String> {
    conn.execute(
        "INSERT OR REPLACE INTO meta (chiave, valore) VALUES ('schema_version', ?1)",
        params![versione.to_string()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Crea le tabelle della versione attuale (usato per un database nuovo).
pub fn crea_schema_attuale(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS meta (
            chiave TEXT PRIMARY KEY NOT NULL,
            valore TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS condominio (
            IdCondominio INTEGER PRIMARY KEY AUTOINCREMENT,
            NomeCondominio TEXT NOT NULL,
            NoteCondominio TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS unita (
            IdUnita INTEGER PRIMARY KEY AUTOINCREMENT,
            IdCondominio INTEGER NOT NULL,
            Proprieta TEXT NOT NULL DEFAULT '',
            Identificativo TEXT NOT NULL DEFAULT '',
            Subalterno TEXT NOT NULL DEFAULT '',
            Piano TEXT NOT NULL DEFAULT '',
            Millesimi REAL NOT NULL DEFAULT 0,
            Uso TEXT NOT NULL DEFAULT 'ABITAZIONE',
            NoteUnita TEXT NOT NULL DEFAULT '',
            FOREIGN KEY (IdCondominio) REFERENCES condominio(IdCondominio)
                ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS occupante (
            IdOccupante INTEGER PRIMARY KEY AUTOINCREMENT,
            IdUnita INTEGER NOT NULL,
            Nominativo TEXT NOT NULL,
            DataInizio TEXT NOT NULL,
            DataFine TEXT NOT NULL DEFAULT '',
            NumComponenti INTEGER NOT NULL DEFAULT 1,
            Percentuale REAL NOT NULL DEFAULT 0,
            NoteOccupante TEXT NOT NULL DEFAULT '',
            FOREIGN KEY (IdUnita) REFERENCES unita(IdUnita)
                ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS tipologia_spesa (
            IdTipologiaSpesa INTEGER PRIMARY KEY AUTOINCREMENT,
            GruppoSpesa TEXT NOT NULL,
            Ripartizione TEXT NOT NULL DEFAULT 'Millesimi',
            NoteTipologiaSpesa TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS spesa (
            IdSpesa INTEGER PRIMARY KEY AUTOINCREMENT,
            IdTipologia INTEGER NOT NULL,
            SpesaDa TEXT NOT NULL,
            SpesaA TEXT NOT NULL,
            Cifra REAL NOT NULL DEFAULT 0,
            SpesePagamento REAL NOT NULL DEFAULT 0,
            Descrizione TEXT NOT NULL DEFAULT '',
            Stato TEXT NOT NULL DEFAULT 'ATTIVA',
            DataEmissione TEXT NOT NULL DEFAULT '',
            NumFattura TEXT NOT NULL DEFAULT '',
            NoteSpesa TEXT NOT NULL DEFAULT '',
            Gestione TEXT NOT NULL DEFAULT '',
            PercorsoAllegato TEXT NOT NULL DEFAULT '',
            FOREIGN KEY (IdTipologia) REFERENCES tipologia_spesa(IdTipologiaSpesa)
        );

        CREATE TABLE IF NOT EXISTS periodo_spesa (
            IdPeriodo INTEGER PRIMARY KEY AUTOINCREMENT,
            IdSpesa INTEGER NOT NULL,
            PeriodoDa TEXT NOT NULL,
            PeriodoA TEXT NOT NULL,
            Giorni INTEGER NOT NULL,
            Importo REAL NOT NULL,
            Archivia INTEGER NOT NULL DEFAULT 0,
            RendicontoDel TEXT NOT NULL DEFAULT '',
            FOREIGN KEY (IdSpesa) REFERENCES spesa(IdSpesa) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS riparto_periodo (
            IdRiparto INTEGER PRIMARY KEY AUTOINCREMENT,
            IdPeriodo INTEGER NOT NULL,
            IdOccupante INTEGER NOT NULL,
            IdUnita INTEGER NOT NULL,
            Nominativo TEXT NOT NULL,
            Percentuale REAL NOT NULL DEFAULT 0,
            Peso REAL NOT NULL DEFAULT 0,
            BaseCalcolo REAL NOT NULL DEFAULT 0,
            Importo REAL NOT NULL DEFAULT 0,
            FOREIGN KEY (IdPeriodo) REFERENCES periodo_spesa(IdPeriodo) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS rate_condominiali (
            IdRata INTEGER PRIMARY KEY AUTOINCREMENT,
            IdOccupante INTEGER NOT NULL,
            RataDa TEXT NOT NULL,
            RataA TEXT NOT NULL,
            Versato REAL NOT NULL DEFAULT 0,
            NoteRata TEXT NOT NULL DEFAULT '',
            Rendiconto TEXT NOT NULL DEFAULT '',
            FOREIGN KEY (IdOccupante) REFERENCES occupante(IdOccupante) ON DELETE CASCADE
        );
        ",
    )
    .map_err(|e| format!("Errore creazione tabelle: {e}"))?;

    imposta_versione(conn, SCHEMA_VERSION)
}

/// Porta il database alla versione attuale, passo dopo passo.
pub fn migra_se_serve(conn: &Connection) -> Result<(), String> {
    assicura_tabella_meta(conn)?;

    let mut versione = leggi_versione(conn)?;

    if versione > SCHEMA_VERSION {
        return Err(format!(
            "Questo file richiede una versione più recente del programma \
             (database {versione}, app {SCHEMA_VERSION}). Aggiorna l'applicazione."
        ));
    }

    while versione < SCHEMA_VERSION {
        let prossima = versione + 1;
        applica_migrazione(conn, prossima)?;
        imposta_versione(conn, prossima)?;
        versione = prossima;
    }

    Ok(())
}

fn assicura_tabella_meta(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS meta (
            chiave TEXT PRIMARY KEY NOT NULL,
            valore TEXT NOT NULL
        );
        ",
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn applica_migrazione(conn: &Connection, verso: i32) -> Result<(), String> {
    match verso {
        1 => migrate_to_1(conn),
        2 => migrate_to_2(conn),
        3 => migrate_to_3(conn),
        4 => migrate_to_4(conn),
        5 => migrate_to_5(conn),
        6 => migrate_to_6(conn),
        7 => migrate_to_7(conn),
        8 => migrate_to_8(conn),
        9 => migrate_to_9(conn),
        10 => migrate_to_10(conn),
        11 => migrate_to_11(conn),
        12 => migrate_to_12(conn),
        13 => migrate_to_13(conn),
        14 => migrate_to_14(conn),
        15 => migrate_to_15(conn),
        altra => Err(format!("Migrazione verso la versione {altra} non definita.")),
    }
}

/// Versione 1 storica (solo condominio “semplice”).
fn migrate_to_1(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS condominio (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            nome TEXT NOT NULL,
            indirizzo TEXT NOT NULL DEFAULT '',
            note TEXT NOT NULL DEFAULT '',
            creato_il TEXT NOT NULL,
            aggiornato_il TEXT NOT NULL
        );
        ",
    )
    .map_err(|e| format!("Migrazione a v1 fallita: {e}"))?;
    Ok(())
}

/// Versione 2: nomi campi italiani + tabella unità.
fn migrate_to_2(conn: &Connection) -> Result<(), String> {
    // Se esiste ancora la vecchia tabella (colonne id/nome), la converte.
    if tabella_esiste(conn, "condominio")? && colonna_esiste(conn, "condominio", "nome")? {
        conn.execute_batch(
            "
            CREATE TABLE condominio_v2 (
                IdCondominio INTEGER PRIMARY KEY AUTOINCREMENT,
                NomeCondominio TEXT NOT NULL,
                NoteCondominio TEXT NOT NULL DEFAULT ''
            );

            INSERT INTO condominio_v2 (NomeCondominio, NoteCondominio)
            SELECT nome, COALESCE(note, '') FROM condominio;

            DROP TABLE condominio;
            ALTER TABLE condominio_v2 RENAME TO condominio;
            ",
        )
        .map_err(|e| format!("Migrazione condominio v2 fallita: {e}"))?;
    } else {
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS condominio (
                IdCondominio INTEGER PRIMARY KEY AUTOINCREMENT,
                NomeCondominio TEXT NOT NULL,
                NoteCondominio TEXT NOT NULL DEFAULT ''
            );
            ",
        )
        .map_err(|e| format!("Creazione condominio v2 fallita: {e}"))?;
    }

    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS unita (
            IdUnita INTEGER PRIMARY KEY AUTOINCREMENT,
            IdCondominio INTEGER NOT NULL,
            Proprieta TEXT NOT NULL DEFAULT '',
            Piano TEXT NOT NULL DEFAULT '',
            Millesimi REAL NOT NULL DEFAULT 0,
            NoteUnita TEXT NOT NULL DEFAULT '',
            FOREIGN KEY (IdCondominio) REFERENCES condominio(IdCondominio)
                ON DELETE CASCADE
        );
        ",
    )
    .map_err(|e| format!("Creazione tabella unita fallita: {e}"))?;

    Ok(())
}

/// Versione 3: campo Uso sulle unità (default ABITAZIONE).
fn migrate_to_3(conn: &Connection) -> Result<(), String> {
    aggiungi_colonna_se_manca(conn, "unita", "Uso", "TEXT NOT NULL DEFAULT 'ABITAZIONE'")
}

/// Versione 4: Identificativo e Subalterno catastali.
fn migrate_to_4(conn: &Connection) -> Result<(), String> {
    aggiungi_colonna_se_manca(conn, "unita", "Identificativo", "TEXT NOT NULL DEFAULT ''")?;
    aggiungi_colonna_se_manca(conn, "unita", "Subalterno", "TEXT NOT NULL DEFAULT ''")?;
    Ok(())
}

/// Versione 5: tabella Occupanti (chi occupa l'unità e in quali date).
fn migrate_to_5(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS occupante (
            IdOccupante INTEGER PRIMARY KEY AUTOINCREMENT,
            IdUnita INTEGER NOT NULL,
            Nominativo TEXT NOT NULL,
            DataInizio TEXT NOT NULL,
            DataFine TEXT NOT NULL DEFAULT '',
            NumComponenti INTEGER NOT NULL DEFAULT 1,
            NoteOccupante TEXT NOT NULL DEFAULT '',
            FOREIGN KEY (IdUnita) REFERENCES unita(IdUnita)
                ON DELETE CASCADE
        );
        ",
    )
    .map_err(|e| format!("Creazione tabella occupante fallita: {e}"))?;
    Ok(())
}

/// Versione 6: tipologie/categorie di spesa.
fn migrate_to_6(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS tipologia_spesa (
            IdTipologiaSpesa INTEGER PRIMARY KEY AUTOINCREMENT,
            GruppoSpesa TEXT NOT NULL,
            Ripartizione TEXT NOT NULL DEFAULT 'Millesimi',
            NoteTipologiaSpesa TEXT NOT NULL DEFAULT ''
        );
        ",
    )
    .map_err(|e| format!("Creazione tabella tipologia_spesa fallita: {e}"))?;
    Ok(())
}

/// Versione 7: tabella Spese.
fn migrate_to_7(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS spesa (
            IdSpesa INTEGER PRIMARY KEY AUTOINCREMENT,
            IdTipologia INTEGER NOT NULL,
            SpesaDa TEXT NOT NULL,
            SpesaA TEXT NOT NULL,
            Cifra REAL NOT NULL DEFAULT 0,
            SpesePagamento REAL NOT NULL DEFAULT 0,
            Descrizione TEXT NOT NULL DEFAULT '',
            Stato TEXT NOT NULL DEFAULT 'ATTIVA',
            DataEmissione TEXT NOT NULL DEFAULT '',
            NumFattura TEXT NOT NULL DEFAULT '',
            NoteSpesa TEXT NOT NULL DEFAULT '',
            FOREIGN KEY (IdTipologia) REFERENCES tipologia_spesa(IdTipologiaSpesa)
        );
        ",
    )
    .map_err(|e| format!("Creazione tabella spesa fallita: {e}"))?;
    Ok(())
}

/// Versione 8: stati spesa ATTIVA / ARCHIVIATA.
fn migrate_to_8(conn: &Connection) -> Result<(), String> {
    // Allinea i vecchi stati alle nuove scelte.
    conn.execute_batch(
        "
        UPDATE spesa SET Stato = 'ATTIVA'
          WHERE Stato IN ('Da pagare', 'Pagata', 'ATTIVA') OR Stato IS NULL OR Stato = '';
        UPDATE spesa SET Stato = 'ARCHIVIATA'
          WHERE Stato IN ('Annullata', 'ARCHIVIATA');
        UPDATE spesa SET Stato = 'ATTIVA'
          WHERE Stato NOT IN ('ATTIVA', 'ARCHIVIATA');
        ",
    )
    .map_err(|e| format!("Aggiornamento stati spesa fallito: {e}"))?;
    Ok(())
}

/// Versione 9: periodi di ripartizione spesa e quote occupanti.
fn migrate_to_9(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS periodo_spesa (
            IdPeriodo INTEGER PRIMARY KEY AUTOINCREMENT,
            IdSpesa INTEGER NOT NULL,
            PeriodoDa TEXT NOT NULL,
            PeriodoA TEXT NOT NULL,
            Giorni INTEGER NOT NULL,
            Importo REAL NOT NULL,
            FOREIGN KEY (IdSpesa) REFERENCES spesa(IdSpesa) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS riparto_periodo (
            IdRiparto INTEGER PRIMARY KEY AUTOINCREMENT,
            IdPeriodo INTEGER NOT NULL,
            IdOccupante INTEGER NOT NULL,
            IdUnita INTEGER NOT NULL,
            Nominativo TEXT NOT NULL,
            BaseCalcolo REAL NOT NULL DEFAULT 0,
            Importo REAL NOT NULL DEFAULT 0,
            FOREIGN KEY (IdPeriodo) REFERENCES periodo_spesa(IdPeriodo) ON DELETE CASCADE
        );
        ",
    )
    .map_err(|e| format!("Creazione tabelle riparto fallita: {e}"))?;
    Ok(())
}

/// Versione 10: Percentuale sugli occupanti (per riparto spese).
fn migrate_to_10(conn: &Connection) -> Result<(), String> {
    aggiungi_colonna_se_manca(
        conn,
        "occupante",
        "Percentuale",
        "REAL NOT NULL DEFAULT 0",
    )
}

/// Versione 11: salva Percentuale e Peso (millesimi/parti) su ogni quota di riparto.
fn migrate_to_11(conn: &Connection) -> Result<(), String> {
    aggiungi_colonna_se_manca(
        conn,
        "riparto_periodo",
        "Percentuale",
        "REAL NOT NULL DEFAULT 0",
    )?;
    aggiungi_colonna_se_manca(conn, "riparto_periodo", "Peso", "REAL NOT NULL DEFAULT 0")?;
    Ok(())
}

/// Versione 12: Archivia + RendicontoDel sui periodi di riparto.
fn migrate_to_12(conn: &Connection) -> Result<(), String> {
    aggiungi_colonna_se_manca(
        conn,
        "periodo_spesa",
        "Archivia",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    aggiungi_colonna_se_manca(
        conn,
        "periodo_spesa",
        "RendicontoDel",
        "TEXT NOT NULL DEFAULT ''",
    )?;
    Ok(())
}

/// Versione 13: campo Gestione sulle spese (utile nei report).
fn migrate_to_13(conn: &Connection) -> Result<(), String> {
    aggiungi_colonna_se_manca(conn, "spesa", "Gestione", "TEXT NOT NULL DEFAULT ''")?;
    Ok(())
}

/// Versione 14: percorso relativo del PDF bolletta (cartella allegati accanto al .db).
fn migrate_to_14(conn: &Connection) -> Result<(), String> {
    aggiungi_colonna_se_manca(conn, "spesa", "PercorsoAllegato", "TEXT NOT NULL DEFAULT ''")?;
    Ok(())
}

/// Versione 15: rate condominiali collegate agli occupanti.
fn migrate_to_15(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS rate_condominiali (
            IdRata INTEGER PRIMARY KEY AUTOINCREMENT,
            IdOccupante INTEGER NOT NULL,
            RataDa TEXT NOT NULL,
            RataA TEXT NOT NULL,
            Versato REAL NOT NULL DEFAULT 0,
            NoteRata TEXT NOT NULL DEFAULT '',
            Rendiconto TEXT NOT NULL DEFAULT '',
            FOREIGN KEY (IdOccupante) REFERENCES occupante(IdOccupante) ON DELETE CASCADE
        );
        ",
    )
    .map_err(|e| format!("Creazione tabella rate_condominiali fallita: {e}"))?;
    Ok(())
}

// --- Utility utili per le migrazioni future ---

/// Controlla se una tabella esiste.
pub fn tabella_esiste(conn: &Connection, nome: &str) -> Result<bool, String> {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
            params![nome],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(count > 0)
}

/// Controlla se una colonna esiste in una tabella.
pub fn colonna_esiste(conn: &Connection, tabella: &str, colonna: &str) -> Result<bool, String> {
    // PRAGMA table_info non accetta parametri: validiamo il nome tabella.
    if !tabella
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_')
    {
        return Err("Nome tabella non valido.".into());
    }

    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({tabella})"))
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| e.to_string())?;

    for row in rows {
        let nome = row.map_err(|e| e.to_string())?;
        if nome.eq_ignore_ascii_case(colonna) {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Aggiunge una colonna solo se manca (comodo per i prossimi campi).
pub fn aggiungi_colonna_se_manca(
    conn: &Connection,
    tabella: &str,
    colonna: &str,
    definizione_sql: &str,
) -> Result<(), String> {
    if colonna_esiste(conn, tabella, colonna)? {
        return Ok(());
    }
    if !tabella
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_')
        || !colonna
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_')
    {
        return Err("Nome tabella/colonna non valido.".into());
    }

    conn.execute(
        &format!("ALTER TABLE {tabella} ADD COLUMN {colonna} {definizione_sql}"),
        [],
    )
    .map_err(|e| format!("Impossibile aggiungere {colonna} a {tabella}: {e}"))?;
    Ok(())
}
