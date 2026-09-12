import { useLayoutEffect, useState, type RefObject } from 'react';
import { computePopoverPos, type Placement } from '../lib/popover';

/**
 * 把浮层定位到锚点旁边：**优先下方，放不下翻到上方，都放不下就压缩高度**。
 *
 * 两处关键点：
 *  1. 用 `useLayoutEffect` 而不是 `useEffect` —— 它在 DOM 变更后、**浏览器绘制前**
 *     同步跑，所以第一帧就能拿到正确位置，不会出现"先闪一下再跳过去"。
 *  2. 首次渲染时菜单先以 `visibility: hidden` 摆出来（有布局才有 offsetHeight 可
 *     测），量完立刻定位并显示，整个过程在绘制前完成。
 *
 * 调用方在 `pos` 为 null 时应渲染成隐藏态，见 `hiddenStyle`。
 */
export function usePopoverPosition<T extends HTMLElement>(
  anchor: DOMRect | null,
  menuRef: RefObject<T | null>,
  width: number,
): Placement | null {
  const [pos, setPos] = useState<Placement | null>(null);

  useLayoutEffect(() => {
    if (!anchor) {
      setPos(null);
      return;
    }
    const el = menuRef.current;
    // 这一帧还没渲染出菜单 → 等下一次（渲染后本 effect 会再跑）
    if (!el) return;

    const naturalHeight = el.offsetHeight;
    setPos(
      computePopoverPos(anchor, naturalHeight, width, {
        width: window.innerWidth,
        height: window.innerHeight,
      }),
    );
  }, [anchor, menuRef, width]);

  return pos;
}

/** 尚未测量时的样式：占位可见性隐藏，但仍参与布局以便测量高度 */
export const POPOVER_HIDDEN_STYLE = {
  visibility: 'hidden' as const,
  left: 0,
  top: 0,
};
