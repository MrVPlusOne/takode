export const WORKSTREAM_STATUSES = ["active", "paused", "completed", "archived"] as const;
export const MEMORY_BUCKETS = ["current", "reference"] as const;
export const MEMORY_SUBTYPES = [
  "mission",
  "decision",
  "policy",
  "route",
  "design-contract",
  "worker-affinity",
  "active-run",
  "runbook-pointer",
  "known-bug-pointer",
  "report-pointer",
  "product-state-pointer",
] as const;
export const MEMORY_STATUSES = ["proposed", "active", "superseded", "retired", "archived"] as const;
export const MEMORY_PRIORITIES = ["info", "important", "blocking", "safety"] as const;
export const CURRENT_READ_PURPOSES = [
  "alignment",
  "dispatch",
  "worker-prompt",
  "journey-route",
  "execute-launch",
  "execute-monitor",
  "code-review",
  "port-planning",
  "health-watchdog",
  "worker-turn-end",
  "recovery",
  "compaction",
  "user-status-question",
  "user-checkpoint",
  "bookkeeping",
] as const;
export const MEMORY_CHECK_EVENTS = [
  "dispatch",
  "worker-prompt",
  "execute-launch",
  "worker-turn-end",
  "port-planning",
  "recovery",
  "compaction",
  "bookkeeping",
] as const;

export type WorkstreamStatus = (typeof WORKSTREAM_STATUSES)[number];
export type MemoryBucket = (typeof MEMORY_BUCKETS)[number];
export type MemorySubtype = (typeof MEMORY_SUBTYPES)[number];
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];
export type MemoryPriority = (typeof MEMORY_PRIORITIES)[number];
export type CurrentReadPurpose = (typeof CURRENT_READ_PURPOSES)[number];
export type RetrievalHook = CurrentReadPurpose;
export type MemoryCheckEvent = (typeof MEMORY_CHECK_EVENTS)[number];
export type MemoryCheckLevel = "recall" | "warn" | "gate";

export type ActorRole = "user" | "leader" | "worker" | "reviewer" | "system";
export type SourceKind =
  | "quest"
  | "quest-feedback"
  | "session"
  | "session-message"
  | "file"
  | "skill"
  | "doc"
  | "report"
  | "manual";

export interface ActorRef {
  role: ActorRole;
  ref?: string;
}

export interface SourceLink {
  kind: SourceKind;
  target: string;
  label: string;
  quote?: string;
  observedAt?: string;
}

export interface LinkedQuest {
  questId: string;
  role: "deliverable" | "dashboard" | "bug" | "follow-up" | "evidence" | "other";
  label?: string;
  linkedAt: string;
  linkedBy: ActorRef;
}

export interface LinkedSession {
  sessionNum: number;
  role: "leader" | "worker" | "reviewer" | "evidence" | "other";
  linkedAt: string;
  linkedBy: ActorRef;
}

export interface MigrationSource {
  kind: "umbrella-quest" | "reference-quest" | "report" | "manual";
  target: string;
  importedAt?: string;
  importedBy?: ActorRef;
  notes?: string;
}

export interface Workstream {
  id: string;
  slug: string;
  title: string;
  objective: string;
  status: WorkstreamStatus;
  scopeTags: string[];
  ownerProject?: string;
  createdBy: ActorRef;
  createdAt: string;
  updatedBy: ActorRef;
  updatedAt: string;
  archivedAt?: string;
  archivedBy?: ActorRef;
  linkedQuests: LinkedQuest[];
  linkedSessions: LinkedSession[];
  migrationSources: MigrationSource[];
  sourceLinks: SourceLink[];
  visibility: "default" | "project" | "private";
}

export interface AppliesTo {
  questIds?: string[];
  sessionNums?: number[];
  workerSessionNums?: number[];
  componentTags?: string[];
  domainTags?: string[];
  actionTags?: string[];
  exactTerms?: string[];
}

export interface ReferenceTarget {
  kind: "quest" | "session" | "file" | "skill" | "doc" | "report" | "product-page" | "external";
  target: string;
  label: string;
}

export interface AuthorityBoundary {
  memoryOwns: string;
  authoritativeSystem:
    | "user"
    | "quest"
    | "phase-notes"
    | "board"
    | "session-registry"
    | "timer-store"
    | "git"
    | "deployment"
    | "filesystem"
    | "skill-doc"
    | "product-state"
    | "unknown";
  conflictRule:
    | "user-overrides"
    | "product-state-overrides"
    | "newer-active-record-overrides"
    | "ask-user"
    | "block-until-resolved";
}

