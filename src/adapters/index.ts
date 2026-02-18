export { BaseAdapter } from './base.js';
export { ClaudeApiAdapter } from './claude-api.js';
export { ChatGptApiAdapter } from './chatgpt-api.js';
export { GeminiApiAdapter } from './gemini-api.js';
export { CodexCliAdapter } from './codex-cli.js';
export { ClaudeCodeCliAdapter } from './claude-code-cli.js';
export { BedrockApiAdapter, BEDROCK_MODELS } from './bedrock-api.js';
export { CursorCliAdapter } from './cursor-cli.js';

import { ClaudeApiAdapter } from './claude-api.js';
import { ChatGptApiAdapter } from './chatgpt-api.js';
import { GeminiApiAdapter } from './gemini-api.js';
import { CodexCliAdapter } from './codex-cli.js';
import { ClaudeCodeCliAdapter } from './claude-code-cli.js';
import { BedrockApiAdapter } from './bedrock-api.js';
import { CursorCliAdapter } from './cursor-cli.js';
import { getAgentRegistry } from '../core/agent-registry.js';

/**
 * Initialize all built-in adapters and register them
 */
export function initializeAdapters(): void {
  const registry = getAgentRegistry();

  // Register all built-in adapters
  registry.registerAdapter('claude', new ClaudeApiAdapter());
  registry.registerAdapter('chatgpt', new ChatGptApiAdapter());
  registry.registerAdapter('gemini', new GeminiApiAdapter());
  registry.registerAdapter('codex', new CodexCliAdapter());
  registry.registerAdapter('claude-code', new ClaudeCodeCliAdapter());
  registry.registerAdapter('bedrock', new BedrockApiAdapter());
  registry.registerAdapter('cursor', new CursorCliAdapter());
}
