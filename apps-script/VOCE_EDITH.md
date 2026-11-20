# EDITH: una sola app, con il microfono vero (10 minuti)

L'app completa (Home, Pratiche, Posta, Edith) è già nel tuo repository GitHub, con il microfono vero e la tua icona. Lo script lavora dietro le quinte e non lo apri più. Tu devi solo aggiornare lo script, creare il token e collegare il telefono.

## 1. Aggiorna lo script
1. In `EDITH.gs` sostituisci tutto con il nuovo [EDITH.gs](EDITH.gs) e salva. È un unico file con tutte le novità.
2. In `Index` sostituisci tutto con [Index.html](Index.html) e salva.
3. Nel menu delle funzioni scegli **installaNovita** e premi **Esegui**. Google ti chiede di nuovo l'autorizzazione (ora EDITH ti scrive anche delle mail): accetta. Ti arriva subito una mail "[EDITH] Avvisi attivi".

## 2. Crea il token segreto
1. In alto, nel menu delle funzioni, scegli **creaTokenVoce** e premi **Esegui**.
2. Nel registro compare `Token creato. Copialo: ...`. Copia quel codice e tienilo da parte (per esempio in Note).

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

## Le novità
- **Riepilogo del lunedì:** ogni lunedì alle 8 ti arriva una mail con i pagamenti della settimana, le pratiche da controllare e lo spazio usato.
- **Avvisi:** se il controllo della posta si blocca, o se arriva una bolletta che EDITH non riesce a leggere, ti scrive una mail (al massimo una ogni 6 ore per lo stesso motivo).
- **Briefing del mattino:** il primo "Edith, sono io" della mattina ti dice che giorno è, cosa scade in settimana e cosa c'è da controllare. Puoi chiederlo quando vuoi con "briefing".
- **Nuove domande:** "quanto manca alla scadenza?", "la bolletta più cara", "la più economica", "cosa devo pagare?" ora ti dice anche il totale.
- **Più veloce e offline:** l'app si apre subito con gli ultimi dati salvati e funziona anche senza rete; appena c'è connessione si aggiorna da sola.
- **Posta:** nelle mail pesanti vedi quanto spazio libereresti e puoi selezionarle tutte con un tocco. Per le newsletter: **Analizza**, scegli per ognuna cosa fare, poi **Esegui azioni scelte**. Tutto ciò che si cancella finisce nel **Cestino** di Gmail: lo svuoti tu quando vuoi.

## Come si usa
- **Premi 🎙 e parla.** Quando smetti di parlare, EDITH risponde e legge la risposta ad alta voce (🔈 la zittisce).
- **Modalità auto, per la guida:** nella sezione Edith tocca 🚗. Dopo ogni risposta EDITH riascolta da sola. Di' "basta" o "a dopo" per chiudere. Se non sente niente per un po', si mette in pausa.
- **Conferme a voce:** dopo "ho pagato l'AXA" ti chiede conferma; rispondi "sì" o "no".
- **Seguiti:** "quanto ho speso di luce a luglio?" e poi "e a settembre?", "e il gas?", "e l'anno scorso?".
- **Chiacchiere:** "ok, bene", "grazie", "ciao", "come stai", "che ore sono", "ripeti" ricevono risposte brevi, senza riepiloghi.

## Attivarla con la voce, senza toccare niente
**Prima, una volta: calibra la frase.** Tocca ⚙︎ › **Calibra "Edith, sono io"** e ripeti la frase 5 volte. EDITH impara come la scrive il tuo telefono e da quel momento parte solo con quella: non con "Edith" da solo, non con "sono io" da solo, non dentro un discorso lungo.

**Dentro l'app: 👂 "sempre in ascolto".** Tocca 👂 in alto. Finché l'app è aperta e lo schermo acceso (EDITH lo tiene acceso da sola), basta dire **"Edith, sono io"** e parte la conversazione, come con Google Home. Quando dici "basta" torna ad aspettare. In macchina: telefono sul supporto, app aperta, 👂 acceso. Con lo schermo spento o l'app chiusa non può sentirti: è un limite dei telefoni per tutte le pagine web.

**Da telefono bloccato o con l'app chiusa: usa l'assistente del telefono (gratis).**
- **iPhone, con Siri:** apri l'app **Comandi Rapidi** › **+** › Aggiungi azione › cerca **Apri URL** › scrivi `https://tieodora.github.io/E.D.I.T.H/?ascolta=1`. In alto rinomina il comando in **Edith sono io**. Da ora dici "**Ehi Siri, Edith sono io**" ed EDITH si apre già in ascolto.
- **Android (il tuo S23), con Google:** di' "**Ok Google, apri EDITH**". Se avevi lasciato 👂 acceso, ti ascolta subito. Tenendo premuta l'icona trovi anche **Parla con Edith**, che apre direttamente la conversazione.

## Una voce meno robotica (gratis)
EDITH usa le voci già presenti sul telefono e sceglie da sola la migliore. Le voci di qualità però vanno scaricate una volta:
- **iPhone:** Impostazioni › Accessibilità › Contenuti letti ad alta voce › Voci › **Italiano** › scarica **Federica (Premium)** o **Alice (Avanzata)**.
- **Android:** Impostazioni › cerca **Sintesi vocale** › Motore: **Servizi vocali di Google** › ingranaggio › Installa dati vocali › **Italiano** › scegli una voce e scaricala.

Poi in EDITH tocca ⚙︎ › **Voce di Edith**, scegli la voce e premi **▶ Prova la voce**.

## Se qualcosa non va
- **Su iPhone il microfono non parte dall'icona sulla Home:** aprila da Safari, lì funziona sempre.
- **Non capisce "Edith, sono io" o parte quando non deve:** tocca ⚙︎ › **Calibra** e ripeti la frase 5 volte. Con **Prova** verifichi: la frase giusta deve dare ✅, una frase qualsiasi ❌. **Azzera** cancella quello che ha imparato.
- **"Il token non è valido":** tocca ⚙︎ e reincolla il token.
- **Telefono perso o token finito in mani sbagliate:** rilancia `creaTokenVoce`. Il vecchio token smette subito di funzionare; poi inserisci il nuovo dal ⚙︎.
- **Vecchia icona sulla Home:** quella dell'app Apps Script puoi toglierla, ora ti basta EDITH.
