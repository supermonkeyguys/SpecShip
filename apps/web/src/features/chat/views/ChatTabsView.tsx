import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../components/ui/tabs";
import type { ChatTab } from "../types";

interface Props {
  tab: ChatTab;
  onTabChange: (tab: ChatTab) => void;
  chatPanel: ReactNode;
  logPanel: ReactNode;
}

const TABS: ReadonlyArray<{ key: ChatTab; label: string }> = [
  { key: "chat", label: "Chat" },
  { key: "log", label: "Log" },
];

export function ChatTabsView({ tab, onTabChange, chatPanel, logPanel }: Props) {
  return (
    <Tabs
      value={tab}
      onValueChange={(value) => onTabChange(value as ChatTab)}
      className="h-full bg-white border-l border-gray-200"
    >
      <TabsList aria-label="Chat views" className="w-full border-b border-gray-200">
        {TABS.map((item) => (
          <TabsTrigger key={item.key} value={item.key} className="hover:text-gray-600">
            {item.label}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value="chat" className="mt-0 flex-1 overflow-hidden">
        {chatPanel}
      </TabsContent>
      <TabsContent value="log" className="mt-0 flex-1 overflow-hidden">
        {logPanel}
      </TabsContent>
    </Tabs>
  );
}
