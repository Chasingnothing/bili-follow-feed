import type { ChangeEvent } from 'react';
import type { BatchOp, Group } from '../lib/localGroups';

interface Props {
  count: number;
  groups: Group[];
  canUndo: boolean;
  lastAction: string | null;
  onApply: (op: BatchOp) => void;
  onUndo: () => void;
  onClearSelection: () => void;
  onExit: () => void;
}

/**
 * 批量分类操作条（设计文档 §6.3）。
 *
 * 只保留低频操作 —— 「加入分组」已经移到主区顶部的图标面板，那里一次点击即可，
 * 不再需要"点开下拉再选"两步。
 *
 * 三个下拉都是「选完即执行」，执行后回到占位项（受控 value="" 保证这一点）。
 * 批量误操作代价高，所以撤销入口常驻在这里。
 */
export default function BatchBar({
  count,
  groups,
  canUndo,
  lastAction,
  onApply,
  onUndo,
  onClearSelection,
  onExit,
}: Props) {
  const ordered = [...groups].sort((a, b) => a.order - b.order);
  const disabled = count === 0;

  function pick(fn: (groupId: string) => BatchOp) {
    return (e: ChangeEvent<HTMLSelectElement>) => {
      const gid = e.target.value;
      if (gid) onApply(fn(gid));
    };
  }

  return (
    <div className="bff-batch">
      <span className="bff-batch-count">已选 {count} 个</span>

      <select value="" disabled={disabled} onChange={pick((g) => ({ type: 'remove', groupId: g }))}>
        <option value="">移出分组 ▾</option>
        {ordered.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>

      <select value="" disabled={disabled} onChange={pick((g) => ({ type: 'only', groupId: g }))}>
        <option value="">仅属于… ▾</option>
        {ordered.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>

      <button type="button" disabled={disabled} onClick={() => onApply({ type: 'clear' })}>
        移出全部
      </button>

      <button type="button" onClick={onClearSelection} disabled={disabled}>
        清除选择
      </button>

      {canUndo && (
        <span className="bff-batch-undo">
          {lastAction ?? '已应用'}
          <button type="button" onClick={onUndo}>
            撤销
          </button>
        </span>
      )}

      <button type="button" className="bff-batch-exit" onClick={onExit}>
        退出批量
      </button>
    </div>
  );
}
