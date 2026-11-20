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
