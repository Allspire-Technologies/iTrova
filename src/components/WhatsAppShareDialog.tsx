import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { isValidWaNumber, waLink } from "@/lib/whatsapp";

export default function WhatsAppShareDialog({
  open,
  onOpenChange,
  message,
  defaultPhone = "",
  recipientLabel = "Recipient",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  message: string;
  defaultPhone?: string;
  recipientLabel?: string;
}) {
  const [phone, setPhone] = useState(defaultPhone);
  useEffect(() => { if (open) setPhone(defaultPhone); }, [open, defaultPhone]);

  const send = () => {
    if (!isValidWaNumber(phone)) return toast.error("Enter a valid WhatsApp number with country code");
    window.open(waLink(phone, message), "_blank");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCircle className="size-5 text-brand" /> Send on WhatsApp
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="wa-phone">{recipientLabel}&rsquo;s WhatsApp number</Label>
          <Input
            id="wa-phone"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            placeholder="+234 801 234 5678"
            autoFocus
            onKeyDown={e => { if (e.key === "Enter") send(); }}
          />
          <p className="text-xs text-muted-foreground">Include the country code (e.g. +234 for Nigeria).</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="brand" onClick={send}>Send</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
