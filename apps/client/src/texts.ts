// Every text the pages show (not the admin's: Damian's, in English). English is the reference; Polish,
// Spanish, Catalan and German (texts-pl.ts …) must have every text, the types enforce it. A page
// shows the language `ui.ts` picks (the browser's, or the one chosen in the gear), once at load.
import { euros, type StopReason } from '@translate/shared';
import { ca } from './texts-ca';
import { de } from './texts-de';
import { es } from './texts-es';
import { pl } from './texts-pl';
import { ui, type UiLang } from './ui';

const t_en = {
  app: 'Kinsay',
  // signing in
  signInTitle: 'Live captions, in your language',
  haveCode: 'I have a code',
  sendLink: 'Send me a sign-in link',
  continueGoogle: 'Continue with Google',
  or: 'or',
  checkEmail: 'Check your email',
  checkEmailBody: (email: string) =>
    `If ${email} has an invitation, a sign-in link is on its way. It works once, for 15 minutes, on the device you open it on.`,
  otherEmail: 'Use another email',
  badEmail: 'That doesn’t look like an email address.',
  googleNotInvited: 'This Google account’s email has no invitation yet. Ask for one below.',
  googleFailed: 'Signing in with Google didn’t work. Try again.',
  linkTitle: 'Sign in on this device?',
  linkBody: 'Tap the button to sign in here. This device then stays signed in.',
  badLink: 'This link doesn’t work any more: it works once, for 15 minutes. Ask for a new one.',
  backHome: 'Back',
  joinTitle: 'Joining someone’s captions?',
  enterTheirCode: 'Enter their code',
  askInviteTitle: 'Kinsay is by invitation',
  askInviteBody: 'Ask for one and we’ll write to you when it’s ready.',
  yourName: 'Your name',
  yourEmail: 'Your email',
  askInvite: 'Ask for an invitation',
  asked: 'Asked.',
  askedBody: (email: string) => `We’ll email you at ${email}.`,
  codeTitle: 'Type the code',
  codeBody: 'A sign-in code, or the code from someone’s Invite.',
  signIn: 'Sign in',
  signedInAs: (name: string) => `Signed in as ${name}.`,
  staysSignedIn: 'This device stays signed in.',
  badCode: 'That code doesn’t work. Ask for a new one: a code works once, for 10 minutes.',
  tooMany: 'Too many tries. Wait a few minutes and try again.',
  offline: 'No connection. Check the internet and try again.',
  signInAgainHere: 'Try again',
  // home
  startTitle: 'Start live captions',
  close: 'Close',
  lowLeft: (b: number) => `${euros(b)} left`,
  justMe: 'Just me',
  original: 'Original',
  topHalf: 'Top half',
  bottomHalf: 'Bottom half',
  languages: 'Languages',
  swapHalves: 'Swap the halves',
  chooseLang: 'Choose a language',
  groupCaptions: 'Captions',
  groupAccount: 'Account',
  groupApp: 'App',
  micIsOff: 'The microphone is off',
  turnItOn: 'Turn it on',
  showSpeakers: 'Show who is speaking',
  showSpeakersSmall: 'a colour per person, a new line when someone else speaks',
  installApp: 'Install Kinsay',
  installSmall: 'its icon on the home screen, full screen',
  addHome: 'Add to Home Screen',
  iosSteps: [
    'Tap *Share* at the bottom of Safari',
    'Scroll down, tap *Add to Home Screen*',
    'Tap *Add*',
  ],
  ipadFirst: 'Tap *Share* at the top of Safari',
  iosOtherFirst: 'Tap *Share* in your browser (at the top or bottom)',
  macSteps: ['In Safari’s menu bar, choose *File*', 'Choose *Add to Dock*', 'Click *Add*'],
  menuSteps: ['Open your browser’s menu (⋮ or …)', 'Choose *Install app* or *Add to Home screen*'],
  thenOpen: 'Then open Kinsay from its icon.',
  guestCantRun: (n: string) => `${n}’s captions can’t run now.`,
  guestAllow: 'Their computer can caption the call too',
  guestAllowSmall: 'On your balance: one more language while it runs',
  guestRunsToo: 'Your guest’s computer captions the call too',
  stopTheirs: 'Stop theirs',
  onBalance: (n: string) => `on ${n}’s balance`,
  justRead: (n: string) => `Just read ${n}’s captions`,
  yourGuest: 'your guest',
  guestTaken: 'Someone else captions their side already.',
  guestOff: 'This is switched off.',
  sendRequest: 'Send the request',
  yourRequest: (a: string) => `Your request, ${a}`,
  thisOne: 'this one',
  offlineKept: 'What’s said is kept and caught up.',
  sendAgain: 'Send it again',
  codeUntil: (w: string) => `Works until ${w}`,
  signingIn: 'Signing in…',
  readAloud: 'Read aloud',
  earphones: 'Best with earphones',
  noVoice: (l: string) => `No ${l} voice on this device`,
  addVoice: {
    ios: 'Add one: Settings → Accessibility → Spoken Content → Voices.',
    android: 'Add one: Settings → Text-to-speech.',
    windows: 'Add one: Settings → Time & language → Speech.',
    mac: 'Add one: System Settings → Accessibility → Spoken Content.',
    other: 'Add one in this device’s speech settings.',
  },
  hostStopped: (time: string, name: string) => `${name} stopped at ${time}`,
  noInternet: 'No internet.',
  comeBack: 'The captions come back by themselves.',
  leftTitle: (n: string) => `You left ${n}’s captions`,
  joinAgain: 'Join again',
  typeAnother: 'Type another code',
  fullLangs: (n: string) => `${n}’s captions have three languages already. Pick one of them.`,
  readAloudHere: 'Read aloud on this device',
  leaveNamed: (n: string) => `Leave ${n}’s captions`,
  listeningOn: (d: string) => `Listening on ${d}`,
  deviceName: { phone: 'your phone', tablet: 'your tablet', computer: 'your computer' },
  useThisOne: 'Use this one',
  groupMic: 'Microphone',
  historyDevices: 'History and devices',
  otherLangs: 'Other languages',
  usedBefore: 'used before',
  micNeeded: 'Kinsay needs the microphone',
  allowMic: 'Allow the microphone',
  micBlocked: 'The microphone is blocked',
  micGoesOn: 'It goes on by itself once it’s allowed.',
  tryAgain: 'Try again',
  micSteps: {
    chromeAndroid: [
      'Tap the icon left of the address',
      'Tap *Permissions*',
      'Turn on *Microphone*',
    ],
    chrome: ['Click the icon left of the address', 'Turn on *Microphone*'],
    safariIos: [
      'Tap the button left of the address',
      'Tap *Website Settings*',
      'Set *Microphone* to *Allow*',
    ],
    safari: [
      'Open the *Safari* menu',
      'Choose *Settings for* this website',
      'Set *Microphone* to *Allow*',
    ],
    firefox: [
      'Click the crossed-out microphone left of the address',
      'Click ✕ next to *Blocked*',
      'Click *Try again*',
    ],
    other: ['Open this website’s settings in the browser', 'Allow the *Microphone*'],
  },
  keepScreenOnLine: 'Keep the screen on while it listens',
  serviceTrying: 'The translation service has a problem. Trying again…',
  phoneListens: 'This device listens to the people around it.',
  translateInto: 'Translate into (optional)',
  translateIntoSet: 'Translate into',
  noTranslation: 'No translation',
  noTranslationHint: 'show what is heard',
  withoutTranslation: 'Without one, you see what is heard, with its language.',
  searchLang: 'Search a language',
  noLangFound: 'No language with that name.',
  start: 'Start',
  joinCaptions: 'Join someone’s captions',
  enterCode: 'Enter a code',
  // captions
  live: 'Live',
  stopped: 'Stopped',
  stop: 'Stop',
  invite: 'Invite',
  translate: 'Translate',
  settings: 'Settings',
  faceToFace: 'Face to face',
  faceToFaceHint: 'the translation turned for the person across',
  turnOff: 'Turn off',
  showHeard: 'Show what was heard',
  textSize: 'Text size',
  account: 'Account and credits',
  back: 'Back to captions',
  waitingWords: 'Say something: the captions appear here.',
  waitingReader: 'Nothing said yet: the captions appear here.',
  note: 'Translated automatically: it can be wrong.',
  heardNote: 'What the microphone hears.',
  latest: 'Latest',
  inviteTitle: 'Invite someone',
  inviteBody:
    'They scan this or type the code. They read in your language for free, or pick their own: each other language is paid from your credits.',
  copyLink: 'Copy link',
  copied: 'Copied',
  share: 'Share',
  lowTitle: 'Almost out of credits',
  lowBody: (b: number) => `${euros(b)} left. Ask for more now so the captions don’t stop.`,
  askForMore: 'Ask for more',
  micProblem: 'The microphone didn’t start.',
  micOff: 'This device’s microphone is off.',
  keepScreenOn:
    'Keep this phone’s screen on: it can’t do it by itself, and the microphone stops when the screen locks.',
  micOn: 'Turn the microphone on',
  // readers
  hostsCaptions: (name: string) => `${name}’s captions`,
  waitingHost: (name: string) => `Waiting for ${name}`,
  waitingHostBody: 'The captions start when they press Start. Keep this page open.',
  language: 'Language',
  leave: 'Leave',
  noSession:
    'No captions with this code. Check the letters, or ask for a new code: a code works for one day.',
  codeLabel: 'The code',
  codeHelp: 'The person who started the captions sees it under "Invite".',
  join: 'Join',
  tooManyPages:
    'Too many Kinsay pages are open on this internet connection. Close some: this page tries again by itself.',
  tooManyLangs: 'This session reads three languages already. Choose one of them.',
  serviceFull: 'The translation service is full right now. Try again in a minute.',
  // stops
  stop_credits: [
    'The balance is used up',
    'The captions stopped. Ask for more; you’ll get an email when they’re added.',
  ],
  stop_monthly: [
    'Your monthly limit is reached',
    'It starts again next month, or ask to raise it.',
  ],
  stop_global: ['The translation service is full this month', 'Try again later.'],
  stop_quiet: ['Stopped: nobody spoke for 15 minutes', 'Press Start to go on.'],
  stop_hours: ['Stopped after 4 hours', 'Press Start to go on.'],
  stillListening: (time: string) => `Still listening? The captions stop at ${time}.`,
  keepGoing: 'Keep going',
  stop_blocked: ['This account is blocked', 'Ask the person who invited you.'],
  serviceDown: [
    'The translation service has a problem',
    'It tries again by itself. Nothing is charged while it’s down.',
  ],
  readerStopped: 'The captions stopped.',
  // account
  creditsLeft: 'Balance',
  history: 'History',
  welcome: 'Welcome',
  fromAdmin: 'Added',
  correction: 'Correction',
  captionsIn: (lang: string) => `Captions, ${lang}`,
  askTitle: 'Ask for more',
  howMuch: 'How much?',
  send: 'Send',
  yourRequests: 'Your requests',
  req_waiting: 'Waiting',
  req_granted: 'Added',
  req_declined: 'Declined',
  alreadyAsked: 'You asked already: wait for the answer.',
  devices: 'Devices',
  thisDevice: 'This device',
  signOut: 'Sign out',
  signOutHere: 'Sign out of this device',
  signOutAll: 'Sign out everywhere',
  deleteAccount: 'Delete my account',
  deleteSure: 'Delete your account and its history? This can’t be undone.',
  privacy: 'Privacy',
  pageLang: 'App language',
  // the microphone and this computer's sound (mic/useMic.ts)
  micUnplugged: 'The input stopped (unplugged?). Plug it in again and start again.',
  micNoShare: 'No sound came with the share: share the whole screen and tick “Share system audio”.',
  micNotShared: 'This computer’s sound wasn’t shared.',
  micSystemFailed: (why: string) => `This computer’s sound didn’t start: ${why}`,
  micGone: 'The chosen input is not there any more: pick one from the list and try again.',
  micDenied:
    'The browser may not use the microphone: allow it (the icon in the address bar) and try again.',
  micFailed: (why: string) => `The microphone didn’t start: ${why}`,
} as const;

