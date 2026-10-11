import { useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle, X } from 'lucide-react';
export default function Toast() {
  const [toast, setToast] = useState<{ message: string; type: string; id: string } | null>(null);
  useEffect(() => { const listener = (e: Event) => setToast((e as CustomEvent).detail); window.addEventListener('edu-toast', listener); return () => window.removeEventListener('edu-toast', listener); }, []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(null), 8000); return () => clearTimeout(timer); }, [toast]);
  return <div className="toast-region" aria-live="polite" aria-atomic="true">{toast && <div className={`toast toast-${toast.type}`}>
    {toast.type === 'success' ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}<p>{toast.message}</p><button className="icon-button" aria-label="Đóng thông báo" onClick={() => setToast(null)}><X size={18} /></button>
  </div>}</div>;
}
