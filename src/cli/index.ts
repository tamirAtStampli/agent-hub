#!/usr/bin/env node

import { Command } from 'commander';
import { getMessageRoom } from '../core/message-room.js';
import { getAgentRegistry } from '../core/agent-registry.js';
import { getOrchestrator } from '../core/orchestrator.js';
import { initializeAdapters } from '../adapters/index.js';

// Initialize adapters
initializeAdapters();

const program = new Command();

program
  .name('agent-hub')
  .description('Multi-Agent Collaboration Hub - Where AI agents work together as a team')
  .version('1.0.0');

// =============================================================================
// Quick Commands
// =============================================================================

program
  .command('ask <question>')
  .description('Ask a question to all enabled agents (shared-room mode)')
  .action(async (question: string) => {
    try {
      console.log('\n🤔 Asking all agents...\n');
      const orchestrator = getOrchestrator();
      const result = await orchestrator.quickAsk(question);

      for (const msg of result.messages) {
        if (msg.sender === 'user') {
          console.log(`📝 You: ${msg.content}\n`);
        } else {
          console.log(`🤖 ${msg.senderName}:`);
          console.log(`${msg.content}\n`);
        }
      }
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('debate <topic>')
  .description('Start a structured debate on a topic')
  .option('-r, --rounds <number>', 'Number of debate rounds', '4')
  .action(async (topic: string, options: { rounds: string }) => {
    try {
      console.log(`\n⚔️  Starting debate: "${topic}"\n`);
      console.log(`Rounds: ${options.rounds}\n`);

      const orchestrator = getOrchestrator();
      const result = await orchestrator.quickDebate(topic, {
        rounds: parseInt(options.rounds, 10),
      });

      console.log('\n📊 Debate Summary:');
      console.log(`- Rounds completed: ${result.summary.roundSummaries.length}`);
      console.log(`- Highest confidence: ${result.summary.highestConfidence.agent} (${(result.summary.highestConfidence.confidence * 100).toFixed(1)}%)`);
      
      if (result.synthesis) {
        console.log('\n📝 Synthesis:');
        console.log(result.synthesis);
      }
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('consensus <question>')
  .description('Get agents to reach consensus on a question')
  .option('-t, --threshold <number>', 'Minimum agreement threshold (0-1)', '0.66')
  .action(async (question: string, options: { threshold: string }) => {
    try {
      console.log(`\n🗳️  Seeking consensus: "${question}"\n`);

      const orchestrator = getOrchestrator();
      const result = await orchestrator.quickConsensus(question, {
        minAgreement: parseFloat(options.threshold),
      });

      if (result.reached) {
        console.log(`\n✅ Consensus Reached! (${(result.confidence * 100).toFixed(1)}% agreement)`);
        console.log(`\n📋 Answer: ${result.answer}`);
      } else {
        console.log(`\n❌ No Consensus (${(result.confidence * 100).toFixed(1)}% agreement)`);
        console.log('\n📊 Individual Votes:');
        for (const vote of result.votes) {
          console.log(`  • ${vote.agent} (${(vote.confidence * 100).toFixed(0)}%): ${vote.answer.slice(0, 100)}...`);
        }
      }
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// =============================================================================
// Room Commands
// =============================================================================

const roomCmd = program.command('room').description('Room management commands');

roomCmd
  .command('create <name>')
  .description('Create a new collaboration room')
  .option('-m, --mode <mode>', 'Collaboration mode (shared-room, structured-debate, consensus)', 'shared-room')
  .action((name: string, options: { mode: string }) => {
    try {
      const messageRoom = getMessageRoom();
      const room = messageRoom.createRoom({
        name,
        mode: options.mode as 'shared-room' | 'structured-debate' | 'consensus',
      });
      console.log(`✅ Room created: ${room.name} (${room.id})`);
      console.log(`   Mode: ${room.mode}`);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

roomCmd
  .command('list')
  .description('List all rooms')
  .action(() => {
    try {
      const messageRoom = getMessageRoom();
      const rooms = messageRoom.getAllRooms();

      if (rooms.length === 0) {
        console.log('No rooms found.');
        return;
      }

      console.log('\n📋 Rooms:\n');
      for (const room of rooms) {
        console.log(`  ${room.name}`);
        console.log(`    ID: ${room.id}`);
        console.log(`    Mode: ${room.mode}`);
        console.log(`    Created: ${room.createdAt.toLocaleString()}`);
        console.log('');
      }
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

roomCmd
  .command('show <roomId>')
  .description('Show room details and messages')
  .action((roomId: string) => {
    try {
      const messageRoom = getMessageRoom();
      const state = messageRoom.getRoomState(roomId);

      if (!state) {
        console.log('Room not found.');
        return;
      }

      console.log(`\n📋 Room: ${state.room.name}`);
      console.log(`   Mode: ${state.room.mode}`);
      console.log(`   Messages: ${state.messages.length}`);
      console.log('\n💬 Messages:\n');

      for (const msg of state.messages) {
        const sender = msg.sender === 'user' ? '👤 You' : `🤖 ${msg.senderName}`;
        console.log(`${sender}:`);
        console.log(`  ${msg.content.slice(0, 200)}${msg.content.length > 200 ? '...' : ''}`);
        console.log('');
      }
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

roomCmd
  .command('delete <roomId>')
  .description('Delete a room')
  .action((roomId: string) => {
    try {
      const messageRoom = getMessageRoom();
      messageRoom.deleteRoom(roomId);
      console.log('✅ Room deleted.');
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// =============================================================================
// Agent Commands
// =============================================================================

const agentsCmd = program.command('agents').description('Agent management commands');

agentsCmd
  .command('list')
  .description('List all agents with their status')
  .action(async () => {
    try {
      const registry = getAgentRegistry();
      const agents = registry.listAgents();
      const healthMap = await registry.checkAllHealth();

      console.log('\n🤖 Agents:\n');

      for (const agent of agents) {
        const health = healthMap.get(agent.id);
        const status = agent.enabled ? '✅ enabled' : '⚪ disabled';
        const healthIcon = health?.status === 'healthy' ? '🟢' : health?.status === 'disabled' ? '⚪' : '🔴';
        const model = agent.config.model ? ` (${agent.config.model})` : '';
        const hasKey = agent.config.apiKey ? ' [API key set]' : '';
        
        console.log(`  ${healthIcon} ${agent.name}${model}`);
        console.log(`     ID: ${agent.id}`);
        console.log(`     Status: ${status}${hasKey}`);
        if (health?.error) {
          console.log(`     Error: ${health.error}`);
        }
        console.log('');
      }
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

agentsCmd
  .command('enable <agentId>')
  .description('Enable an agent')
  .action((agentId: string) => {
    try {
      const registry = getAgentRegistry();
      registry.enableAgent(agentId);
      console.log(`✅ Agent ${agentId} enabled.`);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

agentsCmd
  .command('disable <agentId>')
  .description('Disable an agent')
  .action((agentId: string) => {
    try {
      const registry = getAgentRegistry();
      registry.disableAgent(agentId);
      console.log(`✅ Agent ${agentId} disabled.`);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

agentsCmd
  .command('config <agentId>')
  .description('Configure an agent')
  .option('--set <key=value>', 'Set a configuration value (can be used multiple times)', (val: string, acc: string[]) => {
    acc.push(val);
    return acc;
  }, [])
  .action((agentId: string, options: { set: string[] }) => {
    try {
      const registry = getAgentRegistry();
      const config: Record<string, string> = {};

      for (const setting of options.set) {
        const [key, ...valueParts] = setting.split('=');
        const value = valueParts.join('=');
        config[key] = value;
      }

      if (Object.keys(config).length === 0) {
        // Show current config
        const agent = registry.getAgent(agentId);
        if (!agent) {
          console.log('Agent not found.');
          return;
        }
        console.log(`\n⚙️  Configuration for ${agent.name}:\n`);
        for (const [key, value] of Object.entries(agent.config)) {
          const displayValue = key === 'apiKey' && value ? '***' : value;
          console.log(`  ${key}: ${displayValue}`);
        }
        return;
      }

      registry.configureAgent(agentId, config);
      console.log(`✅ Agent ${agentId} configured.`);
      
      for (const [key, value] of Object.entries(config)) {
        const displayValue = key === 'apiKey' ? '***' : value;
        console.log(`  ${key}: ${displayValue}`);
      }
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

agentsCmd
  .command('health')
  .description('Check health of all agents')
  .action(async () => {
    try {
      console.log('\n🏥 Checking agent health...\n');
      
      const registry = getAgentRegistry();
      const healthMap = await registry.checkAllHealth();

      for (const [id, health] of healthMap.entries()) {
        const icon = health.status === 'healthy' ? '🟢' : health.status === 'disabled' ? '⚪' : '🔴';
        const latency = health.latencyMs ? ` (${health.latencyMs}ms)` : '';
        console.log(`  ${icon} ${id}: ${health.status}${latency}`);
        if (health.error) {
          console.log(`     Error: ${health.error}`);
        }
      }
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// =============================================================================
// Start Command
// =============================================================================

program
  .command('start')
  .description('Start the Agent Hub (MCP server)')
  .action(() => {
    console.log('Starting Agent Hub MCP server...');
    console.log('Run with: npx tsx src/mcp/server.ts');
  });

// Parse and run
program.parse();
