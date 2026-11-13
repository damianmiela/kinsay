# What to test before a commit reaches the server

The automatic tests (PowerShell, in this folder): `npm run check` (format, lint, types, unit and server tests), `npm run test:e2e` (the browser tests, builds first), `npm run test:load` (200 readers). They use a test server with throwaway data and a fake speech service; the checks below are what only a person can see.

## 1. The first version, locally (2026-11-12)

Prepare `.env` from `.env.example`: an admin password (12+ characters), a session secret (32+), `PRICE_EUR_PER_STREAM_HOUR` (e.g. `0.20`), and the new app's Soniox key for real captions. Then in PowerShell, in this folder:

```powershell
npm install
npm run build; npm start
```

Open http://localhost:3300/admin on the computer, and http://<the computer's address>:3300 on a phone in the same Wi-Fi (a phone's microphone needs https outside localhost: for the phone test use the computer's own browser at a phone size, or wait for the deploy).

- [ ] Admin: sign in with the password; People: invite someone without an email; their row shows €1.00 left.
- [ ] Their card: "Sign in a device" shows a QR code and six digits, valid 10 minutes.
- [ ] In another browser (or a private window): "I have a sign-in code", the six digits: signed in, Home shows €1.00. The same digits a second time: refused.
- [ ] Home: the language field opens a list with a search; "No translation" is always there; "tag" finds Tagalog (also called Filipino).
- [ ] Start without a translation: what is heard, each line with the language it was heard in; "Translate" opens the list; choosing one turns it into face to face.
- [ ] Face to face: the top half upside down with the translation, the bottom what is heard; "Turn off": the translation alone; the gear: face to face back, "Show what was heard", text size, Invite, Account.
- [ ] /privacy opens without signing in, names who is responsible and their email; its link is at the foot of the sign-in and Account pages.
- [ ] Face to face, talk until both halves are full: the top half follows its newest line exactly like the bottom one (turned round, the newest line by the far edge, never under the bar); scrolled back, "Latest" shows in that half and brings it back.
- [ ] Invite: a QR code and a 6-character code; another browser opens /join#CODE (or types it): "<name>'s captions", in the host's language; its gear picks another language.
- [ ] A wrong code: "No captions with this code".
- [ ] Account: the balance in euros, one line per session with its language and length, "Ask for more" (€1/2/5/10) shows in the admin's Requests; one tap there grants it.
- [ ] Admin Settings: the price and the limits save. A person's monthly limit; Block signs their devices out and stops their captions.
- [ ] With very little credit left (a correction in the admin), a running session stops by itself and says "Out of credits".

## 2. Email links and Google (2026-11-12)

In `.env`: `PUBLIC_URL=http://localhost:3300` (later the real address), `BREVO_API_KEY`, `MAIL_FROM` (a sender Brevo knows), and Google's `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Then `npm run build; npm start`.

- [ ] The sign-in page shows the email field and "Continue with Google" (each only when its keys are set).
- [ ] An invited person's email: "Check your email"; the email comes from the sender set, with a "Sign in to Translate" button.
- [ ] The link opens "Sign in on this device?": one tap signs in. The same link again: "doesn't work any more".
- [ ] An email that isn't invited: the same "Check your email" answer, and no email arrives.
- [ ] Google with an invited email: straight into Home. With another Google account: "no invitation yet" and the invitation form open.

## 3. The desktop app (2026-11-12)

