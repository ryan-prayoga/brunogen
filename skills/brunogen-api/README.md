# brunogen-api skill

Agent skill for using [brunogen](https://github.com/ryan-prayoga/brunogen) output as the API source of truth.

## Where to publish / install

Use the location that matches how you want the skill to behave:

| Target | Path | Best for |
| --- | --- | --- |
| **Grok user-global** | `~/.grok/skills/brunogen-api/` | Skill available in every project on your machine |
| **Grok project-local** | `<api-repo>/.grok/skills/brunogen-api/` | Skill only for one API codebase |
| **npm package bundled** | `node_modules/brunogen/skills/brunogen-api/` | Source of truth after `npm i -g brunogen` |
| **GitHub repo** | `skills/brunogen-api/` in brunogen | Public distribution and docs |

Recommended default:

1. Keep the canonical skill in the **brunogen GitHub repo** under `skills/brunogen-api/`.
2. Install it globally for Grok with:

```bash
brunogen skill install
```

3. For a specific API repo, copy the project-local variant:

```bash
mkdir -p .grok/skills
cp -R "$(npm root -g)/brunogen/skills/brunogen-api" .grok/skills/brunogen-api
```

## Manual install

```bash
mkdir -p ~/.grok/skills
cp -R skills/brunogen-api ~/.grok/skills/brunogen-api
```

After install, Grok should pick it up automatically within a few seconds.

## Usage

- Slash command: `/brunogen-api`
- Automatic: Grok invokes it when you ask about endpoints, OpenAPI, Bruno, MCP, or API testing