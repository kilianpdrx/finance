import Link from "next/link";
import { Compass, ArrowLeft } from "lucide-react";

/** 404. Without this Next renders its own unstyled English page, which looks
 *  broken next to the rest of the app. */
export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <Compass className="size-6" />
      </div>
      <h1 className="text-lg font-semibold">Page introuvable</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        Cette adresse ne correspond à aucune page de l&apos;application.
      </p>
      <Link
        href="/"
        className="mt-2 inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
      >
        <ArrowLeft className="size-4" /> Retour au tableau de bord
      </Link>
    </div>
  );
}
