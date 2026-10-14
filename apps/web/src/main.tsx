import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

const SELECTABLE = 'input, textarea, .monaco-editor, .xterm, .editor-body, [contenteditable="true"]';

const INJECTED_MENU =
  '[id*="msCopy"], [id*="msSearch"], [id*="ms-context"], [id*="MiniMenu"], [id*="mini-menu"], ' +
  '[class*="ms-context"], [class*="smart-actions"], [class*="smart-action"], [class*="mini-menu"], ' +
  '[class*="MiniMenu"], [class*="selection-menu"], [class*="quick-search"], [class*="QuickSearch"]';

function blockBrowserMenu(e: Event) {
  e.preventDefault();
}

function hasTextSelection() {
  const sel = window.getSelection()?.toString();
  if (sel) return true;
  const active = document.activeElement;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    return active.selectionStart !== active.selectionEnd;
  }
  return false;
}

/** Edge's mini menu is browser chrome; preventDefault on mouseup is what actually hides it. */
function blockEdgeMiniMenu(e: Event) {
  if (!hasTextSelection()) return;
  e.preventDefault();
}

document.addEventListener('contextmenu', blockBrowserMenu, true);
document.addEventListener('auxclick', (e) => {
  if (e.button === 2) e.preventDefault();
}, true);
document.addEventListener('selectstart', (e) => {
  const node = e.target as HTMLElement | null;
  if (node?.closest(SELECTABLE)) return;
  e.preventDefault();
}, true);
document.addEventListener('dragstart', (e) => {
  const node = e.target as HTMLElement | null;
  if (node?.closest(SELECTABLE)) return;
  if (node?.closest('[draggable="true"]')) return;
  e.preventDefault();
}, true);
document.addEventListener('mouseup', blockEdgeMiniMenu, true);
document.addEventListener('pointerup', blockEdgeMiniMenu, true);

function stripInjectedMenus() {
  document.querySelectorAll(INJECTED_MENU).forEach((node) => {
    if ((node as HTMLElement).closest?.('.app, .menu, .float-pop')) return;
    node.remove();
  });
}

new MutationObserver(stripInjectedMenus).observe(document.documentElement, {
  childList: true,
  subtree: true,
});
document.addEventListener('selectionchange', stripInjectedMenus);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
