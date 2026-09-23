'use client';

import { useState } from 'react';
import { Link2, Check } from 'lucide-react';
import { useTranslations } from 'next-intl';

const FacebookSVG = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4" aria-hidden="true">
    <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
  </svg>
);

const LinkedInSVG = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4" aria-hidden="true">
    <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
    <rect x="2" y="9" width="4" height="12" />
    <circle cx="4" cy="4" r="2" />
  </svg>
);

const XSVG = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4" aria-hidden="true">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

interface ShareButtonsProps {
  url: string;
  title: string;
  label: string;
}

export function ShareButtons({ url, title, label }: ShareButtonsProps) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const t = useTranslations('blogUx');

  const encoded = encodeURIComponent(url);
  const encodedTitle = encodeURIComponent(title);

  const socials = [
    {
      Icon: FacebookSVG,
      name: 'Facebook',
      href: `https://www.facebook.com/sharer/sharer.php?u=${encoded}`,
    },
    {
      Icon: LinkedInSVG,
      name: 'LinkedIn',
      href: `https://www.linkedin.com/sharing/share-offsite/?url=${encoded}`,
    },
    {
      Icon: XSVG,
      name: 'Twitter / X',
      href: `https://twitter.com/intent/tweet?url=${encoded}&text=${encodedTitle}`,
    },
  ];

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  }

  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">{label}</p>
      <div className="flex gap-2">
        {socials.map(({ Icon, name, href }) => (
          <a
            key={name}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t('shareOn', { name })}
            title={t('shareOn', { name })}
            className="w-11 h-11 rounded-full border border-gray-200 flex items-center justify-center text-gray-500 hover:border-primary hover:text-primary transition-colors"
          >
            <Icon />
          </a>
        ))}
        <button
          type="button"
          onClick={copyLink}
          aria-label={copyState === 'copied' ? t('copied') : t('copyLink')}
          title={t('copyLink')}
          className="w-11 h-11 rounded-full border border-gray-200 flex items-center justify-center text-gray-500 hover:border-primary hover:text-primary transition-colors"
        >
          {copyState === 'copied' ? (
            <Check aria-hidden="true" className="w-4 h-4 text-brand" />
          ) : (
            <Link2 aria-hidden="true" className="w-4 h-4" />
          )}
        </button>
      </div>
      <p role="status" className="mt-2 text-sm text-on-surface-variant">
        {copyState === 'copied' ? t('copied') : copyState === 'failed' ? t('copyFailed') : ''}
      </p>
      {copyState === 'failed' && (
        <label className="mt-2 block text-sm text-on-surface-variant">
          {t('manualCopy')}
          <input readOnly value={url} onFocus={(event) => event.currentTarget.select()}
            className="mt-2 w-full rounded-lg border border-line bg-surface px-3 py-2 text-base" />
        </label>
      )}
    </div>
  );
}
