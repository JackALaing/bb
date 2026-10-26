// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { buildTimelineViewRows } from "@bb/thread-view";
import { describe, expect, it } from "vitest";
import type { TimelineRow } from "@bb/server-contract";
import {
  commandRow,
  conversationRow,
  turnRow,
} from "@/test/fixtures/thread-timeline-rows";
import type { ThreadTimelineUnreadDividerPlacement } from "./types";
import {
  buildTimelineRowsListItems,
  useLoadedUnreadDividerPlacement,
} from "./ThreadTimelineRows";

const DIVIDER = "__divider__";

function renderTopLevelSequence(
  timelineRows: TimelineRow[],
  unreadDividerPlacement: ThreadTimelineUnreadDividerPlacement | null,
): string[] {
  return buildTimelineRowsListItems({
    rows: buildTimelineViewRows(timelineRows),
    unreadDividerPlacement,
  }).map((item) => {
    if (item.kind !== "row") return DIVIDER;
    return item.row.kind === "conversation" ? item.row.role : item.row.kind;
  });
}

function userMessage(createdAt: number): TimelineRow {
  return conversationRow({
    id: `user-${createdAt}`,
    seq: createdAt,
    role: "user",
    text: "PROMPT",
    createdAt,
    startedAt: createdAt,
    turnId: "turn-1",
  });
}

function assistantMessage(createdAt: number): TimelineRow {
  return conversationRow({
    id: `assistant-${createdAt}`,
    seq: createdAt,
    role: "assistant",
    text: "ANSWER",
    createdAt,
    startedAt: createdAt,
    turnId: "turn-1",
  });
}

function command(createdAt: number): TimelineRow {
  return commandRow({
    id: `command-${createdAt}`,
    seq: createdAt,
    command: `echo ${createdAt}`,
    createdAt,
    startedAt: createdAt,
    turnId: "turn-1",
  });
}

describe("unread divider placement", () => {
  it("keeps the divider below a work group the reader already saw part of", () => {
    const sequence = renderTopLevelSequence(
      [
        userMessage(100),
        command(200),
        command(300),
        command(400),
        assistantMessage(500),
      ],
      { cutoffAt: 350 },
    );

    expect(sequence).toEqual(["user", "step-summary", DIVIDER, "assistant"]);
  });

  it("places the divider above a work group that started after the cutoff", () => {
    const sequence = renderTopLevelSequence(
      [
        userMessage(100),
        assistantMessage(200),
        command(400),
        command(500),
        assistantMessage(600),
      ],
      { cutoffAt: 300 },
    );

    expect(sequence).toEqual([
      "user",
      "assistant",
      DIVIDER,
      "step-summary",
      "assistant",
    ]);
  });

  it("matches collapsed-turn placement when finished turns stay flat", () => {
    const collapsed = renderTopLevelSequence(
      [
        userMessage(100),
        turnRow({
          id: "turn-row",
          seq: 100,
          createdAt: 100,
          startedAt: 100,
          turnId: "turn-1",
          summaryCount: 3,
          children: [command(200), command(300), command(400)],
        }),
        assistantMessage(500),
      ],
      { cutoffAt: 350 },
    );

    expect(collapsed).toEqual(["user", "turn", DIVIDER, "assistant"]);
  });

  it("never anchors the divider on the reader's own message", () => {
    const sequence = renderTopLevelSequence(
      [assistantMessage(100), userMessage(400), command(500)],
      { cutoffAt: 300 },
    );

    expect(sequence).toEqual(["assistant", "user", DIVIDER, "work"]);
  });

  it("omits the divider when no row started after the cutoff", () => {
    const sequence = renderTopLevelSequence(
      [userMessage(100), command(200), assistantMessage(300)],
      { cutoffAt: 400 },
    );

    expect(sequence).not.toContain(DIVIDER);
  });
});

describe("loaded unread divider placement", () => {
  it("drops a divider whose cutoff is older than the loaded rows, and keeps it dropped after older rows load", () => {
    const placement = { cutoffAt: 350 };
    const latestPage = buildTimelineViewRows([
      command(400),
      assistantMessage(500),
    ]);
    const { result, rerender } = renderHook(
      (props: Parameters<typeof useLoadedUnreadDividerPlacement>[0]) =>
        useLoadedUnreadDividerPlacement(props),
      {
        initialProps: {
          hasOlderRows: true,
          rows: latestPage,
          unreadDividerPlacement: placement,
        },
      },
    );
    expect(result.current).toBeNull();

    rerender({
      hasOlderRows: false,
      rows: buildTimelineViewRows([
        userMessage(100),
        command(200),
        command(400),
        assistantMessage(500),
      ]),
      unreadDividerPlacement: placement,
    });
    expect(result.current).toBeNull();
  });

  it("keeps a divider whose cutoff falls inside the loaded rows", () => {
    const placement = { cutoffAt: 350 };
    const { result } = renderHook(() =>
      useLoadedUnreadDividerPlacement({
        hasOlderRows: true,
        rows: buildTimelineViewRows([
          userMessage(300),
          command(400),
          assistantMessage(500),
        ]),
        unreadDividerPlacement: placement,
      }),
    );
    expect(result.current).toBe(placement);
  });
});
