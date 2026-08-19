import { Code, Megaphone, Target, Palette, TrendingUp, Users, type LucideIcon } from 'lucide-react';

/**
 * Service icons, resolvable two ways because the two content sources name them
 * differently: Sanity stores an icon name per service, while the locale files
 * carry an ordered list and rely on position.
 */
export const ICONS_BY_NAME: Record<string, LucideIcon> = {
  Code,
  Megaphone,
  Target,
  Palette,
  TrendingUp,
  Users,
};

const ICON_ORDER: LucideIcon[] = [Code, Megaphone, Target, Palette, TrendingUp, Users];

export function serviceIcon(nameOrIndex: string | number | undefined): LucideIcon {
  if (typeof nameOrIndex === 'string') return ICONS_BY_NAME[nameOrIndex] ?? Code;
  if (typeof nameOrIndex === 'number') return ICON_ORDER[nameOrIndex] ?? Code;
  return Code;
}