/**
 * The privacy page (/privacy): plain words, what is kept and what never is. Google asks for it before
 * everyone may sign in with Google. Who is responsible comes from the server (CONTACT_NAME,
 * CONTACT_EMAIL), never from the code.
 */
const privacy_en = {
  title: 'Privacy',
  updated: 'Last updated: 12 November 2026',
  intro: (who: string) =>
    `Kinsay is a small app for live captions, by invitation only, run by ${who}. This page says what it keeps about you, why, and how to have it deleted.`,
  sections: [
    {
      h: 'What is never kept',
      p: [
        'What is said. While captions run, the sound goes from your device through our server to Soniox, the speech service that turns it into text and translates it, and the text comes back to the screens reading it. We save none of it: no recordings, no transcripts. Soniox processes live audio in memory only; it does not store it or use it to train its models.',
      ],
    },
    {
      h: 'What is kept',
      p: [
        'Your name and email address, from your invitation.',
        'Your credits: what was added, and for each session its date, its length, its languages and what it cost.',
        'The devices you are signed in on: what kind (for example “Chrome on Android”) and when each was last used. A cookie keeps a device signed in; the only other one lasts the ten minutes of a sign-in with Google. There are no ads, no tracking and no analytics. Your choices on a page (the language, the text size) stay on your device.',
        'If you ask for an invitation: the name and email you give, until it is answered.',
        'For a short time only: sign-in codes and links (15 minutes at most), the codes that let others read your captions (a day), and, in the server’s memory only, addresses counted against abuse.',
        'The web server in front of the app keeps standard access logs (address, time, page), used only to keep the service working and safe.',
      ],
    },
    {
      h: 'Who else handles it',
      p: [
        'Hetzner (Germany) runs the server. Soniox turns speech into text and translates it, as above. Brevo (France) sends the sign-in emails, so it sees your email address. Google, only if you sign in with Google: it tells us your email address, nothing else.',
      ],
    },
    {
      h: 'Why',
      p: [
        'To give you the service you were invited to (your account, your credits, signing in), and to keep it safe from abuse.',
      ],
    },
    {
      h: 'How long, and deleting it',
      p: [
        'As long as you have an account. On your Account page, “Delete my account” removes your name, your email address, your devices and your history at once. What past sessions cost stays, without your name, only in the monthly totals.',
        'You may ask to see what is kept about you, to correct it or to delete it, by writing to the address below. You may also complain to a data protection authority.',
      ],
    },
  ],
  contactTitle: 'Contact',
} as const;

