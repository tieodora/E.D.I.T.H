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
