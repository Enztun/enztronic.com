import type { AbstractIntlMessages } from 'next-intl';

type MessageTree = Record<string, unknown>;

function merge(base: MessageTree, extra: MessageTree): MessageTree {
  const result = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    const previous = result[key];
    result[key] = value && previous && typeof value === 'object' && typeof previous === 'object'
      && !Array.isArray(value) && !Array.isArray(previous)
      ? merge(previous as MessageTree, value as MessageTree) : value;
  }
  return result;
}

export async function loadMessages(locale: string): Promise<AbstractIntlMessages> {
  const bundles = await Promise.all([
    import(`../../messages/${locale}.json`),
    import(`../../messages/chat/${locale}.json`),
    import(`../../messages/contact/${locale}.json`),
    import(`../../messages/navigation/${locale}.json`),
    import(`../../messages/experience/${locale}.json`),
  ]);
  return bundles.reduce((messages, bundle) => merge(messages, bundle.default), {}) as AbstractIntlMessages;
}