/** A time of day in the page's language ("14:05", "2:05 PM"). */
export const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString(ui, { hour: '2-digit', minute: '2-digit' });

/** "1 h 05 min" / "25 min" / "40 s". */
export function duration(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

/** The subtitles window (/window: the desktop app, or a browser tab; mockups batch 1 and part 7). */
const tw_en = {
  title: 'Kinsay',
  bothSides: 'Both sides of the call',
  bothSidesSmall: 'your microphone too, in its own colour: twice the cost',
  sideYou: 'You',
  sideCall: 'The call',
  listenTo: 'Listen to',
  system: 'This computer’s sound',
  systemHint: 'a call',
  mic: 'Microphone',
  micHint: 'people here',
  thisComputer: 'This computer',
  translateInto: 'Translate into',
  waitingSound: 'Waiting for sound…',
  waitingSoundBody:
    'Nothing plays on this computer yet. Start the call, or switch to the microphone.',
  waitingVoice: 'Waiting for someone to speak…',
  soundProblem: 'This computer’s sound didn’t start. Try again, or use the microphone.',
  offline: 'No connection.',
  offlineBody: 'What is said now is kept and caught up when the internet is back.',
  smaller: 'Smaller text',
  bigger: 'Bigger text',
  menu: 'Settings',
  seeThrough: 'See-through',
  lock: 'Lock in place',
  unlock: 'Unlock',
  showQr: 'Show the QR code',
  readAlong: 'Read along on a phone',
  readAlongBody: (code: string) =>
    `Scan it, or type the code ${code} at kinsay.dendigital.de/join.`,
  account: 'Account and credits',
  closeWindow: 'Close the window',
  closeAsk: 'Close the window and stop the captions?',
  stopAndClose: 'Stop and close',
  keepThem: 'Keep them',
  groupWindow: 'Window',
  closeQr: 'Close the QR code',
  failed: 'That didn’t work. Try again.',
  resume: 'The captions run, but this window doesn’t listen.',
  // signing in (part 7)
  signInTitle: 'Sign in to Kinsay',
  signInBody:
    'Your browser opens. Sign in there, then come back: this window carries on by itself.',
  signInButton: 'Sign in in the browser',
  signInDigits: 'The browser shows these numbers too:',
  signInWaiting: 'Waiting for the browser…',
  signInNo: 'The sign-in was refused in the browser.',
  signInAgain: 'Try again',
  readOnly: 'Only reading someone’s captions?',
  enterTheirCode: 'Enter their code',
} as const;

/** The browser's side of the desktop app's sign-in (/app-signin, part 7). */
const appSignIn_en = {
  title: 'Sign in the desktop app?',
  body: 'A Kinsay app asks to sign in as',
  check:
    'Say yes only if you just pressed “Sign in in the browser” in Kinsay’s window on this computer, and it shows the same numbers.',
  elsewhere:
    'This sign-in was started on another internet connection, not here. If someone sent you this link, press No. If it’s your own app, start the sign-in again from its window on this computer.',
  yes: 'Yes, sign it in',
  no: 'No',
  done: 'Done.',
  doneBody: 'You can close this tab and go back to the app.',
  refused: 'Not signed in. You can close this tab.',
  gone: 'This sign-in has ended (it lasts 10 minutes). Start it again in the app.',
  first: 'Sign in here first: the desktop app is waiting for it.',
} as const;

/** The download page for the desktop app (/download). */
const download_en = {
  title: 'Kinsay for Windows',
  body: 'Captions over any call or video, in a window that stays on top. It hears this computer’s sound, so the other person’s words show too. For Windows 10 and 11.',
  button: 'Download Kinsay',
  small: 'One file, nothing to install.',
  then: 'Then',
  steps: [
    'Open Kinsay.exe from your downloads.',
    'If Windows says “Windows protected your PC”, press “More info”, then “Run anyway”: the app is new and not signed yet.',
    'Press “Sign in in the browser” in its window, and say yes in your browser.',
  ],
  elsewhere: 'On a phone or a Mac? Kinsay works right here in the browser.',
  open: 'Open Kinsay',
  foot: 'Windows app',
} as const;

const en = {
  t: t_en,
  privacyPage: privacy_en,
  tw: tw_en,
  appSignIn: appSignIn_en,
  download: download_en,
};

/** The English texts' shape with every text a plain string: what each language must give. */
type Widen<T> = T extends string
  ? string
  : T extends (...a: infer A) => infer R
    ? (...a: A) => Widen<R>
    : T extends readonly [infer X, infer Y]
      ? readonly [Widen<X>, Widen<Y>]
      : T extends readonly (infer U)[]
        ? readonly Widen<U>[]
        : { readonly [K in keyof T]: Widen<T[K]> };
export type Texts = Widen<typeof en>;

export const TEXTS: Record<UiLang, Texts> = { en, pl, es, ca, de };
const chosen = TEXTS[ui];
export const t = chosen.t;
export const privacyPage = chosen.privacyPage;
export const tw = chosen.tw;
export const appSignIn = chosen.appSignIn;
export const download = chosen.download;

export const stopText = (r: StopReason): readonly [string, string] | null =>
  r === 'ended' ? null : t[`stop_${r}`];
