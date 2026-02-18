import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import type { AgentConfig, Room, Message, AgentHandoff, DiscussionConfig } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '../../data/hub.db');

let db: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    initializeSchema();
  }
  return db;
}

function initializeSchema(): void {
  const database = db!;

  // Agents table
  database.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      config TEXT NOT NULL DEFAULT '{}',
      adapter_path TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  // Rooms table
  database.exec(`
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'shared-room',
      agents TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      metadata TEXT DEFAULT '{}',
      discussion_active INTEGER DEFAULT 0,
      discussion_config TEXT DEFAULT NULL
    )
  `);

  // Messages table
  database.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      sender TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      reply_to TEXT,
      confidence REAL,
      mentions TEXT DEFAULT '[]',
      metadata TEXT DEFAULT '{}',
      FOREIGN KEY (room_id) REFERENCES rooms(id)
    )
  `);

  // Handoffs table (for failure recovery)
  database.exec(`
    CREATE TABLE IF NOT EXISTS handoffs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      from_agent TEXT NOT NULL,
      to_agent TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      context TEXT NOT NULL,
      checkpoint TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
    )
  `);

  // Create indexes
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_room_id ON messages(room_id);
    CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
    CREATE INDEX IF NOT EXISTS idx_handoffs_task_id ON handoffs(task_id);
    CREATE INDEX IF NOT EXISTS idx_handoffs_status ON handoffs(status);
  `);

  // Run migrations for existing databases
  runMigrations(database);
}

/**
 * Run migrations for schema changes
 */
function runMigrations(database: Database.Database): void {
  // Check if mentions column exists in messages table
  const messagesInfo = database.prepare("PRAGMA table_info(messages)").all() as { name: string }[];
  const hasMessagesColumn = messagesInfo.some(col => col.name === 'mentions');
  if (!hasMessagesColumn) {
    database.exec("ALTER TABLE messages ADD COLUMN mentions TEXT DEFAULT '[]'");
  }

  // Check if discussion columns exist in rooms table
  const roomsInfo = database.prepare("PRAGMA table_info(rooms)").all() as { name: string }[];
  const hasDiscussionActive = roomsInfo.some(col => col.name === 'discussion_active');
  const hasDiscussionConfig = roomsInfo.some(col => col.name === 'discussion_config');
  
  if (!hasDiscussionActive) {
    database.exec("ALTER TABLE rooms ADD COLUMN discussion_active INTEGER DEFAULT 0");
  }
  if (!hasDiscussionConfig) {
    database.exec("ALTER TABLE rooms ADD COLUMN discussion_config TEXT DEFAULT NULL");
  }
}

// ============================================================================
// Agent CRUD
// ============================================================================

export function insertAgent(agent: AgentConfig): void {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT INTO agents (id, name, type, enabled, config, adapter_path, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    agent.id,
    agent.name,
    agent.type,
    agent.enabled ? 1 : 0,
    JSON.stringify(agent.config),
    agent.adapterPath || null,
    agent.createdAt.toISOString(),
    agent.updatedAt.toISOString()
  );
}

export function getAgent(id: string): AgentConfig | null {
  const db = getDatabase();
  const stmt = db.prepare('SELECT * FROM agents WHERE id = ?');
  const row = stmt.get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return rowToAgent(row);
}

export function getAllAgents(): AgentConfig[] {
  const db = getDatabase();
  const stmt = db.prepare('SELECT * FROM agents');
  const rows = stmt.all() as Record<string, unknown>[];
  return rows.map(rowToAgent);
}

export function getEnabledAgents(): AgentConfig[] {
  const db = getDatabase();
  const stmt = db.prepare('SELECT * FROM agents WHERE enabled = 1');
  const rows = stmt.all() as Record<string, unknown>[];
  return rows.map(rowToAgent);
}

