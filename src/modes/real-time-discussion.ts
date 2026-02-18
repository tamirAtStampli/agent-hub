import type { 
  Message, 
  DiscussionContext, 
  DiscussionState, 
  DiscussionConfig,
  HubEvent,
  AgentAdapter
} from '../core/types.js';
import { DEFAULT_DISCUSSION_CONFIG } from '../core/types.js';
import { getMessageRoom, parseMentions } from '../core/message-room.js';
import { getAgentRegistry } from '../core/agent-registry.js';

/**
 * Real-Time Discussion Mode
 * 
 * Agents interact dynamically like a group chat:
 * - Agents decide whether to respond (not forced)
 * - Agents can @mention specific agents
 * - Responses come in unpredictable order
 * - Cooldowns prevent infinite loops
 * - Concurrency limits prevent overload
 */

// Active discussion states (in-memory, synced with DB)
const activeDiscussions = new Map<string, DiscussionState>();

// Response queue for concurrency limiting
const responseQueues = new Map<string, Promise<void>[]>();

// Unsubscribe functions for message listeners
const unsubscribers = new Map<string, () => void>();

/**
 * Start a real-time discussion in a room
 */
export function startDiscussion(
  roomId: string, 
  config?: Partial<DiscussionConfig>
): DiscussionState {
  const messageRoom = getMessageRoom();
  const room = messageRoom.getRoom(roomId);
  
  if (!room) {
    throw new Error(`Room not found: ${roomId}`);
  }

  // Check if already active
  if (activeDiscussions.has(roomId)) {
    return activeDiscussions.get(roomId)!;
  }

  const fullConfig: DiscussionConfig = {
    ...DEFAULT_DISCUSSION_CONFIG,
    ...config,
  };

  const state: DiscussionState = {
    roomId,
    active: true,
    startedAt: new Date(),
    config: fullConfig,
    messageCount: messageRoom.getMessageCount(roomId),
    tokenCount: 0, // Would need actual token counting
    agentCooldowns: new Map(),
    agentMessageCounts: new Map(),
    currentTurnMessageCount: 0,
  };

  activeDiscussions.set(roomId, state);
  responseQueues.set(roomId, []);

  // Start message listener
  const unsubscribe = messageRoom.subscribe(roomId, (event) => {
    if (event.type === 'message') {
      handleNewMessage(roomId, event.data);
    }
  });
  unsubscribers.set(roomId, unsubscribe);

  // Update database
  messageRoom.startDiscussion(roomId, fullConfig);

  console.log(`[Discussion] Started in room ${roomId} with config:`, fullConfig);
  return state;
}

/**
 * Stop a real-time discussion
 */
export function stopDiscussion(roomId: string): void {
  const state = activeDiscussions.get(roomId);
  if (!state) return;

  state.active = false;
  activeDiscussions.delete(roomId);
  responseQueues.delete(roomId);

  // Unsubscribe from messages
  const unsubscribe = unsubscribers.get(roomId);
  if (unsubscribe) {
    unsubscribe();
    unsubscribers.delete(roomId);
  }

  // Update database
  const messageRoom = getMessageRoom();
  messageRoom.stopDiscussion(roomId);

  console.log(`[Discussion] Stopped in room ${roomId}`);
}

/**
 * Check if a discussion is active
 */
export function isDiscussionActive(roomId: string): boolean {
  return activeDiscussions.has(roomId) && activeDiscussions.get(roomId)!.active;
}

/**
 * Get discussion state
 */
export function getDiscussionState(roomId: string): DiscussionState | undefined {
  return activeDiscussions.get(roomId);
}

/**
 * Handle a new message in the discussion
 */
