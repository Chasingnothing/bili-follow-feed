import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { isFeedPath } from './lib/route';

/**
 * 隐藏 B站 原生内容。挂载点在 document.documentElement 下（脚本 @run-at
 * document-start，此时 document.body 还不存在），所以要隐藏的是 body 本身。
 */
function activate(on: boolean): void {
  document.documentElement.classList.toggle('bff-active', on);
}

function teardown(): void {
  activate(false);
  document.getElementById('bff-root')?.remove();
}

function mount(): boolean {
  if (!isFeedPath(location.pathname)) {
    teardown();
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

/**
 * 兜底：B站 自己的脚本可能在启动后重渲染文档，把我们挂在 html 下的节点清掉。
 *
 * 这里只做「节点没了就补挂」，不做「路径变了就自我拆除」的猜测 —— 旧版是
 * 用 hash 判断的，而 B站 有权改写 hash，一旦它这么做我们就会把页面还回去。
 * 路径经 2026-09-11 实测是稳定的，所以现在这个判断是可靠语义。
 */
const observer = new MutationObserver(() => {
  if (isFeedPath(location.pathname) && !document.getElementById('bff-root')) {
    mount();
  }
});
observer.observe(document.documentElement, { childList: true });
