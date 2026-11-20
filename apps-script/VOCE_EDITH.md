# EDITH: una sola app, con il microfono vero (10 minuti)

L'app completa (Home, Pratiche, Posta, Edith) è già nel tuo repository GitHub, con il microfono vero e la tua icona. Lo script lavora dietro le quinte e non lo apri più. Tu devi solo aggiornare lo script, creare il token e collegare il telefono.

## 1. Aggiorna lo script
**Da adesso puoi saltare questo passo per sempre:** segui [AUTOMATICO.md](AUTOMATICO.md) una volta e lo script si aggiorna da solo da GitHub. Se preferisci farlo a mano un'ultima volta:

1. In `EDITH.gs` sostituisci tutto con il nuovo [EDITH.gs](EDITH.gs) e salva. È un unico file con tutte le novità.
2. In `Index` sostituisci tutto con [Index.html](Index.html) e salva.
3. Nel menu delle funzioni scegli **installaNovita** e premi **Esegui**. Google ti chiede di nuovo l'autorizzazione (ora EDITH ti scrive anche delle mail): accetta. Ti arriva subito una mail "[EDITH] Avvisi attivi".

## 2. Crea il token segreto
1. In alto, nel menu delle funzioni, scegli **creaTokenVoce** e premi **Esegui**.
2. Nel registro compare `Token creato. Copialo: ...`. Copia quel codice e tienilo da parte (per esempio in Note).
3. Il token dura 90 giorni e ogni 30 giorni l'app ne riceve uno nuovo da sola, senza che tu faccia niente. Scade solo se non apri EDITH per tre mesi: in quel caso rilancia `creaTokenVoce`. Se hai già un token, continua a valere.

## 3. Pubblica l'accesso per la pagina vocale
1. **Esegui il deployment › Nuovo deployment**, ingranaggio › **App web**.
2. Descrizione: `Voce`. Esegui come: **Me**. Chi ha accesso: **Chiunque**.
3. **Esegui il deployment** e copia l'URL che finisce con `/exec`.

È sicuro: chi apre quell'URL vede solo "EDITH è privata". L'app funziona solo con il token. Le operazioni che cancellano mail chiedono sempre conferma e mandano tutto nel Cestino. Il token non condividerlo con nessuno.

4. Aggiorna anche l'app di sempre: **Gestisci deployment ›** quello "Solo io" › matita › Versione: **Nuova versione** › Esegui il deployment.

## 4. Attiva la pagina su GitHub (una volta sola)
Il repository ora è privato, e con l'account gratuito GitHub Pages funziona solo sui repository pubblici. Nella pagina non c'è nessun dato tuo né il token, quindi renderlo pubblico non espone niente.
1. Apri il repository **E.D.I.T.H** › **Settings** › **General**, in fondo **Danger Zone** › **Change visibility** › **Make public** e conferma.
2. Sempre in **Settings**, apri **Pages**. Source: **Deploy from a branch**. Branch: **main**, cartella **/ (root)** › **Save**.
3. Dopo un minuto la pagina è su **https://tieodora.github.io/E.D.I.T.H/**.

## 5. Collega il telefono
1. Apri **https://tieodora.github.io/E.D.I.T.H/** con **Chrome** (Android) o **Safari** (iPhone).
2. Incolla l'URL `/exec` e il token, poi tocca **Collega**. Il telefono li ricorda, non serve rifarlo.
3. Tocca 🎙 e consenti il microfono quando il browser lo chiede.
4. Mettila sulla Home: Condividi › **Aggiungi alla schermata Home** (iPhone) oppure ⋮ › **Aggiungi a schermata Home** (Android).

## Come si usa
- **Apri l'app e parla.** EDITH ti saluta e ti ascolta subito, senza tasti. Quando chiudi l'app o passi a un'altra, smette di ascoltare.
- **La sfera:** respira quando ti ascolta, gira veloce quando ci pensa e pulsa a ritmo quando parla. Toccala per mettere in pausa o riprendere, oppure per interromperla mentre parla.
- **"Basta"** o **"a dopo"** la mettono in pausa. Per riprendere, tocca la sfera.
- **Rumori e radio:** le frasi corte che non capisce, per esempio un pezzo di radio, le ignora in silenzio invece di rispondere.
- **La prima volta** il telefono può chiederti un tocco sullo schermo prima di farla parlare: è una regola dei browser. Basta toccare una volta.
- In ⚙︎ puoi spegnere l'ascolto automatico o la voce e scegliere una voce diversa.

