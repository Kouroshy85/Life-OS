import { BookOpen, CloudRain, Coffee, Headphones, Leaf, Moon, Music, Sparkles, Waves } from "lucide-react";

const ICONS = { music: Music, headphones: Headphones, moon: Moon, coffee: Coffee, book: BookOpen, leaf: Leaf, rain: CloudRain, waves: Waves, sparkles: Sparkles };

export const PLAYLIST_ICONS = Object.keys(ICONS) as (keyof typeof ICONS)[];

export function PlaylistIcon({ name, size = 18 }: { name: string; size?: number }) {
  const Icon = ICONS[name as keyof typeof ICONS] ?? Music;
  return <Icon size={size} strokeWidth={1.8} />;
}
