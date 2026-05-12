/**
 * Chat.tsx — 右侧面板（白底主题）
 */

import { useState } from "react";
import { ChatPanelContainer } from "./containers/ChatPanelContainer";
import { LogPanelContainer } from "./containers/LogPanelContainer";
import type { ChatProps, ChatTab } from "./types";
import { ChatTabsView } from "./views/ChatTabsView";

export function Chat({ sessionRef, onRunStarted, onResumeRequested }: ChatProps) {
  const [tab, setTab] = useState<ChatTab>("chat");

  if (!sessionRef) return null;

  return (
    <ChatTabsView
      tab={tab}
      onTabChange={setTab}
      chatPanel={
        <ChatPanelContainer
          key={`${sessionRef.projectId}:${sessionRef.sessionId}`}
          sessionRef={sessionRef}
          onRunStarted={onRunStarted}
          onResumeRequested={onResumeRequested}
        />
      }
      logPanel={<LogPanelContainer sessionRef={sessionRef} />}
    />
  );
}
