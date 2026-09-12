import { useState } from 'react';
import { PAGE_SIZE, clampPage, pageCount, pageNumbers, pageRange } from '../lib/pagination';

interface Props {
  page: number;
  total: number;
  onChange: (page: number) => void;
}

/**
 * 板块底部的页码条。
 *
 * 布局：左边范围、**中间页码**、右边跳转框。页码居中是因为它是最常点的东西，
 * 靠右时鼠标要跑很远；跳转框给「第 23 页」这种要跨很多页的情况用。
 *
 * 未分类能有 451 条 = 23 页，所以页码必须折叠（首尾恒在，当前页左右各一个），
 * 否则页码条本身就成了新的滚动负担。
 */
export default function Pager({ page, total, onChange }: Props) {
  const [draft, setDraft] = useState('');
  const count = pageCount(total, PAGE_SIZE);

  if (total <= PAGE_SIZE) return null;

  const { from, to } = pageRange(page, total, PAGE_SIZE);

  function jump() {
    const n = Number(draft);
    setDraft('');
    if (!Number.isFinite(n) || n <= 0) return;
    onChange(clampPage(n, total, PAGE_SIZE));
  }

  return (
    <div className="bff-pager">
      <span className="bff-pager-range">
        第 {from}-{to} 条 / 共 {total} 条
      </span>

      <div className="bff-pager-tabs">
        <button type="button" onClick={() => onChange(page - 1)} disabled={page <= 1} title="上一页">
          ‹
        </button>

        {pageNumbers(page, count).map((n, i) =>
          n === '…' ? (
            <span className="bff-pager-gap" key={`gap-${i}`}>
              …
            </span>
          ) : (
            <button
              type="button"
              key={n}
              className={n === page ? 'is-on' : ''}
              onClick={() => onChange(n)}
            >
              {n}
            </button>
          ),
        )}

        <button
          type="button"
          onClick={() => onChange(page + 1)}
          disabled={page >= count}
          title="下一页"
        >
          ›
        </button>
      </div>

      <div className="bff-pager-jump">
        跳至
        <input
          type="number"
          min={1}
          max={count}
          value={draft}
          placeholder={String(count)}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') jump();
          }}
          onBlur={jump}
          title={`共 ${count} 页`}
        />
        页
      </div>
    </div>
  );
}
