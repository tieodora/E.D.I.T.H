const test = require('node:test');
const assert = require('node:assert');
const { carica } = require('./carica');
const riempi = require('./dati');

function conversa(domande) {
  const E = carica(); riempi(E);
  const storia = [];
  return domande.map(q => {
    const r = E.apiChiedi(q, storia.slice(-8));
    storia.push({ ruolo: 'io', testo: q }, { ruolo: 'edith', testo: r.testo, seguito: r.seguito });
    return r;
  });
}
const una = q => conversa([q])[0];

test('saluta Teo al femminile', () => {
  assert.match(una('edith sono io').testo, /\bTeo\b/);
  assert.doesNotMatch(una('ciao').testo, /Theodore/);
});

test('spesa di un mese, con la proposta di confronto', () => {
  const r = una('quanto ho speso a settembre?');
  assert.match(r.testo, /€ 165,00/);
  assert.match(r.seguito || '', /confronta agosto e settembre/);
});

test('domanda di seguito: "e a luglio?" riusa il contesto', () => {
  const [, r] = conversa(['quanto ho speso a settembre?', 'e a luglio?']);
  assert.match(r.testo, /€ 107,00/);
  assert.match(r.testo, /luglio/);
});

test('accetta la proposta con un "sì"', () => {
  const [, r] = conversa(['devo pagare qualcosa?', 'sì']);
  assert.match(r.testo, /Mancano 40 giorni/);
});

test('bolletta più cara e prossima scadenza', () => {
  assert.match(una('qual è la bolletta più cara').testo, /Piemonte Energy.*€ 135,00/);
  assert.match(una('prossima scadenza').testo, /AXA.*30\/12\/2026/);
});

test('il fornitore "SOMET ENERGIA" non viene scambiato per la luce', () => {
  const r = una('quanto ho pagato a somet energia?');
  assert.doesNotMatch(r.testo, /luce/i);
});

test('anomalie: trova la riga doppia', () => {
  assert.match(una('ci sono anomalie?').testo, /doppia/);
});

test('rumore di fondo: frase senza senso → capito false (l\'app la ignora)', () => {
  assert.strictEqual(una('blu frigo').capito, false);
});

test('previsione a fine anno', () => {
  assert.match(una('quanto spenderò a fine anno').testo, /€ 368,00.*fine anno/);
});

test('mai cancellazioni: nessuna risposta propone di eliminare definitivamente', () => {
  for (const q of ['pulisci la posta', 'cancella tutto', 'svuota il cestino']) assert.doesNotMatch(una(q).testo, /definitiv/i);
});
