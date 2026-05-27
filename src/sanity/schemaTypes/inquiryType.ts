import { defineField, defineType } from 'sanity';

export const inquiryType = defineType({
  name: 'inquiry',
  title: 'Inquiries',
  type: 'document',
  orderings: [
    {
      title: 'Newest First',
      name: 'submittedAtDesc',
      by: [{ field: 'submittedAt', direction: 'desc' }],
    },
  ],
  fields: [
    defineField({ name: 'name', title: 'Name', type: 'string' }),
    defineField({ name: 'email', title: 'Email', type: 'string' }),
    defineField({ name: 'company', title: 'Company', type: 'string' }),
    defineField({
      name: 'service',
      title: 'Service Needed',
      type: 'string',
      options: {
        list: [
          { title: 'Website', value: 'website' },
          { title: 'SEO & Content', value: 'seo' },
          { title: 'Paid Advertising', value: 'ads' },
          { title: 'Branding', value: 'branding' },
          { title: "I don't know yet", value: 'unknown' },
        ],
      },
    }),
    defineField({
      name: 'budget',
      title: 'Budget Range',
      type: 'string',
      options: {
        list: [
          { title: 'Under $1,000', value: 'under_1k' },
          { title: '$1,000 – $5,000', value: '1k_5k' },
          { title: '$5,000 – $15,000', value: '5k_15k' },
          { title: '$15,000+', value: 'above_15k' },
          { title: 'Prefer not to say', value: 'prefer_not' },
        ],
      },
    }),
    defineField({ name: 'message', title: 'Message', type: 'text', rows: 4 }),
    defineField({
      name: 'preferredTime',
      title: 'Preferred Contact Time',
      type: 'string',
      options: {
        list: [
          { title: 'Morning', value: 'morning' },
          { title: 'Afternoon', value: 'afternoon' },
          { title: 'Evening', value: 'evening' },
        ],
      },
    }),
    defineField({ name: 'country', title: 'Country', type: 'string' }),
    defineField({
      name: 'status',
      title: 'Status',
      type: 'string',
      initialValue: 'new',
      options: {
        list: [
          { title: 'New', value: 'new' },
          { title: 'Contacted', value: 'contacted' },
          { title: 'Closed', value: 'closed' },
        ],
        layout: 'radio',
      },
    }),
    defineField({
      name: 'submittedAt',
      title: 'Submitted At',
      type: 'datetime',
      readOnly: true,
    }),
  ],
  preview: {
    select: {
      title: 'name',
      subtitle: 'email',
      service: 'service',
      status: 'status',
    },
    prepare({ title, subtitle, service, status }) {
      return {
        title: title ?? 'Unknown',
        subtitle: [subtitle, service, status].filter(Boolean).join(' · '),
      };
    },
  },
});
