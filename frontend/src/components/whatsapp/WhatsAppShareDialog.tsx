import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Copy, ExternalLink, Loader2, Send, AlertCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { WhatsAppIcon } from './WhatsAppIcon';
import { buildWhatsAppBillText } from '@/lib/whatsappBillText';
import {
  sendBillTextOnWhatsApp,
  isWhatsAppTextSendAvailable,
  isWhatsAppEmbedAvailable,
  openWhatsAppChatInNewTab,
  requestWhatsAppChat,
} from '@/lib/whatsappWeb';
import { isValidIndianPhone, formatDate } from '@/lib/utils';
import { formatCurrency, type Bill, type Settings } from '@/types';

interface WhatsAppShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bill: Bill | null;
  settings?: Partial<Settings>;
  isMm?: boolean;
}

export function WhatsAppShareDialog({
  open,
  onOpenChange,
  bill,
  settings = {},
  isMm = false,
}: WhatsAppShareDialogProps) {
  const { toast } = useToast();
  const navigate = useNavigate();

  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendSuccess, setSendSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const canAutomate = isWhatsAppTextSendAvailable();
  const canEmbed = isWhatsAppEmbedAvailable();

  useEffect(() => {
    if (bill && open) {
      const initialPhone = bill.customer?.phone ?? bill.mmCustomer?.phone ?? '';
      setPhone(initialPhone);
      setMessage(buildWhatsAppBillText(bill, settings, isMm ? { heading: 'MM' } : {}));
      setCopied(false);
      setSending(false);
      setSendSuccess(false);
      setErrorMessage(null);
    }
  }, [bill, open, settings, isMm]);

  if (!bill) return null;

  const customerName = bill.customer?.name ?? bill.mmCustomer?.name ?? 'Customer';
  const isPhoneValid = isValidIndianPhone(phone.trim());

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({
        title: 'Copied to clipboard',
        description: 'WhatsApp bill text copied.',
        variant: 'success',
      });
    } catch {
      toast({
        title: 'Failed to copy',
        description: 'Please copy the message manually.',
        variant: 'destructive',
      });
    }
  };

  const handleSendAutomated = async () => {
    if (!isPhoneValid) {
      setErrorMessage('Please enter a valid 10-digit mobile number.');
      return;
    }

    setSending(true);
    setErrorMessage(null);
    setSendSuccess(false);

    try {
      await sendBillTextOnWhatsApp({
        phone: phone.trim(),
        text: message,
        billNumber: bill.billNumber,
      });
      setSendSuccess(true);
      toast({
        title: 'Sent on WhatsApp!',
        description: `Bill ${bill.billNumber} delivered to ${phone.trim()}.`,
        variant: 'success',
      });
      setTimeout(() => {
        onOpenChange(false);
      }, 1000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not send WhatsApp message';
      setErrorMessage(msg);
      toast({
        title: 'WhatsApp sending failed',
        description: msg,
        variant: 'destructive',
      });
    } finally {
      setSending(false);
    }
  };

  const handleOpenInApp = () => {
    if (!isPhoneValid) {
      setErrorMessage('Please enter a valid 10-digit mobile number.');
      return;
    }
    requestWhatsAppChat({ phone: phone.trim(), caption: message });
    onOpenChange(false);
    navigate('/whatsapp');
  };

  const handleOpenBrowser = () => {
    if (!isPhoneValid) {
      setErrorMessage('Please enter a valid 10-digit mobile number.');
      return;
    }
    openWhatsAppChatInNewTab(phone.trim(), message);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[540px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
              <WhatsAppIcon className="h-4 w-4" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold text-slate-800">
                Share Bill on WhatsApp
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500">
                Send bill directly to customer's WhatsApp chat
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Bill Summary Strip */}
        <div className="flex items-center justify-between rounded-lg bg-slate-50 p-3 border border-slate-200/80 text-xs">
          <div>
            <span className="font-semibold text-slate-700">{bill.billNumber}</span>
            <span className="text-slate-400 mx-1.5">·</span>
            <span className="text-slate-600">{customerName}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-500">{formatDate(bill.billDate)}</span>
            <Badge variant="outline" className="font-semibold text-emerald-700 bg-emerald-50 border-emerald-200">
              {formatCurrency(bill.grandTotal)}
            </Badge>
          </div>
        </div>

        <div className="space-y-3.5 py-1">
          {/* Phone Input */}
          <div className="space-y-1.5">
            <Label htmlFor="wa-phone" className="text-xs font-medium text-slate-700">
              Customer WhatsApp Number
            </Label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-xs text-slate-400 font-medium select-none">
                +91
              </span>
              <Input
                id="wa-phone"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  setErrorMessage(null);
                  setSendSuccess(false);
                }}
                placeholder="9876543210"
                className="pl-10 text-sm font-mono"
                disabled={sending}
              />
            </div>
            {phone && !isPhoneValid && (
              <p className="text-[11px] text-amber-600">
                Enter a 10-digit Indian mobile number
              </p>
            )}
          </div>

          {/* Message Content */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="wa-msg" className="text-xs font-medium text-slate-700">
                Message Preview
              </Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 text-xs px-2 text-slate-500 hover:text-slate-800"
                onClick={handleCopy}
              >
                {copied ? (
                  <>
                    <Check className="h-3 w-3 mr-1 text-emerald-600" />
                    <span className="text-emerald-600">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3 mr-1" />
                    Copy
                  </>
                )}
              </Button>
            </div>
            <Textarea
              id="wa-msg"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={7}
              className="text-xs font-mono resize-none bg-slate-50/50"
              disabled={sending}
            />
          </div>

          {/* Status feedback */}
          {sendSuccess && (
            <div className="flex items-center gap-2 rounded-md bg-emerald-50 border border-emerald-200 p-2.5 text-xs text-emerald-800 animate-in fade-in">
              <Check className="h-4 w-4 text-emerald-600 shrink-0" />
              <span>Bill <strong>{bill.billNumber}</strong> sent successfully!</span>
            </div>
          )}

          {errorMessage && (
            <div className="flex items-start gap-2 rounded-md bg-rose-50 border border-rose-200 p-2.5 text-xs text-rose-800 animate-in fade-in">
              <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <span>{errorMessage}</span>
                {canEmbed && (
                  <button
                    type="button"
                    onClick={handleOpenInApp}
                    className="block mt-1 underline font-medium hover:text-rose-950"
                  >
                    Open WhatsApp tab to scan QR / verify chat &rarr;
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <div className="flex items-center gap-2 mr-auto">
            {canEmbed ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleOpenInApp}
                title="Open WhatsApp chat tab inside the app"
                disabled={sending}
              >
                <WhatsAppIcon className="h-3.5 w-3.5 mr-1.5 text-emerald-600" />
                Open Tab
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleOpenBrowser}
                title="Open chat in WhatsApp Web browser"
                disabled={sending}
              >
                <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                Open Web
              </Button>
            )}
          </div>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={sending}
          >
            Close
          </Button>

          {canAutomate && (
            <Button
              type="button"
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700 text-white border-0"
              onClick={handleSendAutomated}
              disabled={sending || !isPhoneValid || sendSuccess}
            >
              {sending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  Sending…
                </>
              ) : sendSuccess ? (
                <>
                  <Check className="h-3.5 w-3.5 mr-1.5" />
                  Sent
                </>
              ) : (
                <>
                  <Send className="h-3.5 w-3.5 mr-1.5" />
                  Send on WhatsApp
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
