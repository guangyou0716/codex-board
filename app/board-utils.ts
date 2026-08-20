import type { Task, TaskStatus } from "./state";

export function reorderTasks(tasks: Task[], movingId: string, status: TaskStatus, beforeId?: string) {
  const moving = tasks.find((task) => task.id === movingId);
  if (!moving) return tasks;

  const targetStatus = beforeId ? tasks.find((task) => task.id === beforeId)?.status ?? status : status;
  const now = new Date().toISOString();
  const nextTasks = tasks.map((task) => task.id === movingId ? { ...task, status: targetStatus, updatedAt: now } : task);
  const group = nextTasks
    .filter((task) => task.status === targetStatus && task.id !== movingId)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const insertAt = beforeId ? group.findIndex((task) => task.id === beforeId) : group.length;
  group.splice(insertAt < 0 ? group.length : insertAt, 0, nextTasks.find((task) => task.id === movingId)!);
  const orderMap = new Map(group.map((task, index) => [task.id, index]));

  return nextTasks.map((task) => orderMap.has(task.id) ? { ...task, sortOrder: orderMap.get(task.id)! } : task);
}

export type LatestSnapshotQueue<T> = {
  enqueue: (snapshot: T) => void;
};

export function createLatestSnapshotQueue<T>(send: (snapshot: T) => Promise<void>, onError: (error: unknown) => void, onIdleSuccess: () => void = () => {}): LatestSnapshotQueue<T> {
  let inFlight = false;
  let pending: T | undefined;

  const flush = async () => {
    if (inFlight) return;
    inFlight = true;
    let lastSendSucceeded = false;
    while (pending !== undefined) {
      const snapshot = pending;
      pending = undefined;
      try {
        await send(snapshot);
        lastSendSucceeded = true;
      } catch (error) {
        lastSendSucceeded = false;
        onError(error);
        // A failed snapshot is not retried. If a newer snapshot arrived while
        // it was in flight, process that snapshot once before stopping.
      }
    }
    inFlight = false;
    if (pending === undefined && lastSendSucceeded) onIdleSuccess();
    if (pending !== undefined) void flush();
  };

  return { enqueue: (snapshot) => { pending = snapshot; void flush(); } };
}
