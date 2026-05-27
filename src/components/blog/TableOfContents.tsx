'use client';

import { useEffect, useState } from 'react';

export interface TocHeading {
  id: string;
  text: string;
  level: 2 | 3;
}

interface TableOfContentsProps {
  headings: TocHeading[];
  label: string;
}

export function TableOfContents({ headings, label }: TableOfContentsProps) {
  const [activeId, setActiveId] = useState<string>('');

  useEffect(() => {
    if (headings.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) setActiveId(entry.target.id);
        });
      },
      { rootMargin: '-10% 0% -75% 0%', threshold: 0 }
    );

    headings.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [headings]);

  if (headings.length === 0) return null;

  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">{label}</p>
      <nav aria-label="Table of contents">
        <ul className="space-y-0.5">
          {headings.map(({ id, text, level }) => (
            <li key={id}>
              <a
                href={`#${id}`}
                className={[
                  'block text-sm leading-snug py-1.5 border-l-2 transition-colors',
                  level === 3 ? 'pl-5' : 'pl-3',
                  activeId === id
                    ? 'border-primary text-primary font-medium'
                    : 'border-transparent text-gray-500 hover:text-gray-900 hover:border-gray-300',
                ].join(' ')}
              >
                {text}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
