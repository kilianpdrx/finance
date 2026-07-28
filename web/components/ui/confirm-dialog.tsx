"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./dialog";
import { Button } from "./button";

export interface ConfirmOptions {
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Style the confirm button as destructive (red). */
  destructive?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = React.createContext<ConfirmFn | null>(null);

/** Mount once (in Providers). Exposes a promise-based confirm() via useConfirm(),
 *  replacing the native window.confirm() with a styled, theme-aware dialog. */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<ConfirmOptions | null>(null);
  const resolver = React.useRef<((v: boolean) => void) | null>(null);

  const confirm = React.useCallback<ConfirmFn>((opts) => {
    setState(opts);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const settle = React.useCallback((result: boolean) => {
    resolver.current?.(result);
    resolver.current = null;
    setState(null);
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog open={state !== null} onOpenChange={(open) => { if (!open) settle(false); }}>
        {state && (
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{state.title}</DialogTitle>
              {state.description && <DialogDescription>{state.description}</DialogDescription>}
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => settle(false)}>
                {state.cancelLabel ?? "Annuler"}
              </Button>
              <Button
                variant={state.destructive ? "destructive" : "default"}
                onClick={() => settle(true)}
                autoFocus
              >
                {state.confirmLabel ?? "Confirmer"}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = React.useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within a ConfirmProvider");
  return ctx;
}
