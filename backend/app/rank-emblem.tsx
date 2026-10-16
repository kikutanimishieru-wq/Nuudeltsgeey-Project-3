import RankBanner from './rank-banner';

export default function RankEmblem({ tier, size = 58 }: { tier: number; size?: number }) {
  return <RankBanner tier={tier} size={size} />;
}
