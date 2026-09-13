# Astro compat check

One headless-Chrome run (25 checks: toolbar app, entry + schema and hints, render endpoint, save round trip and reload swallow, rejected save, embeds, MDX islands) against the demo on a given Astro version.

```sh
PLAYWRIGHT=/path/to/node_modules/playwright/index.mjs   # or install playwright and leave unset
scripts/compat/switch.sh 7.3.2 8.0.1     # pin demo to astro 7.3.2 + @astrojs/mdx 8.0.1 and reinstall
scripts/compat/run.sh 4367 astro7        # warm Vite cache
COLD=1 scripts/compat/run.sh 4367 astro7-cold
scripts/compat/restore.sh                # back to the committed versions
```

Pairs known to pass: 5.18.2 + mdx 4.3.14, 6.4.8 + mdx 6.0.3, 7.3.2 + mdx 8.0.1. Output (screenshots, dev logs) lands in `scripts/compat/out/` (ignored).
