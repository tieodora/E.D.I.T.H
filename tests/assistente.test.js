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

// Frasi di italiano parlato: ognuna con un pezzo che la risposta deve contenere (o "capito: false").
const FRASI = [
  ['cosa scade questo mese', /novembre non scade niente.*AXA/],
  ['cosa scade a dicembre', /AXA/],
  ['ho bollette da pagare', /Nessuna bolletta da pagare.*AXA/],
  ['la prossima bolletta quando arriva', /Piemonte Energy.*circa ogni \d+ giorni/],
  ['quanto ho speso di luce quest\'anno', /sola luce non ne hai.*€ 242,00/],
  ['quanto ho speso di gas', /€ 126,00 di solo gas.*€ 242,00.*€ 368,00/],
  ['quanto ho speso in tutto', /€ 1\.242,42.*€ 368,00 di bollette.*€ 874,42 di assicurazioni/],
  ['quanto mi costa la macchina all\'anno', /€ 779,00/],
  ['la sara quanto costa', /€ 95,42/],
  ['quando ho pagato la sara', /pagata il 20\/09\/2026/],
  ['assicurazione salute', /€ 95,42/],
  ['quali assicurazioni ho', /2 assicurazioni.*AXA.*Sara/],
  ['spendo più di luce o di gas', /luce e gas € 242,00.*gas € 126,00/],
  ['riassunto', /€ 368,00 di bollette/],
  ['zitta', /./, r => r.fine === true],
  ['pulisci la posta', /Cestino/],
  ['ho mail pesanti', /Posta/],
  ['sono stanca', /Riposa|momento per te/],
  ['mi ricordi di pagare la luce', /Google Tasks/],
  ['quanto ho risparmiato', /non lo so dire/],
  ['come stai', /bene/i],
  ['che tempo fa', /meteo/],
  ['eh', null],
  ['boh', null],
];
for (const [q, atteso, extra] of FRASI) {
  test('frase parlata: "' + q + '"', () => {
    const r = una(q);
    if (atteso === null) return assert.strictEqual(r.capito, false, r.testo);
    assert.match(r.testo, atteso);
    assert.notStrictEqual(r.capito, false);
    if (extra) assert.ok(extra(r));
  });
}

test('conversazione: "sì" a una proposta di confronto', () => {
  const [, r] = conversa(['quanto ho risparmiato', 'sì']);
  assert.match(r.testo, /aumentato|diminuito|Stesso/);
});
