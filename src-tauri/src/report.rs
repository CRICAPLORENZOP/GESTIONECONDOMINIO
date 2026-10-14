//! Report riepilogo spese (elenco spese ripartite).

use rusqlite::{Connection, params};
use serde::Serialize;

use crate::{AppState, with_db};
use tauri::State;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportPeriodoVoce {
    pub id_periodo: i64,
    pub periodo_da: String,
    pub periodo_a: String,
    pub giorni: i64,
    pub importo: f64,
    pub stato: String,
    pub archivia: bool,
    pub rendiconto_del: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportSpesaVoce {
    pub id_spesa: i64,
    pub id_tipologia: i64,
    pub gruppo_spesa: String,
    pub data_emissione: String,
    pub spesa_da: String,
    pub spesa_a: String,
    pub giorni: i64,
    pub cifra: f64,
    pub spese_pagamento: f64,
    pub totale: f64,
    pub descrizione: String,
    pub note_spesa: String,
    pub gestione: String,
    pub stato_spesa: String,
    pub periodi: Vec<ReportPeriodoVoce>,
    pub totale_periodi: f64,
    pub giorni_periodi: i64,
    /// Importo dei periodi già archiviati (conteggiati in passato).
    pub totale_gia_conteggiato: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportGruppoTipologia {
    pub gruppo_spesa: String,
    pub totale: f64,
    pub spese: Vec<ReportSpesaVoce>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportGruppoGestione {
    /// Titolo del raggruppamento primario (valore Gestione).
    pub gestione: String,
    pub totale: f64,
    pub tipologie: Vec<ReportGruppoTipologia>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportSpeseConteggiate {
    pub totale_generale: f64,
    pub gruppi: Vec<ReportGruppoGestione>,
}

fn etichetta_gestione(gestione: &str) -> String {
    let g = gestione.trim();
    if g.is_empty() {
        "(senza gestione)".into()
    } else {
        g.to_string()
    }
}

/// Elenco spese ATTIVE con soli periodi non archiviati.
/// Raggruppamento: Gestione → Tipologia di spesa.
#[tauri::command]
pub fn report_spese_conteggiate(
    state: State<AppState>,
) -> Result<ReportSpeseConteggiate, String> {
    with_db(&state, |conn, _info| costruisci_report(conn))
}

fn costruisci_report(conn: &Connection) -> Result<ReportSpeseConteggiate, String> {
    let mut stmt = conn
        .prepare(
            "SELECT s.IdSpesa, s.IdTipologia, t.GruppoSpesa, s.DataEmissione,
                    s.SpesaDa, s.SpesaA, s.Cifra, s.SpesePagamento,
                    s.Descrizione, s.NoteSpesa, s.Gestione, s.Stato
             FROM spesa s
             INNER JOIN tipologia_spesa t ON t.IdTipologiaSpesa = s.IdTipologia
             WHERE s.Stato = 'ATTIVA'
               AND EXISTS (
                 SELECT 1 FROM periodo_spesa p
                 WHERE p.IdSpesa = s.IdSpesa AND p.Archivia = 0
               )
             ORDER BY
               CASE WHEN TRIM(s.Gestione) = '' THEN 1 ELSE 0 END,
               s.Gestione COLLATE NOCASE,
               t.GruppoSpesa COLLATE NOCASE,
               s.SpesaDa,
               s.IdSpesa",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, f64>(6)?,
                row.get::<_, f64>(7)?,
                row.get::<_, String>(8)?,
                row.get::<_, String>(9)?,
                row.get::<_, String>(10)?,
                row.get::<_, String>(11)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut gruppi: Vec<ReportGruppoGestione> = Vec::new();

    for row in rows {
        let (
            id_spesa,
            id_tipologia,
            gruppo_spesa,
            data_emissione,
            spesa_da,
            spesa_a,
            cifra,
            spese_pagamento,
            descrizione,
            note_spesa,
            gestione_raw,
            stato_spesa,
        ) = row.map_err(|e| e.to_string())?;

        let periodi = carica_periodi_attivi_report(conn, id_spesa)?;
        if periodi.is_empty() {
            continue;
        }

        let totale_periodi: f64 = periodi.iter().map(|p| p.importo).sum();
        let giorni_periodi: i64 = periodi.iter().map(|p| p.giorni).sum();
        let totale_gia_conteggiato = somma_periodi_archiviati(conn, id_spesa)?;
        let gestione = etichetta_gestione(&gestione_raw);

        let voce = ReportSpesaVoce {
            id_spesa,
            id_tipologia,
            gruppo_spesa: gruppo_spesa.clone(),
            data_emissione,
            spesa_da,
            spesa_a,
            giorni: giorni_periodi,
            cifra,
            spese_pagamento,
            totale: totale_periodi,
            descrizione,
            note_spesa,
            gestione: gestione.clone(),
            stato_spesa,
            periodi,
            totale_periodi,
            giorni_periodi,
            totale_gia_conteggiato,
        };

        // Assicura gruppo Gestione
        if gruppi
            .last()
            .map(|g| !g.gestione.eq_ignore_ascii_case(&gestione))
            .unwrap_or(true)
        {
            gruppi.push(ReportGruppoGestione {
                gestione: gestione.clone(),
                totale: 0.0,
                tipologie: Vec::new(),
            });
        }
        let g = gruppi.last_mut().unwrap();
        g.totale += voce.totale;

        // Assicura sottogruppo Tipologia
        if g
            .tipologie
            .last()
            .map(|t| !t.gruppo_spesa.eq_ignore_ascii_case(&gruppo_spesa))
            .unwrap_or(true)
        {
            g.tipologie.push(ReportGruppoTipologia {
                gruppo_spesa: gruppo_spesa.clone(),
                totale: 0.0,
                spese: Vec::new(),
            });
        }
        let tip = g.tipologie.last_mut().unwrap();
        tip.totale += voce.totale;
        tip.spese.push(voce);
    }

    let totale_generale: f64 = gruppi.iter().map(|g| g.totale).sum();
    Ok(ReportSpeseConteggiate {
        totale_generale,
        gruppi,
    })
}

fn carica_periodi_attivi_report(
    conn: &Connection,
    id_spesa: i64,
) -> Result<Vec<ReportPeriodoVoce>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT IdPeriodo, PeriodoDa, PeriodoA, Giorni, Importo, Archivia, RendicontoDel
             FROM periodo_spesa
             WHERE IdSpesa = ?1 AND Archivia = 0
             ORDER BY PeriodoDa, IdPeriodo",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![id_spesa], |row| {
            Ok(ReportPeriodoVoce {
                id_periodo: row.get(0)?,
                periodo_da: row.get(1)?,
                periodo_a: row.get(2)?,
                giorni: row.get(3)?,
                importo: row.get(4)?,
                stato: "ATTIVO".into(),
                archivia: false,
                rendiconto_del: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut lista = Vec::new();
    for row in rows {
        lista.push(row.map_err(|e| e.to_string())?);
    }
    Ok(lista)
}

fn somma_periodi_archiviati(conn: &Connection, id_spesa: i64) -> Result<f64, String> {
    conn.query_row(
        "SELECT COALESCE(SUM(Importo), 0)
         FROM periodo_spesa
         WHERE IdSpesa = ?1 AND Archivia != 0",
        params![id_spesa],
        |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}

/* ——— Archivio rendiconti (periodi con Archivia spuntato) ——— */

/// Elenco valori distinti di «Rendiconto del» sui periodi archiviati.
#[tauri::command]
pub fn report_rendiconti_archiviati_opzioni(
    state: State<AppState>,
) -> Result<Vec<String>, String> {
    with_db(&state, |conn, _info| {
        let mut stmt = conn
            .prepare(
                "SELECT DISTINCT TRIM(RendicontoDel) AS v
                 FROM periodo_spesa
                 WHERE Archivia != 0 AND TRIM(RendicontoDel) != ''
                 ORDER BY v COLLATE NOCASE",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        let mut lista = Vec::new();
        for row in rows {
            lista.push(row.map_err(|e| e.to_string())?);
        }
        Ok(lista)
    })
}

/// Stesso layout dell’elenco spese ripartite, ma solo periodi archiviati
/// con «Rendiconto del» uguale al valore scelto.
#[tauri::command]
pub fn report_spese_archiviate_per_rendiconto(
    state: State<AppState>,
    rendiconto_del: String,
) -> Result<ReportSpeseConteggiate, String> {
    let rendiconto = rendiconto_del.trim().to_string();
    if rendiconto.is_empty() {
        return Ok(ReportSpeseConteggiate {
            totale_generale: 0.0,
            gruppi: Vec::new(),
        });
    }
    with_db(&state, |conn, _info| {
        costruisci_report_archiviato(conn, &rendiconto)
    })
}

fn costruisci_report_archiviato(
    conn: &Connection,
    rendiconto: &str,
) -> Result<ReportSpeseConteggiate, String> {
    let mut stmt = conn
        .prepare(
            "SELECT s.IdSpesa, s.IdTipologia, t.GruppoSpesa, s.DataEmissione,
                    s.SpesaDa, s.SpesaA, s.Cifra, s.SpesePagamento,
                    s.Descrizione, s.NoteSpesa, s.Gestione, s.Stato
             FROM spesa s
             INNER JOIN tipologia_spesa t ON t.IdTipologiaSpesa = s.IdTipologia
             WHERE EXISTS (
                 SELECT 1 FROM periodo_spesa p
                 WHERE p.IdSpesa = s.IdSpesa
                   AND p.Archivia != 0
                   AND TRIM(p.RendicontoDel) = ?1
             )
             ORDER BY
               CASE WHEN TRIM(s.Gestione) = '' THEN 1 ELSE 0 END,
               s.Gestione COLLATE NOCASE,
               t.GruppoSpesa COLLATE NOCASE,
               s.SpesaDa,
               s.IdSpesa",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![rendiconto], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, f64>(6)?,
                row.get::<_, f64>(7)?,
                row.get::<_, String>(8)?,
                row.get::<_, String>(9)?,
                row.get::<_, String>(10)?,
                row.get::<_, String>(11)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut gruppi: Vec<ReportGruppoGestione> = Vec::new();

    for row in rows {
        let (
            id_spesa,
            id_tipologia,
            gruppo_spesa,
            data_emissione,
            spesa_da,
            spesa_a,
            cifra,
            spese_pagamento,
            descrizione,
            note_spesa,
            gestione_raw,
            stato_spesa,
        ) = row.map_err(|e| e.to_string())?;

        let periodi = carica_periodi_archiviati_report(conn, id_spesa, rendiconto)?;
        if periodi.is_empty() {
            continue;
        }

        let totale_periodi: f64 = periodi.iter().map(|p| p.importo).sum();
        let giorni_periodi: i64 = periodi.iter().map(|p| p.giorni).sum();
        let gestione = etichetta_gestione(&gestione_raw);

        let voce = ReportSpesaVoce {
            id_spesa,
            id_tipologia,
            gruppo_spesa: gruppo_spesa.clone(),
            data_emissione,
            spesa_da,
            spesa_a,
            giorni: giorni_periodi,
            cifra,
            spese_pagamento,
            totale: totale_periodi,
            descrizione,
            note_spesa,
            gestione: gestione.clone(),
            stato_spesa,
            periodi,
            totale_periodi,
            giorni_periodi,
            totale_gia_conteggiato: 0.0,
        };

        if gruppi
            .last()
            .map(|g| !g.gestione.eq_ignore_ascii_case(&gestione))
            .unwrap_or(true)
        {
            gruppi.push(ReportGruppoGestione {
                gestione: gestione.clone(),
                totale: 0.0,
                tipologie: Vec::new(),
            });
        }
        let g = gruppi.last_mut().unwrap();
        g.totale += voce.totale;

        if g
            .tipologie
            .last()
            .map(|t| !t.gruppo_spesa.eq_ignore_ascii_case(&gruppo_spesa))
            .unwrap_or(true)
        {
            g.tipologie.push(ReportGruppoTipologia {
                gruppo_spesa: gruppo_spesa.clone(),
                totale: 0.0,
                spese: Vec::new(),
            });
        }
        let tip = g.tipologie.last_mut().unwrap();
        tip.totale += voce.totale;
        tip.spese.push(voce);
    }

    let totale_generale: f64 = gruppi.iter().map(|g| g.totale).sum();
    Ok(ReportSpeseConteggiate {
        totale_generale,
        gruppi,
    })
}

fn carica_periodi_archiviati_report(
    conn: &Connection,
    id_spesa: i64,
    rendiconto: &str,
) -> Result<Vec<ReportPeriodoVoce>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT IdPeriodo, PeriodoDa, PeriodoA, Giorni, Importo, Archivia, RendicontoDel
             FROM periodo_spesa
             WHERE IdSpesa = ?1
               AND Archivia != 0
               AND TRIM(RendicontoDel) = ?2
             ORDER BY PeriodoDa, IdPeriodo",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![id_spesa, rendiconto], |row| {
            Ok(ReportPeriodoVoce {
                id_periodo: row.get(0)?,
                periodo_da: row.get(1)?,
                periodo_a: row.get(2)?,
                giorni: row.get(3)?,
                importo: row.get(4)?,
                stato: "ARCHIVIATO".into(),
                archivia: true,
                rendiconto_del: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut lista = Vec::new();
    for row in rows {
        lista.push(row.map_err(|e| e.to_string())?);
    }
    Ok(lista)
}

/* ——— Ripartizione spese conteggiate (quote per periodo) ——— */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RipartizioneQuotaVoce {
    pub id_riparto: i64,
    pub id_occupante: i64,
    pub id_unita: i64,
    pub nominativo: String,
    pub proprieta_unita: String,
    pub identificativo: String,
    pub subalterno: String,
    pub percentuale: f64,
    pub peso: f64,
    pub base_calcolo: f64,
    pub importo: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RipartizionePeriodoVoce {
    pub id_periodo: i64,
    pub periodo_da: String,
    pub periodo_a: String,
    pub giorni: i64,
    pub importo: f64,
    pub quote: Vec<RipartizioneQuotaVoce>,
    pub totale_quote: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RipartizioneSpesaVoce {
    pub id_spesa: i64,
    pub gruppo_spesa: String,
    pub ripartizione: String,
    pub gestione: String,
    pub spesa_da: String,
    pub spesa_a: String,
    pub giorni: i64,
    pub cifra: f64,
    pub spese_pagamento: f64,
    pub totale: f64,
    /// INQUILINO, PROPRIETARIO oppure ENTRAMBI.
    pub competenza: String,
    /// Percentuale a carico dell'inquilino. 0 = tutta la proprietà.
    pub quota_inquilino: f64,
    pub periodi: Vec<RipartizionePeriodoVoce>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportRipartizioneConteggiate {
    /// Vuoto se non c’è filtro date (tutte le spese attive).
    pub da: String,
    /// Vuoto se non c’è filtro date.
    pub a: String,
    pub spese: Vec<RipartizioneSpesaVoce>,
}

/// Spese ATTIVE con periodi non archiviati.
/// Se `da` e `a` sono valorizzati, restano solo i periodi che intersecano l’intervallo.
#[tauri::command]
pub fn report_ripartizione_spese_conteggiate(
    state: State<AppState>,
    da: String,
    a: String,
) -> Result<ReportRipartizioneConteggiate, String> {
    let da = da.trim().to_string();
    let a = a.trim().to_string();
    let filtra_date = !da.is_empty() || !a.is_empty();
    if filtra_date {
        if da.is_empty() || a.is_empty() {
            return Err("Per filtrare indica entrambe le date Da e A.".into());
        }
        if !intervallo_date_valido(&da, &a) {
            return Err(
                "Date non valide. Usa AAAA-MM-GG e assicurati che «Da» non sia dopo «A».".into(),
            );
        }
    }
    let da_ref = if filtra_date { Some(da.as_str()) } else { None };
    let a_ref = if filtra_date { Some(a.as_str()) } else { None };
    with_db(&state, |conn, _info| costruisci_ripartizione(conn, da_ref, a_ref))
}

fn intervallo_date_valido(da: &str, a: &str) -> bool {
    if da.len() != 10 || a.len() != 10 {
        return false;
    }
    let ok = |s: &str| {
        let b = s.as_bytes();
        b[4] == b'-'
            && b[7] == b'-'
            && s[0..4].chars().all(|c| c.is_ascii_digit())
            && s[5..7].chars().all(|c| c.is_ascii_digit())
            && s[8..10].chars().all(|c| c.is_ascii_digit())
    };
    ok(da) && ok(a) && da <= a
}

fn costruisci_ripartizione(
    conn: &Connection,
    da: Option<&str>,
    a: Option<&str>,
) -> Result<ReportRipartizioneConteggiate, String> {
    let sql = if da.is_some() {
        "SELECT s.IdSpesa, t.GruppoSpesa, t.Ripartizione, s.Gestione,
                s.SpesaDa, s.SpesaA, s.Cifra, s.SpesePagamento,
                s.Competenza, s.QuotaInquilino
         FROM spesa s
         INNER JOIN tipologia_spesa t ON t.IdTipologiaSpesa = s.IdTipologia
         WHERE s.Stato = 'ATTIVA'
           AND EXISTS (
             SELECT 1 FROM periodo_spesa p
             WHERE p.IdSpesa = s.IdSpesa
               AND p.Archivia = 0
               AND p.PeriodoDa <= ?1
               AND p.PeriodoA >= ?2
           )
         ORDER BY
           CASE WHEN TRIM(s.Gestione) = '' THEN 1 ELSE 0 END,
           s.Gestione COLLATE NOCASE,
           t.GruppoSpesa COLLATE NOCASE,
           s.SpesaDa,
           s.IdSpesa"
    } else {
        "SELECT s.IdSpesa, t.GruppoSpesa, t.Ripartizione, s.Gestione,
                s.SpesaDa, s.SpesaA, s.Cifra, s.SpesePagamento,
                s.Competenza, s.QuotaInquilino
         FROM spesa s
         INNER JOIN tipologia_spesa t ON t.IdTipologiaSpesa = s.IdTipologia
         WHERE s.Stato = 'ATTIVA'
           AND EXISTS (
             SELECT 1 FROM periodo_spesa p
             WHERE p.IdSpesa = s.IdSpesa
               AND p.Archivia = 0
           )
         ORDER BY
           CASE WHEN TRIM(s.Gestione) = '' THEN 1 ELSE 0 END,
           s.Gestione COLLATE NOCASE,
           t.GruppoSpesa COLLATE NOCASE,
           s.SpesaDa,
           s.IdSpesa"
    };

    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;

    let mappa = |row: &rusqlite::Row<'_>| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, String>(4)?,
            row.get::<_, String>(5)?,
            row.get::<_, f64>(6)?,
            row.get::<_, f64>(7)?,
            row.get::<_, String>(8)?,
            row.get::<_, f64>(9)?,
        ))
    };

    let rows: Vec<_> = if let (Some(da_v), Some(a_v)) = (da, a) {
        stmt
            .query_map(params![a_v, da_v], mappa)
            .map_err(|e| e.to_string())?
            .collect()
    } else {
        stmt
            .query_map([], mappa)
            .map_err(|e| e.to_string())?
            .collect()
    };

    let mut spese = Vec::new();

    for row in rows {
        let (
            id_spesa,
            gruppo_spesa,
            ripartizione,
            gestione,
            spesa_da,
            spesa_a,
            cifra,
            spese_pagamento,
            competenza,
            quota_inquilino,
        ) = row.map_err(|e| e.to_string())?;

        let periodi = carica_periodi_ripartizione_intervallo(conn, id_spesa, da, a)?;
        if periodi.is_empty() {
            continue;
        }

        let giorni: i64 = periodi.iter().map(|p| p.giorni).sum();

        spese.push(RipartizioneSpesaVoce {
            id_spesa,
            gruppo_spesa,
            ripartizione,
            gestione: etichetta_gestione(&gestione),
            spesa_da,
            spesa_a,
            giorni,
            cifra,
            spese_pagamento,
            totale: cifra + spese_pagamento,
            competenza,
            quota_inquilino,
            periodi,
        });
    }

    Ok(ReportRipartizioneConteggiate {
        da: da.unwrap_or("").to_string(),
        a: a.unwrap_or("").to_string(),
        spese,
    })
}

fn carica_periodi_ripartizione_intervallo(
    conn: &Connection,
    id_spesa: i64,
    da: Option<&str>,
    a: Option<&str>,
) -> Result<Vec<RipartizionePeriodoVoce>, String> {
    let sql = if da.is_some() {
        "SELECT IdPeriodo, PeriodoDa, PeriodoA, Giorni, Importo
         FROM periodo_spesa
         WHERE IdSpesa = ?1
           AND Archivia = 0
           AND PeriodoDa <= ?2
           AND PeriodoA >= ?3
         ORDER BY PeriodoDa, IdPeriodo"
    } else {
        "SELECT IdPeriodo, PeriodoDa, PeriodoA, Giorni, Importo
         FROM periodo_spesa
         WHERE IdSpesa = ?1
           AND Archivia = 0
         ORDER BY PeriodoDa, IdPeriodo"
    };

    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;

    let mappa = |row: &rusqlite::Row<'_>| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, i64>(3)?,
            row.get::<_, f64>(4)?,
        ))
    };

    let rows: Vec<_> = if let (Some(da_v), Some(a_v)) = (da, a) {
        stmt
            .query_map(params![id_spesa, a_v, da_v], mappa)
            .map_err(|e| e.to_string())?
            .collect()
    } else {
        stmt
            .query_map(params![id_spesa], mappa)
            .map_err(|e| e.to_string())?
            .collect()
    };

    let mut lista = Vec::new();
    for row in rows {
        let (id_periodo, periodo_da, periodo_a, giorni, importo) =
            row.map_err(|e| e.to_string())?;
        let quote = carica_quote_ripartizione(conn, id_periodo)?;
        let totale_quote: f64 = quote.iter().map(|q| q.importo).sum();
        lista.push(RipartizionePeriodoVoce {
            id_periodo,
            periodo_da,
            periodo_a,
            giorni,
            importo,
            quote,
            totale_quote,
        });
    }
    Ok(lista)
}

fn carica_quote_ripartizione(
    conn: &Connection,
    id_periodo: i64,
) -> Result<Vec<RipartizioneQuotaVoce>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT r.IdRiparto, r.IdOccupante, r.IdUnita, r.Nominativo,
                    COALESCE(u.Proprieta, ''),
                    COALESCE(u.Identificativo, ''), COALESCE(u.Subalterno, ''),
                    r.Percentuale, r.Peso, r.BaseCalcolo, r.Importo
             FROM riparto_periodo r
             LEFT JOIN unita u ON u.IdUnita = r.IdUnita
             WHERE r.IdPeriodo = ?1
             ORDER BY u.Identificativo, u.Subalterno, u.Proprieta, r.Nominativo, r.IdRiparto",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![id_periodo], |row| {
            Ok(RipartizioneQuotaVoce {
                id_riparto: row.get(0)?,
                id_occupante: row.get(1)?,
                id_unita: row.get(2)?,
                nominativo: row.get(3)?,
                proprieta_unita: row.get(4)?,
                identificativo: row.get(5)?,
                subalterno: row.get(6)?,
                percentuale: row.get(7)?,
                peso: row.get(8)?,
                base_calcolo: row.get(9)?,
                importo: row.get(10)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut lista = Vec::new();
    for row in rows {
        lista.push(row.map_err(|e| e.to_string())?);
    }
    Ok(lista)
}

/// Ripartizione (quote) dei soli periodi archiviati con quel «Rendiconto del».
#[tauri::command]
pub fn report_ripartizione_archiviati_per_rendiconto(
    state: State<AppState>,
    rendiconto_del: String,
) -> Result<ReportRipartizioneConteggiate, String> {
    let rendiconto = rendiconto_del.trim().to_string();
    if rendiconto.is_empty() {
        return Ok(ReportRipartizioneConteggiate {
            da: String::new(),
            a: String::new(),
            spese: Vec::new(),
        });
    }
    with_db(&state, |conn, _info| {
        costruisci_ripartizione_archiviata(conn, &rendiconto)
    })
}

fn costruisci_ripartizione_archiviata(
    conn: &Connection,
    rendiconto: &str,
) -> Result<ReportRipartizioneConteggiate, String> {
    let mut stmt = conn
        .prepare(
            "SELECT s.IdSpesa, t.GruppoSpesa, t.Ripartizione, s.Gestione,
                    s.SpesaDa, s.SpesaA, s.Cifra, s.SpesePagamento,
                    s.Competenza, s.QuotaInquilino
             FROM spesa s
             INNER JOIN tipologia_spesa t ON t.IdTipologiaSpesa = s.IdTipologia
             WHERE EXISTS (
               SELECT 1 FROM periodo_spesa p
               WHERE p.IdSpesa = s.IdSpesa
                 AND p.Archivia != 0
                 AND TRIM(p.RendicontoDel) = ?1
             )
             ORDER BY
               CASE WHEN TRIM(s.Gestione) = '' THEN 1 ELSE 0 END,
               s.Gestione COLLATE NOCASE,
               t.GruppoSpesa COLLATE NOCASE,
               s.SpesaDa,
               s.IdSpesa",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![rendiconto], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, f64>(6)?,
                row.get::<_, f64>(7)?,
                row.get::<_, String>(8)?,
                row.get::<_, f64>(9)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut spese = Vec::new();

    for row in rows {
        let (
            id_spesa,
            gruppo_spesa,
            ripartizione,
            gestione,
            spesa_da,
            spesa_a,
            cifra,
            spese_pagamento,
            competenza,
            quota_inquilino,
        ) = row.map_err(|e| e.to_string())?;

        let periodi = carica_periodi_ripartizione_archiviati(conn, id_spesa, rendiconto)?;
        if periodi.is_empty() {
            continue;
        }

        let giorni: i64 = periodi.iter().map(|p| p.giorni).sum();
        let totale_periodi: f64 = periodi.iter().map(|p| p.importo).sum();

        spese.push(RipartizioneSpesaVoce {
            id_spesa,
            gruppo_spesa,
            ripartizione,
            gestione: etichetta_gestione(&gestione),
            spesa_da,
            spesa_a,
            giorni,
            cifra,
            spese_pagamento,
            // Totale del rendiconto = somma periodi archiviati (non tutta la spesa)
            totale: totale_periodi,
            competenza,
            quota_inquilino,
            periodi,
        });
    }

    Ok(ReportRipartizioneConteggiate {
        da: String::new(),
        a: String::new(),
        spese,
    })
}

fn carica_periodi_ripartizione_archiviati(
    conn: &Connection,
    id_spesa: i64,
    rendiconto: &str,
) -> Result<Vec<RipartizionePeriodoVoce>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT IdPeriodo, PeriodoDa, PeriodoA, Giorni, Importo
             FROM periodo_spesa
             WHERE IdSpesa = ?1
               AND Archivia != 0
               AND TRIM(RendicontoDel) = ?2
             ORDER BY PeriodoDa, IdPeriodo",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![id_spesa, rendiconto], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, f64>(4)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut lista = Vec::new();
    for row in rows {
        let (id_periodo, periodo_da, periodo_a, giorni, importo) =
            row.map_err(|e| e.to_string())?;
        let quote = carica_quote_ripartizione(conn, id_periodo)?;
        let totale_quote: f64 = quote.iter().map(|q| q.importo).sum();
        lista.push(RipartizionePeriodoVoce {
            id_periodo,
            periodo_da,
            periodo_a,
            giorni,
            importo,
            quote,
            totale_quote,
        });
    }
    Ok(lista)
}

/* ——— Riepilogo ripartizione per unità / gestione ——— */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RiepilogoGestioneVoce {
    pub gestione: String,
    pub totale: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RiepilogoUnitaVoce {
    pub id_unita: i64,
    pub proprieta: String,
    pub identificativo: String,
    pub totale: f64,
    pub gestioni: Vec<RiepilogoGestioneVoce>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportRiepilogoRipartizione {
    pub totale_generale: f64,
    pub unita: Vec<RiepilogoUnitaVoce>,
}

/// Quote di periodi non archiviati (spese ATTIVA), aggregate per unità e gestione.
#[tauri::command]
pub fn report_riepilogo_ripartizione(
    state: State<AppState>,
) -> Result<ReportRiepilogoRipartizione, String> {
    with_db(&state, |conn, _info| costruisci_riepilogo_ripartizione(conn))
}

fn costruisci_riepilogo_ripartizione(
    conn: &Connection,
) -> Result<ReportRiepilogoRipartizione, String> {
    let mut stmt = conn
        .prepare(
            "SELECT r.IdUnita,
                    COALESCE(NULLIF(TRIM(u.Proprieta), ''), '(senza proprietà)'),
                    COALESCE(u.Identificativo, ''),
                    s.Gestione,
                    SUM(r.Importo)
             FROM riparto_periodo r
             INNER JOIN periodo_spesa p ON p.IdPeriodo = r.IdPeriodo
             INNER JOIN spesa s ON s.IdSpesa = p.IdSpesa
             LEFT JOIN unita u ON u.IdUnita = r.IdUnita
             WHERE s.Stato = 'ATTIVA'
               AND p.Archivia = 0
             GROUP BY r.IdUnita, u.Proprieta, u.Identificativo, s.Gestione
             ORDER BY
               u.Identificativo COLLATE NOCASE,
               COALESCE(NULLIF(TRIM(u.Proprieta), ''), '(senza proprietà)') COLLATE NOCASE,
               r.IdUnita,
               CASE WHEN TRIM(s.Gestione) = '' THEN 1 ELSE 0 END,
               s.Gestione COLLATE NOCASE",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, f64>(4)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut unita: Vec<RiepilogoUnitaVoce> = Vec::new();
    let mut totale_generale = 0.0;

    for row in rows {
        let (id_unita, proprieta, identificativo, gestione_raw, totale) =
            row.map_err(|e| e.to_string())?;
        let totale = (totale * 100.0).round() / 100.0;
        totale_generale += totale;
        let gestione = etichetta_gestione(&gestione_raw);

        if let Some(ultima) = unita.last_mut() {
            if ultima.id_unita == id_unita {
                ultima.gestioni.push(RiepilogoGestioneVoce { gestione, totale });
                ultima.totale = ((ultima.totale + totale) * 100.0).round() / 100.0;
                continue;
            }
        }

        unita.push(RiepilogoUnitaVoce {
            id_unita,
            proprieta,
            identificativo,
            totale,
            gestioni: vec![RiepilogoGestioneVoce { gestione, totale }],
        });
    }

    Ok(ReportRiepilogoRipartizione {
        totale_generale: (totale_generale * 100.0).round() / 100.0,
        unita,
    })
}
