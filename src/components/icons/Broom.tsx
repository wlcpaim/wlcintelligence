import type { SVGProps } from "react";

/** Ícone de vassoura (limpar chat). */
export function Broom(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      <path d="M19.4 2.6 13 9" />
      <path d="M10.5 8.5 15.5 13.5" />
      <path d="M10.5 8.5c-2 0-4 1-5 3l-3 7.5 2.5 2.5L12.5 18.5c2-1 3-3 3-5" />
      <path d="M6 15.5 8.5 18" />
      <path d="M9 12.5l2.5 2.5" />
    </svg>
  );
}