export function updateAgent(id: string, updates: Partial<AgentConfig>): void {
  const db = getDatabase();
  const existing = getAgent(id);
  if (!existing) throw new Error(`Agent not found: ${id}`);

  const updated = { ...existing, ...updates, updatedAt: new Date() };
  const stmt = db.prepare(`
    UPDATE agents SET name = ?, type = ?, enabled = ?, config = ?, adapter_path = ?, updated_at = ?
    WHERE id = ?
  `);
  stmt.run(
    updated.name,
    updated.type,
    updated.enabled ? 1 : 0,
    JSON.stringify(updated.config),
    updated.adapterPath || null,
    updated.updatedAt.toISOString(),
    id
  );
}

export function deleteAgent(id: string): void {
  const db = getDatabase();
  const stmt = db.prepare('DELETE FROM agents WHERE id = ?');
  stmt.run(id);
}

function rowToAgent(row: Record<string, unknown>): AgentConfig {
  return {
    id: row.id as string,
    name: row.name as string,
    type: row.type as AgentConfig['type'],
    enabled: row.enabled === 1,
    config: JSON.parse(row.config as string),
    adapterPath: row.adapter_path as string | undefined,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

// ============================================================================
// Room CRUD
// ============================================================================

export function insertRoom(room: Room): void {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT INTO rooms (id, name, mode, agents, created_at, updated_at, metadata, discussion_active, discussion_config)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    room.id,
    room.name,
    room.mode,
    JSON.stringify(room.agents),
    room.createdAt.toISOString(),
    room.updatedAt.toISOString(),
    JSON.stringify(room.metadata || {}),
    room.discussionActive ? 1 : 0,
    room.discussionConfig ? JSON.stringify(room.discussionConfig) : null
  );
}

export function getRoom(id: string): Room | null {
  const db = getDatabase();
  const stmt = db.prepare('SELECT * FROM rooms WHERE id = ?');
  const row = stmt.get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return rowToRoom(row);
}

export function getAllRooms(): Room[] {
  const db = getDatabase();
  const stmt = db.prepare('SELECT * FROM rooms ORDER BY created_at DESC');
  const rows = stmt.all() as Record<string, unknown>[];
  return rows.map(rowToRoom);
}

export function updateRoom(id: string, updates: Partial<Room>): void {
  const db = getDatabase();
  const existing = getRoom(id);
  if (!existing) throw new Error(`Room not found: ${id}`);

  const updated = { ...existing, ...updates, updatedAt: new Date() };
  const stmt = db.prepare(`
    UPDATE rooms SET name = ?, mode = ?, agents = ?, updated_at = ?, metadata = ?, discussion_active = ?, discussion_config = ?
    WHERE id = ?
  `);
  stmt.run(
    updated.name,
    updated.mode,
    JSON.stringify(updated.agents),
    updated.updatedAt.toISOString(),
    JSON.stringify(updated.metadata || {}),
    updated.discussionActive ? 1 : 0,
    updated.discussionConfig ? JSON.stringify(updated.discussionConfig) : null,
    id
  );
}

export function deleteRoom(id: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM messages WHERE room_id = ?').run(id);
  db.prepare('DELETE FROM rooms WHERE id = ?').run(id);
}

function rowToRoom(row: Record<string, unknown>): Room {
  return {
    id: row.id as string,
    name: row.name as string,
    mode: row.mode as Room['mode'],
    agents: JSON.parse(row.agents as string),
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
    metadata: JSON.parse((row.metadata as string) || '{}'),
    discussionActive: row.discussion_active === 1,
    discussionConfig: row.discussion_config 
      ? JSON.parse(row.discussion_config as string) 
      : undefined,
  };
}

// ============================================================================
// Message CRUD
// ============================================================================

export function insertMessage(message: Message): void {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT INTO messages (id, room_id, sender, sender_name, content, timestamp, reply_to, confidence, mentions, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    message.id,
    message.roomId,
    message.sender,
    message.senderName,
    message.content,
    message.timestamp.toISOString(),
    message.replyTo || null,
    message.confidence || null,
    JSON.stringify(message.mentions || []),
    JSON.stringify(message.metadata || {})
  );
}

export function getMessagesForRoom(roomId: string, limit?: number): Message[] {
  const db = getDatabase();
  let query = 'SELECT * FROM messages WHERE room_id = ? ORDER BY timestamp ASC';
  if (limit) query += ` LIMIT ${limit}`;
  const stmt = db.prepare(query);
  const rows = stmt.all(roomId) as Record<string, unknown>[];
  return rows.map(rowToMessage);
}

export function getLatestMessages(roomId: string, count: number): Message[] {
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT * FROM (
      SELECT * FROM messages WHERE room_id = ? ORDER BY timestamp DESC LIMIT ?
    ) ORDER BY timestamp ASC
  `);
  const rows = stmt.all(roomId, count) as Record<string, unknown>[];
  return rows.map(rowToMessage);
}

export function getMessagesSince(roomId: string, since: Date): Message[] {
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT * FROM messages 
    WHERE room_id = ? AND timestamp > ? 
    ORDER BY timestamp ASC
  `);
  const rows = stmt.all(roomId, since.toISOString()) as Record<string, unknown>[];
  return rows.map(rowToMessage);
}

