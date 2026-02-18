import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { getMessageRoom } from '../core/message-room.js';
import { getAgentRegistry } from '../core/agent-registry.js';
import { getOrchestrator } from '../core/orchestrator.js';
import { initializeAdapters } from '../adapters/index.js';
import type { CollaborationMode } from '../core/types.js';

// Initialize adapters
initializeAdapters();

const server = new Server(
  {
    name: 'agent-hub',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define all tools
const TOOLS = [
  // Room Management
  {
    name: 'create_room',
    description: 'Create a new collaboration room for AI agents to discuss',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name of the room' },
        mode: { 
          type: 'string', 
          enum: ['shared-room', 'structured-debate', 'consensus'],
          description: 'Collaboration mode: shared-room (parallel), structured-debate (multi-round), consensus (voting)'
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'list_rooms',
    description: 'List all collaboration rooms',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_room',
    description: 'Get details of a specific room including messages',
    inputSchema: {
      type: 'object',
      properties: {
        roomId: { type: 'string', description: 'Room ID' },
      },
      required: ['roomId'],
    },
  },
  {
    name: 'delete_room',
    description: 'Delete a room and all its messages',
    inputSchema: {
      type: 'object',
      properties: {
        roomId: { type: 'string', description: 'Room ID to delete' },
      },
      required: ['roomId'],
    },
  },

  // Collaboration
  {
    name: 'ask',
    description: 'Ask a question to all enabled agents in shared-room mode (parallel responses)',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The question to ask' },
        roomId: { type: 'string', description: 'Optional room ID (creates new room if not provided)' },
      },
      required: ['question'],
    },
  },
  {
    name: 'debate',
    description: 'Start a structured debate on a topic. Agents argue positions over multiple rounds.',
    inputSchema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'The topic to debate' },
        rounds: { type: 'number', description: 'Number of debate rounds (default: 4)' },
        roomId: { type: 'string', description: 'Optional room ID' },
      },
      required: ['topic'],
    },
  },
  {
    name: 'consensus',
    description: 'Ask agents to reach consensus on a question through confidence-weighted voting',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The question to reach consensus on' },
        minAgreement: { type: 'number', description: 'Minimum agreement threshold (0-1, default: 0.66)' },
        roomId: { type: 'string', description: 'Optional room ID' },
      },
      required: ['question'],
    },
  },
  {
    name: 'send_message',
    description: 'Send a message to a room and get agent responses based on room mode',
    inputSchema: {
      type: 'object',
      properties: {
        roomId: { type: 'string', description: 'Room ID' },
        message: { type: 'string', description: 'Message to send' },
      },
      required: ['roomId', 'message'],
    },
  },

  // Agent Management
  {
    name: 'list_agents',
    description: 'List all registered agents with their status',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'enable_agent',
    description: 'Enable an agent to participate in collaborations',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'Agent ID (claude, chatgpt, gemini, codex, claude-code)' },
      },
      required: ['agentId'],
    },
  },
  {
    name: 'disable_agent',
    description: 'Disable an agent from participating',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'Agent ID' },
      },
      required: ['agentId'],
    },
  },
  {
    name: 'configure_agent',
    description: 'Configure an agent (set API key, model, etc.)',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'Agent ID' },
        apiKey: { type: 'string', description: 'API key for the agent' },
        model: { type: 'string', description: 'Model to use' },
      },
      required: ['agentId'],
    },
  },
  {
    name: 'check_agent_health',
    description: 'Check health status of all agents',
    inputSchema: { type: 'object', properties: {} },
  },
];

