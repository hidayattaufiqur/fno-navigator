# Deploy

The public site at https://fno.hidayattaufiqur.dev is the production **static build**
(adapter-static, `npm run build` -> `build/`), served by nginx from
`/var/lib/nginx/fno` on the smolpanda NixOS box. The vite dev server is
localhost-only (`--host 127.0.0.1`, port 5000) and is NOT the public surface.

## Rebuild + redeploy

On the smolpanda box, from any shell:

    touch ~/.hermes/fno-deploy-trigger

This fires the `fno-deploy.service` systemd oneshot (watched by
`fno-deploy.path`), which runs:

1. `npm run build`
2. `rsync -a --delete build/ /var/lib/nginx/fno/`
3. `chmod -R a+rX /var/lib/nginx/fno`

nginx serves the files directly, so no nginx reload is needed after a deploy.
The unit definitions and the nginx vhost (headers, Cloudflare-only origin
protection, SPA fallback) live in the nix-config repo under
`services/apps/systemd/fno-navigator.nix` and `services/apps/nginx/default.nix`.
