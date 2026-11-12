// Every text the pages show. English first; the other four languages (PL ES CA DE) come in a pass
// of their own once the screens have settled.
import { euros, type StopReason } from '@translate/shared';

export const t = {
  app: 'Translate',
  // signing in
  signInTitle: 'Live captions, in your language',
  haveCode: 'I have a sign-in code',
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
  askInviteTitle: 'Translate is by invitation',
  askInviteBody: 'Ask for one and we’ll write to you when it’s ready.',
  yourName: 'Your name',
  yourEmail: 'Your email',
  askInvite: 'Ask for an invitation',
  asked: 'Asked.',
  askedBody: (email: string) => `We’ll email you at ${email}.`,
  codeTitle: 'Type the sign-in code',
  codeBody: 'The six numbers you were shown.',
  signIn: 'Sign in',
  signedInAs: (name: string) => `Signed in as ${name}.`,
  staysSignedIn: 'This device stays signed in.',
  badCode: 'That code doesn’t work. Ask for a new one: a code works once, for 10 minutes.',
  tooMany: 'Too many tries. Wait a few minutes and try again.',
  offline: 'No connection. Check the internet and try again.',
  // home
  startTitle: 'Start captions',
  phoneListens: 'This device listens to the people around it.',
  translateInto: 'Translate into (optional)',
  translateIntoSet: 'Translate into',
  noTranslation: 'No translation',
  noTranslationHint: 'show what is heard',
  withoutTranslation: 'Without one, you see what is heard, with its language.',
  searchLang: 'Search a language',
  noLangFound: 'No language with that name.',
  start: 'Start',
  joinCaptions: 'Join captions',
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
  codeWorks: 'The code works for a day. Only people with it can read.',
  lowTitle: 'Almost out of credits',
  lowBody: (b: number) => `${euros(b)} left. Ask for more now so the captions don’t stop.`,
  askForMore: 'Ask for more',
  micProblem: 'The microphone didn’t start.',
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
  tooManyLangs: 'This session reads three languages already. Choose one of them.',
  serviceFull: 'The translation service is full right now. Try again in a minute.',
  // stops
  stop_credits: [
    'Out of credits',
    'The captions stopped. Ask for more; you’ll get an email when they’re added.',
  ],
  stop_monthly: [
    'Your monthly limit is reached',
    'It starts again next month, or ask to raise it.',
  ],
  stop_global: ['The translation service is full this month', 'Try again later.'],
  stop_blocked: ['This account is blocked', 'Ask the person who invited you.'],
  serviceDown: [
    'The translation service has a problem',
    'It tries again by itself. Nothing is charged while it’s down.',
  ],
  readerStopped: 'The captions stopped.',
  // account
  creditsLeft: 'Credits left',
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
} as const;

export const stopText = (r: StopReason): readonly [string, string] | null =>
  r === 'ended' ? null : t[`stop_${r}`];

/** "1 h 05 min" / "25 min" / "40 s". */
export function duration(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}
