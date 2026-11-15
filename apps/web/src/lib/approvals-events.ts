/**
 * Fired on `window` when the approvals list changes, so the nav badge (in the
 * app layout) stays in step without polling. With a count, the badge takes it
 * as is; without one, the layout refetches.
 */
export const APPROVALS_CHANGED_EVENT = "librehr:approvals-changed";

export interface ApprovalsChangedDetail {
  count?: number;
}

export function announceApprovalsChanged(count?: number): void {
  window.dispatchEvent(
    new CustomEvent<ApprovalsChangedDetail>(APPROVALS_CHANGED_EVENT, {
      detail: count === undefined ? {} : { count },
    }),
  );
}
