import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

function blockBrowserMenu(e: Event) {
  e.preventDefault();
}

document.addEventListener('contextmenu', blockBrowserMenu, true);
document.addEventListener('auxclick', (e) => {
  if (e.button === 2) e.preventDefault();
}, true);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
