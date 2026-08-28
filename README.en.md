<div align="center">

# Spherse

[中文](README.md)｜EN

**A local, ready-to-use personal agent runtime.**

Run multiple agents—with independent identities, permissions, skills, and automations—over one shared user-owned data space. Then combine those agents and data into interactive applications with HTML and the UI SDK.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

<img src="packages/landing/public/screenshots/carousel-2.png" alt="Spherse application screenshot" />

</div>

## What is Spherse?

Spherse is not a writing tool with a fixed workflow, nor is it just another chat client. It provides the infrastructure for running agents, managing local data, and experiencing content you build yourself.

In Spherse:

- **A project folder is a shared data space.** Regular files are your data: local, inspectable, editable, portable, and owned by you.
- **Agents are independent workers.** Each agent can have its own system prompt, tool permissions, private skills, MCP servers, sessions, and chat theme.
- **Sessions are isolated task contexts.** One agent can have multiple sessions with separate tasks and histories.
- **Triggers form an automation network.** Agents can run on schedules or custom events emitted by users, pages, or other agents.
- **HTML becomes a runnable application interface.** Spherse can serve and display local HTML, while the UI SDK lets those pages read data, create sessions, send messages, and trigger agents.

A Spherse project is therefore more than a collection of chats. It can be a complete **Agent Workspace** containing user data, agents, skills, automations, themes, and interactive pages.

## What can you build?

Spherse does not prescribe a single use case. A project could be:

- A persistent worldbuilding or interactive storytelling space maintained by multiple characters
- A personal journal with dashboards, daily reports, and automated organization
- A knowledge workspace where research, summarization, and archival agents collaborate
- An event-driven AI character community or text game
- A personal tool or data application presented through custom HTML

The reusable, distributable unit is not merely a prompt. It is a complete Workspace composed of **data structures + agents + skills + automations + UI**.

## Download and installation

Download the latest build from [Releases](https://github.com/mengrru/Spherse/releases):

- **macOS:** Download the `.dmg` for your architecture and drag Spherse into Applications
- **Windows:** Download and run the `.exe` installer

> [!NOTE]
> The macOS build is not yet signed with an Apple Developer certificate. If macOS reports that the app is damaged or cannot verify the developer, run:
>
> ```bash
> xattr -cr /Applications/Spherse.app
> ```

After installation, configure an API key for a supported LLM provider, then create your first project and agent.

## Core capabilities

### Multiple agents, one shared data space

Create specialized agents around the same project. They share project files while retaining independent configurations:

- System prompts and preloaded context
- Tools and file-access permissions
- Shared project skills, private agent skills, and built-in skills
- Independent MCP server connections
- Multiple persistent sessions
- Individual chat themes

### Event-driven agent automation

Triggers allow agents to work without waiting for a new chat:

- Run on a Cron schedule
- Respond to custom events with payloads
- Execute in a new or designated existing session
- Receive events from users, HTML pages, or other agents
- Persist execution status and logs

### HTML + UI SDK: from content to application

Spherse includes a local HTTP preview server for HTML, images, and other project content. User-authored pages can call runtime capabilities through the UI SDK:

- `data.get` / `data.set` / `data.delete` for project-local JSON data
- Create a session under an agent
- Send a message to a specific session
- Emit a custom agent event
- Open a project file or show content in a floating window

This enables a complete loop:

> An agent creates or updates content → HTML presents the data → the user interacts → the page calls an agent again

### Distribute the entire Workspace

Spherse treats the project folder as a complete distribution unit. Copy or share that folder and its data, agent configurations, skills, automation rules, themes, and interactive pages all travel together. When someone opens it in Spherse, they receive more than static content: they get a runnable Agent Workspace they can use and extend.

### Local-first and user-owned

- Project content is stored as regular files
- Agent configuration uses Markdown, YAML, and JSON
- Sessions are persisted in project-local SQLite databases
- AI file access is constrained by path categories and permission policies
- File tools include path-traversal protection and concurrent-write coordination
- Dangerous operations require explicit user approval

### Desktop runtime, mobile access

Spherse ships as a macOS and Windows desktop app. A token-protected Web client can connect mobile devices to the desktop runtime. Quick Tunnel mode can establish a Cloudflare Tunnel automatically, while manual public endpoints are also supported.

## Local development

Requires Node.js 22.19+.

```bash
git clone https://github.com/mengrru/Spherse.git
cd Spherse
npm install
npm run dev
```

Common commands:

```bash
npm run build       # Build all packages
npm run verify      # Lint, build, unit tests, and i18n checks
npm run verify:e2e  # Full verification plus Electron E2E
npm run dist        # Build an installer for the current platform
```

The repository uses npm workspaces:

| Package | Responsibility |
| --- | --- |
| `@spherse/core` | Runtime for agents, sessions, skills, tools, triggers, and local data |
| `@spherse/server` | Fastify HTTP/WebSocket API and runtime contracts |
| `@spherse/app` | Shared React renderer for desktop and Web |
| `@spherse/desktop` | Electron main process, preload, IPC, and desktop infrastructure |
| `@spherse/web` | Mobile Web/PWA host |
| `@spherse/presets` | Built-in templates, skills, and sample content |
| `@spherse/i18n` | Internationalization infrastructure and translations |

See [`docs/official/`](docs/official/) for architecture and data conventions, and [`AGENTS.md`](AGENTS.md) for development guidelines.

## Tech stack

Electron · React · TypeScript · Fastify · pi-agent-core · pi-ai · MCP · SQLite · Zustand · Tailwind CSS

## License

[MIT](LICENSE)
