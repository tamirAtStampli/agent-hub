import Anthropic from '@anthropic-ai/sdk';
import { BaseAdapter } from './base.js';
import type { AgentResponse, ConversationContext, AgentType } from '../core/types.js';
import { getAgentRegistry } from '../core/agent-registry.js';

/**
 * Claude API Adapter
 * Uses the Anthropic SDK to communicate with Claude models
 */
export class ClaudeApiAdapter extends BaseAdapter {
  id = 'claude';
  name = 'Claude';
  type: AgentType = 'claude';
  
  private client: Anthropic | null = null;

  private getClient(): Anthropic {
    if (!this.client) {
      const registry = getAgentRegistry();
      const agent = registry.getAgent(this.id);
      const apiKey = agent?.config.apiKey as string || process.env.ANTHROPIC_API_KEY;
      
      if (!apiKey) {
        throw new Error('ANTHROPIC_API_KEY not configured. Set it via CLI: agent-hub agents config claude --set apiKey=sk-ant-...');
      }
      
      this.client = new Anthropic({ apiKey });
    }
    return this.client;
  }

  private getModel(): string {
    const registry = getAgentRegistry();
    const agent = registry.getAgent(this.id);
    return (agent?.config.model as string) || 'claude-sonnet-4-20250514';
  }

  async isAvailable(): Promise<boolean> {
    try {
      const client = this.getClient();
      // Simple check - try to create a minimal message
      await client.messages.create({
        model: this.getModel(),
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Hi' }],
      });
      return true;
    } catch (error) {
      console.error('Claude availability check failed:', error);
      return false;
    }
  }

  async sendMessage(context: ConversationContext): Promise<AgentResponse> {
    try {
      const client = this.getClient();
      const model = this.getModel();

      // Get names of other agents in the room
      const registry = getAgentRegistry();
      const agentNames = context.messages
        .filter((m) => m.sender !== 'user')
        .map((m) => m.senderName)
        .filter((name, index, self) => self.indexOf(name) === index);
      agentNames.push(this.name);

      const systemPrompt = this.buildSystemPrompt(context, agentNames);
      const messages = this.formatHistory(context.messages);

      // Add other agent responses if in debate/consensus mode
      if (context.otherAgentResponses && context.otherAgentResponses.length > 0) {
        for (const response of context.otherAgentResponses) {
          messages.push({
            role: 'assistant',
            content: `[${response.senderName}]: ${response.content}`,
          });
        }
      }

      const response = await client.messages.create({
        model,
        max_tokens: 4096,
        system: systemPrompt,
        messages,
      });

      const content = response.content[0].type === 'text' 
        ? response.content[0].text 
        : '';

      const { content: cleanContent, confidence } = this.extractConfidence(content);

      return {
        content: cleanContent,
        confidence,
        metadata: {
          model,
          usage: response.usage,
          stopReason: response.stop_reason,
        },
      };
    } catch (error) {
      return {
        content: '',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async *streamMessage(context: ConversationContext): AsyncIterable<string> {
    const client = this.getClient();
    const model = this.getModel();

    const registry = getAgentRegistry();
    const agentNames = context.messages
      .filter((m) => m.sender !== 'user')
      .map((m) => m.senderName)
      .filter((name, index, self) => self.indexOf(name) === index);
    agentNames.push(this.name);

    const systemPrompt = this.buildSystemPrompt(context, agentNames);
    const messages = this.formatHistory(context.messages);

    const stream = client.messages.stream({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages,
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield event.delta.text;
      }
    }
  }
}
