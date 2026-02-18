import type { Room, Message, CollaborationMode, DebateConfig, ConsensusConfig, DiscussionConfig, DiscussionState } from './types.js';
import { getMessageRoom } from './message-room.js';
import { runSharedRoom, runSharedRoomTurn } from '../modes/shared-room.js';
import { runDebate, summarizeDebate } from '../modes/debate.js';
import { runConsensus, formatConsensusResult } from '../modes/consensus.js';
import { 
  startDiscussion, 
  stopDiscussion, 
  isDiscussionActive,
  getDiscussionState,
  sendDiscussionMessage,
  initializeDiscussions
} from '../modes/real-time-discussion.js';

/**
 * Collaboration Orchestrator
 * Manages different collaboration modes and coordinates agent responses
 */
export class Orchestrator {
  /**
   * Run a collaboration session based on the room's mode
   */
  async run(
    roomId: string,
    input: string,
    options?: {
      debateConfig?: Partial<DebateConfig>;
      consensusConfig?: Partial<ConsensusConfig>;
      discussionConfig?: Partial<DiscussionConfig>;
      forceAllRespond?: boolean;
    }
  ): Promise<{
    messages: Message[];
    result?: string;
    metadata?: Record<string, unknown>;
  }> {
    const messageRoom = getMessageRoom();
    const room = messageRoom.getRoom(roomId);
    
    if (!room) {
      throw new Error(`Room not found: ${roomId}`);
    }

    switch (room.mode) {
      case 'shared-room':
        return this.runSharedRoom(roomId, input);
      
      case 'structured-debate':
        return this.runDebate(roomId, input, options?.debateConfig);
      
      case 'consensus':
        return this.runConsensus(roomId, input, options?.consensusConfig);
      
      case 'real-time-discussion':
        return this.runDiscussion(roomId, input, options?.forceAllRespond);
      
      default:
        return this.runSharedRoom(roomId, input);
    }
  }

  /**
   * Shared Room Mode
   */
  private async runSharedRoom(
    roomId: string,
    input: string
  ): Promise<{ messages: Message[]; result?: string }> {
    const messages = await runSharedRoom(roomId, input);
    
    // The "result" is all agent responses combined
    const agentResponses = messages
      .filter((m) => m.sender !== 'user')
      .map((m) => `**${m.senderName}**: ${m.content}`)
      .join('\n\n');

    return {
      messages,
      result: agentResponses,
    };
  }

  /**
   * Structured Debate Mode
   */
  private async runDebate(
    roomId: string,
    topic: string,
    config?: Partial<DebateConfig>
  ): Promise<{ messages: Message[]; result?: string; metadata?: Record<string, unknown> }> {
    const debateResult = await runDebate(roomId, topic, config);
    const summary = summarizeDebate(debateResult.rounds);

    return {
      messages: debateResult.messages,
      result: debateResult.synthesis,
      metadata: {
        rounds: debateResult.rounds.length,
        summary,
      },
    };
  }

  /**
   * Consensus Mode
   */
  private async runConsensus(
    roomId: string,
    question: string,
    config?: Partial<ConsensusConfig>
  ): Promise<{ messages: Message[]; result?: string; metadata?: Record<string, unknown> }> {
    const consensusResult = await runConsensus(roomId, question, config);

    return {
      messages: consensusResult.allMessages,
      result: consensusResult.winner || formatConsensusResult(consensusResult),
      metadata: {
        reached: consensusResult.reached,
        confidence: consensusResult.confidence,
        votes: consensusResult.votes,
        rounds: consensusResult.round,
      },
    };
  }

  /**
   * Real-Time Discussion Mode
   * Sends a message and returns immediately - agents respond asynchronously
   */
  private async runDiscussion(
    roomId: string,
    input: string,
    forceAllRespond?: boolean
  ): Promise<{ messages: Message[]; result?: string; metadata?: Record<string, unknown> }> {
    // Ensure discussion is started
    if (!isDiscussionActive(roomId)) {
      startDiscussion(roomId);
    }

    // Send message (triggers async agent responses)
    const message = await sendDiscussionMessage(roomId, input, forceAllRespond);
    
    // Return current messages
    const messageRoom = getMessageRoom();
    const roomState = messageRoom.getRoomState(roomId);
    const state = getDiscussionState(roomId);

    return {
      messages: roomState?.messages || [message],
      result: 'Message sent - agents will respond asynchronously',
      metadata: {
        discussionActive: true,
        messageCount: state?.messageCount,
        forceAllRespond,
      },
    };
  }

