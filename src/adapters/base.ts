import type { AgentAdapter, AgentHealth, ConversationContext, AgentResponse, AgentType, Message, CollaborationMode, DiscussionContext } from '../core/types.js';

/**
 * Base adapter class with common functionality
 */
export abstract class BaseAdapter implements AgentAdapter {
  abstract id: string;
  abstract name: string;
  abstract type: AgentType;

  abstract isAvailable(): Promise<boolean>;
  abstract sendMessage(context: ConversationContext): Promise<AgentResponse>;

  /**
   * Decide whether to respond in real-time discussion mode.
   * Default implementation uses probabilistic decision:
   * - Always respond if @mentioned
   * - 80% chance to respond to user messages
   * - 50% chance to respond to other agent messages (enables real discussions)
   * 
   * Subclasses can override for more sophisticated decision making.
   */
  async shouldRespond(context: DiscussionContext): Promise<boolean> {
    // Always respond if mentioned
    if (context.isMentioned) {
      return true;
    }

    const isUserMessage = context.newMessage.sender === 'user';
    const isFromSelf = context.newMessage.sender === this.id || 
                       context.newMessage.senderName === this.name;
    
    // Never respond to own messages
    if (isFromSelf) {
      return false;
    }
    
    // Higher probability for user messages, but still engage with agents
    const probability = isUserMessage ? 0.8 : 0.5;
    
    // Add some randomness based on conversation activity
    // Less likely to respond if we've already responded recently
    const myRecentMessages = context.messages
      .filter(m => m.sender === this.id || m.senderName === this.name)
      .slice(-3);
    
    // Reduce probability if we've responded a lot recently (prevents infinite loops)
    const adjustedProbability = probability * Math.pow(0.6, myRecentMessages.length);
    
    return Math.random() < adjustedProbability;
  }

  async checkHealth(): Promise<AgentHealth> {
    const startTime = Date.now();
    try {
      const available = await this.isAvailable();
      const latencyMs = Date.now() - startTime;
      return {
        agentId: this.id,
        status: available ? 'healthy' : 'unhealthy',
        latencyMs,
        lastChecked: new Date(),
      };
    } catch (error) {
      return {
        agentId: this.id,
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error',
        lastChecked: new Date(),
      };
    }
  }

  /**
   * Build a system prompt based on collaboration mode
   */
  protected buildSystemPrompt(context: ConversationContext, agentNames: string[]): string {
    const otherAgents = agentNames.filter((n) => n !== this.name).join(', ');

    switch (context.mode) {
      case 'shared-room':
        return this.buildSharedRoomPrompt(otherAgents);
      case 'structured-debate':
        return this.buildDebatePrompt(context, otherAgents);
      case 'consensus':
        return this.buildConsensusPrompt(context, otherAgents);
      case 'real-time-discussion':
        return this.buildDiscussionPrompt(context, otherAgents);
      default:
        return this.buildSharedRoomPrompt(otherAgents);
    }
  }

  private buildSharedRoomPrompt(otherAgents: string): string {
    return `You are ${this.name}, participating in a collaborative AI discussion room.
Other AI agents in this room: ${otherAgents || 'none yet'}.

You can see what others have said and should:
- Build on good ideas from other agents
- Respectfully disagree when you have a different perspective
- Avoid repeating what others have already said
- Add unique value based on your strengths
- Be concise and focused

When responding, get straight to the point. Don't introduce yourself or explain that you're an AI.`;
  }

  private buildDebatePrompt(context: ConversationContext, otherAgents: string): string {
    const round = context.currentRound || 1;
    const total = context.totalRounds || 4;

    return `You are ${this.name} in a structured debate with other AI agents.
This is round ${round} of ${total}.

OTHER AGENTS: ${otherAgents || 'none'}

RULES:
- Present your strongest argument with clear reasoning
- Directly engage with other agents' points (agree/disagree with specifics)
- If you find a flaw in your previous reasoning, acknowledge it
- At the end of your response, provide a confidence score from 0.0 to 1.0 in the format: [CONFIDENCE: 0.X]

${round === 1 ? 'This is the first round - present your initial position.' : ''}
${round === total ? 'This is the final round - synthesize the best ideas from all agents.' : ''}

Be direct and substantive. No pleasantries or meta-commentary.`;
  }

