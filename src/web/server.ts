import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { getMessageRoom } from '../core/message-room.js';
import { getAgentRegistry } from '../core/agent-registry.js';
import { getOrchestrator } from '../core/orchestrator.js';
import { initializeAdapters } from '../adapters/index.js';
import { initializeDiscussions } from '../modes/real-time-discussion.js';
import type { CollaborationMode, HubEvent, DiscussionConfig } from '../core/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Initialize adapters
initializeAdapters();

// Initialize any persisted discussions
initializeDiscussions();

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors());
app.use(express.json());

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// WebSocket connections
const clients = new Set<WebSocket>();

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log('Client connected');

  ws.on('close', () => {
    clients.delete(ws);
    console.log('Client disconnected');
  });
});

// Broadcast to all WebSocket clients
function broadcast(event: HubEvent) {
  const data = JSON.stringify(event);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

// Subscribe to all hub events
const messageRoom = getMessageRoom();
messageRoom.subscribeAll(broadcast);

// =============================================================================
// API Routes
// =============================================================================

// Rooms
app.get('/api/rooms', (req, res) => {
  const rooms = messageRoom.getAllRooms();
  res.json(rooms);
});

app.post('/api/rooms', (req, res) => {
  const { name, mode } = req.body;
  const room = messageRoom.createRoom({ name, mode });
  res.json(room);
});

app.get('/api/rooms/:id', (req, res) => {
  const state = messageRoom.getRoomState(req.params.id);
  if (!state) {
    res.status(404).json({ error: 'Room not found' });
    return;
  }
  res.json(state);
});

app.delete('/api/rooms/:id', (req, res) => {
  messageRoom.deleteRoom(req.params.id);
  res.json({ success: true });
});

// Messages
app.post('/api/rooms/:id/messages', async (req, res) => {
  try {
    const { message } = req.body;
    const orchestrator = getOrchestrator();
    const result = await orchestrator.run(req.params.id, message);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Quick actions
app.post('/api/ask', async (req, res) => {
  try {
    const { question } = req.body;
    const orchestrator = getOrchestrator();
    const result = await orchestrator.quickAsk(question);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

app.post('/api/debate', async (req, res) => {
  try {
    const { topic, rounds } = req.body;
    const orchestrator = getOrchestrator();
    const result = await orchestrator.quickDebate(topic, { rounds: rounds || 4 });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

app.post('/api/consensus', async (req, res) => {
  try {
    const { question, minAgreement } = req.body;
    const orchestrator = getOrchestrator();
    const result = await orchestrator.quickConsensus(question, { minAgreement });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Quick discussion
app.post('/api/discussion', async (req, res) => {
  try {
    const { message, config } = req.body;
    const orchestrator = getOrchestrator();
    const result = await orchestrator.quickDiscussion(message, config);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// =============================================================================
// Real-Time Discussion Endpoints
// =============================================================================

// Start a discussion in a room
app.post('/api/rooms/:id/start-discussion', (req, res) => {
  try {
    const { config } = req.body as { config?: Partial<DiscussionConfig> };
    const orchestrator = getOrchestrator();
    const state = orchestrator.startRealTimeDiscussion(req.params.id, config);
    res.json({ success: true, state });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Stop a discussion
app.post('/api/rooms/:id/stop-discussion', (req, res) => {
  try {
    const orchestrator = getOrchestrator();
    orchestrator.stopRealTimeDiscussion(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Get discussion state
app.get('/api/rooms/:id/discussion', (req, res) => {
  const orchestrator = getOrchestrator();
  const state = orchestrator.getRealTimeDiscussionState(req.params.id);
  const isActive = orchestrator.isRealTimeDiscussionActive(req.params.id);
  
  res.json({
    active: isActive,
    state: state ? {
      roomId: state.roomId,
      startedAt: state.startedAt,
      config: state.config,
      messageCount: state.messageCount,
      currentTurnMessageCount: state.currentTurnMessageCount,
    } : null,
  });
});

// Send message with force-all-respond option
app.post('/api/rooms/:id/discussion/message', async (req, res) => {
  try {
    const { message, forceAllRespond } = req.body;
    const orchestrator = getOrchestrator();
    
    // Ensure discussion is active
    if (!orchestrator.isRealTimeDiscussionActive(req.params.id)) {
      orchestrator.startRealTimeDiscussion(req.params.id);
    }
    
    const result = await orchestrator.run(req.params.id, message, { forceAllRespond });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Agents
app.get('/api/agents', async (req, res) => {
  const registry = getAgentRegistry();
  const agents = registry.listAgents();
  const healthMap = await registry.checkAllHealth();
  
  const result = agents.map((agent) => ({
    ...agent,
    health: healthMap.get(agent.id),
  }));
  
  res.json(result);
});

app.post('/api/agents/:id/enable', (req, res) => {
  const registry = getAgentRegistry();
  registry.enableAgent(req.params.id);
  res.json({ success: true });
});

app.post('/api/agents/:id/disable', (req, res) => {
  const registry = getAgentRegistry();
  registry.disableAgent(req.params.id);
  res.json({ success: true });
});

app.patch('/api/agents/:id/config', (req, res) => {
  const registry = getAgentRegistry();
  registry.configureAgent(req.params.id, req.body);
  res.json({ success: true });
});

app.get('/api/agents/health', async (req, res) => {
  const registry = getAgentRegistry();
  const healthMap = await registry.checkAllHealth();
  res.json(Object.fromEntries(healthMap));
});

// Serve index.html for all other routes (SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`
🚀 Agent Hub Web UI running at http://localhost:${PORT}

API Endpoints:
  GET  /api/rooms          - List all rooms
  POST /api/rooms          - Create a room
  GET  /api/rooms/:id      - Get room details
  POST /api/rooms/:id/messages - Send message to room

  POST /api/ask            - Quick ask all agents
  POST /api/debate         - Start a debate
  POST /api/consensus      - Seek consensus
  POST /api/discussion     - Start a real-time discussion

  Real-Time Discussion:
  POST /api/rooms/:id/start-discussion - Start discussion mode
  POST /api/rooms/:id/stop-discussion  - Stop discussion mode
  GET  /api/rooms/:id/discussion       - Get discussion state
  POST /api/rooms/:id/discussion/message - Send message (with forceAllRespond option)

  GET  /api/agents         - List all agents
  POST /api/agents/:id/enable  - Enable an agent
  POST /api/agents/:id/disable - Disable an agent
  PATCH /api/agents/:id/config - Configure an agent

WebSocket: ws://localhost:${PORT} (for real-time updates)
  Events: message, discussion_started, discussion_stopped, agent_thinking, agent_done_thinking
`);
});
