// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAppSettings } from "@bb/domain";
import type { TimelineRow } from "@bb/server-contract";
import { buildTimelineViewRows } from "@bb/thread-view";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import {
  BottomAnchorContext,
  type BottomAnchorContextValue,
} from "@/components/ui/bottom-anchored-scroll-body";
import { systemConfigQueryKey } from "@/hooks/queries/query-keys";
import { makeSystemConfig } from "@/test/fixtures/system-config";
import {
  commandRow,
  conversationRow,
  turnRow,
} from "@/test/fixtures/thread-timeline-rows";
import { createInertScrollPositionKeeper } from "@/test/scroll-position-keeper";
import { resolveAgentMessageRevealTarget } from "./ThreadTimelineRows";
import { ThreadTimelineSurface } from "./ThreadTimelineSurface";

vi.mock("@bb/thread-view", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@bb/thread-view")>();
  return {
    ...actual,
    buildTimelineViewRows: vi.fn(actual.buildTimelineViewRows),
  };
});

const buildViewRows = vi.mocked(buildTimelineViewRows);

function topLevelBuilds(rows: TimelineRow[]): number {
  return buildViewRows.mock.calls.filter(([input]) => input === rows).length;
}

const THREAD_ID = "thr_agentmsgs";
const TELL = "bb thread tell thr_wrkr234567 'Status?'";

class IntersectionObserverStub implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = "0px";
  readonly scrollMargin = "0px";
  readonly thresholds = [0];
  disconnect = vi.fn();
  observe = vi.fn();
  takeRecords = vi.fn(() => []);
  unobserve = vi.fn();
}

class ResizeObserverStub implements ResizeObserver {
  disconnect = vi.fn();
  observe = vi.fn();
  unobserve = vi.fn();
}

function rect(top: number, height: number): DOMRect {
  return {
    bottom: top + height,
    height,
    left: 0,
    right: 600,
    top,
    width: 600,
    x: 0,
    y: top,
    toJSON: () => ({}),
  };
}

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
      senderThreadId: "thr_wrkr234567",
      seq: seq + 1,
      text: `[bb message from thread:thr_wrkr234567] Reply ${index}`,
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
        threadId: "thr_wrkr234567",
        threadName: "Worker",
        outcomes: [{ threadId: "thr_wrkr234567", status: "completed" }],
      },
      text: `Child completed ${index}`,
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
        threadId: "thr_wrkr234567",
        threadName: "Worker",
        outcomes: [{ threadId: "thr_wrkr234567", status: "failed" }],
      },
      text: "Child failed",
      threadId: THREAD_ID,
    }),
    conversationRow({
      id: "child-attention",
      role: "user",
      initiator: "system",
      seq: seq + 2,
      systemMessageKind: "child-needs-attention",
      text: "Child needs attention",
      threadId: THREAD_ID,
    }),
    conversationRow({
      id: "user-quote",
      role: "user",
      seq: seq + 3,
      text: "Message from Worker: Worker finished",
      threadId: THREAD_ID,
    }),
  ];
}

const PRESERVED_IDS = [
  "failed-send",
  "child-failed",
  "child-attention",
  "user-quote",
];

