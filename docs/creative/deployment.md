# Creative deployment

Batch Relay Creative is packaged as a self-hosted Next.js Node service. The
production image uses Next's `standalone` output and runs the traced server on
Node 24. The image contains the application and public assets only; the
Livepeer participant endpoint, credentials, access passcode, and session
signing secret are supplied at runtime.

## Deployment shape

Run one long-lived container with one durable filesystem volume mounted at
`/data/creative`. The creative provider journal is written to
`/data/creative/journal.json` through `LIVEPEER_JOURNAL_PATH`. It records
estimate bindings, idempotency keys, jobs, and budget reservations, so an
instance restart does not turn an in-flight reservation into an unknown
second spend. The journal writer uses a process-safe lock and atomic replace;
the volume must therefore be writable by the server user and must not be an
ephemeral container filesystem.

The checked-in `compose.creative.yaml` initializes a newly-created named
volume as root, fixes its ownership to the image's `node` user, and then
starts the server as `node`. This is why the compose service declares a root
entrypoint while the actual Next process remains unprivileged.

This is intentionally a single-instance deployment contract. Stateless or
multi-instance hosting is unsupported while the journal uses a local file. An
ephemeral filesystem can lose reservations on restart; separate instances can
race or diverge even though each process has a local lock. Add a shared,
durable adapter with equivalent atomic locking and idempotency semantics before
using that topology. Production code fails closed when
`LIVEPEER_JOURNAL_PATH` is missing or not absolute.

## Runtime configuration

Provide these values through the host's secret/environment manager or an
untracked local env file. Do not put them in the repository, `NEXT_PUBLIC_*`
variables, a Dockerfile `ARG`, or a browser payload.

| Variable | Required | Purpose |
| --- | --- | --- |
| `LIVEPEER_MCP_URL` | yes | HTTPS Creative MCP endpoint used by server routes |
| `LIVEPEER_API_KEY` | provider-dependent | Optional bearer credential, server-side only |
| `LIVEPEER_IMAGE_HOSTS` | no | Comma-separated HTTPS hosts allowed for stored provider images; defaults to `v3b.fal.media` |
| `LIVEPEER_SESSION_SECRET` | yes | HMAC key for the HTTP-only creative session cookie |
| `LIVEPEER_CREATIVE_PASSCODE` | yes | Explicit passcode gate for authorized creative access |
| `LIVEPEER_CREATIVE_BUDGET_USD` | no | App budget cap; defaults to `$20` and cannot exceed it |
| `LIVEPEER_JOURNAL_PATH` | set by image | `/data/creative/journal.json`; keep this on the durable volume |
| `CREATIVE_PORT` | no | Host port; defaults to `3000` in Compose |

`LIVEPEER_MCP_URL` must be supplied by the deployment operator. The participant
endpoint and any access details are deliberately absent from tracked files.
`LIVEPEER_API_KEY` may be empty only when the configured MCP endpoint does not
require bearer authentication. The provider's current image result can
redirect away from the MCP endpoint, so keep `v3b.fal.media` in the allowlist
unless the provider gives you a different documented HTTPS result host. The
image proxy rejects other hosts and private-network addresses.

The existing storefront may also use its own `BATCH_RELAY_*` server settings;
provide those separately if the storefront routes are enabled. They are not
used as a substitute for the Creative MCP credentials.

## Build and run with Compose

Create an untracked env file in the repository directory (or use the host's
secret manager) containing the required runtime values, then run:

```sh
docker compose --env-file .env.creative.local -f compose.creative.yaml up --build -d
```

The file is ignored by the repository's `.gitignore` when named
`.env.creative.local`. It should contain variable assignments only, for
example the names listed above, and must never be added to source control.

Inspect the resolved configuration without printing secret values by reviewing
the deployment platform's redacted environment view. The service listens on
the host port chosen by `CREATIVE_PORT`; its container port remains `3000`.

After startup, open `/creative` and use the passcode gate. A read-only status
request is available at `/api/creative/status` once the creative API routes are
present. A status response showing provider configuration does not authorize a
render: every generation still needs a fresh estimate and visible approval.

## Updates, recovery, and backups

```sh
docker compose --env-file .env.creative.local -f compose.creative.yaml pull
docker compose --env-file .env.creative.local -f compose.creative.yaml up --build -d
```

`docker compose down` removes the container but keeps the named
`creative-journal` volume. Do not use `docker compose down -v` during routine
updates; that deletes the journal and loses reservation/idempotency history.
Back up the volume using the hosting platform's encrypted volume backup before
upgrades or migration. The journal contains provider job metadata and should
be treated as sensitive operational data.

If a job is pending after a restart, check the existing job through the
server's polling route before retrying. Never resubmit merely because a client
timed out. Unknown provider cost remains reserved until the server reconciles
the provider result; an application restart does not reset the budget.

## Verification limits

The Docker packaging can be inspected with:

```sh
docker compose --env-file .env.creative.local -f compose.creative.yaml config
docker build --check -t batch-relay-creative:local .
```

The first command validates Compose interpolation and the second checks the
Dockerfile syntax (where supported by the installed Docker version). A real
`docker compose up --build` also requires access to the private participant
endpoint and valid runtime credentials. A successful image build proves only
that Docker created the image; it does not prove container startup, provider
authentication, generation, output retention, or a completed external job.
