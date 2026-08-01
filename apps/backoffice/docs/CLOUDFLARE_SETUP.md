# Enztronic backoffice: private Windows deployment

This app is designed to run natively on the Enztronic Windows host. Next.js listens only on `127.0.0.1:3100`; its dedicated PostgreSQL 17 cluster listens only on `127.0.0.1:54329`. Cloudflare Tunnel provides transport, and Cloudflare Access plus application-side JWT verification provides authentication.

No Docker, GitHub Actions, public database port, or direct public Next.js listener is part of this setup.

## 1. Local prerequisites

From `D:\Enztronic\apps\backoffice`:

```powershell
npm install
py -m pip install reportlab
Copy-Item .env.example .env.local
```

Fill `.env.local` with real values and keep it untracked. Never place R2, Resend, database, or Cloudflare credentials in `NEXT_PUBLIC_*` variables.

The existing PostgreSQL service on port `5432` belongs to other workloads and its credentials are not available to this app. Initialize the dedicated cluster with the repository's `scripts/setup-local.ps1` helper; inspect its parameters with:

```powershell
Get-Help .\scripts\setup-local.ps1 -Detailed
```

The helper owns `.runtime/postgres-data` and port `54329`. The start script never initializes or changes the existing PostgreSQL service.

## 2. Build and run locally

For an intentional local-only auth bypass, set both of these in `.env.local`:

```dotenv
CLOUDFLARE_ACCESS_DEV_BYPASS=true
CLOUDFLARE_ACCESS_DEV_EMAIL=your-address@example.com
```

The bypass is accepted only when `NODE_ENV` is not `production`. Production fails closed if the bypass is enabled or the Access configuration is incomplete.

Create a production build and launch the dedicated database plus app:

```powershell
.\scripts\start-backoffice.ps1 -Build
```

Subsequent launches can omit `-Build`. `-SkipPostgres` exists only for controlled maintenance where the dedicated cluster is already managed separately.

## 3. Create the Cloudflare Access application

In Cloudflare Zero Trust:

1. Open **Access > Applications**, add a **Self-hosted** application, and use `admin.enztronic.com` as the public hostname.
2. Add an **Allow** policy containing only the owner/operator email addresses that may use the backoffice. Do not add a bypass policy.
3. Copy the application's **AUD tag** into `CLOUDFLARE_ACCESS_AUDIENCE`.
4. Put the account's Access team origin, such as `https://your-team.cloudflareaccess.com`, in `CLOUDFLARE_ACCESS_TEAM_DOMAIN`.
5. Repeat the same authorized addresses in `CLOUDFLARE_ACCESS_ALLOWED_EMAILS`. This application allowlist is a second authorization boundary if the edge policy is accidentally widened.

The app validates `Cf-Access-Jwt-Assertion` (or the `CF_Authorization` cookie) against Cloudflare's JWKS, issuer, audience, expiry, and email allowlist. Every protected Server Action or Route Handler must call `authenticateAccessHeaders`; the tunnel and middleware are not substitutes for that server-side check.

## 4. Route the existing cross-dashboard tunnel

`cross.enztronic.com` already uses the `cross-dashboard` tunnel and targets `http://localhost:8123`. Keep that route. Add the new hostname before the final catch-all in `C:\Users\hoyec\.cloudflared\cross-config.yml`:

```yaml
ingress:
  - hostname: cross.enztronic.com
    service: http://localhost:8123
  - hostname: admin.enztronic.com
    service: http://127.0.0.1:3100
  - service: http_status:404
```

After reviewing the file, the operator can validate it and create the hostname route:

```powershell
cloudflared tunnel --config C:\Users\hoyec\.cloudflared\cross-config.yml ingress validate
cloudflared tunnel route dns cross-dashboard admin.enztronic.com
```

These commands are documented only; this implementation does not change DNS, Access, or the running tunnel. The current manual `cross-dashboard` tunnel process also needs its own approved reboot/startup arrangement before the hostname can be considered always available.

## 5. Create a private R2 bucket

In **Cloudflare Dashboard > R2 Object Storage**:

1. Create a dedicated bucket, for example `enztronic-backoffice-private`.
2. Leave the public development URL disabled and do not attach a public custom domain.
3. Create an R2 API token scoped only to this bucket with object read/write permission. Bucket administration and account-wide permissions are not required at runtime.
4. Put the account ID, token access key, token secret, and bucket name in the matching `R2_*` variables.

Objects are written without a public ACL, with attachment disposition and private/no-store cache metadata. Downloads use short-lived signed URLs (one to fifteen minutes). Store opaque server-generated object keys in PostgreSQL; never use a client-supplied filename as the R2 key.

The existing local Cloudflare credential can inspect tunnels but received `403` for R2 bucket enumeration, so bucket creation and the bucket-scoped runtime token remain an operator step.

## 6. Configure Resend

In Resend:

1. Verify a sending domain controlled by Enztronic.
2. Create a sending-only API key for this app.
3. Set `RESEND_FROM_EMAIL` to an address on that verified domain and optionally set `RESEND_REPLY_TO`/`RESEND_BCC`.

The sending helper requires a deterministic idempotency key for every delivery attempt. Persist a delivery/outbox ID in PostgreSQL and reuse the same key for retries; do not generate a new key on each retry. PDF attachments are checked for signature and limited to 10 MiB.

## 7. Install the Windows startup task

First produce a successful build, then install the current-user, limited-privilege task:

```powershell
.\scripts\start-backoffice.ps1 -Build
.\scripts\install-startup-task.ps1
```

Use `-Force` only when intentionally replacing the existing task with the same name. At logon the task starts `.runtime/postgres-data` if needed, verifies database readiness on `54329`, and launches the existing production build on `127.0.0.1:3100`.

## 8. Verification checklist

- `Get-NetTCPConnection -State Listen -LocalPort 3100,54329` shows loopback listeners only.
- `http://127.0.0.1:3100` works locally with the explicit development bypass, then the bypass is set back to `false`.
- `https://admin.enztronic.com` redirects an unauthenticated browser to Cloudflare Access.
- An allowed email can sign in; a different email is denied.
- A generated invoice PDF begins with `%PDF-`, renders correctly, and is stored in the private bucket.
- Retrying the same email delivery with the same idempotency key does not create a second delivery.
- `.env.local`, `.runtime`, generated PDFs, and credentials are absent from Git history.
