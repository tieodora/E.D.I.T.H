/**
 * Calendario a voce: "segna su calendar che devo comprare il latte", "metti in agenda dentista venerdì alle 17",
 * "ricordami di chiamare la mamma domani", "cosa ho in calendario domani?", "annulla l'ultimo evento".
 * Gli eventi vanno nel calendario principale di Google (quello che vedi sul telefono).
 * Senza data: oggi se è prima delle 18, altrimenti domani. Senza ora: evento di tutto il giorno.
 */

const GIORNI_SETTIMANA = ['domenica', 'lunedi', 'martedi', 'mercoledi', 'giovedi', 'venerdi', 'sabato'];
const MESI_NOMI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

const RX_CAL_PAROLA = /\b(google calendar|calendar|calendario|agenda)\b/;
const RX_CAL_SCRIVI = /\b(segna|segnami|segnare|metti|mettimi|aggiungi|aggiungimi|scrivi|scrivimi|inserisci|annota|salva|fissa|crea)\b/;
const RX_RICORDAMI = /^(edith )?(ricordami|ricorda mi|mi ricordi|avvisami|ricordati) (di|che) /;

/** Minuscole, punteggiatura tolta, accenti tenuti (serve per il titolo dell'evento). */
function morbido_(s) {
  return String(s || '').toLowerCase().replace(/[’']/g, ' ').replace(/[^0-9a-zàèéìíòóùú\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Capisce data e ora in una frase già normalizzata. Restituisce { data, ora, minuti, detta } (detta = la data era nella frase). */
function capisciQuando_(t) {
  const oggi = new Date(); oggi.setHours(0, 0, 0, 0);
  let data = null;
  const piu = n => { const d = new Date(oggi); d.setDate(d.getDate() + n); return d; };
  let m;
  if (/\bdopodomani\b/.test(t)) data = piu(2);
  else if (/\bdomani\b/.test(t)) data = piu(1);
  else if (/\b(oggi|stasera|stamattina|stanotte|oggi pomeriggio)\b/.test(t)) data = piu(0);
  else if ((m = t.match(/\b(?:tra|fra) (\d+|un|una|due|tre|quattro|cinque) (giorni|giorno|settimane|settimana)\b/))) {
    const n = { un: 1, una: 1, due: 2, tre: 3, quattro: 4, cinque: 5 }[m[1]] || parseInt(m[1], 10);
    data = piu(n * (/settiman/.test(m[2]) ? 7 : 1));
  } else if ((m = t.match(/\b(?:il|del|per il|entro il) (\d{1,2}) (\d{1,2})(?: (\d{2,4}))?\b/)) && parseInt(m[2], 10) >= 1 && parseInt(m[2], 10) <= 12) {
    data = new Date(m[3] ? (m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10)) : oggi.getFullYear(), parseInt(m[2], 10) - 1, parseInt(m[1], 10));
    if (!m[3] && data < oggi) data.setFullYear(data.getFullYear() + 1);
  } else if ((m = t.match(new RegExp('\\b(\\d{1,2}|primo) (' + MESI_NOMI.join('|') + ')\\b')))) {
    data = new Date(oggi.getFullYear(), MESI_NOMI.indexOf(m[2]), m[1] === 'primo' ? 1 : parseInt(m[1], 10));
    if (data < oggi) data.setFullYear(data.getFullYear() + 1);
  } else if ((m = t.match(new RegExp('\\b(' + GIORNI_SETTIMANA.join('|') + ')\\b')))) {
    let diff = (GIORNI_SETTIMANA.indexOf(m[1]) - oggi.getDay() + 7) % 7;
    if (diff === 0) diff = 7;
    data = piu(diff);
  } else if ((m = t.match(/\b(?:il|per il|entro il) (\d{1,2})\b(?! (?:euro|eur|minuti|ore))/))) {
    const g = parseInt(m[1], 10);
    if (g >= 1 && g <= 31) {
      data = new Date(oggi.getFullYear(), oggi.getMonth(), g);
      if (data < oggi) data.setMonth(data.getMonth() + 1);
    }
  }

  let ora = null, minuti = 0;
  if ((m = t.match(/\b(?:alle|all|verso le|per le|dalle|a) (\d{1,2})(?:(?: e | )(\d{1,2}|mezza|un quarto|quarto))?\b/)) && parseInt(m[1], 10) <= 24) {
    ora = parseInt(m[1], 10);
    minuti = !m[2] ? 0 : m[2] === 'mezza' ? 30 : /quarto/.test(m[2]) ? 15 : parseInt(m[2], 10);
    if (minuti > 59) minuti = 0;
    const sera = /\b(di sera|stasera|del pomeriggio|di pomeriggio|oggi pomeriggio)\b/.test(t);
    const mattina = /\b(di mattina|del mattino|stamattina|di notte)\b/.test(t);
    if ((sera && ora < 12) || (!mattina && ora >= 1 && ora <= 7)) ora += 12;
  } else if (/\ba mezzogiorno\b/.test(t)) ora = 12;
  else if (/\ba mezzanotte\b/.test(t)) { ora = 23; minuti = 59; }

  const detta = !!data;
  if (!data) data = piu(new Date().getHours() >= 18 ? 1 : 0);
  return { data: data, ora: ora, minuti: minuti, detta: detta };
}

/** Il titolo dell'evento: la frase senza il comando e senza data e ora. */
function titoloEvento_(q) {
  let s = ' ' + morbido_(q) + ' ';
  const via = [
    /^\s*edith\s/,
    /\b(per favore|perfavore|grazie)\b/g,
    /\b(ricordami|ricorda mi|mi ricordi|avvisami|ricordati)\s(di|che)\b/g,
    /\b(segnami|segna|segnare|mettimi|metti|aggiungimi|aggiungi|scrivimi|scrivi|inserisci|annota|salva|fissa|crea)\b/g,
    /\b(un |l |il )?(evento|appuntamento|promemoria|impegno)\b/g,
    /\b(su|sul|sulla|nel|nella|in|al|all|nell)?\s?(google\s)?(calendar|calendario|agenda)\b/g,
    /\b(che|ce|c e)\s(devo|dovrò|dovro|ho da|ho)(?=\s)/g,
    /\bdevo\b/g,
    /\b(dopodomani|domani|oggi pomeriggio|oggi|stasera|stamattina|stanotte)\b/g,
    /\b(tra|fra)\s(\d+|un|una|due|tre|quattro|cinque)\s(giorni|giorno|settimane|settimana)\b/g,
    new RegExp('\\b(il|del|per il|entro il)?\\s?(\\d{1,2}|primo)\\s(' + MESI_NOMI.join('|') + ')\\b', 'g'),
    /\b(il|del|per il|entro il)\s\d{1,2}\s\d{1,2}(\s\d{2,4})?\b/g,
    /\b(il |per |prossimo |questo )?(lunedì|lunedi|martedì|martedi|mercoledì|mercoledi|giovedì|giovedi|venerdì|venerdi|sabato|domenica)( prossimo| prossima)?(?=\s)/g,
    /\b(alle|all|verso le|per le|dalle|a)\s\d{1,2}((\se\s|\s)(\d{1,2}|mezza|un quarto|quarto))?\b/g,
    /\b(di sera|di mattina|del mattino|del pomeriggio|di pomeriggio|di notte|a mezzogiorno|a mezzanotte)\b/g,
    /\b(entro il|per il|il)\s\d{1,2}\b/g,
  ];
  via.forEach(r => { s = s.replace(r, ' '); });
  s = s.replace(/\s+/g, ' ').trim().replace(/^(che|di|per|e|a|da)\s/, '').replace(/\s(e|di|per|a|da)$/, '').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

function quandoDetto_(q) {
  const oggi = new Date(); oggi.setHours(0, 0, 0, 0);
  const g = Math.round((q.data - oggi) / 86400000);
  const giorno = g === 0 ? 'oggi' : g === 1 ? 'domani' : g === 2 ? 'dopodomani' : g < 7 ? GIORNI_SETTIMANA[q.data.getDay()].replace(/i$/, 'ì') + ' ' + q.data.getDate() : 'il ' + q.data.getDate() + ' ' + MESI_NOMI[q.data.getMonth()];
  return giorno + (q.ora === null ? '' : ' alle ' + q.ora + (q.minuti ? ':' + String(q.minuti).padStart(2, '0') : ''));
}

/** Crea l'evento nel calendario principale. Restituisce l'evento creato. */
function creaEventoVoce_(titolo, q) {
  const cal = CalendarApp.getDefaultCalendar();
  const opz = { description: 'Segnato da EDITH a voce' };
  let ev;
  if (q.ora === null) {
    ev = cal.createAllDayEvent(titolo, q.data, opz);
  } else {
    const inizio = new Date(q.data); inizio.setHours(q.ora, q.minuti, 0, 0);
    ev = cal.createEvent(titolo, inizio, new Date(inizio.getTime() + 60 * 60000), opz);
    try { ev.addPopupReminder(30); } catch (e) { ignora_('promemoria evento', e); }
  }
  PropertiesService.getScriptProperties().setProperty('ULTIMO_EVENTO', ev.getId());
  return ev;
}

function eventiDelGiorno_(data) {
  return CalendarApp.getDefaultCalendar().getEventsForDay(data).map(e => ({
    titolo: e.getTitle(),
    ora: e.isAllDayEvent() ? '' : Utilities.formatDate(e.getStartTime(), CONFIG.TIMEZONE || 'Europe/Rome', 'HH:mm'),
  }));
}

/** Risposte di calendario per l'assistente; null se la frase non riguarda il calendario. */
function rispostaCalendario_(q, t) {
  const parola = RX_CAL_PAROLA.test(t);
  const ricordami = RX_RICORDAMI.test(t) && !/\b(quando|bollett\w*|scadenz\w*|scade|luce|gas|acqua|assicurazion\w*|polizz\w*)\b/.test(t);

  // annulla l'ultimo evento creato a voce
  if (/\b(annulla|togli|cancella|elimina|rimuovi)\b/.test(t) && /\b(evento|appuntamento|calendar|calendario|agenda)\b/.test(t)) {
    const props = PropertiesService.getScriptProperties();
    const id = props.getProperty('ULTIMO_EVENTO');
    const ev = id ? (function () { try { return CalendarApp.getDefaultCalendar().getEventById(id); } catch (e) { return null; } })() : null;
    if (!ev) return { testo: 'Non trovo eventi segnati da me da togliere.' };
    const titolo = ev.getTitle();
    ev.deleteEvent();
    props.deleteProperty('ULTIMO_EVENTO');
    return { testo: 'Tolto dal calendario: ' + titolo + '.' };
  }

  // cosa ho in calendario?
  if ((parola || /\b(appuntamenti|impegni)\b/.test(t)) && /^(cosa|che|quali|quanti|ho)\b|\bcosa ho\b|\bche impegni\b/.test(t) && !RX_CAL_SCRIVI.test(t)) {
    const qd = capisciQuando_(t);
    if (!qd.detta) { qd.data = new Date(); qd.data.setHours(0, 0, 0, 0); }
    const ev = eventiDelGiorno_(qd.data);
    const quando = quandoDetto_({ data: qd.data, ora: null });
    if (!ev.length) return { testo: 'In calendario ' + quando + ' non hai niente.' };
    return { testo: quando.charAt(0).toUpperCase() + quando.slice(1) + ' hai: ' +
      ev.slice(0, 6).map(e => (e.ora ? e.ora + ' ' : '') + e.titolo).join('; ') + (ev.length > 6 ? ' e altri ' + (ev.length - 6) + '.' : '.') };
  }

  // segna qualcosa
  if ((parola && RX_CAL_SCRIVI.test(t)) || ricordami || (parola && /\b(che devo|devo)\b/.test(t))) {
    const titolo = titoloEvento_(q);
    if (!titolo) return { testo: 'Cosa ti segno in calendario? Dimmi per esempio: "segna su calendar che devo comprare il latte domani".' };
    const qd = capisciQuando_(t);
    try { creaEventoVoce_(titolo, qd); } catch (e) {
      ignora_('evento calendario', e);
      return { testo: 'Non sono riuscita a scrivere nel calendario. Riprova tra poco.' };
    }
    return { testo: 'Segnato in calendario: ' + titolo + ', ' + quandoDetto_(qd) + (qd.ora === null ? ' (tutto il giorno)' : ', ti avviso mezz\'ora prima') + '.' };
  }
  return null;
}