function longTimeline(pairs: number): TimelineRow[] {
  const rows: TimelineRow[] = [];
  let seq = 1;
  for (let index = 0; index < pairs; index += 1) {
    rows.push(
      conversationRow({
        id: `user-${index}`,
        role: "user",
        seq,
        text: `User message ${index}`,
        threadId: THREAD_ID,
      }),
    );
    rows.push(...coordinationRows(index, seq + 1));
    rows.push(
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

function bottomAnchor(): BottomAnchorContextValue {
  const scrollElement = document.createElement("div");
  scrollElement.setAttribute("data-test-main-scroll", "");
  return {
    positionKeeper: createInertScrollPositionKeeper(),
    holdContentPosition: vi.fn(),
    getScrollElement: () => scrollElement,
    isAtBottom: true,
    scrollElementIntoView: vi.fn(),
    scrollElementIntoViewClampedToMaxScroll: vi.fn(),
    scrollToBottom: vi.fn(),
  };
}

function setShowAgentMessages(queryClient: QueryClient, value: boolean): void {
  queryClient.setQueryData(
    systemConfigQueryKey(),
    makeSystemConfig({
      generalSettings: { ...defaultAppSettings, showAgentMessages: value },
    }),
  );
}

interface RenderArgs {
  initialEntries?: Parameters<typeof MemoryRouter>[0]["initialEntries"];
  navigationTargetRowId?: string | null;
  rows: TimelineRow[];
  showAgentMessages?: boolean;
}

function renderTimeline({
  initialEntries,
  navigationTargetRowId = null,
  rows,
  showAgentMessages = false,
}: RenderArgs) {
  const queryClient = new QueryClient();
  setShowAgentMessages(queryClient, showAgentMessages);
  const anchor = bottomAnchor();
  const tree = (nextRows: TimelineRow[], targetRowId: string | null) => (
    <MemoryRouter initialEntries={initialEntries}>
      <QueryClientProvider client={queryClient}>
        <BottomAnchorContext.Provider value={anchor}>
          <CompactViewportOverrideProvider isCompactViewport={false}>
            <ThreadTimelineSurface
              activeThinking={null}
              contextBoundarySeq={null}
              isThreadTimelinePending={false}
              showOngoingIndicator={false}
              threadId={THREAD_ID}
              threadRuntimeDisplayStatus="idle"
              timelineError={false}
              timelineNavigationTargetRowId={targetRowId}
              timelineRows={nextRows}
              workspaceRootPath={undefined}
            />
          </CompactViewportOverrideProvider>
        </BottomAnchorContext.Provider>
      </QueryClientProvider>
    </MemoryRouter>
  );
  const view = render(tree(rows, navigationTargetRowId));
  return {
    queryClient,
    rerender: (nextRows: TimelineRow[], targetRowId = navigationTargetRowId) =>
      view.rerender(tree(nextRows, targetRowId)),
    view,
  };
}

function topLevelWindowKeys(container: HTMLElement): string[] {
  const list = container.querySelector('[data-timeline-row-list="top-level"]');
  return Array.from(
    list?.querySelectorAll<HTMLElement>("[data-timeline-window-key]") ?? [],
  ).map((element) => element.dataset.timelineWindowKey ?? "");
}

function mountedRowIds(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>("[data-timeline-row-id]"),
  ).map((element) => element.dataset.timelineRowId ?? "");
}

function isCoordinationId(id: string): boolean {
  return /^(sent|from|done)-\d+$/.test(id);
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.hasAttribute("data-test-main-scroll") ? 800 : 0;
    },
  );
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return this.hasAttribute("data-test-main-scroll")
        ? rect(0, 800)
        : rect(0, 32);
    },
  );
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ThreadTimelineRows agent messages", () => {
  it("shows coordination rows by default", async () => {
    const rows = longTimeline(3);
    const { view } = renderTimeline({ rows, showAgentMessages: true });
    await waitFor(() => {
      const ids = mountedRowIds(view.container);
      expect(ids).toContain("sent-2");
      expect(ids).toContain("from-2");
      expect(ids).toContain("done-2");
    });
    expect(view.container.textContent).toContain("Sent to");
  });

  it("removes hidden rows from a short timeline and keeps preserved rows", async () => {
    const rows = longTimeline(3);
    const { view } = renderTimeline({ rows });
    await waitFor(() =>
      expect(mountedRowIds(view.container)).toContain("assistant-2"),
    );
    const ids = mountedRowIds(view.container);
    expect(ids.filter(isCoordinationId)).toEqual([]);
    for (const id of PRESERVED_IDS) expect(ids).toContain(id);
    expect(view.container.textContent).not.toContain("Sent to");
    expect(view.container.textContent).not.toContain("Reply 1");
    expect(view.container.textContent).not.toContain("Child completed");
  });

  it("removes hidden rows before windowing in a long timeline", async () => {
    const rows = longTimeline(200);
    const { view } = renderTimeline({ rows });
    await waitFor(() =>
      expect(
        view.container.querySelector("[data-timeline-virtual-spacer]"),
      ).not.toBeNull(),
    );
    await waitFor(() =>
      expect(mountedRowIds(view.container)).toContain("user-quote"),
    );
    const keys = topLevelWindowKeys(view.container);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.length).toBeLessThan(400);
    expect(keys.filter(isCoordinationId)).toEqual([]);
    expect(mountedRowIds(view.container).filter(isCoordinationId)).toEqual([]);
    for (const id of PRESERVED_IDS) {
      expect(mountedRowIds(view.container)).toContain(id);
    }
  });

  it("hides rows that arrive while the timeline is open", async () => {
    const rows = longTimeline(2);
    const { rerender, view } = renderTimeline({ rows });
    await waitFor(() =>
      expect(mountedRowIds(view.container)).toContain("assistant-1"),
    );
    const lastSeq = rows.at(-1)?.sourceSeqEnd ?? 0;
    rerender([
      ...rows,
      ...coordinationRows(99, lastSeq + 1),
      conversationRow({
        id: "assistant-live",
        role: "assistant",
        seq: lastSeq + 10,
        text: "Live assistant reply",
        threadId: THREAD_ID,
      }),
    ]);
    await waitFor(() =>
      expect(mountedRowIds(view.container)).toContain("assistant-live"),
    );
    expect(mountedRowIds(view.container).filter(isCoordinationId)).toEqual([]);
  });

  it("applies a setting change without reloading the timeline", async () => {
    const rows = longTimeline(2);
    const { queryClient, view } = renderTimeline({ rows });
    await waitFor(() =>
      expect(mountedRowIds(view.container)).toContain("assistant-1"),
    );
    expect(mountedRowIds(view.container).filter(isCoordinationId)).toEqual([]);
    act(() => setShowAgentMessages(queryClient, true));
    await waitFor(() =>
      expect(mountedRowIds(view.container)).toContain("done-1"),
    );
    expect(mountedRowIds(view.container)).toContain("sent-0");
    act(() => setShowAgentMessages(queryClient, false));
    await waitFor(() =>
      expect(mountedRowIds(view.container).filter(isCoordinationId)).toEqual(
        [],
      ),
    );
  });

  it("shows a hidden message that the outline navigates to", async () => {
    const rows = longTimeline(2);
    const { rerender, view } = renderTimeline({ rows });
    await waitFor(() =>
      expect(mountedRowIds(view.container)).toContain("assistant-1"),
    );
    rerender(rows, "from-1");
    await waitFor(() =>
      expect(mountedRowIds(view.container)).toContain("from-1"),
    );
    expect(
      mountedRowIds(view.container).filter(
        (id) => isCoordinationId(id) && id !== "from-1",
      ),
    ).toEqual([]);
  });

  it("shows a hidden message opened from search or a message link", async () => {
    const rows = longTimeline(2);
    const target = rows.find((row) => row.id === "from-0");
    expect(target?.kind).toBe("conversation");
    const seq = target?.kind === "conversation" ? target.messageSeq : 0;
    const { view } = renderTimeline({
      rows,
      initialEntries: [`/threads/${THREAD_ID}#msg=${seq}`],
    });
    await waitFor(() =>
      expect(mountedRowIds(view.container)).toContain("from-0"),
    );
    expect(
      mountedRowIds(view.container).filter(
        (id) => isCoordinationId(id) && id !== "from-0",
      ),
    ).toEqual([]);
  });
  it("keeps the view rows when the outline targets an ordinary message", async () => {
    const rows = longTimeline(2);
    const { rerender, view } = renderTimeline({ rows });
    await waitFor(() =>
      expect(mountedRowIds(view.container)).toContain("assistant-1"),
    );
    const builds = topLevelBuilds(rows);
    rerender(rows, "user-1");
    rerender(rows, "assistant-0");
    expect(topLevelBuilds(rows)).toBe(builds);
    rerender(rows, "from-1");
    await waitFor(() =>
      expect(mountedRowIds(view.container)).toContain("from-1"),
    );
    expect(topLevelBuilds(rows)).toBe(builds + 1);
  });
});

