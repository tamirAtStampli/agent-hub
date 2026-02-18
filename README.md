# Agent Hub - Multi-Agent Collaboration Platform

A local system where multiple AI agents (Claude, ChatGPT, Gemini, Bedrock, Codex CLI, Claude Code, Cursor) work together as a team with research-backed collaboration modes.

## Research Foundation

This system is based on academic research showing that **diverse LLMs collaborating outperform single models**:

- 3 diverse models debating achieved **91% accuracy** vs **82% for GPT-4 alone**
- Multi-agent debate achieves **94% state-of-the-art** on benchmarks
- Confidence-weighted voting outperforms single models by **11.4%**

## Features

- **Parallel Responses with Adjustment**: Agents respond simultaneously, then see each other's answers and can adjust (like WhatsApp group chat)
- **Structured Debate**: Agents argue positions over multiple rounds, then synthesize
- **Real-Time Discussion**: Dynamic chat where agents decide when to respond
- **Consensus Mode**: Agents vote with confidence scores, weighted voting
- **Multiple Interfaces**: CLI, Web UI, and MCP server for Cursor integration
- **Model Selection**: Dropdown menus to select models per agent type
- **Typed Handoffs**: Checkpointing for failure recovery

---

## Prerequisites

- **Node.js**: v18.0.0 or higher
- **npm**: v9.0.0 or higher
- **API Keys** (at least one):
  - Anthropic API key (for Claude)
  - OpenAI API key (for ChatGPT)
  - Google API key (for Gemini)
  - AWS credentials (for Bedrock)
- **CLI Tools** (optional, for CLI-based agents):
  - `claude` CLI (for Claude Code agent)
  - `codex` CLI (for Codex agent)
  - `cursor-agent` CLI (for Cursor agent)

---

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/tamirAtStampli/agent-hub.git
cd agent-hub
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Build the Project (Optional)

```bash
npm run build
```

---

## Configuration

### Environment Variables

Create a `.env` file in the root directory (copy from `.env.example`):

```bash
cp .env.example .env
```

Edit `.env` with your API keys:

```env
# Anthropic (Claude)
ANTHROPIC_API_KEY=sk-ant-api03-...

# OpenAI (ChatGPT)
OPENAI_API_KEY=sk-...

# Google (Gemini)
GOOGLE_API_KEY=AIza...

# AWS Bedrock (optional)
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
```

### Configure Agents via CLI

```bash
# List all agents
npm run cli -- agents list

# Configure API key for an agent
npm run cli -- agents config claude --set apiKey=sk-ant-...

# Enable an agent
npm run cli -- agents enable claude

# Disable an agent
npm run cli -- agents disable claude

# Check agent health
npm run cli -- agents health
```

### Configure Agents via Web UI

1. Start the web server: `npm run web`
2. Open http://localhost:8080
3. Click the gear icon to open settings
4. Enter API keys and select models from the dropdowns

---

## Running the Application

### Web UI (Recommended)

```bash
npm run web
```

Open http://localhost:8080 in your browser.

**Features:**
- Create debate rooms
- Select collaboration mode (debate, discussion, consensus)
- Configure agents with model dropdowns
- Real-time WebSocket updates

### CLI

```bash
# Quick ask - all agents respond in parallel
npm run cli -- ask "What's the best way to structure a React app?"

# Structured debate - multiple rounds
npm run cli -- debate "Monolith vs microservices?" --rounds 4

# Consensus - agents vote with confidence
npm run cli -- consensus "What testing framework should we use?"
```

### MCP Server (for Cursor IDE)

```bash
npm run mcp
```

