import type { BoardParticipantStatus, BoardRow, BoardRowSessionStatus } from "./session-types.js";

type BoardSessionLike = {
  sessionId: string;
  sessionNum?: number | null;
  reviewerOf?: number;
  archived?: boolean;
  state?: string | null;
  cliConnected?: boolean;
  name?: string;
};

export function deriveBoardParticipantRuntimeStatus(
  session: Pick<BoardSessionLike, "archived" | "cliConnected" | "state">,
) {
  if (session.archived) return "archived" as const;
  if (session.cliConnected) return session.state === "running" ? ("running" as const) : ("idle" as const);
  return "disconnected" as const;
}

function toBoardParticipantStatus(session: BoardSessionLike): BoardParticipantStatus {
  return {
    sessionId: session.sessionId,
    sessionNum: session.sessionNum,
    name: session.name,
    status: deriveBoardParticipantRuntimeStatus(session),
  };
}

export function buildBoardRowSessionStatuses(
  rows: BoardRow[],
  sessions: BoardSessionLike[],
): Record<string, BoardRowSessionStatus> {
  if (rows.length === 0) return {};

  const sessionsById = new Map(sessions.map((session) => [session.sessionId, session]));
  const sessionsByNum = new Map<number, BoardSessionLike>();
  const activeReviewersByParent = new Map<number, BoardSessionLike>();

  for (const session of sessions) {
    if (session.sessionNum != null) sessionsByNum.set(session.sessionNum, session);
    if (!session.archived && session.reviewerOf != null && !activeReviewersByParent.has(session.reviewerOf)) {
      activeReviewersByParent.set(session.reviewerOf, session);
    }
  }

  const statuses: Record<string, BoardRowSessionStatus> = {};
  for (const row of rows) {
    const workerSession =
      (row.worker ? sessionsById.get(row.worker) : undefined) ??
      (row.workerNum != null ? sessionsByNum.get(row.workerNum) : undefined);
    const reviewerSession =
      row.workerNum != null
        ? activeReviewersByParent.get(row.workerNum)
        : workerSession?.sessionNum != null
          ? activeReviewersByParent.get(workerSession.sessionNum)
          : undefined;

    statuses[row.questId] = {
      ...(workerSession ? { worker: toBoardParticipantStatus(workerSession) } : {}),
      reviewer: reviewerSession ? toBoardParticipantStatus(reviewerSession) : null,
    };
  }

  return statuses;
}
