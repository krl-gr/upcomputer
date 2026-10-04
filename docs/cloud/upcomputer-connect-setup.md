# UpComputer Connect setup

UpComputer Connect lets a phone or another device reach the backend of Up.computer Desktop. It has
two hosted parts: the relay (a Cloudflare Worker in `infra/relay`) and Clerk accounts. Nothing is
deployed yet. This is the checklist for the first deploy under our own accounts.

Background reading:

- [Clerk setup](./t3-connect-clerk.md): source-build `.env`, CLI OAuth, allowed origins, waitlist.
- [Architecture and trust model](./t3-code-connect-auth-flow.html).
- [Environment authentication profile](./environment-auth.md).
- [Relay README](../../infra/relay/README.md) and [relay observability](../operations/relay-observability.md).

## 0. Decide names first

Write these down before creating accounts. Several of them are baked into deployed resources.

| Decision                    | Value used in this doc        | Notes                                                                                          |
| --------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------- |
| API zone                    | `<api-zone>`                  | The relay is served at `https://relay.<api-zone>` for the `prod` stage.                        |
| Tunnel zone                 | `<tunnel-zone>`               | Each linked environment gets `prod-<digest>.<tunnel-zone>`. Use a separate registrable domain. |
| Clerk JWT template name     | `upcomputer-relay`            | Clients request Clerk tokens from this template.                                               |
| Clerk JWT audience (`aud`)  | `upcomputer-relay`            | The relay rejects Clerk tokens with any other audience.                                        |
| iOS bundle ID               | `<ios-bundle-id>`             | Also the APNs topic. Live Activities use `<ios-bundle-id>.push-type.liveactivity`.             |
| PlanetScale region and size | `us-west`, `PS_5`, 0 replicas | Set in `infra/relay/src/db.ts`. Change it before the first deploy if you want something else.  |

Recommendation for the tunnel zone: use a domain that serves nothing else, for example a dedicated
`.dev` or `.app` domain. Tunnel hostnames route to code running on users' machines, so they must not
share cookies or an origin with the API zone, the website or Clerk. Before broad untrusted use, add
that domain to the Public Suffix List so browsers isolate each subdomain.

## 1. Accounts

### Cloudflare

1. Create the account and subscribe to **Workers Paid**. The relay uses Queues, Hyperdrive, cron
   triggers and Cloudflare Tunnel.
2. Add both zones (`<api-zone>` and `<tunnel-zone>`) and point their nameservers at Cloudflare. The
   `prod` deploy adopts both zones and keeps them if the stack is removed.
3. Copy the **Account ID**. It becomes `CLOUDFLARE_ACCOUNT_ID`.
4. Create an API token for deploys. It becomes `CLOUDFLARE_API_TOKEN`. Start with these permissions
   and add any that the first deploy reports as missing:
   - Account: Workers Scripts Edit, Queues Edit, Hyperdrive Edit, Cloudflare Tunnel Edit,
     Secrets Store Edit, Account API Tokens Edit, Account Settings Read.
   - Zone (both zones): Zone Edit, DNS Edit, Workers Routes Edit.

   Account API Tokens Edit is needed because the Worker's tunnel binding creates its own scoped token
   (Cloudflare Tunnel Read and Write) at deploy time.

5. Know what the first deploy creates outside the relay itself: Alchemy keeps its state in a Worker
   named `alchemy-state-store` plus a Secrets Store secret in the same account. Both the deploy
   workflow and the release workflow read that state with the same token.

Cost notes: every linked environment holds one named Cloudflare tunnel while it is linked. A user may
hold 3 managed tunnels by default (`relay_managed_tunnel_limits` overrides it per user). Tunnels of
offline hosts are not reclaimed yet; see "Open items" below.

### PlanetScale

1. Create the organization and enable Postgres. The organization name becomes
   `PLANETSCALE_ORGANIZATION`.
2. Create a service token that can create and manage databases, branches and roles. Its ID becomes
   `PLANETSCALE_API_TOKEN_ID` and its value `PLANETSCALE_API_TOKEN`.
3. Do not create the database by hand. The `prod` deploy creates `upcomputerrelay` with the region,
   cluster size and replica count from `infra/relay/src/db.ts`, applies the migrations in
   `infra/relay/migrations/postgres`, and keeps the database if the stack is removed. The code
   comment on `replicas: 0` asks for a review before going to production.

### Axiom

1. Create the organization. Its ID becomes `AXIOM_ORG_ID`.
2. Create a personal access token that can create datasets, API tokens and views. It becomes
   `AXIOM_TOKEN`. It is used only while deploying; the Worker gets a scoped ingest token.