  // ==========================================================================
  // Real-Time Discussion Management
  // ==========================================================================

  /**
   * Start a real-time discussion in a room
   */
  startRealTimeDiscussion(
    roomId: string, 
    config?: Partial<DiscussionConfig>
  ): DiscussionState {
    return startDiscussion(roomId, config);
  }

  /**
   * Stop a real-time discussion
   */
  stopRealTimeDiscussion(roomId: string): void {
    stopDiscussion(roomId);
  }

  /**
   * Check if a discussion is active
   */
  isRealTimeDiscussionActive(roomId: string): boolean {
    return isDiscussionActive(roomId);
  }

  /**
   * Get discussion state
   */
  getRealTimeDiscussionState(roomId: string): DiscussionState | undefined {
    return getDiscussionState(roomId);
  }

  /**
   * Initialize discussions from database (call on startup)
   */
  initializeDiscussions(): void {
    initializeDiscussions();
  }

  /**
   * Quick discussion - creates a room and starts a discussion
   */
  async quickDiscussion(
    firstMessage: string,
    config?: Partial<DiscussionConfig>
  ): Promise<{
    roomId: string;
    messages: Message[];
    state: DiscussionState;
  }> {
    const messageRoom = getMessageRoom();
    const room = messageRoom.createRoom({
      name: `Discussion - ${new Date().toISOString()}`,
      mode: 'real-time-discussion',
    });

    const state = startDiscussion(room.id, config);
    
    // Send first message
    const message = await sendDiscussionMessage(room.id, firstMessage);
    
    const roomState = messageRoom.getRoomState(room.id);

    return {
      roomId: room.id,
      messages: roomState?.messages || [message],
      state,
    };
  }

  /**
   * Quick ask - creates a temporary room, runs shared mode, returns result
   */
  async quickAsk(question: string): Promise<{
    messages: Message[];
    result: string;
  }> {
    const messageRoom = getMessageRoom();
    const room = messageRoom.createRoom({
      name: `Quick Ask - ${new Date().toISOString()}`,
      mode: 'shared-room',
    });

    const result = await this.runSharedRoom(room.id, question);
    return {
      messages: result.messages,
      result: result.result || '',
    };
  }

  /**
   * Quick debate - creates a temporary room, runs debate, returns result
   */
  async quickDebate(
    topic: string,
    config?: Partial<DebateConfig>
  ): Promise<{
    messages: Message[];
    synthesis?: string;
    summary: ReturnType<typeof summarizeDebate>;
  }> {
    const messageRoom = getMessageRoom();
    const room = messageRoom.createRoom({
      name: `Debate - ${topic.slice(0, 50)}`,
      mode: 'structured-debate',
    });

    const debateResult = await runDebate(room.id, topic, config);
    const summary = summarizeDebate(debateResult.rounds);

    return {
      messages: debateResult.messages,
      synthesis: debateResult.synthesis,
      summary,
    };
  }

  /**
   * Quick consensus - creates a temporary room, runs consensus, returns result
   */
  async quickConsensus(
    question: string,
    config?: Partial<ConsensusConfig>
  ): Promise<{
    reached: boolean;
    answer?: string;
    confidence: number;
    votes: { agent: string; answer: string; confidence: number }[];
  }> {
    const messageRoom = getMessageRoom();
    const room = messageRoom.createRoom({
      name: `Consensus - ${question.slice(0, 50)}`,
      mode: 'consensus',
    });

    const result = await runConsensus(room.id, question, config);

    return {
      reached: result.reached,
      answer: result.winner,
      confidence: result.confidence,
      votes: result.votes,
    };
  }
}

// Singleton instance
let orchestratorInstance: Orchestrator | null = null;

export function getOrchestrator(): Orchestrator {
  if (!orchestratorInstance) {
    orchestratorInstance = new Orchestrator();
  }
  return orchestratorInstance;
}
