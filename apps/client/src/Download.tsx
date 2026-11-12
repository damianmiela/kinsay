// /download: the desktop app for Windows (one file, Translate.exe, built by desktop/pack-win.mjs into
// public/download/). Open to anyone, like the sign-in page.
import { Foot, Logo } from './bits';
import { download as d } from './texts';

export function DownloadPage() {
  return (
    <div className="page">
      <div className="bar">
        <a href="/" style={{ textDecoration: 'none', color: 'inherit' }}>
          <Logo />
        </a>
      </div>
      <div className="body">
        <h1 className="t">{d.title}</h1>
        <p className="s">{d.body}</p>
        <a className="btn main" href="/download/Translate.exe" download>
          {d.button}
        </a>
        <p className="small">{d.small}</p>
        <h2 className="t">{d.then}</h2>
        <ol className="steps">
          {d.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <p className="s">
          {d.elsewhere}{' '}
          <a className="link" href="/">
            {d.open}
          </a>
        </p>
        <Foot />
      </div>
    </div>
  );
}
