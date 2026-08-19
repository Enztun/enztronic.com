import type { LucideIcon } from 'lucide-react';

/**
 * Normalised props for the page sections.
 *
 * Every section on this site has two content sources -- a Sanity module and a
 * locale-file fallback -- and both used to carry their own copy of the markup.
 * They drifted: the stats band was `py-20` in one and `py-16` in the other, and
 * the portfolio rows had diverged further than that. The sections below own the
 * markup; the module and the page each only map their own data into these
 * shapes.
 */
export type Stat = { value?: string; label?: string };

export type Service = {
  title?: string;
  description?: string;
  features?: string[];
  icon?: LucideIcon;
};

export type Cta = { text?: string; href?: string };
