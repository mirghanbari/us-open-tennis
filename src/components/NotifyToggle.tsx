import { useState } from "react";
import {
  notificationPermission,
  notificationsSupported,
  setNotificationsEnabled,
  useNotificationsEnabled,
} from "../notify";

/** Opt-in switch for "tell me when a starred player goes on court". */
export function NotifyToggle() {
  const enabled = useNotificationsEnabled();
  const [busy, setBusy] = useState(false);
  const permission = notificationPermission();

  if (!notificationsSupported()) {
    return (
      <span className="tiny faint">This browser doesn't support notifications.</span>
    );
  }

  if (permission === "denied") {
    return (
      <span className="tiny faint">
        Notifications are blocked for this site in your browser settings.
      </span>
    );
  }

  return (
    <div className="row">
      <button
        className={"chip" + (enabled ? " is-on" : "")}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await setNotificationsEnabled(!enabled);
          setBusy(false);
        }}
      >
        {enabled ? "🔔 Notifications on" : "🔕 Notify me when they play"}
      </button>
      {enabled && (
        <span className="tiny faint">Only while this tab is open — there's no push service.</span>
      )}
    </div>
  );
}
