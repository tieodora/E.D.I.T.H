# EDITH: installazione (10 minuti)

## 1. Incolla il codice
1. Apri il progetto Apps Script.
2. Copia tutto il contenuto di `EDITH.gs` e incollalo al posto del contenuto di `Codice.gs`. Se preferisci file separati, crea un file per ognuno di quelli in `src/` (`00_Config.gs` … `08_Setup.gs`).
3. Vai su **Impostazioni progetto** (ingranaggio) e spunta **"Mostra il file manifest appsscript.json nell'editor"**. Poi apri `appsscript.json` e sostituiscilo con quello di `src/appsscript.json`. Così si attivano Drive (per l'OCR), Gmail e Tasks.
   In alternativa: **Servizi +** e aggiungi *Drive API* (v3), *Gmail API* e *Tasks API*.
4. Salva (Ctrl+S).

## 2. Controlla la configurazione
In cima al codice (`CONFIG`):
- `LABEL_BOLLETTE: 'bollettazione'`
- `LABEL_ASSICURAZIONI: 'ASSICURAZIONI'` 

## 3. Installa e autorizza
1. Nell'editor scegli la funzione **`setup`** e premi **Esegui**.
2. Google chiede le autorizzazioni (Gmail, Calendar, Drive, Tasks, Sheets). Compare "Google non ha verificato l'app": è normale per uno script tuo. Clicca **Avanzate**, poi **Vai a EDITH (non sicuro)**, poi **Consenti**.
3. Ricarica lo Sheet: compare il menu **EDITH**.

`setup` crea i fogli mancanti (le tue colonne di BOLLETTAZIONE restano dove sono, le nuove vanno in coda), il calendario **EDITH Scadenze**, la lista attività **EDITH Pagamenti** e questi automatismi:

| Ogni | Cosa |
|---|---|
| ora | legge le nuove mail con etichetta bollettazione/assicurazioni |
| 15 min | sincronizza gli stati di pagamento |
| giorno, alle 6 | aggiorna i grafici |
| domenica | aggiorna gli elenchi iscrizioni e mail pesanti (solo lettura) |

## Come funziona

**Bollette e assicurazioni.** Per ogni mail nuova il PDF viene letto con l'OCR di Google Drive (il file temporaneo viene cancellato subito). Lo script ricava tipo di fornitura (o ramo assicurativo), data di emissione, data di scadenza e importo, e aggiunge una riga allo Sheet. Se un dato manca, lo stato è **Da verificare**: correggi a mano, poi usa *EDITH > Ricrea promemoria riga selezionata*. Per le assicurazioni lo script segna anche il semestre e la **prossima rata prevista** (6 mesi dopo).

**Promemoria e "Conclusa".** Per ogni scadenza lo script crea due cose:
- un **evento** nel calendario *EDITH Scadenze* alle 9:00 del giorno di scadenza, con avviso popup ed email **2 giorni prima**;
- un'**attività** in *EDITH Pagamenti* (Google Tasks), visibile in Google Calendar e nel pannello laterale di Gmail.

Quando hai pagato, **spunta l'attività**: entro 15 minuti la pratica diventa **Conclusa** nello Sheet e l'evento diventa "✅ Pagato". Funziona anche al contrario: se scrivi "Conclusa" nello Sheet, l'attività si spunta da sola.
*Perché due oggetti:* gli eventi di Calendar non hanno lo stato "completato", mentre le attività non permettono un avviso 2 giorni prima. Insieme coprono entrambe le cose.

**Grafici.** Il foglio DASHBOARD mostra la spesa mensile per tipo, l'andamento totale, la ripartizione degli ultimi 12 mesi, il totale per anno e le assicurazioni per anno, più le prossime scadenze. I calcoli stanno in RIEPILOGO.

**Iscrizioni.** Usa *EDITH > Analizza iscrizioni*: il foglio ISCRIZIONI elenca i mittenti di newsletter degli ultimi 6 mesi, con numero di mail e spazio occupato. Nella colonna AZIONE scegli cosa fare (Disiscrivi, cestina le esistenti, blocca le future, archiviale in EDITH/newsletter), poi usa *EDITH > Esegui azioni iscrizioni…*. Prima di agire chiede conferma. Se il metodo è "Manuale", apri tu il link.

**Spazio.**
- *Anteprima pulizia*: per ogni regola del foglio PULIZIA mostra quante mail trova e quanti MB stimati libera. Non tocca la posta.
- *Esegui pulizia…*: applica solo le regole con la spunta ESEGUI, dopo conferma. Puoi aggiungere regole tue scrivendo una ricerca Gmail.
- *Report mail pesanti*: elenca le 200 mail più grandi (oltre 5 MB). Spunta CESTINA e usa *Cestina mail pesanti selezionate…*.
- In alto a destra in PULIZIA vedi lo spazio usato (Gmail, Drive, Foto) e il limite.

**Sicurezza.** Le mail con stella, importanti, bollette e assicurazioni non vengono mai toccate. Nulla viene cancellato in automatico: le azioni distruttive partono solo dal menu, dopo conferma, e finiscono nel Cestino (recuperabile per 30 giorni). Lo spazio si libera davvero quando il Cestino si svuota: dopo 30 giorni, o subito se lo svuoti tu. Ricorda che archiviare non libera spazio.

## Problemi comuni
- **"Drive is not defined" / "Tasks is not defined"**: manca il punto 1.3 (servizi avanzati).
- **Nessuna riga creata**: controlla il foglio LOG e il nome delle etichette in `CONFIG`.
- **PDF protetti da password**: l'OCR non riesce a leggerli. La riga resta *Da verificare*, con i dati presi dal testo della mail quando possibile.
- **Prima esecuzione con molte mail arretrate**: ogni giro elabora fino a 12 conversazioni (per stare nei 6 minuti di Apps Script). Il trigger orario smaltisce l'arretrato da solo, oppure rilancia il menu più volte.
