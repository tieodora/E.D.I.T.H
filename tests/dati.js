/** Sheet di prova costruito sui casi reali (stessi fornitori, una bolletta inoltrata con "Fwd:"). */
module.exports = function riempi(E) {
  const d = s => new E.Date(s + 'T12:00:00');
  E.__foglio('BOLLETTAZIONE', [
    ['FORNITURA', 'FORNITORE', 'N. DOCUMENTO', 'DATA EMISSIONE', 'DATA SCADENZA', 'IMPORTO', 'STATO PAGAMENTO', 'PAGATA IL', 'OGGETTO MAIL', 'LINK MAIL', 'DATA COMUNICAZIONE'],
    ['Luce e Gas', 'Piemonte Energy', 'A1', d('2026-09-16'), d('2026-10-16'), 135, 'Conclusa', '', 'La tua bolletta', '', d('2026-09-16')],
    ['Luce e Gas', 'Piemonte Energy', 'A1', d('2026-09-16'), d('2026-10-16'), 135, 'Conclusa', '', 'Fwd: La tua bolletta', '', d('2026-09-17')],
    ['Gas', 'SOMET ENERGIA: fattura', 'S1', d('2026-09-15'), d('2026-10-19'), 30, 'Conclusa', '', 'Fattura', '', d('2026-09-15')],
    ['Luce e Gas', 'Piemonte Energy', 'A0', d('2026-07-27'), d('2026-08-27'), 107, 'Conclusa', '', 'La tua bolletta', '', d('2026-07-27')],
    ['Luce e Gas', 'Piemonte Energy', 'Z9', d('2025-05-18'), d('2025-06-19'), 54, 'Conclusa', '', 'Vecchia', '', d('2025-05-18')],
    ['Gas', 'SOMET ENERGIA', 'S0', d('2026-05-18'), d('2026-06-22'), 96, 'Conclusa', '', 'Fattura', '', d('2026-05-18')],
  ]);
  E.__foglio('ASSICURAZIONE', [
    ['RAMO', 'COMPAGNIA', 'N. POLIZZA', 'DATA SCADENZA', 'IMPORTO', 'STATO PAGAMENTO', 'PAGATA IL', 'PROSSIMA RATA PREVISTA', 'OGGETTO MAIL', 'DATA COMUNICAZIONE'],
    ['Auto', 'AXA', 'P1', d('2026-12-30'), 779, 'Da pagare', '', d('2027-06-30'), 'Promemoria', d('2026-11-15')],
    ['Salute/Infortuni', 'Sara', 'P2', d('2026-09-25'), 95.42, 'Conclusa', d('2026-09-20'), d('2027-03-25'), 'Rata', d('2026-09-01')],
  ]);
};
