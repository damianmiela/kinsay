// The microphone for the live captions (W3, in the host panel since the redesign): one audio
// pipeline that is either only checked (the level bar moves, nothing is sent) or sending. It lives
// in the host panel's top component, so it keeps sending while the host moves between pages.
import { t } from '../texts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { socket } from '../socket';
import { AudioOutbox, makeResampler, peak, randomId, SendAsks, type StartResult } from './logic';

const DEVICE_KEY = 'ido-mic-device';
/** More unsent audio than this (about 1 s) in the browser: the uplink is busy, the rest waits. */
const MAX_BUFFERED = 32_000;
/**
 * Audio kept during a break in the internet: 30 minutes (a 26-minute outage in the long test,
 * Damian 2026-10-10). The server keeps as much, so the backlog may go to it faster than it goes on
 * to the speech service: off the laptop, the weaker device, as soon as it can.
 */
const KEEP_MAX_MS = 30 * 60_000;
/**
 * /live's phone: the server frees the host role after a minute without its audio, so kept audio
 * older than that is never used (audit 20).
 */
const VOICE_KEEP_MS = 60_000;
/** Chunks sent per chunk recorded at most: kept audio goes up at 4 times real time. */
const SEND_AT_ONCE = 4;

// Hands every audio frame (128 samples) to the page. Inline, so there's no extra file to serve.
const TAP = `registerProcessor('tap', class extends AudioWorkletProcessor {
  process(inputs) { const ch = inputs[0] && inputs[0][0]; if (ch) this.port.postMessage(ch.slice(0)); return true; }
});`;

interface WakeLock {
  release: () => Promise<void>;
}

const load = (key: string) => {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
};
const save = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // not remembered: fine
  }
};

/** Where the sound comes from: a microphone, or what this computer plays (a call, 2026-11-12). */
export type SoundSource = 'mic' | 'system';

export interface Mic {
  devices: MediaDeviceInfo[];
  /** The source the next start opens (switching while it runs takes a Stop and a Start). */
  source: SoundSource;
  chooseSource: (source: SoundSource) => void;
  deviceId: string;
  chooseDevice: (id: string) => void;
  listDevices: () => void;
  /** The input is open (checking or sending). */
  open: boolean;
  /** Audio goes to the speech service. */
  sending: boolean;
  /**
   * The level (0 to 1, about 7 times a second while open) and the peak of the last moment. A store
   * only the meter reads: the whole admin no longer redraws with it (round 1, C-L4).
   */
  levels: LevelStore;
  problem: string | null;
  /**
   * Seconds of audio waiting to be sent (a break in the internet, a slow uplink): kept and sent
   * when the connection takes it, so the transcript has no gap (2026-10-09).
   */
  waiting: number;
  /** Opens the input to see the level; nothing is sent. */
  check: () => void;
  /** Closes the input (not while sending). */
  stopCheck: () => void;
  /** Starts sending: 'started' once the input runs, 'failed' (it says why), or 'cancelled' (a Stop came first). */
  startSending: () => Promise<StartResult>;
  stopSending: () => void;
}

/** The input's level for the meter (see Mic.levels). */
export interface LevelStore {
  subscribe: (listener: () => void) => () => void;
  get: () => { level: number; peak: number };
  set: (level: number, peak: number) => void;
}

function levelStore(): LevelStore {
  let value = { level: 0, peak: 0 };
  const listeners = new Set<() => void>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get: () => value,
    set(level, peak) {
      if (level === value.level && peak === value.peak) return;
      value = { level, peak };
      for (const l of listeners) l();
    },
  };
}

/**
 * What this computer plays, as a stream with sound only (2026-11-12, the subtitles window: a call
 * on either side). In the desktop app the window gets it without asking; in Chrome on Windows the
 * browser asks for a screen to share with its sound. The picture is dropped at once; the browser's
 * voice filters stay off (they made the level jump in the spike).
 */
async function systemSound(): Promise<MediaStream> {
  const shell = (window as { liveShell?: SoundShell }).liveShell;
  if (shell?.startSound) return shellSound(shell);
  const shared = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    systemAudio: 'include',
  } as DisplayMediaStreamOptions);
  for (const t of shared.getVideoTracks()) t.stop();
  const audio = shared.getAudioTracks();
  if (!audio.length) {
    const e = new Error('no sound in the share');
    e.name = 'NoSystemSound';
    throw e;
  }
  return new MediaStream(audio);
}

/** The small Windows app (desktop/win): Windows' loopback, 16 kHz samples handed to the page. */
interface SoundShell {
  /** Resolves once Windows' capture runs, rejects without a sound device; `ended`: it stopped later. */
  startSound?(take: (samples: Float32Array) => void, ended: () => void): Promise<void>;
  stopSound?(): void;
}

/**
 * The app's sound as a stream like any other: its samples played into the page's own sound graph
 * (silence while Windows sends none, when nothing plays). Stopping the track stops the capture.
 */
