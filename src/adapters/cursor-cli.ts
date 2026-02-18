import { spawn } from 'child_process';
import { BaseAdapter } from './base.js';
import type { AgentResponse, ConversationContext, AgentType, DiscussionContext } from '../core/types.js';
import { getAgentRegistry } from '../core/agent-registry.js';

/**
 * Cursor CLI Adapter
 * Uses the `cursor-agent` command from Cursor CLI
 */
export class CursorCliAdapter extends BaseAdapter {
  id = 'cursor';
  name = 'Cursor Agent';
  type: AgentType = 'custom';

  private getCliPath(): string {
    const registry = getAgentRegistry();
    const agent = registry.getAgent(this.id);
    return (agent?.config.cliPath as string) || 'cursor-agent';
  }

  async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const cli = this.getCliPath();
      const proc = spawn(cli, ['--version'], {
        shell: true,
        timeout: 5000,
      });

      let output = '';
      proc.stdout?.on('data', (data) => {
        output += data.toString();
      });
      proc.stderr?.on('data', (data) => {
        output += data.toString();
      });

      proc.on('close', (code) => {
        // Consider available if we get any version output or exit code 0
        resolve(code === 0 || output.includes('cursor-agent') || output.includes('Cursor Agent'));
      });

      proc.on('error', () => {
        resolve(false);
      });
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

      const result = await this.runCli(prompt);
      return result;
    } catch (error) {
      return {
        content: '',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private runCli(prompt: string): Promise<AgentResponse> {
    const cli = this.getCliPath();
    const registry = getAgentRegistry();
    const agent = registry.getAgent(this.id);
    
    // Quote the prompt to prevent shell splitting on spaces
    // Use -p (--print) for non-interactive mode
    const quotedPrompt = `"${prompt.replace(/"/g, '\\"')}"`;
    const args: string[] = ['-p', quotedPrompt];

    // Add model if configured
    const model = agent?.config.model as string;
    if (model) {
      args.unshift('--model', model);
    }

    return new Promise((resolve) => {
      let resolved = false;
      
      const proc = spawn(cli, args, {
        shell: true,
        cwd: process.cwd(),
        env: { ...process.env },
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

      proc.on('close', (code) => {
        if (resolved) return;
        resolved = true;
        
        if (code !== 0 && !stdout) {
          resolve({
            content: '',
            error: stderr || `Cursor CLI exited with code ${code}`,
          });
          return;
        }

        // Parse the response - remove any CLI noise
        let content = stdout.trim();
        
        // Remove common CLI prefixes/formatting
        content = content
          .replace(/^⬢.*$/gm, '')  // Remove status lines
          .replace(/^→.*$/gm, '')   // Remove action lines
          .trim();

        const { content: cleanContent, confidence } = this.extractConfidence(content);

        resolve({
          content: cleanContent,
          confidence,
          metadata: {
            provider: 'cursor-cli',
            model: model || 'auto',
          },
        });
      });

      proc.on('error', (err) => {
        if (resolved) return;
        resolved = true;
        resolve({
          content: '',
          error: `Failed to run Cursor CLI: ${err.message}`,
        });
      });

      // Timeout after 5 minutes (LLM responses can take a while)
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          proc.kill();
          resolve({
            content: '',
            error: 'Cursor CLI timed out after 5 minutes',
          });
        }
      }, 300000);
    });
  }
}
