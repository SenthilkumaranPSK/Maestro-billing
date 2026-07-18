import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';

interface HeaderProps {
  title: string;
}

export function Header({ title }: HeaderProps) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const date = now.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
  const time = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

  return (
    <header className="h-16 border-b border-slate-100 bg-white/80 backdrop-blur-sm flex items-center justify-between px-7 shrink-0">
      {/* key={title} replays the entrance whenever the page changes */}
      <h1
        key={title}
        className="text-lg font-semibold text-slate-800 tracking-tight animate-in fade-in slide-in-from-left-2 duration-300"
      >
        {title}
      </h1>
      <div className="flex items-center gap-2 rounded-full bg-slate-50 px-3.5 py-1.5 text-sm text-slate-500">
        <Clock className="w-3.5 h-3.5 text-slate-400" />
        <span>{date}</span>
        <span className="h-3 w-px bg-slate-200" />
        <span className="font-semibold text-slate-700 tabular-nums">{time}</span>
      </div>
    </header>
  );
}
