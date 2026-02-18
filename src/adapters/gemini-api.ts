import { GoogleGenerativeAI } from '@google/generative-ai';
import { BaseAdapter } from './base.js';
import type { AgentResponse, ConversationContext, AgentType } from '../core/types.js';
import { getAgentRegistry } from '../core/agent-registry.js';

/**
 * Gemini API Adapter
 * Uses the Google Generative AI SDK to communicate with Gemini models
 */
export class GeminiApiAdapter extends BaseAdapter {
  id = 'gemini';
  name = 'Gemini';
  type: AgentType = 'gemini';
  
  private client: GoogleGenerativeAI | null = null;

  private getClient(): GoogleGenerativeAI {
    if (!this.client) {
      const registry = getAgentRegistry();
      const agent = registry.getAgent(this.id);
      const apiKey = agent?.config.apiKey as string || process.env.GOOGLE_API_KEY;
      
      if (!apiKey) {
        throw new Error('GOOGLE_API_KEY not configured. Set it via CLI: agent-hub agents config gemini --set apiKey=...');
      }
      
      this.client = new GoogleGenerativeAI(apiKey);
    }
    return this.client;
  }

  private getModel(): string {
    const registry = getAgentRegistry();
    const agent = registry.getAgent(this.id);
    return (agent?.config.model as string) || 'gemini-1.5-pro';
  }

  async isAvailable(): Promise<boolean> {
    try {
      const client = this.getClient();
      const model = client.getGenerativeModel({ model: this.getModel() });
      await model.generateContent('Hi');
      return true;
    } catch (error) {
      console.error('Gemini availability check failed:', error);
      return false;
    }
  }

  async sendMessage(context: ConversationContext): Promise<AgentResponse> {
    try {
      const client = this.getClient();
      const modelName = this.getModel();

      const registry = getAgentRegistry();
      const agentNames = context.messages
        .filter((m) => m.sender !== 'user')
        .map((m) => m.senderName)
        .filter((name, index, self) => self.indexOf(name) === index);
      agentNames.push(this.name);

      const systemPrompt = this.buildSystemPrompt(context, agentNames);
      
      // Format history for Gemini
      const history = context.messages.map((m) => ({
        role: m.sender === 'user' ? 'user' as const : 'model' as const,
        parts: [{ text: m.sender === 'user' ? m.content : `[${m.senderName}]: ${m.content}` }],
      }));

      // Add other agent responses if in debate/consensus mode
      if (context.otherAgentResponses && context.otherAgentResponses.length > 0) {
        for (const response of context.otherAgentResponses) {
          history.push({
            role: 'model',
            parts: [{ text: `[${response.senderName}]: ${response.content}` }],
          });
        }
      }

      const model = client.getGenerativeModel({ 
        model: modelName,
        systemInstruction: systemPrompt,
      });

      // Get the last user message
      const lastUserMessage = context.messages
        .filter((m) => m.sender === 'user')
        .pop();

      if (!lastUserMessage) {
        return { content: '', error: 'No user message found' };
      }

      // Create chat with history (excluding the last message)
      const chat = model.startChat({
        history: history.slice(0, -1),
      });

      const result = await chat.sendMessage(lastUserMessage.content);
      const content = result.response.text();
      const { content: cleanContent, confidence } = this.extractConfidence(content);

      return {
        content: cleanContent,
        confidence,
        metadata: {
          model: modelName,
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
    const modelName = this.getModel();

    const registry = getAgentRegistry();
    const agentNames = context.messages
      .filter((m) => m.sender !== 'user')
      .map((m) => m.senderName)
      .filter((name, index, self) => self.indexOf(name) === index);
    agentNames.push(this.name);

    const systemPrompt = this.buildSystemPrompt(context, agentNames);
    
    const history = context.messages.map((m) => ({
      role: m.sender === 'user' ? 'user' as const : 'model' as const,
      parts: [{ text: m.sender === 'user' ? m.content : `[${m.senderName}]: ${m.content}` }],
    }));

    const model = client.getGenerativeModel({ 
      model: modelName,
      systemInstruction: systemPrompt,
    });

    const lastUserMessage = context.messages
      .filter((m) => m.sender === 'user')
      .pop();

    if (!lastUserMessage) {
      return;
    }

    const chat = model.startChat({
      history: history.slice(0, -1),
    });

    const result = await chat.sendMessageStream(lastUserMessage.content);

    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) {
        yield text;
      }
    }
  }
}
