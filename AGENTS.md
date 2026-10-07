# AGENTS.md

- Read `README.md` and `TOOL_ROUTING.md` before substantial work.
- Codex -> `CODEX_TOOL_ROUTING.md`; ChatGPT -> `CHATGPT_TOOL_ROUTING.md`.
- Never mix runtime hierarchies.
- Preserve the AppDeploy v77 behavioral baseline unless the task explicitly changes behavior.
- Patch source in `src/**`, never generated `dist/**`.
- Run the smallest relevant local gate, then the broader regression gate required by the touched area.
