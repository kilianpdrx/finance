"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { cleanPinInput } from "@/lib/profile-lock";
import { cn } from "@/lib/utils";

/**
 * A PIN field: digits only, masked. A text field with masking rather than a
 * password field, so the browser does not offer to save the PIN as a password;
 * the numeric keypad comes up on a phone.
 */
export const PinInput = React.forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value" | "type"> & {
    value: string;
    onValueChange: (v: string) => void;
  }
>(({ value, onValueChange, className, ...props }, ref) => (
  <Input
    ref={ref}
    type="text"
    inputMode="numeric"
    autoComplete="off"
    autoCorrect="off"
    spellCheck={false}
    maxLength={8}
    value={value}
    onChange={(e) => onValueChange(cleanPinInput(e.target.value))}
    className={cn("nums tracking-[0.4em] [-webkit-text-security:disc] placeholder:tracking-normal", className)}
    {...props}
  />
));
PinInput.displayName = "PinInput";
