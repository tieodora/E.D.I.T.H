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

/** Funzioni di supporto comuni. */

/** ID dello Sheet: prima le Proprietà dello script, poi CONFIG (e lo salva), così il codice su GitHub può restare senza ID. */
function idSheet_() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('SHEET_ID');
  if (!id && CONFIG.SHEET_ID && !/INCOLLA/.test(CONFIG.SHEET_ID)) { id = CONFIG.SHEET_ID; props.setProperty('SHEET_ID', id); }
  if (!id) throw new Error('Manca l\'ID dello Sheet: in Impostazioni progetto › Proprietà script aggiungi SHEET_ID');
  return id;
}

function ss_() {
  const id = idSheet_();
  try {
    const active = SpreadsheetApp.getActiveSpreadsheet();
    if (active && active.getId() === id) return active;
  } catch (e) { /* script non legato allo sheet */ }
  return SpreadsheetApp.openById(id);
}

function sheet_(name) {
  const ss = ss_();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function norm_(s) {
  return String(s || '').toUpperCase().replace(/\s+/g, ' ').trim();
}

/** Garantisce che il foglio abbia tutte le colonne richieste; restituisce mappa NOME -> indice (0-based). */
function ensureHeaders_(sh, colonne) {
  const lastCol = Math.max(sh.getLastColumn(), 1);
  const header = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(norm_);
  const isEmpty = header.every(h => !h);
  let current = isEmpty ? [] : header.slice();
  // rimuove celle vuote in coda
  while (current.length && !current[current.length - 1]) current.pop();
  colonne.forEach(c => { if (current.indexOf(norm_(c)) === -1) current.push(norm_(c)); });
  sh.getRange(1, 1, 1, current.length).setValues([current])
    .setFontWeight('bold').setBackground('#1f3b57').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  return colMap_(sh);
}

function colMap_(sh) {
  const header = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0];
  const map = {};
  header.forEach((h, i) => { if (h) map[norm_(h)] = i; });
  return map;
}

/** Legge i dati come array di oggetti {_row, NOME: valore}. */
function readRows_(sh) {
  const map = colMap_(sh);
  const last = sh.getLastRow();
  if (last < 2) return { map, rows: [] };
  const values = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  const rows = values.map((r, i) => {
    const o = { _row: i + 2 };
    Object.keys(map).forEach(k => { o[k] = r[map[k]]; });
    return o;
  });
  return { map, rows };
}

function appendObj_(sh, map, obj) {
  const width = sh.getLastColumn();
  const row = new Array(width).fill('');
  Object.keys(obj).forEach(k => {
    const idx = map[norm_(k)];
    if (idx !== undefined) row[idx] = obj[k];
  });
  sh.appendRow(row);
  const r = sh.getLastRow();
  // formati sulla riga nuova (date senza ora, importo in euro)
  Object.keys(map).forEach(k => {
    if (/^DATA |PAGATA IL|PROSSIMA RATA/.test(k)) sh.getRange(r, map[k] + 1).setNumberFormat('dd/MM/yyyy');
    if (k === 'IMPORTO') sh.getRange(r, map[k] + 1).setNumberFormat('€ #,##0.00');
  });
  return r;
}

function setCell_(sh, map, rowNum, colName, value) {
  const idx = map[norm_(colName)];
  if (idx === undefined) return;
  sh.getRange(rowNum, idx + 1).setValue(value);
}

function getOrCreateLabel_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

/**
 * Trova l'etichetta Gmail ignorando maiuscole/minuscole e accettando anche etichette annidate
 * (es. "Casa/Assicurazioni" per "ASSICURAZIONI"). Restituisce il nome esatto o null.
 */
function trovaEtichetta_(nome) {
  const cercato = String(nome).toLowerCase().trim();
  const nomi = GmailApp.getUserLabels().map(l => l.getName());
  return nomi.find(n => n.toLowerCase() === cercato) ||
    nomi.find(n => n.toLowerCase().split('/').pop().trim() === cercato) ||
    nomi.find(n => n.toLowerCase().replace(/\s+/g, '').indexOf(cercato.replace(/\s+/g, '').replace(/i$/, '')) !== -1) || null;
}

/** Converte un nome etichetta nella sintassi di ricerca Gmail (label:nome-con-trattini). */
function labelQuery_(name) {
  return 'label:' + String(name).toLowerCase().replace(/[\s\/&]+/g, '-');
}

function protezioneQuery_() {
  return [
    CONFIG.PROTEZIONE_QUERY,
    '-' + labelQuery_(trovaEtichetta_(CONFIG.LABEL_BOLLETTE) || CONFIG.LABEL_BOLLETTE),
    '-' + labelQuery_(trovaEtichetta_(CONFIG.LABEL_ASSICURAZIONI) || CONFIG.LABEL_ASSICURAZIONI),
  ].join(' ');
}

function fmtDate_(d, pattern) {
  if (!(d instanceof Date)) return '';
  return Utilities.formatDate(d, CONFIG.TIMEZONE, pattern || 'dd/MM/yyyy');
}

function euro_(n) {
  if (typeof n !== 'number' || isNaN(n)) return '';
  return '€ ' + n.toFixed(2).replace('.', ',');
}

function log_(azione, dettaglio) {
  try {
    const sh = sheet_(CONFIG.SHEET_LOG);
    if (sh.getLastRow() === 0) sh.appendRow(['QUANDO', 'AZIONE', 'DETTAGLIO']);
    sh.appendRow([new Date(), azione, String(dettaglio).slice(0, 5000)]);
    if (sh.getLastRow() > 3000) sh.deleteRows(2, 500);   // il registro non cresce all'infinito
  } catch (e) {
    console.log(azione + ': ' + dettaglio);
  }
}

/** Chiede conferma con una finestra nello Sheet. Fuori dallo Sheet (es. editor o trigger) risponde NO. */
function conferma_(titolo, messaggio) {
  try {
    const ui = SpreadsheetApp.getUi();
    return ui.alert(titolo, messaggio, ui.ButtonSet.YES_NO) === ui.Button.YES;
  } catch (e) {
    console.log('Conferma non disponibile fuori dallo Sheet: azione annullata. Usa il menu EDITH nello Sheet.');
    return false;
  }
}

function avviso_(messaggio) {
  try { SpreadsheetApp.getUi().alert(messaggio); } catch (e) { console.log(messaggio); }
}

function toast_(messaggio) {
  try { ss_().toast(messaggio, 'EDITH', 5); } catch (e) { console.log(messaggio); }
}

/** Errore dovuto ai limiti giornalieri di Google (meglio fermarsi e riprovare al giro dopo). */
function eLimiteGoogle_(e) {
  return /too many times|quota|limit exceeded|rate limit|troppe volte|limite|service unavailable|try again later/i.test(String(e && e.message || e));
}

/** Riprova una funzione che può fallire per un disguido temporaneo di Google. */
function conRiprova_(fn, tentativi) {
  tentativi = tentativi || 3;
  for (let i = 1; ; i++) {
    try { return fn(); } catch (e) {
      if (i >= tentativi || !/unavailable|internal error|backend error|timed out|timeout|server error|try again|errore interno|empty response/i.test(String(e.message))) throw e;
      Utilities.sleep(1000 * i * i);
    }
  }
}

function tempoScaduto_(start) {
  return Date.now() - start > CONFIG.TEMPO_MAX_MS;
}

/**
 * OCR dei PDF allegati ed estrazione dei dati (tipo, date, importo).
 * L'OCR usa Google Drive: il PDF viene convertito temporaneamente in Google Doc
 * (funziona sia sui PDF "testuali" sia su quelli scansionati), letto e poi eliminato.
 */

function ocrPdf_(blob) {
  const nome = 'EDITH_OCR_tmp_' + Date.now();
  let file, pdfTemp;
  try {
    file = conRiprova_(() => Drive.Files.create({ name: nome, mimeType: MimeType.GOOGLE_DOCS }, blob, { ocrLanguage: 'it', fields: 'id' }));
  } catch (e) {
    if (eLimiteGoogle_(e)) throw e;
    // Ripiego: alcuni PDF non si convertono al caricamento ma si convertono con una copia
    pdfTemp = Drive.Files.create({ name: nome + '.pdf' }, blob.setContentType('application/pdf'), { fields: 'id' });
    file = Drive.Files.copy({ name: nome, mimeType: MimeType.GOOGLE_DOCS }, pdfTemp.id, { ocrLanguage: 'it', fields: 'id' });
  }
  try {
    return conRiprova_(() => DocumentApp.openById(file.id).getBody().getText());
  } finally {
    [file, pdfTemp].forEach(f => {
      if (!f) return;
      try { Drive.Files.remove(f.id); } catch (e) { try { DriveApp.getFileById(f.id).setTrashed(true); } catch (e2) {} }
    });
  }
}

// ---------- Regole di classificazione ----------

const TIPI_FORNITURA = [
  { tipo: 'Luce', kw: [/energia elettrica/g, /\bluce\b/g, /\bkwh\b/g, /\bpod\b/g, /potenza impegnata/g] },
  { tipo: 'Gas', kw: [/\bgas\b/g, /\bsmc\b/g, /\bpdr\b/g, /gas naturale/g] },
  { tipo: 'Acqua', kw: [/servizio idrico/g, /\bacqua\b/g, /acquedotto/g, /depurazione/g, /fognatura/g] },
  { tipo: 'Telefono/Internet', kw: [/\bfibra\b/g, /internet/g, /telefon/g, /\bmobile\b/g, /\badsl\b/g, /\bgiga\b/g, /linea fissa/g] },
  { tipo: 'Rifiuti (TARI)', kw: [/\btari\b/g, /rifiuti/g, /igiene urbana/g] },
  { tipo: 'Condominio', kw: [/condomin/g, /amministratore/g] },
];

const RAMI_ASSICURATIVI = [
  { tipo: 'Auto', kw: [/\brca\b/g, /\bauto\b/g, /autovettura/g, /veicolo/g, /\btarga\b/g] },
  { tipo: 'Moto', kw: [/\bmoto\b/g, /motociclo/g, /ciclomotore/g, /scooter/g] },
  { tipo: 'Casa', kw: [/abitazione/g, /\bcasa\b/g, /incendio/g, /fabbricato/g, /furto/g] },
  { tipo: 'Vita', kw: [/\bvita\b/g, /caso morte/g, /\btcm\b/g] },
  { tipo: 'Salute/Infortuni', kw: [/salute/g, /infortun/g, /malattia/g, /sanitari/g] },
  { tipo: 'Viaggio', kw: [/viaggio/g] },
];

const FORNITORI_NOTI = [
  'Enel', 'Hera', 'A2A', 'Plenitude', 'Eni', 'Iren', 'Acea', 'Edison', 'Sorgenia', 'Engie', 'Illumia',
  'Octopus', 'Piemonte Energy', 'Iberdrola', 'E.ON', 'Estra', 'Dolomiti', 'Duferco', 'Pulsee', 'NeN', 'Servizio Elettrico Nazionale',
  'TIM', 'Vodafone', 'WindTre', 'Iliad', 'Fastweb', 'Sky', 'Tiscali', 'Ho.', 'Kena', 'Very Mobile', 'PosteMobile',
  'Sara', 'Generali', 'UnipolSai', 'Unipol', 'Allianz', 'AXA', 'Zurich', 'Reale Mutua', 'Cattolica', 'Vittoria',
  'Prima', 'Genertel', 'Linear', 'Verti', 'ConTe', 'Quixa', 'Direct Line', 'Poste Assicura', 'Helvetia', 'HDI',
];

const MESI = {
  gennaio: 1, gen: 1, febbraio: 2, feb: 2, marzo: 3, mar: 3, aprile: 4, apr: 4, maggio: 5, mag: 5,
  giugno: 6, giu: 6, luglio: 7, lug: 7, agosto: 8, ago: 8, settembre: 9, set: 9, sett: 9,
  ottobre: 10, ott: 10, novembre: 11, nov: 11, dicembre: 12, dic: 12,
};

const RE_DATA_NUM = /(\d{1,2})\s?[\/\.\-]\s?(\d{1,2})\s?[\/\.\-]\s?(\d{2,4})/;
const RE_DATA_TXT = /(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre|gen|feb|mar|apr|mag|giu|lug|ago|sett?|ott|nov|dic)\.?\s+(\d{4})/i;
const RE_IMPORTO = /(?:€|eur(?:o)?)?\s*(\d{1,3}(?:[.\s]\d{3})*,\d{2}|\d+,\d{2})(?!\d)\s*(?:€|eur(?:o)?)?/i;

function parseData_(s) {
  let m = s.match(RE_DATA_NUM);
  let d = null;
  let idx = Infinity;
  if (m) {
    let y = +m[3]; if (y < 100) y += 2000;
    const cand = new Date(y, +m[2] - 1, +m[1], 12);
    if (cand.getMonth() === +m[2] - 1) { d = cand; idx = m.index; }
  }
  const t = s.match(RE_DATA_TXT);
  if (t && t.index < idx) {
    const cand = new Date(+t[3], MESI[t[2].toLowerCase().replace('.', '')] - 1, +t[1], 12);
    if (!isNaN(cand)) d = cand;
  }
  if (d && (d.getFullYear() < 2000 || d.getFullYear() > 2100)) return null;
  return d;
}

function parseEuro_(s) {
  const n = parseFloat(String(s).replace(/[.\s]/g, '').replace(',', '.'));
  return isNaN(n) ? null : n;
}

/** Cerca la prima data che compare subito dopo una delle parole chiave (in ordine di priorità). */
function dataDopo_(text, keywords, finestra, valida) {
  for (const kw of keywords) {
    const re = new RegExp(kw, 'gi');
    let m;
    while ((m = re.exec(text)) !== null) {
      const d = parseData_(text.substr(m.index + m[0].length, finestra || 80));
      if (d && (!valida || valida(d))) return d;
    }
  }
  return null;
}

function importoDopo_(text, keywords) {
  for (const kw of keywords) {
    const re = new RegExp(kw, 'gi');
    let m;
    while ((m = re.exec(text)) !== null) {
      const tail = text.substr(m.index + m[0].length, 80);
      const a = tail.match(RE_IMPORTO);
      if (a) {
        const n = parseEuro_(a[1]);
        if (n !== null && n > 0 && n < 100000) return n;
      }
    }
  }
  return null;
}

function classifica_(low, regole) {
  let best = null, bestScore = 0;
  const punteggi = {};
  regole.forEach(r => {
    const score = r.kw.reduce((s, re) => s + ((low.match(re) || []).length), 0);
    punteggi[r.tipo] = score;
    if (score > bestScore) { best = r.tipo; bestScore = score; }
  });
  if (punteggi['Luce'] >= 3 && punteggi['Gas'] >= 3) return 'Luce e Gas';
  return best;
}

function fornitore_(text, mittente, oggetto) {
  // prima mittente e oggetto, solo dopo il testo (che può citare altre compagnie)
  for (const hay of [(oggetto + ' ' + mittente).toLowerCase(), text.slice(0, 3000).toLowerCase()]) {
    for (const f of FORNITORI_NOTI) {
      const re = new RegExp('(^|[^a-z])' + f.toLowerCase().replace(/[.]/g, '\\.') + '([^a-z]|$)');
      if (re.test(hay)) return f;
    }
  }
  // altrimenti: prima parte dell'oggetto ("Piemonte Energy - bollette luce") o nome del mittente
  const ogg = String(oggetto || '').replace(/^((re|fwd?|i|r):\s*)+/i, '');
  const SEP = /\s[-–|]\s|:\s/;
  const dalOggetto = SEP.test(ogg) ? ogg.split(SEP)[0].trim() : '';
  if (dalOggetto && dalOggetto.length <= 40 && !/^(re|fwd?|i|r):?$/i.test(dalOggetto)) return dalOggetto.replace(/^(re|fwd?|i|r):\s*/i, '');
  const m = String(mittente).match(/^"?([^"<]+)"?\s*</);
  return m ? m[1].trim() : String(mittente).replace(/.*@/, '').replace(/>.*/, '');
}

/**
 * Estrae i dati dal testo. tipoPratica: 'bollette' | 'assicurazioni'.
 */
function estraiDati_(text, tipoPratica, mittente, oggetto) {
  // l'oggetto va in testa: spesso contiene già "in scadenza il ..." o il numero di polizza
  const t = (String(oggetto || '') + '\n' + String(text || '')).replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ');
  const low = t.toLowerCase();
  const isAss = tipoPratica === 'assicurazioni';

  const emissione = dataDopo_(t, [
    'data emissione', 'data di emissione', 'emessa il', 'data fattura', 'data documento',
    'fattura n[^\\n]{0,40}?del', 'bolletta n[^\\n]{0,40}?del', 'avviso n[^\\n]{0,40}?del', 'del giorno',
  ], 60);

  const scadenza = dataDopo_(t, isAss
    ? ['scadenza rata', 'data scadenza', 'scadenza', 'pagare entro il', 'entro il', 'scade il', 'data effetto', 'decorrenza', 'addebit\\w* (?:il|in data)']
    : ['data scadenza', 'scadenza', 'da pagare entro il', 'pagare entro', 'entro il', 'scade il', 'addebit\\w* (?:il|in data|a partire dal)', 'data (?:di )?addebito', 'pagamento entro'], 100,
    d => !emissione || d >= emissione);

  const importo = importoDopo_(t, isAss
    ? ['premio totale', 'premio lordo', 'totale da pagare', 'importo da pagare', 'importo rata', 'premio rata', 'totale', 'premio', 'importo']
    : ['totale da pagare', 'importo da pagare', 'totale bolletta', 'totale fattura', 'totale documento', 'importo totale', 'importo addebitato', 'sar[aà] addebitat[oa]', 'importo da addebitare', 'da pagare', 'totale', 'importo']);

  const docMatch = t.match(/(?:fattura|bolletta|documento)\s*(?:n\.?|nr\.?|numero|n°)?\s*[:°]?\s*([A-Z0-9\/\-]*\d[A-Z0-9\/\-]*)/i);
  const polMatch = t.match(/(?:[Pp]olizza|POLIZZA|[Cc]ontratto|CONTRATTO)\s*(?:[Nn]\.?|[Nn]r\.?|[Nn]umero|[Nn]°)?\s*[:°]?\s*(\d[A-Z0-9\/\-]{3,14}|[A-Z]{1,4}\d[A-Z0-9\/\-]{3,14})(?![a-z])/);

  const tipo = classifica_(low, isAss ? RAMI_ASSICURATIVI : TIPI_FORNITURA);
  const trovati = [tipo, scadenza, emissione, importo].filter(x => x).length;

  return {
    tipo: tipo || 'Altro',
    scadenza, emissione, importo,
    numero: (isAss ? (polMatch ? polMatch[1] : '') : (docMatch ? docMatch[1] : ''))
      .replace(/(PREMIO|IMPORTO|SCADENZA|TARGA|DEL|RATA).*$/, ''),
    fornitore: fornitore_(t, mittente || '', oggetto || ''),
    confidenza: trovati,
  };
}

/**
 * Elaborazione delle mail con etichetta "bollettazione" e "assicurazioni".
 * Per ogni mail nuova: OCR dei PDF -> riga nello Sheet -> evento Calendar + attività Tasks.
 * Le mail elaborate ricevono l'etichetta EDITH/elaborata e non vengono riprocessate.
 */

function elaboraTutto() {
  // Evita due elaborazioni in contemporanea (trigger orario + tasto nell'app) che creerebbero doppioni
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) { log_('Elaborazione', 'Già in corso, salto questo giro'); return; }
  try {
    const start = Date.now();
    let prima = [];
    try { prima = pratiche_(); } catch (e) { }
    elaboraPratiche_('bollette', start);
    if (!tempoScaduto_(start)) elaboraPratiche_('assicurazioni', start);
    if (!tempoScaduto_(start)) sincronizzaStati();
    if (!tempoScaduto_(start) && !PropertiesService.getScriptProperties().getProperty('OFFERTE_LETTE')) leggiOfferte(start);
    if (!tempoScaduto_(start)) riprovaDaVerificare_(start);
    try { registraSpeseFisse_(); } catch (e) { log_('Spese fisse', e.message); }
    avvisaNuoveDaVerificare_(prima);
    PropertiesService.getScriptProperties().setProperty('ULTIMO_CONTROLLO', String(Date.now()));
    svuotaCache_();
  } catch (e) {
    log_('Errore elaborazione', e.message);
    notifica_('Errore nel controllo della posta', ['Il controllo automatico della posta si è fermato con questo errore:', e.message,
      'Riprovo da sola tra un\'ora. Se l\'errore si ripete, apri Apps Script › Esecuzioni.'], 'errore_elabora');
  } finally {
    lock.releaseLock();
  }
}

function elaboraBollette() { elaboraPratiche_('bollette', Date.now()); }
function elaboraAssicurazioni() { elaboraPratiche_('assicurazioni', Date.now()); }

function configPratica_(tipoPratica) {
  return tipoPratica === 'assicurazioni'
    ? { label: CONFIG.LABEL_ASSICURAZIONI, sheet: CONFIG.SHEET_ASSICURAZIONI, colonne: COLONNE.assicurazioni }
    : { label: CONFIG.LABEL_BOLLETTE, sheet: CONFIG.SHEET_BOLLETTE, colonne: COLONNE.bollette };
}

function elaboraPratiche_(tipoPratica, start) {
  const cfg = configPratica_(tipoPratica);
  const nomeLabel = trovaEtichetta_(cfg.label);
  if (!nomeLabel) {
    log_('Etichetta mancante', 'Non trovo l\'etichetta "' + cfg.label + '" in Gmail. Controlla CONFIG.');
    return;
  }
  const sh = sheet_(cfg.sheet);
  const map = ensureHeaders_(sh, cfg.colonne);
  const giaPresenti = new Set(readRows_(sh).rows.map(r => String(r['ID MAIL'])));
  const labelOk = getOrCreateLabel_(CONFIG.LABEL_ELABORATA);

  // include anche le sotto-etichette (es. bollettazione/luce, bollettazione/gas)
  const tutte = GmailApp.getUserLabels().map(l => l.getName())
    .filter(n => n === nomeLabel || n.toLowerCase().indexOf(nomeLabel.toLowerCase() + '/') === 0);
  const filtroLabel = '(' + tutte.map(labelQuery_).join(' OR ') + ')';
  const query = filtroLabel + ' -' + labelQuery_(CONFIG.LABEL_ELABORATA) + ' after:' + (CONFIG.ANNO_INIZIO - 1) + '/12/31';
  // + le conversazioni recenti già etichettate, per non perdere una nuova bolletta
  //   arrivata nella stessa conversazione di una vecchia (i duplicati si scartano con ID MAIL)
  const threads = GmailApp.search(query, 0, CONFIG.MAX_MAIL_PER_RUN);
  const visti = new Set(threads.map(t => t.getId()));
  GmailApp.search(filtroLabel + ' newer_than:3d', 0, 20)
    .forEach(t => { if (!visti.has(t.getId())) threads.push(t); });
  let nuove = 0;

  for (const thread of threads) {
    if (tempoScaduto_(start)) break;
    const inizio = new Date(CONFIG.ANNO_INIZIO, 0, 1);
    const messaggi = thread.getMessages().filter(m => m.getDate() >= inizio);
    if (!messaggi.length) { thread.addLabel(labelOk); continue; }
    let registrateNelThread = messaggi.some(m => giaPresenti.has(m.getId()));
    for (const msg of messaggi) {
      if (giaPresenti.has(msg.getId())) continue;
      try {
        const dati = analizzaMessaggio_(msg, tipoPratica);
        if (!dati) continue; // nessun PDF e nessun dato utile (es. risposta nel thread)
        registraPratica_(sh, map, msg, thread, dati, tipoPratica);
        giaPresenti.add(msg.getId());
        registrateNelThread = true;
        nuove++;
      } catch (e) {
        if (eLimiteGoogle_(e)) { log_('Limite Google', 'Raggiunto il limite giornaliero (' + e.message + '): riprendo al prossimo giro.'); return; }
        log_('Errore ' + tipoPratica, msg.getSubject() + ' -> ' + e.message);
      }
    }
    // Nessuna mail utile nella conversazione: la registro comunque come "Da verificare",
    // così nessuna mail etichettata sparisce senza traccia.
    const ultimo = messaggi[messaggi.length - 1];
    const pareUnaPratica = /scaden|pagament|rata|quietanza|bollett|fattur|premio|rinnov|importo|addebito|avviso/i.test(ultimo.getSubject());
    if (!registrateNelThread && !pareUnaPratica) {
      log_('Ignorata ' + tipoPratica, 'Non sembra una bolletta/rata: ' + ultimo.getSubject());
    }
    if (!registrateNelThread && pareUnaPratica) {
      const d = estraiDati_(ultimo.getPlainBody(), tipoPratica, ultimo.getFrom(), ultimo.getSubject());
      const nAll = ultimo.getAttachments({ includeInlineImages: false }).length;
      d.note = ['nessun PDF leggibile (' + nAll + ' allegati): controlla la mail'];
      d.forzaVerifica = true;
      registraPratica_(sh, map, ultimo, thread, d, tipoPratica);
      giaPresenti.add(ultimo.getId());
      log_('Da verificare ' + tipoPratica, ultimo.getSubject() + ' -> ' + d.note[0]);
      nuove++;
    }
    thread.addLabel(labelOk);
  }
  if (nuove) {
    log_('Elaborazione ' + tipoPratica, nuove + ' nuove pratiche registrate');
    aggiornaDashboard();
  }
}

