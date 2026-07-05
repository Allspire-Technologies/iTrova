import { AlertTriangle, Info } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  variant?: "destructive" | "default";
  onConfirm: () => void;
}

export default function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description = "This action is permanent and cannot be undone.",
  confirmLabel = "Delete",
  variant = "destructive",
  onConfirm,
}: Props) {
  const isDestructive = variant === "destructive";
  const Icon = isDestructive ? AlertTriangle : Info;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="compact" className="max-w-sm">
        <DialogHeader>
          <div className="flex items-start gap-4">
            <div className={`mt-0.5 size-10 rounded-full grid place-items-center shrink-0 ${isDestructive ? "bg-destructive/10 text-destructive" : "bg-brand-light text-brand"}`}>
              <Icon className="size-5" />
            </div>
            <div className="space-y-1">
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>{description}</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <DialogFooter className="mt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant={isDestructive ? "destructive" : "brand"}
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
