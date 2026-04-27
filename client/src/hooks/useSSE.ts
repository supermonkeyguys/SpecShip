/**
 * hooks/useSSE.ts — SSE 连接管理
 *
 * 连接 /api/stream，把收到的事件写入 Zustand store。
 * 组件 mount 时连接，unmount 时断开。
 */

import { useEffect } from "react";
import { useGraphStore, applySSEEvent } from "../store/graph";
import type { SSEEvent } from "../../../server/types";

export function useSSE(): void {
  const store = useGraphStore();

  useEffect(() => {
    const es = new EventSource("/api/stream");

    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as SSEEvent;
        applySSEEvent(event, store);
      } catch {
        // 忽略格式错误的消息
      }
    };

    es.onerror = () => {
      store.appendLog("[SSE] Connection error, retrying...");
    };

    return () => es.close();
  // store 引用稳定，不需要加入依赖
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
