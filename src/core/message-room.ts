import { v4 as uuidv4 } from 'uuid';
import type { Room, Message, CollaborationMode, HubEvent, EventHandler, RoomState, DiscussionConfig, DiscussionState } from './types.js';
import { DEFAULT_DISCUSSION_CONFIG } from './types.js';
import * as db from './database.js';

/**
 * Parse @mentions from message content
 * Supports formats: @agentname, @agent-name, @agent_name
 * Returns array of agent IDs (lowercase, normalized)
 */
export function parseMentions(content: string, availableAgentIds: string[]): string[] {
  // Match @word patterns (supporting hyphens and underscores)
  const mentionPattern = /@([\w-]+)/gi;
  const matches = content.matchAll(mentionPattern);
  const mentions: string[] = [];

  for (const match of matches) {
    const mentionedName = match[1].toLowerCase();
    // Find matching agent ID (case-insensitive)
    const matchedAgent = availableAgentIds.find(
      (id) => id.toLowerCase() === mentionedName || 
              id.toLowerCase().replace(/[-_]/g, '') === mentionedName.replace(/[-_]/g, '')
    );
    if (matchedAgent && !mentions.includes(matchedAgent)) {
      mentions.push(matchedAgent);
    }
  }

  return mentions;
}

/**
 * MessageRoom manages rooms and messages with real-time pub/sub functionality.
 * This is the central hub where all agent communication happens.
 */
export class MessageRoom {
  private subscribers: Map<string, Set<EventHandler>> = new Map();
  private globalSubscribers: Set<EventHandler> = new Set();

