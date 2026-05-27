'use client';

import { useState, useRef, useEffect } from 'react';
import { Globe, ChevronDown } from 'lucide-react';
import { useLocale } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';

const locales = [
  { code: 'en', label: 'English', short: 'EN' },
  { code: 'id', label: 'Indonesia', short: 'ID' },
  { code: 'zh', label: '中文', short: 'ZH' },
] as const;

export default function LocaleSwitcher() {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function switchLocale(next: string) {
    router.replace(pathname, { locale: next });
    setOpen(false);
  }

  const current = locales.find((l) => l.code === locale) ?? locales[0];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-semibold text-gray-700 hover:text-primary hover:bg-primary/5 transition-colors"
        aria-label="Switch language"
      >
        <Globe className="w-4 h-4" />
        {current.short}
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-36 rounded-xl bg-white border border-gray-100 shadow-xl py-1 z-50">
          {locales.map((l) => (
            <button
              key={l.code}
              onClick={() => switchLocale(l.code)}
              className={`w-full text-left px-4 py-2 text-sm flex items-center justify-between transition-colors
                ${l.code === locale
                  ? 'text-primary font-bold bg-primary/5'
                  : 'text-gray-700 hover:bg-gray-50'
                }`}
            >
              {l.label}
              <span className="text-xs text-gray-400">{l.short}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
