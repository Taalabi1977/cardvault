# CardVault

A private business card file for your phone. You photograph a card, the phone reads it, and the contact is saved, encrypted, together with where and when you met, tags, notes, an event photo and a follow-up reminder.

## Features

- **Card reading on the phone.** Text recognition (Tesseract) runs on the device, with no upload. Languages included: English, French, Arabic, Spanish and German. Front and back of the card.
- **Field detection.** Finds the name, job title, company, phones (with labels such as mobile, work, fax), emails, website and address. Works with Latin and Arabic cards, including Arabic-Indic digits and right-to-left lines. Any line can be tapped and moved into a different field.
- **Context.** Records the date, place and event where you met, plus tags, notes and a photo from the event. Scanning many cards at one trade fair? Tick "Use this … for my next cards".
- **Follow-ups.** Groups reminders as overdue, today, next 7 days or later. A reminder can be added to the phone calendar (.ics file with an alert).
- **Search.** Instant search across every field, including the full text of the card. Filter by tag or by event.
- **Contacts out.** Export one contact or all of them as a .vcf file, which can go into the phone's address book or to a colleague.

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

## Try it on a computer

```bash
cd cardvault
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Tests

```bash
node tests/parser.test.js
```

## Files

```
index.html             app page
styles.css             design
app.js                 app logic: vault, encryption, screens, OCR, export
parser.js              turns card text into fields (pure functions, tested)
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