3. The `prod` deploy creates the dataset `upcomputer-relay-traces-prod` (30 day retention), ingest
   tokens `upcomputer-relay-otel-ingest-prod`, `upcomputer-mobile-otel-ingest-prod` and
   `upcomputer-relay-client-otel-ingest-prod`, and the view `upcomputer-relay-recent-spans-prod`.

### Clerk (production instance)

1. Create the application and its **production** instance. A production instance needs a domain you
   control for its Frontend API DNS records; follow Clerk's DNS steps.
2. Copy the publishable key (`pk_live_...`, becomes `CLERK_PUBLISHABLE_KEY`) and the secret key
   (`sk_live_...`, becomes `CLERK_SECRET_KEY`). Never put the secret key in a client build.
3. **JWT template**: name `upcomputer-relay`, claims `{ "aud": "upcomputer-relay" }`. The name
   becomes `CLERK_JWT_TEMPLATE` and the audience `CLERK_JWT_AUDIENCE`.
4. **OAuth application for the CLI**: public client (PKCE), redirect URI
   `http://127.0.0.1:34338/callback`, scopes `openid`, `profile`, `email`. Its client ID becomes
   `CLERK_CLI_OAUTH_CLIENT_ID`. The release workflow requires it even if the CLI is not shipped, and
   the desktop backend enables Connect only when it is set.
