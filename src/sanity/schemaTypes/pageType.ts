import { defineField, defineType } from 'sanity';
import { DocumentTextIcon } from '@sanity/icons';

export const pageType = defineType({
  name: 'page',
  title: 'Pages',
  type: 'document',
  icon: DocumentTextIcon,
  fields: [
    defineField({
      name: 'title',
      title: 'Title',
      type: 'string',
      validation: (r) => r.required(),
    }),
    defineField({
      name: 'slug',
      title: 'Slug',
      type: 'slug',
      description: 'Use: home, about, services, portfolio',
      options: { source: 'title' },
      validation: (r) => r.required(),
    }),
    defineField({
      name: 'language',
      title: 'Language',
      type: 'string',
      initialValue: 'en',
      options: {
        list: [
          { title: 'English', value: 'en' },
          { title: 'Indonesian', value: 'id' },
          { title: 'Chinese (Simplified)', value: 'zh' },
        ],
        layout: 'radio',
      },
      validation: (r) => r.required(),
    }),
    defineField({
      name: 'modules',
      title: 'Page Modules',
      description: 'Add, remove and reorder sections of this page.',
      type: 'array',
      of: [
        { type: 'module.hero' },
        { type: 'module.stats' },
        { type: 'module.caseStudy' },
        { type: 'module.servicesGrid' },
        { type: 'module.portfolioGrid' },
        { type: 'module.aboutIntro' },
      ],
    }),
    defineField({
      name: 'seo',
      title: 'SEO',
      type: 'object',
      fields: [
        defineField({ name: 'title', title: 'Meta Title', type: 'string' }),
        defineField({ name: 'description', title: 'Meta Description', type: 'text', rows: 2 }),
      ],
    }),
  ],
  preview: {
    select: { title: 'title', language: 'language', slug: 'slug.current' },
    prepare({ title, language, slug }) {
      return {
        title: title ?? slug,
        subtitle: `${language?.toUpperCase() ?? 'EN'} · /${slug}`,
      };
    },
  },
});
