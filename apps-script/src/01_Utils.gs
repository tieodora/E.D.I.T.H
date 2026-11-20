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
