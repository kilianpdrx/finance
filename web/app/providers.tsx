"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: 1,
            // The backend runs on this machine, so "offline" is meaningless here.
            // With the default networkMode "online", TanStack PAUSES fetches when
            // it believes there's no connection: queries sit in fetchStatus
            // "paused" forever and never surface an error — the UI then renders
            // empty states instead of telling the user anything. Always attempt
            // the request and let real failures become errors.
            networkMode: "always",
          },
          mutations: { networkMode: "always" },
        },
      }),
  );

  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={client}>
        <ConfirmProvider>{children}</ConfirmProvider>
        <Toaster
          position="bottom-right"
          toastOptions={{ className: "!bg-surface !text-foreground !border-border" }}
          theme="system"
          richColors
        />
        {/* Dev-only: the floating devtools button is confusing in a shipped app. */}
        {process.env.NODE_ENV !== "production" && (
          <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" />
        )}
      </QueryClientProvider>
    </ThemeProvider>
  );
}
