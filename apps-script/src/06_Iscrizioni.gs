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
