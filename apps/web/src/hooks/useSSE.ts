/**
 * hooks/useSSE.ts — SSE 连接管理
 *
 * 连接 /api/stream，把收到的事件写入 session-aware execution store。
 * 组件 mount 时连接，unmount 时断开。
 */

import { useEffect } from "react";
import { useExecutionStore } from "../domains/execution/store";
import type { SSEEvent } from "../types";

export function useSSE(): void {
  useEffect(() => {
    const store = useExecutionStore.getState();
    store.setStreamStatus("connecting");

    const es = new EventSource("/api/stream");

    es.onopen = () => {
      useExecutionStore.getState().setStreamStatus("connected");
    };

    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as SSEEvent;
        const targetSessionId = event.sessionId;
        useExecutionStore.getState().applyRealtimeEvent(event, targetSessionId);
      } catch {
        // 忽略格式错误的消息
      }
    };

    es.onerror = () => {
      const current = useExecutionStore.getState();
      current.setStreamStatus("error");
      const targetSessionId = current.liveSessionId ?? current.activeSessionId;
      if (targetSessionId) {
        current.appendSessionLog(targetSessionId, "[SSE] Connection error, retrying...");
      }
    };

    return () => {
      useExecutionStore.getState().setStreamStatus("disconnected");
      es.close();
    };
  }, []);
}
