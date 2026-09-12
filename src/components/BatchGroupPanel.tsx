import type { Group } from '../lib/localGroups';
import { UNCATEGORIZED_ID, HIDDEN_ID } from '../lib/upIndex';

interface Props {
  groups: Group[];
  selectedCount: number;
  /** 选中的 UP **已经全部在**里面的分组 id —— 这些图标置为"已完成" */
  allContained: Set<string>;
  /** 选中的 UP 是否都还没有任何分组（即都处于未分类） */
  allUncategorized: boolean;
  onAdd: (groupId: string) => void;
  onClearAll: () => void;
}

/**
 * 批量模式下的分组图标面板。
 *
 * 存在的理由：批量时最高频的动作是「加入某个分组」，而原流程要点两次
 * （点「加入分组▾」再选分组）。把分组铺成图标，点一下即完成。
 *
 * 两点设计约定：
 *  1. 同一个图标**行为恒定** —— 只做「加入」，不做智能切换。
 *     否则同一个图标点下去有时加、有时减，最容易误操作。
 *  2. 「未分类」语义不同：它不是真实分组，而是"不属于任何分组"，
 *     所以点它等于**移出全部分组**，图标和提示都单独区分。
 */
export default function BatchGroupPanel({
  groups,
  selectedCount,
  allContained,
  allUncategorized,
  onAdd,
  onClearAll,
}: Props) {
  const ordered = [...groups].sort((a, b) => a.order - b.order);
  const none = selectedCount === 0;

  return (
    <div className="bff-batchpanel">
      <div className="bff-batchpanel-title">
        {none ? (
          <>批量分类：先在左侧勾选 UP 主，再点分组图标即可归类</>
        ) : (
          <>
            批量分类：已选 <strong>{selectedCount}</strong> 个 —— 点分组图标直接加入
          </>
        )}
      </div>

      <div className="bff-batchpanel-list">
        {ordered.map((g) => {
          const isUncat = g.id === UNCATEGORIZED_ID;
          const isHidden = g.id === HIDDEN_ID;
          const contained = isUncat ? allUncategorized : allContained.has(g.id);
          const hint = isUncat
            ? '移出全部分组（→ 未分类）'
            : isHidden
              ? '隐藏他们的视频（**不取关**，且会移出其他分组）'
              : contained
                ? `选中的 UP 已全部在「${g.name}」里`
                : `添加到「${g.name}」`;

          return (
            <button
              key={g.id}
              type="button"
              className={`bff-folder${contained ? ' is-contained' : ''}${isHidden ? ' is-hidden-group' : ''}`}
              disabled={none || contained}
              onClick={() => (isUncat ? onClearAll() : onAdd(g.id))}
              title={hint}
            >
              <span className="bff-folder-icon" aria-hidden>
                {isUncat ? '🗂️' : isHidden ? '🙈' : '📁'}
              </span>
              <span className="bff-folder-name">{g.name}</span>
              {contained && <span className="bff-folder-tick">✓</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
