# Security dependency follow-up and recurring audit - 16 October 2026

The website now uses Next/eslint-config-next 16.4.2, Sanity/vision 5.31.2,
next-sanity 13.3.4, PostCSS 8.5.30 and Sharp 0.35.5, plus compatible lockfile
security fixes. React 19.2.7 is preserved; Playwright is pinned to 1.62.1.
No unsupported transitive override, framework downgrade or forced major migration
was used. The generated Next root-params type reference is retained.

The fresh production dependency audit improved from 33 to 17 entries:
**0 critical, 10 high, 7 moderate**, previously 1 critical. Full audit improved
from 39 to 19 entries: **0 critical, 12 high, 7 moderate**. Registry advisory
counts can change; these are measured snapshots, not a security certificate.

Remaining underlying packages are `adm-zip` 0.5.18, `braces` 3.0.3,
vendor-pinned `js-yaml` 3.13.1, `sprintf-js` 1.0.3 and `typeid-js`'s UUID 10.
Most enter through Sanity's CLI dependency tree retained in its production
package; source/package presence is not proof of a public exploit. No compatible
upstream fix was available for these chains at review. Monitoring must continue
to report these high findings as failures, without suppressing or downgrading them.

Validation: clean install, zero-error/zero-warning ESLint, TypeScript, production
build, four UX network-guard tests and Sharp PNG/resize/WebP smoke all pass.
The existing browser suite is restricted to an exact local HTTP origin/port,
uses an empty nonpersistent browser context, and blocks service workers,
WebSockets, external requests and unmocked writes. Form/chat writes are mocked.
The full audit runs it in a second container with network access disabled.
CMS-backed primary builds and the separate offline UI fixture build are labeled
independently. Real CMS/providers/email submissions are outside offline UI coverage.

The shared `ops/website-audit` engine and site profile run on the Qianlima VPS:
daily at **19:30 UTC / 02:30 Asia/Jakarta**, full scans every **14 UTC calendar
days**. Actual scheduler/first-run/Discord acceptance evidence is appended after
verification. Full scans include dependency advisories, available updates,
Git-history secret detection, lint/type/build and local UI tests. Daily checks
cover public routes, TLS/expiry, configured headers, exposure signatures and
host maintenance status. No GitHub Actions or paid AI API is used.

Private Vercel runtime logs are excluded by the user's explicit choice. The
monitoring host has no Enztronic private runtime-log credential. Keep webhook
values and private reports out of Git and public deployment uploads. Install
one scheduler per host; a copy of the engine in another repository must not
create duplicate cron jobs. Original checkout and production secrets are never
mounted into the disposable audit worktree.

Next hardening: resolve upstream CLI dependency chains, review the current
minimal public CSP, add provider-native frontend error/dead-man alerts when
desired, and exercise real provider-backed workflows with dedicated test data.
The independent local `apps/**` installations are outside this public website
dependency audit; the back office remains excluded from public Vercel uploads.

## Reviewed Git-history scanner false positives

The first history scan reported nine `generic-api-key` candidates. Each exact
historical match was inspected in memory without printing candidate values or
reading environment files. The repository `.gitleaksignore` records only these
nine commit/path/rule/line fingerprints; no path-wide or rule-wide exclusion is
used, and credential findings remain reportable.

Seven matches in commit `4871fcaa4462cded988f5b15813d137d3d5bffa7`,
`apps/meteora-lp/src/lib/mock-data.ts` lines 17, 42, 67, 164, 182, 200 and 218,
are `tokenBMint` fields in exported `mockPositions` and `mockCandidates` demo
data. The domain contracts define them as token-mint strings. Three values recur
in both arrays and have 32-byte public-address shape; the final value is a mock
placeholder. No private-key, secret-key or signing operation occurs in that
fixture. These are public mint identifiers or mock data, not authentication keys.

Two matches in commit `bf195dcd2fed7a4f2e1ec6f305a9aa165006dec5`,
`dist/static/sanity-BAlIdGYY.js` lines 1380 and 1626, come from generated Sanity
vendor code. The first is unquoted JavaScript member access and a comparison,
not a credential literal. The second is a static 12-character array-item `_key`;
the exact value also occurs in installed Sanity source, where AST inspection
places it inside the nested `PATHS` array. The generated historical bundle is
no longer tracked. These exceptions do not suppress dependency advisories, new
findings or any Qianlima credentials. A fresh history scan must verify the
remaining unsuppressed findings after the reviewed allowlist is committed.

References: [Next release](https://github.com/vercel/next.js/releases/tag/v16.4.2),
[Sharp advisory](https://github.com/lovell/sharp/security/advisories/GHSA-wq5f-xc86-pv6w),
[PostCSS advisory](https://github.com/postcss/postcss/security/advisories/GHSA-fxqj-rqcc-2cmp),
[unpatched braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
