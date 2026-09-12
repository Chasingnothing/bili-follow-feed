import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadGroups,
  loadMembership,
  seedFromBilibili,
  mergeImport,
  createGroup,
  renameGroup,
  deleteGroup,
  reorderGroup,
  applyBatch,
  undoLastBatch,
  detectDivergence,
  resetFromBilibili,
  pruneStale,
  groupsOf,
  isSeeded,
  MAX_GROUP_NAME,
  type Group,
} from './localGroups';
import { SPECIAL_ID, UNCATEGORIZED_ID } from './upIndex';
import { rawTags } from '../data/__fixtures__/relation';
import type { BiliTag, TrimmedFollowedUp } from '../types';

function up(mid: number, tag: number[] | null, special: 0 | 1 = 0): TrimmedFollowedUp {
  return { mid, uname: `up${mid}`, face: 'https://x', tag, special };
}

beforeEach(() => localStorage.clear());

// ── 首次导入 ────────────────────────────────────────────────────────────

describe('seedFromBilibili', () => {
  const followings = [
    up(1, null), // 只在默认分组 → 未分类
    up(2, [207542]), // 电影分组
    up(3, [-10, 194110], 1), // 特别关注 + 我的同学
  ];

  it('把 -10 映射为 special、0 不建组、其他建同名分组', () => {
    seedFromBilibili(rawTags, followings);
    const ids = loadGroups().map((g) => g.id);
    expect(ids).toContain(SPECIAL_ID);
    expect(ids).toContain(UNCATEGORIZED_ID);
    expect(ids).toContain('bili-194110');
    expect(ids).toContain('bili-207542');
    // B站 的「默认分组」不建同名本地分组
    expect(ids).not.toContain('bili-0');
    expect(loadGroups().find((g) => g.id === 'bili-194110')?.name).toBe('我的同学');
  });

  it('未分类不落盘，只在 membership 中缺席', () => {
    seedFromBilibili(rawTags, followings);
    const m = loadMembership();
    expect(m['1']).toBeUndefined();
    expect(m['2']).toEqual(['bili-207542']);
  });

  it('多归属同时写入多个分组', () => {
    seedFromBilibili(rawTags, followings);
    expect(loadMembership()['3']).toEqual([SPECIAL_ID, 'bili-194110']);
  });

  it('自定义分组全部标记来源为 bilibili', () => {
    seedFromBilibili(rawTags, followings);
    expect(loadGroups().find((g) => g.id === 'bili-207542')?.source).toBe('bilibili');
  });

  it('补上 followings 引用到但 tags 未列出的 tagid', () => {
    seedFromBilibili(rawTags, [up(9, [999999])]);
    expect(loadGroups().map((g) => g.id)).toContain('bili-999999');
  });
});

describe('分组顺序', () => {
  it('special 最前、uncategorized 最后（不沿用 B站 API 顺序）', () => {
    seedFromBilibili(rawTags, [up(1, null)]);
    const sorted = loadGroups().sort((a, b) => a.order - b.order);
    expect(sorted[0].id).toBe(SPECIAL_ID);
    expect(sorted[sorted.length - 1].id).toBe(UNCATEGORIZED_ID);
  });

  it('即使 B站 把默认分组排在第 2，未分类仍在最后', () => {
    // rawTags 的真实顺序是 -10, 0, 194110, 207542
    expect(rawTags[1].tagid).toBe(0);
    seedFromBilibili(rawTags, [up(1, null)]);
    const sorted = loadGroups().sort((a, b) => a.order - b.order);
    expect(sorted.map((g) => g.id)).toEqual([
      SPECIAL_ID,
      'bili-194110',
      'bili-207542',
      UNCATEGORIZED_ID,
    ]);
  });
});

// ── 合并导入 ────────────────────────────────────────────────────────────

