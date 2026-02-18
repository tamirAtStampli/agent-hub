import OpenAI from 'openai';
import { BaseAdapter } from './base.js';
import type { AgentResponse, ConversationContext, AgentType } from '../core/types.js';
import { getAgentRegistry } from '../core/agent-registry.js';

/**
 * ChatGPT API Adapter
 * Uses the OpenAI SDK to communicate with GPT models
 */
export class ChatGptApiAdapter extends BaseAdapter {
  id = 'chatgpt';
  name = 'ChatGPT';
  type: AgentType = 'chatgpt';
  
  private client: OpenAI | null = null;

  private getClient(): OpenAI {
    if (!this.client) {
      const registry = getAgentRegistry();
      const agent = registry.getAgent(this.id);
      const apiKey = agent?.config.apiKey as string || process.env.OPENAI_API_KEY;
      
      if (!apiKey) {
        throw new Error('OPENAI_API_KEY not configured. Set it via CLI: agent-hub agents config chatgpt --set apiKey=sk-...');
      }
      
      this.client = new OpenAI({ apiKey });
    }
    return this.client;
  }

  private getModel(): string {
    const registry = getAgentRegistry();
    const agent = registry.getAgent(this.id);
    return (agent?.config.model as string) || 'gpt-4o';
  }

  async isAvailable(): Promise<boolean> {
    try {
      const client = this.getClient();
      await client.chat.completions.create({
        model: this.getModel(),
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Hi' }],
      });
      return true;
    } catch (error) {
      console.error('ChatGPT availability check failed:', error);
      return false;
    }
  }

  async sendMessage(context: ConversationContext): Promise<AgentResponse> {
    try {
      const client = this.getClient();
      const model = this.getModel();

      const registry = getAgentRegistry();
      const agentNames = context.messages
        .filter((m) => m.sender !== 'user')
        .map((m) => m.senderName)
        .filter((name, index, self) => self.indexOf(name) === index);
      agentNames.push(this.name);

      const systemPrompt = this.buildSystemPrompt(context, agentNames);
      const history = this.formatHistory(context.messages);

      const messages: OpenAI.ChatCompletionMessageParam[] = [
        { role: 'system', content: systemPrompt },
        ...history.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
      ];

      // Add other agent responses if in debate/consensus mode
      if (context.otherAgentResponses && context.otherAgentResponses.length > 0) {
        for (const response of context.otherAgentResponses) {
          messages.push({
            role: 'assistant',
            content: `[${response.senderName}]: ${response.content}`,
          });
        }
      }

      const response = await client.chat.completions.create({
        model,
        max_tokens: 4096,
        messages,
      });

      const content = response.choices[0]?.message?.content || '';
      const { content: cleanContent, confidence } = this.extractConfidence(content);

      return {
        content: cleanContent,
        confidence,
        metadata: {
          model,
          usage: response.usage,
          finishReason: response.choices[0]?.finish_reason,
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
    const history = this.formatHistory(context.messages);

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...history.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    ];

    const stream = await client.chat.completions.create({
      model,
      max_tokens: 4096,
      messages,
      stream: true,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        yield delta;
      }
    }
  }
}
