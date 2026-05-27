import { defineField, defineType } from 'sanity';

export const moduleHeroType = defineType({
  name: 'module.hero',
  title: 'Hero Section',
  type: 'object',
  fields: [
    defineField({ name: 'badge', title: 'Badge Text', type: 'string' }),
    defineField({ name: 'headline', title: 'Headline', type: 'string' }),
    defineField({ name: 'headlineHighlight', title: 'Headline Highlight (last word)', type: 'string' }),
    defineField({ name: 'description', title: 'Description', type: 'text', rows: 3 }),
    defineField({ name: 'ctaPrimaryText', title: 'Primary CTA Text', type: 'string' }),
    defineField({ name: 'ctaPrimaryHref', title: 'Primary CTA Link', type: 'string' }),
    defineField({ name: 'ctaSecondaryText', title: 'Secondary CTA Text', type: 'string' }),
    defineField({ name: 'ctaSecondaryHref', title: 'Secondary CTA Link', type: 'string' }),
    defineField({ name: 'revenueGrowth', title: 'Revenue Growth Stat', type: 'string' }),
    defineField({ name: 'revenueLabel', title: 'Revenue Growth Label', type: 'string' }),
  ],
  preview: {
    select: { title: 'headline' },
    prepare: ({ title }) => ({ title: 'Hero Section', subtitle: title }),
  },
});
