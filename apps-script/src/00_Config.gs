/**
 * EDITH – Gestione posta personale (bollette, assicurazioni, iscrizioni, spazio)
 * ---------------------------------------------------------------------------
 * Configurazione centrale. Cambia qui nomi di etichette, fogli e soglie.
 */
const CONFIG = {
  // ID dello Sheet EDITH (usato se lo script non è "legato" allo Sheet)
  SHEET_ID: '',

  TIMEZONE: 'Europe/Rome',

  // EDITH gestisce solo le mail da questo anno in poi (le precedenti vengono ignorate)
  ANNO_INIZIO: 2026,

  // Etichette Gmail da elaborare (nome esatto come appare in Gmail)
  LABEL_BOLLETTE: 'bollettazione',
  LABEL_ASSICURAZIONI: 'ASSICURAZIONI',
  // Etichetta applicata dallo script alle mail già elaborate (non toccarla a mano)
  LABEL_ELABORATA: 'EDITH/elaborata',
  // Etichetta per le newsletter filtrate
  LABEL_NEWSLETTER: 'EDITH/newsletter',

  // Fogli
  SHEET_BOLLETTE: 'BOLLETTAZIONE',
  SHEET_ASSICURAZIONI: 'ASSICURAZIONE',
  SHEET_RIEPILOGO: 'RIEPILOGO',
  SHEET_DASHBOARD: 'DASHBOARD',
  SHEET_ISCRIZIONI: 'ISCRIZIONI',
  SHEET_PULIZIA: 'PULIZIA',
  SHEET_PESANTI: 'MAIL PESANTI',
  SHEET_LOG: 'LOG',
  SHEET_ACCESSI: 'ACCESSI',
  SHEET_OFFERTE: 'OFFERTE',
  SHEET_SPESE: 'SPESE',
  SHEET_SPESE_FISSE: 'SPESE FISSE',

  // Promemoria
  // 'principale' = eventi nel tuo calendario di sempre (consigliato); 'dedicato' = calendario separato EDITH Scadenze
  CALENDARIO: 'principale',
  CALENDAR_NAME: 'EDITH Scadenze',
  // Le attività vanno nella lista predefinita "Le mie attività", sempre visibile in Calendar
  TASKLIST_NAME: 'EDITH Pagamenti', // vecchia lista dedicata: usata solo per ripulire e sincronizzare
  CREA_EVENTO: false, // true = oltre all'attività crea anche un evento (non spuntabile)
  GIORNI_PREAVVISO: 2,
  ORA_EVENTO: 9, // l'evento viene messo alle 9:00 del giorno di scadenza

  // Limiti per singola esecuzione (Apps Script ha un limite di 6 minuti)
  MAX_MAIL_PER_RUN: 12,
  TEMPO_MAX_MS: 4.5 * 60 * 1000,

  // Iscrizioni: quanto indietro guardare e quante mail analizzare al massimo
  ISCRIZIONI_GIORNI: 180,
  ISCRIZIONI_MAX_MAIL: 1500,

  // Spazio: soglia per il report delle mail pesanti
  PESANTI_QUERY: 'larger:5M',
  PESANTI_MAX: 200,

  // Queste mail non vengono MAI toccate dalla pulizia
  // (in più lo script esclude sempre le etichette bollette e assicurazioni)
  PROTEZIONE_QUERY: '-is:starred -is:important',
};

// Stati della pratica
const STATO = {
  DA_PAGARE: 'Da pagare',
  SCADUTA: 'Scaduta',
  CONCLUSA: 'Conclusa',
  DA_VERIFICARE: 'Da verificare',
};

// Colonne dei fogli. Le prime 6 di BOLLETTAZIONE sono quelle che hai già creato tu:
// lo script le riconosce per nome (maiuscole/spazi ignorati) e aggiunge in coda quelle mancanti.
const COLONNE = {
  bollette: [
    'FORNITURA', 'DATA EMISSIONE', 'DATA COMUNICAZIONE', 'DATA SCADENZA', 'IMPORTO', 'STATO PAGAMENTO',
    'FORNITORE', 'N. DOCUMENTO', 'PAGATA IL', 'OGGETTO MAIL', 'LINK MAIL', 'NOTE OCR',
    'ID MAIL', 'EVENT ID', 'TASK ID',
  ],
  assicurazioni: [
    'RAMO', 'DATA EMISSIONE', 'DATA COMUNICAZIONE', 'DATA SCADENZA', 'IMPORTO', 'STATO PAGAMENTO',
    'COMPAGNIA', 'N. POLIZZA', 'SEMESTRE', 'PROSSIMA RATA PREVISTA', 'PAGATA IL', 'OGGETTO MAIL',
    'LINK MAIL', 'NOTE OCR', 'ID MAIL', 'EVENT ID', 'TASK ID',
  ],
};
