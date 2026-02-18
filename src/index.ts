/**
 * Agent Hub - Multi-Agent Collaboration Platform
 * 
 * A system where multiple AI agents (Claude, ChatGPT, Gemini, etc.)
 * work together as a team with research-backed collaboration modes.
 */

export * from './core/types.js';
export { getDatabase, closeDatabase } from './core/database.js';
export { AgentRegistry, getAgentRegistry } from './core/agent-registry.js';
export { MessageRoom, getMessageRoom } from './core/message-room.js';
export { Orchestrator, getOrchestrator } from './core/orchestrator.js';
export { HandoffSystem, getHandoffSystem } from './core/handoff.js';

export * from './adapters/index.js';
export * from './modes/index.js';

import { initializeAdapters } from './adapters/index.js';
import { getAgentRegistry } from './core/agent-registry.js';
import { getOrchestrator } from './core/orchestrator.js';

/**
 * Initialize the Agent Hub
 */
export function initialize(): void {
  initializeAdapters();
  console.log('Agent Hub initialized');
}

/**
 * Quick ask - simple way to get responses from all agents
 */
export async function ask(question: string): Promise<string> {
  initialize();
  const orchestrator = getOrchestrator();
  const result = await orchestrator.quickAsk(question);
  return result.result;
}

/**
 * Quick debate - run a debate and get synthesis
 */
export async function debate(topic: string, rounds = 4): Promise<string | undefined> {
  initialize();
  const orchestrator = getOrchestrator();
  const result = await orchestrator.quickDebate(topic, { rounds });
  return result.synthesis;
}

/**
 * Quick consensus - get agents to agree on something
 */
export async function consensus(question: string): Promise<{
  reached: boolean;
  answer?: string;
  confidence: number;
}> {
  initialize();
  const orchestrator = getOrchestrator();
  return orchestrator.quickConsensus(question);
}

// If run directly, show usage
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`
Agent Hub - Multi-Agent Collaboration Platform

Usage:
  npx tsx src/cli/index.ts ask "Your question"
  npx tsx src/cli/index.ts debate "Topic to debate"
  npx tsx src/cli/index.ts consensus "Question to agree on"
  npx tsx src/cli/index.ts agents list
  npx tsx src/cli/index.ts agents enable claude
  npx tsx src/cli/index.ts agents config claude --set apiKey=sk-ant-...

MCP Server:
  npx tsx src/mcp/server.ts

Web UI:
  npx tsx src/web/server.ts
`);
}
