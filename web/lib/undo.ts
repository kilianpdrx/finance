import { toast } from "sonner";
import type { QueryClient } from "@tanstack/react-query";

interface DeleteWithUndoOptions {
  queryClient: QueryClient;
  /** Query keys to snapshot (for undo) and invalidate after the real delete. */
  queryKeys: readonly unknown[][];
  /** Remove the item from the cache immediately, e.g. via queryClient.setQueryData. */
  optimisticRemove: () => void;
  /** The real deletion; only runs if the user does not undo within the window. */
  apiDelete: () => Promise<unknown>;
  /** Toast message, e.g. "Objectif supprimé". */
  message: string;
  /** Undo window in ms (default 5000). */
  delayMs?: number;
}

/** Gmail-style delete: the item disappears immediately, a toast offers "Annuler",
 *  and the real API delete only fires once the undo window elapses. Undo restores
 *  the exact cache snapshot — no backend soft-delete required.
 *
 *  Note: if the tab is closed within the window the API delete never runs, so the
 *  item simply reappears on next load. That's safe (no data loss), just a no-op. */
export function deleteWithUndo({
  queryClient,
  queryKeys,
  optimisticRemove,
  apiDelete,
  message,
  delayMs = 5000,
}: DeleteWithUndoOptions): void {
  // Snapshot the current cache so Annuler can restore it exactly.
  const snapshots = queryKeys.map((key) => [key, queryClient.getQueryData(key)] as const);
  const restore = () => snapshots.forEach(([key, data]) => queryClient.setQueryData(key, data));

  optimisticRemove();

  let undone = false;
  const timer = setTimeout(async () => {
    if (undone) return;
    try {
      await apiDelete();
      queryKeys.forEach((key) => queryClient.invalidateQueries({ queryKey: key }));
    } catch (e) {
      restore();
      toast.error(e instanceof Error ? e.message : "Suppression échouée");
    }
  }, delayMs);

  toast(message, {
    duration: delayMs,
    action: {
      label: "Annuler",
      onClick: () => {
        undone = true;
        clearTimeout(timer);
        restore();
      },
    },
  });
}
