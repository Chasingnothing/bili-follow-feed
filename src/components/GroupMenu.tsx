import { useEffect, useRef, useState } from 'react';
import { MAX_GROUP_NAME, type Group } from '../lib/localGroups';
import { usePopoverPosition, POPOVER_HIDDEN_STYLE } from '../hooks/usePopoverPosition';

interface Props {
  anchor: DOMRect;
  groups: Group[];
  usage: number;
  quotaBytes: number;
  onNewGroup: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (group: Group) => void;
  onReorder: (id: string, dir: -1 | 1) => void;
  onForceOverwrite: () => void;
  onCleanup: () => void;
  onClose: () => void;
}

function kb(n: number): string {
  return `${(n / 1024).toFixed(1)} KB`;
}

/**
 * 「分组 ⋯」菜单：分组 CRUD、存储占用、危操作。
 *
 * 「强制覆盖」刻意放在这个菜单的底部而不是侧边栏显眼处 —— 它会用 B站 的分组
 * 重建全部本地分类，误点的代价很高。
 */
export default function GroupMenu({
  anchor,
  groups,
  usage,
  quotaBytes,
  onNewGroup,
  onRename,
  onDelete,
  onReorder,
  onForceOverwrite,
  onCleanup,
  onClose,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');

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

  const width = 300;
  // 与分组勾选菜单共用同一套定位规则（原来这里也拍了一个 420 的固定值）
  const pos = usePopoverPosition(anchor, ref, width);

  const custom = [...groups].filter((g) => g.kind === 'normal').sort((a, b) => a.order - b.order);

  return (
    <div
      className={`bff-gmenu${pos ? ` is-${pos.placement}` : ''}`}
      style={
        pos
          ? { left: pos.left, top: pos.top, maxHeight: pos.maxHeight, width }
          : { ...POPOVER_HIDDEN_STYLE, width }
      }
      ref={ref}
    >
      <div className="bff-gmenu-head">分组管理</div>

      <form
        className="bff-gmenu-new"
        onSubmit={(e) => {
          e.preventDefault();
          const name = draft.trim();
          if (!name) return;
          onNewGroup(name);
          setDraft('');
        }}
      >
        <input
          value={draft}
          maxLength={MAX_GROUP_NAME}
          placeholder={`新建分组（≤${MAX_GROUP_NAME} 字）`}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit">建</button>
      </form>

      <div className="bff-gmenu-list">
        {custom.length === 0 && <div className="bff-gmenu-none">还没有自定义分组</div>}
        {custom.map((g, i) => (
          <div className="bff-gmenu-row" key={g.id}>
            {editing === g.id ? (
              <form
                className="bff-gmenu-rename"
                onSubmit={(e) => {
                  e.preventDefault();
                  const name = editDraft.trim();
                  if (name) onRename(g.id, name);
                  setEditing(null);
                }}
              >
                <input
                  autoFocus
                  value={editDraft}
                  maxLength={MAX_GROUP_NAME}
                  onChange={(e) => setEditDraft(e.target.value)}
                />
                <button type="submit">存</button>
                <button type="button" onClick={() => setEditing(null)}>
                  取消
                </button>
              </form>
            ) : (
              <>
                <span className="bff-gmenu-name" title={g.name}>
                  {g.name}
                </span>
                <button
                  type="button"
                  disabled={i === 0}
                  onClick={() => onReorder(g.id, -1)}
                  title="上移"
                >
                  ↑
                </button>
                <button
                  type="button"
                  disabled={i === custom.length - 1}
                  onClick={() => onReorder(g.id, 1)}
                  title="下移"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(g.id);
                    setEditDraft(g.name);
                  }}
                  title="重命名"
                >
                  ✎
                </button>
                <button type="button" onClick={() => onDelete(g)} title="删除">
                  ✕
                </button>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="bff-gmenu-foot">
        <div className="bff-gmenu-usage">
          存储占用：{kb(usage)} / 约 {Math.round(quotaBytes / 1024 / 1024)} MB
          <button type="button" onClick={onCleanup}>
            清理历史数据
          </button>
        </div>
        <button type="button" className="bff-danger" onClick={onForceOverwrite}>
          按 B站 强制覆盖全部分组
        </button>
      </div>
    </div>
  );
}
