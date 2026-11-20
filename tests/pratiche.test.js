const test = require('node:test');
const assert = require('node:assert');
const { carica } = require('./carica');
const riempi = require('./dati');

const E = carica(); riempi(E);
const P = E.pratiche_();

test('la bolletta inoltrata con "Fwd:" conta una volta sola', () => {
  const piemonte = P.filter(p => p.chi === 'Piemonte Energy' && p.emissione === '2026-09-16');
  assert.strictEqual(piemonte.length, 1);
  assert.doesNotMatch(piemonte[0].oggetto, /^fwd/i, 'tiene l\'originale, non l\'inoltro');
  assert.strictEqual(E.DOPPIONI_, 1);
});

test('il nome del fornitore viene ripulito', () => {
  assert.ok(P.some(p => p.chi === 'SOMET ENERGIA' && p.importo === 30));
  assert.ok(!P.some(p => /:/.test(p.chi)));
});

test('le pratiche prima dell\'anno di partenza sono ignorate', () => {
  assert.ok(!P.some(p => p.rif < '2026-01-01'));
});

test('ordine: dalla più recente', () => {
  const rif = P.map(p => p.rif);
  assert.deepStrictEqual(rif, rif.slice().sort().reverse());
});

test('apiDati: totali coerenti con le pratiche', () => {
  const d = E.apiDati();
  const bollette = P.filter(p => p.area === 'bollette').reduce((s, p) => s + p.importo, 0);
  assert.strictEqual(Math.round(bollette), 368);
  assert.ok(Array.isArray(d.anomalie));
});

test('una pratica "Da verificare" viene ripresa e completata da sola, una volta sola', () => {
  const E = carica(); riempi(E);
  const sh = E.__fogli.BOLLETTAZIONE;
  const h = sh.righe[0];
  const riga = new Array(h.length).fill('');
  const set = (k, v) => { riga[h.indexOf(k)] = v; };
  set('FORNITORE', 'SOMET ENERGIA'); set('DATA EMISSIONE', new E.Date('2026-11-10T12:00:00')); set('STATO PAGAMENTO', 'Da verificare'); set('OGGETTO MAIL', 'Fattura');
  h.push('ID MAIL', 'NOTE OCR', 'TASK ID'); riga.push('m1', 'campi trovati 1/4', 'T1');
  sh.righe.push(riga);
  E.GmailApp.getMessageById = () => ({ getFrom: () => 'Somet <a@b.it>', getSubject: () => 'Fattura', getAttachments: () => [],
    getPlainBody: () => 'Fattura n. 7 del 10/11/2026 gas naturale consumo 50 Smc PDR 01234567890123\nTotale da pagare € 52,10\nScadenza 30/11/2026' });
  assert.strictEqual(E.riprovaDaVerificare_(), 1);
  const r = sh.righe[sh.righe.length - 1], col = k => r[sh.righe[0].indexOf(k)];
  assert.strictEqual(col('STATO PAGAMENTO'), 'Da pagare');
  assert.strictEqual(col('IMPORTO'), 52.1);
  assert.strictEqual(col('FORNITURA'), 'Gas');
  assert.match(col('NOTE OCR'), /completata da sola/);
  assert.strictEqual(E.riprovaDaVerificare_(), 0, 'non la riprova di nuovo');
});
