const test = require('node:test');
const assert = require('node:assert');
const { carica } = require('./carica');
const riempi = require('./dati');
const nuovo = () => { const E = carica(); riempi(E); return E; };
const chiedi = (E, q) => E.apiChiedi(q, []);

test('"ho fatto benzina, sono 50 euro" finisce nel foglio SPESE con giorno, importo e tipologia', () => {
  const E = nuovo();
  const r = chiedi(E, 'ho fatto benzina, sono 50 euro');
  assert.match(r.testo, /Segnato: benzina, € 50,00, oggi/);
  const righe = E.__fogli.SPESE.righe, h = righe[0];
  assert.deepStrictEqual(h.slice(0, 3), ['DATA', 'IMPORTO', 'TIPOLOGIA']);
  const u = righe[righe.length - 1];
  assert.strictEqual(u[h.indexOf('IMPORTO')], 50);
  assert.strictEqual(u[h.indexOf('TIPOLOGIA')], 'Benzina');
  assert.strictEqual(E.Utilities.formatDate(u[h.indexOf('DATA')], '', 'yyyy-MM-dd'), '2026-11-20');
});

test('altre frasi: ieri, decimali, senza la parola euro', () => {
  const E = nuovo();
  assert.match(chiedi(E, 'ieri ho speso 23,40 euro al supermercato').testo, /spesa, € 23,40, il 19\/11\/2026/);
  assert.match(chiedi(E, 'ho fatto il pieno, sono 60').testo, /benzina, € 60,00/);
  assert.match(chiedi(E, 'segna 12 euro di farmacia').testo, /salute, € 12,00/);
  assert.match(chiedi(E, 'ho pagato 5 euro di parcheggio').testo, /auto, € 5,00/);
});

test('"ho pagato l\'AXA" resta il pagamento della pratica, non una spesa', () => {
  const E = nuovo();
  const r = chiedi(E, 'ho pagato l\'axa');
  assert.strictEqual(r.azione && r.azione.tipo, 'pagata');
});

test('annulla toglie l\'ultima spesa detta a voce', () => {
  const E = nuovo();
  chiedi(E, 'ho fatto benzina, sono 50 euro');
  assert.match(chiedi(E, 'annulla l\'ultima spesa').testo, /tolto Benzina/);
  assert.strictEqual(E.spese_().length, 0);
});

test('affitto: copiato una volta al mese dal foglio SPESE FISSE', () => {
  const E = nuovo();
  assert.strictEqual(E.registraSpeseFisse_(), 1);
  assert.strictEqual(E.registraSpeseFisse_(), 0, 'non lo copia due volte nello stesso mese');
  const s = E.spese_();
  assert.strictEqual(s[0].importo, 300);
  assert.strictEqual(s[0].tipo, 'Casa');
  assert.match(E.__fogli['SPESE FISSE'].righe[1].join(' '), /Affitto 300 1 Casa SI/);
});

test('domande: quanto ho speso di benzina, spese del mese', () => {
  const E = nuovo();
  E.registraSpeseFisse_();
  chiedi(E, 'ho fatto benzina, sono 50 euro');
  chiedi(E, 'ho fatto benzina, sono 30 euro');
  assert.match(chiedi(E, 'quanto ho speso di benzina questo mese?').testo, /€ 80,00 di benzina \(2 volte\)/);
  assert.match(chiedi(E, 'quanto ho di spese del mese?').testo, /€ 380,00.*casa € 300,00.*benzina € 80,00/);
  assert.match(chiedi(E, 'l\'ultima spesa di benzina').testo, /€ 30,00|€ 50,00/);
  const d = E.apiDati();
  assert.strictEqual(d.spese.mese, 380);
});

test('le domande sulle bollette non diventano spese', () => {
  const E = nuovo();
  assert.match(chiedi(E, 'quanto ho speso a settembre').testo, /€ 165,00/);
  assert.strictEqual(E.spese_().length, 0);
});
