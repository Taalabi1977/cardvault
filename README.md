# CardVault

A private business card file for your phone. You photograph a card, the phone reads it, and the contact is saved, encrypted, together with where and when you met, tags, notes, an event photo and a follow-up reminder.

## Features

- **Card reading on the phone.** Text recognition (Tesseract) runs on the device, with no upload. Languages included: English, French, Arabic, Spanish and German. Front and back of the card.
- **Field detection.** Finds the name, job title, company, phones (with labels such as mobile, work, fax), emails, website and address. Works with Latin and Arabic cards, including Arabic-Indic digits and right-to-left lines. Any line can be tapped and moved into a different field.
- **Context.** Records the date, place and event where you met, plus tags, notes and a photo from the event. Scanning many cards at one trade fair? Tick "Use this … for my next cards".
- **Follow-ups.** Groups reminders as overdue, today, next 7 days or later. A reminder can be added to the phone calendar (.ics file with an alert).
- **Search.** Instant search across every field, including the full text of the card. Filter by tag or by event.
- **After saving a card**, three choices: keep it in CardVault only, **add it to the phone's contacts**, or **export it to Excel and send it**.
- **Phone contacts.** The contact gets every field, the photo of the card, and a note with where and when you met, tags, follow-up and notes.
- **Excel.** Export one card, the cards on screen (for example one event or one tag) or all cards to a real .xlsx file. The phone's share menu then offers WhatsApp, WeChat, Mail, AirDrop, Bluetooth, Save to Files or Drive.

## Security

| What | How |
|---|---|
| Encryption | AES-256-GCM on every contact and every photo. Each record is bound to its own ID, so records cannot be swapped. |
| Key | Derived from the master password with PBKDF2-SHA256 at 600,000 rounds. It is held in memory only while the app is unlocked. |
| Password rules | At least 12 characters, three types of character (or 20+ characters), and not a common password. |
| Wrong passwords | After 5 wrong tries the app makes you wait 30 s, and the wait doubles each time (up to 1 h). |
| Auto-lock | Locks after 1 to 15 minutes without use (you choose), and when the app stays in the background for over 1 minute. The screen is blurred in the app switcher. |
| Network | None. No account, server, analytics or third-party fonts. A Content-Security-Policy blocks all outside connections. |
| Backup | The backup file stays encrypted with your master password. |

**No password recovery.** If the master password is lost, the data cannot be opened. Keep a backup and keep the password somewhere safe.

## Install on your phone

CardVault is a web app (PWA). It is installed from a web address, not from an app store. It needs **HTTPS hosting**, and any free static host works. The simplest is GitHub Pages:

1. Create a free GitHub account, then a new repository (it can be private if you have GitHub Pro; otherwise public is fine, because the app code holds no data).
2. Upload everything in this folder.
3. In the repository, open **Settings → Pages**, choose "Deploy from branch", branch `main`, folder `/ (root)`.
4. Open the address shown (for example `https://yourname.github.io/cardvault/`):
   - **iPhone (Safari):** tap Share → **Add to Home Screen**.
   - **Android (Chrome):** tap ⋮ → **Install app**.

After that it opens like a normal app, full screen, and works offline. Your cards stay on your phone. The hosting only serves the app's code.

Other free hosts that work: Netlify, Cloudflare Pages, Vercel.

### Sharing with collaborators

Send them the same address. Each person gets an empty vault with their own password on their own phone. Nothing is shared between people unless you export a contact (.vcf) or a backup and send it to them.

## Updating the app (your cards are kept)

Your cards live in the phone's own storage for this web address, separate from the app's program files. An update replaces only the program files.

**To publish a new version** (GitHub Pages):
1. Open your `cardvault` repository on github.com.
2. Click **Add file → Upload files**.
3. Drag in **everything inside** the new `cardvault` folder. Files with the same name are replaced.
4. Click **Commit changes**. Wait 2 minutes.

**On the phone:** open CardVault with internet. It downloads the new version in the background, then shows **"A new version of CardVault is ready"**. Tap **Restart now** and enter your password. You can also go to **Settings → Check for updates**.

**What protects your data during an update:**
- The database is never deleted or rebuilt. New versions may only *add* storage.
- When a version changes how cards are stored, it first saves a safety copy, then converts all cards in one step: either every card is converted or none is.
- Old cards are always completed with any new fields, so they open in every later version.
- If downloading a new version fails halfway, the phone keeps the version it had.

**Important:** always keep the **same web address**. Each web address has its own storage on the phone. If you move the app to another address, export a backup first and import it in the new place.

**For developers:** with each release, raise `APP_VERSION` in `app.js` and `VERSION` in `sw.js` together. When the stored card format changes, raise `DATA_VERSION` and add a step to `MIGRATIONS`. Never delete an IndexedDB store.

## Try it on a computer

```bash
cd cardvault
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Tests

```bash
node tests/parser.test.js
node tests/xlsx.test.js /tmp/test.xlsx
```

## Files

```
index.html             app page
styles.css             design
app.js                 app logic: vault, encryption, screens, OCR, export
parser.js              turns card text into fields (pure functions, tested)
xlsx.js                builds Excel files on the phone (no outside library)
sw.js                  offline support
manifest.webmanifest   install-to-home-screen settings
icons/                 app icons
vendor/tesseract/      text recognition engine and language files (Apache-2.0)
tests/                 parser tests
```

## Known limits (version 1)

- Data lives in the browser storage of one phone. Export backups regularly. On iPhone, add the app to the Home Screen, which protects the storage from Safari's automatic clean-up.
- No Face ID / fingerprint unlock yet. It is planned with WebAuthn, or with the native app later.
- Reminders go through the phone calendar (.ics). Push notifications would need a server or a native app.
- Card reading works best on flat, well-lit, sharp photos. Stylised fonts and logos may need manual fixes.
