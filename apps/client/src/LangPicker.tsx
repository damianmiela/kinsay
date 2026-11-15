// The translation language (mockups batch 3). A field that opens a sheet with no keyboard: no
// translation, the five, at most two used before, then "Other languages" (a search and the whole
// list A to Z). The desktop window has its own list, in its drawer (Window.tsx's Langs).
import { useState } from 'react';
import { HalfMark, IconClose, IconRight } from './Bar';
import { Sheet } from './bits';
import { langList, langName, MAIN_LANGS, rememberLang, usedBefore } from './langs';
import { t } from './texts';

const IconBack = () => (
  <svg
    width="22"
    height="22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="m15 6-6 6 6 6" />
  </svg>
);

/** The list in a sheet: picks one and closes. */
export function LangSheet({
  title,
  value,
  onPick,
  onClose,
  full,
}: {
  title: string;
  value: string | null;
  /** The session reads three languages already: only those (and no translation) may be picked. */
  full?: { langs: readonly string[]; note: string };
  onPick: (lang: string | null) => void;
  onClose: () => void;
}) {
  const [all, setAll] = useState(false);
  const [query, setQuery] = useState('');
  const pick = (lang: string | null) => {
    if (lang) rememberLang(lang);
    onPick(lang);
  };
  const row = (code: string | null, side?: string, off = false) => {
    const n = code ? langName(code) : null;
    const on = value === code;
    return (
      <button
        key={code ?? '-'}
        disabled={off}
        className={`li link-row lang-row${off ? ' off' : ''}`}
        role="option"
        aria-selected={on}
        onClick={() => pick(code)}
      >
        <span className="what">
          {n ? n.own : t.noTranslation}
          {!n && <small>{t.noTranslationHint}</small>}
        </span>
        {(side ?? (n && n.here !== n.own ? n.here : null)) && (
          <span className="val">{side ?? n!.here}</span>
        )}
        {on && <span className="tick">✓</span>}
      </button>
    );
  };

  if (!all) {
    return (
      <Sheet label={title} onClose={onClose}>
        <div className="sheet-head">
          <h2 className="t">{title}</h2>
          <button className="ibtn" onClick={onClose} aria-label={t.close}>
            <IconClose />
          </button>
        </div>
        {full ? (
          <>
            <div className="note warn">{full.note}</div>
            <div className="list" role="listbox" aria-label={title}>
              {row(null)}
              {full.langs.map((c) => row(c))}
              {MAIN_LANGS.filter((c) => !full.langs.includes(c)).map((c) =>
                row(c, undefined, true),
              )}
            </div>
          </>
        ) : (
          <div className="list" role="listbox" aria-label={title}>
            {row(null)}
            {MAIN_LANGS.map((c) => row(c))}
            {usedBefore().map((c) => row(c, t.usedBefore))}
            <button className="li link-row" onClick={() => setAll(true)}>
              <span className="what">{t.otherLangs}</span>
              <IconRight />
            </button>
          </div>
        )}
      </Sheet>
    );
  }
  const list = langList(query);
  // (A to Z under letters while nothing is typed: for someone who would rather scroll than spell)
  const letterOf = (c: string | undefined) =>
    c ? langName(c).here.charAt(0).toLocaleUpperCase() : '';
  return (
    <Sheet label={t.otherLangs} onClose={onClose}>
      <div className="sheet-head start">
        <button className="ibtn" onClick={() => setAll(false)} aria-label={t.backHome}>
          <IconBack />
        </button>
        <h2 className="t">{t.otherLangs}</h2>
      </div>
      <input
        className="input lang-search"
        autoFocus
        value={query}
        placeholder={t.searchLang}
        aria-label={t.searchLang}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="list" role="listbox" aria-label={t.otherLangs}>
        {list.map((c, i) => {
          const first = letterOf(c);
          const head = !query && first !== letterOf(list[i - 1]);
          return head ? (
            <div key={c} className="lang-group">
              <div className="letter">{first}</div>
              {row(c)}
            </div>
          ) : (
            row(c)
          );
        })}
        {!list.length && <p className="small">{t.noLangFound}</p>}
      </div>
    </Sheet>
  );
}

export function LangPicker({
  value,
  onChange,
  title = t.translateIntoSet,
  startOpen = false,
  mark,
}: {
  value: string | null;
  onChange: (lang: string | null) => void;
  /** The sheet's title (the field's label). */
  title?: string;
  startOpen?: boolean;
  /** Face to face: which half of the phone this language is for. */
  mark?: 'top' | 'bottom';
}) {
  const [open, setOpen] = useState(startOpen);
  const shown = value ? langName(value).own : t.noTranslation;
  const field = (
    <button
      type="button"
      className="picker-field"
      aria-expanded={open}
      onClick={() => setOpen(!open)}
    >
      <span className="picker-value">
        {mark && <HalfMark top={mark === 'top'} />}
        {shown}
      </span>
    </button>
  );
  return (
    <div className="picker">
      {field}
      {open && (
        <LangSheet
          title={title}
          value={value}
          onPick={(l) => {
            setOpen(false);
            onChange(l);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
