import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './theme.css';
import './captions.css';
import { watchInstall } from './install';
import { ui } from './ui';

document.documentElement.lang = ui;
// (the browser's install question may come before any page asks: mockups batch 7)
watchInstall();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
