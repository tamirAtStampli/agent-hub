import type { Message, DebateConfig, ConversationContext, AgentConfig, AgentAdapter } from '../core/types.js';
import { getMessageRoom } from '../core/message-room.js';
import { getAgentRegistry } from '../core/agent-registry.js';

const DEFAULT_CONFIG: DebateConfig = {
  rounds: 4,
  requireDisagreement: false,
  finalSynthesis: true,
  parallelResponses: true, // Default to parallel for natural WhatsApp-like conversation
};

/**
 * Structured Debate Mode
 * Agents argue positions over multiple rounds, then synthesize
 * Research shows this achieves 91% accuracy with 4 rounds of diverse model debate
 * 
 * With parallelResponses: true (default), agents respond concurrently like WhatsApp -
 * the first agent to finish appears first, creating a natural conversation flow.
 */
export async function runDebate(
  roomId: string,
  topic: string,
  config: Partial<DebateConfig> = {}
): Promise<{
  messages: Message[];
  synthesis?: string;
  rounds: Message[][];
}> {
  const fullConfig = { ...DEFAULT_CONFIG, ...config };
  const messageRoom = getMessageRoom();
  const registry = getAgentRegistry();

  // Add the topic as user message
  const userMsg = messageRoom.addMessage({
    roomId,
    sender: 'user',
    senderName: 'User',
    content: topic,
  });

  const readyAgents = registry.getReadyAgents();
  if (readyAgents.length === 0) {
    throw new Error('No agents available for debate');
  }

  const allMessages: Message[] = [userMsg];
  const rounds: Message[][] = [];

  // Run each round
  for (let round = 1; round <= fullConfig.rounds; round++) {
    console.log(`\n📢 Round ${round} of ${fullConfig.rounds}`);
    messageRoom.signalRoundStart(roomId, round, fullConfig.rounds);

    const roomState = messageRoom.getRoomState(roomId);
    if (!roomState) {
      throw new Error(`Room not found: ${roomId}`);
    }

    // For rounds after the first, include previous round's responses
    const previousRoundResponses = round > 1 ? rounds[round - 2] : [];

    let roundResponses: Message[];

    if (fullConfig.parallelResponses) {
      // PARALLEL MODE: All agents respond at the same time, first to finish appears first
      roundResponses = await runParallelResponses(
        roomId,
        round,
        fullConfig.rounds,
        roomState.messages,
        previousRoundResponses,
        readyAgents,
        messageRoom
      );
    } else {
      // SEQUENTIAL MODE: Agents respond one by one in order
      roundResponses = await runSequentialResponses(
        roomId,
        round,
        fullConfig.rounds,
        roomState.messages,
        previousRoundResponses,
        readyAgents,
        messageRoom
      );
    }

    allMessages.push(...roundResponses);
    rounds.push(roundResponses);
  }

  // Final synthesis (optional)
  let synthesis: string | undefined;
  if (fullConfig.finalSynthesis && readyAgents.length > 0) {
    console.log('\n📝 Generating synthesis...');
    
    // Use the first available agent to synthesize
    const synthesizer = readyAgents[0];
    const roomState = messageRoom.getRoomState(roomId);
    
    const synthesisPrompt = `Based on the debate above, synthesize the key points of agreement and disagreement. 
What is the best conclusion that incorporates the strongest arguments from all participants?
Be concise and actionable.`;

    // Add synthesis request as user message
    messageRoom.addMessage({
      roomId,
      sender: 'user',
      senderName: 'User',
      content: synthesisPrompt,
    });

    const context: ConversationContext = {
      roomId,
      mode: 'shared-room', // Use shared room mode for synthesis
      messages: roomState!.messages,
    };

    try {
      const response = await synthesizer.adapter.sendMessage(context);
      if (!response.error) {
        synthesis = response.content;
        const synthesisMsg = messageRoom.addMessage({
          roomId,
          sender: synthesizer.agent.type,
          senderName: `${synthesizer.agent.name} (Synthesis)`,
          content: response.content,
          metadata: { isSynthesis: true },
        });
        allMessages.push(synthesisMsg);
      }
    } catch (error) {
      console.error('Error generating synthesis:', error);
    }
  }

  return {
    messages: allMessages,
    synthesis,
    rounds,
  };
}

/**
 * Draft response from Phase 1 (not yet added to room)
 */
interface DraftResponse {
  agent: AgentConfig;
  adapter: AgentAdapter;
  content: string;
  confidence?: number;
  metadata?: Record<string, unknown>;
  responseTimeMs: number;
}

/**
 * Run agents in parallel with adjustment window
 * 
 * Phase 1: All agents respond in parallel (drafts - not shown to user)
 * Phase 2: Each agent sees all drafts and can adjust their response
 * Final: Only polished responses are shown to user
 */
