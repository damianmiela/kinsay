// The captions on screen, for the host and for readers. Without a translation: what is heard, each
// line with the language it was heard in. With one: the translation (and what was heard as a smaller
// band above it, if wanted), or face to face: the phone lies between two people, the top half turned
// round shows the translation to the one across, the bottom half what is heard to the host.
import { HEARD, type CaptionText, type CaptionsUpdate } from '@translate/shared';
import { CaptionsList } from './CaptionsList';
import { langName } from './langs';
import { t } from './texts';
import './captions.css';

const EMPTY: CaptionText = { lines: [], first: 0, live: '' };

export function CaptionsView({
  update,
  lang,
  faceToFace,
  showHeard,
  onFaceToFaceOff,
  reader = false,
}: {
  /** A reader's page (nobody there to "say something"). */
  reader?: boolean;
  update: CaptionsUpdate;
  lang: string | null;
  faceToFace: boolean;
  showHeard: boolean;
  onFaceToFaceOff?: () => void;
}) {
  const heard = update.texts[HEARD] ?? EMPTY;
  const labels = Object.fromEntries(
    Object.entries(update.heardLangs ?? {}).map(([n, code]) => [n, langName(code).own]),
  );
  const heardList = (
    <CaptionsList
      text={heard}
      labels={labels}
      note={t.heardNote}
      waiting={reader ? t.waitingReader : t.waitingWords}
      latest={t.latest}
    />
  );
  if (!lang) return <div className="caps">{heardList}</div>;
  const translated = update.texts[lang] ?? EMPTY;
  const translatedList = (
    <CaptionsList
      text={translated}
      turned={faceToFace}
      note={t.note}
      waiting={reader ? t.waitingReader : t.waitingWords}
      latest={t.latest}
    />
  );
  if (faceToFace) {
    return (
      <div className="caps dual">
        <div className="half across" lang={lang}>
          {translatedList}
        </div>
        <div className="fold">
          <span>{t.faceToFace}</span>
          {onFaceToFaceOff && (
            <button className="btn sm" onClick={onFaceToFaceOff}>
              {t.turnOff}
            </button>
          )}
        </div>
        <div className="half">{heardList}</div>
      </div>
    );
  }
  return (
    <div className="caps">
      {showHeard && <div className="heard-band">{heardList}</div>}
      <div className="main-band" lang={lang}>
        {translatedList}
      </div>
    </div>
  );
}
