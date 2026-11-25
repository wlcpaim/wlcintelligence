import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Módulo de Chat legado desativado.
 * Redirecionamento permanente para o Code Studio exclusivo (/code).
 */
export const Route = createFileRoute("/_authenticated/chat")({
  beforeLoad: () => {
    throw redirect({ to: "/code", replace: true });
  },
});