async function handleNewMessage(roomId: string, message: Message): Promise<void> {
  const state = activeDiscussions.get(roomId);
  if (!state || !state.active) return;

  // Update state
  state.messageCount++;

  // Reset turn counter if user message
  if (message.sender === 'user') {
    state.currentTurnMessageCount = 0;
    state.lastUserMessageAt = new Date();
  } else {
    state.currentTurnMessageCount++;
  }

  // Check budget limits
  if (state.config.budgetMaxMessages && state.messageCount >= state.config.budgetMaxMessages) {
    console.log(`[Discussion] Message budget reached in room ${roomId}`);
    stopDiscussion(roomId);
    return;
  }

  // Check turn message limit (prevent infinite agent loops)
  if (state.currentTurnMessageCount >= state.config.maxMessagesPerTurn) {
    console.log(`[Discussion] Turn message limit reached, waiting for user input`);
    return;
  }

  // Don't trigger agents for their own messages (but DO allow cross-agent discussion)
  // Agents can respond to other agents' messages to create a real discussion
  
  // Trigger agent responses (for both user messages and other agent messages)
  await triggerAgentResponses(roomId, message, state);
}

/**
 * Trigger agent responses to a message
 */
async function triggerAgentResponses(
  roomId: string, 
  message: Message, 
  state: DiscussionState
): Promise<void> {
  const registry = getAgentRegistry();
  const messageRoom = getMessageRoom();
  const readyAgents = registry.getReadyAgents();

  if (readyAgents.length === 0) {
    console.warn('[Discussion] No agents ready to respond');
    return;
  }

  // Get available agent IDs for mention parsing
  const agentIds = readyAgents.map(({ agent }) => agent.id);
  const mentions = message.mentions || parseMentions(message.content, agentIds);

  // Build context
  const roomState = messageRoom.getRoomState(roomId);
  if (!roomState) return;

  // Process each agent
  const agentPromises: Promise<void>[] = [];

  for (const { agent, adapter } of readyAgents) {
    // Skip if this agent sent the message (don't respond to self)
    if (message.sender === agent.id) {
      continue;
    }
    
    const isMentioned = mentions.includes(agent.id);

    // Check cooldown
    const lastResponse = state.agentCooldowns.get(agent.id);
    if (lastResponse) {
      const cooldownRemaining = state.config.agentCooldownMs - (Date.now() - lastResponse.getTime());
      if (cooldownRemaining > 0 && !isMentioned) {
        console.log(`[Discussion] ${agent.name} on cooldown for ${cooldownRemaining}ms`);
        continue;
      }
    }

    // Build discussion context
    const context: DiscussionContext = {
      roomId,
      mode: 'real-time-discussion',
      messages: roomState.messages,
      newMessage: message,
      isMentioned,
      mentionedAgents: mentions,
      discussionMessageCount: state.messageCount,
      agentMessageCount: state.agentMessageCounts.get(agent.id) || 0,
    };

    // Decide whether to respond
    const shouldRespond = isMentioned || (await adapter.shouldRespond?.(context) ?? false);
    
    if (!shouldRespond) {
      continue;
    }

    // Queue the response with concurrency limit
    const responsePromise = queueAgentResponse(
      roomId, 
      agent, 
      adapter, 
      context, 
      state,
      isMentioned
    );
    agentPromises.push(responsePromise);
  }

  // Wait for all queued responses
  await Promise.allSettled(agentPromises);
}

/**
 * Queue an agent response with concurrency limiting
 */
