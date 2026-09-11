import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

const HASH = '#/my-feed';

function activate(on: boolean): void {
  document.documentElement.classList.toggle('bff-active', on);
}

function mount(): boolean {
  if (location.hash !== HASH) {
    activate(false);
    document.getElementById('bff-root')?.remove();
    return false;
  }
  if (document.getElementById('bff-root')) return true;

  const host = document.createElement('div');
  host.id = 'bff-root';
  host.className = 'bff-root-host';
  document.documentElement.appendChild(host);
  activate(true);
  createRoot(host).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
  return true;
}

mount();
window.addEventListener('hashchange', mount);

// B站 是 SPA，可能在路由切换时覆盖我们的节点，用观察器兜底
const observer = new MutationObserver(() => {
  if (location.hash === HASH && !document.getElementById('bff-root')) mount();
});
observer.observe(document.documentElement, { childList: true });
