import { createFileRoute, redirect } from "@tanstack/react-router";

/** Chat legado desativado — redireciona para Code Studio. */
export const Route = createFileRoute("/_authenticated/chat/")({
  beforeLoad: () => {
    throw redirect({ to: "/code", replace: true });
  },
});
