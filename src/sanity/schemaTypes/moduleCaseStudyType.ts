import { defineField, defineType } from 'sanity';

export const moduleCaseStudyType = defineType({
  name: 'module.caseStudy',
  title: 'Case Study Feature',
  type: 'object',
  fields: [
    defineField({ name: 'label', title: 'Label', type: 'string' }),
    defineField({ name: 'title', title: 'Title', type: 'string' }),
    defineField({ name: 'description', title: 'Description', type: 'text', rows: 3 }),
    defineField({
      name: 'features',
      title: 'Features',
      type: 'array',
      of: [{ type: 'string' }],
    }),
    defineField({ name: 'ctaText', title: 'CTA Text', type: 'string' }),
    defineField({ name: 'ctaHref', title: 'CTA Link', type: 'url' }),
  ],
  preview: {
    select: { title: 'title' },
    prepare: ({ title }) => ({ title: 'Case Study Feature', subtitle: title }),
  },
});
