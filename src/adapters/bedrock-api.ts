import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  InvokeModelWithResponseStreamCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { BaseAdapter } from './base.js';
import type { AgentResponse, ConversationContext, AgentType } from '../core/types.js';
import { getAgentRegistry } from '../core/agent-registry.js';

/**
 * Amazon Bedrock Adapter
 * Supports Claude, Titan, Llama, Mistral and other models via AWS
 */
export class BedrockApiAdapter extends BaseAdapter {
  id = 'bedrock';
  name = 'Amazon Bedrock';
  type: AgentType = 'custom';
  
  private client: BedrockRuntimeClient | null = null;

  private getClient(): BedrockRuntimeClient {
    if (!this.client) {
      const registry = getAgentRegistry();
      const agent = registry.getAgent(this.id);
      
      const region = (agent?.config.region as string) || process.env.AWS_REGION || 'us-east-1';
      
      this.client = new BedrockRuntimeClient({ region });
    }
    return this.client;
  }

  private getModelId(): string {
    const registry = getAgentRegistry();
    const agent = registry.getAgent(this.id);
    // Default to Claude 3 Sonnet on Bedrock
    return (agent?.config.model as string) || 'anthropic.claude-3-sonnet-20240229-v1:0';
  }

  async isAvailable(): Promise<boolean> {
    try {
      const client = this.getClient();
      // Try a minimal request to check availability
      const modelId = this.getModelId();
      
      // Build a minimal request based on model type
      const body = this.buildRequestBody('Hi', modelId);
      
      const command = new InvokeModelCommand({
        modelId,
        body: JSON.stringify(body),
        contentType: 'application/json',
        accept: 'application/json',
      });

      await client.send(command);
      return true;
    } catch (error) {
      console.error('Bedrock availability check failed:', error);
      return false;
    }
  }

