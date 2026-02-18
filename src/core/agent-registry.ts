import { v4 as uuidv4 } from 'uuid';
import type { AgentConfig, AgentHealth, AgentAdapter, AgentType } from './types.js';
import * as db from './database.js';

/**
 * AgentRegistry manages the registration, configuration, and health
 * of all AI agents in the system. Supports built-in agents and custom plugins.
 */
export class AgentRegistry {
  private adapters: Map<string, AgentAdapter> = new Map();
  private healthCache: Map<string, AgentHealth> = new Map();

  constructor() {
    this.initializeDefaultAgents();
  }

  /**
   * Initialize default agent configurations if they don't exist
   */
  private initializeDefaultAgents(): void {
    const defaults: Partial<AgentConfig>[] = [
      {
        id: 'claude',
        name: 'Claude',
        type: 'claude',
        enabled: false,
        config: { model: 'claude-sonnet-4-20250514' },
      },
      {
        id: 'chatgpt',
        name: 'ChatGPT',
        type: 'chatgpt',
        enabled: false,
        config: { model: 'gpt-4o' },
      },
      {
        id: 'gemini',
        name: 'Gemini',
        type: 'gemini',
        enabled: false,
        config: { model: 'gemini-1.5-pro' },
      },
      {
        id: 'bedrock',
        name: 'Amazon Bedrock',
        type: 'custom',
        enabled: false,
        config: { 
          model: 'anthropic.claude-3-sonnet-20240229-v1:0',
          region: 'us-east-1',
        },
      },
      {
        id: 'cursor',
        name: 'Cursor Agent',
        type: 'custom',
        enabled: false,
        config: { cliPath: 'agent', model: 'auto' },
      },
      {
        id: 'codex',
        name: 'Codex CLI',
        type: 'codex',
        enabled: false,
        config: { cliPath: 'codex' },
      },
      {
        id: 'claude-code',
        name: 'Claude Code',
        type: 'claude-code',
        enabled: false,
        config: { cliPath: 'claude' },
      },
    ];

    for (const agent of defaults) {
      const existing = db.getAgent(agent.id!);
      if (!existing) {
        db.insertAgent({
          ...agent,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as AgentConfig);
      }
    }
  }

  /**
   * Register an adapter for an agent
   */
  registerAdapter(agentId: string, adapter: AgentAdapter): void {
    this.adapters.set(agentId, adapter);
  }

  /**
   * Get an adapter for an agent
   */
  getAdapter(agentId: string): AgentAdapter | undefined {
    return this.adapters.get(agentId);
  }

  /**
   * List all registered agents
   */
  listAgents(): AgentConfig[] {
    return db.getAllAgents();
  }

  /**
   * Get only enabled agents
   */
  getEnabledAgents(): AgentConfig[] {
    return db.getEnabledAgents();
  }

  /**
   * Get a specific agent by ID
   */
  getAgent(id: string): AgentConfig | null {
    return db.getAgent(id);
  }

  /**
   * Register a new agent (custom plugin)
   */
  registerAgent(config: {
    name: string;
    type: AgentType;
    config?: Record<string, unknown>;
    adapterPath?: string;
  }): AgentConfig {
    const agent: AgentConfig = {
      id: uuidv4(),
      name: config.name,
      type: config.type,
      enabled: false,
      config: config.config || {},
      adapterPath: config.adapterPath,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    db.insertAgent(agent);
    return agent;
  }

  /**
   * Enable an agent
   */
  enableAgent(id: string): void {
    db.updateAgent(id, { enabled: true });
  }

  /**
   * Disable an agent
   */
  disableAgent(id: string): void {
    db.updateAgent(id, { enabled: false });
  }

  /**
   * Update agent configuration
   */
  configureAgent(id: string, config: Record<string, unknown>): void {
    const agent = db.getAgent(id);
    if (!agent) throw new Error(`Agent not found: ${id}`);
    db.updateAgent(id, {
      config: { ...agent.config, ...config },
    });
  }

  /**
   * Remove a custom agent
   */
  unregisterAgent(id: string): void {
    this.adapters.delete(id);
    db.deleteAgent(id);
  }

  /**
   * Check health of an agent
   */
  async checkHealth(agentId: string): Promise<AgentHealth> {
    const agent = db.getAgent(agentId);
    if (!agent) {
      return {
        agentId,
        status: 'unknown',
        error: 'Agent not found',
        lastChecked: new Date(),
      };
    }

    if (!agent.enabled) {
      return {
        agentId,
        status: 'disabled',
        lastChecked: new Date(),
      };
    }

    const adapter = this.adapters.get(agentId);
    if (!adapter) {
      return {
        agentId,
        status: 'unhealthy',
        error: 'No adapter registered',
        lastChecked: new Date(),
      };
    }

    try {
      const health = await adapter.checkHealth();
      this.healthCache.set(agentId, health);
      return health;
    } catch (error) {
      const health: AgentHealth = {
        agentId,
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error',
        lastChecked: new Date(),
      };
      this.healthCache.set(agentId, health);
      return health;
    }
  }

  /**
   * Check health of all agents
   */
  async checkAllHealth(): Promise<Map<string, AgentHealth>> {
    const agents = db.getAllAgents();
    const results = new Map<string, AgentHealth>();
    
    await Promise.all(
      agents.map(async (agent) => {
        const health = await this.checkHealth(agent.id);
        results.set(agent.id, health);
      })
    );

    return results;
  }

  /**
   * Get cached health status
   */
  getCachedHealth(agentId: string): AgentHealth | undefined {
    return this.healthCache.get(agentId);
  }

  /**
   * Get agents with their adapters loaded and ready
   */
  getReadyAgents(): { agent: AgentConfig; adapter: AgentAdapter }[] {
    const enabled = this.getEnabledAgents();
    return enabled
      .map((agent) => {
        const adapter = this.adapters.get(agent.id);
        if (adapter) {
          return { agent, adapter };
        }
        return null;
      })
      .filter((x): x is { agent: AgentConfig; adapter: AgentAdapter } => x !== null);
  }
}

// Singleton instance
let registryInstance: AgentRegistry | null = null;

export function getAgentRegistry(): AgentRegistry {
  if (!registryInstance) {
    registryInstance = new AgentRegistry();
  }
  return registryInstance;
}