async function shellSound(shell: SoundShell): Promise<MediaStream> {
  const ctx = new AudioContext({ sampleRate: 16000 });
  await ctx.resume();
  // (2 chunks ahead before playing; more than 5 waiting: back to 2, so the delay never grows)
  const code = `registerProcessor('shell-sound', class extends AudioWorkletProcessor {
    constructor() { super(); this.q = []; this.at = 0; this.on = false; this.port.onmessage = (e) => { this.q.push(e.data); if (this.q.length > 5) { this.q.splice(0, this.q.length - 2); this.at = 0; } }; }
    process(_, [out]) {
      const o = out[0];
      for (let i = 0; i < o.length; i++) {
        if (!this.on && this.q.length >= 2) this.on = true;
        const c = this.on ? this.q[0] : null;
        if (!c) { this.on = false; o[i] = 0; continue; }
        o[i] = c[this.at++];
        if (this.at >= c.length) { this.q.shift(); this.at = 0; }
      }
      return true;
    }
  });`;
  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  await ctx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);
  const node = new AudioWorkletNode(ctx, 'shell-sound');
  const out = ctx.createMediaStreamDestination();
  node.connect(out);
  const tracks = out.stream.getAudioTracks();
  try {
    await shell.startSound?.(
      (samples) => node.port.postMessage(samples, [samples.buffer]),
      // (the sound device went and none came back: the page shows its "input stopped")
      () => {
        for (const t of tracks) {
          t.stop();
          t.dispatchEvent(new Event('ended'));
        }
      },
    );
  } catch {
    void ctx.close();
    const e = new Error('no sound device');
    e.name = 'NoSystemSound';
    throw e;
  }
  for (const track of tracks) {
    const stop = track.stop.bind(track);
    track.stop = () => {
      shell.stopSound?.();
      void ctx.close();
      stop();
    };
  }
  return out.stream;
}

/**
 * `voice`: a phone in the middle of the table (/live), not the mixer's line: its default
 * microphone with the browser's usual voice filters (they suit a phone's own microphone).
 */