export interface ActivationMetadata {
  status: "proposed" | "active";
  activatedBy?: ActorRef;
  activatedAt?: string;
  activationSource?: SourceLink;
  activationScope: "workstream" | "quest" | "component" | "project";
}

export interface RetireCondition {
  description: string;
}

export interface VerificationStamp {
  verifiedAt: string;
  source: SourceLink;
}

export interface ConflictRef {
  record: string;
  reason: string;
}

export interface RecordVersion {
  version: number;
  status: MemoryStatus;
  current: string;
  details?: string;
  reason?: string;
  sourceLinks: SourceLink[];
  updatedAt: string;
  updatedBy: ActorRef;
}

export interface MemoryRecord {
  id: string;
  workstreamId: string;
  workstreamSlug: string;
  key: string;
  bucket: MemoryBucket;
  subtype: MemorySubtype;
  status: MemoryStatus;
  priority: MemoryPriority;
  title: string;
  current: string;
  details?: string;
  target?: ReferenceTarget;
  appliesTo: AppliesTo;
  retrievalHooks: RetrievalHook[];
  evidence: SourceLink[];
  supersedes: string[];
  replacedBy?: string;
  conflictsWith: ConflictRef[];
  authorityBoundary: AuthorityBoundary;
  activation: ActivationMetadata;
  activeRun?: ActiveRunDetails;
  retireWhen?: RetireCondition;
  lastVerified?: VerificationStamp;
  history: RecordVersion[];
  createdBy: ActorRef;
  createdAt: string;
  updatedBy: ActorRef;
  updatedAt: string;
}

export interface WorkstreamCreateInput {
  slug: string;
  title: string;
  objective: string;
  scopeTags?: string[];
  ownerProject?: string;
  sourceLinks?: SourceLink[];
  migrationSources?: MigrationSource[];
  visibility?: Workstream["visibility"];
  actor?: ActorRef;
}

export interface WorkstreamLinkInput {
  workstream: string;
  quests?: Omit<LinkedQuest, "linkedAt" | "linkedBy">[];
  sessions?: Omit<LinkedSession, "linkedAt" | "linkedBy">[];
  actor?: ActorRef;
}

export interface WorkstreamListFilter {
  status?: WorkstreamStatus;
  tag?: string;
  includeArchived?: boolean;
}

export interface UpsertMemoryRecordInput {
  ref: string;
  bucket: MemoryBucket;
  subtype: MemorySubtype;
  priority: MemoryPriority;
  title?: string;
  current: string;
  details?: string;
  target?: ReferenceTarget;
  appliesTo?: AppliesTo;
  retrievalHooks?: RetrievalHook[];
  evidence: SourceLink[];
  authorityBoundary: AuthorityBoundary;
  activationScope?: ActivationMetadata["activationScope"];
  status?: Extract<MemoryStatus, "proposed" | "active">;
  retireWhen?: RetireCondition;
  supersedes?: string[];
  conflictsWith?: ConflictRef[];
  activeRun?: ActiveRunDetails;
  actor?: ActorRef;
  reactivate?: boolean;
}

export interface RetireMemoryRecordInput {
  ref: string;
  reason: string;
  sourceLinks: SourceLink[];
  supersededBy?: string;
  actor?: ActorRef;
}

export interface CurrentReadQuery {
  workstream?: string;
  questId?: string;
  purpose: CurrentReadPurpose;
  componentTags?: string[];
  workerSessionNum?: number;
  includeProposed?: boolean;
  includeRetired?: boolean;
  limit?: number;
}

export interface CurrentReadResult {
  status: "ok";
  query: CurrentReadQuery;
  records: MemoryRecord[];
  warnings: string[];
}

export interface MemorySearchQuery {
  pattern: string;
  regex?: boolean;
  workstream?: string;
  includeRetired?: boolean;
  includeProposed?: boolean;
  limit?: number;
}

export interface MemorySearchResult {
  record: MemoryRecord;
  score: number;
  snippets: string[];
  remainingChildMatches: number;
}

export interface BookkeepingReport {
  workstream?: string;
  generatedAt: string;
  issues: {
    level: "info" | "warn";
    record?: string;
    message: string;
  }[];
}

