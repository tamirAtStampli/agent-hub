import type { Message, ConsensusConfig, ConversationContext } from '../core/types.js';
import { getMessageRoom } from '../core/message-room.js';
import { getAgentRegistry } from '../core/agent-registry.js';

const DEFAULT_CONFIG: ConsensusConfig = {
  votingMethod: 'confidence',
  minAgreement: 0.66,
  maxRounds: 3,
};

interface Vote {
  agent: string;
  answer: string;
  confidence: number;
}

interface ConsensusResult {
  reached: boolean;
  winner?: string;
  confidence: number;
  votes: Vote[];
  round: number;
  allMessages: Message[];
}

/**
 * Consensus Mode
 * Agents vote with confidence scores, weighted voting to reach agreement
 * Research shows 11.4% improvement with confidence-weighted voting
 */
export async function runConsensus(
  roomId: string,
  question: string,
  config: Partial<ConsensusConfig> = {}
): Promise<ConsensusResult> {
  const fullConfig = { ...DEFAULT_CONFIG, ...config };
  const messageRoom = getMessageRoom();
  const registry = getAgentRegistry();

  // Add the question as user message
  const userMsg = messageRoom.addMessage({
    roomId,
    sender: 'user',
    senderName: 'User',
    content: question,
  });

  const readyAgents = registry.getReadyAgents();
  if (readyAgents.length === 0) {
    throw new Error('No agents available for consensus');
  }

  const allMessages: Message[] = [userMsg];
  let currentRound = 1;
  let consensusReached = false;
  let finalVotes: Vote[] = [];

  while (currentRound <= fullConfig.maxRounds && !consensusReached) {
    console.log(`\n🗳️  Consensus Round ${currentRound} of ${fullConfig.maxRounds}`);

    const roomState = messageRoom.getRoomState(roomId);
    if (!roomState) {
      throw new Error(`Room not found: ${roomId}`);
    }

    // Collect previous round's responses (if any)
    const previousResponses = currentRound > 1
      ? allMessages.filter((m) => 
          m.sender !== 'user' && 
          m.metadata?.consensusRound === currentRound - 1
        )
      : [];

    // Collect votes from all agents
    const roundVotes: Vote[] = [];

    for (const { agent, adapter } of readyAgents) {
      const context: ConversationContext = {
        roomId,
        mode: 'consensus',
        messages: roomState.messages,
        currentRound,
        totalRounds: fullConfig.maxRounds,
        otherAgentResponses: previousResponses,
      };

      try {
        console.log(`  🤖 ${agent.name} is voting...`);
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
            consensusRound: currentRound,
          },
        });

        allMessages.push(msg);

        roundVotes.push({
          agent: agent.name,
          answer: response.content,
          confidence: response.confidence || 0.5,
        });

        console.log(`  ✅ ${agent.name} voted (confidence: ${(response.confidence || 0.5).toFixed(2)})`);
      } catch (error) {
        console.error(`  ❌ Error from ${agent.name}:`, error);
      }
    }

    finalVotes = roundVotes;

    // Check for consensus
    const result = calculateConsensus(roundVotes, fullConfig);
    
    if (result.reached) {
      consensusReached = true;
      console.log(`\n✨ Consensus reached: "${result.winner}" (${(result.confidence * 100).toFixed(1)}% agreement)`);
      
      messageRoom.signalConsensusReached(roomId, result.winner!, result.confidence);
    } else if (currentRound < fullConfig.maxRounds) {
      console.log(`  ⚠️  No consensus yet (${(result.confidence * 100).toFixed(1)}% agreement, need ${(fullConfig.minAgreement * 100).toFixed(1)}%)`);
      
      // Add a message to prompt another round
      messageRoom.addMessage({
        roomId,
        sender: 'user',
        senderName: 'System',
        content: `No consensus reached (${(result.confidence * 100).toFixed(1)}% agreement). Please reconsider your positions and try to reach agreement. Focus on the strongest arguments.`,
      });
    }

    currentRound++;
  }

  const finalResult = calculateConsensus(finalVotes, fullConfig);

  return {
    reached: finalResult.reached,
    winner: finalResult.winner,
    confidence: finalResult.confidence,
    votes: finalVotes,
    round: currentRound - 1,
    allMessages,
  };
}

