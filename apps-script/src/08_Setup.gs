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
