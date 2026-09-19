import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, useState, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import Sidebar from './Sidebar';
// 用 Vite 的 ?raw 读源码，避免为测试引入 @types/node（tsconfig 的 types 里没有 node）
import appSource from '../App.tsx?raw';
import type { TrimmedFollowedUp } from '../types';
import { SEARCH_ROW_LIMIT } from '../lib/searchLimit';

/**
 * 这些测试保护的是**性能不变量**，不是外观。
 *
 * 背景：动态流加载时会连续 `setCards`（最多 40 页），App 反复重渲染。
 * `Sidebar` 的 props **没有一个来自 cards**，本来不需要跟着重渲染；但若
 * `memo` 失效（典型原因：调用方传了内联箭头函数），关注 5000 人时就是
 * 5000 行 DOM 被无谓重建 40 次 —— 表现是页面卡死。
 *
 * 手法：用一个**计数代理**包住 `selected`，数 `has()` 被调用了几次。
 * Sidebar 每渲染一行就会调一次 `selected.has`，所以"调用次数有没有增加"
 * 就是"Sidebar 有没有重渲染"的可靠信号 —— 不需要往生产代码里塞计数器。
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeFollowings(n: number): TrimmedFollowedUp[] {
  return Array.from({ length: n }, (_, i) => ({
    mid: 1000 + i,
    uname: `UP${i}`,
    face: 'https://i0.hdslb.com/bfs/face/x.jpg',
    tag: null,
    special: 0 as const,
  }));
}

/** 全部塞进同一个分组，保证每一行都会渲染出来 */
function membershipOf(list: TrimmedFollowedUp[]): Record<string, string[]> {
  const m: Record<string, string[]> = {};
  for (const u of list) m[String(u.mid)] = ['g1'];
  return m;
}

/** 数 `Set.has` 被调用的次数 —— 用作"Sidebar 渲染了几行"的探针 */
function countingSet(): { proxy: Set<number>; calls: () => number } {
  let n = 0;
  const inner = new Set<number>();
  const proxy = new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop === 'has') {
        return (v: number) => {
          n++;
          return target.has(v);
        };
      }
      const val = Reflect.get(target, prop, receiver) as unknown;
      return typeof val === 'function' ? (val as (...a: unknown[]) => unknown).bind(target) : val;
    },
  }) as Set<number>;
  return { proxy, calls: () => n };
}

const noop = () => {};

function baseProps(selected: Set<number>, count = 30): ComponentProps<typeof Sidebar> {
  const followings = makeFollowings(count);
  return {
    groups: [{ id: 'g1', name: '测试组', order: 0, kind: 'normal', source: 'local' }],
    membership: membershipOf(followings),
    followings,
    loading: false,
    error: null,
    lastSync: 0,
    fromCache: false,
    batchActive: true,
    selected,
    diverged: new Set<number>(),
    onToggleBatch: noop,
    onToggleSelect: noop,
    onSelectMany: noop,
    onPick: noop,
    onRefresh: noop,
    onMergeImport: noop,
    onOpenGroupMenu: noop,
  };
}

/** 父组件持有**与 Sidebar 无关**的状态，用来触发父级重渲染 */
function Harness(props: ComponentProps<typeof Sidebar>) {
  const [n, setN] = useState(0);
  return (
    <div>
      <button id="bump" type="button" onClick={() => setN((v) => v + 1)}>
        {n}
      </button>
      <Sidebar {...props} />
    </div>
  );
}