## Cosa sa fare
- Scadenze, spese, confronti tra mesi, "e il mese scorso?", "quanto manca alla scadenza?", "la bolletta più cara".
- **Controllo anomalie:** "ci sono anomalie?" o "va tutto bene?". Cerca bollette molto sopra la tua media, pagamenti scaduti, rate di assicurazione mai arrivate, fornitori che non mandano bollette da più di 75 giorni, pratiche lette male, righe doppie, controllo automatico fermo e spazio quasi pieno. Le trovi anche in Home, nel riquadro "Controllo sistema".
- **Previsione:** "quanto spenderò a fine anno?".
- **Consigli:** "consigli per risparmiare", basati sui tuoi dati.
- **Briefing:** il primo saluto della mattina, o quando chiedi "briefing".
- Chiacchiere: "come stai", "mi senti", "raccontami una barzelletta", "che ore sono".
- Ogni lunedì alle 8 una mail di riepilogo, e una mail se qualcosa si rompe.
- **Posta:** "Esegui azioni scelte" ora rifà l'azione anche su un mittente già trattato, se cambi la scelta, e alla fine ti dice quante azioni sono riuscite.

## IA sul telefono (sperimentale, gratis)
In ⚙︎ accendi **Usa l'IA locale quando non capisco**. La prima volta il telefono scarica un piccolo modello (circa 1 GB, meglio col Wi-Fi), poi resta salvato. Gira tutto sul telefono: niente abbonamenti e i tuoi dati non escono da lì.
- Le risposte su importi e scadenze restano quelle precise di sempre. L'IA risponde solo alle domande che le regole non capiscono, e la bolla porta la scritta "IA locale".
- Serve Chrome aggiornato (sul tuo S23 va bene). Le prime risposte possono metterci qualche secondo, e il telefono si scalda un po' mentre la usi.
- Se non ti convince, spegni l'interruttore e EDITH torna come prima.

## Sicurezza e registro accessi
- Nello Sheet c'è il foglio **ACCESSI**: ogni domanda o azione fatta dall'app, i rinnovi del token e i tentativi rifiutati.
- Se qualcuno sbaglia il token 5 volte in un'ora ti arriva una mail.

## Una voce meno robotica (gratis)
EDITH usa le voci già presenti sul telefono e sceglie da sola la migliore. Le voci di qualità però vanno scaricate una volta:
- **Android (il tuo S23):** Impostazioni › cerca **Sintesi vocale** › Motore: **Servizi vocali di Google** › ingranaggio › Installa dati vocali › **Italiano** › scegli una voce e scaricala.
- **iPhone:** Impostazioni › Accessibilità › Contenuti letti ad alta voce › Voci › **Italiano** › scarica **Federica (Premium)**.

Poi in EDITH tocca ⚙︎ › **Voce di Edith** e premi **Prova la voce**.

## Aprirla con la voce da telefono bloccato
Di' "**Ok Google, apri EDITH**": si apre e ti ascolta subito.

## Se qualcosa non va
- **Non mi sente:** controlla che il microfono sia consentito per il sito (lucchetto nella barra di Chrome › Autorizzazioni) e che in ⚙︎ "Ti ascolto appena apri l'app" sia acceso.
- **"Il token non è valido" o "scaduto":** rilancia `creaTokenVoce`, poi tocca ⚙︎ e incolla il nuovo token.
- **Telefono perso o token finito in mani sbagliate:** rilancia `creaTokenVoce`. Il vecchio token smette subito di funzionare; poi inserisci il nuovo dal ⚙︎.
- **Vecchia icona sulla Home:** quella dell'app Apps Script puoi toglierla, ora ti basta EDITH.