describe("resolveAgentMessageRevealTarget", () => {
  const rows: TimelineRow[] = [
    ...longTimeline(1),
    turnRow({
      sourceSeqStart: 50,
      sourceSeqEnd: 60,
      threadId: THREAD_ID,
      turnId: "turn_lazy",
    }),
  ];
  const none = {
    navigationTargetRowId: null,
    searchMatch: null,
    searchSeq: null,
  };

  it("ignores targets that cannot reveal a hidden row", () => {
    expect(
      resolveAgentMessageRevealTarget(rows, {
        navigationTargetRowId: "user-0",
        searchMatch: "message",
        searchSeq: 1,
      }),
    ).toEqual(none);
  });

  it("keeps a target on a hidden row", () => {
    expect(
      resolveAgentMessageRevealTarget(rows, {
        ...none,
        navigationTargetRowId: "from-0",
      }),
    ).toEqual({ ...none, navigationTargetRowId: "from-0" });
    expect(
      resolveAgentMessageRevealTarget(rows, {
        ...none,
        searchMatch: "message",
        searchSeq: 3,
      }),
    ).toEqual({ ...none, searchMatch: "message", searchSeq: 3 });
  });

  it("keeps a search target inside a turn whose rows load later", () => {
    expect(
      resolveAgentMessageRevealTarget(rows, {
        ...none,
        searchMatch: "message",
        searchSeq: 55,
      }),
    ).toEqual({ ...none, searchMatch: "message", searchSeq: 55 });
  });
});
