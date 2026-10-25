import type {
  TimelineRow,
  TimelineUserConversationRow,
} from "@bb/server-contract";
import { assertNever } from "./assert-never.js";
import { parseSentThreadMessage } from "./tool-call-parsing.js";

function isSuccessfulChildCompletionNotice(
  row: TimelineUserConversationRow,
): boolean {
  if (row.initiator !== "system") return false;
  if (row.systemMessageKind === "child-completed") return true;
  if (row.systemMessageKind !== "child-outcome-batch") return false;
  const subject = row.systemMessageSubject;
  const outcomes =
    subject?.kind === "thread-batch" ? (subject.outcomes ?? []) : [];
  return (
    outcomes.length > 0 &&
    outcomes.every((outcome) => outcome.status === "completed")
  );
}

export function isAgentMessageTimelineRow(row: TimelineRow): boolean {
  switch (row.kind) {
    case "conversation":
      if (row.role !== "user" || row.turnRequest.status === "rejected") {
        return false;
      }
      if (row.initiator === "agent") {
        return row.senderThreadId !== null;
      }
      return isSuccessfulChildCompletionNotice(row);
    case "work":
      return row.workKind === "command" && parseSentThreadMessage(row) !== null;
    case "system":
    case "turn":
      return false;
    default:
      return assertNever(row);
  }
}
