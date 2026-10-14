//! Periodi di ripartizione spese e quote agli occupanti.

use chrono::NaiveDate;
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};

use crate::{AppState, Spesa, with_db};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuotaRiparto {
    pub id_riparto: i64,
    pub id_periodo: i64,
    pub id_occupante: i64,
    pub id_unita: i64,
    pub nominativo: String,
    pub proprieta_unita: String,
    pub percentuale: f64,
    pub peso: f64,
    pub base_calcolo: f64,
    pub importo: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeriodoSpesa {
    pub id_periodo: i64,
    pub id_spesa: i64,
    pub periodo_da: String,
    pub periodo_a: String,
    pub giorni: i64,
    pub importo: f64,
    pub archivia: bool,
    pub rendiconto_del: String,
    pub quote: Vec<QuotaRiparto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuotaProposta {
    pub id_occupante: i64,
    pub id_unita: i64,
    pub nominativo: String,
    pub proprieta_unita: String,
    pub percentuale: f64,
    pub peso: f64,
    pub base_calcolo: f64,
    pub importo: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PropostaPeriodo {
    pub periodo_da: String,
    pub periodo_a: String,
    pub giorni_periodo: i64,
    pub giorni_spesa: i64,
    pub importo_periodo: f64,
    pub ripartizione: String,
    pub quote: Vec<QuotaProposta>,
    pub avviso: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuotaOverrideInput {
    pub id_occupante: i64,
    pub percentuale: f64,
    pub peso: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeriodoInput {
    pub periodo_da: String,
    pub periodo_a: String,
    /// Valori modificati in anteprima (solo per questa spesa/periodo).
    #[serde(default)]
    pub quote: Option<Vec<QuotaOverrideInput>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpesaDettaglioRiparto {
    pub spesa: Spesa,
    pub giorni: i64,
    pub totale_riparto: f64,
    pub ripartizione: String,
    pub periodi: Vec<PeriodoSpesa>,
}

pub fn parse_data(s: &str) -> Result<NaiveDate, String> {
    NaiveDate::parse_from_str(s.trim(), "%Y-%m-%d")
        .map_err(|_| format!("Data non valida: {s}. Usa AAAA-MM-GG."))
}

/// Giorni inclusivi tra due date (es. 01/01→01/01 = 1 giorno).
pub fn giorni_inclusivi(da: &str, a: &str) -> Result<i64, String> {
    let d1 = parse_data(da)?;
    let d2 = parse_data(a)?;
    if d2 < d1 {
        return Err("La data fine non può essere precedente alla data inizio.".into());
    }
    Ok((d2 - d1).num_days() + 1)
}

fn occupazione_sovrappone_periodo(
    data_inizio: &str,
    data_fine: &str,
    periodo_da: &str,
    periodo_a: &str,
) -> Result<bool, String> {
    let ini = parse_data(data_inizio)?;
    let fine = if data_fine.trim().is_empty() {
        NaiveDate::from_ymd_opt(9999, 12, 31).unwrap()
    } else {
        parse_data(data_fine)?
    };
    let pda = parse_data(periodo_da)?;
    let paa = parse_data(periodo_a)?;
    Ok(ini <= paa && fine >= pda)
}

fn periodi_si_sovrappongono(a_da: &str, a_a: &str, b_da: &str, b_a: &str) -> Result<bool, String> {
    let ad = parse_data(a_da)?;
    let aa = parse_data(a_a)?;
    let bd = parse_data(b_da)?;
    let ba = parse_data(b_a)?;
    Ok(ad <= ba && bd <= aa)
}

fn data_iso(d: NaiveDate) -> String {
    d.format("%Y-%m-%d").to_string()
}

fn giorno_prima(iso: &str) -> Result<String, String> {
    let d = parse_data(iso)?
        .pred_opt()
        .ok_or_else(|| format!("Impossibile calcolare il giorno prima di {iso}."))?;
    Ok(data_iso(d))
}

fn giorno_dopo(iso: &str) -> Result<String, String> {
    let d = parse_data(iso)?
        .succ_opt()
        .ok_or_else(|| format!("Impossibile calcolare il giorno dopo di {iso}."))?;
    Ok(data_iso(d))
}

fn overrides_da_quote(quote: &[QuotaRiparto]) -> Vec<QuotaOverrideInput> {
    quote
        .iter()
        .map(|q| QuotaOverrideInput {
            id_occupante: q.id_occupante,
            percentuale: q.percentuale,
            peso: q.peso,
        })
        .collect()
}

fn inserisci_quote_proposta(
    conn: &Connection,
    id_periodo: i64,
    quote: &[QuotaProposta],
) -> Result<(), String> {
    for q in quote {
        conn.execute(
            "INSERT INTO riparto_periodo (
                IdPeriodo, IdOccupante, IdUnita, Nominativo,
                Percentuale, Peso, BaseCalcolo, Importo
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                id_periodo,
                q.id_occupante,
                q.id_unita,
                q.nominativo,
                q.percentuale,
                q.peso,
                q.base_calcolo,
                q.importo
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn elimina_periodo_db(conn: &Connection, id_periodo: i64) -> Result<(), String> {
    conn.execute(
        "DELETE FROM riparto_periodo WHERE IdPeriodo = ?1",
        params![id_periodo],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM periodo_spesa WHERE IdPeriodo = ?1",
        params![id_periodo],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Aggiorna date di un periodo e ricalcola giorni/importo/quote (conservando % e parti se passati).
fn riscrivi_periodo(
    conn: &Connection,
    id_condominio: i64,
    id_spesa: i64,
    id_periodo: i64,
    periodo_da: &str,
    periodo_a: &str,
    overrides: Option<&[QuotaOverrideInput]>,
) -> Result<(), String> {
    let proposta = costruisci_proposta(
        conn,
        id_condominio,
        id_spesa,
        periodo_da,
        periodo_a,
        overrides,
    )?;

    conn.execute(
        "UPDATE periodo_spesa
         SET PeriodoDa = ?1, PeriodoA = ?2, Giorni = ?3, Importo = ?4
         WHERE IdPeriodo = ?5",
        params![
            proposta.periodo_da,
            proposta.periodo_a,
            proposta.giorni_periodo,
            proposta.importo_periodo,
            id_periodo
        ],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "DELETE FROM riparto_periodo WHERE IdPeriodo = ?1",
        params![id_periodo],
    )
    .map_err(|e| e.to_string())?;

    inserisci_quote_proposta(conn, id_periodo, &proposta.quote)
}

fn crea_periodo_da_proposta(
    conn: &Connection,
    id_spesa: i64,
    proposta: &PropostaPeriodo,
) -> Result<i64, String> {
    conn.execute(
        "INSERT INTO periodo_spesa (IdSpesa, PeriodoDa, PeriodoA, Giorni, Importo)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            id_spesa,
            proposta.periodo_da,
            proposta.periodo_a,
            proposta.giorni_periodo,
            proposta.importo_periodo
        ],
    )
    .map_err(|e| e.to_string())?;

    let id_periodo = conn.last_insert_rowid();
    inserisci_quote_proposta(conn, id_periodo, &proposta.quote)?;
    Ok(id_periodo)
}

/// Se il nuovo periodo si sovrappone a periodi esistenti, li spezza/aggiorna
/// per lasciare spazio (es. periodo intero → pezzo prima + pezzo fino alla fine).
fn spezza_periodi_sovrapposti(
    conn: &Connection,
    id_condominio: i64,
    id_spesa: i64,
    nuovo_da: &str,
    nuovo_a: &str,
) -> Result<(), String> {
    let periodi = carica_periodi(conn, id_spesa)?;
    let n_da = parse_data(nuovo_da)?;
    let n_a = parse_data(nuovo_a)?;

    for p in periodi {
        if !periodi_si_sovrappongono(nuovo_da, nuovo_a, &p.periodo_da, &p.periodo_a)? {
            continue;
        }

        let p_da = parse_data(&p.periodo_da)?;
        let p_a = parse_data(&p.periodo_a)?;
        let overrides = overrides_da_quote(&p.quote);
        let ha_prima = p_da < n_da;
        let ha_dopo = p_a > n_a;

        if !ha_prima && !ha_dopo {
            // Il nuovo periodo copre per intero quello vecchio.
            elimina_periodo_db(conn, p.id_periodo)?;
            continue;
        }

        if ha_prima && ha_dopo {
            let fine_prima = giorno_prima(nuovo_da)?;
            let inizio_dopo = giorno_dopo(nuovo_a)?;
            riscrivi_periodo(
                conn,
                id_condominio,
                id_spesa,
                p.id_periodo,
                &p.periodo_da,
                &fine_prima,
                Some(&overrides),
            )?;
            let proposta_dopo = costruisci_proposta(
                conn,
                id_condominio,
                id_spesa,
                &inizio_dopo,
                &p.periodo_a,
                Some(&overrides),
            )?;
            crea_periodo_da_proposta(conn, id_spesa, &proposta_dopo)?;
        } else if ha_prima {
            let fine_prima = giorno_prima(nuovo_da)?;
            riscrivi_periodo(
                conn,
                id_condominio,
                id_spesa,
                p.id_periodo,
                &p.periodo_da,
                &fine_prima,
                Some(&overrides),
            )?;
        } else {
            // Solo pezzo dopo → aggiorna il periodo esistente fino alla fine.
            let inizio_dopo = giorno_dopo(nuovo_a)?;
            riscrivi_periodo(
                conn,
                id_condominio,
                id_spesa,
                p.id_periodo,
                &inizio_dopo,
                &p.periodo_a,
                Some(&overrides),
            )?;
        }
    }

    Ok(())
}

struct OccupantePeriodo {
    id_occupante: i64,
    id_unita: i64,
    nominativo: String,
    proprieta: String,
    millesimi: f64,
    num_componenti: f64,
    percentuale: f64,
}

fn carica_spesa_base(
    conn: &Connection,
    id_spesa: i64,
) -> Result<(Spesa, String, f64), String> {
    conn.query_row(
        "SELECT s.IdSpesa, s.IdTipologia, s.SpesaDa, s.SpesaA, s.Cifra, s.SpesePagamento,
                s.Descrizione, s.Stato, s.DataEmissione, s.NumFattura, s.NoteSpesa, s.Gestione,
                s.Competenza, s.QuotaInquilino, t.GruppoSpesa, t.Ripartizione
         FROM spesa s
         INNER JOIN tipologia_spesa t ON t.IdTipologiaSpesa = s.IdTipologia
         WHERE s.IdSpesa = ?1",
        params![id_spesa],
        |row| {
            let spesa = Spesa {
                id_spesa: row.get(0)?,
                id_tipologia: row.get(1)?,
                spesa_da: row.get(2)?,
                spesa_a: row.get(3)?,
                cifra: row.get(4)?,
                spese_pagamento: row.get(5)?,
                descrizione: row.get(6)?,
                stato: row.get(7)?,
                data_emissione: row.get(8)?,
                num_fattura: row.get(9)?,
                note_spesa: row.get(10)?,
                gestione: row.get(11)?,
                percorso_allegato: String::new(),
                competenza: row.get(12)?,
                quota_inquilino: row.get(13)?,
                gruppo_spesa: row.get(14)?,
                giorni: 0,
                ha_periodi: false,
                archivia_parziale: false,
            };
            let ripartizione: String = row.get(15)?;
            Ok((spesa, ripartizione, 0.0))
        },
    )
    .map_err(|e| format!("Spesa non trovata: {e}"))
    .and_then(|(mut spesa, rip, _)| {
        let giorni = giorni_inclusivi(&spesa.spesa_da, &spesa.spesa_a)?;
        spesa.giorni = giorni;
        let (n, a) = conteggio_archivia_periodi(conn, spesa.id_spesa)?;
        spesa.ha_periodi = n > 0;
        spesa.archivia_parziale = n > 0 && a > 0 && a < n;
        Ok((spesa, rip, giorni as f64))
    })
}

/// Conta periodi e quanti sono archiviati: (totale, archiviati).
pub fn conteggio_archivia_periodi(
    conn: &Connection,
    id_spesa: i64,
) -> Result<(i64, i64), String> {
    conn.query_row(
        "SELECT COUNT(*),
                COALESCE(SUM(CASE WHEN Archivia != 0 THEN 1 ELSE 0 END), 0)
         FROM periodo_spesa
         WHERE IdSpesa = ?1",
        params![id_spesa],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .map_err(|e| e.to_string())
}

/// True se ci sono periodi e solo una parte è archiviata.
pub fn spesa_ha_archivia_parziale(conn: &Connection, id_spesa: i64) -> Result<bool, String> {
    let (n, a) = conteggio_archivia_periodi(conn, id_spesa)?;
    Ok(n > 0 && a > 0 && a < n)
}

/// Aggiorna Stato spesa in base ai periodi:
/// - tutti archiviati → ARCHIVIATA
/// - altrimenti (con almeno un periodo) → ATTIVA
pub fn sincronizza_stato_spesa_da_periodi(
    conn: &Connection,
    id_spesa: i64,
) -> Result<(), String> {
    let (n, a) = conteggio_archivia_periodi(conn, id_spesa)?;
    if n == 0 {
        return Ok(());
    }
    let nuovo_stato = if a == n { "ARCHIVIATA" } else { "ATTIVA" };
    conn.execute(
        "UPDATE spesa SET Stato = ?1 WHERE IdSpesa = ?2",
        params![nuovo_stato, id_spesa],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn occupanti_nel_periodo(
    conn: &Connection,
    id_condominio: i64,
    periodo_da: &str,
    periodo_a: &str,
) -> Result<Vec<OccupantePeriodo>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT o.IdOccupante, o.IdUnita, o.Nominativo, o.DataInizio, o.DataFine,
                    u.Proprieta, u.Millesimi, o.Percentuale, o.NumComponenti
             FROM occupante o
             INNER JOIN unita u ON u.IdUnita = o.IdUnita
             WHERE u.IdCondominio = ?1
             ORDER BY u.Identificativo, u.Proprieta, o.Nominativo",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![id_condominio], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, f64>(6)?,
                row.get::<_, f64>(7)?,
                row.get::<_, i64>(8)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut lista = Vec::new();
    for row in rows {
        let (id_o, id_u, nom, di, df, prop, mill, perc, n_comp) =
            row.map_err(|e| e.to_string())?;
        if occupazione_sovrappone_periodo(&di, &df, periodo_da, periodo_a)? {
            lista.push(OccupantePeriodo {
                id_occupante: id_o,
                id_unita: id_u,
                nominativo: nom,
                proprieta: prop,
                millesimi: mill,
                num_componenti: n_comp.max(1) as f64,
                percentuale: perc,
            });
        }
    }
    Ok(lista)
}

fn calcola_quote(
    occupanti: &[OccupantePeriodo],
    importo_periodo: f64,
    ripartizione: &str,
    overrides: Option<&[QuotaOverrideInput]>,
) -> Result<(Vec<QuotaProposta>, String), String> {
    let mut avviso = String::new();
    if occupanti.is_empty() {
        avviso = "Nessun occupante trovato in questo periodo.".into();
        return Ok((Vec::new(), avviso));
    }

    // Millesimi → millesimi unità; Parti → n. componenti dell'occupante (modificabile in anteprima).
    let usa_millesimi = ripartizione == "Millesimi";

    let mut percentuali = Vec::with_capacity(occupanti.len());
    let mut pesi = Vec::with_capacity(occupanti.len());

    for o in occupanti {
        let mut perc = o.percentuale;
        let mut peso = if usa_millesimi {
            o.millesimi
        } else {
            o.num_componenti
        };

        if let Some(lista) = overrides {
            if let Some(ov) = lista.iter().find(|x| x.id_occupante == o.id_occupante) {
                if !ov.percentuale.is_finite() || ov.percentuale < 0.0 || ov.percentuale > 100.0 {
                    return Err(format!(
                        "Percentuale non valida per «{}» (usa un valore tra 0 e 100).",
                        o.nominativo
                    ));
                }
                if !ov.peso.is_finite() || ov.peso < 0.0 {
                    return Err(format!(
                        "Valore {} non valido per «{}».",
                        if usa_millesimi { "millesimi" } else { "parti" },
                        o.nominativo
                    ));
                }
                perc = ov.percentuale;
                peso = ov.peso;
            }
        }

        percentuali.push(perc);
        pesi.push(peso);
    }

    // Parziale = Percentuale × (Millesimi oppure Parti/componenti)
    let parziali: Vec<f64> = percentuali
        .iter()
        .zip(pesi.iter())
        .map(|(p, w)| p * w)
        .collect();

    let totale: f64 = parziali.iter().sum();
    let mut quote = Vec::new();

    if totale <= 0.0 {
        avviso = "Totale dei parziali a zero (controlla percentuali e parti/millesimi): \
                  ripartizione temporanea a parti uguali."
            .into();
        let n = occupanti.len() as f64;
        let quota = importo_periodo / n;
        for (i, o) in occupanti.iter().enumerate() {
            quote.push(QuotaProposta {
                id_occupante: o.id_occupante,
                id_unita: o.id_unita,
                nominativo: o.nominativo.clone(),
                proprieta_unita: o.proprieta.clone(),
                percentuale: percentuali[i],
                peso: pesi[i],
                base_calcolo: parziali[i],
                importo: (quota * 100.0).round() / 100.0,
            });
        }
    } else {
        for (i, o) in occupanti.iter().enumerate() {
            let importo = importo_periodo * parziali[i] / totale;
            quote.push(QuotaProposta {
                id_occupante: o.id_occupante,
                id_unita: o.id_unita,
                nominativo: o.nominativo.clone(),
                proprieta_unita: o.proprieta.clone(),
                percentuale: percentuali[i],
                peso: pesi[i],
                base_calcolo: parziali[i],
                importo: (importo * 100.0).round() / 100.0,
            });
        }
    }

    // Correzione centesimi sull'ultima riga per chiudere il totale
    if !quote.is_empty() {
        let somma: f64 = quote.iter().map(|q| q.importo).sum();
        let diff = ((importo_periodo - somma) * 100.0).round() / 100.0;
        if let Some(last) = quote.last_mut() {
            last.importo = ((last.importo + diff) * 100.0).round() / 100.0;
        }
    }

    Ok((quote, avviso))
}

fn costruisci_proposta(
    conn: &Connection,
    id_condominio: i64,
    id_spesa: i64,
    periodo_da: &str,
    periodo_a: &str,
    overrides: Option<&[QuotaOverrideInput]>,
) -> Result<PropostaPeriodo, String> {
    let (spesa, ripartizione, _) = carica_spesa_base(conn, id_spesa)?;
    let giorni_spesa = spesa.giorni;
    if giorni_spesa <= 0 {
        return Err("I giorni della spesa devono essere maggiori di zero.".into());
    }

    let pda = parse_data(periodo_da)?;
    let paa = parse_data(periodo_a)?;
    let sda = parse_data(&spesa.spesa_da)?;
    let saa = parse_data(&spesa.spesa_a)?;
    if pda < sda || paa > saa {
        return Err("Il periodo deve essere compreso tra SpesaDa e SpesaA.".into());
    }

    let giorni_periodo = giorni_inclusivi(periodo_da, periodo_a)?;
    let totale = spesa.cifra + spesa.spese_pagamento; // cifra + spese di pagamento
    let importo_periodo =
        ((totale * giorni_periodo as f64 / giorni_spesa as f64) * 100.0).round() / 100.0;

    let occupanti = occupanti_nel_periodo(conn, id_condominio, periodo_da, periodo_a)?;
    let (quote, avviso) = calcola_quote(&occupanti, importo_periodo, &ripartizione, overrides)?;

    Ok(PropostaPeriodo {
        periodo_da: periodo_da.to_string(),
        periodo_a: periodo_a.to_string(),
        giorni_periodo,
        giorni_spesa,
        importo_periodo,
        ripartizione,
        quote,
        avviso,
    })
}

fn carica_quote(conn: &Connection, id_periodo: i64) -> Result<Vec<QuotaRiparto>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT r.IdRiparto, r.IdPeriodo, r.IdOccupante, r.IdUnita, r.Nominativo,
                    r.Percentuale, r.Peso, r.BaseCalcolo, r.Importo, COALESCE(u.Proprieta, '')
             FROM riparto_periodo r
             LEFT JOIN unita u ON u.IdUnita = r.IdUnita
             WHERE r.IdPeriodo = ?1
             ORDER BY r.Nominativo, r.IdRiparto",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![id_periodo], |row| {
            Ok(QuotaRiparto {
                id_riparto: row.get(0)?,
                id_periodo: row.get(1)?,
                id_occupante: row.get(2)?,
                id_unita: row.get(3)?,
                nominativo: row.get(4)?,
                percentuale: row.get(5)?,
                peso: row.get(6)?,
                base_calcolo: row.get(7)?,
                importo: row.get(8)?,
                proprieta_unita: row.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut lista = Vec::new();
    for row in rows {
        lista.push(row.map_err(|e| e.to_string())?);
    }
    Ok(lista)
}

fn carica_periodi(conn: &Connection, id_spesa: i64) -> Result<Vec<PeriodoSpesa>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT IdPeriodo, IdSpesa, PeriodoDa, PeriodoA, Giorni, Importo,
                    Archivia, RendicontoDel
             FROM periodo_spesa
             WHERE IdSpesa = ?1
             ORDER BY PeriodoDa, IdPeriodo",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![id_spesa], |row| {
            let archivia_i: i64 = row.get(6)?;
            Ok(PeriodoSpesa {
                id_periodo: row.get(0)?,
                id_spesa: row.get(1)?,
                periodo_da: row.get(2)?,
                periodo_a: row.get(3)?,
                giorni: row.get(4)?,
                importo: row.get(5)?,
                archivia: archivia_i != 0,
                rendiconto_del: row.get(7)?,
                quote: Vec::new(),
            })
        })
        .map_err(|e| e.to_string())?;

    let mut lista = Vec::new();
    for row in rows {
        let mut p = row.map_err(|e| e.to_string())?;
        p.quote = carica_quote(conn, p.id_periodo)?;
        lista.push(p);
    }
    Ok(lista)
}

fn carica_periodo(
    conn: &Connection,
    id_periodo: i64,
) -> Result<PeriodoSpesa, String> {
    let mut p = conn
        .query_row(
            "SELECT IdPeriodo, IdSpesa, PeriodoDa, PeriodoA, Giorni, Importo,
                    Archivia, RendicontoDel
             FROM periodo_spesa WHERE IdPeriodo = ?1",
            params![id_periodo],
            |row| {
                let archivia_i: i64 = row.get(6)?;
                Ok(PeriodoSpesa {
                    id_periodo: row.get(0)?,
                    id_spesa: row.get(1)?,
                    periodo_da: row.get(2)?,
                    periodo_a: row.get(3)?,
                    giorni: row.get(4)?,
                    importo: row.get(5)?,
                    archivia: archivia_i != 0,
                    rendiconto_del: row.get(7)?,
                    quote: Vec::new(),
                })
            },
        )
        .map_err(|_| "Periodo non trovato.".to_string())?;
    p.quote = carica_quote(conn, id_periodo)?;
    Ok(p)
}

#[tauri::command]
pub fn dettaglio_riparto_spesa(
    state: State<AppState>,
    id_spesa: i64,
) -> Result<SpesaDettaglioRiparto, String> {
    with_db(&state, |conn, _info| {
        let (spesa, ripartizione, _) = carica_spesa_base(conn, id_spesa)?;
        let giorni = spesa.giorni;
        let periodi = carica_periodi(conn, id_spesa)?;
        let totale_riparto: f64 = periodi.iter().map(|p| p.importo).sum();
        Ok(SpesaDettaglioRiparto {
            spesa,
            giorni,
            totale_riparto: (totale_riparto * 100.0).round() / 100.0,
            ripartizione,
            periodi,
        })
    })
}

#[tauri::command]
pub fn proponi_periodo_spesa(
    state: State<AppState>,
    id_spesa: i64,
    dati: PeriodoInput,
) -> Result<PropostaPeriodo, String> {
    let periodo_da = dati.periodo_da.trim().to_string();
    let periodo_a = dati.periodo_a.trim().to_string();
    let overrides = dati.quote;
    with_db(&state, |conn, info| {
        costruisci_proposta(
            conn,
            info.id_condominio,
            id_spesa,
            &periodo_da,
            &periodo_a,
            overrides.as_deref(),
        )
    })
}

#[tauri::command]
pub fn crea_periodo_spesa(
    state: State<AppState>,
    id_spesa: i64,
    dati: PeriodoInput,
) -> Result<PeriodoSpesa, String> {
    let periodo_da = dati.periodo_da.trim().to_string();
    let periodo_a = dati.periodo_a.trim().to_string();
    let overrides = dati.quote;

    with_db(&state, |conn, info| {
        // Se il nuovo periodo interseca periodi già creati, li spezza/aggiorna
        // (es. periodo pieno → pezzo iniziale + pezzo fino alla fine della spesa).
        spezza_periodi_sovrapposti(
            conn,
            info.id_condominio,
            id_spesa,
            &periodo_da,
            &periodo_a,
        )?;

        let proposta = costruisci_proposta(
            conn,
            info.id_condominio,
            id_spesa,
            &periodo_da,
            &periodo_a,
            overrides.as_deref(),
        )?;

        let id_periodo = crea_periodo_da_proposta(conn, id_spesa, &proposta)?;
        sincronizza_stato_spesa_da_periodi(conn, id_spesa)?;
        carica_periodo(conn, id_periodo)
    })
}

#[tauri::command]
pub fn elimina_periodo_spesa(state: State<AppState>, id_periodo: i64) -> Result<(), String> {
    with_db(&state, |conn, _info| {
        let id_spesa: i64 = conn
            .query_row(
                "SELECT IdSpesa FROM periodo_spesa WHERE IdPeriodo = ?1",
                params![id_periodo],
                |row| row.get(0),
            )
            .map_err(|_| "Periodo non trovato.".to_string())?;

        elimina_periodo_db(conn, id_periodo)?;
        sincronizza_stato_spesa_da_periodi(conn, id_spesa)?;
        Ok(())
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuotaAggiornamentoInput {
    pub id_riparto: i64,
    pub percentuale: f64,
    pub peso: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AggiornaPeriodoInput {
    pub quote: Vec<QuotaAggiornamentoInput>,
    #[serde(default)]
    pub archivia: bool,
    #[serde(default)]
    pub rendiconto_del: String,
}

/// Aggiorna percentuali/parti (o millesimi) di un periodo già creato e ricalcola gli importi.
#[tauri::command]
pub fn aggiorna_quote_periodo(
    state: State<AppState>,
    id_periodo: i64,
    dati: AggiornaPeriodoInput,
) -> Result<PeriodoSpesa, String> {
    let rendiconto_del = dati.rendiconto_del.trim().to_string();
    if rendiconto_del.len() > 200 {
        return Err("«Rendiconto del» può avere al massimo 200 caratteri.".into());
    }
    let archivia_i: i64 = if dati.archivia { 1 } else { 0 };
    let quote = dati.quote;

    with_db(&state, |conn, _info| {
        let (importo, id_spesa): (f64, i64) = conn
            .query_row(
                "SELECT Importo, IdSpesa FROM periodo_spesa WHERE IdPeriodo = ?1",
                params![id_periodo],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|_| "Periodo non trovato.".to_string())?;

        conn.execute(
            "UPDATE periodo_spesa
             SET Archivia = ?1, RendicontoDel = ?2
             WHERE IdPeriodo = ?3",
            params![archivia_i, rendiconto_del, id_periodo],
        )
        .map_err(|e| e.to_string())?;

        let mut esistenti = carica_quote(conn, id_periodo)?;
        if esistenti.is_empty() {
            return Err("Questo periodo non ha quote da modificare.".into());
        }

        for q in &mut esistenti {
            let ov = quote
                .iter()
                .find(|x| x.id_riparto == q.id_riparto)
                .ok_or_else(|| {
                    format!(
                        "Manca l’aggiornamento per la quota di «{}».",
                        q.nominativo
                    )
                })?;

            if !ov.percentuale.is_finite() || ov.percentuale < 0.0 || ov.percentuale > 100.0 {
                return Err(format!(
                    "Percentuale non valida per «{}» (usa un valore tra 0 e 100).",
                    q.nominativo
                ));
            }
            if !ov.peso.is_finite() || ov.peso < 0.0 {
                return Err(format!(
                    "Valore parti/millesimi non valido per «{}».",
                    q.nominativo
                ));
            }

            q.percentuale = ov.percentuale;
            q.peso = ov.peso;
            q.base_calcolo = q.percentuale * q.peso;
        }

        let totale: f64 = esistenti.iter().map(|q| q.base_calcolo).sum();
        if totale <= 0.0 {
            let n = esistenti.len() as f64;
            let quota = importo / n;
            for q in &mut esistenti {
                q.importo = (quota * 100.0).round() / 100.0;
            }
        } else {
            for q in &mut esistenti {
                q.importo = ((importo * q.base_calcolo / totale) * 100.0).round() / 100.0;
            }
        }
        let somma: f64 = esistenti.iter().map(|q| q.importo).sum();
        let diff = ((importo - somma) * 100.0).round() / 100.0;
        if let Some(last) = esistenti.last_mut() {
            last.importo = ((last.importo + diff) * 100.0).round() / 100.0;
        }

        for q in &esistenti {
            conn.execute(
                "UPDATE riparto_periodo
                 SET Percentuale = ?1, Peso = ?2, BaseCalcolo = ?3, Importo = ?4
                 WHERE IdRiparto = ?5 AND IdPeriodo = ?6",
                params![
                    q.percentuale,
                    q.peso,
                    q.base_calcolo,
                    q.importo,
                    q.id_riparto,
                    id_periodo
                ],
            )
            .map_err(|e| e.to_string())?;
        }

        sincronizza_stato_spesa_da_periodi(conn, id_spesa)?;
        carica_periodo(conn, id_periodo)
    })
}
