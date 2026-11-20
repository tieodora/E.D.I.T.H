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

/** Errore pensato per essere mostrato nell'app: tutti gli altri arrivano come messaggio generico. */
function rifiuto_(messaggio) { const e = new Error(messaggio); e.perApp = true; return e; }

/** La riga deve essere un numero intero tra la prima riga di dati (2) e l'ultima: mai l'intestazione. */
function rigaValida_(sh, riga) {
  const n = Number(riga);
  if (!Number.isInteger(n) || n < 2 || n > sh.getLastRow()) throw rifiuto_('Riga non valida');
  return n;
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
    // niente attesa: un token di 160 bit non si indovina per tentativi, e ogni attesa terrebbe occupata
    // una delle ~30 esecuzioni contemporanee di Apps Script (chi bombarda l'URL bloccherebbe anche te)
    tentativoFallito_(v.motivo);
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
    log_('Errore EDITH Voce', req.f + ' -> ' + err.message + (err.stack ? '\n' + err.stack : ''));
    return json_({ ok: false, errore: err.perApp ? err.message : 'Qualcosa non ha funzionato: il dettaglio è nel foglio LOG' });
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
  if (!sh || [CONFIG.SHEET_BOLLETTE, CONFIG.SHEET_ASSICURAZIONI].indexOf(foglio) === -1) throw rifiuto_('Foglio non valido');
  const map = colMap_(sh);
  riga = rigaValida_(sh, riga);
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
  if (AZIONI_ISCRIZIONE.indexOf(azione) === -1) throw rifiuto_('Azione non valida');
  const sh = sheet_(CONFIG.SHEET_ISCRIZIONI);
  const map = colMap_(sh);
  riga = rigaValida_(sh, riga);
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
  if (ammessi[foglio] !== colonna) throw rifiuto_('Campo non modificabile');
  const sh = sheet_(foglio);
  setCell_(sh, colMap_(sh), rigaValida_(sh, riga), colonna, valore === true);
  return true;
}
/** Chiamate solo dopo la conferma mostrata nell'app. */
/** Spunta o toglie la spunta a tutte le righe in un colpo solo (stessi campi ammessi di apiSpunta). */
function apiSpuntaTutte(foglio, colonna, valore) {
  const ammessi = { [CONFIG.SHEET_PULIZIA]: 'ESEGUI', [CONFIG.SHEET_PESANTI]: 'CESTINA' };
  if (ammessi[foglio] !== colonna) throw rifiuto_('Campo non modificabile');
  const sh = sheet_(foglio), map = colMap_(sh), n = sh.getLastRow() - 1;
  const col = map[norm_(colonna)];
  if (col === undefined) throw rifiuto_('Colonna ' + colonna + ' non trovata');
  if (n > 0) sh.getRange(2, col + 1, n, 1).setValues(Array.from({ length: n }, () => [valore === true]));
  return true;
}
function apiEseguiPulizia() { eseguiPulizia(true); return apiPulizia(); }
function apiCestinaPesanti() { cestinaMailPesantiSelezionate(true); return apiPulizia(); }
