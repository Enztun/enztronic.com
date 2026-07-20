import { readFile } from 'node:fs/promises';
import { createClient } from '@sanity/client';

process.loadEnvFile?.('.env.local');

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID;
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET;
const token = process.env.SANITY_API_TOKEN;

if (!projectId || !dataset || !token) {
  throw new Error('Sanity project, dataset, and server token must be configured.');
}

const client = createClient({
  projectId,
  dataset,
  token,
  apiVersion: '2024-01-01',
  useCdn: false,
});

const pages = [
  { id: 'CsoW6ixiXlIxAJobsgGpc7', locale: 'en', slug: 'home' },
  { id: '1QfR2tqi3vNCPCHAnevIRH', locale: 'id', slug: 'home' },
  { id: '1QfR2tqi3vNCPCHAnevIw9', locale: 'zh', slug: 'home' },
  { id: '1QfR2tqi3vNCPCHAnevJbJ', locale: 'en', slug: 'about' },
  { id: 'CsoW6ixiXlIxAJobsgGsAp', locale: 'id', slug: 'about' },
  { id: 'CsoW6ixiXlIxAJobsgGsgZ', locale: 'zh', slug: 'about' },
  { id: 'CsoW6ixiXlIxAJobsgGt1j', locale: 'en', slug: 'services' },
  { id: '7jQZqEqsB2Z3J0oc28jmoq', locale: 'id', slug: 'services' },
  { id: 'CsoW6ixiXlIxAJobsgGuop', locale: 'zh', slug: 'services' },
  { id: '1QfR2tqi3vNCPCHAnevMfg', locale: 'en', slug: 'portfolio' },
  { id: '1QfR2tqi3vNCPCHAnevNKq', locale: 'id', slug: 'portfolio' },
  { id: '7jQZqEqsB2Z3J0oc28jno4', locale: 'zh', slug: 'portfolio' },
];

const expectedModuleTypes = {
  home: ['module.hero', 'module.stats', 'module.caseStudy'],
  about: ['module.aboutIntro'],
  services: ['module.servicesGrid'],
  portfolio: ['module.portfolioGrid'],
};

const headlineParts = {
  en: ['We build the digital systems', 'your business runs on.'],
  id: ['Kami membangun sistem digital', 'yang menjalankan bisnis Anda.'],
  zh: ['我们构建', '企业日常运营所依赖的数字系统。'],
};

const messageFiles = Object.fromEntries(
  await Promise.all(
    ['en', 'id', 'zh'].map(async (locale) => [
      locale,
      JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8')),
    ])
  )
);

const currentPages = await client.fetch(
  `*[_id in $ids] {
    _id,
    _rev,
    language,
    "slug": slug.current,
    "moduleTypes": modules[]._type
  }`,
  { ids: pages.map((page) => page.id) }
);
const currentById = new Map(currentPages.map((page) => [page._id, page]));

function assertPageShape(page, current) {
  if (!current) throw new Error(`Missing Sanity page ${page.id}`);
  if (current.language !== page.locale || current.slug !== page.slug) {
    throw new Error(`Sanity page identity changed for ${page.id}`);
  }
  const expected = expectedModuleTypes[page.slug];
  if (JSON.stringify(current.moduleTypes) !== JSON.stringify(expected)) {
    throw new Error(`Sanity module order changed for ${page.locale}/${page.slug}`);
  }
}

function setIndexedFields(target, prefix, items, fields) {
  items.forEach((item, index) => {
    fields.forEach((field) => {
      target[`${prefix}[${index}].${field}`] = item[field];
    });
  });
}

function buildPatch(page) {
  const messages = messageFiles[page.locale];
  const set = {
    seo: {
      title: messages.meta[page.slug].title,
      description: messages.meta[page.slug].description,
    },
  };

  if (page.slug === 'home') {
    const home = messages.home;
    const [headline, headlineHighlight] = headlineParts[page.locale];
    Object.assign(set, {
      'modules[0].badge': home.badge,
      'modules[0].headline': headline,
      'modules[0].headlineHighlight': headlineHighlight,
      'modules[0].description': home.description,
      'modules[0].ctaPrimaryText': home.ctaPrimary,
      'modules[0].ctaSecondaryText': home.ctaSecondary,
      'modules[0].revenueGrowth': home.hero.revenueGrowth,
      'modules[0].revenueLabel': home.hero.revenueLabel,
      'modules[2].label': home.caseStudy.label,
      'modules[2].title': home.caseStudy.title,
      'modules[2].description': home.caseStudy.description,
      'modules[2].features': [
        home.caseStudy.feature1,
        home.caseStudy.feature2,
        home.caseStudy.feature3,
      ],
      'modules[2].ctaText': home.caseStudy.cta,
    });
    const stats = ['years', 'projects', 'industries', 'retention'].map((key) => ({
      value: home.stats[key],
      label: home.stats[`${key}Label`],
    }));
    setIndexedFields(set, 'modules[1].items', stats, ['value', 'label']);
  }

  if (page.slug === 'about') {
    const about = messages.about;
    Object.assign(set, {
      'modules[0].heading': about.heading,
      'modules[0].paragraphs': [about.p1, about.p2],
    });
    const stats = ['years', 'projects', 'industries', 'retention'].map((key) => ({
      value: about.stats[key],
      label: about.stats[`${key}Label`],
    }));
    setIndexedFields(set, 'modules[0].stats', stats, ['value', 'label']);
  }

  if (page.slug === 'services') {
    Object.assign(set, {
      'modules[0].heading': messages.services.heading,
      'modules[0].subheading': messages.services.subheading,
    });
    setIndexedFields(set, 'modules[0].services', messages.services.items, [
      'title',
      'description',
      'features',
    ]);
  }

  if (page.slug === 'portfolio') {
    Object.assign(set, {
      'modules[0].heading': messages.portfolio.heading,
      'modules[0].description': messages.portfolio.description,
      'modules[0].visitSiteLabel': messages.portfolio.visitSite,
    });
    setIndexedFields(set, 'modules[0].projects', messages.portfolio.projects, [
      'title',
      'category',
      'description',
    ]);
  }

  return set;
}

for (const page of pages) assertPageShape(page, currentById.get(page.id));

if (!process.argv.includes('--apply')) {
  console.log(`Dry run: ${pages.length} verified Sanity pages are ready to patch.`);
  console.log('Run with --apply to commit the rebrand and SEO fields atomically.');
  process.exit(0);
}

let transaction = client.transaction();
for (const page of pages) {
  const current = currentById.get(page.id);
  transaction = transaction.patch(page.id, (patch) =>
    patch.ifRevisionId(current._rev).set(buildPatch(page))
  );
}

await transaction.commit({ tag: 'enztronic.rebrand-seo' });
console.log(`Updated ${pages.length} Sanity pages in one revision-checked transaction.`);
