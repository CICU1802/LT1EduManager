import { useId, type ReactNode } from 'react';
import { useDialogFocus } from '../hooks/useDialogFocus';
export default function Modal({ children, onClose, label = 'Thông tin chi tiết' }: { children: ReactNode; onClose: () => void; label?: string }) {
  const ref = useDialogFocus(true, onClose), id = useId();
  return <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1} className="dialog-frame">
      <span id={id} className="sr-only">{label}</span>{children}
    </div>
  </div>;
}
