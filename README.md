# Check-in Timer

Migration of AppDeploy v77 (1789060544305) for GitHub Pages.

## Local gates

\`npm run build\` creates the static site in \`dist/\`.

\`npm run test:smoke\` verifies the v77 source inventory, required assets, and 931×2048 reference dimensions.

\`npm run test:functional\` exercises timer persistence, navigation, QR restart, reload/hash/no-active behavior, long-press cancellation, glyph transitions, video, dynamic date, hotspots, and local Service Worker/cache behavior.

\`npm run test:visual\` captures the 931×2048 map/profile masters, calculates SSIM and relevant-pixel diffs, records dynamic-date/hotspot evidence, and runs cross-viewport/DPR checks.

The authoritative source baseline is AppDeploy v77 / \`1789060544305\`. The AppDeploy production URL remains read-only during this migration.

## GitHub Pages

The Vite build uses relative asset URLs so the site works at the Pages subpath \`/check-in-timer/\`. The Pages workflow runs source/build, functional, visual, and PWA gates before deployment.