export interface ActiveRunDetails {
  linkedQuestId: string;
  runOwnerSessionNum?: number;
  expectedRunState: "planned" | "launching" | "active-obligation" | "handoff-required" | "stop-required";
  targetCount?: number;
  expectedRate?: {
    metric: "problems_per_second" | "rollouts_per_second" | "rows_per_minute";
    min?: number;
    target?: number;
  };
  runIdentity?: {
    hostAlias?: string;
    tmuxName?: string;
    outputRoot?: string;
    lancePath?: string;
    logPath?: string;
  };
  monitorRequirement: {
    cadenceMinutes: number;
    ownerSessionNum?: number;
    requiredProductProof: "timer" | "worker-hard-event" | "timer-or-hard-event";
    stopConditionRequiresLeaderAction: boolean;
  };
  stopConditions: ActiveRunStopCondition[];
  dashboardUpdate?: {
    questId: string;
    cadenceMinutes?: number;
    ownerSessionNum?: number;
  };
}

export type ActiveRunStopCondition =
  | "tmux-missing"
  | "writer-process-missing"
  | "lance-not-advancing"
  | "under-target-rate"
  | "endpoint-count-below-target"
  | "endpoint-health-failing"
  | "judge-terminal-count-zero-after-launch"
  | "auth-or-capacity-blocked"
  | "dashboard-stale";

export interface MemoryCheckInput {
  event: MemoryCheckEvent;
  workstream?: string;
  questId?: string;
  actor?: ActorRef;
  productState?: ProductStateEnvelope;
  callerState?: MemoryCheckState;
  options?: {
    enforce?: boolean;
    includeWarnings?: boolean;
    maxRecords?: number;
  };
}

export type MemoryCheckState =
  | DispatchCheckState
  | WorkerPromptCheckState
  | ExecuteLaunchCheckState
  | WorkerTurnEndCheckState
  | PortPlanningCheckState
  | RecoveryCheckState
  | CompactionCheckState
  | BookkeepingCheckState;

export interface DispatchCheckState {
  kind: "dispatch";
  questId?: string;
  componentTags?: string[];
  workerSessionNum?: number;
  terms?: string[];
}

export interface WorkerPromptCheckState {
  kind: "worker-prompt";
  questId?: string;
  componentTags?: string[];
  workerSessionNum?: number;
  terms?: string[];
}

export interface ExecuteLaunchCheckState {
  kind: "execute-launch";
  questId?: string;
  longRunning: boolean;
  runKind?: string;
  targetCount?: number;
  expectedRate?: {
    metric: "problems_per_second" | "rollouts_per_second" | "rows_per_minute";
    target?: number;
    min?: number;
  };
  monitorPlan?: {
    cadenceMinutes?: number;
    ownerSessionNum?: number;
    productProof?: ProductProof;
  };
}

export interface WorkerTurnEndCheckState {
  kind: "worker-turn-end";
  questId?: string;
  workerSessionNum?: number;
  phase?: string;
  summarySignals?: ActiveRunStopCondition[];
  sourceLinks?: string[];
  reportedToUser?: boolean;
  trusted?: boolean;
}

export interface PortPlanningCheckState {
  kind: "port-planning";
  questId?: string;
  sourceBranch?: string;
  targetBranch?: string;
  deploymentTarget?: string;
  policyConflicts?: PolicyConflict[];
}

export interface RecoveryCheckState {
  kind: "recovery";
  questId?: string;
  surfacedRecordRefs?: string[];
  acknowledgedRecordRefs?: string[];
}

export interface CompactionCheckState {
  kind: "compaction";
  questId?: string;
  surfacedRecordRefs?: string[];
  acknowledgedRecordRefs?: string[];
}

export interface BookkeepingCheckState {
  kind: "bookkeeping";
  questId?: string;
  terms?: string[];
}

export interface ProductStateEnvelope {
  source: "product-adapter" | "caller-supplied";
  trusted?: boolean;
  adapter?: string;
  proofs?: ProductProof[];
}

export interface ProductProof {
  kind: "timer" | "worker-hard-event" | "git" | "deployment" | "recovery-surfaced" | "leader-notified";
  id?: string;
  trusted?: boolean;
  ok?: boolean;
  detail?: string;
}

export interface PolicyConflict {
  record: string;
  expected: string;
  actual: string;
  source?: "product-adapter" | "caller-supplied";
}

export interface MemoryCheckFinding {
  level: MemoryCheckLevel;
  record?: string;
  priority?: MemoryPriority;
  source: "memory" | "product-adapter" | "caller-supplied";
  why: string[];
  requiredAction?: string;
  sources: string[];
  authorityBoundary?: string;
  enforceable: boolean;
  ackRequired: boolean;
}

export interface MemoryCheckResult {
  status: "ok" | "warn" | "gate";
  level: MemoryCheckLevel;
  event: MemoryCheckEvent;
  enforceable: boolean;
  ackRequired: boolean;
  findings: MemoryCheckFinding[];
  requiredActions: string[];
  records: MemoryRecord[];
}
