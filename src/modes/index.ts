export { runSharedRoom, runSharedRoomTurn } from './shared-room.js';
export { runDebate, summarizeDebate } from './debate.js';
export { runConsensus, formatConsensusResult } from './consensus.js';
export { 
  startDiscussion, 
  stopDiscussion, 
  isDiscussionActive,
  getDiscussionState,
  sendMessage as sendDiscussionMessage,
  initializeFromDatabase as initializeDiscussions,
  getActiveDiscussionRoomIds
} from './real-time-discussion.js';
