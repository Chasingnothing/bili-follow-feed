import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { LOAD_MORE_OPTIONS, type MoreProgress } from '../hooks/useFeed';
import { readJson, writeJson } from '../lib/storage';

/** 拖动后的位置持久化，省得每次重新摆 */
const POS_KEY = 'bff:loadMorePos';
const MARGIN = 8;

interface Pos {
  left: number;
  top: number;
}

interface Props {
  loaded: number;
  hasMore: boolean;
  busy: boolean;
  progress: MoreProgress | null;
  /** 后台增量刷新中（内容已在显示，只是在检查有没有新的） */
  refreshing: boolean;
  /** 批量操作条出现时，默认位置上移让位 */
  raised: boolean;
  onLoad: (pages: number) => void;
}

function clampPos(p: Pos, w: number, h: number): Pos {
  const maxLeft = Math.max(MARGIN, window.innerWidth - w - MARGIN);
  const maxTop = Math.max(MARGIN, window.innerHeight - h - MARGIN);
  return {
    left: Math.min(Math.max(MARGIN, p.left), maxLeft),
    top: Math.min(Math.max(MARGIN, p.top), maxTop),
  };
}

/**
 * 右下角悬浮「加载更多」。
 *
 * 需要能拖动的原因：板块底部的页码条也在右下角，固定位置会挡住它的翻页按钮。
 * 拖一下即可避开，位置记在本地，下次直接用。
 *
 * 交互拆成三块，避免「只想加载 1 页却被迫先开菜单」：
 *   「⠿ 已加载 N 条」 = 拖动手柄（双击复位）
 *   「加载更多」       = 直接加载 1 页
 *   「▾」             = 展开页数选择
 */
export default function LoadMoreBar({
  loaded,
  hasMore,
  busy,
  progress,
  refreshing,
  raised,
  onLoad,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Pos | null>(() => readJson<Pos | null>(POS_KEY, null));
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragging, setDragging] = useState(false);

  /** 与 pos 同步的镜像：拖动结束时要写盘，而不该在 setState 更新函数里做副作用 */
  const posRef = useRef<Pos | null>(pos);
  const drag = useRef<{
    startX: number;
    startY: number;
    originLeft: number;
    originTop: number;
    w: number;
    h: number;
  } | null>(null);

  // 视口变化后把按钮拉回可见范围，避免拖到屏幕外找不回来
  useEffect(() => {
    if (!pos) return;
    const onResize = () => {
      const el = ref.current;
      if (!el) return;
      const next = clampPos(posRef.current ?? pos, el.offsetWidth, el.offsetHeight);
      posRef.current = next;
      setPos(next);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [pos]);

  // 菜单：点外部或 Esc 关闭
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const onHandleDown = useCallback((e: ReactPointerEvent) => {
    const el = ref.current;
    if (!el) return;
    e.preventDefault(); // 否则拖动时会选中文字
    const r = el.getBoundingClientRect();
    drag.current = {
      startX: e.clientX,
      startY: e.clientY,
      originLeft: r.left,
      originTop: r.top,
      w: r.width,
      h: r.height,
    };
    setDragging(true);

    const move = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const next = clampPos(
        {
          left: d.originLeft + (ev.clientX - d.startX),
          top: d.originTop + (ev.clientY - d.startY),
        },
        d.w,
        d.h,
      );
      posRef.current = next;
      setPos(next);
    };
    const up = () => {
      drag.current = null;
      setDragging(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (posRef.current) writeJson(POS_KEY, posRef.current);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, []);

  /** 双击手柄复位回右下角 */
  const onHandleDoubleClick = useCallback(() => {
    posRef.current = null;
    setPos(null);
    writeJson(POS_KEY, null);
  }, []);

  if (!hasMore && !progress) return null;

  const style = pos
    ? { left: pos.left, top: pos.top, right: 'auto', bottom: 'auto' }
    : { bottom: raised ? 76 : 18 };

  return (
    <div className={`bff-loadmore${dragging ? ' is-dragging' : ''}`} ref={ref} style={style}>
      <span
        className="bff-loadmore-handle"
        onPointerDown={onHandleDown}
        onDoubleClick={onHandleDoubleClick}
        title="按住拖动位置 · 双击复位到右下角"
      >
        ⠿ 已加载 {loaded} 条
        {refreshing && <span className="bff-loadmore-checking">· 检查更新中…</span>}
      </span>

      {progress ? (
        <span className="bff-loadmore-progress">
          加载中 {progress.done}/{progress.total} 页…
        </span>
      ) : (
        <>
          <button
            type="button"
            className="bff-loadmore-go"
            disabled={busy}
            onClick={() => onLoad(1)}
            title="加载下一页"
          >
            加载更多
          </button>
          <button
            type="button"
            className="bff-loadmore-caret"
            disabled={busy}
            onClick={() => setMenuOpen((v) => !v)}
            title="选择要加载几页"
            aria-expanded={menuOpen}
          >
            ▾
          </button>

          {menuOpen && (
            <div className="bff-loadmore-menu">
              {LOAD_MORE_OPTIONS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onLoad(n);
                  }}
                >
                  加载 {n} 页
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