/** OCR di tutti i PDF del messaggio, tiene il risultato più completo. Se non ci sono PDF usa il testo della mail. */
function analizzaMessaggio_(msg, tipoPratica) {
  const mittente = msg.getFrom();
  const pdfs = msg.getAttachments({ includeInlineImages: false })
    .filter(a => a.getContentType() === 'application/pdf' || /\.pdf$/i.test(a.getName()));

  let migliore = null;
  let note = [];
  for (const pdf of pdfs.slice(0, 3)) {
    try {
      const testo = ocrPdf_(pdf.copyBlob());
      const d = estraiDati_(testo, tipoPratica, mittente, msg.getSubject());
      d.testo = testo;
      if (!migliore || d.confidenza > migliore.confidenza) migliore = d;
    } catch (e) {
      note.push('OCR fallito su ' + pdf.getName() + ' (' + e.message + ')');
    }
  }
  // Ripiego: testo della mail (alcuni fornitori scrivono importo e scadenza nel corpo)
  const corpo = estraiDati_(msg.getPlainBody(), tipoPratica, mittente, msg.getSubject());
  if (!migliore) {
    if (!pdfs.length && corpo.confidenza < 3) return null;
    migliore = corpo;
    note.push(pdfs.length ? 'dati letti dal testo della mail' : 'nessun PDF: dati letti dal testo della mail');
  } else {
    ['scadenza', 'emissione', 'importo', 'numero'].forEach(k => { if (!migliore[k] && corpo[k]) migliore[k] = corpo[k]; });
    if (migliore.tipo === 'Altro' && corpo.tipo !== 'Altro') migliore.tipo = corpo.tipo;
  }
  migliore.note = note;
  migliore.testo = (migliore.testo || '') + '\n' + msg.getPlainBody();
  return migliore;
}

function registraPratica_(sh, map, msg, thread, d, tipoPratica) {
  const ricevuta = msg.getDate();
  // una data di emissione successiva alla mail non è plausibile
  const emissione = (d.emissione && d.emissione <= new Date(ricevuta.getTime() + 2 * 864e5)) ? d.emissione : ricevuta;
  if (unisciDuplicato_(sh, map, d, tipoPratica, msg)) return;
  const mancanti = [];
  if (!d.scadenza) mancanti.push('scadenza');
  if (!d.importo) mancanti.push('importo');
  if (d.tipo === 'Altro') mancanti.push('tipo');
  const note = d.note.concat(mancanti.length ? ['da controllare: ' + mancanti.join(', ')] : []);
  note.unshift('campi trovati ' + d.confidenza + '/4');

  let stato = (mancanti.length || d.forzaVerifica) ? STATO.DA_VERIFICARE : STATO.DA_PAGARE;
  if (stato === STATO.DA_PAGARE && d.scadenza < oggi_()) stato = STATO.SCADUTA;

  const obj = {
    'DATA EMISSIONE': emissione,
    'DATA COMUNICAZIONE': ricevuta,
    'DATA SCADENZA': d.scadenza || '',
    'IMPORTO': d.importo || '',
    'STATO PAGAMENTO': stato,
    'OGGETTO MAIL': msg.getSubject(),
    'LINK MAIL': thread.getPermalink(),
    'NOTE OCR': note.join(' · '),
    'ID MAIL': msg.getId(),
  };
  if (tipoPratica === 'assicurazioni') {
    Object.assign(obj, {
      'RAMO': d.tipo, 'COMPAGNIA': d.fornitore, 'N. POLIZZA': d.numero,
      'SEMESTRE': d.scadenza ? (d.scadenza.getMonth() < 6 ? '1° semestre ' : '2° semestre ') + d.scadenza.getFullYear() : '',
      'PROSSIMA RATA PREVISTA': d.scadenza ? aggiungiMesi_(d.scadenza, 6) : '',
    });
  } else {
    Object.assign(obj, { 'FORNITURA': d.tipo, 'FORNITORE': d.fornitore, 'N. DOCUMENTO': d.numero });
  }
  const row = appendObj_(sh, map, obj);
  if (tipoPratica === 'bollette' && d.testo) {
    try { salvaOfferta_(estraiOfferta_(d.testo), d.fornitore, d.tipo, emissione, thread.getPermalink()); }
    catch (e) { log_('Offerte', 'Non riesco a salvare l\'offerta: ' + e.message); }
  }

  // Promemoria solo se c'è una scadenza e la pratica non è vecchia di oltre 30 giorni
  if (d.scadenza && d.scadenza > new Date(Date.now() - 30 * 864e5)) {
    creaPromemoria_(sh, map, row, tipoPratica);
  }
}

function oggi_() {
  const d = new Date(); d.setHours(0, 0, 0, 0); return d;
}

function aggiungiMesi_(d, mesi) {
  const n = new Date(d.getTime()); n.setMonth(n.getMonth() + mesi); return n;
}

/**
 * Da menu: rielabora la riga selezionata dopo una correzione manuale
 * (es. hai corretto a mano la scadenza o l'importo): ricrea evento e attività.
 */
function ricreaPromemoriaRigaSelezionata() {
  const sh = SpreadsheetApp.getActiveSheet();
  const nome = sh.getName();
  const tipoPratica = nome === CONFIG.SHEET_ASSICURAZIONI ? 'assicurazioni' : nome === CONFIG.SHEET_BOLLETTE ? 'bollette' : null;
  if (!tipoPratica) return avviso_('Seleziona una riga nel foglio ' + CONFIG.SHEET_BOLLETTE + ' o ' + CONFIG.SHEET_ASSICURAZIONI + '.');
  const row = sh.getActiveRange().getRow();
  if (row < 2) return avviso_('Seleziona una riga di dati.');
  const map = colMap_(sh);
  eliminaPromemoria_(sh, map, row);
  const scad = sh.getRange(row, map['DATA SCADENZA'] + 1).getValue();
  if (!(scad instanceof Date)) return avviso_('La riga non ha una DATA SCADENZA valida.');
  const statoCell = sh.getRange(row, map['STATO PAGAMENTO'] + 1);
  if (statoCell.getValue() !== STATO.CONCLUSA) statoCell.setValue(scad < oggi_() ? STATO.SCADUTA : STATO.DA_PAGARE);
  creaPromemoria_(sh, map, row, tipoPratica);
  toast_('Promemoria ricreato per la riga ' + row);
}

/**
 * Stessa pratica già registrata (es. mail inoltrata "Fwd:", promemoria e sollecito della stessa rata)?
 * Chiave: fornitore/compagnia + data scadenza (+ importo per le bollette).
 * Se sì, completa i campi vuoti della riga esistente e non crea una riga nuova.
 */
function unisciDuplicato_(sh, map, d, tipoPratica, msg) {
  if (!d.scadenza) return false;
  const isAss = tipoPratica === 'assicurazioni';
  const chi = String(d.fornitore || '').toLowerCase();
  const giorno = fmtDate_(d.scadenza);
  const dup = readRows_(sh).rows.find(r =>
    r['DATA SCADENZA'] instanceof Date && fmtDate_(r['DATA SCADENZA']) === giorno &&
    String(isAss ? r['COMPAGNIA'] : r['FORNITORE']).toLowerCase() === chi &&
    (isAss || !d.importo || typeof r['IMPORTO'] !== 'number' || Math.abs(r['IMPORTO'] - d.importo) < 0.01));
  if (!dup) return false;
  const colTipo = isAss ? 'RAMO' : 'FORNITURA';
  const colNum = isAss ? 'N. POLIZZA' : 'N. DOCUMENTO';
  if (typeof dup['IMPORTO'] !== 'number' && d.importo) setCell_(sh, map, dup._row, 'IMPORTO', d.importo);
  if (!dup[colNum] && d.numero) setCell_(sh, map, dup._row, colNum, d.numero);
  if ((!dup[colTipo] || dup[colTipo] === 'Altro') && d.tipo && d.tipo !== 'Altro') setCell_(sh, map, dup._row, colTipo, d.tipo);
  if (dup['STATO PAGAMENTO'] === STATO.DA_VERIFICARE && (dup['IMPORTO'] || d.importo) && (dup[colTipo] && dup[colTipo] !== 'Altro' || d.tipo !== 'Altro')) {
    setCell_(sh, map, dup._row, 'STATO PAGAMENTO', d.scadenza < oggi_() ? STATO.SCADUTA : STATO.DA_PAGARE);
  }
  log_('Duplicato unito', msg.getSubject() + ' -> riga ' + dup._row);
  return true;
}

/**
 * Riprova le pratiche "Da verificare": rilegge la mail con le regole aggiornate e, se ora trova
 * scadenza, importo e tipo, completa la riga da sola. Ogni pratica viene riprovata una volta sola.
 */
function riprovaDaVerificare_(start) {
  start = start || Date.now();
  let sistemate = 0;
  [['bollette', CONFIG.SHEET_BOLLETTE], ['assicurazioni', CONFIG.SHEET_ASSICURAZIONI]].forEach(([tipoPratica, nome]) => {
    const sh = ss_().getSheetByName(nome);
    if (!sh || sh.getLastRow() < 2) return;
    const map = colMap_(sh);
    const colTipo = tipoPratica === 'assicurazioni' ? 'RAMO' : 'FORNITURA';
    const daRifare = readRows_(sh).rows.filter(r => r['STATO PAGAMENTO'] === STATO.DA_VERIFICARE && r['ID MAIL'] && !/riprovat/.test(String(r['NOTE OCR'] || ''))).slice(0, 3);
    for (const r of daRifare) {
      if (tempoScaduto_(start)) return;
      let nota = 'riprovata il ' + Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'dd/MM');
      try {
        const msg = GmailApp.getMessageById(String(r['ID MAIL']));
        const d = analizzaMessaggio_(msg, tipoPratica);
        if (d) {
          const vuoto = k => r[k] === '' || r[k] === null || r[k] === undefined || r[k] === 'Altro';
          if (vuoto('DATA SCADENZA') && d.scadenza) setCell_(sh, map, r._row, 'DATA SCADENZA', d.scadenza);
          if (vuoto('IMPORTO') && d.importo) setCell_(sh, map, r._row, 'IMPORTO', d.importo);
          if (vuoto(colTipo) && d.tipo !== 'Altro') setCell_(sh, map, r._row, colTipo, d.tipo);
          const scad = r['DATA SCADENZA'] instanceof Date ? r['DATA SCADENZA'] : d.scadenza;
          const completa = scad && (typeof r['IMPORTO'] === 'number' || d.importo) && (!vuoto(colTipo) || d.tipo !== 'Altro');
          if (completa) {
            setCell_(sh, map, r._row, 'STATO PAGAMENTO', scad < oggi_() ? STATO.SCADUTA : STATO.DA_PAGARE);
            nota += ': completata da sola';
            sistemate++;
            if (!r['TASK ID'] && scad > new Date(Date.now() - 30 * 864e5)) { try { creaPromemoria_(sh, map, r._row, tipoPratica); } catch (e) { } }
          } else nota += ': ancora incompleta, controllala a mano';
          if (tipoPratica === 'bollette' && d.testo) { try { salvaOfferta_(estraiOfferta_(d.testo), r['FORNITORE'], r['FORNITURA'] || d.tipo, r['DATA EMISSIONE'], r['LINK MAIL']); } catch (e) { } }
        }
      } catch (e) {
        if (eLimiteGoogle_(e)) return;
        nota += ': ' + e.message;
      }
      setCell_(sh, map, r._row, 'NOTE OCR', String(r['NOTE OCR'] || '') + ' · ' + nota);
    }
  });
  if (sistemate) { log_('Da verificare', sistemate + ' pratiche completate da sola'); try { aggiornaDashboard(); } catch (e) { } }
  return sistemate;
}

/**
 * Promemoria di pagamento.
 *
 * Perché evento Calendar + attività Google Tasks insieme:
 *  - un evento di Calendar non ha lo stato "completato", ma permette l'avviso 2 giorni prima
 *    (notifica popup + email);
 *  - un'attività di Google Tasks ha la spunta "completata" e compare anche dentro Google Calendar
 *    (e nell'app Tasks / nel pannello laterale di Gmail), ma non permette un avviso anticipato.
 * Usandoli insieme: l'evento ti avvisa, l'attività la spunti quando hai pagato.
 * La sincronizzazione (ogni 15 minuti) porta lo stato nello Sheet: attività completata -> "Conclusa".
 * Funziona anche al contrario: se scrivi "Conclusa" nello Sheet, l'attività viene spuntata.
 */

function calendario_() {
  if (CONFIG.CALENDARIO === 'principale') return CalendarApp.getDefaultCalendar();
  return calendarioDedicato_(true);
}

function calendarioDedicato_(crea) {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('CALENDAR_ID');
  let cal = id ? CalendarApp.getCalendarById(id) : null;
  if (!cal) {
    const esistenti = CalendarApp.getCalendarsByName(CONFIG.CALENDAR_NAME);
    cal = esistenti.length ? esistenti[0] : (crea ? CalendarApp.createCalendar(CONFIG.CALENDAR_NAME, { color: CalendarApp.Color.RED }) : null);
    if (cal) props.setProperty('CALENDAR_ID', cal.getId());
  }
  if (cal) { try { cal.setHidden(false); cal.setSelected(true); } catch (e) {} }
  return cal;
}

/** Cerca un evento EDITH sia nel calendario principale sia in quello dedicato. */
function trovaEvento_(eventId) {
  const cals = [CalendarApp.getDefaultCalendar(), calendarioDedicato_(false)].filter(c => c);
  for (const c of cals) {
    try { const ev = c.getEventById(eventId); if (ev) return ev; } catch (e) {}
  }
  return null;
}

/**
 * Da menu/editor: ricrea evento + attività per tutte le pratiche aperte con scadenza futura
 * (utile dopo aver cambiato calendario o cancellato promemoria). Scrive nel LOG cosa ha creato.
 */
function ricreaPromemoriaAperti() {
  const oggi = oggi_();
  const fatti = [];
  [['bollette', CONFIG.SHEET_BOLLETTE], ['assicurazioni', CONFIG.SHEET_ASSICURAZIONI]].forEach(([tipo, nome]) => {
    const sh = ss_().getSheetByName(nome);
    if (!sh || sh.getLastRow() < 2) return;
    const { map, rows } = readRows_(sh);
    rows.forEach(r => {
      if (r['STATO PAGAMENTO'] === STATO.CONCLUSA) return;
      if (!(r['DATA SCADENZA'] instanceof Date) || r['DATA SCADENZA'] < oggi) return;
      eliminaPromemoria_(sh, map, r._row);
      creaPromemoria_(sh, map, r._row, tipo);
      fatti.push(nome + ' riga ' + r._row + ': ' + fmtDate_(r['DATA SCADENZA']));
    });
  });
  const pulizia = pulisciPromemoriaOrfani_();
  const msg = (fatti.length
    ? 'Attività create (' + CONFIG.GIORNI_PREAVVISO + ' giorni prima della scadenza) in "Le mie attività":\n' + fatti.join('\n')
    : 'Nessuna pratica aperta con scadenza futura.') + '\n' + pulizia;
  log_('Promemoria', msg);
  avviso_(msg);
}

/** Le nuove attività vanno nella lista predefinita ("Le mie attività"). */
function tasklistId_() { return '@default'; }

/** Liste da controllare: predefinita + eventuale vecchia lista "EDITH Pagamenti". */
function tasklistIds_() {
  const ids = ['@default'];
  const vecchia = PropertiesService.getScriptProperties().getProperty('TASKLIST_ID');
  if (vecchia) ids.push(vecchia);
  return ids;
}

function titoloPromemoria_(r, tipoPratica) {
  const tipo = tipoPratica === 'assicurazioni' ? r['RAMO'] : r['FORNITURA'];
  const chi = tipoPratica === 'assicurazioni' ? r['COMPAGNIA'] : r['FORNITORE'];
  const icona = tipoPratica === 'assicurazioni' ? '🛡️' : '💡';
  return icona + ' Pagare ' + [tipo, chi].filter(x => x).join(' – ') + (r['IMPORTO'] ? ' ' + euro_(Number(r['IMPORTO'])) : '');
}

function leggiRiga_(sh, map, row) {
  const vals = sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0];
  const r = {};
  Object.keys(map).forEach(k => { r[k] = vals[map[k]]; });
  return r;
}

function creaPromemoria_(sh, map, row, tipoPratica) {
  const r = leggiRiga_(sh, map, row);
  const scad = r['DATA SCADENZA'];
  if (!(scad instanceof Date)) return;
  const titolo = titoloPromemoria_(r, tipoPratica);
  const descr = [
    'Scadenza: ' + fmtDate_(scad),
    r['IMPORTO'] ? 'Importo: ' + euro_(Number(r['IMPORTO'])) : '',
    'Mail: ' + r['LINK MAIL'],
    'Quando hai pagato, spunta l\'attività "' + titolo + '" in Google Tasks/Calendar: lo stato nello Sheet diventa "Conclusa".',
  ].filter(x => x).join('\n');

  // Promemoria principale: ATTIVITÀ con la casella "completata", visibile in Calendar
  // GIORNI_PREAVVISO giorni prima della scadenza (le attività hanno solo la data, non l'ora).
  const giorno = new Date(scad.getFullYear(), scad.getMonth(), scad.getDate() - CONFIG.GIORNI_PREAVVISO);
  const due = Utilities.formatDate(giorno, CONFIG.TIMEZONE, 'yyyy-MM-dd') + 'T00:00:00.000Z';
  const titoloTask = titolo + ' (scade ' + fmtDate_(scad, 'dd/MM') + ')';
  const task = Tasks.Tasks.insert({ title: titoloTask, notes: descr, due: due }, tasklistId_());
  setCell_(sh, map, row, 'TASK ID', task.id);

  // Facoltativo: evento il giorno della scadenza con avviso anticipato
  if (CONFIG.CREA_EVENTO) {
    const inizio = new Date(scad.getFullYear(), scad.getMonth(), scad.getDate(), CONFIG.ORA_EVENTO, 0);
    const ev = calendario_().createEvent(titolo, inizio, new Date(inizio.getTime() + 30 * 60000), { description: descr });
    ev.removeAllReminders();
    ev.addPopupReminder(CONFIG.GIORNI_PREAVVISO * 24 * 60);
    setCell_(sh, map, row, 'EVENT ID', ev.getId());
  }
}

function eliminaPromemoria_(sh, map, row) {
  const r = leggiRiga_(sh, map, row);
  if (r['EVENT ID']) {
    try { const ev = trovaEvento_(r['EVENT ID']); if (ev) ev.deleteEvent(); } catch (e) {}
    setCell_(sh, map, row, 'EVENT ID', '');
  }
  if (r['TASK ID']) {
    tasklistIds_().forEach(l => { try { Tasks.Tasks.remove(l, r['TASK ID']); } catch (e) {} });
    setCell_(sh, map, row, 'TASK ID', '');
  }
}

/** Trigger ogni 15 minuti: allinea stati tra Tasks e Sheet, segna le pratiche scadute. */
function sincronizzaStati() {
  const tasks = {};
  tasklistIds_().forEach(listId => {
    let pageToken;
    do {
      let res;
      try { res = Tasks.Tasks.list(listId, { showCompleted: true, showHidden: true, maxResults: 100, pageToken: pageToken }); }
      catch (e) { return; } // lista eliminata
      (res.items || []).forEach(t => { t._lista = listId; tasks[t.id] = t; });
      pageToken = res.nextPageToken;
    } while (pageToken);
  });

  let cambiate = 0;
  [['bollette', CONFIG.SHEET_BOLLETTE], ['assicurazioni', CONFIG.SHEET_ASSICURAZIONI]].forEach(([tipo, nome]) => {
    const sh = ss_().getSheetByName(nome);
    if (!sh || sh.getLastRow() < 2) return;
    const { map, rows } = readRows_(sh);
    rows.forEach(r => {
      const stato = r['STATO PAGAMENTO'];
      const t = r['TASK ID'] ? tasks[r['TASK ID']] : null;

      // Tasks -> Sheet: attività spuntata = pratica conclusa
      if (t && t.status === 'completed' && stato !== STATO.CONCLUSA) {
        setCell_(sh, map, r._row, 'STATO PAGAMENTO', STATO.CONCLUSA);
        setCell_(sh, map, r._row, 'PAGATA IL', t.completed ? new Date(t.completed) : new Date());
        segnaEventoPagato_(r['EVENT ID']);
        cambiate++;
        return;
      }
      // Sheet -> Tasks: hai scritto "Conclusa" a mano
      if (stato === STATO.CONCLUSA && t && t.status !== 'completed') {
        Tasks.Tasks.patch({ status: 'completed' }, t._lista, t.id);
        if (!r['PAGATA IL']) setCell_(sh, map, r._row, 'PAGATA IL', new Date());
        segnaEventoPagato_(r['EVENT ID']);
        cambiate++;
        return;
      }
      // Scadute
      if (stato === STATO.DA_PAGARE && r['DATA SCADENZA'] instanceof Date && r['DATA SCADENZA'] < oggi_()) {
        setCell_(sh, map, r._row, 'STATO PAGAMENTO', STATO.SCADUTA);
        cambiate++;
      }
    });
  });
  if (cambiate) aggiornaDashboard();
}

function segnaEventoPagato_(eventId) {
  if (!eventId) return;
  try {
    const ev = trovaEvento_(eventId);
    if (!ev) return;
    if (ev.getTitle().indexOf('✅') !== 0) ev.setTitle('✅ ' + ev.getTitle().replace('Pagare', 'Pagato'));
    ev.removeAllReminders();
  } catch (e) { /* evento cancellato a mano */ }
}

/**
 * Elimina i promemoria EDITH rimasti dalle versioni precedenti e non più collegati allo Sheet:
 * attività (in tutte le liste EDITH) ed eventi (calendario principale e "EDITH Scadenze")
 * il cui titolo inizia con 💡/🛡️ "Pagare"/"Pagato". Tocca SOLO elementi creati da EDITH.
 */
function pulisciPromemoriaOrfani_() {
  const taskValidi = new Set(), eventiValidi = new Set();
  [CONFIG.SHEET_BOLLETTE, CONFIG.SHEET_ASSICURAZIONI].forEach(nome => {
    const sh = ss_().getSheetByName(nome);
    if (!sh || sh.getLastRow() < 2) return;
    readRows_(sh).rows.forEach(r => {
      if (r['TASK ID']) taskValidi.add(String(r['TASK ID']));
      if (r['EVENT ID']) eventiValidi.add(String(r['EVENT ID']));
    });
  });
  const edith = t => /^(✅ )?(💡|🛡️|🛡) ?Pag(are|ato) /.test(String(t || ''));
  let nTask = 0, nEv = 0;

  tasklistIds_().forEach(listId => {
    let pageToken;
    do {
      let res;
      try { res = Tasks.Tasks.list(listId, { showCompleted: true, showHidden: true, maxResults: 100, pageToken: pageToken }); }
      catch (e) { return; }
      (res.items || []).forEach(t => {
        if (edith(t.title) && !taskValidi.has(t.id)) {
          try { Tasks.Tasks.remove(listId, t.id); nTask++; } catch (e) {}
        }
      });
      pageToken = res.nextPageToken;
    } while (pageToken);
  });

  const da = new Date(CONFIG.ANNO_INIZIO, 0, 1), a = new Date(new Date().getFullYear() + 2, 0, 1);
  [CalendarApp.getDefaultCalendar(), calendarioDedicato_(false)].filter(c => c).forEach(cal => {
    cal.getEvents(da, a).forEach(ev => {
      if (edith(ev.getTitle()) && !eventiValidi.has(ev.getId())) { ev.deleteEvent(); nEv++; }
    });
  });

  // la vecchia lista "EDITH Pagamenti", se ora è vuota, non serve più
  const props = PropertiesService.getScriptProperties();
  const vecchia = props.getProperty('TASKLIST_ID');
  if (vecchia) {
    try {
      const rimaste = (Tasks.Tasks.list(vecchia, { showCompleted: true, showHidden: true, maxResults: 1 }).items || []).length;
      if (!rimaste) { Tasks.Tasklists.remove(vecchia); props.deleteProperty('TASKLIST_ID'); }
    } catch (e) { props.deleteProperty('TASKLIST_ID'); }
  }
  return 'Pulizia: eliminati ' + nTask + ' vecchie attività e ' + nEv + ' vecchi eventi EDITH.';
}

