# EDITH si aggiorna da sola (setup una tantum, 15 minuti, da computer)

Dopo questo setup non incolli più codice in Apps Script. Ogni volta che il codice su GitHub cambia:
1. partono i test sui casi reali (doppioni, date, importi, risposte di Edith, token);
2. se passano, GitHub carica lo script in Apps Script e crea una nuova versione del deployment **Voce**.
Se un test fallisce, non viene caricato niente e la tua EDITH resta com'era.

Tutto gratis: GitHub Actions è gratuito sui repository pubblici. I segreti stanno nei "Secrets" di GitHub, cifrati: non sono nel codice e nessuno li vede, neanche chi guarda il repository.

## 1. Accendi l'API di Apps Script
Apri https://script.google.com/home/usersettings e accendi **API Google Apps Script**.

## 2. Recupera tre codici
- **SCRIPT_ID**: in Apps Script › ⚙︎ **Impostazioni progetto** › **ID script** › Copia.
- **DEPLOYMENT_ID**: è il pezzo in mezzo all'URL Voce che hai nell'app: `https://script.google.com/macros/s/`**QUESTO**`/exec`.
- **SHEET_ID**: è il pezzo in mezzo all'URL dello Sheet EDITH: `https://docs.google.com/spreadsheets/d/`**QUESTO**`/edit`.

## 3. Crea la chiave per GitHub (CLASPRC_JSON)
Non devi installare niente: usi un computer virtuale gratuito di GitHub.
1. Apri il repository **E.D.I.T.H** su GitHub › bottone verde **Code** › scheda **Codespaces** › **Create codespace on main**. Si apre un editor nel browser.
2. In basso c'è il terminale. Incolla e premi Invio:
   ```
   npx -y @google/clasp@3.4.1 login --no-localhost
   ```
3. Apri il link che compare, scegli il tuo account Google e consenti.
4. Alla fine il browser mostra una pagina che non si carica ("localhost"): è normale. **Copia l'indirizzo completo dalla barra** e incollalo nel terminale, poi Invio. Deve comparire "You are logged in".
5. Incolla e premi Invio:
   ```
   cat ~/.clasprc.json
   ```
   Copia tutto il testo che compare, dalla prima `{` all'ultima `}`.
6. Chiudi la scheda. Da **github.com/codespaces** elimina il codespace (⋯ › Delete): non serve più.

## 4. Metti i segreti su GitHub
Repository **E.D.I.T.H** › **Settings** › **Secrets and variables** › **Actions** › **New repository secret**. Creane quattro:

| Name | Secret |
|---|---|
| `CLASPRC_JSON` | il testo copiato al punto 3 |
| `SCRIPT_ID` | l'ID script |
| `DEPLOYMENT_ID` | l'ID del deployment Voce |
| `SHEET_ID` | l'ID dello Sheet |

## 5. Primo aggiornamento
Repository › scheda **Actions** › **Prova e aggiorna EDITH** › **Run workflow** › **Run workflow**.
Dopo un paio di minuti compare la spunta verde. In Apps Script, al posto di `EDITH.gs`, vedrai i file divisi per argomento (`00_Config.gs`, `09_App.gs`, `11_Sicurezza.gs`…): è giusto così.

Se compare una X rossa, apri l'esecuzione e guarda il passo rosso: di solito è un segreto copiato a metà o l'API del punto 1 spenta.

## Da sapere
- La chiave CLASPRC_JSON permette a GitHub di aggiornare i tuoi script Apps Script e basta. Puoi revocarla quando vuoi da https://myaccount.google.com/permissions (voce "clasp").
- Il vecchio deployment "Solo io" non viene più aggiornato: ora basta l'app.
- Il codice resta leggibile in `apps-script/src`, un file per argomento.
