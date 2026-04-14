# Hosting a static site on Azure Blob Storage behind Cloudflare with a Host-header Worker

Azure Blob Storage has a "static website" feature that serves a `$web` container over HTTPS at a URL like `stnautilusitprod.z6.web.core.windows.net`. That works — until you want to serve it on your own domain with a free TLS certificate. Azure's own answer is Front Door or Static Web Apps; both fit a lot of use cases, but for a single-page portfolio that costs nothing to run, I landed on **Azure Blob + Cloudflare (free tier) + a tiny Worker that rewrites the `Host` header**.

This post walks through why, how, and when to move off the pattern.

![Architecture: User → Cloudflare → Worker (Host rewrite) → Azure Blob $web](assets/blogs/images/cloudflare-blob-architecture.svg "Static site architecture on Azure Blob behind Cloudflare")

## Why this shape

A "just CDN" setup fails on Blob for one specific reason: the Azure Blob frontend looks at the `Host` header to decide **which storage account** the request is for. If Cloudflare forwards `Host: nautilusit.nl`, the Blob service has no idea which `$web` container to serve and returns a 404. So you need the edge to rewrite the `Host` to `stnautilusitprod.z6.web.core.windows.net` before the request reaches Azure.

The cheapest way to do that in 2026:

| Option | Cost/mo | Notes |
|---|---|---|
| Azure Front Door Standard | ~€30+ | Native Host-override + WAF; overkill for a portfolio |
| Azure Static Web Apps | €0 | Great for new projects but changes the whole pipeline |
| Cloudflare (free) + Worker | €0 | 20 lines of JavaScript; CDN, TLS, DDoS protection included |

> **Note — Azure Front Door (classic) is retiring.** If you're evaluating Front Door, skip the classic SKU entirely: Microsoft has [announced retirement on 31 March 2027](https://learn.microsoft.com/en-us/azure/frontdoor/classic-retirement-faq), new classic profiles can't be created as of 1 April 2025, and managed certificates on classic stopped being issued on 15 August 2025. Use [Azure Front Door Standard or Premium](https://learn.microsoft.com/en-us/azure/frontdoor/tier-migration), or follow the [tier migration guide](https://learn.microsoft.com/en-us/azure/frontdoor/migrate-tier) if you're still on classic.

The Worker route keeps the deploy story on Azure while letting Cloudflare do the edge.

## The Worker

The whole thing is a single request handler. The only work it does is swap the Host header and forward the request:

```js
// nautilusit-proxy
export default {
  async fetch(request) {
    const origin = 'stnautilusitprod.z6.web.core.windows.net';
    const url = new URL(request.url);
    url.hostname = origin;

    const proxied = new Request(url.toString(), request);
    proxied.headers.set('Host', origin);

    return fetch(proxied);
  }
};
```

Wire it up via a Cloudflare Route (`nautilusit.nl/*` → `nautilusit-proxy`) and every request to the custom domain gets proxied with the correct `Host`.

A couple of details worth knowing:

- The `.z6.` in the hostname is the **region indicator** — storage accounts get one depending on where they live. Use the exact hostname Azure shows on the *Static website* blade; don't hand-build it.
- The Worker receives `url` with Cloudflare's own hostname; setting `url.hostname` + re-setting the `Host` header is belt-and-braces but cheap.
- Cloudflare's free tier allows 100k Worker requests/day. Static sites rarely come close.

## Cache strategy

I let Cloudflare do almost all the caching:

```text
Cache-Control: max-age=14400   (4h at the edge, set by Cloudflare page rules)
```

…and then purge the whole zone cache on every deploy, so a push to `main` is visible immediately:

```yaml
# .github/workflows/deploy.yaml
- name: Purge Cloudflare cache
  run: |
    curl -s -X POST "https://api.cloudflare.com/client/v4/zones/${{ secrets.CLOUDFLARE_ZONE_ID }}/purge_cache" \
      -H "Authorization: Bearer ${{ secrets.CLOUDFLARE_API_TOKEN }}" \
      -H "Content-Type: application/json" \
      --data '{"purge_everything":true}' \
      --fail
```

The first request after a deploy returns `CF-Cache-Status: MISS`; every one after that is `HIT` until the next deploy. Verifying a deploy is as simple as:

```bash
curl -sI https://nautilusit.nl | grep -E 'CF-Cache-Status|Last-Modified'
```

## The deploy in full

The Azure side is equally boring — upload the site contents to `$web`:

```yaml
- uses: azure/login@v2
  with:
    creds: ${{ secrets.AZURE_CREDENTIALS }}

- name: Upload to blob storage
  uses: azure/CLI@v2
  with:
    inlineScript: |
      az storage blob upload-batch \
        --account-name stnautilusitprod \
        --auth-mode key \
        -d '$web' \
        -s . \
        --overwrite true
```

Two things on the to-do list here:

1. Move `azure/login` to **OIDC federated credentials** so the long-lived `AZURE_CREDENTIALS` secret goes away (separate post).
2. Flip `--auth-mode key` to `--auth-mode login` afterwards, and disable shared-key access on the storage account — no secrets, no static keys.

## What it costs

At low traffic, the whole thing is effectively free:

- Azure Blob Storage (GPv2, LRS, West Europe): €0.02/GB·month × a few MB → fractions of a cent
- Cloudflare Free tier: €0
- GitHub Actions: 2000 free minutes/month; this workflow uses ~50s per push
- Domain: registrar cost only (mine is at Porkbun)

## When this is the wrong choice

Honest trade-offs — cases where I'd pick something else:

- **You want preview environments per PR.** Azure Static Web Apps gives you those for free. Blob + Worker does not.
- **You need a WAF.** Cloudflare Free has basic protections but the tuneable WAF is a paid tier; Front Door Standard includes one.
- **Your site has server-side rendering, auth, or APIs.** This pattern is for static content only. Container Apps or Static Web Apps with a linked Functions backend is the better shape.
- **You want HTTP/3 all the way to the origin.** Blob doesn't speak h3; Cloudflare terminates it. Rarely matters for a portfolio.

## Recap

For a static site on a custom domain with a free TLS cert and a CDN:

1. Azure Blob Storage `$web` for hosting.
2. Cloudflare free tier for DNS, TLS, CDN, DDoS.
3. A 10-line Worker that rewrites `Host` so Blob routes correctly.
4. Cloudflare cache purge on deploy so changes land in seconds.

20 lines of JavaScript, €0/month, and the whole architecture fits in a single diagram.
