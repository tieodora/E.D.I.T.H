const test = require('node:test');
const assert = require('node:assert');
const { carica } = require('./carica');
const riempi = require('./dati');
const iso = (E, d) => d ? E.Utilities.formatDate(d, 'Europe/Rome', 'yyyy-MM-dd') : null;

// Testo come esce dall'OCR di una bolletta luce e gas (riquadro "La tua offerta", formato Bolletta 2.0)
const BOLLETTA_DUAL = `Piemonte Energy S.p.A.
Bolletta n. 2026/123456 del 16/09/2026
LA TUA OFFERTA
Nome offerta: Casa Sicura Fix 12
Codice offerta: 000123ESFML01XXCASASICURAFIX12
Mercato libero - Prezzo fisso e invariabile per 12 mesi
Le condizioni economiche sono valide fino al 31/12/2026
ENERGIA ELETTRICA
POD IT001E12345678 Potenza impegnata 3 kW
Prezzo componente energia 0,1180 €/kWh
Quota fissa commercializzazione 9,50 €/mese
Consumo annuo 2.150 kWh
Spesa per il trasporto 0,0089 €/kWh
GAS NATURALE
PDR 00881234567890
Prezzo materia gas 0,4900 €/Smc
Consumo annuo 820 Smc
Totale da pagare € 135,20 Data scadenza 16/10/2026`;

const BOLLETTA_PUN = `SOMET ENERGIA
Fattura n. 99 del 15/09/2026
Offerta: Gas Flex PSV
Prezzo variabile indicizzato PSV + spread 0,08 €/Smc
Prezzo gas del mese €/Smc 0,4523
Corrispettivo fisso € 120,00 /anno
PDR 01234567890123`;

test('offerta luce e gas: nome, prezzi, quota fissa, scadenza, codici', () => {
  const E = carica();
  const o = E.estraiOfferta_(BOLLETTA_DUAL);
  assert.strictEqual(o.offerta, 'Casa Sicura Fix 12');
  assert.strictEqual(o.mercato, 'Libero');
  assert.strictEqual(o.tipoPrezzo, 'Fisso');
  assert.strictEqual(o.prezzoLuce, 0.118, 'il prezzo dell\'energia, non quello del trasporto');
  assert.strictEqual(o.prezzoGas, 0.49);
  assert.strictEqual(o.quotaFissa, 9.5);
  assert.strictEqual(o.potenza, 3);
  assert.strictEqual(iso(E, o.scadenzaCondizioni), '2026-12-31');
  assert.strictEqual(o.consumoLuce, 2150);
  assert.strictEqual(o.consumoGas, 820);
  assert.strictEqual(o.pod, 'IT001E12345678');
  assert.strictEqual(o.pdr, '00881234567890');
});

test('offerta indicizzata: variabile PSV, quota annua convertita al mese', () => {
  const E = carica();
  const o = E.estraiOfferta_(BOLLETTA_PUN);
  assert.strictEqual(o.offerta, 'Gas Flex PSV');
  assert.strictEqual(o.tipoPrezzo, 'Variabile (PSV)');
  assert.strictEqual(o.quotaFissa, 10);
  assert.strictEqual(o.pdr, '01234567890123');
});

test('una mail qualsiasi non diventa un\'offerta', () => {
  const E = carica();
  assert.strictEqual(E.estraiOfferta_('Gentile cliente, la sua bolletta è disponibile. Totale € 30,00'), null);
});

test('salvataggio: una riga per fornitore, tiene i campi già noti', () => {
  const E = carica(); riempi(E);
  const d = s => new E.Date(s + 'T12:00:00');
  E.salvaOfferta_(E.estraiOfferta_(BOLLETTA_DUAL), 'Piemonte Energy', 'Luce e Gas', d('2026-09-16'), 'link1');
  // bolletta successiva senza POD: il POD resta
  E.salvaOfferta_(E.estraiOfferta_('Nome offerta: Casa Sicura Fix 12\nPrezzo componente energia 0,1250 €/kWh'), 'Piemonte Energy', 'Luce e Gas', d('2026-11-16'), 'link2');
  const O = E.offerte_();
  assert.strictEqual(O.length, 1);
  assert.strictEqual(O[0].prezzoLuce, 0.125);
  assert.strictEqual(O[0].pod, 'IT001E12345678');
  // una bolletta più vecchia non sovrascrive quella nuova
  E.salvaOfferta_(E.estraiOfferta_(BOLLETTA_DUAL), 'Piemonte Energy', 'Luce e Gas', d('2026-07-27'), 'link0');
  assert.strictEqual(E.offerte_()[0].prezzoLuce, 0.125);
});

test('Edith spiega l\'offerta, i codici e la scadenza delle condizioni', () => {
  const E = carica(); riempi(E);
  E.salvaOfferta_(E.estraiOfferta_(BOLLETTA_DUAL), 'Piemonte Energy', 'Luce e Gas', new E.Date('2026-09-16T12:00:00'), 'l');
  const chiedi = q => E.apiChiedi(q, []).testo;
  assert.match(chiedi('che offerta ho per la luce?'), /Casa Sicura Fix 12.*fisso.*0,118 euro al kWh.*9,50/);
  assert.match(chiedi('quanto pago la luce al kwh'), /0,118/);
  assert.match(chiedi('qual è il mio pod'), /POD I T 0 0 1/);
  assert.match(chiedi('quando scadono le condizioni economiche'), /31\/12\/2026/);
  assert.match(chiedi('ci sono anomalie'), /scadono il 31\/12\/2026, tra 41 giorni/);
  assert.match(chiedi('consigli per risparmiare'), /scadono tra \d+ giorni/);
});

test('senza offerte salvate Edith lo dice', () => {
  const E = carica(); riempi(E);
  assert.match(E.apiChiedi('che offerta ho?', []).testo, /non li ho ancora/);
});
