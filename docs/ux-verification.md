# UX implementation and verification

The public site uses a common enquiry and information journey in English, Indonesian, and Chinese. Translation additions live in `messages/contact`, `messages/navigation`, `messages/experience`, and `messages/chat`; `src/i18n/messages.ts` merges these with the original locale bundles.

## Local checks

- `npm run lint`
- `npx tsc --noEmit`
- `npm run build`
- Start the built app on port 3100: `npm start -- --port 3100`
- `npm run test:ux` (or set `BASE_URL` to another localhost port).
- `npm run audit:contrast -- --base http://localhost:3100`

The UX regression suite checks page and navigation fit across languages and screen widths, plus stateful interactions. All synthetic enquiry/chat writes are intercepted in the browser. It never creates a CMS enquiry or calls the AI provider. Real delivery still requires a deliberate integration test.

## Enquiry-funnel events

The user requested events now and reporting integration later. There is currently no reporting SDK, analytics account, cookie, identifier, or analytics network request added by this work.

`trackEvent` dispatches `enztronic:analytics` on the browser window with `{name, properties}`. The helper restricts property keys and accepts only short formatted strings or numbers; current callers use non-personal constants. Names, email addresses, company names, countries, message text, URLs and query strings must never be added to event properties. Event delivery does not affect form submission.

Example integration point for a future provider:

```js
window.addEventListener('enztronic:analytics', ({ detail }) => {
  // Send detail.name and detail.properties through the chosen, approved provider.
});
```

Events cover contact entry links (form/email/WhatsApp), form steps and submission outcomes, chat opening/recovery and confirmed enquiry outcomes. They can be used to measure entry -> started -> submitted -> successful once a reporting destination is connected. Provider setup is deliberately deferred by the user; these events alone do not produce a historical dashboard.

## Content decisions

- Response wording is neutral, as requested: the team reviews the enquiry and contacts the visitor about the next step.
- No booking link, fixed response SLA, audit price/free claim, delivery-duration guarantee, fabricated testimonial, or invented performance metric is published.
- A new case study describes documented capabilities, not independently measured business impact.
- Process and FAQ copy describes how scope can be agreed; it does not create unapproved service guarantees.

Keyboard, reduced-motion and both-theme checks are covered by the verification below. The development regression suite exercises viewport emulation; it does not certify physical devices, every browser, or every assistive technology.

## Verification completed on 24 September 2026

- Production build and its TypeScript check passed after the final application changes.
- ESLint passed with one pre-existing unused-variable warning in `scripts/capture-screenshots.mjs`.
- 28 UX regression groups passed against the built app: all three languages; seven home/navigation widths (320–1440px); core and new routes at mobile/desktop widths; draft preservation; guided review; mocked submission failure/retry/success; chat full-summary editing, conversation-limit recovery and focus; reduced motion; keyboard menu dismissal; main-content skip and unknown-page recovery.
- Pixel-based contrast audit passed all eight tested routes in both themes: zero failures and zero accepted exceptions.
- Live English CMS article -> Chinese language switch was verified in the local built app: a localized article-index notice replaces the previous bare 404.
- New translation bundles have matching EN/ID/ZH key structure. Git whitespace check passed.
- Browser screenshots inspected for phone About cards, contact flow, homepage, and desktop case study.

## Production release on 24 September 2026 (WIB)

- Application commit: `bf02db24cfe72ea9776fd7cd7f353cdb573bca7e`, pushed to `main`.
- Vercel deployment: `dpl_7Vu4FeFS2W6Pfp1rhPXWY89VMEFU`, status `READY`, production aliases `enztronic.com` and `www.enztronic.com`.
- [Deployment URL](https://enztronic-e2eptla8w-ellendon-aaron-tingons-projects.vercel.app); build completed at 01:50:55 WIB (23 September 18:50:55 UTC).
- Remote Next.js 16.2.10 build, TypeScript check and generation of 37 static pages passed.
- All 18 production checks passed: home, services, contact, blog, case study and workflow guide in EN/ID/ZH returned HTTP 200 with expected new visible content. Sitemap includes all six new localized routes; the optimized Sanity image returned HTTP 200 with `image/webp`.
- Live browser checks passed: 375px contact mode switching preserves draft text; mobile language menu fits and dismisses with Escape; 820px navigation fits; 1440px case study renders correctly; English article switching to Chinese opens the localized translation-unavailable notice. No browser exceptions were observed.
- Vercel's runtime error query for this deployment returned no entries during the release smoke window. This is a short observation window, not long-term monitoring.
- [GitHub Actions run](https://github.com/Enztun/enztronic.com/actions/runs/35905086667) did not start because GitHub reports an account billing lock. Local checks and the independent Vercel build passed; GitHub CI is not green.

All automated enquiry/chat POST requests were intercepted with synthetic responses locally, and production checks sent no enquiries or chat messages. Real CMS delivery, AI reply quality, and physical-device behavior were not certified. Reporting-provider integration remains deferred as requested. See `deploy_log.md` and `errorlog.md` for the release record and outstanding operational notices.