export function useMic({ voice = false } = {}): Mic {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState(() => load(DEVICE_KEY));
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [levels] = useState(levelStore);
  const [problem, setProblem] = useState<string | null>(null);
  const [source, setSource] = useState<SoundSource>('mic');
  const sourceRef = useRef<SoundSource>('mic');
  // (the same function every time: a page may choose the source in an effect)
  const chooseSource = useCallback((next: SoundSource) => {
    sourceRef.current = next;
    setSource(next);
  }, []);
  const [waiting, setWaiting] = useState(0);
  const close = useRef<(() => void) | null>(null);
  const starting = useRef<Promise<boolean> | null>(null);
  const sendingNow = useRef(false);
  const [asks] = useState(() => new SendAsks());

  const listDevices = () => {
    navigator.mediaDevices?.enumerateDevices().then(
      (all) => setDevices(all.filter((d) => d.kind === 'audioinput')),
      () => {},
    );
  };
  // the remembered input must be in the list from the start (else it looks like "default"); the
  // input closes when the panel goes
  useEffect(() => {
    listDevices();
    return () => close.current?.();
  }, []);
  // a reload or a closed tab would stop the captions: the browser asks first while sending
  useEffect(() => {
    if (!sending) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [sending]);

  /** Opens the pipeline (once: a double tap must not start two). True when it runs. */
  function openInput(): Promise<boolean> {
    if (close.current) return Promise.resolve(true);
    starting.current ??= start().finally(() => (starting.current = null));
    return starting.current;
  }

  async function start(): Promise<boolean> {
    setProblem(null);
    let stream: MediaStream | undefined;
    let ctx: AudioContext | undefined;
    try {
      stream =
        sourceRef.current === 'system'
          ? await systemSound()
          : await navigator.mediaDevices.getUserMedia({
              audio: voice
                ? { channelCount: 1 }
                : {
                    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
                    channelCount: 1,
                    // a mixer's line signal is clean already; the browser's "phone call" filters harm it
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false,
                  },
            });
      if (sourceRef.current === 'mic') listDevices(); // with permission, the inputs have names now
      ctx = new AudioContext();
      await ctx.resume(); // (created after an await: some browsers start it suspended)
      const url = URL.createObjectURL(new Blob([TAP], { type: 'text/javascript' }));
      await ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      const node = new AudioWorkletNode(ctx, 'tap');
      let lastLevel = 0;
      let top = 0;
      let topAt = 0;
      // every chunk is numbered in this page's stream of audio and kept until the server confirms
      // it: a break in the internet loses nothing, the audio goes when the connection is back
      const audioStream = `mic-${randomId()}`;
      const box = new AudioOutbox(voice ? VOICE_KEEP_MS : KEEP_MAX_MS);
      let shown = 0;
      const onAck = (seq: number) => box.confirm(seq);
      // (a new connection: what the server didn't confirm goes again; it drops what it has)
      const onConnect = () => box.resend();
      socket.on('captions:ack', onAck);
      socket.on('connect', onConnect);
      const feed = makeResampler(ctx.sampleRate, (pcm) => {
        if (sendingNow.current) {
          box.push(pcm, Date.now());
          // (a slow uplink: the browser's send buffer is full, the audio waits here instead)
          const ws = (socket.io.engine?.transport as unknown as { ws?: WebSocket } | undefined)?.ws;
          if (socket.connected && (ws?.bufferedAmount ?? 0) <= MAX_BUFFERED) {
            for (const c of box.take(SEND_AT_ONCE)) {
              socket.emit('host:audio', c.pcm.buffer as ArrayBuffer, {
                age: Date.now() - c.at,
                seq: c.seq,
                stream: audioStream,
              });
            }
          }
          const w = Math.round(box.waitingMs / 1000);
          if (w !== shown) {
            shown = w;
            setWaiting(w);
          }
        }
        const now = performance.now();
        if (now - lastLevel > 140) {
          lastLevel = now;
          const l = peak(pcm);
          // the peak mark holds for a moment, then follows the level again
          if (l >= top || now - topAt > 1_200) {
            top = l;
            topAt = now;
          }
          levels.set(l, top);
        }
      });
      node.port.onmessage = (e: MessageEvent<Float32Array>) => feed(e.data);
      // (the node writes silence: connected only so the browser keeps running it)
      ctx.createMediaStreamSource(stream).connect(node).connect(ctx.destination);

      // the laptop must not sleep: the browser drops the lock whenever the tab is hidden, so ask
      // again each time it is visible
      let lock: WakeLock | null = null;
      let stopped = false;
      const api = (navigator as { wakeLock?: { request: (t: 'screen') => Promise<WakeLock> } })
        .wakeLock;
      const keepAwake = () => {
        if (document.visibilityState !== 'visible') return;
        api?.request('screen').then(
          (l) => {
            if (stopped) void l.release().catch(() => {});
            else lock = l;
          },
          () => {},
        );
      };
      keepAwake();
      document.addEventListener('visibilitychange', keepAwake);

      const tracks = stream.getTracks();
      const audio = ctx;
      close.current = () => {
        stopped = true;
        socket.off('captions:ack', onAck);
        socket.off('connect', onConnect);
        document.removeEventListener('visibilitychange', keepAwake);
        for (const t of tracks) t.stop();
        void audio.close();
        lock?.release().catch(() => {});
        close.current = null;
        sendingNow.current = false;
        setOpen(false);
        setSending(false);
        levels.set(0, 0);
        setWaiting(0);
      };
      // the input was unplugged (or the browser took it away): say so instead of a silent page
      for (const track of tracks) {
        track.onended = () => {
          close.current?.();
          setProblem(t.micUnplugged);
        };
      }
      setOpen(true);
      return true;
    } catch (e) {
      // nothing half-started stays behind (the browser would keep showing the mic as in use)
      for (const t of stream?.getTracks() ?? []) t.stop();
      void ctx?.close();
      const err = e as Error;
      if (sourceRef.current === 'system') {
        setProblem(
          err.name === 'NoSystemSound'
            ? t.micNoShare
            : err.name === 'NotAllowedError'
              ? t.micNotShared
              : t.micSystemFailed(err.message || err.name),
        );
      } else if (!voice && (err.name === 'OverconstrainedError' || err.name === 'NotFoundError')) {
        setDeviceId('');
        save(DEVICE_KEY, '');
        setProblem(t.micGone);
      } else {
        setProblem(
          err.name === 'NotAllowedError' ? t.micDenied : t.micFailed(err.message || err.name),
        );
      }
      return false;
    }
  }

  return {
    devices,
    source,
    chooseSource,
    deviceId,
    chooseDevice: (id) => {
      setDeviceId(id);
      save(DEVICE_KEY, id);
    },
    listDevices,
    open,
    sending,
    levels,
    problem,
    waiting,
    check: () => void openInput(),
    stopCheck: () => {
      if (!sendingNow.current) close.current?.();
    },
    startSending: () => {
      const ask = asks.start();
      return openInput().then((ok): StartResult => {
        if (!asks.stands(ask)) return 'cancelled'; // (a Stop came while it opened)
        if (!ok) return 'failed';
        sendingNow.current = true;
        setSending(true);
        return 'started';
      });
    },
    stopSending: () => {
      const ask = asks.stop();
      close.current?.();
      // the browser still asks for the microphone: it closes as soon as it opens, unless a start
      // came after this Stop (else it would send for nothing until the page closes, audit 20)
      void starting.current?.then(() => {
        if (asks.isLast(ask)) close.current?.();
      });
    },
  };
}
