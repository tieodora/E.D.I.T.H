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
