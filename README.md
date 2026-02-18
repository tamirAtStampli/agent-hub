# Agent Hub - Multi-Agent Collaboration Platform

A local system where multiple AI agents (Claude, ChatGPT, Gemini, Codex, Claude Code) work together as a team with research-backed collaboration modes.

## Research Foundation

This system is based on academic research showing that **diverse LLMs collaborating outperform single models**:

- 3 diverse models debating achieved **91% accuracy** vs **82% for GPT-4 alone**
- Multi-agent debate achieves **94% state-of-the-art** on benchmarks
- Confidence-weighted voting outperforms single models by **11.4%**

## Features

- **Shared Room Mode**: All agents respond in parallel, see each other's responses
- **Structured Debate**: Agents argue positions over multiple rounds, then synthesize
- **Consensus Mode**: Agents vote with confidence scores, weighted voting
- **Multiple Interfaces**: CLI, Web UI, and MCP server for Cursor integration
- **Typed Handoffs**: Checkpointing for failure recovery (addresses #1 multi-agent failure mode)

## Quick Start

### 1. Install Dependencies

```bash
cd agents-hands-on
npm install
```

### 2. Configure Agents

You can configure agents via CLI or environment variables:

```bash
# Via CLI
npx tsx src/cli/index.ts agents config claude --set apiKey=sk-ant-...
npx tsx src/cli/index.ts agents enable claude

# Or via environment variables
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
export GOOGLE_API_KEY=...
```

### 3. Enable Agents

```bash
npx tsx src/cli/index.ts agents list
npx tsx src/cli/index.ts agents enable claude
npx tsx src/cli/index.ts agents enable chatgpt
npx tsx src/cli/index.ts agents enable gemini
```

### 4. Start Using

**CLI:**
```bash
# Quick ask - all agents respond in parallel
npx tsx src/cli/index.ts ask "What's the best way to structure a React app?"

# Structured debate - 4 rounds
npx tsx src/cli/index.ts debate "Monolith vs microservices?" --rounds 4

# Consensus - agents vote with confidence
npx tsx src/cli/index.ts consensus "What testing framework should we use?"
```

**Web UI:**
```bash
npx tsx src/web/server.ts
# Open http://localhost:8080
```

**MCP Server (for Cursor):**
```bash
npx tsx src/mcp/server.ts
```

## CLI Commands

```bash
# Quick commands
agent-hub ask <question>              # Ask all agents
agent-hub debate <topic> [-r rounds]  # Structured debate
agent-hub consensus <question>        # Seek consensus

# Room management
agent-hub room create <name> [-m mode]
agent-hub room list
agent-hub room show <roomId>
agent-hub room delete <roomId>

# Agent management
agent-hub agents list
agent-hub agents enable <id>
agent-hub agents disable <id>
agent-hub agents config <id> --set key=value
agent-hub agents health
```

## MCP Tools

When running as an MCP server, these tools are available:

| Tool | Description |
|------|-------------|
| `ask` | Ask a question to all enabled agents |
| `debate` | Start a structured debate |
| `consensus` | Seek consensus with voting |
| `create_room` | Create a collaboration room |
| `list_agents` | List all agents |
| `enable_agent` | Enable an agent |
| `configure_agent` | Configure an agent |

## API Endpoints

```
GET  /api/rooms              - List all rooms
POST /api/rooms              - Create a room
GET  /api/rooms/:id          - Get room details
POST /api/rooms/:id/messages - Send message

POST /api/ask                - Quick ask
POST /api/debate             - Start debate
POST /api/consensus          - Seek consensus

GET  /api/agents             - List agents
POST /api/agents/:id/enable  - Enable agent
POST /api/agents/:id/disable - Disable agent
PATCH /api/agents/:id/config - Configure agent
```

## Collaboration Modes

### Shared Room (Default)
All agents respond in parallel and can see each other's responses. Best for brainstorming and exploration.

### Structured Debate
Agents argue positions over multiple rounds (default: 4), then synthesize the best ideas. Research shows this achieves 91% accuracy with diverse models.

### Consensus
Agents vote with confidence scores (0-1). Uses confidence-weighted voting to reach agreement. Research shows 11.4% improvement over single models.

## Architecture

```
src/
├── core/
│   ├── types.ts           # TypeScript types
│   ├── database.ts        # SQLite persistence
│   ├── agent-registry.ts  # Agent management
│   ├── message-room.ts    # Room & message handling
│   ├── orchestrator.ts    # Collaboration modes
│   └── handoff.ts         # Failure recovery
├── adapters/
│   ├── claude-api.ts      # Claude adapter
│   ├── chatgpt-api.ts     # ChatGPT adapter
│   ├── gemini-api.ts      # Gemini adapter
│   ├── codex-cli.ts       # Codex CLI adapter
│   └── claude-code-cli.ts # Claude Code adapter
├── modes/
│   ├── shared-room.ts     # Parallel responses
│   ├── debate.ts          # Structured debate
│   └── consensus.ts       # Voting
├── mcp/
│   └── server.ts          # MCP server
├── cli/
│   └── index.ts           # CLI commands
└── web/
    ├── server.ts          # Express server
    └── public/            # Web UI
```

## Adding to Cursor

Add to your Cursor MCP settings:

```json
{
  "mcpServers": {
    "agent-hub": {
      "command": "npx",
      "args": ["tsx", "/path/to/agents-hands-on/src/mcp/server.ts"]
    }
  }
}
```

## License

MIT