/**
 * Andamento costi.
 *  - Lo storico resta sempre nei fogli BOLLETTAZIONE e ASSICURAZIONE (tutti gli anni dal 2026).
 *  - RIEPILOGO contiene anche la tabella storica per anno.
 *  - DASHBOARD mostra solo l'ANNO CORRENTE (dal 1° gennaio cambia anno da sola).
 * Si aggiorna dopo ogni nuova pratica e ogni notte.
 */

function aggiornaDashboard() {
  const ss = ss_();
  const ora = new Date();
  const anno = ora.getFullYear();
  const bol = ss.getSheetByName(CONFIG.SHEET_BOLLETTE);
  const ass = ss.getSheetByName(CONFIG.SHEET_ASSICURAZIONI);
  const dataRif = r => (r['DATA EMISSIONE'] instanceof Date ? r['DATA EMISSIONE'] : r['DATA COMUNICAZIONE']);
  const dataAss = r => (r['DATA SCADENZA'] instanceof Date ? r['DATA SCADENZA'] : dataRif(r));
  const conImporto = r => typeof r['IMPORTO'] === 'number';

  const B = bol ? readRows_(bol).rows.filter(r => conImporto(r) && dataRif(r) instanceof Date && dataRif(r).getFullYear() >= CONFIG.ANNO_INIZIO) : [];
  const A = ass ? readRows_(ass).rows.filter(r => conImporto(r) && dataAss(r) instanceof Date && dataAss(r).getFullYear() >= CONFIG.ANNO_INIZIO) : [];
  const Banno = B.filter(r => dataRif(r).getFullYear() === anno);
  const Aanno = A.filter(r => dataAss(r).getFullYear() === anno);

  const tipiB = uniq_(B.map(r => r['FORNITURA'] || 'Altro'));
  const ramiA = uniq_(A.map(r => r['RAMO'] || 'Altro'));
  const somma = rows => round2_(rows.reduce((a, r) => a + r['IMPORTO'], 0));

  const rie = sheet_(CONFIG.SHEET_RIEPILOGO);
  rie.clear();

  // --- T1: bollette anno corrente, per mese e tipo
  const nomiMesi = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
  const t1 = [['Mese ' + anno].concat(tipiB, ['Totale'])];
  nomiMesi.forEach((nm, m) => {
    const delMese = Banno.filter(r => dataRif(r).getMonth() === m);
    const riga = [nm];
    tipiB.forEach(tp => riga.push(somma(delMese.filter(r => (r['FORNITURA'] || 'Altro') === tp))));
    riga.push(somma(delMese));
    t1.push(riga);
  });
  scriviTabella_(rie, 1, 1, t1);

  // --- T2: ripartizione anno corrente per tipo
  const c2 = t1[0].length + 2;
  const t2 = [['Tipo', 'Anno ' + anno]].concat(tipiB.map(tp => [tp, somma(Banno.filter(r => (r['FORNITURA'] || 'Altro') === tp))]));
  scriviTabella_(rie, 1, c2, t2);

  // --- T3: assicurazioni anno corrente per ramo
  const c3 = c2 + 3;
  const t3 = [['Ramo', 'Anno ' + anno]].concat(ramiA.map(rm => [rm, somma(Aanno.filter(r => (r['RAMO'] || 'Altro') === rm))]));
  scriviTabella_(rie, 1, c3, t3);

  // --- T4: STORICO per anno (bollette per tipo + assicurazioni)
  const c4 = c3 + 3;
  const anni = uniq_(B.map(r => dataRif(r).getFullYear()).concat(A.map(r => dataAss(r).getFullYear())).concat([anno])).sort();
  const t4 = [['Storico'].concat(tipiB, ['Totale bollette', 'Assicurazioni'])];
  anni.forEach(y => {
    const By = B.filter(r => dataRif(r).getFullYear() === y);
    const riga = [String(y)];
    tipiB.forEach(tp => riga.push(somma(By.filter(r => (r['FORNITURA'] || 'Altro') === tp))));
    riga.push(somma(By), somma(A.filter(r => dataAss(r).getFullYear() === y)));
    t4.push(riga);
  });
  scriviTabella_(rie, 1, c4, t4);

  // --- DASHBOARD (solo anno corrente)
  const dash = sheet_(CONFIG.SHEET_DASHBOARD);
  dash.getCharts().forEach(c => dash.removeChart(c));
  dash.clear();

  const totB = somma(Banno);
  const mesiTrascorsi = ora.getMonth() + 1;
  const aperte = B.concat(A).filter(r => r['STATO PAGAMENTO'] === STATO.DA_PAGARE || r['STATO PAGAMENTO'] === STATO.SCADUTA);
  const kpi = [
    ['EDITH – ' + anno, '', 'Aggiornato: ' + fmtDate_(ora, 'dd/MM/yyyy HH:mm')],
    ['Bollette ' + anno, totB, ''],
    ['Media mensile bollette', round2_(totB / mesiTrascorsi), ''],
    ['Assicurazioni ' + anno, somma(Aanno), ''],
    ['Pratiche da pagare / scadute', aperte.length, euro_(somma(aperte))],
  ];
  dash.getRange(1, 1, kpi.length, 3).setValues(kpi);
  dash.getRange('A1').setFontSize(16).setFontWeight('bold');
  dash.getRange('B2:B4').setNumberFormat('€ #,##0.00');
  dash.getRange('A2:A5').setFontWeight('bold');

  const prossime = B.concat(A)
    .filter(r => r['STATO PAGAMENTO'] !== STATO.CONCLUSA && r['DATA SCADENZA'] instanceof Date)
    .sort((a, b) => a['DATA SCADENZA'] - b['DATA SCADENZA']).slice(0, 8)
    .map(r => [fmtDate_(r['DATA SCADENZA']), (r['FORNITURA'] || r['RAMO'] || '') + ' – ' + (r['FORNITORE'] || r['COMPAGNIA'] || ''),
      euro_(r['IMPORTO']), r['STATO PAGAMENTO']]);
  dash.getRange(1, 5).setValue('Prossime scadenze').setFontWeight('bold');
  if (prossime.length) dash.getRange(2, 5, prossime.length, 4).setValues(prossime);

  const top = 11;
  const w1 = t1[0].length;
  if (tipiB.length) {
    dash.insertChart(dash.newChart().asColumnChart().setStacked()
      .addRange(rie.getRange(1, 1, 13, w1 - 1)).setNumHeaders(1)
      .setOption('title', 'Bollette ' + anno + ' per mese e tipo')
      .setOption('vAxis', { format: '€ #,##0' })
      .setPosition(top, 1, 0, 0).setOption('width', 760).setOption('height', 340).build());
    dash.insertChart(dash.newChart().asLineChart()
      .addRange(rie.getRange(1, 1, 13, 1)).addRange(rie.getRange(1, w1, 13, 1)).setNumHeaders(1)
      .setOption('title', 'Andamento mensile ' + anno)
      .setOption('vAxis', { format: '€ #,##0' })
      .setPosition(top, 9, 0, 0).setOption('width', 560).setOption('height', 340).build());
    dash.insertChart(dash.newChart().asPieChart()
      .addRange(rie.getRange(1, c2, t2.length, 2)).setNumHeaders(1)
      .setOption('title', 'Ripartizione bollette ' + anno).setOption('pieHole', 0.4)
      .setPosition(top + 19, 1, 0, 0).setOption('width', 460).setOption('height', 320).build());
  }
  if (ramiA.length) {
    dash.insertChart(dash.newChart().asColumnChart()
      .addRange(rie.getRange(1, c3, t3.length, 2)).setNumHeaders(1)
      .setOption('title', 'Assicurazioni ' + anno + ' per ramo (rate semestrali)')
      .setOption('legend', { position: 'none' })
      .setPosition(top + 19, 6, 0, 0).setOption('width', 460).setOption('height', 320).build());
  }
  dash.autoResizeColumns(1, 8);
}

function scriviTabella_(sh, r, c, dati) {
  sh.getRange(r, c, dati.length, 1).setNumberFormat('@');
  sh.getRange(r, c, dati.length, dati[0].length).setValues(dati);
  sh.getRange(r, c, 1, dati[0].length).setFontWeight('bold');
}

function uniq_(arr) { return [...new Set(arr)].sort(); }
function round2_(n) { return Math.round(n * 100) / 100; }

/**
 * Iscrizioni / newsletter.
 * 1) "Analizza iscrizioni": legge le mail recenti con intestazione List-Unsubscribe
 *    (lo standard usato da newsletter e mailing list) e le raggruppa per mittente nel foglio ISCRIZIONI.
 * 2) Tu scegli un'azione per ogni mittente (menu a tendina nella colonna AZIONE).
 * 3) "Esegui azioni iscrizioni": dopo una conferma esegue solo le righe che hai scelto.
 * Nessuna cancellazione avviene senza la tua scelta esplicita. Le mail cestinate restano
 * recuperabili nel Cestino di Gmail per 30 giorni.
 */

const AZIONI_ISCRIZIONE = [
  'Tieni',
  'Disiscrivi',
  'Disiscrivi + cestina esistenti',
  'Disiscrivi + cestina esistenti + blocca futuri',
  'Archivia futuri in EDITH/newsletter',
  'Cestina esistenti',
];

const COL_ISCRIZIONI = ['AZIONE', 'MITTENTE', 'EMAIL', 'N. MAIL', 'MB STIMATI', 'ULTIMA MAIL', 'METODO', 'LINK DISISCRIZIONE', 'ESITO'];

function analizzaIscrizioni() {
  const start = Date.now();
  const sh = sheet_(CONFIG.SHEET_ISCRIZIONI);
  const map = ensureHeaders_(sh, COL_ISCRIZIONI);
  const precedenti = {};
  readRows_(sh).rows.forEach(r => { precedenti[String(r['EMAIL']).toLowerCase()] = r; });

  const q = 'newer_than:' + CONFIG.ISCRIZIONI_GIORNI + 'd -in:sent -in:chats ' +
    '(unsubscribe OR disiscriviti OR "annulla iscrizione" OR "cancella iscrizione" OR "non ricevere più" OR category:promotions OR category:forums OR category:updates)';
  const ids = listaIdMessaggi_(q, CONFIG.ISCRIZIONI_MAX_MAIL);

  const gruppi = {};
  for (const id of ids) {
    if (tempoScaduto_(start)) { log_('Iscrizioni', 'Analisi parziale per limite di tempo: rilancia per completare.'); break; }
    let m;
    try {
      m = Gmail.Users.Messages.get('me', id, { format: 'metadata', metadataHeaders: ['From', 'List-Unsubscribe', 'List-Unsubscribe-Post', 'Date'] });
    } catch (e) { continue; }
    const h = {};
    (m.payload.headers || []).forEach(x => { h[x.name.toLowerCase()] = x.value; });
    if (!h['list-unsubscribe']) continue;
    const from = h['from'] || '';
    const email = ((from.match(/<([^>]+)>/) || [])[1] || from).trim().toLowerCase();
    const nome = (from.replace(/<[^>]+>/, '').replace(/"/g, '').trim()) || email;
    const g = gruppi[email] || (gruppi[email] = { nome, email, n: 0, bytes: 0, ultima: 0, unsub: '', post: false });
    g.n++;
    g.bytes += Number(m.sizeEstimate || 0);
    const ts = Number(m.internalDate || 0);
    if (ts > g.ultima) {
      g.ultima = ts;
      g.unsub = h['list-unsubscribe'];
      g.post = /one-click/i.test(h['list-unsubscribe-post'] || '');
    }
  }

  const righe = Object.values(gruppi).sort((a, b) => b.n - a.n).map(g => {
    const link = scegliLinkDisiscrizione_(g.unsub, g.post);
    const prev = precedenti[g.email];
    return [
      prev ? prev['AZIONE'] || 'Tieni' : 'Tieni',
      g.nome, g.email, g.n, round2_(g.bytes / 1048576), new Date(g.ultima),
      link.metodo, link.url, prev ? prev['ESITO'] || '' : '',
    ];
  });

  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
  if (righe.length) {
    // le colonne sono nell'ordine di COL_ISCRIZIONI
    sh.getRange(2, 1, righe.length, righe[0].length).setValues(righe);
    const regola = SpreadsheetApp.newDataValidation().requireValueInList(AZIONI_ISCRIZIONE, true).build();
    sh.getRange(2, map['AZIONE'] + 1, righe.length, 1).setDataValidation(regola);
    sh.getRange(2, map['ULTIMA MAIL'] + 1, righe.length, 1).setNumberFormat('dd/MM/yyyy');
  }
  sh.autoResizeColumns(1, 7);
  log_('Iscrizioni', righe.length + ' mittenti con disiscrizione trovati su ' + ids.length + ' mail analizzate');
  toast_(righe.length + ' iscrizioni trovate. Scegli le azioni nel foglio ' + CONFIG.SHEET_ISCRIZIONI + '.');
}

function listaIdMessaggi_(q, max) {
  const ids = [];
  let pageToken;
  do {
    const res = Gmail.Users.Messages.list('me', { q: q, maxResults: Math.min(500, max - ids.length), pageToken: pageToken });
    (res.messages || []).forEach(m => ids.push(m.id));
    pageToken = res.nextPageToken;
  } while (pageToken && ids.length < max);
  return ids;
}

function scegliLinkDisiscrizione_(header, oneClick) {
  const links = (String(header).match(/<([^>]+)>/g) || []).map(s => s.slice(1, -1).trim());
  const http = links.find(l => /^https?:/i.test(l));
  const mailto = links.find(l => /^mailto:/i.test(l));
  if (http && oneClick) return { metodo: 'Automatico (one-click)', url: http };
  if (mailto) return { metodo: 'Automatico (email)', url: mailto };
  if (http) return { metodo: 'Manuale (apri il link)', url: http };
  return { metodo: 'Non disponibile', url: '' };
}

function eseguiAzioniIscrizioni(confermato) {
  const sh = sheet_(CONFIG.SHEET_ISCRIZIONI);
  const { map, rows } = readRows_(sh);
  const daFare = rows.filter(r => r['AZIONE'] && r['AZIONE'] !== 'Tieni' && !/^OK/.test(String(r['ESITO'])));
  if (!daFare.length) return avviso_('Nessuna azione da eseguire: scegli un\'azione diversa da "Tieni" nella colonna AZIONE.');

  const daCestinare = daFare.filter(r => /cestina/i.test(r['AZIONE'])).reduce((a, r) => a + Number(r['N. MAIL'] || 0), 0);
  const msg = 'Sto per eseguire ' + daFare.length + ' azioni:\n' +
    daFare.slice(0, 15).map(r => '• ' + r['EMAIL'] + ' → ' + r['AZIONE']).join('\n') +
    (daFare.length > 15 ? '\n… e altre ' + (daFare.length - 15) : '') +
    '\n\nMail che finiranno nel Cestino (stima recente): circa ' + daCestinare +
    '. Restano recuperabili per 30 giorni.\n\nProcedo?';
  if (confermato !== true && !conferma_('EDITH – Iscrizioni', msg)) return;

  const start = Date.now();
  for (const r of daFare) {
    if (tempoScaduto_(start)) { avviso_('Tempo esaurito: rilancia "Esegui azioni iscrizioni" per completare.'); break; }
    const esiti = [];
    try {
      const a = r['AZIONE'];
      if (/^Disiscrivi/.test(a)) esiti.push(disiscrivi_(r));
      if (/cestina esistenti/i.test(a)) esiti.push('cestinate ' + cestinaDaMittente_(r['EMAIL'], start));
      if (/blocca futuri/i.test(a)) esiti.push(creaFiltro_(r['EMAIL'], true));
      if (/^Archivia futuri/.test(a)) esiti.push(creaFiltro_(r['EMAIL'], false));
      setCell_(sh, map, r._row, 'ESITO', 'OK ' + fmtDate_(new Date()) + ': ' + esiti.join('; '));
    } catch (e) {
      setCell_(sh, map, r._row, 'ESITO', 'ERRORE: ' + e.message);
    }
  }
  log_('Iscrizioni', 'Eseguite ' + daFare.length + ' azioni');
}

function disiscrivi_(r) {
  const url = String(r['LINK DISISCRIZIONE'] || '');
  const metodo = String(r['METODO'] || '');
  if (/one-click/.test(metodo)) {
    const res = UrlFetchApp.fetch(url, {
      method: 'post', payload: 'List-Unsubscribe=One-Click',
      contentType: 'application/x-www-form-urlencoded', muteHttpExceptions: true, followRedirects: true,
    });
    return 'disiscrizione inviata (HTTP ' + res.getResponseCode() + ')';
  }
  if (/email/.test(metodo)) {
    const m = url.replace(/^mailto:/i, '');
    const [indirizzo, qs] = m.split('?');
    const params = {};
    (qs || '').split('&').forEach(p => { const [k, v] = p.split('='); if (k) params[k.toLowerCase()] = decodeURIComponent(v || ''); });
    GmailApp.sendEmail(decodeURIComponent(indirizzo), params.subject || 'unsubscribe', params.body || 'unsubscribe');
    return 'email di disiscrizione inviata';
  }
  if (url) return 'DA FARE A MANO: apri il link nella colonna LINK DISISCRIZIONE';
  return 'nessun link di disiscrizione: usa il filtro';
}

function cestinaDaMittente_(email, start) {
  let tot = 0;
  const q = 'from:' + email + ' ' + protezioneQuery_();
  while (!tempoScaduto_(start)) {
    const threads = GmailApp.search(q, 0, 100);
    if (!threads.length) break;
    GmailApp.moveThreadsToTrash(threads);
    tot += threads.length;
  }
  return tot + ' conversazioni';
}

function creaFiltro_(email, cestina) {
  const action = cestina
    ? { addLabelIds: ['TRASH'], removeLabelIds: ['INBOX'] }
    : { addLabelIds: [labelId_(CONFIG.LABEL_NEWSLETTER)], removeLabelIds: ['INBOX', 'UNREAD'] };
  Gmail.Users.Settings.Filters.create({ criteria: { from: email }, action: action }, 'me');
  return cestina ? 'filtro: le future vanno nel Cestino' : 'filtro: le future vanno in ' + CONFIG.LABEL_NEWSLETTER;
}

function labelId_(nome) {
  getOrCreateLabel_(nome);
  const l = (Gmail.Users.Labels.list('me').labels || []).find(x => x.name === nome);
  return l.id;
}

/**
 * Ottimizzazione dello spazio.
 *  - "Report mail pesanti": elenca le mail più grandi (foglio MAIL PESANTI) con spunta per cestinarle.
 *  - Foglio PULIZIA: regole pronte (promozioni vecchie, social, notifiche...). "Anteprima pulizia" conta
 *    quante mail riguarda ogni regola e quanto spazio stimato libera; "Esegui pulizia" agisce SOLO
 *    sulle regole con la spunta ESEGUI, dopo conferma.
 * Le mail con stella, importanti, bollette e assicurazioni sono sempre escluse.
 * Nota: lo spazio Google (15 GB) è condiviso tra Gmail, Drive e Foto. Archiviare NON libera spazio,
 * cestinare sì, ma solo dopo lo svuotamento del Cestino (automatico dopo 30 giorni, o manuale).
 */

const REGOLE_DEFAULT = [
  ['Promozioni più vecchie di 6 mesi', 'category:promotions older_than:6m', 'Cestina'],
  ['Social più vecchi di 6 mesi', 'category:social older_than:6m', 'Cestina'],
  ['Notifiche/aggiornamenti più vecchi di 1 anno', 'category:updates older_than:1y', 'Cestina'],
  ['Forum/gruppi più vecchi di 6 mesi', 'category:forums older_than:6m', 'Cestina'],
  ['Newsletter filtrate più vecchie di 3 mesi', labelQuery_(CONFIG.LABEL_NEWSLETTER) + ' older_than:3m', 'Cestina'],
  ['Allegati oltre 10 MB più vecchi di 2 anni', 'larger:10M older_than:2y', 'Cestina'],
  ['Mail lette in Posta in arrivo più vecchie di 1 anno', 'in:inbox is:read older_than:1y', 'Archivia'],
  ['Codici OTP / verifiche più vecchi di 1 mese', '(subject:codice OR subject:"verification code" OR subject:OTP) older_than:1m', 'Cestina'],
];

const COL_PULIZIA = ['ESEGUI', 'REGOLA', 'QUERY GMAIL', 'AZIONE', 'MAIL TROVATE', 'MB STIMATI', 'ULTIMA ANTEPRIMA', 'ESITO'];
const COL_PESANTI = ['CESTINA', 'DATA', 'MITTENTE', 'OGGETTO', 'MB', 'LINK', 'ID'];

function preparaFoglioPulizia_() {
  const sh = sheet_(CONFIG.SHEET_PULIZIA);
  const map = ensureHeaders_(sh, COL_PULIZIA);
  if (sh.getLastRow() < 2) {
    sh.getRange(2, 1, REGOLE_DEFAULT.length, 4).setValues(REGOLE_DEFAULT.map(r => [false].concat(r)));
    sh.getRange(2, 1, 50, 1).insertCheckboxes();
    sh.getRange(2, map['AZIONE'] + 1, 50, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(['Cestina', 'Archivia'], true).build());
    sh.setColumnWidth(2, 300); sh.setColumnWidth(3, 380);
  }
  return sh;
}

/** Conta le mail e stima lo spazio per ogni regola (nessuna modifica alla posta). */
function anteprimaPulizia() {
  const start = Date.now();
  const sh = preparaFoglioPulizia_();
  const { map, rows } = readRows_(sh);
  rows.forEach(r => {
    if (!r['QUERY GMAIL'] || tempoScaduto_(start)) return;
    const q = r['QUERY GMAIL'] + ' ' + protezioneQuery_();
    const ids = listaIdMessaggi_(q, 5000);
    // stima dimensione: media su un campione di 40 mail
    const campione = ids.slice(0, 40);
    let bytes = 0;
    campione.forEach(id => {
      try { bytes += Number(Gmail.Users.Messages.get('me', id, { format: 'minimal' }).sizeEstimate || 0); } catch (e) {}
    });
    const media = campione.length ? bytes / campione.length : 0;
    setCell_(sh, map, r._row, 'MAIL TROVATE', ids.length >= 5000 ? '5000+' : ids.length);
    setCell_(sh, map, r._row, 'MB STIMATI', round2_(media * ids.length / 1048576));
    setCell_(sh, map, r._row, 'ULTIMA ANTEPRIMA', new Date());
  });
  aggiornaQuotaSpazio_();
  toast_('Anteprima completata: controlla il foglio ' + CONFIG.SHEET_PULIZIA + ' e spunta ESEGUI sulle regole che vuoi applicare.');
}

/** Esegue solo le regole spuntate, dopo conferma. */
function eseguiPulizia(confermato) {
  const sh = preparaFoglioPulizia_();
  const { map, rows } = readRows_(sh);
  const scelte = rows.filter(r => r['ESEGUI'] === true && r['QUERY GMAIL']);
  if (!scelte.length) return avviso_('Nessuna regola spuntata nella colonna ESEGUI.');
  const msg = 'Applico queste regole (stelle, importanti, bollette e assicurazioni sono escluse):\n\n' +
    scelte.map(r => '• ' + r['REGOLA'] + ' → ' + r['AZIONE'] + ' (' + (r['MAIL TROVATE'] || '?') + ' mail, ~' + (r['MB STIMATI'] || '?') + ' MB)').join('\n') +
    '\n\nLe mail cestinate restano recuperabili per 30 giorni. Procedo?';
  if (confermato !== true && !conferma_('EDITH – Pulizia posta', msg)) return;

  const start = Date.now();
  for (const r of scelte) {
    const q = r['QUERY GMAIL'] + ' ' + protezioneQuery_() + (r['AZIONE'] === 'Archivia' ? ' in:inbox' : ' -in:trash');
    let tot = 0;
    let completata = true;
    while (true) {
      if (tempoScaduto_(start)) { completata = false; break; }
      const threads = GmailApp.search(q, 0, 100);
      if (!threads.length) break;
      if (r['AZIONE'] === 'Archivia') GmailApp.moveThreadsToArchive(threads);
      else GmailApp.moveThreadsToTrash(threads);
      tot += threads.length;
    }
    setCell_(sh, map, r._row, 'ESITO', fmtDate_(new Date()) + ': ' + r['AZIONE'] + ' ' + tot + ' conversazioni' + (completata ? '' : ' (parziale, rilancia)'));
    if (completata) setCell_(sh, map, r._row, 'ESEGUI', false);
    log_('Pulizia', r['REGOLA'] + ': ' + tot + ' conversazioni');
    if (!completata) { avviso_('Tempo esaurito: rilancia "Esegui pulizia" per completare.'); break; }
  }
}

/** Elenca le mail più pesanti (sola lettura). */
function reportMailPesanti() {
  const start = Date.now();
  const sh = sheet_(CONFIG.SHEET_PESANTI);
  const map = ensureHeaders_(sh, COL_PESANTI);
  const ids = listaIdMessaggi_(CONFIG.PESANTI_QUERY + ' -in:trash', 2000);
  const righe = [];
  for (const id of ids) {
    if (tempoScaduto_(start)) break;
    try {
      const m = Gmail.Users.Messages.get('me', id, { format: 'metadata', metadataHeaders: ['From', 'Subject'] });
      const h = {};
      (m.payload.headers || []).forEach(x => { h[x.name.toLowerCase()] = x.value; });
      righe.push([false, new Date(Number(m.internalDate)), h['from'] || '', h['subject'] || '',
        round2_(Number(m.sizeEstimate) / 1048576), 'https://mail.google.com/mail/u/0/#all/' + m.threadId, id]);
    } catch (e) {}
  }
  righe.sort((a, b) => b[4] - a[4]);
  const top = righe.slice(0, CONFIG.PESANTI_MAX);
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clear();
  if (top.length) {
    sh.getRange(2, 1, top.length, top[0].length).setValues(top);
    sh.getRange(2, 1, top.length, 1).insertCheckboxes();
    sh.getRange(2, 2, top.length, 1).setNumberFormat('dd/MM/yyyy');
  }
  const totMb = round2_(top.reduce((a, r) => a + r[4], 0));
  log_('Mail pesanti', top.length + ' mail elencate, ' + totMb + ' MB in totale');
  aggiornaQuotaSpazio_();
  toast_('Le ' + top.length + ' mail più pesanti occupano ' + totMb + ' MB. Spunta CESTINA su quelle da eliminare.');
}

/** Cestina le mail spuntate nel foglio MAIL PESANTI, dopo conferma. */
function cestinaMailPesantiSelezionate(confermato) {
  const sh = sheet_(CONFIG.SHEET_PESANTI);
  const { map, rows } = readRows_(sh);
  const scelte = rows.filter(r => r['CESTINA'] === true && r['ID']);
  if (!scelte.length) return avviso_('Nessuna mail spuntata nella colonna CESTINA.');
  const mb = round2_(scelte.reduce((a, r) => a + Number(r['MB'] || 0), 0));
  if (confermato !== true && !conferma_('EDITH – Mail pesanti', 'Sposto nel Cestino ' + scelte.length + ' mail (' + mb + ' MB). Restano recuperabili per 30 giorni. Procedo?')) return;
  scelte.forEach(r => {
    try {
      Gmail.Users.Messages.trash('me', r['ID']);
      setCell_(sh, map, r._row, 'CESTINA', false);
      setCell_(sh, map, r._row, 'OGGETTO', '[CESTINATA] ' + r['OGGETTO']);
    } catch (e) { log_('Mail pesanti', 'Errore su ' + r['ID'] + ': ' + e.message); }
  });
  log_('Mail pesanti', 'Cestinate ' + scelte.length + ' mail, ' + mb + ' MB');
}

/** Scrive lo spazio usato su Drive/Gmail/Foto nel foglio PULIZIA (cella J1:K3). */
function aggiornaQuotaSpazio_() {
  try {
    const about = Drive.About.get({ fields: 'storageQuota' }).storageQuota;
    const gb = b => round2_(Number(b || 0) / 1073741824);
    const sh = sheet_(CONFIG.SHEET_PULIZIA);
    sh.getRange('J1:K4').setValues([
      ['Spazio usato (GB)', gb(about.usage)],
      ['di cui Gmail + Foto + altro', gb(Number(about.usage) - Number(about.usageInDrive || 0))],
      ['di cui Drive', gb(about.usageInDrive)],
      ['Limite (GB)', gb(about.limit)],
    ]);
    sh.getRange('J1:J4').setFontWeight('bold');
  } catch (e) { /* non bloccante */ }
}

/**
 * Installazione, menu e trigger automatici.
 * Prima volta: esegui "setup" dall'editor (o dal menu EDITH > Installa), autorizza, fatto.
 */

function onOpen() {
  creaMenu_();
}

function creaMenu_() {
  SpreadsheetApp.getUi().createMenu('EDITH')
    .addItem('📥 Elabora bollette e assicurazioni ora', 'elaboraTutto')
    .addItem('🔄 Sincronizza stati pagamento', 'sincronizzaStati')
    .addItem('🔁 Ricrea promemoria riga selezionata', 'ricreaPromemoriaRigaSelezionata')
    .addItem('📅 Ricrea tutti i promemoria aperti', 'ricreaPromemoriaAperti')
    .addItem('📊 Aggiorna grafici', 'aggiornaDashboard')
    .addSeparator()
    .addItem('📰 Analizza iscrizioni', 'analizzaIscrizioni')
    .addItem('✉️ Esegui azioni iscrizioni…', 'eseguiAzioniIscrizioni')
    .addSeparator()
    .addItem('🔍 Anteprima pulizia', 'anteprimaPulizia')
    .addItem('🧹 Esegui pulizia…', 'eseguiPulizia')
    .addItem('🐘 Report mail pesanti', 'reportMailPesanti')
    .addItem('🗑️ Cestina mail pesanti selezionate…', 'cestinaMailPesantiSelezionate')
    .addSeparator()
    .addItem('⚙️ Installa / reinstalla', 'setup')
    .addToUi();
}

function setup() {
  const ss = ss_();

  // Fogli e intestazioni (le tue colonne esistenti vengono mantenute)
  const bol = sheet_(CONFIG.SHEET_BOLLETTE);
  formattaPratiche_(bol, ensureHeaders_(bol, COLONNE.bollette));
  const ass = sheet_(CONFIG.SHEET_ASSICURAZIONI);
  formattaPratiche_(ass, ensureHeaders_(ass, COLONNE.assicurazioni));
  ensureHeaders_(sheet_(CONFIG.SHEET_ISCRIZIONI), COL_ISCRIZIONI);
  ensureHeaders_(sheet_(CONFIG.SHEET_PESANTI), COL_PESANTI);
  preparaFoglioPulizia_();
  sheet_(CONFIG.SHEET_RIEPILOGO);
  sheet_(CONFIG.SHEET_DASHBOARD);

  // Etichette, calendario, lista attività
  getOrCreateLabel_(CONFIG.LABEL_ELABORATA);
  getOrCreateLabel_(CONFIG.LABEL_NEWSLETTER);
  calendario_();
  tasklistId_();

  // Trigger (rimuove i vecchi per non duplicarli)
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('elaboraTutto').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('sincronizzaStati').timeBased().everyMinutes(15).create();
  ScriptApp.newTrigger('aggiornaDashboard').timeBased().everyDays(1).atHour(6).create();
  ScriptApp.newTrigger('analizzaIscrizioni').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(7).create();
  ScriptApp.newTrigger('reportMailPesanti').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(8).create();
  ScriptApp.newTrigger('riepilogoSettimanale').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(8).create();
  // Menu anche se lo script non è legato allo Sheet (se è legato basta onOpen)
  let legato = false;
  try { legato = !!SpreadsheetApp.getActiveSpreadsheet(); } catch (e) {}
  if (!legato) ScriptApp.newTrigger('onOpen').forSpreadsheet(ss).onOpen().create();

  const msgLabel = [CONFIG.LABEL_BOLLETTE, CONFIG.LABEL_ASSICURAZIONI]
    .filter(l => !trovaEtichetta_(l));
  log_('Setup', 'Installazione completata' + (msgLabel.length ? '. ATTENZIONE etichette non trovate: ' + msgLabel.join(', ') : ''));
  aggiornaDashboard();
  avviso_('EDITH è installato.\n\nLe bollette vengono elaborate ogni ora, gli stati ogni 15 minuti.' +
    (msgLabel.length ? '\n\n⚠️ Non trovo queste etichette Gmail: ' + msgLabel.join(', ') + '. Correggi i nomi in 00_Config.gs.' : '') +
    '\n\nPer partire subito: menu EDITH > Elabora bollette e assicurazioni ora.');
}

function formattaPratiche_(sh, map) {
  const n = sh.getMaxRows() - 1;
  ['DATA EMISSIONE', 'DATA COMUNICAZIONE', 'DATA SCADENZA', 'PAGATA IL', 'PROSSIMA RATA PREVISTA'].forEach(c => {
    if (map[c] !== undefined) sh.getRange(2, map[c] + 1, n, 1).setNumberFormat('dd/MM/yyyy');
  });
  if (map['IMPORTO'] !== undefined) sh.getRange(2, map['IMPORTO'] + 1, n, 1).setNumberFormat('€ #,##0.00');

  const colStato = map['STATO PAGAMENTO'] + 1;
  const rStato = sh.getRange(2, colStato, n, 1);
  rStato.setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList([STATO.DA_PAGARE, STATO.SCADUTA, STATO.CONCLUSA, STATO.DA_VERIFICARE], true).build());
  const colori = [[STATO.CONCLUSA, '#d9ead3'], [STATO.SCADUTA, '#f4cccc'], [STATO.DA_PAGARE, '#fff2cc'], [STATO.DA_VERIFICARE, '#cfe2f3']];
  const regole = sh.getConditionalFormatRules().filter(r => {
    const rg = r.getRanges()[0]; return !(rg && rg.getColumn() === colStato);
  });
  colori.forEach(([v, c]) => regole.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo(v).setBackground(c).setRanges([rStato]).build()));
  sh.setConditionalFormatRules(regole);

  // Colonne tecniche nascoste (servono allo script)
  ['ID MAIL', 'EVENT ID', 'TASK ID'].forEach(c => { if (map[c] !== undefined) sh.hideColumns(map[c] + 1); });
}