Open translate.dendigital.de/download (or "Windows app" at any page's foot), download `Translate.exe` (one file, made with `node desktop/pack-win.mjs`) and start it: Windows warns once ("More info", "Run anyway": not signed yet). It opens translate.dendigital.de's subtitles window. Signed in already on this computer's browser or not, both should work.

- [ ] The window: dark glass, "Sign in to Translate", "Sign in in the browser". Pressing it opens the computer's normal browser at a "Sign in the desktop app?" page; the window shows six numbers.
- [ ] Not signed in in that browser: the sign-in page with "the desktop app is waiting for it"; after signing in (email, Google or a code) it comes back to the question by itself.
- [ ] The browser shows the same six numbers and the email. "Yes, sign it in": "Done." In a few seconds the window carries on by itself: Listen to, Translate into, Start. "No" in the browser: the window says it was refused.
- [ ] Account in the browser: the devices list "Windows · Desktop app".
- [ ] The browser link opened on another internet connection (e.g. a phone on mobile data): "started on another internet connection", no Yes button.
- [ ] Signing the desktop app out from Account (or Block in the admin): the window goes back to "Sign in to Translate" by itself.
- [ ] Listen to "This computer's sound", a language, Start; play a video or join a call: its words appear in the window (and nothing is asked first). Nothing playing for a while: "Waiting for sound…".
- [ ] The window keeps the whole history, centred like subtitles, following the newest line; scrolled up, "Latest" brings it back.
- [ ] Made small (a corner drag), the language list still opens over the whole window under the bar and scrolls there; the ⚙ menu too.
- [ ] "This computer" in the bar switches to the microphone while it runs, and back.
- [ ] The language in the bar opens the list; another language goes on in it.
- [ ] A− and A+, the gear's See-through slider, Lock in place (clicks go through to the call; the lock badge top right unlocks), the QR code (a phone scanning it reads along), Account (opens in the browser), ✕ closes it. A corner drag resizes it; the next start keeps its place and size.
- [ ] Stop; close and start again: still signed in, the same language and source.
- [ ] "Only reading someone's captions? Enter their code" in a signed-out window: someone's captions by their code.

## 4. The pages in five languages (2026-11-12)

The texts are drafts: a native speaker of each language should read every page once.

- [ ] A browser set to Polish (or Spanish, Catalan, German) opens every page in that language; any other browser language: English.
- [ ] The foot of the sign-in, home and Account pages: "Privacy" and the language; choosing another reloads the page in it, and it stays on that device. Settings' "App language" and the window's ⚙ menu do the same.
- [ ] The language list ("Translate into") names the languages in the page's language (in Polish: "Angielski", …), each also in its own name.
- [ ] A sign-in email asked for from a Polish page comes in Polish.
- [ ] The privacy page in each language says the same as the English one.
- [ ] Long German texts fit at phone width and in the window (nothing cut off, no sideways scrolling).

## 5. Sessions stop by themselves (2026-11-12)

- [ ] Start captions and say nothing (or leave the phone in a quiet room) for 15 minutes: the session stops and says "nobody spoke for 15 minutes"; nothing more is charged.
- [ ] Optional, a long session (a TV or radio playing): after 3 h 50 min "Still listening? The captions stop at …" with Keep going, on the phone and in the desktop window; Keep going: 4 more hours. Without it: stopped after 4 hours, "Stopped after 4 hours".
- [ ] A reader never sees "Still listening?".

## 6. A language stays a while after its last reader (2026-11-13)

- [ ] A reader in another language than yours locks their phone (or closes the page) for a few minutes, then opens it again: what was said meanwhile is there at once, in their language.
- [ ] A session with three languages: a reader who left frees their language for a new one (a fourth reader can pick another language); someone who wants a fourth while all three are read is told the session has three already.

## 7. Pages per connection (2026-11-13)

Nothing to see normally: one internet connection (a family's Wi-Fi) may have 50 Translate pages open at once. Beyond that a page says "Too many Translate pages are open on this internet connection" and tries again by itself every 30 seconds. (Hard to reach by hand; the server tests check it.)

## 8. Keep the screen on (2026-11-13)

- [ ] On an iPhone older than iOS 16.4 (if anyone has one): while it listens, "Keep this phone's screen on…". On any newer phone the note never shows (the screen stays on by itself while captions run).

## 9. The redesign, step 1: the bar and two-way face to face (2026-11-13)

On a phone:

- [ ] Home: "Start live captions", two pictures (Just me chosen); Face to face asks the top half's and the bottom half's language, each with a little phone showing its half.
- [ ] While it runs, one dark bar: Stop (red) · the language · ⚙, one height, nothing cut off at a small phone's width. No sentence explains the screen.
- [ ] Face to face: the bar sits between the halves; the far half is turned round and in its own language, yours under the bar in yours. Both halves scroll smoothly, each on its own.
- [ ] The language button (both languages, the top one above): each half changes on its own; "Swap the halves" swaps them.
- [ ] ⚙: "Invite someone" first, then Captions (text size, face to face, what is heard), Account (name and balance), App (App language, the Windows app on Windows only, Privacy).
- [ ] Stop: the words stay on screen, the first button says Start again; Start begins with an empty screen.
- [ ] Turn the microphone off in the browser: the bar says "The microphone is off" with "Turn it on" (never for a moment while it is still opening).
- [ ] A reader (the code from Invite): their name and a Live mark above the captions, the language and ⚙ in the bar, no Stop; the host's Stop takes the Live mark away.

## 10. The redesign, step 2: the language list and the microphone (2026-11-13)

On a phone:

- [ ] Tap a language field: a list without the keyboard: No translation, Polski, English, Deutsch, Español, Català, then up to two languages used before ("used before"), then "Other languages".
- [ ] Other languages: the search field with the keyboard and the whole list A to Z under letters; typing "hu" finds Magyar (Hungarian); the sheet keeps its height while typing; ‹ goes back.
- [ ] The language button in the bar (while captions run) opens the same list; in face to face, each half's too.
- [ ] Face to face with "No translation" in the top half: Start starts (it no longer asks again).
- [ ] On a phone that has never used Translate (or a fresh private window): the first Start shows "Translate needs the microphone" with "Allow the microphone", and only then the browser's own question. The next Start goes straight on.
- [ ] Block the microphone in the browser and tap Start: "The microphone is blocked" with this browser's steps (Chrome on Android, Safari on iPhone, Chrome on a computer…). Follow them: it carries on by itself (or with "Try again").
