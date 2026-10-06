# Check-in Timer Tool Routing

Inherit: `Kayus24/vibe-shared-knowledge/tool-routing/BASELINE.md`.

## Source of truth
1. Current repository source
2. AppDeploy v77 / 1789060544305 as the migration baseline
3. Existing functional/visual test suites as acceptance evidence

## Preferred hierarchy
- Repo/CI: **GitHub**
- Local build and test battery: **Remote Desktop Commander**
- Persistent bug isolation: **Superpowers -> existing tests -> Context7 -> Stack Overflow edge cases**
- Visual/UI comparison: existing visual tests first; **Figma** for redesign proposals
- AppDeploy: reference/deployment source only where the migration contract requires it
- Public external web/browser tools are not a normal first choice

## Gates
- Preserve the AppDeploy v77 behavioral baseline unless the task explicitly changes behavior.
- Run build, smoke, functional and visual gates appropriate to the touched area.
