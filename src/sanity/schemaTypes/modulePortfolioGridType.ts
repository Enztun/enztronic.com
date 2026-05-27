import { defineField, defineType } from 'sanity';

export const modulePortfolioGridType = defineType({
  name: 'module.portfolioGrid',
  title: 'Portfolio Grid',
  type: 'object',
  fields: [
    defineField({ name: 'heading', title: 'Heading', type: 'string' }),
    defineField({ name: 'description', title: 'Description', type: 'text', rows: 2 }),
    defineField({ name: 'visitSiteLabel', title: 'Visit Site Label', type: 'string' }),
    defineField({
      name: 'projects',
      title: 'Projects',
      type: 'array',
      of: [
        {
          type: 'object',
          fields: [
            defineField({ name: 'title', title: 'Title', type: 'string' }),
            defineField({ name: 'category', title: 'Category', type: 'string' }),
            defineField({ name: 'description', title: 'Description', type: 'text', rows: 3 }),
            defineField({ name: 'url', title: 'URL', type: 'url' }),
            defineField({
              name: 'tags',
              title: 'Tags',
              type: 'array',
              of: [{ type: 'string' }],
            }),
          ],
          preview: {
            select: { title: 'title', subtitle: 'category' },
          },
        },
      ],
    }),
  ],
  preview: {
    prepare: () => ({ title: 'Portfolio Grid' }),
  },
});
