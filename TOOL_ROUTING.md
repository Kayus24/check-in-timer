# Check-in Timer Runtime Routing

Shared dispatcher: `Kayus24/vibe-shared-knowledge/tool-routing/BASELINE.md`.

## Runtime dispatch
- **ChatGPT:** read `CHATGPT_TOOL_ROUTING.md`.
- **Codex:** read `CODEX_TOOL_ROUTING.md`.

Never apply ChatGPT plugin priorities to Codex.

## Source of truth
1. Current repository source.
2. AppDeploy v77 / 1789060544305 as migration baseline.
3. Existing functional/visual tests as acceptance evidence.

## Gates
- Preserve the AppDeploy v77 behavioral baseline unless the task explicitly changes behavior.
- Run build, smoke, functional and visual gates appropriate to the touched area.

## Directory routing
- `src/**`: editable application source.
- `tests/**`: functional/visual regression evidence.
- `public/**`: static runtime assets.
- `dist/**`: generated output; never patch basis.
- Root config: build/toolchain only when required.
