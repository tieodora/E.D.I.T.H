/**
 * Andamento costi.
 *  - Lo storico resta sempre nei fogli BOLLETTAZIONE e ASSICURAZIONE (tutti gli anni dal 2026).
 *  - RIEPILOGO contiene anche la tabella storica per anno.
 *  - DASHBOARD mostra solo l'ANNO CORRENTE (dal 1° gennaio cambia anno da sola).
 * Si aggiorna dopo ogni nuova pratica e ogni notte.
 */

function aggiornaDashboard() {
  const ss = ss_();
  const ora = new Date();
  const anno = ora.getFullYear();
  const bol = ss.getSheetByName(CONFIG.SHEET_BOLLETTE);
  const ass = ss.getSheetByName(CONFIG.SHEET_ASSICURAZIONI);
  const dataRif = r => (r['DATA EMISSIONE'] instanceof Date ? r['DATA EMISSIONE'] : r['DATA COMUNICAZIONE']);
  const dataAss = r => (r['DATA SCADENZA'] instanceof Date ? r['DATA SCADENZA'] : dataRif(r));
  const conImporto = r => typeof r['IMPORTO'] === 'number';

  const B = bol ? readRows_(bol).rows.filter(r => conImporto(r) && dataRif(r) instanceof Date && dataRif(r).getFullYear() >= CONFIG.ANNO_INIZIO) : [];
  const A = ass ? readRows_(ass).rows.filter(r => conImporto(r) && dataAss(r) instanceof Date && dataAss(r).getFullYear() >= CONFIG.ANNO_INIZIO) : [];
  const Banno = B.filter(r => dataRif(r).getFullYear() === anno);
  const Aanno = A.filter(r => dataAss(r).getFullYear() === anno);

  const tipiB = uniq_(B.map(r => r['FORNITURA'] || 'Altro'));
  const ramiA = uniq_(A.map(r => r['RAMO'] || 'Altro'));
  const somma = rows => round2_(rows.reduce((a, r) => a + r['IMPORTO'], 0));

  const rie = sheet_(CONFIG.SHEET_RIEPILOGO);
  rie.clear();

  // --- T1: bollette anno corrente, per mese e tipo
  const nomiMesi = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
  const t1 = [['Mese ' + anno].concat(tipiB, ['Totale'])];
  nomiMesi.forEach((nm, m) => {
    const delMese = Banno.filter(r => dataRif(r).getMonth() === m);
    const riga = [nm];
    tipiB.forEach(tp => riga.push(somma(delMese.filter(r => (r['FORNITURA'] || 'Altro') === tp))));
    riga.push(somma(delMese));
    t1.push(riga);
  });
  scriviTabella_(rie, 1, 1, t1);

  // --- T2: ripartizione anno corrente per tipo
  const c2 = t1[0].length + 2;
  const t2 = [['Tipo', 'Anno ' + anno]].concat(tipiB.map(tp => [tp, somma(Banno.filter(r => (r['FORNITURA'] || 'Altro') === tp))]));
  scriviTabella_(rie, 1, c2, t2);

  // --- T3: assicurazioni anno corrente per ramo
  const c3 = c2 + 3;
  const t3 = [['Ramo', 'Anno ' + anno]].concat(ramiA.map(rm => [rm, somma(Aanno.filter(r => (r['RAMO'] || 'Altro') === rm))]));
  scriviTabella_(rie, 1, c3, t3);

  // --- T4: STORICO per anno (bollette per tipo + assicurazioni)
  const c4 = c3 + 3;
  const anni = uniq_(B.map(r => dataRif(r).getFullYear()).concat(A.map(r => dataAss(r).getFullYear())).concat([anno])).sort();
  const t4 = [['Storico'].concat(tipiB, ['Totale bollette', 'Assicurazioni'])];
  anni.forEach(y => {
    const By = B.filter(r => dataRif(r).getFullYear() === y);
    const riga = [String(y)];
    tipiB.forEach(tp => riga.push(somma(By.filter(r => (r['FORNITURA'] || 'Altro') === tp))));
    riga.push(somma(By), somma(A.filter(r => dataAss(r).getFullYear() === y)));
    t4.push(riga);
  });
  scriviTabella_(rie, 1, c4, t4);

  // --- DASHBOARD (solo anno corrente)
  const dash = sheet_(CONFIG.SHEET_DASHBOARD);
  dash.getCharts().forEach(c => dash.removeChart(c));
  dash.clear();

  const totB = somma(Banno);
  const mesiTrascorsi = ora.getMonth() + 1;
  const aperte = B.concat(A).filter(r => r['STATO PAGAMENTO'] === STATO.DA_PAGARE || r['STATO PAGAMENTO'] === STATO.SCADUTA);
  const kpi = [
    ['EDITH – ' + anno, '', 'Aggiornato: ' + fmtDate_(ora, 'dd/MM/yyyy HH:mm')],
    ['Bollette ' + anno, totB, ''],
    ['Media mensile bollette', round2_(totB / mesiTrascorsi), ''],
    ['Assicurazioni ' + anno, somma(Aanno), ''],
    ['Pratiche da pagare / scadute', aperte.length, euro_(somma(aperte))],
  ];
  dash.getRange(1, 1, kpi.length, 3).setValues(kpi);
  dash.getRange('A1').setFontSize(16).setFontWeight('bold');
  dash.getRange('B2:B4').setNumberFormat('€ #,##0.00');
  dash.getRange('A2:A5').setFontWeight('bold');

  const prossime = B.concat(A)
    .filter(r => r['STATO PAGAMENTO'] !== STATO.CONCLUSA && r['DATA SCADENZA'] instanceof Date)
    .sort((a, b) => a['DATA SCADENZA'] - b['DATA SCADENZA']).slice(0, 8)
    .map(r => [fmtDate_(r['DATA SCADENZA']), (r['FORNITURA'] || r['RAMO'] || '') + ' – ' + (r['FORNITORE'] || r['COMPAGNIA'] || ''),
      euro_(r['IMPORTO']), r['STATO PAGAMENTO']]);
  dash.getRange(1, 5).setValue('Prossime scadenze').setFontWeight('bold');
  if (prossime.length) dash.getRange(2, 5, prossime.length, 4).setValues(prossime);

  const top = 11;
  const w1 = t1[0].length;
  if (tipiB.length) {
    dash.insertChart(dash.newChart().asColumnChart().setStacked()
      .addRange(rie.getRange(1, 1, 13, w1 - 1)).setNumHeaders(1)
      .setOption('title', 'Bollette ' + anno + ' per mese e tipo')
      .setOption('vAxis', { format: '€ #,##0' })
      .setPosition(top, 1, 0, 0).setOption('width', 760).setOption('height', 340).build());
    dash.insertChart(dash.newChart().asLineChart()
      .addRange(rie.getRange(1, 1, 13, 1)).addRange(rie.getRange(1, w1, 13, 1)).setNumHeaders(1)
      .setOption('title', 'Andamento mensile ' + anno)
      .setOption('vAxis', { format: '€ #,##0' })
      .setPosition(top, 9, 0, 0).setOption('width', 560).setOption('height', 340).build());
    dash.insertChart(dash.newChart().asPieChart()
      .addRange(rie.getRange(1, c2, t2.length, 2)).setNumHeaders(1)
      .setOption('title', 'Ripartizione bollette ' + anno).setOption('pieHole', 0.4)
      .setPosition(top + 19, 1, 0, 0).setOption('width', 460).setOption('height', 320).build());
  }
  if (ramiA.length) {
    dash.insertChart(dash.newChart().asColumnChart()
      .addRange(rie.getRange(1, c3, t3.length, 2)).setNumHeaders(1)
      .setOption('title', 'Assicurazioni ' + anno + ' per ramo (rate semestrali)')
      .setOption('legend', { position: 'none' })
      .setPosition(top + 19, 6, 0, 0).setOption('width', 460).setOption('height', 320).build());
  }
  dash.autoResizeColumns(1, 8);
}

function scriviTabella_(sh, r, c, dati) {
  sh.getRange(r, c, dati.length, 1).setNumberFormat('@');
  sh.getRange(r, c, dati.length, dati[0].length).setValues(dati);
  sh.getRange(r, c, 1, dati[0].length).setFontWeight('bold');
}

function uniq_(arr) { return [...new Set(arr)].sort(); }
function round2_(n) { return Math.round(n * 100) / 100; }
