import { defineField, defineType } from 'sanity';

export const moduleServicesGridType = defineType({
  name: 'module.servicesGrid',
  title: 'Services Grid',
  type: 'object',
  fields: [
    defineField({ name: 'heading', title: 'Heading', type: 'string' }),
    defineField({ name: 'subheading', title: 'Subheading', type: 'string' }),
    defineField({
      name: 'services',
      title: 'Services',
      type: 'array',
      of: [
        {
          type: 'object',
          fields: [
            defineField({ name: 'title', title: 'Title', type: 'string' }),
            defineField({ name: 'description', title: 'Description', type: 'text', rows: 2 }),
            defineField({
              name: 'icon',
              title: 'Icon',
              type: 'string',
              options: {
                list: [
                  { title: 'Code (Web Dev)', value: 'Code' },
                  { title: 'Megaphone (Marketing)', value: 'Megaphone' },
                  { title: 'Target (Ads)', value: 'Target' },
                  { title: 'Palette (Branding)', value: 'Palette' },
                  { title: 'TrendingUp (Growth)', value: 'TrendingUp' },
                  { title: 'Users (UI/UX)', value: 'Users' },
                ],
              },
            }),
            defineField({
              name: 'features',
              title: 'Features',
              type: 'array',
              of: [{ type: 'string' }],
            }),
          ],
          preview: {
            select: { title: 'title', subtitle: 'description' },
          },
        },
      ],
    }),
  ],
  preview: {
    prepare: () => ({ title: 'Services Grid' }),
  },
});
