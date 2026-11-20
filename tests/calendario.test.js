const test = require('node:test');
const assert = require('node:assert');
const { carica } = require('./carica');
const riempi = require('./dati');
const nuovo = () => { const E = carica(); riempi(E); return E; };
const chiedi = (E, q) => E.apiChiedi(q, []);
const giorno = (E, d) => E.Utilities.formatDate(d, '', 'yyyy-MM-dd');
const ultimo = E => E.__eventi[E.__eventi.length - 1];

// nei test oggi è venerdì 20 novembre 2026, ore 12

test('"segna su calendar che devo comprare il latte" crea un evento di oggi', () => {
  const E = nuovo();
  const r = chiedi(E, 'segna su calendar che devo comprare il latte');
  assert.match(r.testo, /Segnato in calendario: Comprare il latte, oggi \(tutto il giorno\)/);
  const e = ultimo(E);
  assert.strictEqual(e.titolo, 'Comprare il latte');
  assert.strictEqual(e.tutto, true);
  assert.strictEqual(giorno(E, e.inizio), '2026-11-20');
});

test('data e ora dette nella frase', () => {
  const E = nuovo();
  const casi = [
    ['segna su calendar che devo comprare il pane domani', 'Comprare il pane', '2026-11-21', null],
    ['metti in agenda dentista lunedì alle 17', 'Dentista', '2026-11-23', '17:00'],
    ['aggiungi al calendario cena con Marta venerdì alle 20 e 30', 'Cena con marta', '2026-11-27', '20:30'],
    ['segna sul calendario il 3 dicembre revisione auto', 'Revisione auto', '2026-12-03', null],
    ['ricordami di chiamare la mamma dopodomani alle 6 di sera', 'Chiamare la mamma', '2026-11-22', '18:00'],
    ['segna in agenda che devo pagare il bollo tra una settimana', 'Pagare il bollo', '2026-11-27', null],
    ['mettimi in calendario parrucchiere alle 3', 'Parrucchiere', '2026-11-20', '15:00'],
  ];
  for (const [frase, titolo, data, ora] of casi) {
    const r = chiedi(E, frase);
    const e = ultimo(E);
    assert.strictEqual(e.titolo, titolo, frase + ' → ' + r.testo);
    assert.strictEqual(giorno(E, e.inizio), data, frase);
    if (ora) {
      assert.strictEqual(E.Utilities.formatDate(e.inizio, '', 'HH:mm'), ora, frase);
      assert.deepStrictEqual(e.promemoria, [30]);
    } else assert.strictEqual(e.tutto, true, frase);
  }
});

test('senza cosa da segnare chiede cosa scrivere, senza creare niente', () => {
  const E = nuovo();
  assert.match(chiedi(E, 'segna su calendar').testo, /Cosa ti segno/);
  assert.strictEqual(E.__eventi.length, 0);
});

test('cosa ho in calendario e annulla l\'ultimo evento', () => {
  const E = nuovo();
  chiedi(E, 'segna su calendar che devo comprare il latte domani');
  assert.match(chiedi(E, 'cosa ho in calendario domani?').testo, /Domani hai: Comprare il latte/);
  assert.match(chiedi(E, 'cosa ho in agenda oggi').testo, /oggi non hai niente/);
  assert.match(chiedi(E, 'annulla l\'ultimo evento').testo, /Tolto dal calendario: Comprare il latte/);
  assert.match(chiedi(E, 'cosa ho in calendario domani').testo, /non hai niente/);
});

test('le domande sulle bollette e le spese non diventano eventi', () => {
  const E = nuovo();
  chiedi(E, 'ho fatto benzina, sono 50 euro');
  chiedi(E, 'ricordami quando scade l\'assicurazione');
  chiedi(E, 'cosa devo pagare?');
  assert.strictEqual(E.__eventi.length, 0);
});
