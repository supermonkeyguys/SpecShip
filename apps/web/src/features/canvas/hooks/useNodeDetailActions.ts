import { useCallback, useState } from "react";
import { editNode, retryNode, verifyNode } from "../../../shared/api/nodeClient";
import type { NodeEditImpact, NodeStatus } from "../../../types";
import type { CanvasSessionRef } from "../canvas.types";

export function useNodeDetailActions(node: NodeStatus, session: CanvasSessionRef | null) {
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(node.title);
  const [applying, setApplying] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [impact, setImpact] = useState<NodeEditImpact | null>(null);

  const handleRetry = useCallback(async () => {
    if (!session) return;
    setRetrying(true);
    setRetryError(null);

    try {
      const result = await retryNode(node.id, session);
      if (!result.ok) {
        setRetryError(result.error ?? "Retry failed");
      }
    } catch (error) {
      setRetryError((error as Error).message);
    } finally {
      setRetrying(false);
    }
  }, [node.id, session]);

  const handleVerify = useCallback(async () => {
    if (!session) return;
    setVerifying(true);
    setVerifyError(null);
    try {
      const result = await verifyNode(node.id, session);
      if (!result.ok) setVerifyError(result.error ?? "Verify failed");
    } catch (error) {
      setVerifyError((error as Error).message);
    } finally {
      setVerifying(false);
    }
  }, [node.id, session]);

  const handleEditApply = useCallback(async () => {
    if (!session || !editTitle.trim()) return;
    setApplying(true);
    setEditError(null);
    setImpact(null);

    try {
      const result = await editNode(node.id, {
        projectId: session.projectId,
        sessionId: session.sessionId,
        updates: { title: editTitle.trim() },
      });

      if (result.ok && result.impact) {
        setImpact(result.impact);
        setEditing(false);
      } else {
        setEditError(result.error ?? "Edit failed");
      }
    } catch (error) {
      setEditError((error as Error).message);
    } finally {
      setApplying(false);
    }
  }, [editTitle, node.id, session]);

  const startEditing = useCallback(() => {
    setEditing(true);
    setEditTitle(node.title);
    setEditError(null);
  }, [node.title]);

  const cancelEditing = useCallback(() => {
    setEditing(false);
  }, []);

  const clearImpact = useCallback(() => {
    setImpact(null);
  }, []);

  return {
    retrying,
    retryError,
    verifying,
    verifyError,
    handleVerify,
    editing,
    editTitle,
    applying,
    editError,
    impact,
    setEditTitle,
    handleRetry,
    handleEditApply,
    startEditing,
    cancelEditing,
    clearImpact,
  };
}
