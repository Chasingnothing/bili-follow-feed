import type { VideoCard as Card } from '../types';
import { formatPlay, formatRelativeTime } from '../lib/format';

interface Props {
  card: Card;
  read: boolean;
  isNew: boolean;
  onOpen: (card: Card) => void;
}

export default function VideoCard({ card, read, isNew, onOpen }: Props) {
  return (
    <a
      className={`bff-card${read ? ' bff-card--read' : ''}`}
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
      <div className="bff-meta">
        <img className="bff-face" src={card.upFace} alt="" referrerPolicy="no-referrer" />
        <span className="bff-up">{card.upName}</span>
      </div>
      <div className="bff-sub">
        {formatPlay(card.play)}播放 · {formatRelativeTime(card.pubdate * 1000)}
      </div>
    </a>
  );
}
