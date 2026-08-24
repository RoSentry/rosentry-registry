# rosentry-registry

Data-only repo holding a build/version ledger for RoSentry services. No code, no
CI, no tests — just JSON.

> **Status: seeded, not live.** Everything in here is a one-time snapshot taken
> on 2026-05-31. Nothing writes to it and nothing reads from it today. See
> [Current state](#current-state) before trusting any value in these files.

## Files

| File | What it is |
|------|------------|
| `versions.json` | One entry per service: `{ sha, branch, builtAt, repo, image }`, keyed by short service id, plus a top-level `generatedAt` and `schema`. |
| `services.json` | Static map of service id -> `{ repo, image }`, plus a top-level `schema`. |
| `ledger/<service>.jsonl` | One JSON object per line: `{ sha, branch, builtAt, event }`. Intended as append-only build history. |

The design intent is that `versions.json` is a live pointer and `ledger/*.jsonl`
is immutable history.

## Current state

These are the facts as of this commit, each checked against the repos in the
RoSentry org rather than against the previous version of this README.

**Nothing publishes to this repo.** No workflow in any RoSentry repo references
`rosentry-registry`, appends to `ledger/`, or uses a `REGISTRY_TOKEN` secret.
Consistently, all 17 ledger files contain exactly one line each and every one of
those 17 lines is `"event":"seed"` — there is not a single `"event":"deploy"`
anywhere in the ledger.

**Nothing consumes this repo.** The Deployment freshness panel on
status.rosentry.com — the reason this repo was created — was removed from
rosentry-status in commit `0f389f8` ("new brand favicon + remove Deployment
freshness section"). `rosentry-status/src/App.jsx` reads only `VITE_API_URL`;
there is no manifest fetch and no "Up to date / Behind / Unknown" logic left in
it. A stale `VITE_VERSIONS_MANIFEST_URL` line still sits in that repo's
`.env.production` and README, but no code reads it.

**Coverage is 17 of the org's 20 services.** Missing: `db-gateway`, `replays`,
`registry`. `services.json` and `versions.json` agree with each other on all 17
ids, and none of the 17 is a service that no longer exists.

**Most `image` values name an image that is never built.** Only five listed
services have a workflow that builds and pushes to GHCR:

| Registered image | Built by |
|---|---|
| `ghcr.io/rosentry/rosentry-api` | `rosentry-api/.github/workflows/deploy.yml` |
| `ghcr.io/rosentry/rosentry-auth` | `rosentry-auth/.github/workflows/deploy.yml` |
| `ghcr.io/rosentry/rosentry-bot` | `rosentry-bot/.github/workflows/deploy.yml` |
| `ghcr.io/rosentry/rosentry-db` | `rosentry-db/.github/workflows/deploy.yml` |
| `ghcr.io/rosentry/rosentry-proxy` | `rosentry-proxy/.github/workflows/deploy.yml` |

The other twelve — `client`, `dashboard` (registered as
`ghcr.io/rosentry/rosentry-app`), `docs`, `logos`, `schema`, `sdk`, `state`,
`status`, `support`, `ui-tokens`, `vps`, `web` — have no Dockerfile and no
GHCR-pushing workflow. Those ship as Cloudflare Pages sites, npm packages, or
plain asset/data repos. Their `image` fields point at nothing.

`rosentry-db` also builds `ghcr.io/rosentry/rosentry-db-gateway`, which no entry
here records.

**Two entries are unpopulated, and inconsistently so.** `client` and `state`
carry `"sha": null, "builtAt": null` in `versions.json` but `"sha":"",
"builtAt":""` in their ledger lines. Null and empty string should not both mean
"never built".

None of the above has been "fixed" by editing the data, because every fix would
require inventing a value. Deciding what these files should contain — or whether
this repo should exist now that its consumer is gone — is an owner call.

## Proposed publish step (not implemented)

This is the contract the repo was designed around. **No service repo implements
it.** It is kept here as a specification, not as a description of what happens.

The contract is just: append a ledger line and bump the matching `versions.json`
entry.

```yaml
  publish-version:
    needs: [deploy]                 # only after the real deploy succeeds
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          repository: RoSentry/rosentry-registry
          token: ${{ secrets.REGISTRY_TOKEN }}
      - name: Record build
        env:
          SVC: api                  # <-- this service's id (api, dashboard, bot, ...)
          SHA: ${{ github.sha }}
        run: |
          SHORT=$(echo "$SHA" | cut -c1-7)
          NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
          BR=${GITHUB_REF_NAME}
          echo "{\"sha\":\"$SHORT\",\"branch\":\"$BR\",\"builtAt\":\"$NOW\",\"event\":\"deploy\"}" >> "ledger/$SVC.jsonl"
          jq --arg s "$SVC" --arg sha "$SHORT" --arg br "$BR" --arg at "$NOW" \
             '.generatedAt=$at | .services[$s].sha=$sha | .services[$s].branch=$br | .services[$s].builtAt=$at' \
             versions.json > versions.tmp && mv versions.tmp versions.json
          git config user.name  "rosentry-ci"
          git config user.email "ci@rosentry.com"
          git add versions.json "ledger/$SVC.jsonl"
          git commit -m "build($SVC): $SHORT @ $NOW" || echo "no change"
          git push
```

If this is ever wired up, note that `REGISTRY_TOKEN` above is a long-lived PAT.
The org has since moved package publishing off PATs to GitHub OIDC (see
`rosentry-ui-tokens/.github/workflows/publish.yml`); a cross-repo write like this
is a good candidate for the same treatment, or for a GitHub App token minted per
run.

## Conventions

- Short SHAs (7 chars). `builtAt` is UTC ISO-8601.
- `event` is `seed` for the initial import; a real build would write `deploy`.
- The repo is intended to stay public so the ledger is transparent and fetchable
  anonymously.