5. **Native API and allowed origins**: enable the Native API and add `upcomputer://app` to the
   production instance's `allowed_origins` through the Backend API. Preserve existing entries; see
   [Clerk setup](./t3-connect-clerk.md#desktop-oauth-redirect-allowlist) for the request.
6. If the hosted web app is deployed, serve it from a domain the production instance accepts (the
   instance's own domain or a configured satellite domain).
7. For a private beta, turn on **Waitlist** or an **Allowlist** before inviting anyone.
8. Later, for the iOS app: add it under **Native applications** with the Apple Team ID and
   `<ios-bundle-id>`.

### Apple (APNs, can wait for the iOS app)

1. In Certificates, Identifiers & Profiles, create an explicit App ID for `<ios-bundle-id>` with Push
   Notifications enabled.
2. Under Keys, create a key with **Apple Push Notifications service (APNs)** and download the `.p8`
   file once. Record the Key ID and your Team ID.
3. Values: `APNS_TEAM_ID`, `APNS_KEY_ID`, `APNS_BUNDLE_ID` (`<ios-bundle-id>`), `APNS_PRIVATE_KEY`
   (the full `.p8` text) and `APNS_ENVIRONMENT`. Use `production` for TestFlight and App Store builds
   and `sandbox` for builds run from Xcode. One relay stage has one APNs environment.

The relay reads all APNs values at deploy time and fails without them. If the iOS app is not ready,
deploy with placeholder values: everything else works, and push delivery fails until real values
are set and the relay is deployed again.

## 2. GitHub configuration

Both workflows run in the `production` GitHub environment, so variables and secrets can live in that
environment. One exception: the deploy and release jobs start only when `RELAY_API_ZONE_NAME` or
`RELAY_DOMAIN` is set, and a job-level condition cannot read environment-scoped variables. Set that
switch as a **repository** variable, and set it last.

| Name                        | Kind                          | Read by                                                   | Value                               |
| --------------------------- | ----------------------------- | --------------------------------------------------------- | ----------------------------------- |
| `RELAY_API_ZONE_NAME`       | Repository variable           | `deploy-relay.yml`, `release.yml` (`relay_public_config`) | `<api-zone>`                        |
| `RELAY_DOMAIN`              | Repository variable, optional | `deploy-relay.yml`, `release.yml`                         | Only to override `relay.<api-zone>` |
| `RELAY_TUNNEL_ZONE_NAME`    | `production` variable         | `deploy-relay.yml`                                        | `<tunnel-zone>`                     |
| `CLOUDFLARE_ACCOUNT_ID`     | `production` variable         | `deploy-relay.yml`, `release.yml`                         | Cloudflare account ID               |
| `PLANETSCALE_ORGANIZATION`  | `production` variable         | `deploy-relay.yml`                                        | PlanetScale organization            |
| `AXIOM_ORG_ID`              | `production` variable         | `deploy-relay.yml`                                        | Axiom organization ID               |
| `CLERK_PUBLISHABLE_KEY`     | `production` variable         | `deploy-relay.yml`, `release.yml`                         | `pk_live_...`                       |
| `CLERK_JWT_AUDIENCE`        | `production` variable         | `deploy-relay.yml`                                        | `upcomputer-relay`                  |
| `CLERK_JWT_TEMPLATE`        | `production` variable         | `release.yml`                                             | `upcomputer-relay`                  |
| `CLERK_CLI_OAUTH_CLIENT_ID` | `production` variable         | `release.yml`                                             | Clerk OAuth application client ID   |
| `APNS_ENVIRONMENT`          | `production` variable         | `deploy-relay.yml`                                        | `production` or `sandbox`           |
| `APNS_TEAM_ID`              | `production` variable         | `deploy-relay.yml`                                        | Apple Team ID                       |
| `APNS_KEY_ID`               | `production` variable         | `deploy-relay.yml`                                        | APNs key ID                         |
| `APNS_BUNDLE_ID`            | `production` variable         | `deploy-relay.yml`                                        | `<ios-bundle-id>`                   |
| `CLOUDFLARE_API_TOKEN`      | `production` secret           | `deploy-relay.yml`, `release.yml`                         | Deploy token from section 1         |
| `PLANETSCALE_API_TOKEN_ID`  | `production` secret           | `deploy-relay.yml`                                        | Service token ID                    |
| `PLANETSCALE_API_TOKEN`     | `production` secret           | `deploy-relay.yml`                                        | Service token value                 |
| `AXIOM_TOKEN`               | `production` secret           | `deploy-relay.yml`                                        | Axiom personal access token         |
| `CLERK_SECRET_KEY`          | `production` secret           | `deploy-relay.yml`                                        | `sk_live_...`                       |
| `APNS_PRIVATE_KEY`          | `production` secret           | `deploy-relay.yml`                                        | Full `.p8` text                     |

`deploy-relay.yml` deploys the Alchemy `prod` stage on every push to `main` once the switch is set.
`release.yml` reads the relay's public client config before it builds desktop, CLI and hosted web
artifacts; it also reads the relay client tracing token from the deployed stack state, so the relay
must be deployed before the first release with Connect. A separate task owns the gating of
`deploy-relay.yml`.

## 3. Build-time public config

These values are public identifiers, not secrets. Release builds inject them; source builds read
them from the process environment, then the repository-root `.env.local`, then `.env`.

| Name                                          | Used by                   | Value                        |
| --------------------------------------------- | ------------------------- | ---------------------------- |
| `UPCOMPUTER_RELAY_URL`                        | Desktop backend, CLI, web | `https://relay.<api-zone>`   |
| `UPCOMPUTER_CLERK_PUBLISHABLE_KEY`            | Desktop backend, CLI, web | `pk_live_...`                |
| `UPCOMPUTER_CLERK_JWT_TEMPLATE`               | Web and desktop renderer  | `upcomputer-relay`           |
| `UPCOMPUTER_CLERK_CLI_OAUTH_CLIENT_ID`        | Desktop backend, CLI      | Clerk OAuth client ID        |
| `UPCOMPUTER_RELAY_CLIENT_OTLP_TRACES_URL`     | Optional, client tracing  | From the relay deploy output |
| `UPCOMPUTER_RELAY_CLIENT_OTLP_TRACES_DATASET` | Optional, client tracing  | From the relay deploy output |
| `UPCOMPUTER_RELAY_CLIENT_OTLP_TRACES_TOKEN`   | Optional, client tracing  | From the relay deploy output |

- The web UI (also inside the desktop app) shows Connect only when the relay URL, publishable key and
  JWT template are all set. The build loader also exposes them as `VITE_*` aliases.
- The desktop backend and CLI enable Connect only when the relay URL, publishable key and CLI OAuth
  client ID are all set.
- A local `vp run --filter @upcomputer/relay deploy` writes the relay URL and tracing values into the
  repository-root `.env` after a successful deploy.

## 4. Runtime secrets generated by the deploy

Two secrets are generated by Alchemy on the first deploy and kept in the stack state. Nobody creates
or copies them by hand.

- **Cloud-mint key pair** (`CloudMintKeyPair` in `infra/relay/src/worker.ts`): an Ed25519 key pair.
  The relay signs health and mint requests to environments with the private key. Each environment
  stores the public key when it links. To rotate it, replace the resource (for example by renaming
  its logical ID) and deploy; environments then reject relay requests until they link again.
- **APNs delivery job signing secret** (`ApnsDeliveryJobSigningSecret`): 32 random bytes that sign
  queued push jobs. Rotating it drops jobs that were queued with the old secret.

## 5. First deploy

1. Create the accounts and tokens in section 1.
2. Review `infra/relay/src/db.ts` (region, cluster size, replicas) and commit any change.
3. Set every value in section 2 except the switch (`RELAY_API_ZONE_NAME`).
4. Optional dry run from a trusted machine: copy `infra/relay/.env.example` to `infra/relay/.env`,
   fill it in (plus the Cloudflare, PlanetScale and Axiom credentials in your shell), and run
   `vp run --filter @upcomputer/relay deploy -- --stage prod --dry-run` to see the plan.
5. Set `RELAY_API_ZONE_NAME` as a repository variable and push to `main` (or re-run the workflow).
   Watch **Deploy UpComputer Connect relay**. It adopts the zones and creates the database with its
   migrations, Hyperdrive, the queues, the Axiom resources, the Worker and its custom domain.
6. Verify the relay:
   - `curl -fsS https://relay.<api-zone>/health` returns success.
   - `https://relay.<api-zone>/openapi.json` and `https://relay.<api-zone>/docs` load.
   - The commit has the status **Relay deploy / production**.
   - Requests appear in the Axiom view `upcomputer-relay-recent-spans-prod`.
   - The `upcomputerrelay` database in PlanetScale has the `relay_*` tables and `relay_migrations`.
7. Build the desktop app with the public config from section 3 (or run a Core release), sign in,
   and enable Connect under **Settings** > **Connections**. The environment should get a hostname
   under `<tunnel-zone>`, and a second signed-in device should connect to it.

## 6. Privacy

What leaves the user's machine when Connect is on:

- **All remote traffic crosses Cloudflare.** A remote device talks to the desktop through a
  Cloudflare tunnel. TLS ends at Cloudflare's edge, so chats, terminal output and files sent to that
  device pass through Cloudflare. The relay itself does not carry this traffic.
- **The relay stores account and link data**: Clerk user IDs, environment IDs and labels,
  environment public keys, hashed environment credentials, managed endpoint hostnames, and
  registered devices (labels, OS version, push tokens).
- **Agent activity notifications send thread titles.** When the user turns on agent activity
  publishing (off by default), the desktop sends each active thread's project title, thread title,
  model name, phase, a short headline and a capped detail (failed runs use a fixed redacted text).
  The relay keeps the current row per thread, removes finished rows after 30 minutes, and forwards
  the content to Apple for push notifications and Live Activities.
- **Traces**: relay request spans in Axiom include request paths and user IDs, kept for 30 days.

The README says "every chat stays on your computer". Chats are stored only on the user's computer,
but with Connect on, remote sessions cross Cloudflare and notification content reaches the relay and
Apple. Review that sentence before Connect ships.

## 7. What the iOS client needs

The iOS app is planned as a fork of upstream's SwiftUI client. It needs these values from Connect:

- Relay URL: `https://relay.<api-zone>`.
- Clerk publishable key (`pk_live_...`) and JWT template name `upcomputer-relay`. Register the app
  under Clerk **Native applications**.
- APNs: the app's bundle ID must equal `APNS_BUNDLE_ID`, and its build type must match
  `APNS_ENVIRONMENT`.

Identifiers this fork renamed, which the upstream client hard-codes differently:

| What                              | This fork                                                      | Upstream                                               |
| --------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------ |
| Relay DPoP `client_id` for mobile | `upcomputer-mobile`                                            | `t3-mobile`                                            |
| Environment descriptor path       | `/.well-known/upcomputer/environment`                          | `/.well-known/t3/environment`                          |
| Bootstrap token type              | `urn:upcomputer:params:oauth:token-type:environment-bootstrap` | `urn:t3:params:oauth:token-type:environment-bootstrap` |
| Push and Live Activity title      | `Up.computer`                                                  | `T3 Code`                                              |

The bootstrap token type is advertised in the environment descriptor, so a client that reads it from
there needs no change. Relay-to-environment JWT types and the `/api/upcomputer-connect/*` routes are
used only between the relay and the desktop backend.

## Open items

- **Idle tunnel cleanup is not ported.** Upstream `8d7b5e998c` and `d23eab13d9` delete tunnels of
  hosts that stay offline and let hosts recover them. They depend on the newer Alchemy Worker API
  and on upstream server lifecycle changes this fork does not have. Until then, a desktop that
  linked from the web UI keeps its tunnel while offline (CLI-desired links release theirs on
  shutdown). Revisit after the Effect and Alchemy upgrade decision.
- **Effect and Alchemy upgrade.** The relay runs on Alchemy `2.0.0-beta.52` and Effect `beta.78`;
  upstream moved to newer versions. Ports that need the newer Worker API were skipped.
- The first production deploy has not been run. Expect to adjust Cloudflare token permissions on
  the first attempt.