  async sendMessage(context: ConversationContext): Promise<AgentResponse> {
    try {
      const client = this.getClient();
      const modelId = this.getModelId();

      const registry = getAgentRegistry();
      const agentNames = context.messages
        .filter((m) => m.sender !== 'user')
        .map((m) => m.senderName)
        .filter((name, index, self) => self.indexOf(name) === index);
      agentNames.push(this.name);

      const systemPrompt = this.buildSystemPrompt(context, agentNames);
      
      // Get the message to respond to (works for both user messages and agent discussions)
      const messageToRespond = this.getMessageToRespondTo(context);

      if (!messageToRespond) {
        return { content: '', error: 'No message to respond to' };
      }

      // Format history based on mode
      let messages: { role: string; content: string }[];
      
      if (context.mode === 'real-time-discussion') {
        // In discussion mode, include all history and add prompt to engage with latest message
        messages = this.formatDiscussionHistory(context);
      } else {
        // In other modes, format history EXCLUDING the last user message (it will be added by buildRequestBody)
        const historyWithoutLastUser = context.messages.filter(
          (m) => m.id !== messageToRespond.id
        );
        messages = this.formatHistory(historyWithoutLastUser);
      }

      // Add other agent responses if in debate/consensus mode
      if (context.otherAgentResponses && context.otherAgentResponses.length > 0) {
        for (const response of context.otherAgentResponses) {
          messages.push({
            role: 'assistant',
            content: `[${response.senderName}]: ${response.content}`,
          });
        }
      }

      // Merge consecutive messages with same role (required by Claude/Anthropic API)
      messages = this.mergeConsecutiveMessages(messages);
      
      // Ensure messages start with user role (required by Claude/Anthropic API)
      if (messages.length > 0 && messages[0].role !== 'user') {
        messages.unshift({ role: 'user', content: '[Conversation started]' });
      }

      // In discussion mode, the prompt is already embedded in the history
      // Otherwise, use the message content directly
      const promptContent = context.mode === 'real-time-discussion' 
        ? 'Please respond to the conversation above.'
        : messageToRespond.content;

      const body = this.buildRequestBody(
        promptContent,
        modelId,
        systemPrompt,
        messages
      );

      const command = new InvokeModelCommand({
        modelId,
        body: JSON.stringify(body),
        contentType: 'application/json',
        accept: 'application/json',
      });

      const response = await client.send(command);
      const responseBody = JSON.parse(new TextDecoder().decode(response.body));
      
      const content = this.extractContent(responseBody, modelId);
      const { content: cleanContent, confidence } = this.extractConfidence(content);

      return {
        content: cleanContent,
        confidence,
        metadata: {
          modelId,
          provider: 'bedrock',
        },
      };
    } catch (error) {
      return {
        content: '',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Merge consecutive messages with the same role
   * Required by Claude/Anthropic API which expects alternating user/assistant
   */
  private mergeConsecutiveMessages(
    messages: { role: string; content: string }[]
  ): { role: string; content: string }[] {
    if (messages.length === 0) return [];

    const merged: { role: string; content: string }[] = [];
    
    for (const msg of messages) {
      const last = merged[merged.length - 1];
      if (last && last.role === msg.role) {
        // Merge with previous message of same role
        last.content = `${last.content}\n\n${msg.content}`;
      } else {
        merged.push({ ...msg });
      }
    }

    return merged;
  }

  /**
   * Build request body based on model type
   */
  private buildRequestBody(
    prompt: string,
    modelId: string,
    systemPrompt?: string,
    history?: { role: string; content: string }[]
  ): Record<string, unknown> {
    // Claude models (Anthropic)
    if (modelId.startsWith('anthropic.claude')) {
      const messages = history || [];
      messages.push({ role: 'user', content: prompt });

      return {
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 4096,
        system: systemPrompt || '',
        messages: messages.map((m) => ({
          role: m.role === 'user' ? 'user' : 'assistant',
          content: m.content,
        })),
      };
    }

    // Amazon Titan models
    if (modelId.startsWith('amazon.titan')) {
      const fullPrompt = systemPrompt 
        ? `${systemPrompt}\n\n${this.formatHistoryAsText(history)}\nUser: ${prompt}\nAssistant:`
        : prompt;

      return {
        inputText: fullPrompt,
        textGenerationConfig: {
          maxTokenCount: 4096,
          temperature: 0.7,
          topP: 0.9,
        },
      };
    }

    // Meta Llama models
    if (modelId.startsWith('meta.llama')) {
      const fullPrompt = systemPrompt
        ? `<s>[INST] <<SYS>>\n${systemPrompt}\n<</SYS>>\n\n${this.formatHistoryAsText(history)}\n${prompt} [/INST]`
        : `<s>[INST] ${prompt} [/INST]`;

      return {
        prompt: fullPrompt,
        max_gen_len: 4096,
        temperature: 0.7,
        top_p: 0.9,
      };
    }

    // Mistral models
    if (modelId.startsWith('mistral.')) {
      const fullPrompt = systemPrompt
        ? `<s>[INST] ${systemPrompt}\n\n${this.formatHistoryAsText(history)}\n${prompt} [/INST]`
        : `<s>[INST] ${prompt} [/INST]`;

      return {
        prompt: fullPrompt,
        max_tokens: 4096,
        temperature: 0.7,
        top_p: 0.9,
      };
    }

    // Cohere models
    if (modelId.startsWith('cohere.')) {
      return {
        prompt: systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt,
        max_tokens: 4096,
        temperature: 0.7,
      };
    }

    // Default fallback (Claude-like format)
    return {
      prompt: systemPrompt ? `${systemPrompt}\n\nHuman: ${prompt}\n\nAssistant:` : `Human: ${prompt}\n\nAssistant:`,
      max_tokens_to_sample: 4096,
    };
  }

  /**
   * Extract content from response based on model type
   */
  private extractContent(responseBody: Record<string, unknown>, modelId: string): string {
    // Claude models
    if (modelId.startsWith('anthropic.claude')) {
      const content = responseBody.content as Array<{ type: string; text: string }>;
      return content?.[0]?.text || '';
    }

    // Titan models
    if (modelId.startsWith('amazon.titan')) {
      const results = responseBody.results as Array<{ outputText: string }>;
      return results?.[0]?.outputText || '';
    }

    // Llama models
    if (modelId.startsWith('meta.llama')) {
      return (responseBody.generation as string) || '';
    }

    // Mistral models
    if (modelId.startsWith('mistral.')) {
      const outputs = responseBody.outputs as Array<{ text: string }>;
      return outputs?.[0]?.text || '';
    }

    // Cohere models
    if (modelId.startsWith('cohere.')) {
      const generations = responseBody.generations as Array<{ text: string }>;
      return generations?.[0]?.text || '';
    }

    // Fallback
    return (responseBody.completion as string) || (responseBody.generation as string) || '';
  }

  /**
   * Format history as text for models that don't support message arrays
   */
  private formatHistoryAsText(history?: { role: string; content: string }[]): string {
    if (!history || history.length === 0) return '';
    
    return history
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n\n');
  }
}

/**
 * Available Bedrock model IDs
 */
export const BEDROCK_MODELS = {
  // Claude models
  'claude-3-sonnet': 'anthropic.claude-3-sonnet-20240229-v1:0',
  'claude-3-haiku': 'anthropic.claude-3-haiku-20240307-v1:0',
  'claude-3-opus': 'anthropic.claude-3-opus-20240229-v1:0',
  'claude-3.5-sonnet': 'anthropic.claude-3-5-sonnet-20240620-v1:0',
  'claude-instant': 'anthropic.claude-instant-v1',
  
  // Amazon Titan
  'titan-text-express': 'amazon.titan-text-express-v1',
  'titan-text-lite': 'amazon.titan-text-lite-v1',
  'titan-text-premier': 'amazon.titan-text-premier-v1:0',
  
  // Meta Llama
  'llama-3-8b': 'meta.llama3-8b-instruct-v1:0',
  'llama-3-70b': 'meta.llama3-70b-instruct-v1:0',
  'llama-2-13b': 'meta.llama2-13b-chat-v1',
  'llama-2-70b': 'meta.llama2-70b-chat-v1',
  
  // Mistral
  'mistral-7b': 'mistral.mistral-7b-instruct-v0:2',
  'mistral-large': 'mistral.mistral-large-2402-v1:0',
  'mixtral-8x7b': 'mistral.mixtral-8x7b-instruct-v0:1',
  
  // Cohere
  'cohere-command': 'cohere.command-text-v14',
  'cohere-command-light': 'cohere.command-light-text-v14',
};
