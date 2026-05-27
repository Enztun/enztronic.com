import { defineField, defineType } from 'sanity';

export const moduleStatsType = defineType({
  name: 'module.stats',
  title: 'Stats Bar',
  type: 'object',
  fields: [
    defineField({
      name: 'items',
      title: 'Stat Items',
      type: 'array',
      of: [
        {
          type: 'object',
          fields: [
            defineField({ name: 'value', title: 'Value', type: 'string' }),
            defineField({ name: 'label', title: 'Label', type: 'string' }),
          ],
          preview: {
            select: { title: 'value', subtitle: 'label' },
          },
        },
      ],
    }),
  ],
  preview: {
    prepare: () => ({ title: 'Stats Bar' }),
  },
});
