import { useEffect, useRef, useState } from 'react';
import type { Group } from '../lib/localGroups';
import { MAX_GROUP_NAME } from '../lib/localGroups';

interface Props {
  upName: string;
  groups: Group[];
  /** 该 UP 当前所属的本地分组 id */
  current: string[];
  /** B站 侧的分组已变更（有快照分歧） */
  diverged: boolean;
  anchor: DOMRect;
  onToggle: (groupId: string) => void;
  onClear: () => void;
  onReset: () => void;
  onCreate: (name: string) => void;
  onClose: () => void;
}

/**
 * 单个 UP 的分组勾选菜单（设计文档 §6.2）。
 *
 * 勾选即生效；多选语义 = 追加/移除该分组，不做替换。
 * 未分类是隐式的，所以这里没有「未分类」这一项 —— 用「移出全部分组」表达。
 */
export default function GroupPicker({
  upName,
  groups,
  current,
  diverged,
  anchor,
  onToggle,
  onClear,
  onReset,
  onCreate,
  onClose,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    function onDocDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // 贴边时向左收，避免超出视口
  const width = 240;
  const left = Math.min(anchor.left, window.innerWidth - width - 8);
  const top = Math.min(anchor.bottom + 4, window.innerHeight - 60);

  const ordered = [...groups].sort((a, b) => a.order - b.order);

  return (
    <div className="bff-picker" style={{ left, top, width }} ref={ref}>
      <div className="bff-picker-head">
        {upName}
        {diverged && <span className="bff-picker-diverge">↻ B站已变更</span>}
      </div>

      <div className="bff-picker-list">
        {ordered.map((g) => (
          <label className="bff-picker-item" key={g.id}>
            <input type="checkbox" checked={current.includes(g.id)} onChange={() => onToggle(g.id)} />
            <span className="bff-picker-name">{g.name}</span>
          </label>
        ))}
      </div>

      <div className="bff-picker-foot">
        {creating ? (
          <form
            className="bff-picker-create"
            onSubmit={(e) => {
              e.preventDefault();
              const name = draft.trim();
              if (!name) return;
              onCreate(name);
              setDraft('');
              setCreating(false);
            }}
          >
            <input
              autoFocus
              value={draft}
              maxLength={MAX_GROUP_NAME}
              placeholder={`新分组名（≤${MAX_GROUP_NAME} 字）`}
              onChange={(e) => setDraft(e.target.value)}
            />
            <button type="submit">建</button>
          </form>
        ) : (
          <button type="button" onClick={() => setCreating(true)}>
            ＋ 新建分组…
          </button>
        )}

        <button type="button" onClick={onClear}>
          移出全部分组（→未分类）
        </button>

        {diverged && (
          <button type="button" onClick={onReset}>
            ↻ 按 B站 分组重置此项
          </button>
        )}
      </div>
    </div>
  );
}
