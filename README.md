# rosentry-registry

Public **build / version ledger** for every RoSentry service — the single source of truth for *what is built, from which commit, and when*.

The status page (status.rosentry.com → "Deployment freshness") reads `versions.json` from this repo (raw URL) to show each service's deployed version and whether it's up to date with its repo.

## Files

| File | What it is |
|------|------------|
| `versions.json` | Current latest-built version of every service: `{ sha, branch, builtAt, repo, image }` keyed by short service id (`api`, `dashboard`, `bot`, …). The status page fetches this. |
| `services.json` | Static registry: each service's `repo` + GHCR `image` name (note: the dashboard image is `rosentry-app`). |
| `ledger/<service>.jsonl` | Append-only history — one JSON line per build/deploy: `{ sha, branch, builtAt, event }`. The full audit trail of every version that ever shipped. |

`versions.json` is the **live pointer**; `ledger/*.jsonl` is the **immutable history**. Inspect/restore any past build from the ledger.

## How a service publishes its version (CI step)

Each service repo's deploy workflow, **after a successful build/deploy on `main`**, appends its commit here. Add this job (needs a `REGISTRY_TOKEN` secret = a PAT with `repo` scope on this repo, or a fine-grained token scoped to `rosentry-registry`):

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
          # append to the immutable ledger
          echo "{\"sha\":\"$SHORT\",\"branch\":\"$BR\",\"builtAt\":\"$NOW\",\"event\":\"deploy\"}" >> "ledger/$SVC.jsonl"
          # update the live pointer (jq edits the service's entry in place)
          jq --arg s "$SVC" --arg sha "$SHORT" --arg br "$BR" --arg at "$NOW" \
             '.generatedAt=$at | .services[$s].sha=$sha | .services[$s].branch=$br | .services[$s].builtAt=$at' \
             versions.json > versions.tmp && mv versions.tmp versions.json
          git config user.name  "rosentry-ci"
          git config user.email "ci@rosentry.com"
          git add versions.json "ledger/$SVC.jsonl"
          git commit -m "build($SVC): $SHORT @ $NOW" || echo "no change"
          git push
```

(A `workflow_dispatch` / manual run is fine too — the contract is just "append a ledger line + bump the `versions.json` entry".)

## Status-page wiring

Point the status page at the raw manifest:

```
VITE_VERSIONS_MANIFEST_URL=https://raw.githubusercontent.com/RoSentry/rosentry-registry/main/versions.json
```

The page then compares each service's self-reported `/version` (where available) against this manifest and shows **Up to date / Behind / Unknown**.

## Notes
- Short SHAs (7 chars). `builtAt` is UTC ISO-8601.
- The initial `versions.json` here was **seeded** from each repo's current default-branch HEAD (`event: "seed"` in the ledger). Real builds overwrite with `event: "deploy"`.
- Keep this repo **public** — the status page fetches it anonymously and it's a deliberately transparent build ledger.
