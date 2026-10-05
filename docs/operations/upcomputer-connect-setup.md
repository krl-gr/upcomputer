# UpComputer Connect setup

UpComputer Connect lets a phone or another device reach the backend of Up.computer Desktop. It is
upstream's T3 Connect, run as upstream ships it: the relay (a Cloudflare Worker in `infra/relay`)
and Clerk accounts. Only the user-visible name, the domains, and the account settings are ours.
Nothing is deployed yet. This is the checklist for the first deploy under our own accounts.

Read upstream's guides first; this page lists only what differs for Up.computer:

- [Connect setup](./connect-setup.md): public build config, CLI OAuth, JWT template, desktop OAuth
  redirects, passkeys, sign-up restrictions.
- [Architecture and trust model](../internals/t3-connect.md).
- [Relay README](../../infra/relay/README.md#deployment) and
  [relay observability](./relay-observability.md).

## What stays upstream

Up.computer keeps upstream's protocol so upstream clients, such as the Swift iOS client, keep
working against our relay and environments:

| What                              | Value                                                  |
| --------------------------------- | ------------------------------------------------------ |
| Environment descriptor path       | `/.well-known/t3/environment`                          |
| Bootstrap token type              | `urn:t3:params:oauth:token-type:environment-bootstrap` |
| Relay DPoP `client_id` for mobile | `t3-mobile`                                            |
| Relay and environment JWT `typ`   | upstream's values, unchanged                           |
| Relay stack and resource names    | `T3CodeRelay`, `t3coderelay`, `t3-code-relay-*`        |
| Build and runtime variable names  | `T3CODE_*` (`UPCOMPUTER_*` aliases also work)          |

V1 renamed these (`upcomputer-*+jwt`, `/.well-known/upcomputer/environment`). v2 does not.

What is ours:

| What                            | Value                                                                         |
| ------------------------------- | ----------------------------------------------------------------------------- |
| Product name in the UI and CLI  | UpComputer Connect                                                            |
| Push and Live Activity title    | `Up.computer`                                                                 |
| Desktop renderer origins        | `upcomputer://app`, `upcomputer-dev://app`                                    |
| macOS bundle ID (passkeys)      | `computer.up.upcomputer`                                                      |
| Clerk JWT template and audience | `upcomputer-relay` (our choice; upstream uses `t3-relay` and `t3-code-relay`) |
| API and tunnel zones            | `<api-zone>`, `<tunnel-zone>`                                                 |
| Hosted app URL                  | `https://up.computer` (`DEFAULT_HOSTED_APP_URL`)                              |

## 0. Decide names first

Write these down before creating accounts. Several of them are baked into deployed resources.

| Decision                    | Value used in this doc         | Notes                                                                                              |
| --------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------- |
| API zone                    | `<api-zone>`                   | The relay is served at `https://relay.<api-zone>` for the `prod` stage.                            |
| Tunnel zone                 | `<tunnel-zone>`                | Each linked environment gets a hostname below it. Use a separate registrable domain.               |
| Clerk JWT template name     | `upcomputer-relay`             | Clients request Clerk tokens from this template.                                                   |
| Clerk JWT audience (`aud`)  | `upcomputer-relay`             | The relay rejects Clerk tokens with any other audience.                                            |
| iOS bundle ID               | `<ios-bundle-id>`              | Also the APNs topic.                                                                               |
| PlanetScale region and size | `us-west`, `PS_20`, 2 replicas | Set in `infra/relay/src/db.ts` upstream. Changing it is a local edit that future merges must keep. |

Use a tunnel zone that serves nothing else. Tunnel hostnames route to code running on users'
machines, so they must not share cookies or an origin with the API zone, the website or Clerk.

## 1. Accounts

Create the Cloudflare (Workers Paid), PlanetScale (Postgres), Axiom and Clerk production accounts
as the [relay README](../../infra/relay/README.md#deployment) describes. Up.computer specifics:

- **Clerk JWT template**: name `upcomputer-relay`, claims `{ "aud": "upcomputer-relay" }`.
- **Clerk desktop redirects**: add `upcomputer://app/` and `upcomputer-dev://app/` to the SSO
  redirect allowlist, and `upcomputer://app` (production) to the Backend API `allowed_origins`.
  Preserve existing entries.
- **Clerk CLI OAuth application**: as upstream describes. The release workflow requires its client ID,
  and the desktop backend enables Connect only when it is set.
- **Desktop passkeys** (optional): an explicit macOS App ID `computer.up.upcomputer` with Associated
  Domains, a provisioning profile for it, and the same Team ID and bundle ID under Clerk's Native API
  settings. Without the profile, release builds are signed as V1 was and passkeys stay off.
- **APNs** can wait for an iOS app. The relay needs APNs values unless `APNS_ENABLED=false`.

## 2. GitHub configuration

Both workflows run in the `production` GitHub environment. The deploy and release jobs start only
when `RELAY_API_ZONE_NAME` or `RELAY_DOMAIN` is set, and a job-level condition cannot read
environment-scoped variables. Set that switch as a **repository** variable, and set it last.

| Name                        | Kind                          | Read by                           | Value                               |
| --------------------------- | ----------------------------- | --------------------------------- | ----------------------------------- |
| `RELAY_API_ZONE_NAME`       | Repository variable           | `deploy-relay.yml`, `release.yml` | `<api-zone>`                        |
| `RELAY_DOMAIN`              | Repository variable, optional | `deploy-relay.yml`, `release.yml` | Only to override `relay.<api-zone>` |
| `RELAY_TUNNEL_ZONE_NAME`    | `production` variable         | `deploy-relay.yml`                | `<tunnel-zone>`                     |
| `RELAY_TUNNEL_CLEANUP_MODE` | `production` variable         | `deploy-relay.yml`                | `off`, `dry-run` or `enabled`       |
| `CLOUDFLARE_ACCOUNT_ID`     | `production` variable         | `deploy-relay.yml`, `release.yml` | Cloudflare account ID               |
| `PLANETSCALE_ORGANIZATION`  | `production` variable         | `deploy-relay.yml`                | PlanetScale organization            |
| `AXIOM_ORG_ID`              | `production` variable         | `deploy-relay.yml`                | Axiom organization ID               |
| `CLERK_PUBLISHABLE_KEY`     | `production` variable         | `deploy-relay.yml`, `release.yml` | `pk_live_...`                       |
| `CLERK_JWT_AUDIENCE`        | `production` variable         | `deploy-relay.yml`                | `upcomputer-relay`                  |
| `CLERK_JWT_TEMPLATE`        | `production` variable         | `release.yml`                     | `upcomputer-relay`                  |
| `CLERK_CLI_OAUTH_CLIENT_ID` | `production` variable         | `release.yml`                     | Clerk OAuth application client ID   |
| `APNS_*`                    | `production` variables        | `deploy-relay.yml`                | See the relay README                |
| `CLOUDFLARE_API_TOKEN`      | `production` secret           | `deploy-relay.yml`, `release.yml` | Deploy token                        |
| `PLANETSCALE_API_TOKEN_ID`  | `production` secret           | `deploy-relay.yml`                | Service token ID                    |
| `PLANETSCALE_API_TOKEN`     | `production` secret           | `deploy-relay.yml`                | Service token value                 |
| `AXIOM_TOKEN`               | `production` secret           | `deploy-relay.yml`                | Axiom personal access token         |
| `CLERK_SECRET_KEY`          | `production` secret           | `deploy-relay.yml`                | `sk_live_...`                       |
| `APNS_PRIVATE_KEY`          | `production` secret           | `deploy-relay.yml`                | Full `.p8` text                     |
| `FCM_SERVICE_ACCOUNT`       | `production` secret, optional | `deploy-relay.yml`                | Firebase service account JSON       |

`deploy-relay.yml` deploys the Alchemy `prod` stage on every push to `main` once the switch is set,
on GitHub-hosted runners. `release.yml` reads the relay's public client config and the client
tracing token from the deployed stack state, so deploy the relay before the first release with
Connect.

## 3. Build-time public config

These values are public identifiers, not secrets. Release builds inject them; source builds read
them from the process environment, then the repository-root `.env.local`, then `.env` (see
`.env.example`). Each name also works with an `UPCOMPUTER_` prefix instead of `T3CODE_`.

| Name                                      | Used by                   | Value                       |
| ----------------------------------------- | ------------------------- | --------------------------- |
| `T3CODE_RELAY_URL`                        | Desktop backend, CLI, web | `https://relay.<api-zone>`  |
| `T3CODE_CLERK_PUBLISHABLE_KEY`            | Desktop backend, CLI, web | `pk_live_...`               |
| `T3CODE_CLERK_JWT_TEMPLATE`               | Web and desktop renderer  | `upcomputer-relay`          |
| `T3CODE_CLERK_CLI_OAUTH_CLIENT_ID`        | Desktop backend, CLI      | Clerk OAuth client ID       |
| `T3CODE_RELAY_CLIENT_OTLP_TRACES_URL`     | Optional, client tracing  | From the relay stack output |
| `T3CODE_RELAY_CLIENT_OTLP_TRACES_DATASET` | Optional, client tracing  | From the relay stack output |
| `T3CODE_RELAY_CLIENT_OTLP_TRACES_TOKEN`   | Optional, client tracing  | From the relay stack output |

The web UI shows Connect only when the relay URL, publishable key and JWT template are all set. The
desktop backend and CLI enable it only when the relay URL, publishable key and CLI OAuth client ID
are all set. A local `vp run --filter t3code-relay deploy` writes the relay URL back to the
repository-root `.env`.

## 4. First deploy

1. Create the accounts and tokens in section 1.
2. Set every value in section 2 except the switch (`RELAY_API_ZONE_NAME`).
3. Optional dry run from a trusted machine: copy `infra/relay/.env.example` to `infra/relay/.env`,
   set our values (JWT audience `upcomputer-relay`), and run
   `vp run --filter t3code-relay deploy -- --stage prod --dry-run`.
4. Set `RELAY_API_ZONE_NAME` as a repository variable and push to `main` (or re-run the workflow).
   Watch **Deploy UpComputer Connect relay**.
5. Verify: `curl -fsS https://relay.<api-zone>/health` succeeds, the commit has the status
   **Relay deploy / production**, and requests appear in the Axiom view
   `t3-code-relay-recent-spans-prod`.
6. Build the desktop app with the public config from section 3 (or run a Core release), sign in,
   and enable Connect under **Settings** > **Connections**. A second signed-in device should
   connect to the environment through a hostname under `<tunnel-zone>`.

## 5. Privacy

- **Remote traffic crosses Cloudflare.** TLS ends at Cloudflare's edge, so chats, terminal output
  and files sent to a remote device pass through Cloudflare. The relay does not carry this traffic.
- **The relay stores account and link data**: Clerk user IDs, environment IDs and labels,
  environment public keys, hashed environment credentials, endpoint hostnames, and registered
  devices (labels, OS version, push tokens).
- **Agent activity notifications send thread titles** when the user turns on agent activity
  publishing (off by default). The relay forwards them to Apple or Google for push notifications.
- **Traces**: relay request spans in Axiom include request paths and user IDs.

## 6. What an iOS client needs

Upstream's iOS client speaks the same protocol. It needs our relay URL, Clerk publishable key and
JWT template `upcomputer-relay`, registration under Clerk **Native applications**, and an APNs
bundle ID equal to `APNS_BUNDLE_ID`.
