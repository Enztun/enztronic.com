import { ThListIcon } from '@sanity/icons';
import { defineArrayMember, defineField, defineType } from 'sanity';

const ICON_OPTIONS = [
  { title: 'Target / Goal', value: 'target' },
  { title: 'Megaphone / Marketing', value: 'megaphone' },
  { title: 'Code / Development', value: 'code' },
  { title: 'Palette / Design', value: 'palette' },
  { title: 'Trending Up / Growth', value: 'trending-up' },
  { title: 'Users / Team', value: 'users' },
  { title: 'Bar Chart / Analytics', value: 'bar-chart' },
  { title: 'Search / SEO', value: 'search' },
  { title: 'Check Circle / Done', value: 'check-circle' },
  { title: 'Star / Quality', value: 'star' },
  { title: 'Zap / Speed', value: 'zap' },
  { title: 'Globe / International', value: 'globe' },
  { title: 'Layout / UI', value: 'layout' },
  { title: 'Shield / Security', value: 'shield' },
  { title: 'Pencil / Content', value: 'pencil' },
  { title: 'Lightbulb / Strategy', value: 'lightbulb' },
];

export const blockIconGridType = defineType({
  name: 'iconGrid',
  title: 'Icon Grid',
  type: 'object',
  icon: ThListIcon,
  fields: [
    defineField({
      name: 'heading',
      type: 'string',
      title: 'Section Heading',
      description: 'Optional heading above the grid',
    }),
    defineField({
      name: 'items',
      title: 'Items',
      type: 'array',
      of: [
        defineArrayMember({
          type: 'object',
          fields: [
            defineField({
              name: 'icon',
              type: 'string',
              title: 'Icon',
              options: { list: ICON_OPTIONS },
              validation: (r) => r.required(),
            }),
            defineField({
              name: 'title',
              type: 'string',
              title: 'Title',
              validation: (r) => r.required(),
            }),
            defineField({
              name: 'description',
              type: 'text',
              title: 'Description',
              rows: 2,
            }),
          ],
          preview: {
            select: { title: 'title', subtitle: 'icon' },
          },
        }),
      ],
      validation: (r) => r.min(1),
    }),
    defineField({
      name: 'columns',
      title: 'Columns (desktop)',
      type: 'number',
      initialValue: 3,
      options: {
        list: [
          { title: '2 columns', value: 2 },
          { title: '3 columns', value: 3 },
          { title: '4 columns', value: 4 },
          { title: '6 columns', value: 6 },
        ],
      },
    }),
  ],
  preview: {
    select: { title: 'heading', first: 'items.0.title' },
    prepare({ title, first }) {
      return { title: `Icon Grid: ${title ?? first ?? 'untitled'}` };
    },
  },
});