async function runParallelResponses(
  roomId: string,
  round: number,
  totalRounds: number,
  messages: Message[],
  previousRoundResponses: Message[],
  readyAgents: { agent: AgentConfig; adapter: AgentAdapter }[],
  messageRoom: ReturnType<typeof getMessageRoom>
): Promise<Message[]> {
  
  console.log(`  ⚡ Phase 1: All ${readyAgents.length} agents thinking in parallel...`);

  // ========== PHASE 1: Collect drafts (parallel, isolated) ==========
  const drafts: DraftResponse[] = [];

  const phase1Promises = readyAgents.map(async ({ agent, adapter }) => {
    const context: ConversationContext = {
      roomId,
      mode: 'structured-debate',
      messages,
      currentRound: round,
      totalRounds,
      otherAgentResponses: previousRoundResponses,
    };

    try {
      console.log(`    🤖 ${agent.name} is thinking...`);
      const startTime = Date.now();
      const response = await adapter.sendMessage(context);
      const responseTime = Date.now() - startTime;

      if (response.error) {
        console.error(`    ❌ Error from ${agent.name}:`, response.error);
        return null;
      }

      console.log(`    📝 ${agent.name} draft ready in ${(responseTime / 1000).toFixed(1)}s`);
      
      return {
        agent,
        adapter,
        content: response.content,
        confidence: response.confidence,
        metadata: response.metadata,
        responseTimeMs: responseTime,
      } as DraftResponse;
    } catch (error) {
      console.error(`    ❌ Error from ${agent.name}:`, error);
      return null;
    }
  });

  const phase1Results = await Promise.all(phase1Promises);
  
  // Collect successful drafts
  for (const draft of phase1Results) {
    if (draft) {
      drafts.push(draft);
    }
  }

  if (drafts.length === 0) {
    console.log(`  ⚠️ No drafts collected, skipping adjustment phase`);
    return [];
  }

  // ========== PHASE 2: Adjustment pass ==========
  console.log(`  🔄 Phase 2: Agents reviewing each other's responses...`);

  const finalResponses: Message[] = [];

  // Run adjustments in parallel too
  const phase2Promises = drafts.map(async (draft) => {
    const { agent, adapter, content: originalContent, confidence: originalConfidence, metadata: originalMetadata, responseTimeMs } = draft;
    
    // Build context with all other agents' drafts
    const otherDrafts = drafts
      .filter(d => d.agent.id !== agent.id)
      .map(d => ({
        id: `draft-${d.agent.id}`,
        roomId,
        sender: d.agent.type,
        senderName: d.agent.name,
        content: d.content,
        confidence: d.confidence,
        timestamp: new Date(),
      } as Message));

    // If there are no other drafts, no need to adjust
    if (otherDrafts.length === 0) {
      return { draft, adjustedContent: null };
    }

    // Ask agent if they want to adjust based on seeing others' responses
    const adjustmentPrompt = buildAdjustmentPrompt(agent.name, originalContent, otherDrafts, round, totalRounds);
    
    const adjustmentContext: ConversationContext = {
      roomId,
      mode: 'structured-debate',
      messages: [...messages, ...otherDrafts],
      currentRound: round,
      totalRounds,
      otherAgentResponses: [...previousRoundResponses, ...otherDrafts],
    };

    try {
      console.log(`    🔍 ${agent.name} reviewing others' responses...`);
      const adjustmentResponse = await adapter.sendMessage({
        ...adjustmentContext,
        // Override with adjustment prompt
        messages: [
          ...messages,
          {
            id: 'adjustment-prompt',
            roomId,
            sender: 'user',
            senderName: 'System',
            content: adjustmentPrompt,
            timestamp: new Date(),
          },
        ],
      });

      if (adjustmentResponse.error) {
        console.log(`    ⚠️ ${agent.name} adjustment failed, using original`);
        return { draft, adjustedContent: null };
      }

      // Check if agent decided not to adjust
      const noAdjustmentPhrases = [
        'no adjustment needed',
        'no changes needed',
        'i\'ll keep my original',
        'my response stands',
        'no modification needed',
        '[NO ADJUSTMENT]',
      ];
      
      const responseLC = adjustmentResponse.content.toLowerCase();
      const shouldKeepOriginal = noAdjustmentPhrases.some(phrase => responseLC.includes(phrase));

      if (shouldKeepOriginal) {
        console.log(`    ✓ ${agent.name}: No adjustment needed`);
        return { draft, adjustedContent: null };
      }

      console.log(`    ✏️ ${agent.name}: Adjusted response`);
      return { 
        draft, 
        adjustedContent: adjustmentResponse.content,
        adjustedConfidence: adjustmentResponse.confidence,
      };
    } catch (error) {
      console.log(`    ⚠️ ${agent.name} adjustment error, using original`);
      return { draft, adjustedContent: null };
    }
  });

  const phase2Results = await Promise.all(phase2Promises);

  // ========== FINAL: Add polished responses to room ==========
  console.log(`  ✅ Publishing final responses...`);

  for (const result of phase2Results) {
    const { draft, adjustedContent, adjustedConfidence } = result as { 
      draft: DraftResponse; 
      adjustedContent: string | null;
      adjustedConfidence?: number;
    };
    
    const finalContent = adjustedContent || draft.content;
    const finalConfidence = adjustedContent ? adjustedConfidence : draft.confidence;
    const wasAdjusted = !!adjustedContent;

    const msg = messageRoom.addMessage({
      roomId,
      sender: draft.agent.type,
      senderName: draft.agent.name,
      content: finalContent,
      confidence: finalConfidence,
      metadata: {
        ...draft.metadata,
        round,
        isDebate: true,
        responseTimeMs: draft.responseTimeMs,
        wasAdjusted,
      },
    });

    finalResponses.push(msg);
    console.log(`    ✅ ${draft.agent.name}${wasAdjusted ? ' (adjusted)' : ''}`);
  }

  return finalResponses;
}