/**
 * Calculate consensus from votes
 */
function calculateConsensus(
  votes: Vote[],
  config: ConsensusConfig
): { reached: boolean; winner?: string; confidence: number } {
  if (votes.length === 0) {
    return { reached: false, confidence: 0 };
  }

  switch (config.votingMethod) {
    case 'majority':
      return calculateMajorityConsensus(votes, config.minAgreement);
    case 'weighted':
      return calculateWeightedConsensus(votes, config.minAgreement);
    case 'confidence':
    default:
      return calculateConfidenceWeightedConsensus(votes, config.minAgreement);
  }
}

/**
 * Simple majority voting
 */
function calculateMajorityConsensus(
  votes: Vote[],
  minAgreement: number
): { reached: boolean; winner?: string; confidence: number } {
  // Group by answer (use first 100 chars as key for comparison)
  const groups = new Map<string, Vote[]>();
  
  for (const vote of votes) {
    const key = vote.answer.slice(0, 100).toLowerCase().trim();
    const existing = groups.get(key) || [];
    existing.push(vote);
    groups.set(key, existing);
  }

  // Find the largest group
  let largestGroup: Vote[] = [];
  for (const group of groups.values()) {
    if (group.length > largestGroup.length) {
      largestGroup = group;
    }
  }

  const agreement = largestGroup.length / votes.length;
  const reached = agreement >= minAgreement;
  const winner = reached ? largestGroup[0].answer : undefined;

  return { reached, winner, confidence: agreement };
}

/**
 * Weighted voting (all votes equal weight, but requires higher threshold)
 */
function calculateWeightedConsensus(
  votes: Vote[],
  minAgreement: number
): { reached: boolean; winner?: string; confidence: number } {
  // Same as majority for now, but could weight by agent type
  return calculateMajorityConsensus(votes, minAgreement);
}

/**
 * Confidence-weighted voting (research-backed method)
 * Each vote is weighted by its confidence score
 */
function calculateConfidenceWeightedConsensus(
  votes: Vote[],
  minAgreement: number
): { reached: boolean; winner?: string; confidence: number } {
  if (votes.length === 0) {
    return { reached: false, confidence: 0 };
  }

  // Calculate total confidence
  const totalConfidence = votes.reduce((sum, v) => sum + v.confidence, 0);
  
  // Find the vote with highest confidence
  const sorted = [...votes].sort((a, b) => b.confidence - a.confidence);
  const topVote = sorted[0];
  
  // Calculate weighted agreement
  // Sum confidence of votes that roughly agree with top vote
  let agreementWeight = topVote.confidence;
  
  for (const vote of votes) {
    if (vote === topVote) continue;
    
    // Check if answers are similar (simple heuristic)
    const similarity = calculateSimilarity(vote.answer, topVote.answer);
    if (similarity > 0.5) {
      agreementWeight += vote.confidence * similarity;
    }
  }

  const confidence = agreementWeight / totalConfidence;
  const reached = confidence >= minAgreement;
  const winner = reached ? topVote.answer : undefined;

  return { reached, winner, confidence };
}

/**
 * Simple text similarity (Jaccard on words)
 */
function calculateSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  
  const intersection = new Set([...wordsA].filter(w => wordsB.has(w)));
  const union = new Set([...wordsA, ...wordsB]);
  
  return intersection.size / union.size;
}

/**
 * Format consensus result for display
 */
export function formatConsensusResult(result: ConsensusResult): string {
  const lines: string[] = [];
  
  if (result.reached) {
    lines.push(`✅ Consensus Reached (${(result.confidence * 100).toFixed(1)}% agreement)`);
    lines.push(`📋 Answer: ${result.winner}`);
  } else {
    lines.push(`❌ No Consensus (${(result.confidence * 100).toFixed(1)}% agreement after ${result.round} rounds)`);
    lines.push('\n📊 Individual Votes:');
    for (const vote of result.votes) {
      lines.push(`  • ${vote.agent} (${(vote.confidence * 100).toFixed(0)}%): ${vote.answer.slice(0, 100)}...`);
    }
  }
  
  return lines.join('\n');
}
