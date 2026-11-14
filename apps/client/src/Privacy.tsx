// /privacy: what Kinsay keeps and never keeps (Google asks for the page before everyone may sign
// in with Google). Open to anyone; who is responsible comes from the server's settings.
import { useEffect, useState } from 'react';
import { api } from './api';
import { Logo } from './bits';
import { privacyPage as p } from './texts';

export function PrivacyPage() {
  const [contact, setContact] = useState<{ name: string; email: string } | null>(null);
  useEffect(() => {
    void api<{ contact: { name: string; email: string } | null }>('/api/config').then((r) => {
      if (r.ok) setContact(r.contact);
    });
  }, []);
  return (
    <div className="page">
      <div className="bar">
        <a href="/" style={{ textDecoration: 'none', color: 'inherit' }}>
          <Logo />
        </a>
      </div>
      <div className="body prose">
        <h1 className="t">{p.title}</h1>
        <p className="s">{p.intro(contact?.name ?? 'the person who invited you')}</p>
        {p.sections.map((sec) => (
          <section key={sec.h}>
            <h2 className="t">{sec.h}</h2>
            {sec.p.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </section>
        ))}
        {contact && (
          <section>
            <h2 className="t">{p.contactTitle}</h2>
            <p>
              {contact.name}
              <br />
              <a className="link" href={`mailto:${contact.email}`}>
                {contact.email}
              </a>
            </p>
          </section>
        )}
        <p className="small">{p.updated}</p>
      </div>
    </div>
  );
}
