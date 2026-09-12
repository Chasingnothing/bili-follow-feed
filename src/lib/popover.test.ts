import { describe, it, expect } from 'vitest';
import { computePopoverPos, POPOVER_MARGIN } from './popover';

const viewport = { width: 1000, height: 800 };
/** 锚点：一个 20px 高的小按钮 */
function anchorAt(top: number) {
  return { top, bottom: top + 20, left: 300 };
}

describe('computePopoverPos — 下方放得下', () => {
  it('贴在锚点下方', () => {
    const p = computePopoverPos(anchorAt(100), 390, 240, viewport);
    expect(p.placement).toBe('below');
    expect(p.top).toBe(124);
  });

  it('maxHeight 不小于可用空间，不会平白压缩', () => {
    const p = computePopoverPos(anchorAt(100), 390, 240, viewport);
    expect(p.maxHeight).toBeGreaterThanOrEqual(390);
  });
});

describe('computePopoverPos — 需要翻转（就是这次报的 bug）', () => {
  it('锚点贴近底部时翻到上方', () => {
    // 锚点底部在 790，下方只剩 2px，装不下 390
    const p = computePopoverPos(anchorAt(770), 390, 240, viewport);
    expect(p.placement).toBe('above');
  });

  it('翻转后菜单整体在视口内', () => {
    const p = computePopoverPos(anchorAt(770), 390, 240, viewport);
    expect(p.top).toBeGreaterThanOrEqual(POPOVER_MARGIN);
    expect(p.top + 390).toBeLessThanOrEqual(800 - POPOVER_MARGIN);
  });

  it('两边都差一点时选空间更大的一侧轻微压缩，而不是硬翻转', () => {
    // anchorAt(380) → 下方可用 388，上方可用 368，菜单 390
    // 下方更大 → 留在下方压 2px；翻上去反而要压 22px
    const p = computePopoverPos(anchorAt(380), 390, 240, viewport);
    expect(p.placement).toBe('below');
    expect(p.maxHeight).toBe(388);
  });

  it('恰好放得下时完全压缩', () => {
    const p = computePopoverPos(anchorAt(380), 388, 240, viewport);
    expect(p.placement).toBe('below');
    expect(p.maxHeight).toBe(388);
  });
});

describe('computePopoverPos — 上下都放不下时压缩', () => {
  it('选空间更大的一侧', () => {
    // 视口 800，锚点 top=500 bottom=520：下方 272，上方 488 → 上方更大
    const p = computePopoverPos(anchorAt(500), 700, 240, viewport);
    expect(p.placement).toBe('above');
    expect(p.maxHeight).toBe(Math.max(140, 488));
  });

  it('下方更大时留在下方', () => {
    // 锚点靠近顶部 → 下方空间更大
    const p = computePopoverPos(anchorAt(60), 700, 240, viewport);
    expect(p.placement).toBe('below');
  });

  it('maxHeight 有下限，不会压到放不下一行', () => {
    const p = computePopoverPos(anchorAt(400), 700, 240, viewport);
    expect(p.maxHeight).toBeGreaterThanOrEqual(140);
  });
});

describe('computePopoverPos — 横向夹边', () => {
  it('靠右时向左收', () => {
    const p = computePopoverPos({ top: 100, bottom: 120, left: 950 }, 200, 240, viewport);
    expect(p.left).toBe(1000 - 240 - POPOVER_MARGIN);
  });

  it('靠左时不越过左边界（原来只夹了右边）', () => {
    const p = computePopoverPos({ top: 100, bottom: 120, left: -50 }, 200, 240, viewport);
    expect(p.left).toBe(POPOVER_MARGIN);
  });

  it('正常位置不动', () => {
    const p = computePopoverPos({ top: 100, bottom: 120, left: 300 }, 200, 240, viewport);
    expect(p.left).toBe(300);
  });
});

describe('computePopoverPos — 退化情形', () => {
  it('视口比菜单还矮时 top 不跑到屏幕外', () => {
    const tiny = { width: 400, height: 200 };
    const p = computePopoverPos({ top: 100, bottom: 120, left: 10 }, 600, 240, tiny);
    expect(p.top).toBeGreaterThanOrEqual(POPOVER_MARGIN);
  });

  it('视口比菜单还窄时 left 仍为合法值', () => {
    const tiny = { width: 200, height: 800 };
    const p = computePopoverPos({ top: 100, bottom: 120, left: 10 }, 300, 240, tiny);
    expect(p.left).toBeGreaterThanOrEqual(POPOVER_MARGIN);
  });
});
