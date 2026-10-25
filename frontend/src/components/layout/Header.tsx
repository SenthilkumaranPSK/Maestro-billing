import { useEffect, useState } from 'react';
import { Clock, Calculator } from 'lucide-react';
import { Link } from 'react-router-dom';
import { WhatsAppIcon } from '@/components/whatsapp/WhatsAppIcon';
import { getWhatsAppStatus, isWhatsAppEmbedAvailable, type WhatsAppLiveStatus } from '@/lib/whatsappWeb';
import { DayClosingModal } from '@/components/reports/DayClosingModal';

interface HeaderProps {
  title: string;
}

export function Header({ title }: HeaderProps) {
  const [now, setNow] = useState(new Date());
  const [waStatus, setWaStatus] = useState<WhatsAppLiveStatus>('loading');
  const [showClosingModal, setShowClosingModal] = useState(false);
  const embedAvailable = isWhatsAppEmbedAvailable();

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!embedAvailable) return;
    let mounted = true;

    const checkStatus = async () => {
      const s = await getWhatsAppStatus();
      if (mounted) setWaStatus(s);
    };

    void checkStatus();
    const interval = setInterval(checkStatus, 5000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [embedAvailable]);

  const date = now.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
  const time = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

  const getWaBadge = () => {
    if (!embedAvailable) return null;
    switch (waStatus) {
      case 'connected':
        return (
          <Link
            to="/whatsapp"
            className="flex items-center gap-1.5 rounded-full bg-emerald-50 hover:bg-emerald-100 text-emerald-700 px-3 py-1.5 text-xs font-medium border border-emerald-200 transition-colors shadow-sm"
            title="WhatsApp is connected and ready to send bills"
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <WhatsAppIcon className="w-3.5 h-3.5 text-emerald-600" />
            <span>Ready</span>
          </Link>
        );
      case 'qr_ready':
        return (
          <Link
            to="/whatsapp"
            className="flex items-center gap-1.5 rounded-full bg-amber-50 hover:bg-amber-100 text-amber-800 px-3 py-1.5 text-xs font-medium border border-amber-200 transition-colors shadow-sm animate-pulse"
            title="Scan QR code in WhatsApp tab to connect"
          >
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            <WhatsAppIcon className="w-3.5 h-3.5 text-amber-600" />
            <span>Scan QR</span>
          </Link>
        );
      case 'connecting':
      case 'loading':
        return (
          <Link
            to="/whatsapp"
            className="flex items-center gap-1.5 rounded-full bg-slate-50 hover:bg-slate-100 text-slate-600 px-3 py-1.5 text-xs font-medium border border-slate-200 transition-colors"
            title="Checking WhatsApp connection..."
          >
            <span className="h-2 w-2 rounded-full bg-slate-400 animate-pulse" />
            <WhatsAppIcon className="w-3.5 h-3.5 text-slate-500" />
            <span>Connecting…</span>
          </Link>
        );
      default:
        return (
          <Link
            to="/whatsapp"
            className="flex items-center gap-1.5 rounded-full bg-rose-50 hover:bg-rose-100 text-rose-700 px-3 py-1.5 text-xs font-medium border border-rose-200 transition-colors"
            title="WhatsApp disconnected. Click to reconnect"
          >
            <span className="h-2 w-2 rounded-full bg-rose-500" />
            <WhatsAppIcon className="w-3.5 h-3.5 text-rose-600" />
            <span>Offline</span>
          </Link>
        );
    }
  };

  return (
    <>
      <header className="h-16 border-b border-slate-100 bg-white/80 backdrop-blur-sm flex items-center justify-between px-7 shrink-0">
        {/* key={title} replays the entrance whenever the page changes */}
        <h1
          key={title}
          className="text-lg font-semibold text-slate-800 tracking-tight animate-in fade-in slide-in-from-left-2 duration-300"
        >
          {title}
        </h1>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setShowClosingModal(true)}
            className="flex items-center gap-1.5 rounded-full bg-slate-100 hover:bg-brand-50 hover:text-brand-700 text-slate-700 px-3 py-1.5 text-xs font-medium border border-slate-200 hover:border-brand-300 transition-all cursor-pointer shadow-sm"
            title="End-of-day Cash & Revenue Closing summary"
          >
            <Calculator className="w-3.5 h-3.5 text-brand-600" />
            <span>Day Closing</span>
          </button>
          {getWaBadge()}
          <div className="flex items-center gap-2 rounded-full bg-slate-50 px-3.5 py-1.5 text-sm text-slate-500">
            <Clock className="w-3.5 h-3.5 text-slate-400" />
            <span>{date}</span>
            <span className="h-3 w-px bg-slate-200" />
            <span className="font-semibold text-slate-700 tabular-nums">{time}</span>
          </div>
        </div>
      </header>

      {showClosingModal && (
        <DayClosingModal
          open={showClosingModal}
          onOpenChange={setShowClosingModal}
        />
      )}
    </>
  );
}

