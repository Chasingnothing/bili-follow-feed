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

  /*
   * 封面框**统一交给 CSS**（`.bff-cover-wrap` 是固定的 16:10，配 `object-fit: cover`
   * 按容器裁切填满）。视频和图文、横图和竖图都长一样高，网格才齐。
   *
   * 曾经试过按原图宽高比设 `aspect-ratio`（本意是避免图片加载时跳动），
   * 但 750×1000 的竖图会撑出比视频封面高得多的框，整个网格参差不齐。
   * 所以 `coverW`/`coverH` 目前**不参与布局**，只是留着备用。
   */

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
        <div className="bff-cover-wrap">
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
