import type { FeedItem } from '../types';
import { formatPlay, formatRelativeTime } from '../lib/format';
import { upSpaceUrl } from '../lib/links';

interface Props {
  item: FeedItem;
  read: boolean;
  isNew: boolean;
  onOpen: (item: FeedItem) => void;
  /** 打开该 UP 的分组菜单 */
  onPick: (upMid: number, el: HTMLElement) => void;
}

/**
 * 一张内容卡片 —— 视频和图文共用。
 *
 * 卡片必须有**两个并列的链接**：整卡指向原站内容，UP 头像/昵称指向 UP 主页。
 *
 * 不能把 UP 链接套在内容链接里面 —— `<a>` 嵌 `<a>` 是非法 HTML，浏览器会把
 * 内层拆掉，表现为点头像不跳转或跳错地方。所以外层是 `<div>`，两个 `<a>` 平级。
 *
 * 同理，「⋯」按钮也**不能**放进 UP 那个 `<a>` 里：带 href 的 `<a>` 不允许包含
 * 交互内容（button 等），是同一类非法嵌套。
 */
export default function FeedCard({ item, read, isNew, onOpen, onPick }: Props) {
  const isImage = item.kind === 'image';
  const hasCover = item.cover !== '';

  // 已知原始尺寸时按比例预留位置，避免图片加载完成后卡片跳动。
  // 视频封面拿不到尺寸（`archive` 里没有），交给 CSS 的固定比例。
  const coverStyle =
    hasCover && item.coverW > 0 && item.coverH > 0
      ? { aspectRatio: `${item.coverW} / ${item.coverH}` }
      : undefined;

  return (
    <div className={`bff-card${read ? ' bff-card--read' : ''}`}>
      <a
        className="bff-card-main"
        href={item.url}
        target="_blank"
        rel="noreferrer"
        onClick={() => onOpen(item)}
        title={item.title}
      >
        <div className="bff-cover-wrap" style={coverStyle}>
          {hasCover ? (
            /* referrerPolicy 绕开 i0/i1.hdslb.com 的防盗链；图片地址已在映射层提升为 https */
            <img
              className="bff-cover"
              src={item.cover}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          ) : (
            /*
             * 纯文字动态没有配图，但**必须留一块同尺寸的占位** ——
             * 否则卡片高度不齐，标题会跑到图片该在的位置，UP 那一栏也跟着上移。
             */
            <div className="bff-cover bff-cover--blank" aria-hidden="true">
              <span>图文</span>
            </div>
          )}

          {isImage
            ? item.imageCount > 1 && <span className="bff-duration">{item.imageCount} 图</span>
            : item.durationText && <span className="bff-duration">{item.durationText}</span>}

          {isNew && <span className="bff-new">NEW</span>}
        </div>

        <div className="bff-title">{item.title}</div>
      </a>

      <div className="bff-meta">
        <a
          className="bff-card-up"
          href={upSpaceUrl(item.upMid)}
          target="_blank"
          rel="noreferrer"
          title={`${item.upName} 的主页`}
        >
          <img className="bff-face" src={item.upFace} alt="" referrerPolicy="no-referrer" />
          <span className="bff-up">{item.upName}</span>
        </a>

        <button
          type="button"
          className="bff-up-more"
          onClick={(e) => onPick(item.upMid, e.currentTarget)}
          title={`调整「${item.upName}」的分组`}
        >
          ⋯
        </button>
      </div>

      <div className="bff-sub">
        {/* 图文没有播放量，显示点赞数 */}
        {isImage ? `${formatPlay(item.like)}点赞` : `${formatPlay(item.play)}播放`} ·{' '}
        {formatRelativeTime(item.pubdate * 1000)}
      </div>
    </div>
  );
}
