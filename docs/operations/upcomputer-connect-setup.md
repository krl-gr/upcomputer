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
| Relay stack and resource names    | `T3CodeRelay`, `t3-code-relay-*` (database excepted)   |
| Build and runtime variable names  | `T3CODE_*` (`UPCOMPUTER_*` aliases also work)          |

V1 renamed these (`upcomputer-*+jwt`, `/.well-known/upcomputer/environment`). v2 does not.

What is ours:

| What                            | Value                                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Product name in the UI and CLI  | UpComputer Connect                                                                                     |
| Push and Live Activity title    | `Up.computer`                                                                                          |
| Desktop renderer origins        | `upcomputer://app`, `upcomputer-dev://app`                                                             |
| macOS bundle ID (passkeys)      | `computer.up.upcomputer`                                                                               |
| Clerk JWT template and audience | `t3-relay` template, `t3-code-relay` audience (same as upstream; already set up in our Clerk instance) |
| API and tunnel zones            | `up.computer` (relay at `relay.up.computer`), `upconnect.dev`                                          |
| Hosted app URL                  | `https://up.computer` (`DEFAULT_HOSTED_APP_URL`)                                                       |

## 0. Decide names first

Write these down before creating accounts. Several of them are baked into deployed resources.

| Decision                   | Value used in this doc    | Notes                                                                                        |
| -------------------------- | ------------------------- | -------------------------------------------------------------------------------------------- |
| API zone                   | `up.computer`             | The relay is served at `https://relay.up.computer` for the `prod` stage.                     |
| Tunnel zone                | `upconnect.dev`           | Each linked environment gets a hostname below it. Use a separate registrable domain.         |
| Clerk JWT template name    | `t3-relay`                | Clients request Clerk tokens from this template.                                             |
| Clerk JWT audience (`aud`) | `t3-code-relay`           | The relay rejects Clerk tokens with any other audience.                                      |
| iOS bundle ID              | `<ios-bundle-id>`         | Also the APNs topic.                                                                         |
| PlanetScale database       | `upcomputerrelay`, `PS_5` | One ARM node in `eu-central` (Frankfurt), $5/month. A local edit to `infra/relay/src/db.ts`. |

Use a tunnel zone that serves nothing else. Tunnel hostnames route to code running on users'
machines, so they must not share cookies or an origin with the API zone, the website or Clerk.

## 1. Accounts