async function queueAgentResponse(
  roomId: string,
  agent: { id: string; name: string },
  adapter: AgentAdapter,
  context: DiscussionContext,
  state: DiscussionState,
  isMentioned: boolean
): Promise<void> {
  const queue = responseQueues.get(roomId) || [];
  responseQueues.set(roomId, queue);

  // Wait for queue slot (concurrency limit)
  while (queue.length >= state.config.maxConcurrentResponses) {
    await Promise.race(queue);
    // Clean up completed promises
    responseQueues.set(roomId, queue.filter(p => 
      !Promise.race([p, Promise.resolve('done')]).then(v => v === 'done')
    ));
  }

  // Add random delay for organic feel
  const delay = state.config.responseDelayMinMs + 
    Math.random() * (state.config.responseDelayMaxMs - state.config.responseDelayMinMs);

  const responsePromise = (async () => {
    try {
      // Wait for delay
      await new Promise(resolve => setTimeout(resolve, delay));

      // Check if discussion is still active
      if (!activeDiscussions.has(roomId)) return;

      // Check turn limit again (may have changed)
      const currentState = activeDiscussions.get(roomId)!;
      if (currentState.currentTurnMessageCount >= currentState.config.maxMessagesPerTurn) {
        console.log(`[Discussion] ${agent.name} skipped - turn limit reached`);
        return;
      }

      // Signal thinking
      const messageRoom = getMessageRoom();
      messageRoom.signalAgentThinking(roomId, agent.id, agent.name);

      // Get fresh context (messages may have changed)
      const freshRoomState = messageRoom.getRoomState(roomId);
      if (!freshRoomState) return;

      const freshContext: DiscussionContext = {
        ...context,
        messages: freshRoomState.messages,
      };

      // Get response
      console.log(`[Discussion] ${agent.name} responding${isMentioned ? ' (mentioned)' : ''}...`);
      const response = await adapter.sendMessage(freshContext);

      // Signal done thinking
      messageRoom.signalAgentDoneThinking(roomId, agent.id);

      if (response.error) {
        console.error(`[Discussion] Error from ${agent.name}:`, response.error);
        return;
      }

      if (!response.content || response.content.trim() === '') {
        console.log(`[Discussion] ${agent.name} chose not to respond`);
        return;
      }

      // Parse mentions in response
      const registry = getAgentRegistry();
      const agentIds = registry.getReadyAgents().map(({ agent }) => agent.id);
      const responseMentions = parseMentions(response.content, agentIds);

      // Add message
      messageRoom.addMessage({
        roomId,
        sender: agent.id,
        senderName: agent.name,
        content: response.content,
        confidence: response.confidence,
        mentions: responseMentions,
        metadata: response.metadata,
      });

      // Update state
      state.agentCooldowns.set(agent.id, new Date());
      state.agentMessageCounts.set(
        agent.id, 
        (state.agentMessageCounts.get(agent.id) || 0) + 1
      );

    } catch (error) {
      console.error(`[Discussion] Error from ${agent.name}:`, error);
      const messageRoom = getMessageRoom();
      messageRoom.signalAgentDoneThinking(roomId, agent.id);
    }
  })();

  queue.push(responsePromise);
  await responsePromise;

  // Remove from queue
  const idx = queue.indexOf(responsePromise);
  if (idx !== -1) queue.splice(idx, 1);
}

/**
 * Send a message to a discussion room (user message)
 * Returns after the message is added (agents respond asynchronously)
 */
export async function sendMessage(
  roomId: string, 
  content: string,
  forceAllRespond = false
): Promise<Message> {
  const messageRoom = getMessageRoom();
  const registry = getAgentRegistry();
  
  // Get available agent IDs for mention parsing
  const agentIds = registry.getReadyAgents().map(({ agent }) => agent.id);
  const mentions = parseMentions(content, agentIds);

  // Add user message
  const message = messageRoom.addMessage({
    roomId,
    sender: 'user',
    senderName: 'User',
    content,
    mentions,
  });

  // If forceAllRespond, trigger all agents (like shared-room mode)
  if (forceAllRespond) {
    const state = activeDiscussions.get(roomId);
    if (state) {
      // Temporarily set high turn limit
      const originalLimit = state.config.maxMessagesPerTurn;
      state.config.maxMessagesPerTurn = 100;
      state.currentTurnMessageCount = 0;
      
      // Force all agents by adding them to mentions
      const forcedMessage = { 
        ...message, 
        mentions: agentIds 
      };
      await triggerAgentResponses(roomId, forcedMessage, state);
      
      // Restore limit
      state.config.maxMessagesPerTurn = originalLimit;
    }
  }

  return message;
}

/**
 * Initialize discussions from database on startup
 */
export function initializeFromDatabase(): void {
  const messageRoom = getMessageRoom();
  const activeRooms = messageRoom.getActiveDiscussions();

  for (const room of activeRooms) {
    if (room.discussionActive && room.discussionConfig) {
      console.log(`[Discussion] Resuming discussion in room ${room.id}`);
      startDiscussion(room.id, room.discussionConfig);
    }
  }
}

/**
 * Get all active discussion room IDs
 */
export function getActiveDiscussionRoomIds(): string[] {
  return Array.from(activeDiscussions.keys());
}

// Aliases for backward compatibility
export { initializeFromDatabase as initializeDiscussions };
export { sendMessage as sendDiscussionMessage };
