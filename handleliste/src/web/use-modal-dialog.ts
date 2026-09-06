import { useEffect, useRef, type SyntheticEvent } from "react";
export function useModalDialog(open: boolean, onClose: () => void) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      const activeElement = document.activeElement;
      returnFocusRef.current = activeElement instanceof HTMLElement ? activeElement : null;
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  function cancelDialog(event: SyntheticEvent<HTMLDialogElement>) {
    event.preventDefault();
    onClose();
  }

  function synchronizeClosedDialog() {
    if (open) onClose();
    returnFocusRef.current?.focus();
    returnFocusRef.current = null;
  }

  return { cancelDialog, dialogRef, synchronizeClosedDialog };
}

