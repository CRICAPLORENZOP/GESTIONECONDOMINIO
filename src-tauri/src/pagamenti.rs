//! Versamenti della proprietà e situazione dei due conti (occupante / proprietà).
//!
//! Il dovuto non si salva: si ricalcola dalla ripartizione.
//! Ogni riga di pagamento_proprieta è un versamento. Più righe = più tempi.

use std::collections::BTreeMap;

use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::{AppState, with_db};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PagamentoProprieta {
    pub id_pagamento: i64,
    pub proprieta: String,
    pub data_versamento: String,
    pub importo: f64,
    pub note_pagamento: String,
    pub rendiconto: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PagamentoProprietaInput {
    pub proprieta: String,
    pub data_versamento: String,
    pub importo: f64,
    pub note_pagamento: String,
    pub rendiconto: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SituazioneOccupanteRiga {
    pub id_occupante: i64,
    pub id_unita: i64,
    pub identificativo_unita: String,
    pub proprieta_unita: String,
    pub nominativo: String,
    pub dovuto: f64,
    pub versato: f64,
    /// dovuto − versato. In schermo il saldo è il contrario (versato − dovuto).
    pub differenza: f64,
    pub anche_proprietario: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SituazioneProprietaRiga {
    pub proprieta: String,
    pub n_unita: i64,
    pub dovuto: f64,
    pub versato: f64,
    pub differenza: f64,
    pub anche_occupante: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SituazionePagamenti {
    pub rendiconto: String,
    pub attivo: bool,
    pub occupanti: Vec<SituazioneOccupanteRiga>,
    pub proprieta: Vec<SituazioneProprietaRiga>,
    pub totale_dovuto_occupanti: f64,
    pub totale_versato_occupanti: f64,
    pub totale_differenza_occupanti: f64,
    pub totale_dovuto_proprieta: f64,
    pub totale_versato_proprieta: f64,
    pub totale_differenza_proprieta: f64,
}

fn arrotonda(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

fn chiave_nome(s: &str) -> String {
    s.trim().to_lowercase()
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

fn normalizza_input(input: PagamentoProprietaInput) -> Result<PagamentoProprietaInput, String> {
    let data = input.data_versamento.trim().to_string();
    if !data_valida(&data) {
        return Err("La data del versamento deve essere nel formato AAAA-MM-GG.".into());
    }
    if !input.importo.is_finite() {
        return Err("L'importo deve essere un numero valido.".into());
    }
    Ok(PagamentoProprietaInput {
        proprieta: input.proprieta.trim().to_string(),
        data_versamento: data,
        importo: input.importo,
        note_pagamento: input.note_pagamento.trim().to_string(),
        rendiconto: input.rendiconto.trim().to_string(),
    })
}

fn mappa_pagamento(row: &rusqlite::Row<'_>) -> rusqlite::Result<PagamentoProprieta> {
    Ok(PagamentoProprieta {
        id_pagamento: row.get(0)?,
        proprieta: row.get(1)?,
        data_versamento: row.get(2)?,
        importo: row.get(3)?,
        note_pagamento: row.get(4)?,
        rendiconto: row.get(5)?,
    })
}

fn carica_pagamento(conn: &Connection, id: i64) -> Result<PagamentoProprieta, String> {
    conn.query_row(
        "SELECT IdPagamento, Proprieta, DataVersamento, Importo, NotePagamento, Rendiconto
         FROM pagamento_proprieta
         WHERE IdPagamento = ?1",
        params![id],
        mappa_pagamento,
    )
    .map_err(|_| "Pagamento non trovato.".to_string())
}

#[tauri::command]
pub fn elenco_pagamenti_proprieta(
    state: State<AppState>,
    proprieta: String,
) -> Result<Vec<PagamentoProprieta>, String> {
    let nome = proprieta.trim().to_string();
    with_db(&state, |conn, _info| {
        let mut stmt = conn
            .prepare(
                "SELECT IdPagamento, Proprieta, DataVersamento, Importo, NotePagamento, Rendiconto
                 FROM pagamento_proprieta
                 WHERE TRIM(Proprieta) = ?1 COLLATE NOCASE
                 ORDER BY DataVersamento DESC, IdPagamento DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![nome], mappa_pagamento)
            .map_err(|e| e.to_string())?;
        let mut lista = Vec::new();
        for row in rows {
            lista.push(row.map_err(|e| e.to_string())?);
        }
        Ok(lista)
    })
}

#[tauri::command]
pub fn crea_pagamento_proprieta(
    state: State<AppState>,
    dati: PagamentoProprietaInput,
) -> Result<PagamentoProprieta, String> {
    let dati = normalizza_input(dati)?;
    with_db(&state, |conn, _info| {
        conn.execute(
            "INSERT INTO pagamento_proprieta (
                Proprieta, DataVersamento, Importo, NotePagamento, Rendiconto
             ) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                dati.proprieta,
                dati.data_versamento,
                dati.importo,
                dati.note_pagamento,
                dati.rendiconto
            ],
        )
        .map_err(|e| e.to_string())?;
        carica_pagamento(conn, conn.last_insert_rowid())
    })
}

#[tauri::command]
pub fn aggiorna_pagamento_proprieta(
    state: State<AppState>,
    id_pagamento: i64,
    dati: PagamentoProprietaInput,
) -> Result<PagamentoProprieta, String> {
    let dati = normalizza_input(dati)?;
    with_db(&state, |conn, _info| {
        let n = conn
            .execute(
                "UPDATE pagamento_proprieta
                 SET Proprieta = ?1, DataVersamento = ?2, Importo = ?3,
                     NotePagamento = ?4, Rendiconto = ?5
                 WHERE IdPagamento = ?6",
                params![
                    dati.proprieta,
                    dati.data_versamento,
                    dati.importo,
                    dati.note_pagamento,
                    dati.rendiconto,
                    id_pagamento
                ],
            )
            .map_err(|e| e.to_string())?;
        if n == 0 {
            return Err("Pagamento non trovato.".into());
        }
        carica_pagamento(conn, id_pagamento)
    })
}

#[tauri::command]
pub fn elimina_pagamento_proprieta(state: State<AppState>, id_pagamento: i64) -> Result<(), String> {
    with_db(&state, |conn, _info| {
        let n = conn
            .execute(
                "DELETE FROM pagamento_proprieta WHERE IdPagamento = ?1",
                params![id_pagamento],
            )
            .map_err(|e| e.to_string())?;
        if n == 0 {
            return Err("Pagamento non trovato.".into());
        }
        Ok(())
    })
}

struct AccProprieta {
    nome: String,
    n_unita: i64,
    dovuto: f64,
    versato: f64,
}

fn aggiungi_proprieta(
    map: &mut BTreeMap<String, AccProprieta>,
    nome: &str,
    n_unita: i64,
    dovuto: f64,
    versato: f64,
) {
    let visibile = nome.trim().to_string();
    let chiave = chiave_nome(&visibile);
    let acc = map.entry(chiave).or_insert_with(|| AccProprieta {
        nome: visibile.clone(),
        n_unita: 0,
        dovuto: 0.0,
        versato: 0.0,
    });
    if acc.nome.is_empty() && !visibile.is_empty() {
        acc.nome = visibile;
    }
    acc.n_unita += n_unita;
    acc.dovuto += dovuto;
    acc.versato += versato;
}

fn carica_occupanti(
    conn: &Connection,
    rendiconto: &str,
    attivo: bool,
) -> Result<Vec<SituazioneOccupanteRiga>, String> {
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
        stmt.query_map(params![rendiconto], mappa)
            .map_err(|e| e.to_string())?
    };

    let mut lista = Vec::new();
    for row in rows {
        let (id_occupante, id_unita, nominativo, proprieta, identificativo, quota, versato) =
            row.map_err(|e| e.to_string())?;
        let dovuto = arrotonda(quota);
        let versato = arrotonda(versato);
        lista.push(SituazioneOccupanteRiga {
            id_occupante,
            id_unita,
            identificativo_unita: identificativo,
            proprieta_unita: proprieta.trim().to_string(),
            nominativo,
            dovuto,
            versato,
            differenza: arrotonda(dovuto - versato),
            anche_proprietario: false,
        });
    }
    Ok(lista)
}

fn carica_proprieta(
    conn: &Connection,
    rendiconto: &str,
    attivo: bool,
) -> Result<Vec<SituazioneProprietaRiga>, String> {
    let mut map: BTreeMap<String, AccProprieta> = BTreeMap::new();

    let mut stmt_unita = conn
        .prepare(
            "SELECT TRIM(COALESCE(Proprieta, '')), COUNT(*)
             FROM unita
             GROUP BY TRIM(COALESCE(Proprieta, ''))",
        )
        .map_err(|e| e.to_string())?;
    let righe_unita = stmt_unita
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)))
        .map_err(|e| e.to_string())?;
    for riga in righe_unita {
        let (nome, n) = riga.map_err(|e| e.to_string())?;
        aggiungi_proprieta(&mut map, &nome, n, 0.0, 0.0);
    }

    let sql_dovuto = if attivo {
        "SELECT TRIM(COALESCE(u.Proprieta, '')),
                SUM(r.Importo * (100.0 - COALESCE(s.QuotaInquilino, 100)) / 100.0)
         FROM riparto_periodo r
         INNER JOIN periodo_spesa p ON p.IdPeriodo = r.IdPeriodo
         INNER JOIN spesa s ON s.IdSpesa = p.IdSpesa
         LEFT JOIN unita u ON u.IdUnita = r.IdUnita
         WHERE s.Stato = 'ATTIVA' AND p.Archivia = 0
         GROUP BY TRIM(COALESCE(u.Proprieta, ''))"
    } else {
        "SELECT TRIM(COALESCE(u.Proprieta, '')),
                SUM(r.Importo * (100.0 - COALESCE(s.QuotaInquilino, 100)) / 100.0)
         FROM riparto_periodo r
         INNER JOIN periodo_spesa p ON p.IdPeriodo = r.IdPeriodo
         INNER JOIN spesa s ON s.IdSpesa = p.IdSpesa
         LEFT JOIN unita u ON u.IdUnita = r.IdUnita
         WHERE p.Archivia != 0 AND TRIM(p.RendicontoDel) = ?1
         GROUP BY TRIM(COALESCE(u.Proprieta, ''))"
    };
    let mut stmt_dovuto = conn.prepare(sql_dovuto).map_err(|e| e.to_string())?;
    let mappa_imp =
        |row: &rusqlite::Row<'_>| -> rusqlite::Result<(String, f64)> { Ok((row.get(0)?, row.get(1)?)) };
    let righe_dovuto = if attivo {
        stmt_dovuto.query_map([], mappa_imp).map_err(|e| e.to_string())?
    } else {
        stmt_dovuto
            .query_map(params![rendiconto], mappa_imp)
            .map_err(|e| e.to_string())?
    };
    for riga in righe_dovuto {
        let (nome, importo) = riga.map_err(|e| e.to_string())?;
        aggiungi_proprieta(&mut map, &nome, 0, importo, 0.0);
    }

    let sql_versato = if attivo {
        "SELECT TRIM(COALESCE(Proprieta, '')), SUM(Importo)
         FROM pagamento_proprieta
         WHERE TRIM(COALESCE(Rendiconto, '')) = ''
         GROUP BY TRIM(COALESCE(Proprieta, '')) COLLATE NOCASE"
    } else {
        "SELECT TRIM(COALESCE(Proprieta, '')), SUM(Importo)
         FROM pagamento_proprieta
         WHERE TRIM(Rendiconto) = ?1
         GROUP BY TRIM(COALESCE(Proprieta, '')) COLLATE NOCASE"
    };
    let mut stmt_versato = conn.prepare(sql_versato).map_err(|e| e.to_string())?;
    let righe_versato = if attivo {
        stmt_versato
            .query_map([], mappa_imp)
            .map_err(|e| e.to_string())?
    } else {
        stmt_versato
            .query_map(params![rendiconto], mappa_imp)
            .map_err(|e| e.to_string())?
    };
    for riga in righe_versato {
        let (nome, importo) = riga.map_err(|e| e.to_string())?;
        aggiungi_proprieta(&mut map, &nome, 0, 0.0, importo);
    }

    let mut lista = Vec::new();
    for acc in map.into_values() {
        if acc.nome.is_empty() && acc.dovuto.abs() < 0.004 && acc.versato.abs() < 0.004 {
            continue;
        }
        let dovuto = arrotonda(acc.dovuto);
        let versato = arrotonda(acc.versato);
        lista.push(SituazioneProprietaRiga {
            proprieta: acc.nome,
            n_unita: acc.n_unita,
            dovuto,
            versato,
            differenza: arrotonda(dovuto - versato),
            anche_occupante: false,
        });
    }
    lista.sort_by(|a, b| {
        a.proprieta
            .to_lowercase()
            .cmp(&b.proprieta.to_lowercase())
    });
    Ok(lista)
}