// Handle list tools request
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      // Room Management
      case 'create_room': {
        const messageRoom = getMessageRoom();
        const room = messageRoom.createRoom({
          name: (args as { name: string }).name,
          mode: ((args as { mode?: string }).mode as CollaborationMode) || 'shared-room',
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(room, null, 2) }],
        };
      }

      case 'list_rooms': {
        const messageRoom = getMessageRoom();
        const rooms = messageRoom.getAllRooms();
        return {
          content: [{ type: 'text', text: JSON.stringify(rooms, null, 2) }],
        };
      }

      case 'get_room': {
        const messageRoom = getMessageRoom();
        const state = messageRoom.getRoomState((args as { roomId: string }).roomId);
        if (!state) {
          return { content: [{ type: 'text', text: 'Room not found' }] };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(state, null, 2) }],
        };
      }

      case 'delete_room': {
        const messageRoom = getMessageRoom();
        messageRoom.deleteRoom((args as { roomId: string }).roomId);
        return {
          content: [{ type: 'text', text: 'Room deleted successfully' }],
        };
      }

      // Collaboration
      case 'ask': {
        const orchestrator = getOrchestrator();
        const typedArgs = args as { question: string; roomId?: string };
        
        let roomId = typedArgs.roomId;
        if (!roomId) {
          const messageRoom = getMessageRoom();
          const room = messageRoom.createRoom({
            name: `Ask - ${new Date().toISOString()}`,
            mode: 'shared-room',
          });
          roomId = room.id;
        }

        const result = await orchestrator.run(roomId, typedArgs.question);
        return {
          content: [{ type: 'text', text: result.result || 'No responses' }],
        };
      }

      case 'debate': {
        const orchestrator = getOrchestrator();
        const typedArgs = args as { topic: string; rounds?: number; roomId?: string };
        
        const result = await orchestrator.quickDebate(typedArgs.topic, {
          rounds: typedArgs.rounds || 4,
        });

        const output = [
          `## Debate: ${typedArgs.topic}`,
          '',
          `**Rounds:** ${result.summary.roundSummaries.length}`,
          `**Highest Confidence:** ${result.summary.highestConfidence.agent} (${(result.summary.highestConfidence.confidence * 100).toFixed(1)}%)`,
          '',
          '## Synthesis',
          result.synthesis || 'No synthesis generated',
        ].join('\n');

        return {
          content: [{ type: 'text', text: output }],
        };
      }

      case 'consensus': {
        const orchestrator = getOrchestrator();
        const typedArgs = args as { question: string; minAgreement?: number; roomId?: string };
        
        const result = await orchestrator.quickConsensus(typedArgs.question, {
          minAgreement: typedArgs.minAgreement || 0.66,
        });

        const output = result.reached
          ? `✅ **Consensus Reached** (${(result.confidence * 100).toFixed(1)}% agreement)\n\n**Answer:** ${result.answer}`
          : `❌ **No Consensus** (${(result.confidence * 100).toFixed(1)}% agreement)\n\n**Votes:**\n${result.votes.map(v => `- ${v.agent} (${(v.confidence * 100).toFixed(0)}%): ${v.answer.slice(0, 100)}...`).join('\n')}`;

        return {
          content: [{ type: 'text', text: output }],
        };
      }

      case 'send_message': {
        const orchestrator = getOrchestrator();
        const typedArgs = args as { roomId: string; message: string };
        
        const result = await orchestrator.run(typedArgs.roomId, typedArgs.message);
        return {
          content: [{ type: 'text', text: result.result || 'No responses' }],
        };
      }

      // Agent Management
      case 'list_agents': {
        const registry = getAgentRegistry();
        const agents = registry.listAgents();
        const healthMap = await registry.checkAllHealth();

        const output = agents.map((agent) => {
          const health = healthMap.get(agent.id);
          const status = agent.enabled ? '✅ enabled' : '⚪ disabled';
          const healthStatus = health?.status === 'healthy' ? '🟢' : health?.status === 'disabled' ? '⚪' : '🔴';
          return `${healthStatus} **${agent.name}** (${agent.id}) - ${status}`;
        }).join('\n');

        return {
          content: [{ type: 'text', text: output || 'No agents registered' }],
        };
      }

      case 'enable_agent': {
        const registry = getAgentRegistry();
        registry.enableAgent((args as { agentId: string }).agentId);
        return {
          content: [{ type: 'text', text: `Agent ${(args as { agentId: string }).agentId} enabled` }],
        };
      }

      case 'disable_agent': {
        const registry = getAgentRegistry();
        registry.disableAgent((args as { agentId: string }).agentId);
        return {
          content: [{ type: 'text', text: `Agent ${(args as { agentId: string }).agentId} disabled` }],
        };
      }

      case 'configure_agent': {
        const registry = getAgentRegistry();
        const typedArgs = args as { agentId: string; apiKey?: string; model?: string };
        
        const config: Record<string, unknown> = {};
        if (typedArgs.apiKey) config.apiKey = typedArgs.apiKey;
        if (typedArgs.model) config.model = typedArgs.model;

        registry.configureAgent(typedArgs.agentId, config);
        return {
          content: [{ type: 'text', text: `Agent ${typedArgs.agentId} configured` }],
        };
      }

      case 'check_agent_health': {
        const registry = getAgentRegistry();
        const healthMap = await registry.checkAllHealth();

        const output = Array.from(healthMap.entries())
          .map(([id, health]) => {
            const icon = health.status === 'healthy' ? '🟢' : health.status === 'disabled' ? '⚪' : '🔴';
            const latency = health.latencyMs ? `(${health.latencyMs}ms)` : '';
            const error = health.error ? ` - ${health.error}` : '';
            return `${icon} **${id}**: ${health.status} ${latency}${error}`;
          })
          .join('\n');

        return {
          content: [{ type: 'text', text: output || 'No agents to check' }],
        };
      }

      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }],
      isError: true,
    };
  }
});

// Main entry point
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Agent Hub MCP Server running on stdio');
}

main().catch(console.error);
