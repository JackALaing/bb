import { describe, expect, it } from "vitest";
import type {
  TimelineCommandWorkRow,
  TimelineConversationRow,
  TimelineDelegationWorkRow,
  TimelineRow,
  TimelineRowBase,
  TimelineSystemRow,
  TimelineTurnRow,
  TimelineUserConversationRow,
} from "@bb/server-contract";
import type { SystemMessageKind, SystemMessageSubject } from "@bb/domain";
import { isAgentMessageTimelineRow } from "../src/agent-message-rows.js";
import { buildTimelineViewRows } from "../src/timeline-view.js";

function base(id: string, seq: number): TimelineRowBase {
  return {
    id,
    threadId: "thr_parent",
    turnId: "turn-1",
    sourceSeqStart: seq,
    sourceSeqEnd: seq,
    startedAt: seq,
    createdAt: seq,
  };
}

function userRow({
  id,
  initiator = "user",
  senderThreadId = null,
  seq = 1,
  status = "accepted",
  systemMessageKind = "unlabeled",
  systemMessageSubject = null,
  text = "Hello",
}: {
  id: string;
  initiator?: TimelineUserConversationRow["initiator"];
  senderThreadId?: string | null;
  seq?: number;
  status?: TimelineUserConversationRow["turnRequest"]["status"];
  systemMessageKind?: SystemMessageKind;
  systemMessageSubject?: SystemMessageSubject | null;
  text?: string;
}): TimelineUserConversationRow {
  return {
    ...base(id, seq),
    kind: "conversation",
    role: "user",
    messageSeq: seq,
    text,
    attachments: null,
    initiator,
    senderThreadId,
    systemMessageKind,
    systemMessageSubject,
    turnRequest: { isGrouped: false, kind: "message", status },
    mentions: [],
  };
}

function assistantRow(
  id: string,
  text: string,
  seq = 1,
): TimelineConversationRow {
  return {
    ...base(id, seq),
    kind: "conversation",
    role: "assistant",
    messageSeq: seq,
    text,
    attachments: null,
    turnRequest: null,
  };
}

function commandRow({
  command,
  exitCode = 0,
  id,
  seq = 1,
  status = "completed",
}: {
  command: string;
  exitCode?: number | null;
  id: string;
  seq?: number;
  status?: TimelineCommandWorkRow["status"];
}): TimelineCommandWorkRow {
  return {
    ...base(id, seq),
    kind: "work",
    workKind: "command",
    status,
    callId: id,
    command,
    cwd: "/workspace",
    source: "exec_command",
    output: "",
    exitCode,
    completedAt: seq + 1,
    approvalStatus: null,
    activityIntents: [],
  };
}

function systemRow(id: string): TimelineSystemRow {
  return {
    ...base(id, 1),
    kind: "system",
    systemKind: "operation",
    operationKind: "generic",
    status: "completed",
    title: "Context compacted",
    detail: null,
    completedAt: 2,
  };
}

const TELL = "bb thread tell thr_wrkr234567 'Status?'";

function childSubject(
  status: "completed" | "failed" | "interrupted",
): SystemMessageSubject {
  return {
    kind: "thread",
    threadId: "thr_wrkr234567",
    threadName: "Worker",
    outcomes: [{ threadId: "thr_wrkr234567", status }],
  };
}

describe("isAgentMessageTimelineRow", () => {
  it.each<[string, TimelineRow]>([
    ["a sent thread message", commandRow({ id: "sent", command: TELL })],
    [
      "a message from another thread",
      userRow({ id: "from", initiator: "agent", senderThreadId: "thr_child" }),
    ],
    [
      "a queued message from another thread",
      userRow({
        id: "queued",
        initiator: "agent",
        senderThreadId: "thr_child",
        status: "pending",
      }),
    ],
    [
      "a child completion notice",
      userRow({
        id: "done",
        initiator: "system",
        systemMessageKind: "child-completed",
        systemMessageSubject: childSubject("completed"),
      }),
    ],
    [
      "a batch where every child completed",
      userRow({
        id: "batch-done",
        initiator: "system",
        systemMessageKind: "child-outcome-batch",
        systemMessageSubject: {
          kind: "thread-batch",
          count: 2,
          outcomes: [
            { threadId: "thr_a", status: "completed" },
            { threadId: "thr_b", status: "completed" },
          ],
        },
      }),
    ],
  ])("hides %s", (_label, row) => {
    expect(isAgentMessageTimelineRow(row)).toBe(true);
  });

  it.each<[string, TimelineRow]>([
    ["a failed send", commandRow({ id: "failed", command: TELL, exitCode: 1 })],
    [
      "a running send",
      commandRow({
        id: "running",
        command: TELL,
        status: "pending",
        exitCode: null,
      }),
    ],
    ["an ordinary command", commandRow({ id: "echo", command: "echo hi" })],
    [
      "a rejected message from another thread",
      userRow({
        id: "rejected",
        initiator: "agent",
        senderThreadId: "thr_child",
        status: "rejected",
      }),
    ],
    [
      "a user message quoting the phrases",
      userRow({
        id: "quote",
        text: "[bb message from thread:thr_x] Sent to Worker; Worker finished",
      }),
    ],
    [
      "an assistant message quoting the phrases",
      assistantRow("assistant", "Message from Worker. Worker finished."),
    ],
    ...(
      [
        "child-failed",
        "child-interrupted",
        "child-needs-attention",
        "ownership-assigned",
        "unlabeled",
      ] as const
    ).map((kind): [string, TimelineRow] => [
      `a ${kind} system message`,
      userRow({
        id: kind,
        initiator: "system",
        systemMessageKind: kind,
        systemMessageSubject: childSubject("failed"),
      }),
    ]),
    [
      "a batch with a failed child",
      userRow({
        id: "batch-mixed",
        initiator: "system",
        systemMessageKind: "child-outcome-batch",
        systemMessageSubject: {
          kind: "thread-batch",
          count: 2,
          outcomes: [
            { threadId: "thr_a", status: "completed" },
            { threadId: "thr_b", status: "failed" },
          ],
        },
      }),
    ],
    ["a system row", systemRow("system")],
  ])("keeps %s", (_label, row) => {
    expect(isAgentMessageTimelineRow(row)).toBe(false);
  });
});

