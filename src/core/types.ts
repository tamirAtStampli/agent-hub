import { z } from 'zod';

// ============================================================================
// Agent Types
// ============================================================================

export type AgentType = 
  | 'claude'
  | 'chatgpt'
  | 'gemini'
  | 'codex'
  | 'claude-code'
  | 'custom';

export const AgentTypeSchema = z.enum([
  'claude',
  'chatgpt', 
  'gemini',
  'codex',
  'claude-code',
  'custom'
]);

export interface AgentConfig {
  id: string;
  name: string;
  type: AgentType;
  enabled: boolean;
  config: {
    apiKey?: string;
    model?: string;
    baseUrl?: string;
    cliPath?: string;
    [key: string]: unknown;
  };
  adapterPath?: string; // For custom plugins
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentHealth {
  agentId: string;
  status: 'healthy' | 'unhealthy' | 'disabled' | 'unknown';
  latencyMs?: number;
  error?: string;
  lastChecked: Date;
}

// ============================================================================
// Message Types
// ============================================================================

export interface Message {
  id: string;
  roomId: string;
  sender: 'user' | AgentType | string;
  senderName: string;
  content: string;
  timestamp: Date;
  replyTo?: string;
  confidence?: number; // For consensus mode
  mentions?: string[]; // Agent IDs that were @mentioned
  metadata?: Record<string, unknown>;
}

export const MessageSchema = z.object({
  id: z.string(),
  roomId: z.string(),
  sender: z.string(),
  senderName: z.string(),
  content: z.string(),
  timestamp: z.date(),
  replyTo: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  mentions: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

// ============================================================================
// Room Types
// ============================================================================

export type CollaborationMode = 
  | 'shared-room'           // All agents respond in parallel
  | 'structured-debate'     // Multi-round debate with synthesis
  | 'consensus'             // Confidence-weighted voting
  | 'real-time-discussion'  // Dynamic chat - agents decide when to respond
  | 'delegation'            // Agents can assign tasks to each other
  | 'moderated';            // User controls who speaks

export const CollaborationModeSchema = z.enum([
  'shared-room',
  'structured-debate',
  'consensus',
  'real-time-discussion',
  'delegation',
  'moderated'
]);

export interface Room {
  id: string;
  name: string;
  mode: CollaborationMode;
  agents: string[]; // Agent IDs
  createdAt: Date;
  updatedAt: Date;
  metadata?: Record<string, unknown>;
  // Discussion mode state (persisted)
  discussionActive?: boolean;
  discussionConfig?: DiscussionConfig;
}

export interface RoomState {
  room: Room;
  messages: Message[];
  currentRound?: number;
  totalRounds?: number;
  votes?: Record<string, { answer: string; confidence: number }>;
}

// ============================================================================
// Collaboration Mode Configs
// ============================================================================

export interface DebateConfig {
  rounds: number;
  requireDisagreement: boolean;
  finalSynthesis: boolean;
  timeoutMs?: number;
  parallelResponses?: boolean; // If true, agents respond in parallel (first to finish appears first, like WhatsApp)
}

export const DebateConfigSchema = z.object({
  rounds: z.number().min(1).max(10).default(4),
  requireDisagreement: z.boolean().default(false),
  finalSynthesis: z.boolean().default(true),
  timeoutMs: z.number().optional(),
  parallelResponses: z.boolean().default(true), // Default to parallel for natural conversation flow
});

export interface ConsensusConfig {
  votingMethod: 'majority' | 'weighted' | 'confidence';
  minAgreement: number; // 0-1, e.g., 0.66 for 2/3
  maxRounds: number;
}

export const ConsensusConfigSchema = z.object({
  votingMethod: z.enum(['majority', 'weighted', 'confidence']).default('confidence'),
  minAgreement: z.number().min(0).max(1).default(0.66),
  maxRounds: z.number().min(1).max(10).default(3),
});

// ============================================================================
// Real-Time Discussion Types
// ============================================================================

export interface DiscussionConfig {
  maxMessagesPerTurn: number;       // Max agent messages after one user message
  agentCooldownMs: number;          // Cooldown before agent can respond again
  maxConcurrentResponses: number;   // Max agents responding at once
  responseDelayMinMs: number;       // Min delay before agent responds
  responseDelayMaxMs: number;       // Max delay before agent responds
  budgetMaxMessages?: number;       // Optional: max total messages in discussion
  budgetMaxTokens?: number;         // Optional: max total tokens (estimated)
}

export const DiscussionConfigSchema = z.object({
  maxMessagesPerTurn: z.number().min(1).max(20).default(5),
  agentCooldownMs: z.number().min(0).default(10000),
  maxConcurrentResponses: z.number().min(1).max(10).default(3),
  responseDelayMinMs: z.number().min(0).default(500),
  responseDelayMaxMs: z.number().min(0).default(3000),
  budgetMaxMessages: z.number().optional(),
  budgetMaxTokens: z.number().optional(),
});

export const DEFAULT_DISCUSSION_CONFIG: DiscussionConfig = {
  maxMessagesPerTurn: 5,
  agentCooldownMs: 10000,
  maxConcurrentResponses: 3,
  responseDelayMinMs: 500,
  responseDelayMaxMs: 3000,
};

/**
 * Context for agent decision-making in real-time discussions
 */
export interface DiscussionContext extends ConversationContext {
  newMessage: Message;           // The message that triggered this decision
  isMentioned: boolean;          // Was this agent @mentioned in the new message
  mentionedAgents: string[];     // All mentioned agent IDs in the new message
  discussionMessageCount: number; // Total messages in current discussion
  agentMessageCount: number;     // How many times this agent has responded
}

/**
 * State for an active real-time discussion
 */
export interface DiscussionState {
  roomId: string;
  active: boolean;
  startedAt: Date;
  config: DiscussionConfig;
  messageCount: number;
  tokenCount: number;
  lastUserMessageAt?: Date;
  agentCooldowns: Map<string, Date>; // agentId -> last response time
  agentMessageCounts: Map<string, number>; // agentId -> message count
  currentTurnMessageCount: number; // Messages since last user message
}

// ============================================================================
// Handoff Types (For failure recovery - addresses #1 failure mode)
// ============================================================================

export interface AgentHandoff {
  id: string;
  taskId: string;
  fromAgent: string;
  toAgent: string;
  timestamp: Date;
  context: {
    originalQuery: string;
    conversationHistory: Message[];
    intermediateResults: Record<string, unknown>;
    handoffReason: string;
  };
  checkpoint: string; // Serialized state for recovery
  status: 'pending' | 'accepted' | 'completed' | 'failed';
}

export const AgentHandoffSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  fromAgent: z.string(),
  toAgent: z.string(),
  timestamp: z.date(),
  context: z.object({
    originalQuery: z.string(),
    conversationHistory: z.array(MessageSchema),
    intermediateResults: z.record(z.string(), z.unknown()),
    handoffReason: z.string(),
  }),
  checkpoint: z.string(),
  status: z.enum(['pending', 'accepted', 'completed', 'failed']),
});

// ============================================================================
// Agent Adapter Interface
// ============================================================================

export interface ConversationContext {
  roomId: string;
  mode: CollaborationMode;
  messages: Message[];
  currentRound?: number;
  totalRounds?: number;
  otherAgentResponses?: Message[];
  systemPrompt?: string;
}

export interface AgentResponse {
  content: string;
  confidence?: number;
  metadata?: Record<string, unknown>;
  error?: string;
}

export interface AgentAdapter {
  id: string;
  name: string;
  type: AgentType;
  