export function getMessageCount(roomId: string): number {
  const db = getDatabase();
  const stmt = db.prepare('SELECT COUNT(*) as count FROM messages WHERE room_id = ?');
  const row = stmt.get(roomId) as { count: number };
  return row.count;
}

export function getRoomsWithActiveDiscussions(): Room[] {
  const db = getDatabase();
  const stmt = db.prepare('SELECT * FROM rooms WHERE discussion_active = 1');
  const rows = stmt.all() as Record<string, unknown>[];
  return rows.map(rowToRoom);
}

function rowToMessage(row: Record<string, unknown>): Message {
  return {
    id: row.id as string,
    roomId: row.room_id as string,
    sender: row.sender as string,
    senderName: row.sender_name as string,
    content: row.content as string,
    timestamp: new Date(row.timestamp as string),
    replyTo: row.reply_to as string | undefined,
    confidence: row.confidence as number | undefined,
    mentions: JSON.parse((row.mentions as string) || '[]'),
    metadata: JSON.parse((row.metadata as string) || '{}'),
  };
}

// ============================================================================
// Handoff CRUD (for failure recovery)
// ============================================================================

export function insertHandoff(handoff: AgentHandoff): void {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT INTO handoffs (id, task_id, from_agent, to_agent, timestamp, context, checkpoint, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    handoff.id,
    handoff.taskId,
    handoff.fromAgent,
    handoff.toAgent,
    handoff.timestamp.toISOString(),
    JSON.stringify(handoff.context),
    handoff.checkpoint,
    handoff.status
  );
}

export function getHandoff(id: string): AgentHandoff | null {
  const db = getDatabase();
  const stmt = db.prepare('SELECT * FROM handoffs WHERE id = ?');
  const row = stmt.get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return rowToHandoff(row);
}

export function getPendingHandoffs(): AgentHandoff[] {
  const db = getDatabase();
  const stmt = db.prepare('SELECT * FROM handoffs WHERE status = ? ORDER BY timestamp ASC');
  const rows = stmt.all('pending') as Record<string, unknown>[];
  return rows.map(rowToHandoff);
}

export function updateHandoffStatus(id: string, status: AgentHandoff['status']): void {
  const db = getDatabase();
  const stmt = db.prepare('UPDATE handoffs SET status = ? WHERE id = ?');
  stmt.run(status, id);
}

function rowToHandoff(row: Record<string, unknown>): AgentHandoff {
  const context = JSON.parse(row.context as string);
  return {
    id: row.id as string,
    taskId: row.task_id as string,
    fromAgent: row.from_agent as string,
    toAgent: row.to_agent as string,
    timestamp: new Date(row.timestamp as string),
    context: {
      ...context,
      conversationHistory: context.conversationHistory.map((m: Record<string, unknown>) => ({
        ...m,
        timestamp: new Date(m.timestamp as string),
      })),
    },
    checkpoint: row.checkpoint as string,
    status: row.status as AgentHandoff['status'],
  };
}

// ============================================================================
// Cleanup
// ============================================================================

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
