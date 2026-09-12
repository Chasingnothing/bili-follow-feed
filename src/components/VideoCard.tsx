import type { VideoCard as Card } from '../types';
import { formatPlay, formatRelativeTime } from '../lib/format';
import { upSpaceUrl } from '../lib/links';

interface Props {
  card: Card;
  read: boolean;
  isNew: boolean;
  onOpen: (card: Card) => void;
}

/**
 * 卡片必须有**两个并列的链接**：整卡指向视频，UP 头像/昵称指向 UP 主页。
 *
 * 不能把 UP 链接套在视频链接里面 —— `<a>` 嵌 `<a>` 是非法 HTML，浏览器会把
 * 内层拆掉，表现为点头像不跳转或跳错地方。所以外层是 `<div>`，两个 `<a>` 平级。
 */
export default function VideoCard({ card, read, isNew, onOpen }: Props) {
  return (
    <div className={`bff-card${read ? ' bff-card--read' : ''}`}>
      <a
        className="bff-card-main"
        href={card.url}
        target="_blank"
        rel="noreferrer"
        onClick={() => onOpen(card)}
        title={card.title}
      >
        <div className="bff-cover-wrap">
          {/* referrerPolicy 绕开 i0/i1.hdslb.com 的防盗链；封面已在映射层提升为 https */}
          <img
            className="bff-cover"
            src={card.cover}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
          />
          {card.durationText && <span className="bff-duration">{card.durationText}</span>}
          {isNew && <span className="bff-new">NEW</span>}
        </div>
        <div className="bff-title">{card.title}</div>
      </a>

      <div className="bff-meta">
        <a
          className="bff-card-up"
          href={upSpaceUrl(card.upMid)}
          target="_blank"
          rel="noreferrer"
          title={`${card.upName} 的主页`}
        >
          <img className="bff-face" src={card.upFace} alt="" referrerPolicy="no-referrer" />
          <span className="bff-up">{card.upName}</span>
        </a>
      </div>

      <div className="bff-sub">
        {formatPlay(card.play)}播放 · {formatRelativeTime(card.pubdate * 1000)}
      </div>
    </div>
  );
}