/** React 会缓存 input 的上一次值，直接赋值可能不触发 onChange —— 走原生 setter */
function typeSearch(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('Sidebar 的 memo 不变量', () => {
  it('父组件因无关状态重渲染时，Sidebar 不应重渲染', () => {
    const { proxy, calls } = countingSet();
    act(() => root.render(<Harness {...baseProps(proxy)} />));

    const afterMount = calls();
    // 先证明"确实渲染了行" —— 否则下面的断言可能因为压根没渲染而假通过
    expect(afterMount).toBeGreaterThan(10);
    expect(container.querySelectorAll('.bff-up-row').length).toBe(30);

    act(() => {
      container.querySelector<HTMLButtonElement>('#bump')!.click();
    });

    expect(calls()).toBe(afterMount);
  });

  it('对照实验：换成新的 selected 引用时**必须**重渲染（证明上面的测试能测出重渲染）', () => {
    const a = countingSet();
    act(() => root.render(<Harness {...baseProps(a.proxy)} />));
    const afterA = a.calls();
    expect(afterA).toBeGreaterThan(10);

    const b = countingSet();
    act(() => root.render(<Harness {...baseProps(b.proxy)} />));
    // 换了 Set 引用 → memo 判定 props 变了 → 重渲染 → 新代理被读取
    expect(b.calls()).toBeGreaterThan(10);
  });
});

describe('Sidebar 搜索渲染上限', () => {
  it('⚠️ 不搜索时必须完整列出，不能被上限截断（否则用户没法分类）', () => {
    const { proxy } = countingSet();
    act(() => root.render(<Harness {...baseProps(proxy, 120)} />));

    // 这条曾经挂过：当时 limitMatches 被无条件调用，262 人的未分类只会显示 50 个
    expect(container.querySelectorAll('.bff-up-row')).toHaveLength(120);
    expect(container.textContent).not.toContain('未显示');
  });

  it('匹配数少于上限时全部渲染', () => {
    const { proxy } = countingSet();
    act(() => root.render(<Harness {...baseProps(proxy, 30)} />));

    act(() => typeSearch(container.querySelector<HTMLInputElement>('.bff-search')!, 'UP'));

    expect(container.querySelectorAll('.bff-up-row')).toHaveLength(30);
    expect(container.textContent).not.toContain('未显示');
  });

  it('匹配数超过上限时只渲染前 N 行，并提示还有多少', () => {
    const { proxy } = countingSet();
    act(() => root.render(<Harness {...baseProps(proxy, 120)} />));

    act(() => typeSearch(container.querySelector<HTMLInputElement>('.bff-search')!, 'UP'));

    expect(container.querySelectorAll('.bff-up-row')).toHaveLength(SEARCH_ROW_LIMIT);
    expect(container.textContent).toContain(`还有 ${120 - SEARCH_ROW_LIMIT} 个匹配未显示`);
  });

  it('上限只影响渲染，分组计数仍报真实匹配数', () => {
    const { proxy } = countingSet();
    act(() => root.render(<Harness {...baseProps(proxy, 120)} />));

    act(() => typeSearch(container.querySelector<HTMLInputElement>('.bff-search')!, 'UP'));

    expect(container.querySelector('.bff-side-count')?.textContent).toBe('120');
  });
});

/**
 * 上面的组件测试验证的是"**props 稳定时** memo 生效"。
 *
 * 但真正踩过的坑在**调用方**：`App.tsx` 曾经写成
 * `onOpenGroupMenu={(el) => ...}` —— 内联箭头每次渲染都换新引用，
 * 于是 memo 形同虚设。组件测试抓不到这个，所以这里直接扫源码兜住它。
 *
 * 代价是它依赖 `App.tsx` 的书写格式；如果哪天重构导致它误报，
 * 改这个测试比改回内联箭头更划算。
 */
describe('App → Sidebar 的 props 必须是稳定引用', () => {
  function sidebarJsx(): string {
    const start = appSource.indexOf('<Sidebar');
    if (start < 0) throw new Error('App.tsx 里找不到 <Sidebar');
    const end = appSource.indexOf('/>', start);
    if (end < 0) throw new Error('App.tsx 里找不到 <Sidebar 的结束标记');
    return appSource.slice(start, end);
  }

  it('不能传内联箭头函数（会让 memo 完全失效）', () => {
    const offenders = sidebarJsx()
      .split('\n')
      .filter((line) => line.includes('=>'));
    expect(offenders).toEqual([]);
  });

  it('守卫本身有效：能扫到 Sidebar 的 JSX 块', () => {
    const block = sidebarJsx();
    expect(block).toContain('onOpenGroupMenu=');
    expect(block.split('\n').length).toBeGreaterThan(5);
  });
});
