const test = require('node:test');
const assert = require('node:assert');
const { carica } = require('./carica');
const E = carica();
const iso = d => d ? E.Utilities.formatDate(d, 'Europe/Rome', 'yyyy-MM-dd') : null;

test('date scritte in tanti modi', () => {
  assert.strictEqual(iso(E.parseData_('scadenza 16/10/2026')), '2026-10-16');
  assert.strictEqual(iso(E.parseData_('entro il 1.3.26')), '2026-03-01');
  assert.strictEqual(iso(E.parseData_('emessa il 5 ottobre 2026')), '2026-10-05');
  assert.strictEqual(iso(E.parseData_('del 7 sett. 2026')), '2026-09-07');
  assert.strictEqual(E.parseData_('31/02/2026'), null, 'il 31 febbraio non esiste');
  assert.strictEqual(E.parseData_('nessuna data qui'), null);
});

test('importi all\'italiana', () => {
  assert.strictEqual(E.parseEuro_('1.234,56'), 1234.56);
  assert.strictEqual(E.parseEuro_('96,00'), 96);
  assert.strictEqual(E.parseEuro_('abc'), null);
});

test('bolletta luce e gas: emissione, scadenza, importo', () => {
  const testo = 'Piemonte Energy S.p.A.\nBolletta n. 2026/123456 del 16/09/2026\nFornitura di energia elettrica e gas naturale\n' +
    'POD IT001E12345678 - consumo luce 210 kWh\nPDR 00881234567890 - consumo gas 95 Smc\nTotale da pagare € 135,20\nData scadenza 16/10/2026\nPeriodo luglio - agosto';
  const r = E.estraiDati_(testo, 'bollette', '"Piemonte Energy" <noreply@piemonte.example>', 'La tua bolletta');
  assert.strictEqual(iso(r.emissione), '2026-09-16');
  assert.strictEqual(iso(r.scadenza), '2026-10-16');
  assert.strictEqual(r.importo, 135.2);
  assert.match(r.tipo, /Luce e Gas/);
});

test('la scadenza non può venire prima dell\'emissione', () => {
  const testo = 'Fattura n. 99 del 15/09/2026\nScadenza rata precedente 01/08/2026\nScadenza 19/10/2026\nImporto da pagare 30,00 euro\ngas naturale';
  const r = E.estraiDati_(testo, 'bollette', 'Somet <a@b.it>', 'Fattura');
  assert.strictEqual(iso(r.scadenza), '2026-10-19');
  assert.strictEqual(r.importo, 30);
});

test('assicurazione: premio e polizza', () => {
  const testo = 'Gentile cliente, la polizza n. 123456789 Auto è in scadenza.\nScadenza rata 30/12/2026\nPremio totale € 779,00';
  const r = E.estraiDati_(testo, 'assicurazioni', 'AXA <noreply@axa.example>', 'Promemoria scadenza');
  assert.strictEqual(iso(r.scadenza), '2026-12-30');
  assert.strictEqual(r.importo, 779);
  assert.strictEqual(r.numero, '123456789');
});

test('bolletta con addebito in conto: scadenza e importo dall\'addebito', () => {
  const testo = 'Fattura n. 55 del 02/10/2026\nfornitura gas naturale PDR 00881234567890 consumo 40 Smc\nL\'importo di € 48,30 sarà addebitato il 22/10/2026 sul conto corrente';
  const r = E.estraiDati_(testo, 'bollette', 'Gas <a@b.it>', 'Bolletta');
  assert.strictEqual(r.importo, 48.3);
  assert.strictEqual(iso(r.scadenza), '2026-10-22');
});

test('limiti di Google riconosciuti, disguidi temporanei riprovati', () => {
  assert.ok(E.eLimiteGoogle_(new Error('Service invoked too many times for one day: driveapi')));
  assert.ok(!E.eLimiteGoogle_(new Error('File non trovato')));
  let n = 0;
  assert.strictEqual(E.conRiprova_(() => { if (++n < 3) throw new Error('Backend Error'); return 'ok'; }), 'ok');
  assert.throws(() => E.conRiprova_(() => { throw new Error('File non trovato'); }));
});
