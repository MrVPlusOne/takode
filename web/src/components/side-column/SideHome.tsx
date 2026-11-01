import { LeaderHomeContent } from "../LeaderHomePage.js";
import { useLeaderHomeThreads } from "../WorkBoardBar.js";

/**
 * A leader's Home in the side column (Jiayi, Nov 1): its threads as its Home lists them, a switcher
 * for the main view, since what is clicked there opens in the main view. It reads the leader's
 * threads itself, because the leader's status row is mounted only while its conversation is on
 * screen.
 */
export function SideHome({ leaderId }: { leaderId: string }) {
  const threads = useLeaderHomeThreads(leaderId);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2" data-testid="side-home">
      <LeaderHomeContent leaderId={leaderId} threads={threads} />
    </div>
  );
}
