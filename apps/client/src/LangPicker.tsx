// The translation language: a field that opens a list with a search (mockups batch 2). "No
// translation" is always in the list; the last used languages come first.
import { useState } from 'react';
import { HalfMark } from './Bar';
import { langList, langName, rememberLang } from './langs';
import { t } from './texts';

export function LangPicker({
  value,
  onChange,
  startOpen = false,
  mark,
}: {
  value: string | null;
  onChange: (lang: string | null) => void;
  startOpen?: boolean;
  /** Face to face: which half of the phone this language is for. */
  mark?: 'top' | 'bottom';
}) {
  const [open, setOpen] = useState(startOpen);
  const [query, setQuery] = useState('');
  const pick = (lang: string | null) => {
    if (lang) rememberLang(lang);
    setOpen(false);
    setQuery('');
    onChange(lang);
  };
  const shown = value ? langName(value).own : t.noTranslation;
  const list = langList(query);
  return (
    <div className={`picker${open ? ' open' : ''}`}>
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
      {open && (
        <div className="picker-drop">
          <input
            className="input"
            autoFocus
            value={query}
            placeholder={t.searchLang}
            aria-label={t.searchLang}
            onChange={(e) => setQuery(e.target.value)}
          />
          <ul className="picker-list" role="listbox">
            {!query && (
              <li>
                <button role="option" aria-selected={value === null} onClick={() => pick(null)}>
                  <span>
                    {t.noTranslation}
                    <br />
                    <small>{t.noTranslationHint}</small>
                  </span>
                  {value === null && '✓'}
                </button>
              </li>
            )}
            {list.map((code) => {
              const n = langName(code);
              return (
                <li key={code}>
                  <button role="option" aria-selected={value === code} onClick={() => pick(code)}>
                    <span>
                      {n.own}
                      {n.here !== n.own && (
                        <>
                          <br />
                          <small>{n.here}</small>
                        </>
                      )}
                    </span>
                    {value === code && '✓'}
                  </button>
                </li>
              );
            })}
            {!list.length && <li className="small">{t.noLangFound}</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