Add to your Cursor MCP settings (`~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "agent-hub": {
      "command": "npx",
      "args": ["tsx", "/path/to/agent-hub/src/mcp/server.ts"]
    }
  }
}
```

---

## Available Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `npm run dev` | Development mode with hot reload |
| `npm run start` | Start the main application |
| `npm run web` | Start the Web UI server |
| `npm run cli` | Run CLI commands |
| `npm run mcp` | Start MCP server |
| `npm run build` | Build TypeScript to JavaScript |
| `npm run test` | Run tests |

---

## Supported Agents

### API-Based Agents

| Agent | Type | Default Model | Requirements |
|-------|------|---------------|--------------|
| Claude | `claude` | claude-sonnet-4-20250514 | `ANTHROPIC_API_KEY` |
| ChatGPT | `chatgpt` | gpt-4o | `OPENAI_API_KEY` |
| Gemini | `gemini` | gemini-1.5-pro | `GOOGLE_API_KEY` |
| Bedrock | `bedrock` | claude-3-sonnet | AWS credentials |

### CLI-Based Agents

| Agent | Type | CLI Command | Requirements |
|-------|------|-------------|--------------|
| Claude Code | `claude-code` | `claude` | Claude CLI installed |
| Codex CLI | `codex` | `codex` | Codex CLI installed |
| Cursor Agent | `cursor` | `cursor-agent` | Cursor CLI installed |

---

## Collaboration Modes

### 1. Structured Debate (Default)

Agents argue positions over multiple rounds, then synthesize the best ideas.

**Features:**
- Configurable number of rounds (default: 4)
- Parallel responses with adjustment window
- Each agent sees others' responses and can refine their answer
- Final synthesis combining all perspectives

**How it works:**
```
Round 1:
  Phase 1: All agents respond in parallel (isolated)
  Phase 2: Agents see each other's responses, can adjust
  
Round 2-N: Same process, building on previous rounds

Final: Synthesis of key agreements and disagreements
```

### 2. Real-Time Discussion

Dynamic chat where agents decide when to respond, like a WhatsApp group.

**Features:**
- Agents respond based on relevance (not forced)
- @mention specific agents
- Cooldowns prevent spam
- Natural conversation flow

### 3. Consensus Mode

Agents vote with confidence scores to reach agreement.

**Features:**
- Confidence-weighted voting (0.0 - 1.0)
- Multiple voting rounds if needed
- Configurable agreement threshold

### 4. Shared Room

Simple parallel responses where all agents answer simultaneously.

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/rooms` | List all rooms |
| `POST` | `/api/rooms` | Create a room |
| `GET` | `/api/rooms/:id` | Get room details |
| `POST` | `/api/rooms/:id/messages` | Send message |
| `POST` | `/api/ask` | Quick ask all agents |
| `POST` | `/api/debate` | Start structured debate |
| `POST` | `/api/consensus` | Seek consensus |
| `GET` | `/api/agents` | List all agents |
| `POST` | `/api/agents/:id/enable` | Enable agent |
| `POST` | `/api/agents/:id/disable` | Disable agent |
| `PATCH` | `/api/agents/:id/config` | Configure agent |

---

## Architecture

```
agent-hub/
├── src/
│   ├── core/
│   │   ├── types.ts           # TypeScript types & schemas
│   │   ├── database.ts        # SQLite persistence
│   │   ├── agent-registry.ts  # Agent management
│   │   ├── message-room.ts    # Room & message handling
│   │   ├── orchestrator.ts    # Collaboration coordination
│   │   └── handoff.ts         # Failure recovery
│   ├── adapters/
│   │   ├── base.ts            # Base adapter class
│   │   ├── claude-api.ts      # Claude API adapter
│   │   ├── chatgpt-api.ts     # ChatGPT API adapter
│   │   ├── gemini-api.ts      # Gemini API adapter
│   │   ├── bedrock-api.ts     # AWS Bedrock adapter
│   │   ├── codex-cli.ts       # Codex CLI adapter
│   │   ├── claude-code-cli.ts # Claude Code CLI adapter
│   │   └── cursor-cli.ts      # Cursor CLI adapter
│   ├── modes/
│   │   ├── debate.ts          # Structured debate with adjustment
│   │   ├── real-time-discussion.ts # Dynamic chat
│   │   ├── consensus.ts       # Voting mode
│   │   └── shared-room.ts     # Parallel responses
│   ├── mcp/
│   │   └── server.ts          # MCP server for Cursor
│   ├── cli/
│   │   └── index.ts           # CLI commands
│   └── web/
│       ├── server.ts          # Express + WebSocket server
│       └── public/
│           └── index.html     # Web UI
├── data/                      # SQLite database (auto-created)
├── package.json
├── tsconfig.json
└── README.md
```

---

## Troubleshooting

### "No agents available"

Make sure at least one agent is enabled:
```bash
npm run cli -- agents list
npm run cli -- agents enable claude
```

### "API key not configured"

Set the API key via CLI or environment variable:
```bash
# Via CLI
npm run cli -- agents config claude --set apiKey=sk-ant-...

# Via environment
export ANTHROPIC_API_KEY=sk-ant-...
```

### CLI agents not working

Make sure the CLI tools are installed and accessible:
```bash
# Check if claude CLI is available
claude --version

# Check if codex CLI is available
codex --version
```

### WebSocket connection issues

The Web UI uses WebSocket for real-time updates. Make sure:
- Port 8080 is not blocked
- No proxy is interfering with WebSocket connections

### Database errors

The SQLite database is stored in `data/hub.db`. To reset:
```bash
rm -rf data/*.db
npm run web  # Database will be recreated
```

---

## Development

### Running in Development Mode

```bash
npm run dev
```

This starts the application with hot reload using `tsx watch`.

### Adding a New Agent Adapter

1. Create a new file in `src/adapters/`
2. Extend the `BaseAdapter` class
3. Implement `isAvailable()` and `sendMessage()` methods
4. Register the adapter in `src/adapters/index.ts`
5. Add default config in `src/core/agent-registry.ts`

### Running Tests

```bash
npm run test
```

---

## License

MIT

---

## Contributing

Contributions are welcome! Please open an issue or pull request.

## Links

- **Repository**: https://github.com/tamirAtStampli/agent-hub
