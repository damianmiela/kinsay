# What to test before a commit reaches the server

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
