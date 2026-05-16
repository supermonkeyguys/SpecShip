import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PlanEditorCard } from "./PlanEditorCard";

const goPlanMarkdown = `# Plan

## Build a landing page

### Spec

Build a landing page for a SaaS product with pricing and FAQ sections.

### Steps

1. **Confirm scope** (plan-1 / checkpoint)
   - Role: checkpoint
   - Depends on: none
   - Task: Review scope with the user
   - Acceptance: Approved by user

2. **Implement landing page** (impl-1 / implement)
   - Role: implementer
   - Depends on: plan-1
   - Task: Build the requested landing page
   - Acceptance: Page is implemented and previewable
   - Outputs: output/index.html
`;

describe("PlanEditorCard", () => {
  it("renders title, spec, and steps from current Go plan markdown", () => {
    render(
      <PlanEditorCard
        plan={goPlanMarkdown.replaceAll("\u007f", "`")}
        onConfirm={vi.fn()}
        onDiscard={vi.fn()}
      />
    );

    expect(screen.getByText("Build a landing page")).toBeTruthy();
    expect(screen.getByText(/Build a landing page for a SaaS product/i)).toBeTruthy();
    expect(screen.getByText(/执行步骤 \(2\)/)).toBeTruthy();
    expect(screen.getByText("Confirm scope")).toBeTruthy();
    expect(screen.getByText("Implement landing page")).toBeTruthy();
  });
});
