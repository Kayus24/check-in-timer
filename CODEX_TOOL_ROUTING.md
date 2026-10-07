# Check-in Timer Codex Tool Routing

Applies only to **Codex**.

Inherit: `Kayus24/vibe-shared-knowledge/tool-routing/CODEX_BASELINE.md`.

## Project-specific hierarchy
1. Use current local repo/worktree, Git state and `src/**` as implementation truth.
2. Preserve the AppDeploy v77 behavior contract unless the task explicitly changes it.
3. Use shell and existing build/test tooling first.
4. Reproduce locally, patch minimally, run the narrowest relevant test, then broader required regression.
5. For actual UI interaction/visual inspection, use **Codex's own browser first** against the local app/dev server.
6. Use Developer Mode/full CDP access when approved for console/network/page-state/rendering diagnostics.
7. Use repository Playwright/visual tests for deterministic regression when present.

## Hard exclusions
- Do not inherit ChatGPT connectors such as Figma, Superpowers or other plugin routing unless separately configured for Codex.
- Do not route ordinary Codex web/UI work to Firecrawl.
