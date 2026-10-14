//! Rate condominiali collegate agli occupanti.

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::{AppState, Occupante, with_db};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RataCondominiale {
    pub id_rata: i64,
    pub id_occupante: i64,
    pub rata_da: String,
    pub rata_a: String,
    pub versato: f64,
    pub note_rata: String,
    pub rendiconto: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RataInput {
    pub id_occupante: i64,
    pub rata_da: String,
    pub rata_a: String,
    pub versato: f64,
    pub note_rata: String,
    pub rendiconto: String,
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

fn normalizza_rata_input(input: RataInput) -> Result<RataInput, String> {
    let rata_da = input.rata_da.trim().to_string();
    let rata_a = input.rata_a.trim().to_string();
    if !data_valida(&rata_da) || !data_valida(&rata_a) {
        return Err("Le date Rata da e Rata a devono essere nel formato AAAA-MM-GG.".into());
    }
    if rata_a < rata_da {
        return Err("«Rata a» non può essere precedente a «Rata da».".into());
    }
    if !input.versato.is_finite() {
        return Err("Versato deve essere un numero valido.".into());
    }
    Ok(RataInput {
        id_occupante: input.id_occupante,
        rata_da,
        rata_a,
        versato: input.versato,
        note_rata: input.note_rata.trim().to_string(),
        rendiconto: input.rendiconto.trim().to_string(),
    })
}

fn verifica_occupante_esiste(conn: &Connection, id_occupante: i64) -> Result<(), String> {
    let esiste: Option<i64> = conn
        .query_row(
            "SELECT IdOccupante FROM occupante WHERE IdOccupante = ?1",
            params![id_occupante],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if esiste.is_none() {
        return Err("Occupante non trovato.".into());
    }
    Ok(())
}

fn mappa_rata(row: &rusqlite::Row<'_>) -> rusqlite::Result<RataCondominiale> {
    Ok(RataCondominiale {
        id_rata: row.get(0)?,
        id_occupante: row.get(1)?,
        rata_da: row.get(2)?,
        rata_a: row.get(3)?,
        versato: row.get(4)?,
        note_rata: row.get(5)?,
        rendiconto: row.get(6)?,
    })
}

fn carica_rata(conn: &Connection, id_rata: i64) -> Result<RataCondominiale, String> {
    conn.query_row(
        "SELECT IdRata, IdOccupante, RataDa, RataA, Versato, NoteRata, Rendiconto
         FROM rate_condominiali
         WHERE IdRata = ?1",
        params![id_rata],
        mappa_rata,
    )
    .map_err(|_| "Rata non trovata.".to_string())
}

/// Occupanti ancora in corso (senza data fine, oppure fine oggi o futura).
#[tauri::command]
pub fn elenco_occupanti_correnti(state: State<AppState>) -> Result<Vec<Occupante>, String> {
    with_db(&state, |conn, _info| {
        let mut stmt = conn
            .prepare(
                "SELECT o.IdOccupante, o.IdUnita, o.Nominativo, o.DataInizio, o.DataFine,
                        o.NumComponenti, o.Percentuale, o.NoteOccupante,
                        u.Proprieta, u.Identificativo
                 FROM occupante o
                 INNER JOIN unita u ON u.IdUnita = o.IdUnita
                 WHERE TRIM(o.DataFine) = ''
                    OR o.DataFine >= date('now')
                 ORDER BY u.Identificativo COLLATE NOCASE,
                          u.Proprieta COLLATE NOCASE,
                          o.Nominativo COLLATE NOCASE,
                          o.IdOccupante",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |row| {
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
            })
            .map_err(|e| e.to_string())?;

        let mut lista = Vec::new();
        for row in rows {
            lista.push(row.map_err(|e| e.to_string())?);
        }
        Ok(lista)
    })
}

#[tauri::command]
pub fn elenco_rate_occupante(
    state: State<AppState>,
    id_occupante: i64,
) -> Result<Vec<RataCondominiale>, String> {
    with_db(&state, |conn, _info| {
        verifica_occupante_esiste(conn, id_occupante)?;
        let mut stmt = conn
            .prepare(
                "SELECT IdRata, IdOccupante, RataDa, RataA, Versato, NoteRata, Rendiconto
                 FROM rate_condominiali
                 WHERE IdOccupante = ?1
                 ORDER BY RataDa DESC, IdRata DESC",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map(params![id_occupante], mappa_rata)
            .map_err(|e| e.to_string())?;

        let mut lista = Vec::new();
        for row in rows {
            lista.push(row.map_err(|e| e.to_string())?);
        }
        Ok(lista)
    })
}

#[tauri::command]
pub fn crea_rata_condominiale(
    state: State<AppState>,
    dati: RataInput,
) -> Result<RataCondominiale, String> {
    let dati = normalizza_rata_input(dati)?;
    with_db(&state, |conn, _info| {
        verifica_occupante_esiste(conn, dati.id_occupante)?;
        conn.execute(
            "INSERT INTO rate_condominiali (
                IdOccupante, RataDa, RataA, Versato, NoteRata, Rendiconto
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                dati.id_occupante,
                dati.rata_da,
                dati.rata_a,
                dati.versato,
                dati.note_rata,
                dati.rendiconto
            ],
        )
        .map_err(|e| e.to_string())?;
        let id = conn.last_insert_rowid();
        carica_rata(conn, id)
    })
}

#[tauri::command]
pub fn aggiorna_rata_condominiale(
    state: State<AppState>,
    id_rata: i64,
    dati: RataInput,
) -> Result<RataCondominiale, String> {
    let dati = normalizza_rata_input(dati)?;
    with_db(&state, |conn, _info| {
        verifica_occupante_esiste(conn, dati.id_occupante)?;
        let aggiornate = conn
            .execute(
                "UPDATE rate_condominiali
                 SET IdOccupante = ?1, RataDa = ?2, RataA = ?3,
                     Versato = ?4, NoteRata = ?5, Rendiconto = ?6
                 WHERE IdRata = ?7",
                params![
                    dati.id_occupante,
                    dati.rata_da,
                    dati.rata_a,
                    dati.versato,
                    dati.note_rata,
                    dati.rendiconto,
                    id_rata
                ],
            )
            .map_err(|e| e.to_string())?;
        if aggiornate == 0 {
            return Err("Rata non trovata.".into());
        }
        carica_rata(conn, id_rata)
    })
}

#[tauri::command]
pub fn elimina_rata_condominiale(state: State<AppState>, id_rata: i64) -> Result<(), String> {
    with_db(&state, |conn, _info| {
        let eliminate = conn
            .execute(
                "DELETE FROM rate_condominiali WHERE IdRata = ?1",
                params![id_rata],
            )
            .map_err(|e| e.to_string())?;
        if eliminate == 0 {
            return Err("Rata non trovata.".into());
        }
        Ok(())
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RiepilogoRendicontoOccupante {
    /// Vuoto = rendiconto attivo (periodi non archiviati).
    pub rendiconto: String,
    pub attivo: bool,
    pub id_occupante: i64,
    pub nominativo: String,
    pub proprieta_unita: String,
    pub identificativo_unita: String,
    /// Totale dei periodi del rendiconto (archiviato o attivo).
    pub totale_rendiconto: f64,
    /// Somma delle quote ripartite a questo occupante.
    pub quota_occupante: f64,
    /// Somma dei versamenti (rate) collegati a quel rendiconto (o senza rendiconto se attivo).
    pub totale_rate_versate: f64,
    /// quota_occupante − totale_rate_versate (positivo = ancora da versare).
    pub differenza: f64,
}

/// Confronto rendiconto: totale generale, quota dell’occupante, rate versate.
/// Se `rendiconto` è vuoto → periodi non archiviati (attivo) + rate senza rendiconto.
#[tauri::command]
pub fn riepilogo_rendiconto_occupante(
    state: State<AppState>,
    id_occupante: i64,
    rendiconto: String,
) -> Result<RiepilogoRendicontoOccupante, String> {
    let rendiconto = rendiconto.trim().to_string();
    let attivo = rendiconto.is_empty();

    with_db(&state, |conn, _info| {
        let (nominativo, proprieta, identificativo): (String, String, String) = conn
            .query_row(
                "SELECT o.Nominativo, COALESCE(u.Proprieta, ''), COALESCE(u.Identificativo, '')
                 FROM occupante o
                 LEFT JOIN unita u ON u.IdUnita = o.IdUnita
                 WHERE o.IdOccupante = ?1",
                params![id_occupante],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Occupante non trovato.".to_string())?;

        let (totale_rendiconto, quota_occupante, totale_rate_versate) = if attivo {
            // Rendiconto attivo: periodi non archiviati di spese ATTIVA.
            let totale: f64 = conn
                .query_row(
                    "SELECT COALESCE(SUM(p.Importo), 0)
                     FROM periodo_spesa p
                     INNER JOIN spesa s ON s.IdSpesa = p.IdSpesa
                     WHERE s.Stato = 'ATTIVA' AND p.Archivia = 0",
                    [],
                    |row| row.get(0),
                )
                .map_err(|e| e.to_string())?;

            let quota: f64 = conn
                .query_row(
                    "SELECT COALESCE(SUM(r.Importo * COALESCE(s.QuotaInquilino, 100) / 100.0), 0)
                     FROM riparto_periodo r
                     INNER JOIN periodo_spesa p ON p.IdPeriodo = r.IdPeriodo
                     INNER JOIN spesa s ON s.IdSpesa = p.IdSpesa
                     WHERE s.Stato = 'ATTIVA'
                       AND p.Archivia = 0
                       AND r.IdOccupante = ?1",
                    params![id_occupante],
                    |row| row.get(0),
                )
                .map_err(|e| e.to_string())?;

            // Rate senza rendiconto associato.
            let rate: f64 = conn
                .query_row(
                    "SELECT COALESCE(SUM(Versato), 0)
                     FROM rate_condominiali
                     WHERE IdOccupante = ?1 AND TRIM(COALESCE(Rendiconto, '')) = ''",
                    params![id_occupante],
                    |row| row.get(0),
                )
                .map_err(|e| e.to_string())?;

            (totale, quota, rate)
        } else {
            let totale: f64 = conn
                .query_row(
                    "SELECT COALESCE(SUM(Importo), 0)
                     FROM periodo_spesa
                     WHERE Archivia != 0 AND TRIM(RendicontoDel) = ?1",
                    params![rendiconto],
                    |row| row.get(0),
                )
                .map_err(|e| e.to_string())?;

            let quota: f64 = conn
                .query_row(
                    "SELECT COALESCE(SUM(r.Importo * COALESCE(s.QuotaInquilino, 100) / 100.0), 0)
                     FROM riparto_periodo r
                     INNER JOIN periodo_spesa p ON p.IdPeriodo = r.IdPeriodo
                     INNER JOIN spesa s ON s.IdSpesa = p.IdSpesa
                     WHERE p.Archivia != 0
                       AND TRIM(p.RendicontoDel) = ?1
                       AND r.IdOccupante = ?2",
                    params![rendiconto, id_occupante],
                    |row| row.get(0),
                )
                .map_err(|e| e.to_string())?;

            let rate: f64 = conn
                .query_row(
                    "SELECT COALESCE(SUM(Versato), 0)
                     FROM rate_condominiali
                     WHERE IdOccupante = ?1 AND TRIM(Rendiconto) = ?2",
                    params![id_occupante, rendiconto],
                    |row| row.get(0),
                )
                .map_err(|e| e.to_string())?;

            (totale, quota, rate)
        };

        let arrotonda = |v: f64| (v * 100.0).round() / 100.0;
        let totale_rendiconto = arrotonda(totale_rendiconto);
        let quota_occupante = arrotonda(quota_occupante);
        let totale_rate_versate = arrotonda(totale_rate_versate);
        let differenza = arrotonda(quota_occupante - totale_rate_versate);

        Ok(RiepilogoRendicontoOccupante {
            rendiconto,
            attivo,
            id_occupante,
            nominativo,
            proprieta_unita: proprieta,
            identificativo_unita: identificativo,
            totale_rendiconto,
            quota_occupante,
            totale_rate_versate,
            differenza,
        })
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConguaglioRiga {
    pub id_unita: i64,
    pub identificativo_unita: String,
    pub proprieta_unita: String,
    pub id_occupante: i64,
    pub nominativo: String,
    pub quota_spettante: f64,
    pub totale_rate_versate: f64,
    pub differenza: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConguaglioOccupanti {
    /// Vuoto = rendiconto attivo.
    pub rendiconto: String,
    pub attivo: bool,
    pub righe: Vec<ConguaglioRiga>,
    pub totale_quote: f64,
    pub totale_rate: f64,
    pub totale_differenza: f64,
}

/// Conguaglio per tutti gli occupanti correnti (stessa logica del riepilogo rate).
#[tauri::command]
pub fn conguaglio_occupanti(
    state: State<AppState>,
    rendiconto: String,
) -> Result<ConguaglioOccupanti, String> {
    let rendiconto = rendiconto.trim().to_string();
    let attivo = rendiconto.is_empty();
    let arrotonda = |v: f64| (v * 100.0).round() / 100.0;

    with_db(&state, |conn, _info| {
        let sql = if attivo {
            "SELECT o.IdOccupante, o.IdUnita, o.Nominativo,
                    COALESCE(u.Proprieta, ''), COALESCE(u.Identificativo, ''),
                    COALESCE(q.Quota, 0), COALESCE(v.Versato, 0)
             FROM occupante o
             INNER JOIN unita u ON u.IdUnita = o.IdUnita
             LEFT JOIN (
                 SELECT r.IdOccupante, SUM(r.Importo * COALESCE(s.QuotaInquilino, 100) / 100.0) AS Quota
                 FROM riparto_periodo r
                 INNER JOIN periodo_spesa p ON p.IdPeriodo = r.IdPeriodo
                 INNER JOIN spesa s ON s.IdSpesa = p.IdSpesa
                 WHERE s.Stato = 'ATTIVA' AND p.Archivia = 0
                 GROUP BY r.IdOccupante
             ) q ON q.IdOccupante = o.IdOccupante
             LEFT JOIN (
                 SELECT IdOccupante, SUM(Versato) AS Versato
                 FROM rate_condominiali
                 WHERE TRIM(COALESCE(Rendiconto, '')) = ''
                 GROUP BY IdOccupante
             ) v ON v.IdOccupante = o.IdOccupante
             WHERE TRIM(o.DataFine) = '' OR o.DataFine >= date('now')
             ORDER BY u.Identificativo COLLATE NOCASE,
                      u.Proprieta COLLATE NOCASE,
                      o.Nominativo COLLATE NOCASE,
                      o.IdOccupante"
        } else {
            "SELECT o.IdOccupante, o.IdUnita, o.Nominativo,
                    COALESCE(u.Proprieta, ''), COALESCE(u.Identificativo, ''),
                    COALESCE(q.Quota, 0), COALESCE(v.Versato, 0)
             FROM occupante o
             INNER JOIN unita u ON u.IdUnita = o.IdUnita
             LEFT JOIN (
                 SELECT r.IdOccupante, SUM(r.Importo * COALESCE(s.QuotaInquilino, 100) / 100.0) AS Quota
                 FROM riparto_periodo r
                 INNER JOIN periodo_spesa p ON p.IdPeriodo = r.IdPeriodo
                 INNER JOIN spesa s ON s.IdSpesa = p.IdSpesa
                 WHERE p.Archivia != 0 AND TRIM(p.RendicontoDel) = ?1
                 GROUP BY r.IdOccupante
             ) q ON q.IdOccupante = o.IdOccupante
             LEFT JOIN (
                 SELECT IdOccupante, SUM(Versato) AS Versato
                 FROM rate_condominiali
                 WHERE TRIM(Rendiconto) = ?1
                 GROUP BY IdOccupante
             ) v ON v.IdOccupante = o.IdOccupante
             WHERE TRIM(o.DataFine) = '' OR o.DataFine >= date('now')
             ORDER BY u.Identificativo COLLATE NOCASE,
                      u.Proprieta COLLATE NOCASE,
                      o.Nominativo COLLATE NOCASE,
                      o.IdOccupante"
        };

        let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;

        let mappa = |row: &rusqlite::Row<'_>| -> rusqlite::Result<(i64, i64, String, String, String, f64, f64)> {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
                row.get(6)?,
            ))
        };

        let rows = if attivo {
            stmt.query_map([], mappa).map_err(|e| e.to_string())?
        } else {
            stmt
                .query_map(params![rendiconto], mappa)
                .map_err(|e| e.to_string())?
        };

        let mut righe = Vec::new();
        let mut totale_quote = 0.0;
        let mut totale_rate = 0.0;
        let mut totale_differenza = 0.0;

        for row in rows {
            let (id_occupante, id_unita, nominativo, proprieta, identificativo, quota, versato) =
                row.map_err(|e| e.to_string())?;
            let quota_spettante = arrotonda(quota);
            let totale_rate_versate = arrotonda(versato);
            let differenza = arrotonda(quota_spettante - totale_rate_versate);
            totale_quote += quota_spettante;
            totale_rate += totale_rate_versate;
            totale_differenza += differenza;
            righe.push(ConguaglioRiga {
                id_unita,
                identificativo_unita: identificativo,
                proprieta_unita: proprieta,
                id_occupante,
                nominativo,
                quota_spettante,
                totale_rate_versate,
                differenza,
            });
        }

        Ok(ConguaglioOccupanti {
            rendiconto,
            attivo,
            righe,
            totale_quote: arrotonda(totale_quote),
            totale_rate: arrotonda(totale_rate),
            totale_differenza: arrotonda(totale_differenza),
        })
    })
}