  private buildConsensusPrompt(context: ConversationContext, otherAgents: string): string {
    const hasOtherResponses = context.otherAgentResponses && context.otherAgentResponses.length > 0;
    
    let otherResponsesText = '';
    if (hasOtherResponses) {
      otherResponsesText = '\n\nOther agents have provided these answers:\n' +
        context.otherAgentResponses!.map((m) => 
          `- ${m.senderName}: "${m.content.slice(0, 200)}${m.content.length > 200 ? '...' : ''}" (confidence: ${m.confidence ?? 'not specified'})`
        ).join('\n');
    }

    return `You are ${this.name} participating in a consensus-building exercise.
Other agents: ${otherAgents || 'none'}
${otherResponsesText}

Your task:
1. Provide your answer to the question
2. At the end, provide a confidence score (0.0 to 1.0) in the format: [CONFIDENCE: 0.X]
3. If you disagree with the current majority, explain why
4. If you're uncertain, say so - it helps the voting process

Be concise and direct. Focus on the substance.`;
  }

  private buildDiscussionPrompt(context: ConversationContext, otherAgents: string): string {
    // Check if this is a DiscussionContext with mention info
    const discussionContext = context as DiscussionContext;
    const isMentioned = discussionContext.isMentioned;
    const newMessage = discussionContext.newMessage;

    let mentionText = '';
    if (isMentioned && newMessage) {
      mentionText = `\n\nNOTE: You were specifically @mentioned by ${newMessage.senderName}. Make sure to respond to them.`;
    }

    return `You are ${this.name}, participating in a group discussion with other AI agents: ${otherAgents || 'none'}
${mentionText}

YOUR TASK:
Respond to the discussion. You can engage with ANY point made by any agent, not just the most recent one.

RULES:
- Reference agents BY NAME when responding to their points (e.g., "I agree with Claude's point about X, but...")
- Be specific - explain WHY you agree or disagree
- You can challenge ideas, build on them, or point out something everyone missed
- Keep responses concise (2-4 sentences)
- Add something NEW to the discussion - don't just repeat what others said
- Don't introduce yourself or be overly agreeable`;
  }

  /**
   * Format conversation history for the model
   */
  protected formatHistory(messages: Message[]): { role: 'user' | 'assistant'; content: string }[] {
    return messages.map((m) => ({
      role: m.sender === 'user' ? 'user' as const : 'assistant' as const,
      content: m.sender === 'user' ? m.content : `[${m.senderName}]: ${m.content}`,
    }));
  }

  /**
   * Format conversation for discussion mode - shows full context and encourages engaging with all points
   */
  protected formatDiscussionHistory(context: ConversationContext): { role: 'user' | 'assistant'; content: string }[] {
    const messages = this.formatHistory(context.messages);
    
    // Get names of agents who have participated
    const agentNames = [...new Set(
      context.messages
        .filter(m => m.sender !== 'user')
        .map(m => m.senderName)
    )].filter(name => name !== this.name);
    
    // Add a prompt to engage with the full discussion
    if (agentNames.length > 0) {
      messages.push({
        role: 'user',
        content: `[The agents above (${agentNames.join(', ')}) have shared their perspectives. Now it's your turn to respond. You can agree/disagree with ANY of the points made - reference agents by name when responding to their specific arguments.]`,
      });
    }
    
    return messages;
  }

  /**
   * Get the message to respond to (handles both user messages and agent-to-agent discussions)
   */
  protected getMessageToRespondTo(context: ConversationContext): Message | null {
    const discussionContext = context as DiscussionContext;
    
    // In discussion mode, respond to the new message (could be from user or another agent)
    if (context.mode === 'real-time-discussion' && discussionContext.newMessage) {
      return discussionContext.newMessage;
    }
    
    // Otherwise, get the last user message
    return context.messages.filter((m) => m.sender === 'user').pop() || null;
  }

  /**
   * Extract confidence score from response
   */
  protected extractConfidence(content: string): { content: string; confidence?: number } {
    const match = content.match(/\[CONFIDENCE:\s*([\d.]+)\]/i);
    if (match) {
      const confidence = parseFloat(match[1]);
      const cleanContent = content.replace(/\[CONFIDENCE:\s*[\d.]+\]/gi, '').trim();
      return { content: cleanContent, confidence: Math.min(1, Math.max(0, confidence)) };
    }
    return { content };
  }
}