describe('mergeImport', () => {
  it('只给本地未分类的 UP 按 B站 归类', () => {
    seedFromBilibili(rawTags, [up(1, null), up(2, [207542])]);
    // B站 侧把 up1 放进了电影分组
    const res = mergeImport(rawTags, [up(1, [207542]), up(2, [207542])]);
    expect(res.added).toBe(1);
    expect(loadMembership()['1']).toEqual(['bili-207542']);
  });

  it('不覆盖已有的本地分类', () => {
    seedFromBilibili(rawTags, [up(2, [207542])]);
    // 本地把 up2 改成我的同学
    applyBatch([2], { type: 'only', groupId: 'bili-194110' });
    // B站 侧仍是电影分组 —— 合并导入不该动它
    mergeImport(rawTags, [up(2, [207542])]);
    expect(loadMembership()['2']).toEqual(['bili-194110']);
  });

  it('补上 B站 新增的分组', () => {
    seedFromBilibili(rawTags, [up(1, null)]);
    const newTags: BiliTag[] = [...rawTags, { tagid: 888888, name: '新分组', count: 1 }];
    mergeImport(newTags, [up(1, [888888])]);
    expect(loadGroups().map((g) => g.id)).toContain('bili-888888');
  });

  it('已分类的 UP 不更新快照，避免静默清掉未处理的分歧', () => {
    seedFromBilibili(rawTags, [up(2, [207542])]);
    applyBatch([2], { type: 'only', groupId: 'bili-194110' });
    // B站 侧变化了
    mergeImport(rawTags, [up(2, [999])]);
    // 分歧仍应被检测到
    expect(detectDivergence([up(2, [999])]).has(2)).toBe(true);
  });
});

// ── 分组 CRUD ───────────────────────────────────────────────────────────

describe('分组 CRUD', () => {
  it('新建分组', () => {
    seedFromBilibili(rawTags, []);
    const g = createGroup('新分组');
    expect(g?.id).toBe('local-1');
    expect(loadGroups().some((x) => x.id === 'local-1')).toBe(true);
  });

  it('拒绝空名与超长名', () => {
    seedFromBilibili(rawTags, []);
    expect(createGroup('   ')).toBeNull();
    expect(createGroup('x'.repeat(MAX_GROUP_NAME + 1))).toBeNull();
    expect(createGroup('x'.repeat(MAX_GROUP_NAME))).not.toBeNull();
  });

  it('拒绝重名', () => {
    seedFromBilibili(rawTags, []);
    createGroup('重复');
    expect(createGroup('重复')).toBeNull();
  });

  it('重命名', () => {
    seedFromBilibili(rawTags, []);
    const g = createGroup('旧名')!;
    expect(renameGroup(g.id, '新名')).toBe(true);
    expect(loadGroups().find((x) => x.id === g.id)?.name).toBe('新名');
  });

  it('系统分组不可重命名、不可删除', () => {
    seedFromBilibili(rawTags, []);
    expect(renameGroup(SPECIAL_ID, '改名')).toBe(false);
    expect(renameGroup(UNCATEGORIZED_ID, '改名')).toBe(false);
    expect(deleteGroup(SPECIAL_ID)).toBe(false);
    expect(deleteGroup(UNCATEGORIZED_ID)).toBe(false);
  });

  it('删除分组后组内 UP 回落未分类，且脏引用被清理', () => {
    seedFromBilibili(rawTags, [up(1, [207542])]);
    expect(loadMembership()['1']).toEqual(['bili-207542']);
    expect(deleteGroup('bili-207542')).toBe(true);
    expect(loadMembership()['1']).toBeUndefined();
  });

  it('删除分组只移除该分组，保留其他归属', () => {
    seedFromBilibili(rawTags, [up(3, [-10, 194110], 1)]);
    deleteGroup('bili-194110');
    expect(loadMembership()['3']).toEqual([SPECIAL_ID]);
  });

  it('排序：上移下移只作用于自定义分组', () => {
    seedFromBilibili(rawTags, []);
    const before = loadGroups()
      .filter((g) => g.kind === 'normal')
      .sort((a, b) => a.order - b.order)
      .map((g) => g.id);
    expect(reorderGroup(before[1], -1)).toBe(true);
    const after = loadGroups()
      .filter((g) => g.kind === 'normal')
      .sort((a, b) => a.order - b.order)
      .map((g) => g.id);
    expect(after[0]).toBe(before[1]);
  });

  it('排序到边界时返回 false', () => {
    seedFromBilibili(rawTags, []);
    const first = loadGroups()
      .filter((g) => g.kind === 'normal')
      .sort((a, b) => a.order - b.order)[0];
    expect(reorderGroup(first.id, -1)).toBe(false);
  });
});