fn segna_doppi_ruoli(
    occupanti: &mut [SituazioneOccupanteRiga],
    proprieta: &mut [SituazioneProprietaRiga],
) {
    let nomi_occupanti: Vec<String> = occupanti
        .iter()
        .map(|o| chiave_nome(&o.nominativo))
        .filter(|s| !s.is_empty())
        .collect();
    let nomi_proprieta: Vec<String> = proprieta
        .iter()
        .map(|p| chiave_nome(&p.proprieta))
        .filter(|s| !s.is_empty())
        .collect();

    for o in occupanti.iter_mut() {
        let k = chiave_nome(&o.nominativo);
        o.anche_proprietario = !k.is_empty() && nomi_proprieta.iter().any(|p| p == &k);
    }
    for p in proprieta.iter_mut() {
        let k = chiave_nome(&p.proprieta);
        p.anche_occupante = !k.is_empty() && nomi_occupanti.iter().any(|o| o == &k);
    }
}

#[tauri::command]
pub fn situazione_pagamenti(
    state: State<AppState>,
    rendiconto: String,
) -> Result<SituazionePagamenti, String> {
    let rendiconto = rendiconto.trim().to_string();
    let attivo = rendiconto.is_empty();
    with_db(&state, |conn, _info| {
        let mut occupanti = carica_occupanti(conn, &rendiconto, attivo)?;
        let mut proprieta = carica_proprieta(conn, &rendiconto, attivo)?;
        segna_doppi_ruoli(&mut occupanti, &mut proprieta);

        let totale_dovuto_occupanti = arrotonda(occupanti.iter().map(|r| r.dovuto).sum());
        let totale_versato_occupanti = arrotonda(occupanti.iter().map(|r| r.versato).sum());
        let totale_differenza_occupanti =
            arrotonda(totale_dovuto_occupanti - totale_versato_occupanti);
        let totale_dovuto_proprieta = arrotonda(proprieta.iter().map(|r| r.dovuto).sum());
        let totale_versato_proprieta = arrotonda(proprieta.iter().map(|r| r.versato).sum());
        let totale_differenza_proprieta =
            arrotonda(totale_dovuto_proprieta - totale_versato_proprieta);

        Ok(SituazionePagamenti {
            rendiconto,
            attivo,
            occupanti,
            proprieta,
            totale_dovuto_occupanti,
            totale_versato_occupanti,
            totale_differenza_occupanti,
            totale_dovuto_proprieta,
            totale_versato_proprieta,
            totale_differenza_proprieta,
        })
    })
}
