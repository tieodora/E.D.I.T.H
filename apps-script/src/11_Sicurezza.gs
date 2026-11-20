/**
 * EDITH – sicurezza dell'app sul telefono.
 * - Il token dura 90 giorni. Dopo 30 giorni di uso l'app ne riceve uno nuovo da sola, senza che tu faccia niente;
 *   il vecchio resta valido ancora 7 giorni, così un secondo telefono non resta bloccato all'improvviso.
 * - Se non apri l'app per più di 90 giorni il token scade: rilancia creaTokenVoce e reinseriscilo.
 * - Ogni accesso finisce nel foglio ACCESSI. Se qualcuno sbaglia il token 5 volte in un'ora ti arriva una mail.
 */

const TOKEN_DURATA_GG = 90, TOKEN_RINNOVO_GG = 30, TOKEN_GRAZIA_GG = 7;

function nuovoToken_() { return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8); }

/** Lancia una volta (o per bloccare un telefono perso): crea un token nuovo e annulla tutti i precedenti. */
function creaTokenVoce() {
  const props = PropertiesService.getScriptProperties();
  const token = nuovoToken_();
  props.setProperties({ EDITH_TOKEN: token, EDITH_TOKEN_DATA: String(Date.now()) });
  props.deleteProperty('EDITH_TOKEN_VECCHIO'); props.deleteProperty('EDITH_TOKEN_VECCHIO_FINO');
  registraAccesso_('creaTokenVoce', 'nuovo token creato, i precedenti non valgono più');
  Logger.log('Token creato. Copialo: ' + token);
  Logger.log('Incollalo nell\'app (ingranaggio › Collegamento) insieme all\'URL del deployment Voce.');
  Logger.log('Dura 90 giorni e si rinnova da solo ogni 30 giorni mentre usi l\'app.');
  return token;
}

/**
 * Controlla il token. Risponde { ok, nuovo?, motivo? }.
 * "nuovo" è il token che l'app deve salvare al posto di quello vecchio.
 */
function verificaToken_(k) {
  const props = PropertiesService.getScriptProperties();
  const p = props.getProperties();
  const ora = Date.now(), gg = 864e5;
  if (!p.EDITH_TOKEN || !k) return { ok: false, motivo: 'token mancante' };
  if (uguali_(k, p.EDITH_TOKEN)) {
    let data = Number(p.EDITH_TOKEN_DATA || 0);
    if (!data) { data = ora; props.setProperty('EDITH_TOKEN_DATA', String(ora)); }   // token creato prima di questa versione
    if (ora - data > TOKEN_DURATA_GG * gg) return { ok: false, motivo: 'token scaduto' };
    if (ora - data > TOKEN_RINNOVO_GG * gg) {
      const lock = LockService.getScriptLock();
      if (lock.tryLock(3000)) {
        try {
          const fresco = props.getProperty('EDITH_TOKEN');
          if (fresco !== p.EDITH_TOKEN) return { ok: true, nuovo: fresco };   // l'ha già rinnovato un'altra richiesta
          const nuovo = nuovoToken_();
          props.setProperties({ EDITH_TOKEN: nuovo, EDITH_TOKEN_DATA: String(ora), EDITH_TOKEN_VECCHIO: p.EDITH_TOKEN, EDITH_TOKEN_VECCHIO_FINO: String(ora + TOKEN_GRAZIA_GG * gg) });
          registraAccesso_('rinnovo', 'token rinnovato automaticamente');
          return { ok: true, nuovo };
        } finally { lock.releaseLock(); }
      }
    }
    return { ok: true };
  }
  if (p.EDITH_TOKEN_VECCHIO && uguali_(k, p.EDITH_TOKEN_VECCHIO) && ora < Number(p.EDITH_TOKEN_VECCHIO_FINO || 0)) return { ok: true, nuovo: p.EDITH_TOKEN };
  return { ok: false, motivo: 'token errato' };
}

/** Registro accessi nel foglio ACCESSI (tiene le ultime 1000 righe). */
function registraAccesso_(funzione, esito) {
  try {
    const sh = sheet_(CONFIG.SHEET_ACCESSI);
    if (sh.getLastRow() === 0) sh.appendRow(['QUANDO', 'FUNZIONE', 'ESITO']);
    sh.appendRow([new Date(), funzione, esito]);
    if (sh.getLastRow() > 1000) sh.deleteRows(2, 200);
  } catch (e) { console.log('ACCESSI non scrivibile: ' + funzione + ' ' + esito + ' (' + e.message + ')'); }
}

/** Conta i tentativi falliti: al quinto nella stessa ora manda un avviso. */
function tentativoFallito_(motivo) {
  registraAccesso_('accesso', 'RIFIUTATO: ' + motivo);
  try {
    const props = PropertiesService.getScriptProperties();
    const ora = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyyMMddHH');
    const [h, n] = String(props.getProperty('FALLITI') || '').split(':');
    const conta = h === ora ? Number(n || 0) + 1 : 1;
    props.setProperty('FALLITI', ora + ':' + conta);
    if (conta === 5) notifica_('Tentativi di accesso falliti', ['Nell\'ultima ora qualcuno ha provato 5 volte ad aprire EDITH con un token sbagliato (' + motivo + ').',
      'Se non eri tu, lancia creaTokenVoce in Apps Script: il token cambia e chi ce l\'ha resta fuori. Il registro è nel foglio ACCESSI.'], 'falliti_' + ora);
  } catch (e) { }
}