Create the Cloudflare, PlanetScale (Postgres), Axiom and Clerk production accounts as the
[relay README](../../infra/relay/README.md#deployment) describes. Up.computer specifics:

- **Cloudflare**: account `b823638a401eee95b6263c88ca5b5572` with both zones. The relay starts on
  Workers Free; switch to Workers Paid if the Worker hits CPU limit errors (1102).
- **PlanetScale**: organization `gurianovks`. The first deploy creates the database.
- **Clerk JWT template**: name `t3-relay`, claims `{ "aud": "t3-code-relay" }`.
- **Clerk desktop redirects**: add `upcomputer://app/` and `upcomputer-dev://app/` to the SSO
  redirect allowlist, and `upcomputer://app` (production) to the Backend API `allowed_origins`.
  Preserve existing entries.
- **Clerk CLI OAuth application**: as upstream describes. The release workflow requires its client ID,
  and the desktop backend enables Connect only when it is set.
- **Desktop passkeys** (optional): an explicit macOS App ID `computer.up.upcomputer` with Associated
  Domains, a provisioning profile for it, and the same Team ID and bundle ID under Clerk's Native API
  settings. Without the profile, release builds are signed as V1 was and passkeys stay off.
- **APNs** can wait for an iOS app. The relay sends no APNs and needs no Apple values until
  `APNS_ENABLED=true`.
- **Web push** needs no account, only a VAPID key pair. See [section 7](#7-web-push).

## 2. GitHub configuration

Both workflows run in the `production` GitHub environment. The deploy and release jobs start only
when `RELAY_API_ZONE_NAME` or `RELAY_DOMAIN` is set, and a job-level condition cannot read
environment-scoped variables. Set that switch as a **repository** variable, and set it last.

| Name                         | Kind                          | Read by                           | Value                                |
| ---------------------------- | ----------------------------- | --------------------------------- | ------------------------------------ |
| `RELAY_API_ZONE_NAME`        | Repository variable           | `deploy-relay.yml`, `release.yml` | `up.computer`                        |
| `RELAY_DOMAIN`               | Repository variable, optional | `deploy-relay.yml`, `release.yml` | Only to override `relay.up.computer` |
| `RELAY_TUNNEL_ZONE_NAME`     | `production` variable         | `deploy-relay.yml`                | `upconnect.dev`                      |
| `RELAY_TUNNEL_CLEANUP_MODE`  | `production` variable         | `deploy-relay.yml`                | `off`, `dry-run` or `enabled`        |
| `CLOUDFLARE_ACCOUNT_ID`      | `production` variable         | `deploy-relay.yml`, `release.yml` | `b823638a401eee95b6263c88ca5b5572`   |
| `PLANETSCALE_ORGANIZATION`   | `production` variable         | `deploy-relay.yml`                | `gurianovks`                         |
| `AXIOM_ORG_ID`               | `production` variable         | `deploy-relay.yml`                | Axiom organization ID                |
| `CLERK_PUBLISHABLE_KEY`      | `production` variable         | `deploy-relay.yml`, `release.yml` | `pk_live_...`                        |
| `CLERK_JWT_AUDIENCE`         | `production` variable         | `deploy-relay.yml`                | `t3-code-relay`                      |
| `CLERK_JWT_TEMPLATE`         | `production` variable         | `release.yml`                     | `t3-relay`                           |
| `CLERK_CLI_OAUTH_CLIENT_ID`  | `production` variable         | `release.yml`                     | Clerk OAuth application client ID    |
| `APNS_ENABLED`               | `production` variable, later  | `deploy-relay.yml`                | `true` once APNs keys exist          |
| `APNS_*`                     | `production` variables, later | `deploy-relay.yml`                | Only with `APNS_ENABLED=true`        |
| `WEB_PUSH_ENABLED`           | `production` variable, later  | `deploy-relay.yml`, `release.yml` | `true` once the VAPID keys are set   |
| `WEB_PUSH_VAPID_PUBLIC_KEY`  | `production` variable, later  | `deploy-relay.yml`, `release.yml` | See [section 7](#7-web-push)         |
| `WEB_PUSH_SUBJECT`           | `production` variable, later  | `deploy-relay.yml`                | `mailto:` or `https:` contact        |
| `CLOUDFLARE_API_TOKEN`       | `production` secret           | `deploy-relay.yml`, `release.yml` | Deploy token                         |
| `PLANETSCALE_API_TOKEN_ID`   | `production` secret           | `deploy-relay.yml`                | Service token ID                     |
| `PLANETSCALE_API_TOKEN`      | `production` secret           | `deploy-relay.yml`                | Service token value                  |
| `AXIOM_TOKEN`                | `production` secret           | `deploy-relay.yml`                | Axiom personal access token          |
| `CLERK_SECRET_KEY`           | `production` secret           | `deploy-relay.yml`                | `sk_live_...`                        |
| `APNS_PRIVATE_KEY`           | `production` secret, later    | `deploy-relay.yml`                | Full `.p8` text                      |
| `WEB_PUSH_VAPID_PRIVATE_KEY` | `production` secret, later    | `deploy-relay.yml`                | See [section 7](#7-web-push)         |
| `FCM_SERVICE_ACCOUNT`        | `production` secret, optional | `deploy-relay.yml`                | Firebase service account JSON        |

`deploy-relay.yml` deploys the Alchemy `prod` stage on every push to `main` of `krl-gr/upcomputer`
once the switch is set, on GitHub-hosted runners. `release.yml` reads the relay's public client
config and the client tracing token from the deployed stack state, so deploy the relay before the
first release with Connect.

## 3. Build-time public config

These values are public identifiers, not secrets. Release builds inject them; source builds read
them from the process environment, then the repository-root `.env.local`, then `.env` (see
`.env.example`). Each name also works with an `UPCOMPUTER_` prefix instead of `T3CODE_`.

| Name                                      | Used by                   | Value                       |
| ----------------------------------------- | ------------------------- | --------------------------- |
| `T3CODE_RELAY_URL`                        | Desktop backend, CLI, web | `https://relay.up.computer` |
| `T3CODE_CLERK_PUBLISHABLE_KEY`            | Desktop backend, CLI, web | `pk_live_...`               |
| `T3CODE_CLERK_JWT_TEMPLATE`               | Web and desktop renderer  | `t3-relay`                  |
| `T3CODE_CLERK_CLI_OAUTH_CLIENT_ID`        | Desktop backend, CLI      | Clerk OAuth client ID       |
| `T3CODE_RELAY_CLIENT_OTLP_TRACES_URL`     | Optional, client tracing  | From the relay stack output |
| `T3CODE_RELAY_CLIENT_OTLP_TRACES_DATASET` | Optional, client tracing  | From the relay stack output |
| `T3CODE_RELAY_CLIENT_OTLP_TRACES_TOKEN`   | Optional, client tracing  | From the relay stack output |
| `T3CODE_WEB_PUSH_VAPID_PUBLIC_KEY`        | Optional, web push        | `WEB_PUSH_VAPID_PUBLIC_KEY` |

The web UI shows Connect only when the relay URL, publishable key and JWT template are all set. The
desktop backend and CLI enable it only when the relay URL, publishable key and CLI OAuth client ID
are all set. A local `vp run --filter t3code-relay deploy` writes the relay URL back to the
repository-root `.env`.

## 4. First deploy

1. Create the accounts and tokens in section 1.
2. Set every value in section 2 except the switch (`RELAY_API_ZONE_NAME`).
3. Optional dry run from a trusted machine: copy `infra/relay/.env.example` to `infra/relay/.env`,
   set our values (JWT audience `t3-code-relay`), and run
   `vp run --filter t3code-relay deploy -- --stage prod --dry-run`.
4. Set `RELAY_API_ZONE_NAME` as a repository variable and push to `main` (or re-run the workflow).
   Watch **Deploy UpComputer Connect relay**.
5. Verify: `curl -fsS https://relay.up.computer/health` succeeds, the commit has the status
   **Relay deploy / production**, and requests appear in the Axiom view
   `t3-code-relay-recent-spans-prod`.
6. Build the desktop app with the public config from section 3 (or run a Core release), sign in,
   and enable Connect under **Settings** > **Connections**. A second signed-in device should
   connect to the environment through a hostname under `upconnect.dev`.

## 5. Privacy

- **Remote traffic crosses Cloudflare.** TLS ends at Cloudflare's edge, so chats, terminal output
  and files sent to a remote device pass through Cloudflare. The relay does not carry this traffic.
- **The relay stores account and link data**: Clerk user IDs, environment IDs and labels,
  environment public keys, hashed environment credentials, endpoint hostnames, and registered
  devices (labels, OS version, push tokens).
- **Agent activity notifications send thread titles** when the user turns on agent activity
  publishing (off by default). The relay forwards them to Apple or Google for push notifications.
  Web push payloads are encrypted for the receiving browser, so its push service (Apple, Google or
  Mozilla) sees only the endpoint and timing.
- **Traces**: relay request spans in Axiom include request paths and user IDs.

## 6. What an iOS client needs

Upstream's iOS client speaks the same protocol. It needs our relay URL, Clerk publishable key and
JWT template `t3-relay`, registration under Clerk **Native applications**, and an APNs
bundle ID equal to `APNS_BUNDLE_ID`.

## 7. Web push

Web push delivers the same agent alerts to the web app while it is closed: desktop browsers,
Android Chrome, and on iPhone or iPad (iOS 16.4 or newer) the web app added to the Home Screen. It
is off until `WEB_PUSH_ENABLED=true`; while off the relay reads no `WEB_PUSH_*` value and release
builds carry no web push key, so the web app shows no option for it.

1. Generate a key pair once: `vp run --filter t3code-relay web-push:vapid-keys`. It prints
   `WEB_PUSH_VAPID_PUBLIC_KEY` and `WEB_PUSH_VAPID_PRIVATE_KEY`. Keep the private key out of chats
   and files.
2. In the `production` environment set the variables `WEB_PUSH_VAPID_PUBLIC_KEY` and
   `WEB_PUSH_SUBJECT` (for example `mailto:` plus a monitored address), and the secret
   `WEB_PUSH_VAPID_PRIVATE_KEY`.
3. Set the `production` variable `WEB_PUSH_ENABLED=true` and redeploy the relay (run **Deploy
   UpComputer Connect relay** from `main`). A wrong key or subject fails the deploy with the variable
   name; the private key value is never printed.
4. Run a release. `release.yml` passes the public key into the desktop and hosted web builds as
   `T3CODE_WEB_PUSH_VAPID_PUBLIC_KEY` only while `WEB_PUSH_ENABLED=true`.

Keep the key pair. Replacing it invalidates every browser subscription: each device has to turn
notifications on again. To stop web push, set `WEB_PUSH_ENABLED=false`, redeploy the relay, and
release, so the web app stops offering it.

After the relay and the hosted app are live, check by hand:

- **iPhone**: open the hosted app in Safari. **Settings** > **General** asks to add it to the Home
  Screen. Add it, open it from the icon, sign in to Connect, choose **Enable on this device** and
  allow notifications. Lock the phone and let an agent finish or ask for input: the alert appears
  and tapping it opens the thread.
- **Desktop browser**: enable it the same way in Chrome or Firefox, close the tab, and trigger an
  alert. Clicking it opens the thread; with the app open in a tab, it routes that tab instead.
- **Turn off and sign out**: **Turn off on this device** stops alerts on that device only, and
  signing out of Connect turns it off there too.
- **Relay**: the Axiom view shows `relay.web_push.send` spans. A device whose subscription expired
  disappears after the push service answers 404 or 410.
