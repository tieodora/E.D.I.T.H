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