  // Check if the adapter is available and configured
  isAvailable(): Promise<boolean>;
  
  // Send a message and get a response
  sendMessage(context: ConversationContext): Promise<AgentResponse>;
  
  // Optional: Stream response
  streamMessage?(context: ConversationContext): AsyncIterable<string>;
  
  // Optional: Decide whether to respond in real-time discussion mode
  shouldRespond?(context: DiscussionContext): Promise<boolean>;
  
  // Health check
  checkHealth(): Promise<AgentHealth>;
}

// ============================================================================
// Event Types
// ============================================================================

export type HubEvent = 
  | { type: 'message'; data: Message }
  | { type: 'agent_joined'; data: { agentId: string; roomId: string } }
  | { type: 'agent_left'; data: { agentId: string; roomId: string } }
  | { type: 'room_created'; data: Room }
  | { type: 'room_closed'; data: { roomId: string } }
  | { type: 'mode_changed'; data: { roomId: string; mode: CollaborationMode } }
  | { type: 'round_started'; data: { roomId: string; round: number; total: number } }
  | { type: 'consensus_reached'; data: { roomId: string; result: string; confidence: number } }
  | { type: 'discussion_started'; data: { roomId: string; config: DiscussionConfig } }
  | { type: 'discussion_stopped'; data: { roomId: string } }
  | { type: 'agent_thinking'; data: { roomId: string; agentId: string; agentName: string } }
  | { type: 'agent_done_thinking'; data: { roomId: string; agentId: string } };

export type EventHandler = (event: HubEvent) => void;

// ============================================================================
// API Response Types
// ============================================================================

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}
