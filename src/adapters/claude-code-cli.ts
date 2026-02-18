import { spawn } from 'child_process';
import { BaseAdapter } from './base.js';
import type { AgentResponse, ConversationContext, AgentType, DiscussionContext } from '../core/types.js';
import { getAgentRegistry } from '../core/agent-registry.js';

/**
 * Claude Code CLI Adapter
 * Spawns the Claude Code CLI process to get responses
 */
export class ClaudeCodeCliAdapter extends BaseAdapter {
  id = 'claude-code';
  name = 'Claude Code';
  type: AgentType = 'claude-code';

  private getCliPath(): string {
    const registry = getAgentRegistry();
    const agent = registry.getAgent(this.id);
    return (agent?.config.cliPath as string) || 'claude';
  }

  async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn(this.getCliPath(), ['--version'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true,
      });

      let resolved = false;
      
      proc.on('error', () => {
        if (!resolved) {
          resolved = true;
          resolve(false);
        }
      });

      proc.on('close', (code) => {
        if (!resolved) {
          resolved = true;
          resolve(code === 0);
        }
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          proc.kill();
          resolve(false);
        }
      }, 5000);
    });
  }

  async sendMessage(context: ConversationContext): Promise<AgentResponse> {
    try {
      // Get the message to respond to
      const messageToRespond = this.getMessageToRespondTo(context);

      if (!messageToRespond) {
        return { content: '', error: 'No message to respond to' };
      }

      let prompt: string;

      // Handle discussion mode - respond to the whole conversation
      if (context.mode === 'real-time-discussion') {
        // Build context from recent conversation
        const recentMessages = context.messages.slice(-8); // Last 8 messages for context
        const conversationContext = recentMessages
          .map((m) => `${m.senderName}: ${m.content}`)
          .join('\n\n');
        
        // Get names of other agents who have spoken
        const otherAgentNames = [...new Set(
          recentMessages
            .filter(m => m.sender !== 'user' && m.senderName !== this.name)
            .map(m => m.senderName)
        )];
        
        prompt = `You are ${this.name} in a group discussion with other AI agents.

CONVERSATION SO FAR:
${conversationContext}

YOUR TASK:
Respond to the discussion above. You can:
- Agree or disagree with ANY point made by ${otherAgentNames.join(', ') || 'other agents'}
- Build on someone's idea with additional insights
- Point out something everyone missed
- Ask a follow-up question to a specific agent

RULES:
- Reference agents BY NAME when responding to their points (e.g., "I agree with Claude Code that...")
- Be specific - don't just say "good point", explain WHY you agree/disagree
- Keep it concise (2-4 sentences)
- Add something NEW to the discussion`;
      } else if (context.mode === 'structured-debate' || context.mode === 'consensus') {
        // Debate/consensus mode - build a rich prompt with context
        const round = context.currentRound || 1;
        const totalRounds = context.totalRounds || 4;
        
        // Get names of other agents
        const otherAgentNames = context.otherAgentResponses
          ?.map(r => r.senderName)
          .filter((name, i, arr) => arr.indexOf(name) === i)
          .join(', ') || 'other agents';
        
        let otherResponsesSection = '';
        if (context.otherAgentResponses && context.otherAgentResponses.length > 0) {
          const otherResponses = context.otherAgentResponses
            .map((r) => `**${r.senderName}**: ${r.content}`)
            .join('\n\n');
          otherResponsesSection = `\n\nOTHER AGENTS HAVE SAID:\n${otherResponses}`;
        }
        
        prompt = `You are ${this.name} in a structured debate with other AI agents: ${otherAgentNames}.
This is round ${round} of ${totalRounds}.

TOPIC: ${messageToRespond.content}
${otherResponsesSection}

YOUR TASK:
${context.otherAgentResponses && context.otherAgentResponses.length > 0 
  ? `- Directly respond to the points made by ${otherAgentNames} above
- Agree or disagree with SPECIFIC points (reference them by name)
- Add your own perspective with clear reasoning`
  : `- Present your initial position on the topic
- Provide clear reasoning for your perspective`}

RULES:
- Be direct and substantive
- Reference other agents BY NAME when responding to their points
- Keep your response focused (2-4 paragraphs)
- End with a confidence score: [CONFIDENCE: 0.X]`;
      } else {
        // Simple mode - just the question
        prompt = messageToRespond.content;
      }

      const response = await this.runCli(prompt);
      const { content, confidence } = this.extractConfidence(response);

      return {
        content,
        confidence,
        metadata: { cliPath: this.getCliPath() },
      };
    } catch (error) {
      return {
        content: '',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private runCli(prompt: string): Promise<string> {
    const cliPath = this.getCliPath();
    
    // Quote the prompt to prevent shell splitting on spaces
    // Use -p (--print) for non-interactive mode
    const quotedPrompt = `"${prompt.replace(/"/g, '\\"')}"`;
    
    return new Promise((resolve, reject) => {
      let resolved = false;
      
      const proc = spawn(cliPath, ['-p', quotedPrompt], {
        shell: true,
        env: { ...process.env },
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],  // Ignore stdin to prevent hanging
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('error', (error) => {
        if (resolved) return;
        resolved = true;
        reject(new Error(`Failed to spawn Claude Code CLI: ${error.message}`));
      });

      proc.on('close', (code) => {
        if (resolved) return;
        resolved = true;
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(`Claude Code CLI exited with code ${code}: ${stderr}`));
        }
      });

      // Timeout after 5 minutes
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          proc.kill();
          reject(new Error('Claude Code CLI timed out after 5 minutes'));
        }
      }, 300000);
    });
  }
}
