export type StreamStatus = "active" | "paused" | "blocked" | "archived" | "superseded";

export type StreamEntryType =
  | "state-change"
  | "decision"
  | "artifact"
  | "metric"
  | "alert"
  | "contradiction"
  | "supersession"
  | "handoff"
  | "ownership"
  | "verification"
  | "note";

export type StreamLinkType = "quest" | "session" | "worker" | "message" | "artifact" | "stream" | "source";

export type StreamSteeringMode = "leader-steered" | "user-steered" | "monitor-only" | "blocked";

export type StreamFactStatus = "active" | "superseded" | "disputed" | "needs-verification";

export interface StreamLink {
  type: StreamLinkType;
  ref: string;
  label?: string;
}

export interface StreamOwner {
  ref: string;
  role?: string;
  steeringMode?: StreamSteeringMode;
}

export interface StreamPinnedFact {
  id: string;
  text: string;
  status: StreamFactStatus;
  source?: string;
  createdAt: number;
  lastVerifiedAt?: string;
  supersededBy?: string;
}

export interface StreamCurrentState {
  summary: string;
  health?: string;
  operationalStatus?: string;
  paperworkStatus?: string;
  blockedOn?: string;
  nextCheckAt?: string;
  lastVerifiedAt?: string;
  openDecisions?: string[];
  knownStaleFacts?: string[];
  activeTimers?: string[];
}

export interface StreamTimelineEntry {
  id: string;
  type: StreamEntryType;
  text: string;
  ts: number;
  authorSessionId?: string;
  source?: string;
  confidence?: "observed" | "inferred" | "user-confirmed";
  links?: StreamLink[];
  artifacts?: string[];
  pins?: string[];
  staleFacts?: string[];
  supersedes?: string[];
  statePatch?: Partial<StreamCurrentState>;
}

export interface StreamRecord {
  id: string;
  slug: string;
  title: string;
  description?: string;
  tags?: string[];
  scope: string;
  status: StreamStatus;
  createdAt: number;
  updatedAt: number;
  archivedAt?: number;
  parentId?: string;
  childIds?: string[];
  current: StreamCurrentState;
  links?: StreamLink[];
  owners?: StreamOwner[];
  pinnedFacts?: StreamPinnedFact[];
  timeline: StreamTimelineEntry[];
}

export interface StreamScopeFile {
  scope: string;
  nextId: number;
  streams: StreamRecord[];
}

export interface StreamCreateInput {
  title: string;
  description?: string;
  tags?: string[];
  scope: string;
  status?: StreamStatus;
  summary?: string;
  health?: string;
  parent?: string;
  links?: StreamLink[];
  owners?: StreamOwner[];
  pinnedFacts?: string[];
  authorSessionId?: string;
}

export interface StreamUpdateInput {
  streamRef: string;
  scope: string;
  type: StreamEntryType;
  text: string;
  authorSessionId?: string;
  source?: string;
  confidence?: StreamTimelineEntry["confidence"];
  status?: StreamStatus;
  statePatch?: Partial<StreamCurrentState>;
  links?: StreamLink[];
  artifacts?: string[];
  pins?: string[];
  staleFacts?: string[];
  supersedes?: string[];
  owners?: StreamOwner[];
}

export interface StreamListOptions {
  scope?: string;
  status?: StreamStatus;
  includeArchived?: boolean;
  tag?: string;
  text?: string;
}
