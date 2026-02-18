import { v4 as uuidv4 } from 'uuid';
import { writeFile, readFile, mkdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import type { AgentHandoff, Message } from './types.js';
import * as db from './database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHECKPOINTS_DIR = path.join(__dirname, '../../data/checkpoints');

/**
 * Handoff System
 * Manages typed handoffs between agents with checkpoints for recovery
 * Addresses the #1 failure mode in multi-agent systems
 */
export class HandoffSystem {
  constructor() {
    this.ensureCheckpointDir();
  }

  private async ensureCheckpointDir(): Promise<void> {
    try {
      await mkdir(CHECKPOINTS_DIR, { recursive: true });
    } catch {
      // Directory may already exist
    }
  }

  /**
   * Create a handoff from one agent to another
   */
  async createHandoff(options: {
    taskId: string;
    fromAgent: string;
    toAgent: string;
    originalQuery: string;
    conversationHistory: Message[];
    intermediateResults?: Record<string, unknown>;
    handoffReason: string;
  }): Promise<AgentHandoff> {
    const id = uuidv4();
    
    // Create checkpoint
    const checkpoint = await this.createCheckpoint(id, {
      taskId: options.taskId,
      conversationHistory: options.conversationHistory,
      intermediateResults: options.intermediateResults || {},
    });

    const handoff: AgentHandoff = {
      id,
      taskId: options.taskId,
      fromAgent: options.fromAgent,
      toAgent: options.toAgent,
      timestamp: new Date(),
      context: {
        originalQuery: options.originalQuery,
        conversationHistory: options.conversationHistory,
        intermediateResults: options.intermediateResults || {},
        handoffReason: options.handoffReason,
      },
      checkpoint,
      status: 'pending',
    };

    db.insertHandoff(handoff);
    return handoff;
  }

  /**
   * Accept a handoff
   */
  acceptHandoff(handoffId: string): void {
    db.updateHandoffStatus(handoffId, 'accepted');
  }

  /**
   * Complete a handoff
   */
  completeHandoff(handoffId: string): void {
    db.updateHandoffStatus(handoffId, 'completed');
  }

  /**
   * Mark a handoff as failed
   */
  failHandoff(handoffId: string): void {
    db.updateHandoffStatus(handoffId, 'failed');
  }

  /**
   * Get a handoff by ID
   */
  getHandoff(handoffId: string): AgentHandoff | null {
    return db.getHandoff(handoffId);
  }

  /**
   * Get all pending handoffs
   */
  getPendingHandoffs(): AgentHandoff[] {
    return db.getPendingHandoffs();
  }

  /**
   * Create a checkpoint file for recovery
   */
  private async createCheckpoint(
    handoffId: string,
    data: {
      taskId: string;
      conversationHistory: Message[];
      intermediateResults: Record<string, unknown>;
    }
  ): Promise<string> {
    const checkpointPath = path.join(CHECKPOINTS_DIR, `${handoffId}.json`);
    
    const checkpoint = {
      handoffId,
      createdAt: new Date().toISOString(),
      ...data,
    };

    await writeFile(checkpointPath, JSON.stringify(checkpoint, null, 2));
    return checkpointPath;
  }

  /**
   * Recover from a checkpoint
   */
  async recoverFromCheckpoint(handoffId: string): Promise<{
    taskId: string;
    conversationHistory: Message[];
    intermediateResults: Record<string, unknown>;
  } | null> {
    const handoff = db.getHandoff(handoffId);
    if (!handoff) return null;

    try {
      const data = await readFile(handoff.checkpoint, 'utf-8');
      const checkpoint = JSON.parse(data);
      
      return {
        taskId: checkpoint.taskId,
        conversationHistory: checkpoint.conversationHistory.map((m: Record<string, unknown>) => ({
          ...m,
          timestamp: new Date(m.timestamp as string),
        })),
        intermediateResults: checkpoint.intermediateResults,
      };
    } catch (error) {
      console.error('Failed to recover checkpoint:', error);
      return null;
    }
  }

  /**
   * Clean up old checkpoints
   */
  async cleanupOldCheckpoints(maxAgeMs: number = 24 * 60 * 60 * 1000): Promise<number> {
    const { readdir, unlink, stat } = await import('fs/promises');
    let cleaned = 0;

    try {
      const files = await readdir(CHECKPOINTS_DIR);
      const now = Date.now();

      for (const file of files) {
        const filePath = path.join(CHECKPOINTS_DIR, file);
        const stats = await stat(filePath);
        
        if (now - stats.mtimeMs > maxAgeMs) {
          await unlink(filePath);
          cleaned++;
        }
      }
    } catch (error) {
      console.error('Error cleaning up checkpoints:', error);
    }

    return cleaned;
  }
}

// Singleton instance
let handoffSystemInstance: HandoffSystem | null = null;

export function getHandoffSystem(): HandoffSystem {
  if (!handoffSystemInstance) {
    handoffSystemInstance = new HandoffSystem();
  }
  return handoffSystemInstance;
}