/**
 * EDITH – App web (da aprire dal telefono) + assistente "Edith, sono io".
 *
 * Due modi di usarla:
 *  1. App completa: Esegui il deployment > App web, Esegui come: Me, Chi ha accesso: Solo io.
 *  2. App su GitHub Pages (stessa interfaccia, con il microfono vero): usa doPost qui sotto.
 *     Serve un secondo deployment con accesso "Chiunque", protetto da un token segreto
 *     (lancia creaTokenVoce una volta). Le operazioni che cancellano mail chiedono sempre
 *     conferma nell'app e mandano tutto nel Cestino (recuperabile per 30 giorni).
 *
 * L'assistente è locale: risponde con regole sui dati del tuo Sheet.
 * Nessun servizio esterno, nessun costo, i dati restano nel tuo account Google.
 */

function doGet() {
  // L'app vive su GitHub Pages e parla con lo script solo via doPost, con il token.
  // Da qui non si serve più nessuna pagina: con google.script.run chiunque avesse il token
  // potrebbe chiamare tutte le funzioni dello script (anche creaTokenVoce), non solo quelle dell'elenco di doPost.
  return HtmlService.createHtmlOutput('<p style="font-family:sans-serif;padding:24px">EDITH è privata.</p>').setTitle('EDITH');
}

/** Prova gli avvisi: manda subito una mail di test e scrive l'esito nel registro. */
function provaMail() {
  PropertiesService.getScriptProperties().deleteProperty('AVVISO_prova');
  const ok = notifica_('Prova', ['Se leggi questa mail, gli avvisi di EDITH funzionano.'], 'prova');
  Logger.log(ok ? 'Mail inviata a ' + mioIndirizzo_() + '. Controlla la posta in arrivo.' : 'Mail NON inviata: guarda il foglio LOG per il motivo.');
}

// ---------------------------------------------------------------- EDITH Voce (API JSON)

