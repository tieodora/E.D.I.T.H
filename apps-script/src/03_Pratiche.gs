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
    try { prima = pratiche_(); } catch (e) { ignora_('pratiche prima del controllo', e); }
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
            if (!r['TASK ID'] && scad > new Date(Date.now() - 30 * 864e5)) { try { creaPromemoria_(sh, map, r._row, tipoPratica); } catch (e) { ignora_('promemoria riga ' + r._row, e); } }
          } else nota += ': ancora incompleta, controllala a mano';
          if (tipoPratica === 'bollette' && d.testo) { try { salvaOfferta_(estraiOfferta_(d.testo), r['FORNITORE'], r['FORNITURA'] || d.tipo, r['DATA EMISSIONE'], r['LINK MAIL']); } catch (e) { ignora_('offerta riga ' + r._row, e); } }
        }
      } catch (e) {
        if (eLimiteGoogle_(e)) return;
        nota += ': ' + e.message;
      }
      setCell_(sh, map, r._row, 'NOTE OCR', String(r['NOTE OCR'] || '') + ' · ' + nota);
    }
  });
  if (sistemate) { log_('Da verificare', sistemate + ' pratiche completate da sola'); try { aggiornaDashboard(); } catch (e) { ignora_('dashboard', e); } }
  return sistemate;
}
