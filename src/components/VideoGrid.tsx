import type { VideoCard as Card } from '../types';
import VideoCard from './VideoCard';

interface Props {
  cards: Card[];
  readSet: Set<string>;
  lastVisit: number;
  onOpen: (card: Card) => void;
}

export default function VideoGrid({ cards, readSet, lastVisit, onOpen }: Props) {
  if (cards.length === 0) {
    return <div className="bff-empty">没有可显示的视频</div>;
  }
  return (
    <div className="bff-grid">
      {cards.map(c => (
        <VideoCard
          key={c.bvid}
          card={c}
          read={readSet.has(c.bvid)}
          isNew={c.pubdate * 1000 > lastVisit}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}