  /**
   * Create a new collaboration room
   */
  createRoom(options: {
    name: string;
    mode?: CollaborationMode;
    agents?: string[];
  }): Room {
    const room: Room = {
      id: uuidv4(),
      name: options.name,
      mode: options.mode || 'shared-room',
      agents: options.agents || [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    db.insertRoom(room);
    this.emit({ type: 'room_created', data: room });
    return room;
  }

  /**
   * Get a room by ID
   */
  getRoom(id: string): Room | null {
    return db.getRoom(id);
  }

  /**
   * Get all rooms
   */
  getAllRooms(): Room[] {
    return db.getAllRooms();
  }

  /**
   * Get the full state of a room (room + messages)
   */
  getRoomState(roomId: string): RoomState | null {
    const room = db.getRoom(roomId);
    if (!room) return null;

    const messages = db.getMessagesForRoom(roomId);
    return { room, messages };
  }

  /**
   * Update room configuration
   */
  updateRoom(roomId: string, updates: {
    name?: string;
    mode?: CollaborationMode;
    agents?: string[];
  }): Room {
    db.updateRoom(roomId, updates);
    const room = db.getRoom(roomId)!;
    
    if (updates.mode) {
      this.emit({ type: 'mode_changed', data: { roomId, mode: updates.mode } });
    }
    
    return room;
  }

  /**
   * Add an agent to a room
   */
  addAgentToRoom(roomId: string, agentId: string): void {
    const room = db.getRoom(roomId);
    if (!room) throw new Error(`Room not found: ${roomId}`);

    if (!room.agents.includes(agentId)) {
      room.agents.push(agentId);
      db.updateRoom(roomId, { agents: room.agents });
      this.emit({ type: 'agent_joined', data: { agentId, roomId } });
    }
  }

  /**
   * Remove an agent from a room
   */
  removeAgentFromRoom(roomId: string, agentId: string): void {
    const room = db.getRoom(roomId);
    if (!room) throw new Error(`Room not found: ${roomId}`);

    room.agents = room.agents.filter((id) => id !== agentId);
    db.updateRoom(roomId, { agents: room.agents });
    this.emit({ type: 'agent_left', data: { agentId, roomId } });
  }

  /**
   * Delete a room and all its messages
   */
  deleteRoom(roomId: string): void {
    db.deleteRoom(roomId);
    this.emit({ type: 'room_closed', data: { roomId } });
    this.subscribers.delete(roomId);
  }

  /**
   * Add a message to a room
   */
  addMessage(options: {
    roomId: string;
    sender: string;
    senderName: string;
    content: string;
    replyTo?: string;
    confidence?: number;
    mentions?: string[];
    metadata?: Record<string, unknown>;
  }): Message {
    const message: Message = {
      id: uuidv4(),
      roomId: options.roomId,
      sender: options.sender,
      senderName: options.senderName,
      content: options.content,
      timestamp: new Date(),
      replyTo: options.replyTo,
      confidence: options.confidence,
      mentions: options.mentions,
      metadata: options.metadata,
    };

    db.insertMessage(message);
    this.emit({ type: 'message', data: message });
    return message;
  }

  /**
   * Get messages for a room
   */
  getMessages(roomId: string, limit?: number): Message[] {
    return db.getMessagesForRoom(roomId, limit);
  }

  /**
   * Get the latest N messages from a room
   */
  getLatestMessages(roomId: string, count: number): Message[] {
    return db.getLatestMessages(roomId, count);
  }

  /**
   * Subscribe to events for a specific room
   */
  subscribe(roomId: string, handler: EventHandler): () => void {
    if (!this.subscribers.has(roomId)) {
      this.subscribers.set(roomId, new Set());
    }
    this.subscribers.get(roomId)!.add(handler);

    // Return unsubscribe function
    return () => {
      this.subscribers.get(roomId)?.delete(handler);
    };
  }

  /**
   * Subscribe to all events (global)
   */
  subscribeAll(handler: EventHandler): () => void {
    this.globalSubscribers.add(handler);
    return () => {
      this.globalSubscribers.delete(handler);
    };
  }

  /**
   * Emit an event to subscribers
   */
  private emit(event: HubEvent): void {
    // Notify global subscribers
    for (const handler of this.globalSubscribers) {
      try {
        handler(event);
      } catch (error) {
        console.error('Error in global event handler:', error);
      }
    }

    // Notify room-specific subscribers
    if ('roomId' in event.data) {
      const roomId = event.data.roomId as string;
      const roomSubscribers = this.subscribers.get(roomId);
      if (roomSubscribers) {
        for (const handler of roomSubscribers) {
          try {
            handler(event);
          } catch (error) {
            console.error('Error in room event handler:', error);
          }
        }
      }
    }

    // For message events, also notify by the message's roomId
    if (event.type === 'message') {
      const roomId = event.data.roomId;
      const roomSubscribers = this.subscribers.get(roomId);
      if (roomSubscribers) {
        for (const handler of roomSubscribers) {
          try {
            handler(event);
          } catch (error) {
            console.error('Error in room event handler:', error);
          }
        }
      }
    }
  }

  /**
   * Get messages from a specific round (for debate mode)
   */
  getMessagesForRound(roomId: string, round: number): Message[] {
    const messages = db.getMessagesForRoom(roomId);
    return messages.filter(
      (m) => m.metadata?.round === round
    );
  }

  /**
   * Get the latest message from each agent in a room
   */
  getLatestFromEachAgent(roomId: string): Map<string, Message> {
    const messages = db.getMessagesForRoom(roomId);
    const latest = new Map<string, Message>();

    // Messages are sorted by timestamp ASC, so later messages overwrite
    for (const message of messages) {
      if (message.sender !== 'user') {
        latest.set(message.sender, message);
      }
    }

    return latest;
  }

  /**
   * Signal the start of a new round (for debate mode)
   */
  signalRoundStart(roomId: string, round: number, total: number): void {
    this.emit({ type: 'round_started', data: { roomId, round, total } });
  }

  /**
   * Signal that consensus was reached
   */
  signalConsensusReached(roomId: string, result: string, confidence: number): void {
    this.emit({ type: 'consensus_reached', data: { roomId, result, confidence } });
  }

  // ==========================================================================
  // Real-Time Discussion Methods
  // ==========================================================================

  /**
   * Start a real-time discussion in a room
   */
  startDiscussion(roomId: string, config?: Partial<DiscussionConfig>): void {
    const room = db.getRoom(roomId);
    if (!room) throw new Error(`Room not found: ${roomId}`);

    const fullConfig: DiscussionConfig = {
      ...DEFAULT_DISCUSSION_CONFIG,
      ...config,
    };

    db.updateRoom(roomId, {
      mode: 'real-time-discussion',
      discussionActive: true,
      discussionConfig: fullConfig,
    });

    this.emit({ type: 'discussion_started', data: { roomId, config: fullConfig } });
    this.emit({ type: 'mode_changed', data: { roomId, mode: 'real-time-discussion' } });
  }

  /**
   * Stop a real-time discussion in a room
   */
  stopDiscussion(roomId: string): void {
    const room = db.getRoom(roomId);
    if (!room) throw new Error(`Room not found: ${roomId}`);

    db.updateRoom(roomId, {
      discussionActive: false,
    });

    this.emit({ type: 'discussion_stopped', data: { roomId } });
  }

  /**
   * Check if a discussion is active in a room
   */
  isDiscussionActive(roomId: string): boolean {
    const room = db.getRoom(roomId);
    return room?.discussionActive ?? false;
  }

  /**
   * Get all rooms with active discussions
   */
  getActiveDiscussions(): Room[] {
    return db.getRoomsWithActiveDiscussions();
  }

  /**
   * Get messages since a specific timestamp
   */
  getMessagesSince(roomId: string, since: Date): Message[] {
    return db.getMessagesSince(roomId, since);
  }

  /**
   * Get message count for a room
   */
  getMessageCount(roomId: string): number {
    return db.getMessageCount(roomId);
  }

  /**
   * Signal that an agent is thinking/processing
   */
  signalAgentThinking(roomId: string, agentId: string, agentName: string): void {
    this.emit({ type: 'agent_thinking', data: { roomId, agentId, agentName } });
  }

  /**
   * Signal that an agent is done thinking
   */
  signalAgentDoneThinking(roomId: string, agentId: string): void {
    this.emit({ type: 'agent_done_thinking', data: { roomId, agentId } });
  }

  /**
   * Emit an event publicly (for modes to use)
   */
  emitEvent(event: HubEvent): void {
    this.emit(event);
  }
}

// Singleton instance
let messageRoomInstance: MessageRoom | null = null;

export function getMessageRoom(): MessageRoom {
  if (!messageRoomInstance) {
    messageRoomInstance = new MessageRoom();
  }
  return messageRoomInstance;
}
