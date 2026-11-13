// The captions on screen (mockups batch 3): the words fill it, no sentence explains it. One column:
// the page's language (or what is heard, each line with its language once more than one was heard),
// with what was heard as a band above it if wanted, the control bar under it. Face to face
// (two-way, Damian): each half is everything said in its person's language, the far half turned
// round for the person across, the control bar between them.
import type { ReactNode } from 'react';
import { HEARD, type CaptionText, type CaptionsUpdate } from '@translate/shared';
import { CaptionsList } from './CaptionsList';
import { langName } from './langs';
import { t } from './texts';
import './captions.css';

const EMPTY: CaptionText = { lines: [], first: 0, live: '' };

export function CaptionsView({
  update,
  lang,
  other,
  showHeard = false,
  bar,
  waiting,
  saying,
}: {
  update: CaptionsUpdate;
  /** The page's language (the bottom half's face to face); null: what is heard. */
  lang: string | null;
  /** Face to face: the top half's language (null: what is heard); left out: one column. */
  other?: string | null;
  showHeard?: boolean;
  /** The control bar: under the captions, or between the halves. */
  bar: ReactNode;
  /** While nothing has been said. */
  waiting: ReactNode;
  /** Read aloud (one column): the line being said. */
  saying?: number | null;
}) {
  const heard = update.texts[HEARD] ?? EMPTY;
  const heardLangs = update.heardLangs ?? {};
  // (each line's language only once more than one language was heard: Damian, minimal)
  const labels =
    new Set(Object.values(heardLangs)).size > 1
      ? Object.fromEntries(Object.entries(heardLangs).map(([n, c]) => [n, langName(c).own]))
      : undefined;
  const list = (target: string | null, turned = false, said?: number | null) => (
    <CaptionsList
      saying={said}
      text={target ? (update.texts[target] ?? EMPTY) : heard}
      labels={target ? undefined : labels}
      turned={turned}
      waiting={waiting}
      latest={t.latest}
    />
  );
  if (other !== undefined) {
    return (
      <div className="caps dual">
        <div className="half across" lang={other ?? undefined}>
          {list(other, true)}
        </div>
        {bar}
        <div className="half" lang={lang ?? undefined}>
          {list(lang)}
        </div>
      </div>
    );
  }
  return (
    <>
      <div className="caps">
        {showHeard && lang && <div className="heard-band">{list(null)}</div>}
        <div className="main-band" lang={lang ?? undefined}>
          {list(lang, false, saying)}
        </div>
      </div>
      {bar}
    </>
  );
}