describe("buildTimelineViewRows hideRow", () => {
  const hideRow = isAgentMessageTimelineRow;

  it("removes hidden rows at the top level and inside turns and delegations", () => {
    const turn: TimelineTurnRow = {
      ...base("turn-row", 1),
      kind: "turn",
      turnId: "turn-1",
      status: "completed",
      summaryCount: 2,
      completedAt: 10,
      children: [
        assistantRow("turn-assistant", "Working", 2),
        commandRow({ id: "turn-sent", command: TELL, seq: 3 }),
      ],
    };
    const delegation: TimelineDelegationWorkRow = {
      ...base("delegation", 4),
      kind: "work",
      workKind: "delegation",
      status: "completed",
      callId: "delegation",
      toolName: "spawnAgent",
      childRef: null,
      background: false,
      subagentType: null,
      description: null,
      output: "",
      completedAt: 6,
      childRows: [
        commandRow({ id: "delegation-sent", command: TELL, seq: 5 }),
        assistantRow("delegation-assistant", "Done", 6),
      ],
    };
    const rows: TimelineRow[] = [
      userRow({ id: "user", text: "Start" }),
      commandRow({ id: "sent", command: TELL, seq: 2 }),
      turn,
      delegation,
      userRow({
        id: "from",
        initiator: "agent",
        senderThreadId: "thr_child",
        seq: 7,
      }),
      assistantRow("assistant", "Reply", 8),
    ];

    const visible = buildTimelineViewRows(rows, { hideRow });
    const ids = visible.map((row) => row.id);
    expect(ids).toEqual(["user", "turn-row", "delegation", "assistant"]);
    const turnView = visible[1];
    expect(
      turnView?.kind === "turn"
        ? turnView.children?.map((row) => row.id)
        : null,
    ).toEqual(["turn-assistant"]);
    const delegationView = visible[2];
    expect(
      delegationView?.kind === "work" &&
        delegationView.workKind === "delegation"
        ? delegationView.childRows?.map((row) => row.id)
        : null,
    ).toEqual(["delegation-assistant"]);
  });

  it("drops a completed turn whose children are all hidden", () => {
    const turn = (
      id: string,
      status: TimelineTurnRow["status"],
      children: TimelineRow[] | null,
    ): TimelineTurnRow => ({
      ...base(id, 2),
      kind: "turn",
      turnId: id,
      status,
      summaryCount: children?.length ?? 1,
      completedAt: status === "pending" ? null : 10,
      children,
    });
    const rows: TimelineRow[] = [
      userRow({ id: "user", text: "Start" }),
      turn("only-sent", "completed", [
        commandRow({ id: "sent", command: TELL, seq: 3 }),
      ]),
      turn("running", "pending", [
        commandRow({ id: "running-sent", command: TELL, seq: 4 }),
      ]),
      turn("failed", "error", [
        commandRow({ id: "failed-sent", command: TELL, seq: 5 }),
      ]),
      turn("stopped", "interrupted", [
        commandRow({ id: "stopped-sent", command: TELL, seq: 6 }),
      ]),
      turn("lazy", "completed", null),
      turn("empty", "completed", []),
      assistantRow("assistant", "Done", 7),
    ];

    expect(
      buildTimelineViewRows(rows, { hideRow }).map((row) => row.id),
    ).toEqual([
      "user",
      "running",
      "failed",
      "stopped",
      "lazy",
      "empty",
      "assistant",
    ]);
    expect(buildTimelineViewRows(rows).map((row) => row.id)).toContain(
      "only-sent",
    );
  });

  it("keeps every row when no predicate is supplied", () => {
    const rows: TimelineRow[] = [
      commandRow({ id: "sent", command: TELL }),
      userRow({ id: "from", initiator: "agent", senderThreadId: "thr_child" }),
    ];
    expect(buildTimelineViewRows(rows).map((row) => row.id)).toEqual([
      "sent",
      "from",
    ]);
  });

  it("summarizes the work around a hidden sent message as one step", () => {
    const rows: TimelineRow[] = [
      userRow({ id: "user", text: "Start" }),
      commandRow({ id: "a", command: "pnpm test", seq: 2 }),
      commandRow({ id: "sent", command: TELL, seq: 3 }),
      commandRow({ id: "b", command: "pnpm build", seq: 4 }),
      assistantRow("assistant", "Done", 5),
    ];
    const shown = buildTimelineViewRows(rows).map((row) => row.kind);
    expect(shown).toContain("work");
    const hidden = buildTimelineViewRows(rows, { hideRow });
    expect(hidden.map((row) => row.kind)).toEqual([
      "conversation",
      "step-summary",
      "conversation",
    ]);
  });
});