// ── 批量分类 ────────────────────────────────────────────────────────────

describe('applyBatch', () => {
  beforeEach(() => {
    seedFromBilibili(rawTags, [up(1, [207542]), up(2, [207542]), up(3, null)]);
  });

  it('add 追加分组并保留其他归属', () => {
    applyBatch([1], { type: 'add', groupId: SPECIAL_ID });
    expect(loadMembership()['1']).toEqual(['bili-207542', SPECIAL_ID]);
  });

  it('add 已存在的分组不重复', () => {
    applyBatch([1], { type: 'add', groupId: 'bili-207542' });
    expect(loadMembership()['1']).toEqual(['bili-207542']);
  });

  it('remove 移除后为空则回落未分类（不落盘）', () => {
    applyBatch([1], { type: 'remove', groupId: 'bili-207542' });
    expect(loadMembership()['1']).toBeUndefined();
  });

  it('remove 只移除指定分组', () => {
    applyBatch([1], { type: 'only', groupId: 'bili-207542' });
    applyBatch([1], { type: 'add', groupId: 'bili-194110' });
    applyBatch([1], { type: 'remove', groupId: 'bili-207542' });
    expect(loadMembership()['1']).toEqual(['bili-194110']);
  });

  it('only 替换为单一分组', () => {
    applyBatch([1, 2], { type: 'only', groupId: 'bili-194110' });
    expect(loadMembership()['1']).toEqual(['bili-194110']);
    expect(loadMembership()['2']).toEqual(['bili-194110']);
  });

  it('clear 清空 → 未分类', () => {
    applyBatch([1], { type: 'clear' });
    expect(loadMembership()['1']).toBeUndefined();
  });

  it('一次作用于多个 UP', () => {
    applyBatch([1, 2, 3], { type: 'only', groupId: SPECIAL_ID });
    expect(groupsOf(loadMembership(), 1)).toEqual([SPECIAL_ID]);
    expect(groupsOf(loadMembership(), 2)).toEqual([SPECIAL_ID]);
    expect(groupsOf(loadMembership(), 3)).toEqual([SPECIAL_ID]);
  });
});

describe('undoLastBatch', () => {
  beforeEach(() => {
    seedFromBilibili(rawTags, [up(1, [207542]), up(2, null)]);
  });

  it('完整还原上一次批量操作', () => {
    const before = JSON.stringify(loadMembership());
    applyBatch([1, 2], { type: 'only', groupId: SPECIAL_ID });
    expect(JSON.stringify(loadMembership())).not.toBe(before);
    expect(undoLastBatch()).toBe(true);
    expect(JSON.stringify(loadMembership())).toBe(before);
  });

  it('连续两次批量只有最后一次可撤销', () => {
    applyBatch([1], { type: 'only', groupId: SPECIAL_ID });
    applyBatch([2], { type: 'only', groupId: SPECIAL_ID });
    undoLastBatch();
    expect(loadMembership()['2']).toBeUndefined(); // 回到第二次操作前
    expect(loadMembership()['1']).toEqual([SPECIAL_ID]); // 第一次的结果还在
  });
});

// ── 分歧检测与单项重置 ──────────────────────────────────────────────────

