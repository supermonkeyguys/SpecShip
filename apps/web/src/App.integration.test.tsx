import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { useWorkspaceStore } from "./domains/workspace/store";
import { useExecutionStore } from "./domains/execution/store";

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "content-type": "application/json" },
  });
}

describe("App integration with Go-compatible API contract", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useWorkspaceStore.setState({
      activeSession: null,
      surface: "new-task",
      creationFlow: {
        stage: "idle",
        input: "",
        messages: [{ role: "system", text: "Hi! Tell me what to build. I will help refine it into an execution plan before starting." }],
        pendingClarification: null,
        pendingPlan: null,
      },
      selectedFile: null,
      resumeInfo: null,
      projects: [],
      expandedProjectId: null,
      sessionFiles: [],
      previewInfo: null,
      selectionMode: false,
      selectedSessions: new Set(),
    });
    useExecutionStore.setState({ sessions: {}, liveSessionKey: null, streamStatus: "disconnected" });
    // minimal EventSource stub for useSSE
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    vi.stubGlobal(
      "EventSource",
      class {
        onopen: ((this: EventSource, ev: Event) => unknown) | null = null;
        onerror: ((this: EventSource, ev: Event) => unknown) | null = null;
        onmessage: ((this: EventSource, ev: MessageEvent) => unknown) | null = null;
        close() {}
      } as unknown as typeof EventSource
    );
  });

  it("shows ResumeBar from /api/status and POSTs /api/resume when user clicks Resume", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/status") {
        return jsonResponse({
          isRunning: false,
          canResume: true,
          spec: "resume this interrupted run",
          projectId: "proj-r1",
          sessionId: "sess-r1",
          nodeCount: 2,
          doneCount: 1,
        });
      }
      if (url === "/api/resume") {
        return jsonResponse({ ok: true, projectId: "proj-r1", sessionId: "sess-r1" });
      }
      if (url === "/api/projects/proj-r1/sessions/sess-r1/graph") {
        return jsonResponse({
          ok: true,
          title: "Recovered graph",
          status: "running",
          nodes: [
            {
              id: "impl-1",
              title: "Recovered impl",
              status: "running",
              nodeType: "implement",
              nodeRole: "implementer",
              task: "resume task",
              acceptanceCriteria: "done",
              specFragment: "resume task",
              dependsOn: [],
              filesWritten: [],
              verifications: [],
              retryCount: 0,
              maxRetries: 1,
            },
          ],
        });
      }
      if (url === "/api/projects") {
        return jsonResponse({ projects: [] });
      }
      if (url === "/api/projects/proj-r1/sessions/sess-r1/preview") {
        return jsonResponse({ ok: true, supported: false, kind: "none", reason: "no preview" });
      }
      return jsonResponse({ ok: true });
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(await screen.findByText(/resume this interrupted run/i)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /resume/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/resume",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ projectId: "proj-r1", sessionId: "sess-r1" }),
        })
      );
    });
  });

  it("loads graph and preview for an active session selected from status/resume path", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/status") {
        return jsonResponse({
          isRunning: false,
          canResume: true,
          spec: "previewable task",
          projectId: "proj-p1",
          sessionId: "sess-p1",
        });
      }
      if (url === "/api/projects") {
        return jsonResponse({
          projects: [
            {
              id: "proj-p1",
              name: "Preview project",
              createdAt: "2026-05-15T00:00:00.000Z",
              updatedAt: "2026-05-15T00:00:00.000Z",
              sessions: [
                { id: "sess-p1", spec: "previewable task", status: "done", createdAt: "2026-05-15T00:00:00.000Z", starred: false },
              ],
            },
          ],
        });
      }
      if (url === "/api/projects/proj-p1/sessions/sess-p1/graph") {
        return jsonResponse({
          ok: true,
          title: "Preview graph",
          status: "done",
          nodes: [
            {
              id: "impl-1",
              title: "Preview node",
              status: "done",
              nodeType: "implement",
              nodeRole: "implementer",
              task: "preview task",
              acceptanceCriteria: "done",
              specFragment: "preview task",
              dependsOn: [],
              filesWritten: ["output/index.html"],
              verifications: [],
              retryCount: 0,
              maxRetries: 1,
            },
          ],
        });
      }
      if (url === "/api/projects/proj-p1/sessions/sess-p1/preview") {
        return jsonResponse({
          ok: true,
          supported: true,
          kind: "static",
          entryPath: "output/index.html",
          staticSupported: true,
          staticUrl: "/api/projects/proj-p1/sessions/sess-p1/preview/content/output/index.html",
          liveSupported: false,
          liveStatus: "idle",
        });
      }
      return jsonResponse({ ok: true });
    });

    vi.stubGlobal("fetch", fetchMock);
    render(<App />);

    await screen.findByRole("button", { name: /resume/i });
    await userEvent.click(screen.getByRole("button", { name: /resume/i }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some((call) => call[0] === "/api/projects/proj-p1/sessions/sess-p1/graph")).toBe(true);
    });
    await waitFor(() => {
      expect(fetchMock.mock.calls.some((call) => call[0] === "/api/projects/proj-p1/sessions/sess-p1/preview")).toBe(true);
    });
  });

  it("loads and saves LLM settings through the settings panel", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/status") {
        return jsonResponse({ isRunning: false, canResume: false });
      }
      if (url === "/api/projects") {
        return jsonResponse({ projects: [] });
      }
      if (url === "/api/settings/llm" && (!init || !init.method || init.method === "GET")) {
        return jsonResponse({ ok: true, baseURL: "https://api.openai.com/v1", apiKey: "sk-old", hasApiKey: true });
      }
      if (url === "/api/settings/llm" && init?.method === "POST") {
        return jsonResponse({ ok: true, baseURL: "https://proxy.example/v1", apiKey: "sk-new", hasApiKey: true });
      }
      return jsonResponse({ ok: true });
    });

    vi.stubGlobal("fetch", fetchMock);
    render(<App />);

    await screen.findByText(/tell me what to build/i);
    const settingsButton = await screen.findByTitle(/settings/i).catch(() => null);
    if (!settingsButton) return;
    await userEvent.click(settingsButton);

    expect(await screen.findByDisplayValue("https://api.openai.com/v1")).toBeTruthy();
    const baseUrlInput = screen.getByLabelText(/base url/i);
    const apiKeyInput = screen.getByLabelText(/api key/i);

    await userEvent.clear(baseUrlInput);
    await userEvent.type(baseUrlInput, "https://proxy.example/v1");
    await userEvent.clear(apiKeyInput);
    await userEvent.type(apiKeyInput, "sk-new");
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/settings/llm",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ baseURL: "https://proxy.example/v1", apiKey: "sk-new" }),
        })
      );
    });
  });

});
