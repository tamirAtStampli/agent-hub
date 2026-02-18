import type { Message, AgentAdapter, ConversationContext } from '../core/types.js';
import { getMessageRoom } from '../core/message-room.js';
import { getAgentRegistry } from '../core/agent-registry.js';

/**
 * Shared Room Mode
 * All agents respond in parallel, can see each other's responses
 * Best for: brainstorming, exploration, getting diverse perspectives
 */
export async function runSharedRoom(
  roomId: string,
  userMessage: string
): Promise<Message[]> {
  const messageRoom = getMessageRoom();
  const registry = getAgentRegistry();

  // Add user message
  const userMsg = messageRoom.addMessage({
    roomId,
    sender: 'user',
    senderName: 'User',
    content: userMessage,
  });

  // Get all ready agents
  const readyAgents = registry.getReadyAgents();
  if (readyAgents.length === 0) {
    console.warn('No agents are ready. Enable and configure at least one agent.');
    return [userMsg];
  }

  // Get room state for context
  const roomState = messageRoom.getRoomState(roomId);
  if (!roomState) {
    throw new Error(`Room not found: ${roomId}`);
  }

  // Build context for agents
  const context: ConversationContext = {
    roomId,
    mode: 'shared-room',
    messages: roomState.messages,
  };

  // Run all agents in parallel
  const responses = await Promise.all(
    readyAgents.map(async ({ agent, adapter }) => {
      try {
        const response = await adapter.sendMessage(context);
        
        if (response.error) {
          console.error(`Error from ${agent.name}:`, response.error);
          return null;
        }

        // Add agent's response to the room
        const msg = messageRoom.addMessage({
          roomId,
          sender: agent.type,
          senderName: agent.name,
          content: response.content,
          confidence: response.confidence,
          metadata: response.metadata,
        });

        return msg;
      } catch (error) {
        console.error(`Error from ${agent.name}:`, error);
        return null;
      }
    })
  );

  // Filter out failed responses
  const successfulResponses = responses.filter((r): r is Message => r !== null);

  return [userMsg, ...successfulResponses];
}

/**
 * Run a single turn in shared room mode (for interactive use)
 */
export async function runSharedRoomTurn(
  roomId: string,
  userMessage: string,
  onAgentResponse?: (agent: string, response: Message) => void
): Promise<Message[]> {
  const messageRoom = getMessageRoom();
  const registry = getAgentRegistry();

  // Add user message
  const userMsg = messageRoom.addMessage({
    roomId,
    sender: 'user',
    senderName: 'User',
    content: userMessage,
  });

  // Get all ready agents
  const readyAgents = registry.getReadyAgents();
  if (readyAgents.length === 0) {
    return [userMsg];
  }

  // Get room state for context
  const roomState = messageRoom.getRoomState(roomId);
  if (!roomState) {
    throw new Error(`Room not found: ${roomId}`);
  }

  const context: ConversationContext = {
    roomId,
    mode: 'shared-room',
    messages: roomState.messages,
  };

  const responses: Message[] = [userMsg];

  // Run agents in parallel but emit responses as they come
  await Promise.all(
    readyAgents.map(async ({ agent, adapter }) => {
      try {
        const response = await adapter.sendMessage(context);
        
        if (response.error) {
          console.error(`Error from ${agent.name}:`, response.error);
          return;
        }

        const msg = messageRoom.addMessage({
          roomId,
          sender: agent.type,
          senderName: agent.name,
          content: response.content,
          confidence: response.confidence,
          metadata: response.metadata,
        });

        responses.push(msg);
        onAgentResponse?.(agent.name, msg);
      } catch (error) {
        console.error(`Error from ${agent.name}:`, error);
      }
    })
  );

  return responses;
}