/**
 * Build the prompt asking an agent if they want to adjust their response
 */
function buildAdjustmentPrompt(
  agentName: string,
  originalResponse: string,
  otherDrafts: Message[],
  round: number,
  totalRounds: number
): string {
  const othersResponses = otherDrafts
    .map(d => `**${d.senderName}**: ${d.content}`)
    .join('\n\n');

  return `You are ${agentName} in round ${round} of ${totalRounds} of a debate.

You just wrote this response:
---
${originalResponse}
---

Now you can see what the other agents wrote AT THE SAME TIME (they couldn't see your response either):

${othersResponses}

DECISION:
- If your response is still good and adds unique value, reply with: [NO ADJUSTMENT]
- If you want to adjust your response to react to others (agree, disagree, build on their points), write your NEW complete response.

Guidelines for adjustment:
- Reference other agents BY NAME if responding to their points
- Don't just repeat what others said
- Add value by agreeing/disagreeing with specifics
- Keep similar length to your original

Your response:`;
}

/**
 * Run agents sequentially - fixed order, each sees previous responses
 */
async function runSequentialResponses(
  roomId: string,
  round: number,
  totalRounds: number,
  messages: Message[],
  previousRoundResponses: Message[],
  readyAgents: { agent: AgentConfig; adapter: AgentAdapter }[],
  messageRoom: ReturnType<typeof getMessageRoom>
): Promise<Message[]> {
  const roundResponses: Message[] = [];

  for (const { agent, adapter } of readyAgents) {
    const context: ConversationContext = {
      roomId,
      mode: 'structured-debate',
      messages,
      currentRound: round,
      totalRounds,
      otherAgentResponses: [
        ...previousRoundResponses,
        ...roundResponses, // Include responses from agents who went before in this round
      ],
    };

    try {
      console.log(`  🤖 ${agent.name} is responding...`);
      const response = await adapter.sendMessage(context);

      if (response.error) {
        console.error(`  ❌ Error from ${agent.name}:`, response.error);
        continue;
      }

      const msg = messageRoom.addMessage({
        roomId,
        sender: agent.type,
        senderName: agent.name,
        content: response.content,
        confidence: response.confidence,
        metadata: {
          ...response.metadata,
          round,
          isDebate: true,
        },
      });

      roundResponses.push(msg);
      console.log(`  ✅ ${agent.name} (confidence: ${response.confidence?.toFixed(2) || 'N/A'})`);
    } catch (error) {
      console.error(`  ❌ Error from ${agent.name}:`, error);
    }
  }

  return roundResponses;
}

/**
 * Get a summary of the debate
 */
export function summarizeDebate(rounds: Message[][]): {
  roundSummaries: { round: number; participants: string[]; avgConfidence: number }[];
  highestConfidence: { agent: string; confidence: number; round: number };
} {
  const roundSummaries = rounds.map((messages, index) => {
    const participants = messages.map((m) => m.senderName);
    const confidences = messages
      .filter((m) => m.confidence !== undefined)
      .map((m) => m.confidence!);
    const avgConfidence = confidences.length > 0
      ? confidences.reduce((a, b) => a + b, 0) / confidences.length
      : 0;

    return {
      round: index + 1,
      participants,
      avgConfidence,
    };
  });

  // Find highest confidence response
  let highestConfidence = { agent: '', confidence: 0, round: 0 };
  rounds.forEach((messages, roundIndex) => {
    messages.forEach((m) => {
      if (m.confidence && m.confidence > highestConfidence.confidence) {
        highestConfidence = {
          agent: m.senderName,
          confidence: m.confidence,
          round: roundIndex + 1,
        };
      }
    });
  });

  return { roundSummaries, highestConfidence };
}
