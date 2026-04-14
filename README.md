# Personal portfolio

Completely static website with static content. No backend required.

Live at [nautilusit.nl](https://nautilusit.nl).

## Run the app locally

Open <http://127.0.0.1:3000/index.html>

## Architecture

```
User → Cloudflare (CDN + SSL + cache) → Worker (Host rewrite) → Azure Blob Storage ($web)
```

- **Hosting**: Azure Blob Storage static website (`stnautilusitprod`, container `$web`)
- **CDN & SSL**: Cloudflare (free tier) — caching, HTTPS, DDoS protection
- **Host header rewrite**: A Cloudflare Worker (`nautilusit-proxy`) rewrites the Host header to `stnautilusitprod.z6.web.core.windows.net` so Azure Blob Storage routes the request to the correct storage account
- **DNS**: Managed by Cloudflare (domain registered at Porkbun)
- **CI/CD**: GitHub Actions — see [`.github/workflows/deploy.yaml`](.github/workflows/deploy.yaml)

## Deployment

Pushes to `main` automatically deploy via GitHub Actions:

1. Upload files to Azure Blob Storage `$web` container
2. Purge Cloudflare cache so changes are served immediately

### Required GitHub secrets

| Secret | Purpose |
|---|---|
| `AZURE_CREDENTIALS` | Service principal for uploading to Azure Blob Storage |
| `CLOUDFLARE_ZONE_ID` | Cloudflare zone ID for `nautilusit.nl` |
| `CLOUDFLARE_API_TOKEN` | Scoped token with `Zone:Cache Purge` permission |

## Updating pinned CDN assets

External scripts in `index.html` are pinned to a specific version with Subresource Integrity (SRI) hashes. If you bump a version you must regenerate the hash, otherwise the browser will refuse to execute the script.

```bash
curl -sL <cdn-url> | openssl dgst -sha384 -binary | openssl base64 -A
```

Prefix the output with `sha384-` in the `integrity` attribute. `marked` is pinned to v4 on purpose — v5 removed the `highlight` option used by `assets/js/script.js`.

## TODO

* Projects — replace placeholder Bluelabel card with real screenshots once available.
* About:Services — replace SVG icons with ones that match each service.
* Migrate `deploy.yaml` from `AZURE_CREDENTIALS` secret to OIDC federated credentials (see inline TODO comment in the workflow).
