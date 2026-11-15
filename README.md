# HarzScan – Foto-App für die Harzfleck-Erkennung

Web-App, die man per Link auf dem Handy öffnet (kein App Store, kein Konto für Helfer).
Sie führt durch drei Fotos pro Fleck, zeigt eine Wasserwaage und lädt die Fotos in die Cloud.

| Datei | Wofür |
|---|---|
| `index.html`, `app.js` | Die App für die Helfer (Kamera, Wasserwaage, Upload) |
| `admin.html`, `admin.js` | Deine Seite: Galerie, Labeln, CSV-Export (mit Login) |
| `style.css` | Aussehen beider Seiten |
| `config.js` | **Die einzige Datei, die du anpassen musst** (Supabase-Schlüssel) |
| `supabase/setup.sql` | Richtet Datenbank, Speicher und Zugriffsregeln ein |

---

## Schritt 1 – Online stellen mit GitHub Pages (ca. 10 Min.)

Danach läuft die App bereits im **Demo-Modus**: Kamera und Wasserwaage funktionieren,
die Fotos bleiben aber auf dem Handy.

1. Auf github.com oben rechts **+ → New repository**.
2. Name: `harzscan`, Sichtbarkeit **Public** (GitHub Pages ist für private Repos kostenpflichtig), **Create repository**.
3. Auf der neuen Seite den Link **„uploading an existing file“** anklicken.
4. Alle Dateien aus diesem Ordner hineinziehen (auch den Ordner `supabase`). Unten **Commit changes**.
5. Im Repo oben **Settings → Pages**. Bei „Branch“ **main** und **/(root)** wählen, **Save**.
6. 1–2 Minuten warten, Seite neu laden. Oben steht dann der Link, z. B.
   `https://DEIN-NAME.github.io/harzscan/`
7. Den Link auf dem iPhone in **Safari** öffnen und testen. Tipp: Teilen → „Zum Home-Bildschirm“ – dann sieht es aus wie eine echte App.

> Kamera und Bewegungssensor funktionieren nur über **https** – bei GitHub Pages ist das automatisch so.

## Schritt 2 – Cloud-Speicher mit Supabase (ca. 15 Min., kann später kommen)

1. Auf supabase.com kostenlos registrieren (geht mit dem GitHub-Konto).
2. **New project**: Name `harzscan`, ein sicheres Datenbank-Passwort (aufschreiben), Region **Central EU (Frankfurt)**.
3. Links **SQL Editor → New query**, den kompletten Inhalt von `supabase/setup.sql` einfügen, **Run**. Es sollte „Success“ erscheinen.
4. Links **Authentication → Sign In / Providers**: „Allow new users to sign up“ **ausschalten**. (Wichtig! Sonst kann sich jeder als Admin registrieren.)
5. **Authentication → Users → Add user → Create new user**: deine E-Mail und ein Passwort. Das ist dein Admin-Login.
6. **Project Settings → API** (oder „API Keys“): die **Project URL** und den **anon / publishable key** kopieren.
7. In GitHub die Datei `config.js` öffnen, auf den Stift (Bearbeiten) klicken und eintragen:
   ```js
   supabaseUrl: "https://xxxx.supabase.co",
   supabaseAnonKey: "sb_publishable_...",
   ```
   Dann **Commit changes**. Nach ca. 1 Minute ist die neue Version online.
8. Testen: Ein Foto in der App machen → `https://DEIN-NAME.github.io/harzscan/admin.html` öffnen, anmelden, Foto sollte in der Galerie sein.

Fotos, die im Demo-Modus auf einem Handy gespeichert wurden, werden danach beim nächsten Öffnen der App automatisch hochgeladen.

> Der „anon/publishable key“ darf öffentlich in `config.js` stehen – dafür ist er gemacht. Die Regeln aus `setup.sql` sorgen dafür, dass anonyme Nutzer nur hochladen, aber nichts sehen oder löschen können. Den **service_role / secret key** dagegen **niemals** in eine Datei schreiben.

## Was du wissen solltest

- **Kostenloser Tarif:** 1 GB Speicher (ca. 250–300 Fotos in voller Auflösung). Das Projekt wird nach einer Woche ohne Nutzung pausiert – im Supabase-Dashboard mit einem Klick wieder starten. Für die eigentliche Datensammlung ggf. auf Pro upgraden oder bei der Hochschule nach Speicher fragen.
- **Live-Kamera vs. Systemkamera:** Die Live-Kamera (mit Rahmen und Wasserwaage) liefert je nach iPhone eine geringere Auflösung als die normale Kamera. Unten rechts lässt sich auf „Systemkamera“ umschalten – volle Auflösung, aber ohne Wasserwaage im Bild. Die Auflösung steht unter dem Auslöser.
- **Funkloch in der Halle:** Fotos werden zuerst auf dem Handy gespeichert (IndexedDB) und laden automatisch hoch, sobald wieder Netz da ist. Die App dafür einfach nochmal öffnen.
- **Missbrauch:** Wer den Link hat, kann Fotos hochladen. Für einen Pilot mit bekannten Helfern ist das okay. Unsinnige Einträge löschst du in der Admin-Seite.
- **Neigung:** Zu jedem Foto wird gespeichert, wie schief das Handy war (`tilt`: Abweichung von waagerecht und Kamerawinkel zum Boden). Nützlich für die Auswertung in der Arbeit.

## Wenn etwas nicht geht

| Problem | Lösung |
|---|---|
| Kamera bleibt schwarz | iPhone: Einstellungen → Safari → Kamera → „Erlauben“. Seite neu laden. |
| Wasserwaage zeigt „–“ | Beim ersten Tippen auf „Fotos aufnehmen“ die Frage nach „Bewegung & Ausrichtung“ erlauben. Sonst Safari-Tab schließen und neu öffnen. |
| „Fotos warten auf Upload“ | Netz prüfen, „Jetzt erneut versuchen“. Steht dort eine Fehlermeldung, die an Claude schicken. |
| Admin: „Fehler beim Laden“ | Ist das Supabase-Projekt pausiert? Im Dashboard „Restore project“. |
