This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Checks and tooling

### `npm run audit:contrast`

WCAG contrast audit over every page in both themes, run against a server you
already have up (`--base http://localhost:3000` by default). It shoots each page
twice -- once normally, once with the glyphs made transparent -- and diffs the
two, so it measures text against the pixels actually behind it. That matters
here: the site uses gradients, translucent layers and a brand glow, none of
which a computed-style checker can see. It exits non-zero on failure and runs in
CI on every PR.

Failures we have accepted on purpose live in `ACCEPTED` at the top of
`scripts/audit-contrast.mjs`, so the audit stays a signal instead of being
permanently red.

### `npm run shots`

Re-captures the client screenshots on /portfolio, reading the project URLs from
`messages/en.json`. Client sites get redesigned, so this is the way to refresh
them rather than by hand.

It opens real browser windows rather than running headless, and that is
deliberate: two of the client sites sit behind a Cloudflare challenge that never
clears for a headless browser but does for a headed one on a fresh profile. It
also dismisses cookie banners and age gates before shooting, since otherwise
they fill the frame.

Pass `--only slug1,slug2` to redo just some. New projects also need their slug
adding to `CAPTURED` in `src/lib/screenshots.ts`, which is an explicit list so a
missing file cannot 404 on every page load.
