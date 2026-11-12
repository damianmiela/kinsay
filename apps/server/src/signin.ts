// The two ways in that prove an email (both only for people on the invitation list): a one-time
// link by email (Brevo's transactional API) and Google's sign-in (the server flow: state, nonce,
// PKCE; the ID token comes straight from Google's token endpoint over HTTPS with our secret, so
// its claims are checked, not its signature: Google's own advice).
import { createHash, randomBytes } from 'node:crypto';

/** Sends one email; false when it couldn't. */
export type Mailer = (to: string, subject: string, text: string, html: string) => Promise<boolean>;

export function brevoMailer(apiKey: string, from: string, fromName: string, f = fetch): Mailer {
  return async (to, subject, text, html) => {
    try {
      const r = await f('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': apiKey,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          sender: { email: from, name: fromName },
          to: [{ email: to }],
          subject,
          textContent: text,
          htmlContent: html,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      return r.status === 201 || r.status === 202;
    } catch {
      return false;
    }
  };
}

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/** The sign-in email's words, in the language of the page it was asked from (drafts, as the pages'). */
const MAIL = {
  en: {
    subject: 'Your sign-in link for Translate',
    hello: (n: string) => `Hello ${n},`,
    open: 'open this link to sign in to Translate on the device you open it on:',
    button: 'Sign in to Translate',
    note: 'It signs in the device you open it on, works once, for 15 minutes. If you didn’t ask for it, ignore this email.',
  },
  pl: {
    subject: 'Twój link do logowania w Translate',
    hello: (n: string) => `Cześć ${n},`,
    open: 'otwórz ten link, aby zalogować się do Translate na urządzeniu, na którym go otworzysz:',
    button: 'Zaloguj się do Translate',
    note: 'Loguje urządzenie, na którym go otworzysz, działa raz, przez 15 minut. Jeśli o niego nie prosiłeś, zignoruj tę wiadomość.',
  },
  es: {
    subject: 'Tu enlace de acceso a Translate',
    hello: (n: string) => `Hola, ${n}:`,
    open: 'abre este enlace para entrar en Translate en el dispositivo donde lo abras:',
    button: 'Entrar en Translate',
    note: 'Conecta el dispositivo donde lo abras y funciona una vez, durante 15 minutos. Si no lo has pedido, ignora este correo.',
  },
  ca: {
    subject: 'El teu enllaç d’accés a Translate',
    hello: (n: string) => `Hola, ${n}:`,
    open: 'obre aquest enllaç per entrar a Translate al dispositiu on l’obris:',
    button: 'Entra a Translate',
    note: 'Connecta el dispositiu on l’obris i funciona una vegada, durant 15 minuts. Si no l’has demanat, no en facis cas.',
  },
  de: {
    subject: 'Dein Anmeldelink für Translate',
    hello: (n: string) => `Hallo ${n},`,
    open: 'öffne diesen Link, um dich auf dem Gerät, auf dem du ihn öffnest, bei Translate anzumelden:',
    button: 'Bei Translate anmelden',
    note: 'Er meldet das Gerät an, auf dem du ihn öffnest, und funktioniert einmal, 15 Minuten lang. Wenn du ihn nicht angefordert hast, ignoriere diese E-Mail.',
  },
};
export type MailLang = keyof typeof MAIL;
export const isMailLang = (v: unknown): v is MailLang =>
  typeof v === 'string' && Object.hasOwn(MAIL, v);

/** The sign-in email. */
export function signInMail(name: string, url: string, lang: MailLang = 'en') {
  const w = MAIL[lang];
  const text = `${w.hello(name)}\n\n${w.open}\n${url}\n\n${w.note}\n`;
  const html = `<p>${esc(w.hello(name))}</p><p><a href="${esc(url)}" style="display:inline-block;padding:12px 20px;border-radius:10px;background:#0b6e79;color:#fff;font-weight:bold;text-decoration:none">${esc(w.button)}</a></p><p>${esc(w.note)}</p>`;
  return { subject: w.subject, text, html };
}

export interface GoogleConfig {
  clientId: string;
  secret: string;
  /** This app's own address (https://…), for the redirect. */
  publicUrl: string;
  authUrl?: string;
  tokenUrl?: string;
}
export const GOOGLE_CALLBACK = '/api/google/callback';

const b64url = (b: Buffer) => b.toString('base64url');

/** A Google sign-in begins: where to send the browser, and what its cookie must remember. */
export function googleStart(g: GoogleConfig) {
  const state = b64url(randomBytes(24));
  const nonce = b64url(randomBytes(24));
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const url = new URL(g.authUrl ?? 'https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: g.clientId,
    redirect_uri: g.publicUrl + GOOGLE_CALLBACK,
    response_type: 'code',
    scope: 'openid email',
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString();
  return { url: url.toString(), memo: `${state}.${nonce}.${verifier}` };
}

/** Google came back: the verified email of the account, or why not. */
export async function googleFinish(
  g: GoogleConfig,
  query: { code?: unknown; state?: unknown },
  memo: string | undefined,
  now: number,
  f = fetch,
): Promise<{ email: string } | { error: string }> {
  const [state, nonce, verifier] = (memo ?? '').split('.');
  if (!state || !nonce || !verifier || query.state !== state || typeof query.code !== 'string') {
    return { error: 'google-state' };
  }
  let token: { id_token?: string };
  try {
    const r = await f(g.tokenUrl ?? 'https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: query.code,
        client_id: g.clientId,
        client_secret: g.secret,
        redirect_uri: g.publicUrl + GOOGLE_CALLBACK,
        grant_type: 'authorization_code',
        code_verifier: verifier,
      }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return { error: 'google-token' };
    token = (await r.json()) as typeof token;
  } catch {
    return { error: 'google-token' };
  }
  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(
      Buffer.from(token.id_token!.split('.')[1]!, 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
  } catch {
    return { error: 'google-token' };
  }
  const iss = claims.iss;
  if (iss !== 'https://accounts.google.com' && iss !== 'accounts.google.com')
    return { error: 'google-token' };
  if (claims.aud !== g.clientId || claims.nonce !== nonce) return { error: 'google-token' };
  if (typeof claims.exp !== 'number' || claims.exp * 1000 < now) return { error: 'google-token' };
  if (claims.email_verified !== true || typeof claims.email !== 'string')
    return { error: 'google-email' };
  return { email: claims.email };
}