describe('detectDivergence', () => {
  it('B站 侧变化时被检测到', () => {
    seedFromBilibili(rawTags, [up(1, [207542])]);
    expect(detectDivergence([up(1, [207542])]).size).toBe(0);
    expect(detectDivergence([up(1, [194110])]).has(1)).toBe(true);
  });

  it('**本地手动改动不会被误报**', () => {
    seedFromBilibili(rawTags, [up(1, [207542])]);
    applyBatch([1], { type: 'only', groupId: 'bili-194110' });
    // B站 侧没变，快照也没变 → 不该报分歧
    expect(detectDivergence([up(1, [207542])]).size).toBe(0);
  });

  it('从未导入过的 UP 不算分歧', () => {
    seedFromBilibili(rawTags, [up(1, [207542])]);
    expect(detectDivergence([up(1, [207542]), up(77, [999])]).has(77)).toBe(false);
  });

  it('null 与空数组视为相同', () => {
    seedFromBilibili(rawTags, [up(1, null)]);
    expect(detectDivergence([up(1, [])]).has(1)).toBe(false);
  });

  it('tag 顺序不同不算变化', () => {
    seedFromBilibili(rawTags, [up(1, [-10, 194110], 1)]);
    expect(detectDivergence([up(1, [194110, -10], 1)]).has(1)).toBe(false);
  });
});

describe('resetFromBilibili', () => {
  it('用 B站 当前分组覆盖本地', () => {
    seedFromBilibili(rawTags, [up(1, [207542])]);
    applyBatch([1], { type: 'only', groupId: 'bili-194110' });
    expect(resetFromBilibili(1, [up(1, [207542])])).toBe(true);
    expect(loadMembership()['1']).toEqual(['bili-207542']);
  });

  it('重置后分歧消失', () => {
    seedFromBilibili(rawTags, [up(1, [207542])]);
    applyBatch([1], { type: 'only', groupId: 'bili-194110' });
    expect(detectDivergence([up(1, [194110])]).has(1)).toBe(true);
    resetFromBilibili(1, [up(1, [194110])]);
    expect(detectDivergence([up(1, [194110])]).has(1)).toBe(false);
  });

  it('find 不到该 UP 时返回 false', () => {
    seedFromBilibili(rawTags, [up(1, [207542])]);
    expect(resetFromBilibili(999, [up(1, [207542])])).toBe(false);
  });
});

// ── 清理 ────────────────────────────────────────────────────────────────

describe('pruneStale', () => {
  it('清掉不在当前关注列表里的记录', () => {
    seedFromBilibili(rawTags, [up(1, [207542]), up(2, [207542])]);
    pruneStale([up(1, [207542])]); // 只剩 up1
    expect(loadMembership()['2']).toBeUndefined();
    expect(loadMembership()['1']).toEqual(['bili-207542']);
  });

  it('返回释放的字符数（>0）', () => {
    seedFromBilibili(rawTags, [up(1, [207542]), up(2, [207542])]);
    expect(pruneStale([up(1, [207542])])).toBeGreaterThan(0);
  });

  it('没有可清理项时返回 0', () => {
    seedFromBilibili(rawTags, [up(1, [207542])]);
    expect(pruneStale([up(1, [207542])])).toBe(0);
  });
});

// ── 同名分组不应被重复创建（真实 bug 回归）─────────────────────────────

