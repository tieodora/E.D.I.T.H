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
