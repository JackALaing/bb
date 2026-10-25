import { useMemo, useState } from "react";
import type { TimelineRow } from "@bb/server-contract";
import { ThreadTimelineRows } from "@/components/thread/timeline";
import {
  commandRow,
  conversationRow,
} from "@/test/fixtures/thread-timeline-rows";

export default {
  title: "thread/timeline/rows/Agent messages",
};

const THREAD_ID = "thr_agentmsgs2";
const CHILD_ID = "thr_wrkr234567";
const TELL = `bb thread tell ${CHILD_ID} 'Status?'`;

function coordinationRows(index: number, seq: number): TimelineRow[] {
  return [
    commandRow({
      id: `sent-${index}`,
      command: TELL,
      exitCode: 0,
      seq,
      threadId: THREAD_ID,
    }),
    conversationRow({
      id: `from-${index}`,
      role: "user",
      initiator: "agent",
      senderThreadId: CHILD_ID,
      seq: seq + 1,
      text: `[bb message from thread:${CHILD_ID}] Reply ${index}`,
      threadId: THREAD_ID,
    }),
    conversationRow({
      id: `done-${index}`,
      role: "user",
      initiator: "system",
      seq: seq + 2,
      systemMessageKind: "child-completed",
      systemMessageSubject: {
        kind: "thread",
        threadId: CHILD_ID,
        threadName: "Worker",
        outcomes: [{ threadId: CHILD_ID, status: "completed" }],
      },
      text: `Worker finished ${index}`,
      threadId: THREAD_ID,
    }),
  ];
}

function preservedRows(seq: number): TimelineRow[] {
  return [
    commandRow({
      id: "failed-send",
      command: TELL,
      exitCode: 1,
      seq,
      threadId: THREAD_ID,
    }),
    conversationRow({
      id: "child-failed",
      role: "user",
      initiator: "system",
      seq: seq + 1,
      systemMessageKind: "child-failed",
      systemMessageSubject: {
        kind: "thread",
        threadId: CHILD_ID,
        threadName: "Worker",
        outcomes: [{ threadId: CHILD_ID, status: "failed" }],
      },
      text: "Worker failed",
      threadId: THREAD_ID,
    }),
    conversationRow({
      id: "user-quote",
      role: "user",
      seq: seq + 2,
      text: "Message from Worker: Worker finished",
      threadId: THREAD_ID,
    }),
  ];
}

function timeline(groups: number): TimelineRow[] {
  const rows: TimelineRow[] = [];
  let seq = 1;
  for (let index = 0; index < groups; index += 1) {
    rows.push(
      conversationRow({
        id: `user-${index}`,
        role: "user",
        seq,
        text: `User message ${index}`,
        threadId: THREAD_ID,
      }),
      ...coordinationRows(index, seq + 1),
      conversationRow({
        id: `assistant-${index}`,
        role: "assistant",
        seq: seq + 4,
        text: `Assistant message ${index}`,
        threadId: THREAD_ID,
      }),
    );
    seq += 5;
  }
  rows.push(...preservedRows(seq));
  return rows;
}

function AgentMessagesStory({ groups }: { groups: number }) {
  const [showAgentMessages, setShowAgentMessages] = useState(true);
  const rows = useMemo(() => timeline(groups), [groups]);
  return (
    <div className="flex w-full max-w-[760px] flex-col gap-4">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={showAgentMessages}
          onChange={(event) => setShowAgentMessages(event.target.checked)}
        />
        Show messages between agents
      </label>
      <ThreadTimelineRows
        projectId="proj_gyz9przugq"
        showAgentMessages={showAgentMessages}
        threadId={THREAD_ID}
        threadRuntimeDisplayStatus="idle"
        timelineRows={rows}
        workspaceRootPath={undefined}
      />
    </div>
  );
}

export const ShortTimeline = () => <AgentMessagesStory groups={2} />;

export const LongTimeline = () => <AgentMessagesStory groups={300} />;