describe('补充导入时的同名分组复用', () => {
  const ENTERTAINMENT: BiliTag = { tagid: 386068999, name: '娱乐', count: 2 };

  it('本地已有同名分组时复用，不新建（修前会变成两个「娱乐」）', () => {
    seedFromBilibili(rawTags, [up(1, null)]);
    const local = createGroup('娱乐')!;

    mergeImport([...rawTags, ENTERTAINMENT], [up(1, null), up(2, [386068999])]);

    const same = loadGroups().filter((g) => g.name === '娱乐');
    expect(same).toHaveLength(1);
    expect(same[0].id).toBe(local.id);
    expect(same[0].biliTagId).toBe(386068999);
  });

  it('被复用的分组确实拿到了 B站 侧的 UP（不能掉进未分类）', () => {
    seedFromBilibili(rawTags, [up(1, null)]);
    const local = createGroup('娱乐')!;
    mergeImport([ENTERTAINMENT], [up(1, [386068999])]);
    expect(loadMembership()['1']).toEqual([local.id]);
  });

  it('membership 不会指向不存在的分组 id', () => {
    seedFromBilibili(rawTags, [up(1, null)]);
    createGroup('娱乐');
    mergeImport([ENTERTAINMENT], [up(1, [386068999])]);
    const ids = new Set(loadGroups().map((g) => g.id));
    for (const gids of Object.values(loadMembership())) {
      for (const gid of gids) expect(ids.has(gid)).toBe(true);
    }
  });

  it('返回并入了哪些分组名，供界面提示', () => {
    seedFromBilibili(rawTags, [up(1, null)]);
    createGroup('娱乐');
    expect(mergeImport([ENTERTAINMENT], [up(1, null)]).adopted).toContain('娱乐');
  });

  it('重复导入不会因为已记录 tagid 而再建一次', () => {
    seedFromBilibili(rawTags, [up(1, null)]);
    createGroup('娱乐');
    mergeImport([ENTERTAINMENT], [up(1, null)]);
    mergeImport([ENTERTAINMENT], [up(1, null)]);
    expect(loadGroups().filter((g) => g.name === '娱乐')).toHaveLength(1);
  });

  it('没有同名分组时仍然新建，并记下 biliTagId', () => {
    seedFromBilibili(rawTags, [up(1, null)]);
    mergeImport([ENTERTAINMENT], [up(1, null)]);
    const created = loadGroups().find((g) => g.name === '娱乐');
    expect(created?.id).toBe('bili-386068999');
    expect(created?.biliTagId).toBe(386068999);
  });

  it('系统分组不会被同名复用逻辑误伤', () => {
    seedFromBilibili(rawTags, [up(1, null)]);
    expect(loadGroups().filter((g) => g.name === '特别关注')).toHaveLength(1);
    expect(loadGroups().find((g) => g.id === SPECIAL_ID)?.biliTagId).toBeUndefined();
  });

  it('seedFromBilibili 建立的分组带 biliTagId', () => {
    seedFromBilibili(rawTags, [up(1, [207542])]);
    expect(loadGroups().find((g) => g.id === 'bili-207542')?.biliTagId).toBe(207542);
  });

  it('followings 引用了 tags 未列出的 tagid 时补建分组，不留脏引用', () => {
    seedFromBilibili(rawTags, [up(1, null)]);
    mergeImport(rawTags, [up(1, [777777])]);
    const ids = new Set(loadGroups().map((g) => g.id));
    for (const gid of loadMembership()['1'] ?? []) expect(ids.has(gid)).toBe(true);
  });
});

// ── 读取容错 ────────────────────────────────────────────────────────────

describe('读取容错', () => {
  it('从未初始化时返回系统分组默认值', () => {
    const groups: Group[] = loadGroups();
    expect(groups.map((g) => g.id).sort()).toEqual([SPECIAL_ID, UNCATEGORIZED_ID].sort());
  });

  it('membership 损坏时返回空对象', () => {
    localStorage.setItem('bff:membership', '{not json');
    expect(loadMembership()).toEqual({});
  });

  it('groups 损坏时回落系统分组', () => {
    localStorage.setItem('bff:groups', '{"a":1}');
    expect(loadGroups().map((g) => g.id)).toContain(SPECIAL_ID);
  });

  it('isSeeded 初始为 false，且不能用 loadGroups().length 判断', () => {
    expect(isSeeded()).toBe(false);
    // loadGroups 在从未初始化时会回落出系统分组，所以它永远不为空
    expect(loadGroups().length).toBeGreaterThan(0);
  });

  it('首次导入后 isSeeded 为 true', () => {
    seedFromBilibili(rawTags, [up(1, null)]);
    expect(isSeeded()).toBe(true);
  });
});
