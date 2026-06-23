import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { idleStatus, COUNTDOWN_MS } from "@/lib/idleTimeout";

const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "wheel"];

export default function IdleTimeout() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [warning, setWarning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(COUNTDOWN_MS / 1000);

  const lastActivity = useRef(Date.now());
  const warningRef = useRef(false);

  const endSession = useCallback(async () => {
    warningRef.current = false;
    lastActivity.current = Date.now();
    setWarning(false);
    await signOut();
    navigate("/auth", { replace: true });
  }, [signOut, navigate]);

  const stayActive = useCallback(() => {
    warningRef.current = false;
    lastActivity.current = Date.now();
    setWarning(false);
  }, []);

  useEffect(() => {
    if (!user) return;

    const onActivity = () => {
      if (!warningRef.current) lastActivity.current = Date.now();
    };
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));

    const tick = setInterval(() => {
      const status = idleStatus(Date.now(), lastActivity.current);
      if (status.phase === "expired") {
        endSession();
      } else if (status.phase === "warning") {
        warningRef.current = true;
        setSecondsLeft(status.secondsLeft);
        setWarning(true);
      }
    }, 250);

    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity));
      clearInterval(tick);
    };
  }, [user, endSession]);

  if (!warning) return null;

  return (
    <AlertDialog open={warning}>
      <AlertDialogContent className="max-w-sm">
        <AlertDialogHeader>
          <AlertDialogTitle>Are you still there?</AlertDialogTitle>
          <AlertDialogDescription>
            You've been inactive for a while. For your security, you'll be signed out automatically.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="py-2 text-center">
          <div className="text-5xl font-bold tabular-nums text-brand">{secondsLeft}</div>
          <div className="mt-1 text-sm text-muted-foreground">
            second{secondsLeft === 1 ? "" : "s"} until sign out
          </div>
        </div>
        <AlertDialogFooter>
          <Button variant="outline" onClick={endSession}>
            Sign out now
          </Button>
          <Button onClick={stayActive}>Stay signed in</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
