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

Before release, run keyboard, reduced-motion, both-theme, and physical-device checks. The development regression suite exercises viewport emulation; it does not certify every browser or assistive technology.

## Verification completed on 24 September 2026

- Production build and its TypeScript check passed after the final application changes.
- ESLint passed with one pre-existing unused-variable warning in `scripts/capture-screenshots.mjs`.
- 28 UX regression groups passed against the built app: all three languages; seven home/navigation widths (320–1440px); core and new routes at mobile/desktop widths; draft preservation; guided review; mocked submission failure/retry/success; chat full-summary editing, conversation-limit recovery and focus; reduced motion; keyboard menu dismissal; main-content skip and unknown-page recovery.
- Pixel-based contrast audit passed all eight tested routes in both themes: zero failures and zero accepted exceptions.
- Live English CMS article -> Chinese language switch was verified in the local built app: a localized article-index notice replaces the previous bare 404.
- New translation bundles have matching EN/ID/ZH key structure. Git whitespace check passed.
- Browser screenshots inspected for phone About cards, contact flow, homepage, and desktop case study.

The website has not been deployed by this change. All automated enquiry/chat POST requests were intercepted with synthetic responses; real CMS delivery, AI reply quality, and physical-device behavior were not certified. The local production preview runs on port 3101.
