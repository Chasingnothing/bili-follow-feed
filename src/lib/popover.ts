export interface Placement {
  left: number;
  top: number;
  /** 菜单被允许的最大高度；超出时内部列表滚动 */
  maxHeight: number;
  placement: 'below' | 'above';
}

export const POPOVER_MARGIN = 8;
export const POPOVER_GAP = 4;
/** 压缩后至少留这么高 —— 再矮就连一行选项都放不下，没有意义 */
export const POPOVER_MIN_HEIGHT = 140;

export interface AnchorRect {
  top: number;
  bottom: number;
  left: number;
}

/**
 * 计算浮层位置：**优先在锚点下方，放不下就翻到上方，上下都放不下就压缩高度**。
 *
 * 之前的写法是 `top = Math.min(anchor.bottom + 4, innerHeight - 60)` —— 那个 60
 * 是拍脑袋的数，而菜单实际约 390px 高。锚点靠近屏幕底部时，菜单从"离底 60px"
 * 处开始往下长，超出的部分直接被屏幕截掉，底部的操作项点不到。
 *
 * 抽成纯函数是为了可测：三种分支（下方 / 翻转 / 压缩）都能在不碰 DOM 的情况下验证。
 */
export function computePopoverPos(
  anchor: AnchorRect,
  naturalHeight: number,
  width: number,
  viewport: { width: number; height: number },
): Placement {
  const { width: vw, height: vh } = viewport;
  const spaceBelow = vh - anchor.bottom - POPOVER_GAP - POPOVER_MARGIN;
  const spaceAbove = anchor.top - POPOVER_GAP - POPOVER_MARGIN;

  // 横向两侧都要夹 —— 原来只夹了右边
  const left = Math.min(
    Math.max(POPOVER_MARGIN, anchor.left),
    Math.max(POPOVER_MARGIN, vw - width - POPOVER_MARGIN),
  );

  // ① 下方放得下
  if (naturalHeight <= spaceBelow) {
    return {
      left,
      top: anchor.bottom + POPOVER_GAP,
      maxHeight: spaceBelow,
      placement: 'below',
    };
  }

  // ② 翻到上方放得下
  if (naturalHeight <= spaceAbove) {
    return {
      left,
      top: anchor.top - POPOVER_GAP - naturalHeight,
      maxHeight: spaceAbove,
      placement: 'above',
    };
  }

  // ③ 两边都放不下 → 选空间大的一侧，压缩高度让内部滚动
  if (spaceBelow >= spaceAbove) {
    const maxHeight = Math.max(POPOVER_MIN_HEIGHT, spaceBelow);
    return {
      left,
      top: anchor.bottom + POPOVER_GAP,
      maxHeight,
      placement: 'below',
    };
  }

  const maxHeight = Math.max(POPOVER_MIN_HEIGHT, spaceAbove);
  return {
    left,
    // 视口极小时可能压不住，至少别跑到屏幕外
    top: Math.max(POPOVER_MARGIN, anchor.top - POPOVER_GAP - maxHeight),
    maxHeight,
    placement: 'above',
  };
}