function uguali_(a, b) {
  a = String(a || ''); b = String(b || '');
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Riceve dalla pagina vocale { k: token, f: funzione, a: [argomenti] }. */
function doPost(e) {
  let req = {};
  try { req = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { return json_({ ok: false, errore: 'Richiesta non valida' }); }
  const v = verificaToken_(req.k);
  if (!v.ok) {
    tentativoFallito_(v.motivo);
    Utilities.sleep(1500);
    return json_({ ok: false, errore: v.motivo === 'token scaduto' ? 'Token scaduto: rilancia creaTokenVoce in Apps Script e reinseriscilo' : 'Token non valido' });
  }
  // Le funzioni dell'app. Quelle che cancellano mail chiedono conferma nell'app e mandano tutto nel Cestino.
  const consentite = {
    dati: apiDati, chiedi: apiChiedi, pagata: apiSegnaPagata, elabora: apiElabora,
    apiDati, apiChiedi, apiSegnaPagata, apiElabora,
    apiIscrizioni, apiAnalizzaIscrizioni, apiSalvaAzione, apiEseguiIscrizioni,
    apiPulizia, apiAnteprimaPulizia, apiReportPesanti, apiSpunta, apiSpuntaTutte, apiEseguiPulizia, apiCestinaPesanti,
  };
  const f = consentite[req.f];
  if (!f) return json_({ ok: false, errore: 'Funzione non consentita' });
  if (req.f !== 'apiDati' && req.f !== 'dati') registraAccesso_(req.f, 'ok');   // apiDati si apre a ogni avvio: non riempio il registro
  try {
    return json_(Object.assign({ ok: true, r: f.apply(null, Array.isArray(req.a) ? req.a.slice(0, 4) : []) }, v.nuovo ? { k: v.nuovo } : {}));
  } catch (err) {
    log_('Errore EDITH Voce', req.f + ' -> ' + err.message);
    return json_({ ok: false, errore: err.message });
  }
}

// ---------------------------------------------------------------- dati

function iso_(d) { return d instanceof Date ? Utilities.formatDate(d, CONFIG.TIMEZONE, "yyyy-MM-dd") : ''; }

/** Tutte le pratiche dal ANNO_INIZIO in poi, in formato semplice (niente oggetti Date). */
var DOPPIONI_ = 0;
function pratiche_() {
  const out = [];
  const inizio = new Date(CONFIG.ANNO_INIZIO, 0, 1);
  [['bollette', CONFIG.SHEET_BOLLETTE], ['assicurazioni', CONFIG.SHEET_ASSICURAZIONI]].forEach(([tipo, nome]) => {
    const sh = ss_().getSheetByName(nome);
    if (!sh || sh.getLastRow() < 2) return;
    readRows_(sh).rows.forEach(r => {
      const isAss = tipo === 'assicurazioni';
      const rif = isAss ? (r['DATA SCADENZA'] instanceof Date ? r['DATA SCADENZA'] : r['DATA COMUNICAZIONE'])
        : (r['DATA EMISSIONE'] instanceof Date ? r['DATA EMISSIONE'] : r['DATA COMUNICAZIONE']);
      if (!(rif instanceof Date) || rif < inizio) return;
      out.push({
        foglio: nome, riga: r._row, area: tipo,
        tipo: (isAss ? r['RAMO'] : r['FORNITURA']) || 'Altro',
        chi: String((isAss ? r['COMPAGNIA'] : r['FORNITORE']) || '').split(':')[0].trim(),
        numero: String((isAss ? r['N. POLIZZA'] : r['N. DOCUMENTO']) || ''),
        emissione: iso_(r['DATA EMISSIONE']), scadenza: iso_(r['DATA SCADENZA']), rif: iso_(rif),
        importo: typeof r['IMPORTO'] === 'number' ? r['IMPORTO'] : null,
        stato: r['STATO PAGAMENTO'] || '', pagata: iso_(r['PAGATA IL']),
        prossima: iso_(r['PROSSIMA RATA PREVISTA']),
        oggetto: String(r['OGGETTO MAIL'] || ''), link: String(r['LINK MAIL'] || ''),
      });
    });
  });
  // toglie i doppioni (per esempio la stessa bolletta inoltrata con "Fwd:")
  const visti = {};
  DOPPIONI_ = 0;
  return out.sort((a, b) => (b.rif || '').localeCompare(a.rif || '') || (/^(fwd|i):/i.test(a.oggetto) ? 1 : 0) - (/^(fwd|i):/i.test(b.oggetto) ? 1 : 0))
    .filter(p => {
      if (p.importo === null || !p.emissione) return true;
      const k = [p.area, p.tipo, p.chi, p.emissione, p.importo].join('|');
      if (visti[k]) { DOPPIONI_++; return false; } visti[k] = true; return true;
    });
}

function quota_() {
  try {
    const cache = CacheService.getScriptCache(), c = cache.get('quota');
    if (c) return JSON.parse(c);
    const q = Drive.About.get({ fields: 'storageQuota' }).storageQuota;
    const gb = b => round2_(Number(b || 0) / 1073741824);
    const out = { usato: gb(q.usage), limite: gb(q.limit), drive: gb(q.usageInDrive), altro: gb(Number(q.usage) - Number(q.usageInDrive || 0)) };
    cache.put('quota', JSON.stringify(out), 3600);
    return out;
  } catch (e) { return null; }
}

/** I dati dell'app restano pronti per 5 minuti: l'app si apre subito. Si azzerano quando qualcosa cambia. */
function apiDati() {
  try { const c = CacheService.getScriptCache().get('apiDati'); if (c) return JSON.parse(c); } catch (e) { }
  const d = calcolaDati_();
  try { const s = JSON.stringify(d); if (s.length < 95000) CacheService.getScriptCache().put('apiDati', s, 300); } catch (e) { }
  return d;
}
function svuotaCache_() { try { CacheService.getScriptCache().remove('apiDati'); } catch (e) { } }

function calcolaDati_() {
  const anno = new Date().getFullYear();
  const P = pratiche_();
  const conImp = P.filter(p => p.importo !== null);
  const B = conImp.filter(p => p.area === 'bollette' && p.rif.slice(0, 4) === String(anno));
  const A = conImp.filter(p => p.area === 'assicurazioni' && p.rif.slice(0, 4) === String(anno));
  const somma = arr => round2_(arr.reduce((s, p) => s + p.importo, 0));
  const tipi = uniq_(B.map(p => p.tipo));
  const mesi = [];
  for (let m = 1; m <= 12; m++) {
    const mm = anno + '-' + ('0' + m).slice(-2);
    const del = B.filter(p => p.rif.slice(0, 7) === mm);
    const perTipo = {};
    tipi.forEach(t => { perTipo[t] = somma(del.filter(p => p.tipo === t)); });
    mesi.push({ mese: m, totale: somma(del), perTipo });
  }
  const aperte = P.filter(p => p.stato === STATO.DA_PAGARE || p.stato === STATO.SCADUTA || p.stato === STATO.DA_VERIFICARE)
    .sort((a, b) => (a.scadenza || '9999').localeCompare(b.scadenza || '9999'));
  const pagabili = aperte.filter(p => p.stato !== STATO.DA_VERIFICARE);
  return {
    anno, oggi: iso_(new Date()),
    kpi: {
      bollette: somma(B), media: round2_(somma(B) / (new Date().getMonth() + 1)),
      assicurazioni: somma(A), aperte: pagabili.length, apertiTot: somma(pagabili.filter(p => p.importo !== null)),
    },
    tipi, mesi,
    perTipo: tipi.map(t => ({ nome: t, totale: somma(B.filter(p => p.tipo === t)) })),
    perRamo: uniq_(A.map(p => p.tipo)).map(t => ({ nome: t, totale: somma(A.filter(p => p.tipo === t)) })),
    aperte, pratiche: P.slice(0, 60), spazio: quota_(),
    anomalie: (function () { try { return anomalie_(P); } catch (e) { return []; } })(),
    offerte: offerte_(),
    spese: (function () { try { return riepilogoSpese_(); } catch (e) { return null; } })(),
  };
}

// ---------------------------------------------------------------- azioni

function apiElabora() {
  const prima = sheet_(CONFIG.SHEET_LOG).getLastRow();
  elaboraTutto();
  svuotaCache_();
  const log = sheet_(CONFIG.SHEET_LOG);
  const dopo = log.getLastRow();
  const righe = dopo > prima ? log.getRange(prima + 1, 2, dopo - prima, 2).getValues().map(r => r[0] + ': ' + r[1]) : [];
  return { log: righe, dati: apiDati() };
}

function apiSegnaPagata(foglio, riga) {
  svuotaCache_();
  const sh = ss_().getSheetByName(foglio);
  if (!sh || [CONFIG.SHEET_BOLLETTE, CONFIG.SHEET_ASSICURAZIONI].indexOf(foglio) === -1) throw new Error('Foglio non valido');
  const map = colMap_(sh);
  setCell_(sh, map, riga, 'STATO PAGAMENTO', STATO.CONCLUSA);
  setCell_(sh, map, riga, 'PAGATA IL', new Date());
  const r = leggiRiga_(sh, map, riga);
  if (r['TASK ID']) {
    tasklistIds_().some(l => { try { Tasks.Tasks.patch({ status: 'completed' }, l, r['TASK ID']); return true; } catch (e) { return false; } });
  }
  segnaEventoPagato_(r['EVENT ID']);
  aggiornaDashboard();
  return apiDati();
}

function righeFoglio_(nome) {
  const sh = sheet_(nome);
  return readRows_(sh).rows.map(r => {
    const o = { riga: r._row };
    Object.keys(r).forEach(k => { if (k !== '_row') o[k] = r[k] instanceof Date ? iso_(r[k]) : r[k]; });
    return o;
  });
}

function apiIscrizioni() { return { righe: righeFoglio_(CONFIG.SHEET_ISCRIZIONI), azioni: AZIONI_ISCRIZIONE }; }
function apiAnalizzaIscrizioni() { analizzaIscrizioni(); return apiIscrizioni(); }
function apiSalvaAzione(riga, azione) {
  if (AZIONI_ISCRIZIONE.indexOf(azione) === -1) throw new Error('Azione non valida');
  const sh = sheet_(CONFIG.SHEET_ISCRIZIONI);
  const map = colMap_(sh);
  setCell_(sh, map, riga, 'AZIONE', azione);
  // nuova scelta = nuova azione da eseguire, anche se su quel mittente avevi già fatto qualcosa
  setCell_(sh, map, riga, 'ESITO', '');
  return true;
}
/** Chiamata solo dopo la conferma mostrata nell'app. */
function apiEseguiIscrizioni() {
  eseguiAzioniIscrizioni(true);
  const r = apiIscrizioni();
  const oggi = fmtDate_(new Date());
  r.esito = {
    ok: r.righe.filter(x => String(x['ESITO']).indexOf('OK ' + oggi) === 0).length,
    errori: r.righe.filter(x => /^ERRORE/.test(String(x['ESITO']))).length,
    aMano: r.righe.filter(x => /DA FARE A MANO/.test(String(x['ESITO']))).length,
  };
  return r;
}

function apiPulizia() {
  preparaFoglioPulizia_();
  return { regole: righeFoglio_(CONFIG.SHEET_PULIZIA), pesanti: righeFoglio_(CONFIG.SHEET_PESANTI).slice(0, 60), spazio: quota_() };
}
function apiAnteprimaPulizia() { anteprimaPulizia(); return apiPulizia(); }
function apiReportPesanti() { reportMailPesanti(); return apiPulizia(); }
function apiSpunta(foglio, riga, colonna, valore) {
  const ammessi = { [CONFIG.SHEET_PULIZIA]: 'ESEGUI', [CONFIG.SHEET_PESANTI]: 'CESTINA' };
  if (ammessi[foglio] !== colonna) throw new Error('Campo non modificabile');
  const sh = sheet_(foglio);
  setCell_(sh, colMap_(sh), riga, colonna, valore === true);
  return true;
}
/** Chiamate solo dopo la conferma mostrata nell'app. */
/** Spunta o toglie la spunta a tutte le righe in un colpo solo (stessi campi ammessi di apiSpunta). */
function apiSpuntaTutte(foglio, colonna, valore) {
  const ammessi = { [CONFIG.SHEET_PULIZIA]: 'ESEGUI', [CONFIG.SHEET_PESANTI]: 'CESTINA' };
  if (ammessi[foglio] !== colonna) throw new Error('Campo non modificabile');
  const sh = sheet_(foglio), map = colMap_(sh), n = sh.getLastRow() - 1;
  const col = map[norm_(colonna)];
  if (col === undefined) throw new Error('Colonna ' + colonna + ' non trovata');
  if (n > 0) sh.getRange(2, col + 1, n, 1).setValues(Array.from({ length: n }, () => [valore === true]));
  return true;
}
function apiEseguiPulizia() { eseguiPulizia(true); return apiPulizia(); }
function apiCestinaPesanti() { cestinaMailPesantiSelezionate(true); return apiPulizia(); }

// ---------------------------------------------------------------- assistente

function apiChiedi(domanda, storia) {
  const q = String(domanda || '').trim();
  if (!q) return { testo: 'Dimmi pure.', fonte: 'locale' };
  storia = Array.isArray(storia) ? storia : [];
  try {
    const P = pratiche_();
    if (/^\s*(ripeti|ripetimelo|puoi ripetere|come hai detto|cosa hai detto|non ho sentito|non ho capito|scusa non ho capito|come scusa|eh come|cosa hai detto)\b/i.test(normalizza_(q))) {
      const ult = storia.filter(m => m.ruolo !== 'io').pop();
      return { testo: ult ? String(ult.testo) : 'Non ti ho ancora detto niente!', fonte: 'locale' };
    }
    const t0 = normalizza_(q), parole = t0.split(' ').length;
    const ultimaEd = storia.filter(m => m.ruolo !== 'io').pop();
    // "sì" a una proposta di Edith ("Vuoi che la confronti con agosto?") → esegue la proposta
    if (ultimaEd && ultimaEd.seguito && parole <= 4) {
      if (/^(si|certo|ok|okay|va bene|dai|volentieri|perche no|si grazie|ok dai|vai|fallo|sicuro|esatto)\b/.test(t0)) {
        const r = rispostaLocale_(String(ultimaEd.seguito), P);
        if (r) return comunica_(r, q, storia, P);
      }
      if (/^(no|no grazie|lascia stare|non serve|niente)\b/.test(t0)) return { testo: aCaso_(['Va bene.', 'Ok, come vuoi.', 'Nessun problema.']), fonte: 'locale' };
    }
    const eSeguito = (/^(e|ed|invece|anche|pure)\b/.test(t0) && parole <= 7) || soloDettagli_(t0, P) ||
      (/\b(quella|quello|questa|questo|la stessa|lo stesso|di quella|di quello)\b/.test(t0) && parole <= 8);
    const locale = eSeguito ? (rispostaLocale_(seguito_(q, storia, P), P) || rispostaLocale_(q, P)) : rispostaLocale_(q, P);
    if (locale) return comunica_(Object.assign({ fonte: 'locale' }, locale), q, storia, P);
    return Object.assign({ fonte: 'locale', capito: false }, chiarisci_(t0, P));
  } catch (e) {
    log_('Errore assistente', q + ' -> ' + e.message);
    return { testo: 'Ho avuto un problema a leggere i dati (' + e.message + '). Riprova tra poco.', fonte: 'locale' };
  }
}

/**
 * Domande di seguito: "e a settembre?", "e il gas?", "e l'anno scorso?".
 * Prende l'ultima domanda e sostituisce solo il pezzo nuovo (mese, tipo, anno, fornitore).
 */
function seguito_(q, storia, P) {
  const chiacchiera = /^(ok|si|no|bene|grazie|va bene|perfetto|basta|stop|ripeti|ciao|brav|chi sei|che ore|che giorno|come stai|edith|edit|eddie)\b/;
  // ricostruisce la domanda completa di contesto, seguendo anche i seguiti dei seguiti
  let prima = '';
  storia.filter(m => m.ruolo === 'io').map(m => normalizza_(m.testo)).forEach(x => {
    if (!x || chiacchiera.test(x)) return;
    const seg = /^(e|ed|invece|anche|pure)\b/.test(x) || x.split(' ').length <= 3;
    prima = (seg && prima) ? unisci_(prima, x, P) : x;
  });
  const t = normalizza_(q);
  if (!prima || t.split(' ').length > 7) return q;
  return unisci_(prima, t, P);
}

function unisci_(prima, t, P) {
  const n = capisci_(t, P);
  let base = prima;
  if (n.mesi.length) NOMI_MESI.concat(['questo mese', 'mese corrente', 'mese scorso', 'mese passato']).forEach(m => { base = base.split(m).join(' '); });
  if (/\b20\d\d\b|anno scorso|anno passato/.test(t)) base = base.replace(/\b20\d\d\b|l? ?anno scorso|l? ?anno passato/g, ' ');
  if (n.tipo || n.ass || n.chi) {
    SINONIMI_TIPO.forEach(([, re]) => { base = base.replace(new RegExp(re.source, 'g'), ' '); });
    base = base.replace(/assicura\w*|polizz\w*/g, ' ');
    uniq_(P.map(p => p.chi).filter(c => c)).forEach(c => normalizza_(c).split(' ').forEach(w => { if (w.length > 2) base = base.replace(new RegExp('\\b' + w + '\\b', 'g'), ' '); }));
  }
  return (base + ' ' + t.replace(/^(e|ed|invece|anche|pure)\s+/, '')).replace(/\s+/g, ' ').trim();
}

/** Vero se la frase contiene solo dettagli (mese, anno, tipo, fornitore), tipo "settembre?" o "il gas". */
function soloDettagli_(t, P) {
  const c = capisci_(t, P);
  if (!(c.mesi.length || c.tipo || c.chi || c.ass || /\b20\d\d\b|anno scorso|mese scorso/.test(t))) return false;
  let resto = ' ' + t + ' ';
  NOMI_MESI.concat(['mese scorso', 'mese passato', 'questo mese', 'anno scorso', 'anno passato']).forEach(m => { resto = resto.split(m).join(' '); });
  SINONIMI_TIPO.forEach(([, re]) => { resto = resto.replace(new RegExp(re.source, 'g'), ' '); });
  resto = resto.replace(/assicura\w*|polizz\w*|\b20\d\d\b/g, ' ');
  if (c.chi) normalizza_(c.chi).split(' ').forEach(w => { resto = resto.replace(new RegExp('\\b' + w + '\\b', 'g'), ' '); });
  return resto.replace(/\b(a|di|del|della|dello|il|lo|la|le|i|gli|per|e|ed|in|nel|nella|quello|quella|invece|anche|pure)\b/g, ' ').trim() === '';
}

// ---------------------------------------------------------------- stile di conversazione

/** Rifinisce la risposta: niente ripetizioni identiche, un po' di calore, empatia, e propone il passo successivo. */
function comunica_(r, q, storia, P) {
  const t = normalizza_(q);
  const ultima = storia.filter(m => m.ruolo !== 'io').pop();
  // se dico esattamente la stessa cosa di prima, lo ammetto
  if (ultima && String(ultima.testo) === r.testo && !/^(si|ok|va bene)/.test(t)) r.testo = aCaso_(['Come ti dicevo: ', 'Te lo ripeto: ']) + minuscola_(r.testo);
  // empatia: se sei scocciata o preoccupata, lo riconosco prima del dato
  const umore = /che palle|uffa|mannaggia|porca|che stress|sono stanc[ao]|odio le bollette|che schifo|esagerat|una rapina|troppo car[ao]|ladri/.test(t);
  if (umore && !r.fine) r.testo = aCaso_(['Ti capisco. ', 'Eh, lo so. ', 'Hai ragione a sbuffare. ']) + r.testo;
  // proposta del passo successivo, se non ce n'è già una e la risposta non è una chiacchiera
  if (r.seguito && r.proposta && !/\?$/.test(r.testo)) r.testo += ' ' + r.proposta;
  delete r.proposta;
  return r;
}

/** Quando non capisco: invece di una risposta a caso, chiedo cosa intendi o propongo la domanda più vicina. */
function chiarisci_(t, P) {
  const c = capisci_(t, P);
  const cosa = c.chi || (c.tipo ? 'la ' + c.tipo.toLowerCase() : c.ass ? 'le assicurazioni' : c.mesi.length ? NOMI_MESI[c.mesi[0]] : '');
  if (cosa) {
    const base = c.chi || (c.tipo ? c.tipo.toLowerCase() : c.ass ? 'assicurazione' : '');
    return { testo: 'Su ' + cosa + ' cosa vuoi sapere? Quanto hai speso, quando scade o l\'ultima arrivata?',
      seguito: 'quanto ho speso ' + (base ? 'di ' + base : '') + (c.mesi.length ? ' a ' + NOMI_MESI[c.mesi[0]] : ''), proposta: '' };
  }
  const esempi = ['cosa devo pagare', 'quanto ho speso quest anno', 'quando scade l assicurazione', 'ci sono anomalie', 'briefing',
    'quanto spendero a fine anno', 'la bolletta piu cara', 'quanto manca alla scadenza', 'quanto spazio ho', 'controlla la posta', 'consigli per risparmiare', 'riepilogo'];
  const vuote = /^(il|lo|la|le|i|gli|di|a|da|in|con|su|per|che|e|mi|ti|si|un|una|ho|hai|quanto|come|cosa|quando)$/;
  const parole = t.split(' ').filter(w => w.length > 2 && !vuote.test(w));
  let meglio = null, punti = 0;
  esempi.forEach(e => {
    const p = parole.filter(w => e.split(' ').some(x => x.length > 2 && (x === w || (w.length > 4 && x.slice(0, 5) === w.slice(0, 5))))).length;
    if (p > punti) { punti = p; meglio = e; }
  });
  if (meglio) return { testo: 'Non sono sicura di aver capito. Intendevi "' + meglio + '"?', seguito: meglio };
  return { testo: nonCapito_() };
}

/** Per ogni fornitore con almeno 2 bollette: ogni quanti giorni arrivano e quando arriva la prossima. */
function previsioniBollette_(P) {
  const per = {};
  P.filter(p => p.area === 'bollette' && p.emissione).forEach(p => { const k = p.chi + '|' + p.tipo; (per[k] = per[k] || []).push(p); });
  const oggi = iso_(new Date()), out = [];
  Object.keys(per).forEach(k => {
    const d = per[k].map(p => p.emissione).sort();
    if (d.length < 2) return;
    const gg = (a, b) => (new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5;
    let tot = 0; for (let i = 1; i < d.length; i++) tot += gg(d[i - 1], d[i]);
    const ogni = Math.round(tot / (d.length - 1));
    if (ogni < 20 || ogni > 400) return;
    const att = new Date(new Date(d[d.length - 1] + 'T12:00:00').getTime() + ogni * 864e5);
    const attesa = iso_(att);
    if (gg(attesa, oggi) > ogni) return;   // fornitore probabilmente cambiato
    out.push({ chi: per[k][0].chi, tipo: per[k][0].tipo, ogni: ogni, attesa: attesa });
  });
  return out.sort((a, b) => a.attesa.localeCompare(b.attesa));
}

function aMese_(i) { return (/^[aeiou]/.test(NOMI_MESI[i]) ? 'ad ' : 'a ') + NOMI_MESI[i]; }
function cap_(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function aCaso_(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function nonCapito_() {
  return aCaso_([
    'Questa non l\'ho capita. Prova a chiedermi cosa devi pagare, quanto hai speso o quando scade qualcosa.',
    'Mi sa che questa è fuori dalla mia portata. Posso dirti scadenze, spese, confronti tra mesi e lo spazio della posta.',
    'Non ho capito, scusa. Riformuli? Per esempio: "quanto ho speso di gas a ottobre?"',
  ]);
}

const NOMI_MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
const SINONIMI_TIPO = [
  ['Luce', /\b(luce|elettric\w*|energia|corrente|enel)\b/], ['Gas', /\b(gas|metano|riscaldamento)\b/],
  ['Acqua', /\b(acqua|idric\w*|acquedotto)\b/], ['Telefono/Internet', /\b(telefon\w*|internet|fibra|cellulare|wifi|adsl|sim)\b/],
  ['Rifiuti (TARI)', /\b(tari|rifiuti|spazzatura|immondizia)\b/], ['Condominio', /\bcondomin\w*/],
];

/** Riconosce "Edith, sono io" anche quando la dettatura scrive "Edit", "Eddie", "Edi", "Editt"... */
function eFraseDiRiconoscimento_(t) {
  return /\bsono io\b/.test(t) || (/\b(h?ed+[iy]?t*h?|it|ed|edi|eddie|eddy|edita|editha|aedith|e dit|elit|edict)\b/.test(t) && /\b(sono|io|so)\b/.test(t) && t.split(' ').length <= 5);
}

function normalizza_(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function aiuto_() {
  return 'Puoi chiedermi: "cosa devo pagare?", "quando scade l\'assicurazione?", "quanto manca alla scadenza?", "quanto ho speso di luce a settembre?", "e il mese scorso?", "la bolletta più cara", "briefing", ' +
    '"confronta luglio e settembre", "la luce è aumentata?", "l\'ultima bolletta del gas", "riepilogo", ' +
    '"ho pagato l\'AXA", "quanto spazio ho?", "controlla la posta".';
}

function eur_(n) { return (n === null || n === undefined) ? 'importo non indicato' : '€ ' + Number(n).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+,)/g, '.'); }
function data_(s) { return s ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : 'senza data'; }
function descr_(p) {
  return p.tipo + (p.chi ? ' ' + p.chi : '') + ', ' + eur_(p.importo) + (p.scadenza ? ', scadenza ' + data_(p.scadenza) : '') + (p.stato === STATO.SCADUTA ? ' (scaduta)' : '');
}

/** Estrae dalla frase: anno, mesi citati, tipo di fornitura, area, fornitore. */
function capisci_(t, P) {
  const oggi = new Date();
  let anno = (t.match(/\b(20\d\d)\b/) || [])[1];
  if (!anno && /anno scorso|l anno passato/.test(t)) anno = String(oggi.getFullYear() - 1);
  if (!anno) anno = String(oggi.getFullYear());
  const mesi = [];
  NOMI_MESI.forEach((m, i) => { const k = t.indexOf(m); if (k !== -1) mesi.push({ i: i, pos: k }); });
  mesi.sort((a, b) => a.pos - b.pos);
  const idx = mesi.map(m => m.i);
  if (/questo mese|mese corrente/.test(t)) idx.push(oggi.getMonth());
  if (/mese scorso|mese passato/.test(t)) idx.push((oggi.getMonth() + 11) % 12);
  const nomi = uniq_(P.map(p => p.chi).filter(c => c));
  const generiche = /^(energia|energy|assicurazioni|assicurazione|spa|gas|luce|italia|servizi|group|gruppo|acqua|the)$/;
  const chi = nomi.find(c => normalizza_(c).split(' ').some(w => w.length > 2 && !generiche.test(w) && new RegExp('\\b' + w + '\\b').test(t))) || null;
  // "SOMET ENERGIA" è un fornitore, non la parola "energia" (= luce): tolgo il nome prima di cercare il tipo
  let tt = t;
  if (chi) normalizza_(chi).split(' ').forEach(w => { tt = tt.replace(new RegExp('\\b' + w + '\\b', 'g'), ' '); });
  const tipo = (SINONIMI_TIPO.find(([, re]) => re.test(tt)) || [])[0] || null;
  const ramo = /\b(auto|macchina|moto|rca|veicol\w*)\b/.test(tt) ? 'auto' : /\b(salute|infortun\w*|medic\w*|sanitari\w*)\b/.test(tt) ? 'salute'
    : /\b(casa|abitazione|incendio)\b/.test(tt) && /assicur|polizz/.test(tt) ? 'casa' : /\bvita\b/.test(tt) ? 'vita' : null;
  const ass = /assicura\w*|polizz\w*|\brat[ae]\b/.test(tt) || !!ramo || (!!chi && P.some(p => p.chi === chi && p.area === 'assicurazioni'));
  // tipi citati, nell'ordine (per "spendo più di luce o di gas?")
  const tipi = SINONIMI_TIPO.filter(([, re]) => re.test(tt)).map(x => x[0]);
  return { anno, mesi: idx, tipo, tipi, ass, ramo, chi };
}

function filtra_(P, c, opz) {
  opz = opz || {};
  return P.filter(p =>
    (!c.ass || p.area === 'assicurazioni') && (c.ass || !opz.soloBollette || p.area === 'bollette') &&
    (!c.tipo || p.tipo.indexOf(c.tipo) !== -1) && (!c.chi || p.chi === c.chi) &&
    (!c.ramo || p.area !== 'assicurazioni' || p.tipo.toLowerCase().indexOf(c.ramo) !== -1));
}

function rispostaLocale_(q, P) {
  const t = normalizza_(q);
  const c = capisci_(t, P);
  const somma = arr => arr.reduce((s, p) => s + (p.importo || 0), 0);
  const aperte = P.filter(p => p.stato === STATO.DA_PAGARE || p.stato === STATO.SCADUTA)
    .sort((a, b) => (a.scadenza || '9999').localeCompare(b.scadenza || '9999'));
  const etichetta = c.chi ? 'con ' + c.chi : c.ramo ? 'di assicurazione ' + c.ramo : c.ass ? 'di assicurazioni' : c.tipo ? 'di ' + c.tipo.toLowerCase() : c.chi ? 'con ' + c.chi : 'di bollette';

  // spese fuori dalle bollette: "ho fatto benzina, sono 50 euro", "quanto ho speso di benzina?"
  const sp = rispostaSpese_(t, c);
  if (sp) return sp;

  // conversazione: risposte brevi, niente riepiloghi non richiesti
  const ora = new Date().getHours();
  const saluto = ora < 13 ? 'Buongiorno' : ora < 18 ? 'Buon pomeriggio' : 'Buonasera';
  const corta = t.split(' ').length <= 4;
  if (eFraseDiRiconoscimento_(t) && ora >= 5 && ora < 12 && primoDelGiorno_()) {
    return { testo: saluto + ', Teo. ' + briefing_(P) + ' Dimmi pure.' };
  }
  if (/briefing|novita di oggi|cosa c e oggi|com e la giornata|aggiornami|la mia giornata|cosa mi aspetta|programma di oggi|la settimana/.test(t)) {
    return { testo: briefing_(P) };
  }
  if (eFraseDiRiconoscimento_(t)) {
    return { testo: aCaso_([saluto + ', Teo. ', 'Bentornata, Teo. ', 'Eccoti, Teo. ']) + (aperte.length
      ? 'Hai ' + aperte.length + (aperte.length === 1 ? ' pagamento' : ' pagamenti') + ' in sospeso. Dimmi pure.'
      : 'Tutto in ordine, niente da pagare. Dimmi pure.') };
  }
  if (corta && /^(ciao|buongiorno|buonasera|buon pomeriggio|salve|hey|ehi|eccomi|ehila)\b/.test(t)) {
    return { testo: aCaso_([saluto + '! Dimmi pure.', 'Ciao Teo! Come posso aiutarti?', 'Eccomi. Cosa ti serve?']) };
  }
  if (/^(zitta|stai zitta|taci|silenzio|shh+|sst+|zitto|non parlare)\b/.test(t)) return { testo: 'Ok.', fine: true };
  if (/^(basta|stop|fermati|a dopo|ci sentiamo|ciao ciao|arrivederci|buonanotte|alla prossima|chiudi|smetti)\b/.test(t)) {
    return { testo: aCaso_(['A dopo, Teo.', 'Va bene, sono qui quando ti serve.', 'Ok, ci sentiamo.']), fine: true };
  }
  if (/^(grazie|ti ringrazio|ok grazie|grazie mille)\b/.test(t)) {
    return { testo: aCaso_(['Figurati!', 'Di niente.', 'Quando vuoi.', 'Figurati, è il mio lavoro.']) };
  }
  if (/^(brav[oa]|grande|ottimo lavoro|sei forte|perfetta)\b/.test(t) && corta) {
    return { testo: aCaso_(['Grazie! Faccio del mio meglio.', 'Troppo gentile.', 'Grazie, Teo.']) };
  }
  if (/^(ok|okay|okei|va bene|bene|benissimo|perfetto|ottimo|capito|d accordo|ah ok|chiaro|giusto|esatto|si|no|niente|nulla|lascia stare|ok bene|ok perfetto)( [a-z]+){0,2}$/.test(t)
      && !/pagat|scad|spes|quanto|bollett|assicur|posta/.test(t)) {
    if (/^(no|niente|nulla|lascia stare)\b/.test(t)) return { testo: aCaso_(['Va bene.', 'Ok, nessun problema.']) };
    return { testo: aCaso_(['Bene.', 'Perfetto.', 'Ok.', 'D\'accordo. Se ti serve altro, chiedi pure.', 'Bene, ci sono se ti serve.']) };
  }
  if (/come stai|come va\b(?! la| il| con| tutto)/.test(t) && corta && !/tutto/.test(t)) {
    return { testo: aCaso_(['Bene, grazie! Tengo d\'occhio le tue bollette. Tu?', 'Tutto bene, i conti sono in ordine. E tu?']) };
  }
  if (/^(mi senti|ci sei|sei sveglia|sei li|sei qui|pronto|edith)\b/.test(t) && corta) {
    return { testo: aCaso_(['Sì, ti sento. Dimmi pure.', 'Ci sono! Cosa ti serve?', 'Sono qui.']) };
  }
  if (/che mi racconti|novita\b|che si dice|cosa mi dici/.test(t) && corta) return { testo: briefing_(P) };
  if (/chi sei|come ti chiami|cosa sei/.test(t)) {
    return { testo: 'Sono EDITH, la tua assistente per bollette, assicurazioni e posta. Ragiono con regole scritte apposta per te sui dati del tuo Sheet, senza servizi esterni: non sono un\'intelligenza artificiale vera, quindi se una domanda esce dal mio campo te lo dico.' };
  }
  if (/che ore sono|che ora e/.test(t)) return { testo: 'Sono le ' + Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'HH:mm') + '.' };
  if (/che giorno e|che data e|quanti ne abbiamo/.test(t)) {
    return { testo: 'Oggi è ' + ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'][new Date().getDay()] + ' ' + Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'd') + ' ' + NOMI_MESI[new Date().getMonth()] + '.' };
  }
  if (/aiuto|cosa sai fare|cosa puoi fare|comandi|come funzion/.test(t)) return { testo: aiuto_() };

  // skill: controllo anomalie
  if (/anomali\w*|problem\w*|qualcosa (che )?non va|c e qualcosa di strano|tutto (ok|bene|a posto|in ordine|regolare)|controlla (il sistema|tutto|i dati)|stato del sistema|errori|cose strane|stranezze|check/.test(t)) {
    const an = anomalie_(P);
    const r = { testo: testoAnomalie_(P) };
    if (an.some(x => /sopra la tua media/.test(x.testo))) { r.seguito = 'consigli per risparmiare'; r.proposta = 'Vuoi qualche idea per spendere meno?'; }
    return r;
  }
  // skill: previsione di spesa
  if (/previsione|quanto spendero|quanto spenderò|stima|fine anno|prossim[io] mes[ie]/.test(t) && !/scad/.test(t)) {
    const anno = String(new Date().getFullYear()), mese = new Date().getMonth() + 1;
    const B = filtra_(P.filter(p => p.importo !== null && p.area === 'bollette' && p.rif.slice(0, 4) === anno), c, {});
    const A = P.filter(p => p.importo !== null && p.area === 'assicurazioni' && p.prossima && p.prossima.slice(0, 4) === anno && p.prossima >= iso_(new Date()));
    const fatto = somma(B), media = fatto / mese, resto = media * (12 - mese);
    return { testo: 'Finora nel ' + anno + ' hai speso ' + eur_(fatto) + ' ' + etichetta + ', in media ' + eur_(media) + ' al mese. Di questo passo arrivi a circa ' + eur_(fatto + resto) + ' a fine anno' +
      (A.length && !c.tipo ? ', più ' + eur_(somma(A)) + ' di rate di assicurazione ancora previste' : '') + '.' };
  }
  // skill: l'offerta in corso (letta dalle bollette)
  if (/offert\w*|tariff\w*|contratt\w*|\bkwh\b|\bsmc\b|al chilowatt|condizioni economiche|\bpod\b|\bpdr\b|quota fissa|potenza (impegnata|del contatore)|prezzo (fisso|variabile|della luce|del gas|dell energia)|che prezzo|mercato libero|tutela/.test(t)) {
    const O = offerte_().filter(o => (!c.tipo || o.tipo.indexOf(c.tipo) !== -1 || (c.tipo === 'Luce' && o.prezzoLuce) || (c.tipo === 'Gas' && o.prezzoGas)) && (!c.chi || o.chi === c.chi));
    if (!O.length) return { testo: 'I dettagli dell\'offerta ' + (c.chi || c.tipo ? 'per ' + (c.chi || c.tipo.toLowerCase()) + ' ' : '') + 'non li ho ancora: li leggo dalle bollette, e al prossimo controllo della posta rileggo le ultime arrivate. Se la bolletta non riporta il riquadro dell\'offerta, lo trovi nell\'area clienti del fornitore.' };
    if (/\bpod\b|\bpdr\b|codice/.test(t)) {
      const cod = O.map(o => [o.pod && 'POD ' + o.pod.split('').join(' '), o.pdr && 'PDR ' + o.pdr.split('').join(' ')].filter(Boolean).join(', ') + ' (' + o.chi + ')').filter(x => !/^ \(/.test(x));
      return { testo: cod.length ? 'Ecco i codici: ' + cod.join('; ') + '. Li vedi anche in Home, nel riquadro delle offerte.' : 'POD e PDR non sono scritti nelle bollette che ho letto.' };
    }
    if (/scad|fino a quando|quando finisce|dura/.test(t)) {
      const con = O.filter(o => o.scadenza);
      return { testo: con.length ? con.map(o => 'Le condizioni di ' + o.chi + (o.offerta ? ' "' + o.offerta + '"' : '') + ' scadono il ' + data_(o.scadenza)).join('; ') + '.' : 'Nelle bollette non trovo la data di scadenza delle condizioni economiche.' };
    }
    return { testo: O.map(o => cap_(descriviOfferta_(o))).join(' ') + (O.some(o => o.da) ? ' Dati presi dall\'ultima bolletta.' : ''),
      seguito: 'consigli per risparmiare', proposta: 'Vuoi qualche idea per pagare meno?' };
  }
  // skill: consigli per risparmiare (basati sui tuoi dati)
  if (/consigli\w*|risparmi(?!at)\w*|spendere meno|come (posso )?ridurre|tagliare/.test(t)) {
    const anno = String(new Date().getFullYear());
    const B = P.filter(p => p.importo !== null && p.area === 'bollette' && p.rif.slice(0, 4) === anno);
    const per = {}; B.forEach(p => { per[p.tipo] = (per[p.tipo] || 0) + p.importo; });
    const top = Object.keys(per).sort((a, b) => per[b] - per[a])[0];
    const caro = anomalie_(P).find(x => /sopra la tua media/.test(x.testo));
    const idee = [];
    offerte_().forEach(o => {
      const g = o.scadenza ? Math.round((new Date(o.scadenza + 'T12:00:00') - new Date()) / 864e5) : null;
      if (g !== null && g <= 90 && g > -120) idee.push('le condizioni di ' + o.chi + (g >= 0 ? ' scadono tra ' + g + ' giorni' : ' sono già scadute') + ', quindi conviene confrontare adesso');
      if (/variabile/i.test(o.tipoPrezzo)) idee.push('con ' + o.chi + ' hai un prezzo variabile: se i prezzi salgono, un fisso ti protegge');
      if (o.quotaFissa && o.quotaFissa > 12) idee.push('la quota fissa di ' + o.chi + ' (' + eur_(o.quotaFissa) + ' al mese) è alta: molte offerte stanno sotto i 10 euro');
      if (o.mercato === 'Tutela' || o.mercato === 'Tutele graduali') idee.push('sei nel servizio ' + o.mercato.toLowerCase() + ': il mercato libero a volte costa meno, ma confronta bene');
    });
    return { testo: (top ? 'La voce che pesa di più è ' + top.toLowerCase() + ': ' + eur_(per[top]) + ' quest\'anno. ' : '') + (caro ? caro.testo + ' ' : '') +
      (idee.length ? 'Dalla tua offerta: ' + idee.slice(0, 2).join('; ') + '. ' : '') +
      'Due idee: confronta l\'offerta del fornitore su ilportaleofferte.it, il sito ufficiale e gratuito dell\'autorità per l\'energia, e controlla che le letture del contatore siano reali e non stimate.' };
  }
  // chiacchiere
  if (/che tempo fa|meteo|piove/.test(t)) return { testo: 'Il meteo non lo vedo: lavoro solo sui tuoi conti e sulla posta. Ma se piove, almeno le bollette sono in ordine.' };
  if (/barzelletta|fammi ridere|battuta/.test(t)) return { testo: aCaso_(['Sai qual è la bolletta più leggera? Quella già pagata.', 'Mi chiedono spesso se ho dei sentimenti. Rispondo che ho delle scadenze, che è quasi lo stesso.', 'Ho provato a fare una dieta, ma la bolletta del gas continua a ingrassare in inverno.']) };
  if (/sono (stanc|triste|stressat|nervos|preoccupat|giu\b|a pezzi|distrutt)|giornata (pesante|storta|no\b)|che stress|non ce la faccio/.test(t)) {
    return { testo: aCaso_(['Mi dispiace, Teo. Ai conti ci penso io: tu prenditi un momento per te.', 'Giornata lunga, eh? Riposati, qui è tutto sotto controllo.']) +
      (aperte.length ? '' : ' E almeno di pagamenti in sospeso non ce ne sono.') };
  }
  if (/ti voglio bene|sei la migliore|ti amo/.test(t)) return { testo: 'Che dolce. Anche io tengo molto ai tuoi conti.' };
  if (/sei (stupida|scema|lenta|rincoglionita)|non capisci/.test(t)) return { testo: 'Hai ragione, a volte mi perdo. Prova a chiedermelo con altre parole: imparo dalle domande che mi fai.' };
  if (/^(buongiorno|buonasera|buonanotte) edith|^edith$/.test(t)) return { testo: aCaso_([saluto + '! Dimmi pure.', 'Eccomi.']) };

  if (/ricordami|mi ricordi|promemoria|avvisami/.test(t)) {
    const lista = filtra_(aperte, c);
    return { testo: 'I promemoria li creo da sola: due giorni prima di ogni scadenza trovi un\'attività in Google Tasks. ' +
      (lista.length ? 'Il prossimo sarà per ' + descr_(lista[0]) + '.' : 'Adesso ' + (c.tipo || c.chi ? 'per ' + (c.chi || c.tipo.toLowerCase()) + ' ' : '') + 'non c\'è niente da pagare.') };
  }
  if (/pulisci|pulizia|liberare|libera spazio|mail pesanti|posta pesante|quanta posta|troppe mail|cancella|svuota|elimina/.test(t)) {
    const s = quota_();
    return { testo: (s ? 'Stai usando ' + s.usato + ' GB su ' + s.limite + ' GB. ' : '') + 'Nella sezione Posta trovi la pulizia guidata: newsletter e promozioni vecchie, e le mail più pesanti da scegliere una per una. ' +
      'Non cancello niente da sola: quello che scegli va nel Cestino, e da lì lo elimini tu.' };
  }
  // azioni
  if (/\b(controlla|elabora|aggiorna|scarica|leggi)\b.*\b(posta|mail|bollette|email)\b|nuove bollette|ci sono novita|^(aggiorna|controlla|sincronizza)$/.test(t)) {
    const prima = {}; P.forEach(p => { prima[p.foglio + '|' + p.riga] = 1; });
    const r = apiElabora();
    const nuove = pratiche_().filter(p => !prima[p.foglio + '|' + p.riga]);
    const errori = r.log.filter(x => /errore/i.test(x)).length;
    const daVer = nuove.filter(p => p.stato === STATO.DA_VERIFICARE).length;
    return { testo: (nuove.length ? 'Ho controllato la posta: ' + (nuove.length === 1 ? 'un documento nuovo, ' : nuove.length + ' documenti nuovi: ') + nuove.slice(0, 3).map(descr_).join('; ') + '.' +
      (daVer ? ' ' + (daVer === 1 ? 'Uno va verificato' : daVer + ' vanno verificati') + ' a mano nello Sheet.' : '') : 'Ho controllato la posta: niente di nuovo.') +
      (errori ? ' Qualcosa però non è andato: trovi i dettagli nel foglio LOG.' : ''), aggiorna: true };
  }
  if (/\b(ho pagato|segna\w*|pagat[ao])\b/.test(t) && !/quanto|quando|quali|cosa/.test(t)) {
    const cand = filtra_(aperte, c);
    if (!cand.length) return { testo: aperte.length ? 'Non trovo un pagamento aperto che corrisponda. In sospeso ci sono: ' + aperte.map(descr_).join('; ') + '.' : 'Non hai pagamenti in sospeso.' };
    if (cand.length > 1 && !(c.tipo || c.chi || c.ass)) return { testo: 'Quale? ' + cand.map(descr_).join('; ') + '. Dimmi il fornitore o il tipo.' };
    const p = cand[0];
    return { testo: 'Vuoi che segni come pagata ' + descr_(p) + '?', azione: { tipo: 'pagata', foglio: p.foglio, riga: p.riga, nome: p.tipo + ' ' + p.chi } };
  }

  // informazioni generali
  if (/spazio|memoria|archiviazione|\bgiga\b|\bgb\b|pien[ao]/.test(t)) {
    const s = quota_();
    return { testo: s ? 'Stai usando ' + s.usato + ' GB su ' + s.limite + ' GB (' + Math.round(s.usato / s.limite * 100) + '%): ' + s.altro + ' GB tra Gmail e Foto, ' + s.drive + ' GB su Drive. Nella sezione Posta trovi la pulizia guidata.' : 'Non riesco a leggere lo spazio adesso.' };
  }
  if (/newsletter|iscrizion\w*|disiscriv\w*|pubblicita|spam/.test(t)) {
    const n = righeFoglio_(CONFIG.SHEET_ISCRIZIONI).length;
    return { testo: n ? 'Ho trovato ' + n + ' mittenti di newsletter. Nella sezione Posta scegli quali disiscrivere.' : 'Non ho ancora analizzato le iscrizioni: in Posta tocca "Analizza".' };
  }
  if (/riepilogo|riassunto|riassumi|situazione|resoconto|come (sto|siamo|va)|panoramica/.test(t)) {
    const anno = String(new Date().getFullYear());
    const B = P.filter(p => p.area === 'bollette' && p.rif.slice(0, 4) === anno);
    const A = P.filter(p => p.area === 'assicurazioni' && p.rif.slice(0, 4) === anno);
    return { testo: 'Nel ' + anno + ' hai speso ' + eur_(somma(B)) + ' di bollette (' + B.length + (B.length === 1 ? ' documento' : ' documenti') + ') e ' + eur_(somma(A)) + ' di assicurazioni. ' +
      (aperte.length ? 'Da pagare: ' + aperte.map(descr_).join('; ') + '.' : 'Non hai nulla da pagare.') };
  }

  if (/quando (ho|l ho) pagat|pagata quando|data (del )?pagamento/.test(t)) {
    const fatte = filtra_(P.filter(p => p.pagata), c).sort((a, b) => b.pagata.localeCompare(a.pagata));
    if (!fatte.length) return { testo: 'Non ho date di pagamento ' + (c.chi || c.tipo ? etichetta : '') + ' segnate. Le registro quando mi dici "ho pagato…" o la spunti nell\'app.' };
    return { testo: cap_(fatte[0].tipo + ' ' + fatte[0].chi) + ' risulta pagata il ' + data_(fatte[0].pagata) + ' (' + eur_(fatte[0].importo) + ').' };
  }
  if (/risparmiat\w*/.test(t)) {
    return { testo: 'Quanto hai risparmiato non lo so dire, perché non vedo cosa pagavi prima. Posso però dirti se una bolletta è aumentata o diminuita rispetto alla precedente.', seguito: 'confronta l ultima bolletta', proposta: 'Te lo dico per l\'ultima?' };
  }
  // quanto manca a una scadenza
  if (/quanto manca|quanti giorni|fra quanto|tra quanto/.test(t)) {
    const lista = filtra_(aperte, c).filter(p => p.scadenza);
    if (!lista.length) return { testo: 'Non c\'è nessuna scadenza aperta' + (c.tipo || c.chi || c.ass ? ' per ' + (c.chi || c.tipo || 'le assicurazioni') : '') + '.' };
    const p = lista[0], g = Math.round((new Date(p.scadenza + 'T12:00:00') - new Date(iso_(new Date()) + 'T12:00:00')) / 864e5);
    return { testo: g < 0 ? p.tipo + ' ' + p.chi + ' è scaduta da ' + (-g) + (g === -1 ? ' giorno' : ' giorni') + ' (' + eur_(p.importo) + ').'
      : g === 0 ? p.tipo + ' ' + p.chi + ' scade oggi: ' + eur_(p.importo) + '.'
      : 'Mancano ' + g + (g === 1 ? ' giorno' : ' giorni') + ': ' + descr_(p) + '.' };
  }

  // scadenze
  if (/quando scade|quando (devo|va) pagat|quando (pago|devo pagare)|prossima scadenza|prossima rata|prossima bolletta|prossimo pagamento|scadenz\w*|scade/.test(t) && !/quanto (ho|hai) (speso|pagato)/.test(t)) {
    if (/prossima bolletta|quando arriva|arrivera/.test(t) && !c.ass) {
      const daPagare = filtra_(aperte, c, { soloBollette: true }).filter(p => p.area === 'bollette');
      if (daPagare.length) return { testo: 'Da pagare c\'è già: ' + daPagare.map(descr_).join('; ') + '.' };
      const prev = previsioniBollette_(filtra_(P, c, { soloBollette: true }));
      if (c.tipo) prev.sort((a, b) => (a.tipo === c.tipo ? 0 : 1) - (b.tipo === c.tipo ? 0 : 1));
      if (prev.length) {
        const x = prev[0], g = Math.round((new Date(x.attesa + 'T12:00:00') - new Date(iso_(new Date()) + 'T12:00:00')) / 864e5);
        return { testo: 'Bollette da pagare adesso non ne hai. La prossima dovrebbe essere ' + x.tipo + ' ' + x.chi + ', che arriva circa ogni ' + x.ogni + ' giorni: ' +
          (g < -5 ? 'era attesa verso il ' + data_(x.attesa) + ', quindi dovrebbe arrivare a giorni.' : g <= 5 ? 'dovrebbe arrivare in questi giorni.' : 'me la aspetto verso il ' + data_(x.attesa) + '.') };
      }
      return { testo: 'Bollette da pagare adesso non ne hai, e ne ho ancora troppo poche per capire ogni quanto arrivano.' };
    }
    let lista = filtra_(aperte, c);
    if (c.mesi.length) {
      const m = c.mesi[0];
      const nelMese = lista.filter(p => p.scadenza && +p.scadenza.slice(5, 7) === m + 1);
      if (!nelMese.length) return { testo: cap_(aMese_(m)) + ' non scade niente' + (c.tipo || c.chi || c.ass ? ' ' + etichetta : '') + '.' + (lista.length ? ' La prossima scadenza è ' + descr_(lista[0]) + '.' : '') };
      lista = nelMese;
    }
    if (lista.length) return { testo: (lista.length === 1 ? 'Scade: ' : 'Prossime scadenze: ') + lista.slice(0, 5).map(descr_).join('; ') + '.' };
    if (c.ass) {
      const prev = P.filter(p => p.area === 'assicurazioni' && p.prossima && p.prossima >= iso_(new Date())).sort((a, b) => a.prossima.localeCompare(b.prossima));
      if (prev.length) return { testo: 'Non ci sono rate aperte. La prossima prevista è ' + prev[0].tipo + ' ' + prev[0].chi + ' intorno al ' + data_(prev[0].prossima) + '.' };
    }
    return { testo: 'Non ci sono scadenze aperte' + (c.tipo || c.chi || c.ass ? ' per ' + (c.chi || c.tipo || 'le assicurazioni') : '') + '.' };
  }
  if (/devo pagare|da pagare|in sospeso|pagamenti|cosa (devo|c e da)/.test(t)) {
    const soloB = /bollett/.test(t) && !c.ass;
    const lista = filtra_(aperte, c).filter(p => !soloB || p.area === 'bollette');
    if (!lista.length) {
      const altro = soloB ? aperte : [];
      return { testo: (soloB ? 'Nessuna bolletta da pagare.' : 'Non hai nulla da pagare in questo momento.') + (altro.length ? ' C\'è però ' + descr_(altro[0]) + '.' : '') };
    }
    const tot = somma(lista);
    return { testo: 'Da pagare: ' + lista.slice(0, 6).map(descr_).join('; ') + '.' + (lista.length > 6 ? ' E altre ' + (lista.length - 6) + '.' : '') +
      (lista.length > 1 ? ' In tutto ' + eur_(tot) + '.' : ''),
      seguito: 'quanto manca', proposta: aCaso_(['Vuoi sapere quanti giorni mancano alla prima?', 'Ti dico quanto manca alla prima scadenza?']) };
  }

  // la più cara / la più economica
  if (/piu car[ao]|piu costos[ao]|piu alt[ao]|la peggiore|piu economic[ao]|piu bass[ao]|meno car[ao]/.test(t)) {
    const del = filtra_(P.filter(p => p.importo !== null), c, { soloBollette: !c.ass }).filter(p => p.rif.slice(0, 4) === c.anno);
    if (!del.length) return { testo: 'Non ho documenti ' + etichetta + ' nel ' + c.anno + '.' };
    const basso = /economic|bass|meno car/.test(t);
    const p = del.slice().sort((a, b) => basso ? a.importo - b.importo : b.importo - a.importo)[0];
    const cosa = (c.ass ? 'La rata' : 'La bolletta') + (basso ? ' più economica' : ' più cara') + (c.tipo ? ' di ' + c.tipo.toLowerCase() : c.chi ? ' di ' + c.chi : '');
    return { testo: cosa + ' del ' + c.anno + ' è ' + p.tipo + ' ' + p.chi + ' del ' + data_(p.rif) + ': ' + eur_(p.importo) + '.' };
  }

  // confronti
  const base = filtra_(P.filter(p => p.importo !== null), c, { soloBollette: true });
  if (c.tipi.length >= 2 && /piu|meno|o di|oppure|confront|rispetto/.test(t)) {
    const del = P.filter(p => p.importo !== null && p.area === 'bollette' && p.rif.slice(0, 4) === c.anno);
    const per = {}; del.forEach(p => { per[p.tipo] = (per[p.tipo] || 0) + p.importo; });
    const voci = Object.keys(per).sort((a, b) => per[b] - per[a]);
    if (!voci.length) return { testo: 'Non ho bollette nel ' + c.anno + ' da confrontare.' };
    return { testo: 'Nel ' + c.anno + ': ' + voci.map(v => v.toLowerCase() + ' ' + eur_(per[v])).join(', ') + '. La voce più pesante è ' + voci[0].toLowerCase() + '.' +
      (voci.some(v => / e /.test(v)) ? ' Le bollette luce e gas arrivano insieme, quindi non posso dividerle.' : '') };
  }
  if (c.mesi.length >= 2 || /confront\w*|rispetto|aumentat\w*|diminuit\w*|cresciut\w*|calat\w*|differenza|di piu|di meno/.test(t)) {
    if (c.mesi.length >= 2) {
      const [m1, m2] = c.mesi;
      const s = m => somma(base.filter(p => p.rif.slice(0, 4) === c.anno && +p.rif.slice(5, 7) === m + 1));
      const a = s(m1), b = s(m2), d = b - a;
      return { testo: 'Spesa ' + etichetta + ': ' + NOMI_MESI[m1] + ' ' + eur_(a) + ', ' + NOMI_MESI[m2] + ' ' + eur_(b) + '. ' +
        (a === 0 && b === 0 ? 'Nessuna spesa in entrambi i mesi.' : a === 0 ? cap_(aMese_(m1)) + ' non era arrivato niente.' : b === 0 ? cap_(aMese_(m2)) + ' non era arrivato niente.' : d === 0 ? 'Identica.' : (d > 0 ? 'Più alta di ' : 'Più bassa di ') + eur_(Math.abs(d)) + (a ? ' (' + (d > 0 ? '+' : '') + Math.round(d / a * 100) + '%).' : '.')) };
    }
    const docs = base.slice().sort((x, y) => y.rif.localeCompare(x.rif));
    if (docs.length < 2) return { testo: 'Mi servono almeno due documenti ' + etichetta + ' per fare un confronto.' };
    // confronto "alla pari": stesso fornitore dell'ultimo documento
    const ult = docs[0];
    const prec = docs.slice(1).find(p => p.chi === ult.chi && p.tipo === ult.tipo) || docs[1];
    const d = ult.importo - prec.importo;
    return { testo: 'Ultimo documento ' + etichetta + ': ' + eur_(ult.importo) + ' (' + ult.chi + ', ' + data_(ult.rif) + '); quello prima: ' + eur_(prec.importo) + ' (' + data_(prec.rif) + '). ' +
      (d === 0 ? 'Stesso importo.' : (d > 0 ? 'È aumentato di ' : 'È diminuito di ') + eur_(Math.abs(d)) + ' (' + (d > 0 ? '+' : '') + Math.round(d / prec.importo * 100) + '%).') };
  }

  if (/quant[ei] (bollette|assicurazioni|polizze|pratiche|rate)|elenc\w*|lista|dimmi (le|tutte)|fammi vedere/.test(t)) {
    const lista = filtra_(P, c, { soloBollette: !c.ass }).filter(p => p.rif.slice(0, 4) === c.anno);
    if (!lista.length) return { testo: 'Non trovo documenti ' + etichetta + ' nel ' + c.anno + '.' };
    const nome = c.ass ? (lista.length === 1 ? ' pratica di assicurazione' : ' pratiche di assicurazione') : (lista.length === 1 ? ' bolletta' : ' bollette') + (c.tipo || c.chi ? ' ' + etichetta : '');
    return { testo: 'Nel ' + c.anno + ' hai ' + lista.length + nome + ': ' +
      lista.slice(0, 5).map(p => p.tipo + ' ' + p.chi + ' del ' + data_(p.rif).slice(0, 5) + ', ' + eur_(p.importo)).join('; ') + (lista.length > 5 ? '; e altri ' + (lista.length - 5) : '') + '.' };
  }

  if (/\bultim[aoie]\b/.test(t)) {
    const lista = filtra_(P, c, { soloBollette: !c.ass });
    if (!lista.length) return { testo: 'Non trovo documenti ' + etichetta + ' dal ' + CONFIG.ANNO_INIZIO + '.' };
    const u = lista[0];
    return { testo: 'L\'ultima è ' + descr_(u) + (u.emissione ? ', emessa il ' + data_(u.emissione) : '') + '. Stato: ' + String(u.stato).toLowerCase() + '.' };
  }

  if (/media|al mese|mensil\w*|ogni mese/.test(t)) {
    const del = base.filter(p => p.rif.slice(0, 4) === c.anno);
    const mesi = c.anno === String(new Date().getFullYear()) ? new Date().getMonth() + 1 : 12;
    const mistoM = c.tipo && del.some(p => p.tipo !== c.tipo);
    return { testo: 'Media mensile ' + etichetta + ' nel ' + c.anno + ': ' + eur_(somma(del) / mesi) + ' (' + eur_(somma(del)) + ' in ' + mesi + ' mesi' + (mistoM ? ', comprese le bollette luce e gas insieme' : '') + ').' };
  }

  if (c.ass && /quali|che assicurazioni|elenco|ho assicurat/.test(t) && !c.chi && !c.ramo) {
    const viste = {}, pol = [];
    P.filter(p => p.area === 'assicurazioni').forEach(p => { const k = p.tipo + '|' + p.chi; if (!viste[k]) { viste[k] = 1; pol.push(p); } });
    return { testo: 'Hai ' + pol.length + (pol.length === 1 ? ' assicurazione: ' : ' assicurazioni: ') + pol.map(p => p.tipo + ' ' + p.chi + ', ' + eur_(p.importo) +
      (p.stato === STATO.DA_PAGARE || p.stato === STATO.SCADUTA ? ', da pagare entro il ' + data_(p.scadenza) : p.prossima ? ', prossima rata verso il ' + data_(p.prossima) : '')).join('; ') + '.' };
  }
  if (c.ass && !/quanto|spes|costo|totale/.test(t)) {
    const A = filtra_(P.filter(p => p.area === 'assicurazioni'), c);
    const anno0 = A.filter(p => p.rif.slice(0, 4) === c.anno);
    const prossime = A.filter(p => p.prossima && p.prossima >= iso_(new Date())).sort((a, b) => a.prossima.localeCompare(b.prossima));
    return { testo: 'Assicurazioni ' + c.anno + ': ' + eur_(somma(anno0)) + ' in ' + anno0.length + (anno0.length === 1 ? ' pratica' : ' pratiche') +
      (prossime.length ? '. Prossima rata prevista: ' + prossime[0].tipo + ' ' + prossime[0].chi + ' il ' + data_(prossime[0].prossima) : '') + '.' };
  }

  if (/quanto|spes[aoi]|speso|pagato|costo|costat\w*|totale|ho dato/.test(t) || c.tipo || c.chi) {
    const tutto = /tutto|in totale|complessiv\w*|in tutto/.test(t) && !c.tipo && !c.chi && !c.ass;
    const del = (tutto ? P.filter(p => p.importo !== null) : base).filter(p => p.rif.slice(0, 4) === c.anno &&
      (!c.mesi.length || +p.rif.slice(5, 7) === c.mesi[0] + 1));
    const quando = (c.mesi.length ? aMese_(c.mesi[0]) + ' ' : 'nel ') + c.anno;
    const misto = c.tipo && del.some(p => p.tipo !== c.tipo);
    if (!del.length) return { testo: cap_(quando) + ' non ho documenti ' + (tutto ? '' : etichetta) + '.' };
    const doc = n => n + (n === 1 ? ' documento' : ' documenti');
    let testo;
    if (tutto) {
      const sb = somma(del.filter(p => p.area === 'bollette')), sa = somma(del.filter(p => p.area === 'assicurazioni'));
      testo = 'Hai speso ' + eur_(somma(del)) + ' in totale ' + quando + ': ' + eur_(sb) + ' di bollette e ' + eur_(sa) + ' di assicurazioni.';
    } else if (misto) {
      const puri = del.filter(p => p.tipo === c.tipo), insieme = del.filter(p => p.tipo !== c.tipo);
      testo = puri.length
        ? 'Hai speso ' + eur_(somma(puri)) + ' di solo ' + c.tipo.toLowerCase() + ' ' + quando + ' (' + doc(puri.length) + '), più ' + eur_(somma(insieme)) + ' di bollette ' + insieme[0].tipo.toLowerCase() + ' insieme: in tutto ' + eur_(somma(del)) + '.'
        : 'Bollette di sola ' + c.tipo.toLowerCase() + ' non ne hai: ' + quando + ' ti arriva insieme in ' + insieme[0].tipo.toLowerCase() + ', ' + eur_(somma(insieme)) + ' (' + doc(insieme.length) + ').';
    } else testo = 'Hai speso ' + eur_(somma(del)) + ' ' + etichetta + ' ' + quando + ' (' + doc(del.length) + ').';
    const out = { testo: testo };
    const chiave = c.chi ? c.chi : c.tipo ? c.tipo.toLowerCase() : c.ass ? 'assicurazioni' : 'bollette';
    if (c.mesi.length && c.mesi[0] > 0) {
      out.seguito = 'confronta ' + NOMI_MESI[c.mesi[0] - 1] + ' e ' + NOMI_MESI[c.mesi[0]] + ' ' + chiave;
      out.proposta = aCaso_(['Vuoi che lo confronti con ' + NOMI_MESI[c.mesi[0] - 1] + '?', 'Ti faccio il confronto con ' + NOMI_MESI[c.mesi[0] - 1] + '?']);
    } else if (!c.mesi.length && !tutto) {
      out.seguito = 'media di ' + chiave + ' ' + c.anno;
      out.proposta = aCaso_(['Vuoi sapere quanto fa al mese?', 'Ti dico anche la media mensile?']);
    }
    return out;
  }
  return null;
}

/**
 * EDITH – riepilogo settimanale, avvisi via mail e briefing del mattino.
 * Dopo aver incollato il codice lancia una volta installaNovita (oppure setup).
 * Le mail partono solo verso il tuo indirizzo, dal tuo account. Nessun servizio esterno.
 */

// L'indirizzo del proprietario, letto dal profilo Gmail (non serve un'autorizzazione in più)
function mioIndirizzo_() { return Gmail.Users.getProfile('me').emailAddress; }

/** Manda un avviso a te stesso, al massimo uno ogni 6 ore per lo stesso motivo. */
function notifica_(oggetto, righe, chiave) {
  try {
    const props = PropertiesService.getScriptProperties();
    const k = 'AVVISO_' + (chiave || oggetto).replace(/\W+/g, '_').slice(0, 60);
    const ultimo = Number(props.getProperty(k) || 0);
    if (Date.now() - ultimo < 6 * 3600e3) return false;
    const testo = [].concat(righe).join('\n');
    const html = '<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5">' +
      [].concat(righe).map(r => '<p style="margin:0 0 8px">' + escHtml_(r) + '</p>').join('') +
      '<p style="color:#888;font-size:12px">Messaggio automatico di EDITH.</p></div>';
    GmailApp.sendEmail(mioIndirizzo_(), '[EDITH] ' + oggetto, testo, { htmlBody: html, name: 'EDITH' });
    props.setProperty(k, String(Date.now()));
    return true;
  } catch (e) { log_('Avviso non inviato', oggetto + ' -> ' + e.message); return false; }
}

function escHtml_(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

/** Chiave stabile di una pratica, per capire quali sono nuove. */
function chiavePratica_(p) { return p.foglio + '#' + p.riga; }

/** Dopo un'elaborazione: avvisa se ci sono nuove pratiche che non sono riuscita a leggere bene. */
function avvisaNuoveDaVerificare_(prima) {
  const visti = {};
  prima.forEach(p => { visti[chiavePratica_(p)] = p.stato; });
  const nuove = pratiche_().filter(p => p.stato === STATO.DA_VERIFICARE && visti[chiavePratica_(p)] !== STATO.DA_VERIFICARE);
  if (!nuove.length) return;
  notifica_(nuove.length === 1 ? 'Una pratica da controllare' : nuove.length + ' pratiche da controllare',
    ['Non sono riuscita a leggere tutti i dati di ' + (nuove.length === 1 ? 'questa pratica' : 'queste pratiche') + ':']
      .concat(nuove.map(p => '• ' + p.tipo + (p.chi ? ' ' + p.chi : '') + ' – ' + (p.oggetto || 'senza oggetto') + (p.link ? ' – ' + p.link : '')))
      .concat(['Completa i campi mancanti nello Sheet: il promemoria si crea da solo.']),
    'daverificare_' + nuove.map(chiavePratica_).join('_'));
}

// ---------------------------------------------------------------- riepilogo del lunedì

function testoRiepilogo_() {
  const P = pratiche_();
  const oggi = iso_(new Date()), tra7 = iso_(new Date(Date.now() + 7 * 864e5));
  const aperte = P.filter(p => p.stato === STATO.DA_PAGARE || p.stato === STATO.SCADUTA);
  const settimana = aperte.filter(p => p.scadenza && p.scadenza <= tra7).sort((a, b) => a.scadenza.localeCompare(b.scadenza));
  const dopo = aperte.filter(p => !p.scadenza || p.scadenza > tra7);
  const verifica = P.filter(p => p.stato === STATO.DA_VERIFICARE);
  const r = ['Buon lunedì, Teo. Ecco la tua settimana.'];
  r.push(settimana.length ? 'Da pagare entro ' + data_(tra7) + ':' : 'Nessun pagamento in scadenza nei prossimi 7 giorni.');
  settimana.forEach(p => r.push('• ' + descr_(p) + (p.scadenza < oggi ? ' – GIÀ SCADUTA' : '')));
  if (dopo.length) r.push('Più avanti: ' + dopo.map(descr_).join('; ') + '.');
  if (verifica.length) {
    r.push('Da controllare nello Sheet (' + verifica.length + '):');
    verifica.forEach(p => r.push('• ' + p.tipo + (p.chi ? ' ' + p.chi : '') + ' – ' + (p.oggetto || '') + (p.link ? ' – ' + p.link : '')));
  }
  try { const an = anomalie_(P); if (an.length) { r.push('Anomalie:'); an.forEach(x => r.push('• ' + x.testo)); } } catch (e) { }
  const s = quota_();
  if (s) r.push('Spazio Google: ' + s.usato + ' GB su ' + s.limite + ' GB (' + Math.round(s.usato / s.limite * 100) + '%).');
  return { righe: r, settimana, verifica };
}

/** Trigger del lunedì mattina. */
function riepilogoSettimanale() {
  try {
    const t = testoRiepilogo_();
    const ogg = t.settimana.length ? t.settimana.length + (t.settimana.length === 1 ? ' pagamento' : ' pagamenti') + ' questa settimana' : 'Settimana tranquilla';
    PropertiesService.getScriptProperties().deleteProperty('AVVISO_riepilogo');
    notifica_(ogg + (t.verifica.length ? ', ' + t.verifica.length + ' da controllare' : ''), t.righe, 'riepilogo');
  } catch (e) {
    notifica_('Errore nel riepilogo settimanale', ['Il riepilogo del lunedì non è partito: ' + e.message], 'errore_riepilogo');
  }
}

// ---------------------------------------------------------------- briefing del mattino

function briefing_(P) {
  const oggi = new Date(), tra7 = iso_(new Date(Date.now() + 7 * 864e5));
  const giorni = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
  const aperte = P.filter(p => p.stato === STATO.DA_PAGARE || p.stato === STATO.SCADUTA)
    .sort((a, b) => (a.scadenza || '9999').localeCompare(b.scadenza || '9999'));
  const vicine = aperte.filter(p => p.scadenza && p.scadenza <= tra7);
  const verifica = P.filter(p => p.stato === STATO.DA_VERIFICARE).length;
  let t = 'Oggi è ' + giorni[oggi.getDay()] + ' ' + oggi.getDate() + ' ' + NOMI_MESI[oggi.getMonth()] + '. ';
  if (vicine.length) t += 'In settimana scade ' + vicine.map(p => p.tipo + (p.chi ? ' ' + p.chi : '') + ' da ' + eur_(p.importo) + ' il ' + data_(p.scadenza).slice(0, 5)).join(', e ') + '. ';
  else if (aperte.length) t += 'Niente in scadenza questa settimana; il prossimo pagamento è ' + descr_(aperte[0]) + '. ';
  else t += 'Non hai pagamenti in sospeso. ';
  if (verifica) t += verifica === 1 ? 'C\'è una pratica da controllare. ' : 'Ci sono ' + verifica + ' pratiche da controllare. ';
  try {
    const gravi = anomalie_(P).filter(a => a.livello !== 'basso' && !/scaduta da/.test(a.testo));
    if (gravi.length) t += 'Attenzione: ' + minuscola_(gravi[0].testo) + (gravi.length > 1 ? ' E c\'è ' + (gravi.length === 2 ? 'un\'altra cosa' : 'altro') + ': chiedimi "ci sono anomalie?".' : '') + ' ';
  } catch (e) { }
  return t.trim();
}

/** Il primo "Edith, sono io" della mattina dà il briefing completo, poi solo il saluto. */
function primoDelGiorno_() {
  const props = PropertiesService.getScriptProperties(), oggi = iso_(new Date());
  if (props.getProperty('ULTIMO_BRIEFING') === oggi) return false;
  props.setProperty('ULTIMO_BRIEFING', oggi);
  return true;
}

// ---------------------------------------------------------------- installazione

/** Lancia una volta dopo aver incollato il nuovo codice: aggiunge il trigger del lunedì. */
function installaNovita() {
  const esiste = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'riepilogoSettimanale');
  if (!esiste) ScriptApp.newTrigger('riepilogoSettimanale').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(8).create();
  PropertiesService.getScriptProperties().deleteProperty('AVVISO_installazione');
  const ok = notifica_('Avvisi attivi', ['Da ora ti scrivo qui se qualcosa va storto o se non riesco a leggere una bolletta, e ogni lunedì alle 8 ti mando il riepilogo della settimana.'], 'installazione');
  Logger.log(ok ? 'Fatto: riepilogo ogni lunedì alle 8 e avvisi via mail attivi. Ti ho mandato una mail di prova.' : 'Trigger installato, ma la mail di prova NON è partita: guarda il foglio LOG.');
}

// ---------------------------------------------------------------- skill: controllo anomalie

/**
 * Cerca cose strane nei dati e nel sistema. Ogni anomalia: { livello: 'alto'|'medio'|'basso', testo }.
 * Non cambia niente: segnala soltanto.
 */
function anomalie_(P) {
  P = P || pratiche_();
  const out = [], oggi = iso_(new Date());
  const giorniDa = s => Math.round((new Date(oggi + 'T12:00:00') - new Date(s + 'T12:00:00')) / 864e5);
  const nome = p => p.tipo + (p.chi ? ' ' + p.chi : '');

  // 1. pagamenti scaduti e non segnati
  P.filter(p => (p.stato === STATO.DA_PAGARE || p.stato === STATO.SCADUTA) && p.scadenza && p.scadenza < oggi)
    .forEach(p => out.push({ livello: 'alto', testo: nome(p) + ' da ' + eur_(p.importo) + ' è scaduta da ' + giorniDa(p.scadenza) + ' giorni e non risulta pagata.' }));

  // 2. bollette molto più care del solito (stesso fornitore e tipo, almeno 2 precedenti)
  const B = P.filter(p => p.area === 'bollette' && p.importo !== null && p.rif);
  const gruppi = {};
  B.forEach(p => { const k = p.tipo + '|' + p.chi; (gruppi[k] = gruppi[k] || []).push(p); });
  Object.keys(gruppi).forEach(k => {
    const g = gruppi[k].sort((a, b) => b.rif.localeCompare(a.rif));
    if (g.length < 3) return;
    const ult = g[0], media = g.slice(1).reduce((s, p) => s + p.importo, 0) / (g.length - 1);
    if (media > 0 && ult.importo > media * 1.4 && ult.importo - media > 15)
      out.push({ livello: 'medio', testo: 'L\'ultima bolletta ' + nome(ult) + ' (' + eur_(ult.importo) + ') è il ' + Math.round((ult.importo / media - 1) * 100) + '% sopra la tua media di ' + eur_(media) + '.' });
  });

  // 3. fornitori che non mandano bollette da tanto
  const fornitori = {};
  B.forEach(p => { if (!fornitori[p.chi] || p.rif > fornitori[p.chi]) fornitori[p.chi] = p.rif; });
  Object.keys(fornitori).forEach(chi => {
    const g = giorniDa(fornitori[chi]);
    if (chi && g > 75) out.push({ livello: 'medio', testo: 'Da ' + chi + ' non arriva una bolletta da ' + g + ' giorni (l\'ultima è del ' + data_(fornitori[chi]) + '). Controlla che la mail non sia finita altrove o che l\'etichetta "bollettazione" sia applicata.' });
  });

  // 4. rate di assicurazione previste e mai arrivate
  const A = P.filter(p => p.area === 'assicurazioni');
  A.filter(p => p.prossima && p.prossima < oggi && giorniDa(p.prossima) > 7).forEach(p => {
    const arrivata = A.some(x => x !== p && x.chi === p.chi && (x.scadenza || x.rif) >= p.prossima.slice(0, 7));
    if (!arrivata) out.push({ livello: 'medio', testo: 'Era prevista una rata ' + nome(p) + ' intorno al ' + data_(p.prossima) + ', ma non ho trovato la mail.' });
  });

  // 5. pratiche lette male
  const ver = P.filter(p => p.stato === STATO.DA_VERIFICARE);
  if (ver.length) out.push({ livello: 'basso', testo: (ver.length === 1 ? 'Una pratica non è stata letta del tutto' : ver.length + ' pratiche non sono state lette del tutto') + ': ' + ver.slice(0, 3).map(p => p.oggetto || nome(p)).join('; ') + '.' });

  // 6. doppioni tolti dal conteggio
  // offerte: condizioni economiche in scadenza (dopo, di solito, il prezzo cambia)
  offerte_().filter(o => o.scadenza).forEach(o => {
    const g = -giorniDa(o.scadenza);
    if (g < 0 && g > -120) out.push({ livello: 'medio', testo: 'Le condizioni economiche dell\'offerta ' + o.chi + (o.offerta ? ' "' + o.offerta + '"' : '') + ' sono scadute il ' + data_(o.scadenza) + ': controlla il nuovo prezzo nella prossima bolletta.' });
    else if (g >= 0 && g <= 60) out.push({ livello: 'medio', testo: 'Le condizioni economiche dell\'offerta ' + o.chi + (o.offerta ? ' "' + o.offerta + '"' : '') + ' scadono il ' + data_(o.scadenza) + ', tra ' + g + ' giorni: è il momento di confrontare le offerte.' });
  });
  if (DOPPIONI_ > 0) out.push({ livello: 'basso', testo: 'Nello Sheet ' + (DOPPIONI_ === 1 ? 'c\'è 1 riga doppia' : 'ci sono ' + DOPPIONI_ + ' righe doppie') + ' (per esempio mail inoltrate con "Fwd:"). Non le conto due volte, ma puoi cancellarle.' });

  // 7. il controllo automatico è fermo?
  try {
    const props = PropertiesService.getScriptProperties();
    const ultimo = Number(props.getProperty('ULTIMO_CONTROLLO') || 0);
    const trigger = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'elaboraTutto');
    if (!trigger) out.push({ livello: 'alto', testo: 'Il controllo automatico della posta non è attivo. In Apps Script lancia setup per riattivarlo.' });
    else if (ultimo && Date.now() - ultimo > 3 * 3600e3) out.push({ livello: 'alto', testo: 'L\'ultimo controllo automatico della posta è di ' + Math.round((Date.now() - ultimo) / 3600e3) + ' ore fa: dovrebbe girare ogni ora.' });
  } catch (e) { }

  // 8. spazio quasi pieno
  const s = quota_();
  if (s && s.limite && s.usato / s.limite > 0.85) out.push({ livello: 'medio', testo: 'Lo spazio Google è al ' + Math.round(s.usato / s.limite * 100) + '%: nella sezione Posta trovi cosa liberare.' });

  const ordine = { alto: 0, medio: 1, basso: 2 };
  return out.sort((a, b) => ordine[a.livello] - ordine[b.livello]);
}

function testoAnomalie_(P) {
  const a = anomalie_(P);
  if (!a.length) return 'Ho controllato tutto: nessuna anomalia. Pagamenti, bollette, rate e controllo automatico sono in ordine.';
  return (a.length === 1 ? 'Ho trovato una cosa da guardare: ' + minuscola_(a[0].testo) : 'Ho trovato ' + a.length + ' cose da guardare. ' + a.map((x, i) => (i + 1) + ') ' + x.testo).join(' '));
}

function minuscola_(s) { return /^[A-Z](?![A-Z])/.test(s) && !/^(AXA|Sara|SOMET|Piemonte)/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s; }

/**
 * EDITH – sicurezza dell'app sul telefono.
 * - Il token dura 90 giorni. Dopo 30 giorni di uso l'app ne riceve uno nuovo da sola, senza che tu faccia niente;
 *   il vecchio resta valido ancora 7 giorni, così un secondo telefono non resta bloccato all'improvviso.
 * - Se non apri l'app per più di 90 giorni il token scade: rilancia creaTokenVoce e reinseriscilo.
 * - Ogni accesso finisce nel foglio ACCESSI. Se qualcuno sbaglia il token 5 volte in un'ora ti arriva una mail.
 */

const TOKEN_DURATA_GG = 90, TOKEN_RINNOVO_GG = 30, TOKEN_GRAZIA_GG = 7;

function nuovoToken_() { return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8); }

/** Lancia una volta (o per bloccare un telefono perso): crea un token nuovo e annulla tutti i precedenti. */
function creaTokenVoce() {
  const props = PropertiesService.getScriptProperties();
  const token = nuovoToken_();
  props.setProperties({ EDITH_TOKEN: token, EDITH_TOKEN_DATA: String(Date.now()) });
  props.deleteProperty('EDITH_TOKEN_VECCHIO'); props.deleteProperty('EDITH_TOKEN_VECCHIO_FINO');
  registraAccesso_('creaTokenVoce', 'nuovo token creato, i precedenti non valgono più');
  Logger.log('Token creato. Copialo: ' + token);
  Logger.log('Incollalo nell\'app (ingranaggio › Collegamento) insieme all\'URL del deployment Voce.');
  Logger.log('Dura 90 giorni e si rinnova da solo ogni 30 giorni mentre usi l\'app.');
  return token;
}

/**
 * Controlla il token. Risponde { ok, nuovo?, motivo? }.
 * "nuovo" è il token che l'app deve salvare al posto di quello vecchio.
 */
function verificaToken_(k) {
  const props = PropertiesService.getScriptProperties();
  const p = props.getProperties();
  const ora = Date.now(), gg = 864e5;
  if (!p.EDITH_TOKEN || !k) return { ok: false, motivo: 'token mancante' };
  if (uguali_(k, p.EDITH_TOKEN)) {
    let data = Number(p.EDITH_TOKEN_DATA || 0);
    if (!data) { data = ora; props.setProperty('EDITH_TOKEN_DATA', String(ora)); }   // token creato prima di questa versione
    if (ora - data > TOKEN_DURATA_GG * gg) return { ok: false, motivo: 'token scaduto' };
    if (ora - data > TOKEN_RINNOVO_GG * gg) {
      const lock = LockService.getScriptLock();
      if (lock.tryLock(3000)) {
        try {
          const fresco = props.getProperty('EDITH_TOKEN');
          if (fresco !== p.EDITH_TOKEN) return { ok: true, nuovo: fresco };   // l'ha già rinnovato un'altra richiesta
          const nuovo = nuovoToken_();
          props.setProperties({ EDITH_TOKEN: nuovo, EDITH_TOKEN_DATA: String(ora), EDITH_TOKEN_VECCHIO: p.EDITH_TOKEN, EDITH_TOKEN_VECCHIO_FINO: String(ora + TOKEN_GRAZIA_GG * gg) });
          registraAccesso_('rinnovo', 'token rinnovato automaticamente');
          return { ok: true, nuovo };
        } finally { lock.releaseLock(); }
      }
    }
    return { ok: true };
  }
  if (p.EDITH_TOKEN_VECCHIO && uguali_(k, p.EDITH_TOKEN_VECCHIO) && ora < Number(p.EDITH_TOKEN_VECCHIO_FINO || 0)) return { ok: true, nuovo: p.EDITH_TOKEN };
  return { ok: false, motivo: 'token errato' };
}

/** Registro accessi nel foglio ACCESSI (tiene le ultime 1000 righe). */
function registraAccesso_(funzione, esito) {
  try {
    const sh = sheet_(CONFIG.SHEET_ACCESSI);
    if (sh.getLastRow() === 0) sh.appendRow(['QUANDO', 'FUNZIONE', 'ESITO']);
    sh.appendRow([new Date(), funzione, esito]);
    if (sh.getLastRow() > 1000) sh.deleteRows(2, 200);
  } catch (e) { }
}

/** Conta i tentativi falliti: al quinto nella stessa ora manda un avviso. */
function tentativoFallito_(motivo) {
  registraAccesso_('accesso', 'RIFIUTATO: ' + motivo);
  try {
    const props = PropertiesService.getScriptProperties();
    const ora = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyyMMddHH');
    const [h, n] = String(props.getProperty('FALLITI') || '').split(':');
    const conta = h === ora ? Number(n || 0) + 1 : 1;
    props.setProperty('FALLITI', ora + ':' + conta);
    if (conta === 5) notifica_('Tentativi di accesso falliti', ['Nell\'ultima ora qualcuno ha provato 5 volte ad aprire EDITH con un token sbagliato (' + motivo + ').',
      'Se non eri tu, lancia creaTokenVoce in Apps Script: il token cambia e chi ce l\'ha resta fuori. Il registro è nel foglio ACCESSI.'], 'falliti_' + ora);
  } catch (e) { }
}

/**
 * EDITH – l'offerta in corso per ogni fornitura, letta dalle bollette.
 * Le bollette italiane hanno un riquadro con nome dell'offerta, prezzo, quota fissa e scadenza delle condizioni:
 * qui lo leggo dal testo dell'OCR e tengo nel foglio OFFERTE una riga per fornitore e fornitura, aggiornata con l'ultima bolletta.
 */

const COLONNE_OFFERTE = ['FORNITORE', 'FORNITURA', 'OFFERTA', 'MERCATO', 'TIPO PREZZO', 'PREZZO LUCE €/KWH', 'PREZZO GAS €/SMC',
  'QUOTA FISSA €/MESE', 'POTENZA KW', 'SCADENZA CONDIZIONI', 'CONSUMO ANNUO LUCE KWH', 'CONSUMO ANNUO GAS SMC', 'POD', 'PDR',
  'DA BOLLETTA DEL', 'LINK MAIL', 'AGGIORNATO'];

/** Numero all'italiana con decimali ("0,123456" o "1.234") → Number. */
function num_(s) {
  if (s === undefined || s === null) return null;
  let t = String(s).replace(/\s/g, '');
  if (/,/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  const n = parseFloat(t);
  return isNaN(n) ? null : n;
}

/** Prezzo unitario vicino a un'unità di misura: "0,1234 €/kWh", "€/kWh 0,1234", "0,1234 euro/kWh". */
function prezzoUnitario_(t, unita, min, max) {
  const u = '(?:€|euro|eur)\\s*\\/\\s*' + unita;
  const pattern = [
    new RegExp('(\\d+[,.]\\d{2,6})\\s*' + u, 'gi'),
    new RegExp(u + '\\s*:?\\s*(\\d+[,.]\\d{2,6})', 'gi'),
  ];
  // preferisco i valori vicini a "prezzo", "componente energia", "materia"
  const cand = [];
  pattern.forEach(re => {
    let m;
    while ((m = re.exec(t)) !== null) {
      const v = num_(m[1]);
      if (v === null || v < min || v > max) continue;
      const prima = t.slice(Math.max(0, m.index - 120), m.index).toLowerCase();
      const peso = /prezzo|componente energia|materia (prima|energia|gas)|costo (dell )?energia|spesa per la materia|\bpe\b|\bf0\b|monorari|cmem|prezzo gas/.test(prima) ? 2
        : /trasporto|oneri|accise|iva|distribuzione|perequazione|imposte/.test(prima) ? -1 : 0;
      cand.push({ v: v, peso: peso, pos: m.index });
    }
  });
  if (!cand.length) return null;
  cand.sort((a, b) => b.peso - a.peso || a.pos - b.pos);
  return cand[0].peso < 0 ? null : cand[0].v;
}

/** Dopo una delle parole chiave, il primo testo "nome" (per il nome dell'offerta). */
function nomeOfferta_(t) {
  const re = /(?:nome (?:dell[' ]?)?offerta|denominazione (?:dell[' ]?)?offerta|offerta commerciale|nome (?:del )?prodotto|offerta sottoscritta|la tua offerta|offerta)\s*[:\-]\s*([^\n]{3,60})/i;
  const m = t.match(re);
  if (!m) return '';
  return m[1].replace(/\s*(codice|cod\.|offerta n|valid|mercato|prezzo|scadenza).*$/i, '').replace(/[.;,]+$/, '').trim();
}

/** Estrae i dettagli dell'offerta dal testo di una bolletta. Restituisce null se non trova niente di utile. */
function estraiOfferta_(testo) {
  const t = String(testo || '').replace(/ /g, ' ').replace(/[ \t]+/g, ' ');
  const low = t.toLowerCase();
  const o = {};
  o.offerta = nomeOfferta_(t);
  o.mercato = /servizio di tutela|maggior tutela|tutela della vulnerabilita|tutela vulnerabil/.test(low) ? 'Tutela'
    : /tutele graduali|\bstg\b/.test(low) ? 'Tutele graduali' : /mercato libero/.test(low) ? 'Libero' : '';
  const indicizzato = /\bpun\b|\bpsv\b|indicizzat|variabile|spread|\bttf\b/.test(low);
  const fisso = /prezzo fisso|fisso per|bloccato|invariabile|prezzo fisso e invariabile/.test(low);
  o.tipoPrezzo = fisso && !/\bpun\b.*\+|spread/.test(low) ? 'Fisso' : indicizzato ? (/\bpun\b/.test(low) ? 'Variabile (PUN)' : /\bpsv\b/.test(low) ? 'Variabile (PSV)' : 'Variabile') : '';
  o.prezzoLuce = prezzoUnitario_(t, 'kwh', 0.03, 1.5);
  o.prezzoGas = prezzoUnitario_(t, 'smc', 0.1, 5);
  const qf = t.match(/(?:quota fissa|costo fisso|commercializzazione|corrispettivo fisso|canone)[^\n€]{0,80}?(?:€\s*|euro\s*)?(\d+[,.]\d{2,4})\s*(?:€|euro)?\s*\/\s*(mese|anno)/i)
    || t.match(/(?:quota fissa|costo fisso|commercializzazione|corrispettivo fisso)[^\n]{0,60}?(?:€|euro)\s*\/\s*(?:pdp\s*\/\s*)?(mese|anno)\s*:?\s*(\d+[,.]\d{2,4})/i);
  if (qf) {
    const [val, per] = /\d/.test(qf[1]) ? [qf[1], qf[2]] : [qf[2], qf[1]];
    const v = num_(val);
    if (v !== null) o.quotaFissa = Math.round((per.toLowerCase() === 'anno' ? v / 12 : v) * 100) / 100;
  }
  const pot = t.match(/potenza (?:contrattualmente )?impegnata[^\d\n]{0,25}(\d+(?:[,.]\d+)?)\s*kw\b/i);
  if (pot) o.potenza = num_(pot[1]);
  const scad = dataDopo_(t, ['condizioni economiche[^\\n]{0,60}?(?:fino al|valide fino|scadenza|scadono il|scade il)', 'scadenza (?:delle )?condizioni economiche',
    'prezzo (?:bloccato|fisso)[^\\n]{0,30}?fino al', 'valid[ae] fino al', 'offerta valida fino'], 40);
  if (scad) o.scadenzaCondizioni = scad;
  const cl = t.match(/consumo annuo[^\n\d]{0,40}(\d{1,3}(?:\.\d{3})*|\d+)\s*kwh/i);
  if (cl) o.consumoLuce = num_(cl[1]);
  const cg = t.match(/consumo annuo[^\n\d]{0,40}(\d{1,3}(?:\.\d{3})*|\d+)\s*smc/i);
  if (cg) o.consumoGas = num_(cg[1]);
  const pod = t.match(/\b(IT\s?\d{3}\s?E\s?\d{7,8}[A-Z0-9]?)\b/i);
  if (pod) o.pod = pod[1].replace(/\s/g, '').toUpperCase();
  const pdr = t.match(/\bPDR\b[^\d\n]{0,25}(\d{14})\b/i);
  if (pdr) o.pdr = pdr[1];
  const utili = ['offerta', 'prezzoLuce', 'prezzoGas', 'quotaFissa', 'scadenzaCondizioni', 'tipoPrezzo'].filter(k => o[k]).length;
  return utili >= 2 ? o : null;
}

/** Salva l'offerta letta da una bolletta (tiene la più recente per fornitore e fornitura). */
function salvaOfferta_(o, fornitore, fornitura, emissione, link) {
  if (!o) return false;
  const sh = sheet_(CONFIG.SHEET_OFFERTE);
  const map = ensureHeaders_(sh, COLONNE_OFFERTE);
  const righe = readRows_(sh).rows;
  const chi = String(fornitore || '').split(':')[0].trim();
  const es = righe.find(r => norm_(r['FORNITORE']) === norm_(chi) && norm_(r['FORNITURA']) === norm_(fornitura));
  if (es && es['DA BOLLETTA DEL'] instanceof Date && emissione && es['DA BOLLETTA DEL'] > emissione) return false;
  const obj = {
    'FORNITORE': chi, 'FORNITURA': fornitura, 'OFFERTA': o.offerta || '', 'MERCATO': o.mercato || '', 'TIPO PREZZO': o.tipoPrezzo || '',
    'PREZZO LUCE €/KWH': o.prezzoLuce || '', 'PREZZO GAS €/SMC': o.prezzoGas || '', 'QUOTA FISSA €/MESE': o.quotaFissa || '',
    'POTENZA KW': o.potenza || '', 'SCADENZA CONDIZIONI': o.scadenzaCondizioni || '', 'CONSUMO ANNUO LUCE KWH': o.consumoLuce || '',
    'CONSUMO ANNUO GAS SMC': o.consumoGas || '', 'POD': o.pod || '', 'PDR': o.pdr || '', 'DA BOLLETTA DEL': emissione || '', 'LINK MAIL': link || '', 'AGGIORNATO': new Date(),
  };
  if (es) {
    // se questa bolletta non riporta un campo, tengo quello che sapevo già (per esempio il POD)
    Object.keys(obj).forEach(k => { if (obj[k] === '' && es[k] !== '' && es[k] !== undefined) obj[k] = es[k]; });
    Object.keys(obj).forEach(k => setCell_(sh, map, es._row, k, obj[k]));
  } else appendObj_(sh, map, obj);
  return true;
}

/** Le offerte per l'app e per Edith, in formato semplice. */
function offerte_() {
  try {
    const sh = ss_().getSheetByName(CONFIG.SHEET_OFFERTE);
    if (!sh || sh.getLastRow() < 2) return [];
    const n = v => (typeof v === 'number' ? v : null);
    return readRows_(sh).rows.filter(r => r['FORNITORE']).map(r => ({
      chi: String(r['FORNITORE']), tipo: String(r['FORNITURA'] || ''), offerta: String(r['OFFERTA'] || ''), mercato: String(r['MERCATO'] || ''),
      tipoPrezzo: String(r['TIPO PREZZO'] || ''), prezzoLuce: n(r['PREZZO LUCE €/KWH']), prezzoGas: n(r['PREZZO GAS €/SMC']),
      quotaFissa: n(r['QUOTA FISSA €/MESE']), potenza: n(r['POTENZA KW']), scadenza: iso_(r['SCADENZA CONDIZIONI']),
      consumoLuce: n(r['CONSUMO ANNUO LUCE KWH']), consumoGas: n(r['CONSUMO ANNUO GAS SMC']), pod: String(r['POD'] || ''), pdr: String(r['PDR'] || ''),
      da: iso_(r['DA BOLLETTA DEL']), link: String(r['LINK MAIL'] || ''),
    }));
  } catch (e) { return []; }
}

function descriviOfferta_(o) {
  const p = [];
  p.push((o.offerta ? 'l\'offerta "' + o.offerta + '"' : 'un\'offerta') + ' di ' + o.chi + (o.mercato ? ' sul mercato ' + (o.mercato === 'Libero' ? 'libero' : 'di ' + o.mercato.toLowerCase()) : ''));
  if (o.tipoPrezzo) p.push('prezzo ' + o.tipoPrezzo.toLowerCase().replace('(pun)', 'legato al PUN').replace('(psv)', 'legato al PSV'));
  if (o.prezzoLuce) p.push('luce a ' + String(o.prezzoLuce).replace('.', ',') + ' euro al kWh');
  if (o.prezzoGas) p.push('gas a ' + String(o.prezzoGas).replace('.', ',') + ' euro allo Smc');
  if (o.quotaFissa) p.push('quota fissa ' + eur_(o.quotaFissa) + ' al mese');
  if (o.potenza) p.push('potenza ' + String(o.potenza).replace('.', ',') + ' kW');
  return p.join(', ') + '.' + (o.scadenza ? ' Le condizioni economiche scadono il ' + data_(o.scadenza) + '.' : '');
}

/**
 * Prima volta: rilegge l'ultima bolletta di ogni fornitore per riempire OFFERTE.
 * Parte da sola dentro il controllo orario finché non ha finito; si può lanciare anche a mano.
 */
function leggiOfferte(start) {
  start = start || Date.now();
  const props = PropertiesService.getScriptProperties();
  const sh = ss_().getSheetByName(CONFIG.SHEET_BOLLETTE);
  if (!sh || sh.getLastRow() < 2) { props.setProperty('OFFERTE_LETTE', '1'); return 0; }
  const fatte = String(props.getProperty('OFFERTE_FATTE') || '').split(',').filter(Boolean);
  const viste = {}, daLeggere = [];
  readRows_(sh).rows.filter(r => r['ID MAIL'] && r['DATA EMISSIONE'] instanceof Date)
    .sort((a, b) => b['DATA EMISSIONE'] - a['DATA EMISSIONE'])
    .forEach(r => { const k = norm_(String(r['FORNITORE']).split(':')[0]) + '|' + norm_(r['FORNITURA']); if (!viste[k]) { viste[k] = 1; daLeggere.push(r); } });
  let lette = 0;
  for (const r of daLeggere) {
    const id = String(r['ID MAIL']);
    if (fatte.indexOf(id) !== -1) continue;
    if (tempoScaduto_(start)) return lette;
    try {
      const msg = GmailApp.getMessageById(id);
      const pdf = msg.getAttachments({ includeInlineImages: false }).filter(a => a.getContentType() === 'application/pdf' || /\.pdf$/i.test(a.getName()))[0];
      const testo = (pdf ? ocrPdf_(pdf.copyBlob()) : '') + '\n' + msg.getPlainBody();
      if (salvaOfferta_(estraiOfferta_(testo), r['FORNITORE'], r['FORNITURA'], r['DATA EMISSIONE'], r['LINK MAIL'])) lette++;
    } catch (e) { log_('Offerte', 'Non riesco a leggere ' + r['FORNITORE'] + ': ' + e.message); }
    fatte.push(id);
    props.setProperty('OFFERTE_FATTE', fatte.slice(-50).join(','));
  }
  props.setProperty('OFFERTE_LETTE', '1');
  if (lette) log_('Offerte', lette + ' offerte lette dalle bollette');
  return lette;
}

/**
 * EDITH – spese fuori dalle bollette.
 * - SPESE FISSE: una riga per spesa che si ripete ogni mese (per esempio l'affitto). Ogni mese, dal giorno indicato,
 *   EDITH la copia da sola nel foglio SPESE. Puoi aggiungere righe o mettere ATTIVA = NO per sospenderne una.
 * - SPESE: tutte le spese, anche quelle dette a voce ("ho fatto benzina, sono 50 euro"): data, importo, tipologia.
 */

const COLONNE_SPESE = ['DATA', 'IMPORTO', 'TIPOLOGIA', 'NOTA', 'FONTE', 'REGISTRATA IL'];
const COLONNE_SPESE_FISSE = ['NOME', 'IMPORTO', 'GIORNO DEL MESE', 'TIPOLOGIA', 'ATTIVA'];
const SPESE_FISSE_INIZIALI = [['Affitto', 300, 1, 'Casa', 'SI']];

const TIPOLOGIE_SPESA = [
  ['Benzina', /\b(benzina|carburante|diesel|gasolio|metano per l auto|gpl|pieno|rifornimento|distributore)\b/],
  ['Spesa', /\b(spesa|supermercato|alimentari|conad|coop|esselunga|carrefour|lidl|eurospin|pam|despar|mercato)\b/],
  ['Ristorante', /\b(ristorante|pizzeria|pizza|cena fuori|pranzo fuori|sushi|trattoria|aperitivo|kebab|mcdonald\w*)\b/],
  ['Bar', /\b(bar|caffe|colazione|cappuccino|brioche)\b/],
  ['Auto', /\b(parcheggio|autostrada|pedaggio|telepass|meccanico|gomme|tagliando|lavaggio|bollo auto|revisione)\b/],
  ['Trasporti', /\b(treno|autobus|bus|metro|biglietto|taxi|uber|aereo|volo)\b/],
  ['Salute', /\b(farmacia|medicine|medicinali|medico|dentista|visita|analisi|ticket)\b/],
  ['Casa', /\b(affitto|condominio|ikea|ferramenta|pulizie|bricolage)\b/],
  ['Abbigliamento', /\b(vestiti|scarpe|abbigliamento|maglia|pantaloni|giacca|zara)\b/],
  ['Svago', /\b(cinema|teatro|concerto|libro|libri|netflix|spotify|palestra|abbonamento)\b/],
  ['Regali', /\b(regalo|regali)\b/],
  ['Animali', /\b(veterinario|crocchette|cane|gatto)\b/],
];

function tipologiaSpesa_(t) {
  const x = (TIPOLOGIE_SPESA.find(([, re]) => re.test(t)) || [])[0];
  return x || null;
}

/** "ho fatto benzina, sono 50 euro" → { importo: 50, tipologia: 'Benzina', data } ; null se non è una spesa da registrare. */
function capisciSpesa_(t) {
  if (/^(quanto|quando|quali|quale|cosa|come|dove|perche)\b/.test(t)) return null;
  const m = t.match(/(\d+(?:[.,]\d{1,2})?)\s*(?:euro|eur)\b/) || t.match(/\beuro\s*(\d+(?:[.,]\d{1,2})?)/) ||
    (tipologiaSpesa_(t) ? t.match(/\b(?:sono|di|da|per)\s+(\d+(?:[.,]\d{1,2})?)\b/) : null);
  if (!m) return null;
  // la frase arriva senza virgole ("23,40 euro" diventa "23 40 euro"): due cifre subito prima di "euro" sono i centesimi
  const cent = t.match(/(\d+)\s(\d{2})\s*(?:euro|eur)\b/);
  const importo = Math.round(parseFloat(cent ? cent[1] + '.' + cent[2] : m[1].replace(',', '.')) * 100) / 100;
  if (!(importo > 0) || importo > 20000) return null;
  const tipologia = tipologiaSpesa_(t);
  const verbo = /\b(ho fatto|ho speso|ho pagato|ho preso|ho comprato|segna|aggiungi|registra|metti|spesi|pagati|spesa di|sono)\b/.test(t);
  if (!tipologia && !/\b(ho speso|segna|aggiungi|registra)\b/.test(t)) return null;
  if (!verbo && !tipologia) return null;
  const data = new Date();
  if (/\bieri\b/.test(t)) data.setDate(data.getDate() - 1);
  else if (/\bl altro ieri\b|\bavantieri\b/.test(t)) data.setDate(data.getDate() - 2);
  data.setHours(12, 0, 0, 0);
  return { importo: importo, tipologia: tipologia || 'Altro', data: data };
}

function registraSpesa_(s, nota, fonte) {
  const sh = sheet_(CONFIG.SHEET_SPESE);
  const map = ensureHeaders_(sh, COLONNE_SPESE);
  appendObj_(sh, map, { 'DATA': s.data, 'IMPORTO': s.importo, 'TIPOLOGIA': s.tipologia, 'NOTA': nota || '', 'FONTE': fonte || 'voce', 'REGISTRATA IL': new Date() });
  try { svuotaCache_(); } catch (e) { }
}

/** Toglie l'ultima spesa detta a voce (per "annulla"). */
function annullaUltimaSpesa_() {
  const sh = ss_().getSheetByName(CONFIG.SHEET_SPESE);
  if (!sh || sh.getLastRow() < 2) return null;
  const righe = readRows_(sh).rows.filter(r => r['FONTE'] === 'voce');
  const u = righe[righe.length - 1];
  if (!u) return null;
  sh.deleteRows(u._row, 1);
  try { svuotaCache_(); } catch (e) { }
  return u;
}

/** Copia ogni mese le spese fisse nel foglio SPESE (una volta sola per mese). */
function registraSpeseFisse_() {
  const ss = ss_();
  let shF = ss.getSheetByName(CONFIG.SHEET_SPESE_FISSE);
  if (!shF) {
    shF = sheet_(CONFIG.SHEET_SPESE_FISSE);
    const mapF = ensureHeaders_(shF, COLONNE_SPESE_FISSE);
    SPESE_FISSE_INIZIALI.forEach(r => appendObj_(shF, mapF, { 'NOME': r[0], 'IMPORTO': r[1], 'GIORNO DEL MESE': r[2], 'TIPOLOGIA': r[3], 'ATTIVA': r[4] }));
  }
  const fisse = readRows_(shF).rows.filter(r => r['NOME'] && typeof r['IMPORTO'] === 'number' && !/^(no|n|falso|false)$/i.test(String(r['ATTIVA'])));
  if (!fisse.length) return 0;
  const sh = sheet_(CONFIG.SHEET_SPESE);
  const map = ensureHeaders_(sh, COLONNE_SPESE);
  const oggi = new Date(), mese = Utilities.formatDate(oggi, CONFIG.TIMEZONE, 'yyyy-MM');
  const gia = readRows_(sh).rows.filter(r => r['FONTE'] === 'fissa' && r['DATA'] instanceof Date && Utilities.formatDate(r['DATA'], CONFIG.TIMEZONE, 'yyyy-MM') === mese).map(r => String(r['NOTA']));
  let n = 0;
  fisse.forEach(f => {
    const g = Math.min(Math.max(Number(f['GIORNO DEL MESE']) || 1, 1), 28);
    if (oggi.getDate() < g || gia.indexOf(String(f['NOME'])) !== -1) return;
    appendObj_(sh, map, { 'DATA': new Date(oggi.getFullYear(), oggi.getMonth(), g, 12), 'IMPORTO': f['IMPORTO'], 'TIPOLOGIA': f['TIPOLOGIA'] || f['NOME'], 'NOTA': String(f['NOME']), 'FONTE': 'fissa', 'REGISTRATA IL': new Date() });
    n++;
  });
  if (n) { log_('Spese fisse', n + ' spese fisse del mese registrate'); try { svuotaCache_(); } catch (e) { } }
  return n;
}

/** Le spese in formato semplice. */
function spese_() {
  try {
    const sh = ss_().getSheetByName(CONFIG.SHEET_SPESE);
    if (!sh || sh.getLastRow() < 2) return [];
    return readRows_(sh).rows.filter(r => r['DATA'] instanceof Date && typeof r['IMPORTO'] === 'number')
      .map(r => ({ data: iso_(r['DATA']), importo: r['IMPORTO'], tipo: String(r['TIPOLOGIA'] || 'Altro'), nota: String(r['NOTA'] || ''), fonte: String(r['FONTE'] || '') }))
      .sort((a, b) => b.data.localeCompare(a.data));
  } catch (e) { return []; }
}

/** Riepilogo per l'app: totale del mese, per tipologia, ultime spese. */
function riepilogoSpese_() {
  const S = spese_(), mese = iso_(new Date()).slice(0, 7);
  const delMese = S.filter(s => s.data.slice(0, 7) === mese);
  const per = {}; delMese.forEach(s => { per[s.tipo] = (per[s.tipo] || 0) + s.importo; });
  return { mese: round2_(delMese.reduce((t, s) => t + s.importo, 0)), perTipo: Object.keys(per).map(k => ({ nome: k, totale: round2_(per[k]) })).sort((a, b) => b.totale - a.totale), ultime: S.slice(0, 8) };
}

/** Risposte di Edith sulle spese (registrazione, annullamento, domande). Restituisce null se la frase non c'entra. */
function rispostaSpese_(t, c) {
  if (/^(annulla|cancella|togli|elimina)\b.*\b(spesa|ultima|benzina|registrazione)\b|^annulla$|ho sbagliato( la)? spesa/.test(t)) {
    const u = annullaUltimaSpesa_();
    return { testo: u ? 'Fatto: ho tolto ' + u['TIPOLOGIA'] + ' da ' + eur_(u['IMPORTO']) + '.' : 'Non trovo spese dette a voce da togliere.' };
  }
  const s = capisciSpesa_(t);
  if (s) {
    registraSpesa_(s, '', 'voce');
    const quando = iso_(s.data) === iso_(new Date()) ? 'oggi' : 'il ' + data_(iso_(s.data));
    return { testo: 'Segnato: ' + s.tipologia.toLowerCase() + ', ' + eur_(s.importo) + ', ' + quando + '.' + (s.tipologia === 'Altro' ? ' Non ho capito la tipologia: la puoi cambiare nel foglio SPESE.' : '') + ' Se ho sbagliato, di\' "annulla".', aggiorna: true };
  }
  const tipo = tipologiaSpesa_(t);
  const generiche = /spese (varie|extra|del mese|di questo mese|fuori dalle bollette|quotidiane)|altre spese|tutte le spese|uscite/.test(t);
  if ((tipo || generiche) && /quanto|quante|spes[aoi]|speso|pagato|totale|elenco|lista|ultim/.test(t) && !c.ass && !c.tipo) {
    const S = spese_(), oggi = new Date();
    let mese = c.mesi.length ? c.mesi[0] : (/quest anno|nel \d{4}|in tutto l anno/.test(t) ? null : oggi.getMonth());
    const anno = c.anno;
    const del = S.filter(x => x.data.slice(0, 4) === anno && (mese === null || +x.data.slice(5, 7) === mese + 1) && (!tipo || x.tipo === tipo));
    const quando = mese === null ? 'nel ' + anno : aMese_(mese) + (anno !== String(oggi.getFullYear()) ? ' ' + anno : '');
    if (/ultim/.test(t) && del.length) { const u = del[0]; return { testo: 'L\'ultima ' + (tipo ? 'spesa di ' + tipo.toLowerCase() : 'spesa') + ' è del ' + data_(u.data) + ': ' + eur_(u.importo) + (tipo ? '' : ' (' + u.tipo.toLowerCase() + ')') + '.' }; }
    if (!del.length) return { testo: cap_(quando) + ' non ho spese' + (tipo ? ' di ' + tipo.toLowerCase() : '') + ' registrate.' };
    const tot = del.reduce((a, x) => a + x.importo, 0);
    if (tipo) return { testo: cap_(quando) + ' hai speso ' + eur_(tot) + ' di ' + tipo.toLowerCase() + ' (' + del.length + (del.length === 1 ? ' volta' : ' volte') + ').' };
    const per = {}; del.forEach(x => { per[x.tipo] = (per[x.tipo] || 0) + x.importo; });
    return { testo: cap_(quando) + ' hai ' + eur_(tot) + ' di spese fuori dalle bollette: ' + Object.keys(per).sort((a, b) => per[b] - per[a]).map(k => k.toLowerCase() + ' ' + eur_(per[k])).join(', ') + '.' };
  }
  return null;
}
