"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";

interface MascotProps {
  className?: string;
  glow?: boolean;
}

export function Mascot({ className, glow = false }: MascotProps) {
  const id = useId();
  return (
    <svg viewBox="0 0 24 24" className={cn("mascot-hover", className)} overflow="visible" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id={`grad-${id}`} cx="35%" cy="28%" r="80%">
          <stop offset="0" stopColor="#A78BFA" />
          <stop offset="1" stopColor="#7C3AED" />
        </radialGradient>
        <radialGradient id={`pink-${id}`} cx="35%" cy="28%" r="80%">
          <stop offset="0" stopColor="#FF9FCB" />
          <stop offset="1" stopColor="#EC4899" />
        </radialGradient>
        <clipPath id={`energize-clip-${id}`}>
          <rect className="mascot-energize-clip" x="0" y="6" width="24" height="16.6" />
        </clipPath>
        {glow && (
          <filter id={`glow-${id}`} x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="2.2" />
          </filter>
        )}
      </defs>
      {glow && <circle cx="12" cy="13" r="8" fill="#7C3AED" opacity="0.35" filter={`url(#glow-${id})`} />}
      <path className="mascot-antenna-left mascot-antenna-color" d="M10.3 6.8 Q8.3 3.5 6.7 2.6" strokeWidth="0.9" strokeLinecap="round" fill="none" />
      <path className="mascot-antenna-right mascot-antenna-color" d="M13.7 6.8 Q15.7 3.5 17.3 2.6" strokeWidth="0.9" strokeLinecap="round" fill="none" />

      <ellipse className="mascot-arm-left" cx="4.3" cy="13.5" rx="1.7" ry="2.3" fill={`url(#grad-${id})`} />
      <ellipse className="mascot-arm-right" cx="19.7" cy="13.5" rx="1.7" ry="2.3" fill={`url(#grad-${id})`} />

      <rect x="7.4" y="20.2" width="3.2" height="2.2" rx="1.1" fill={`url(#grad-${id})`} />
      <rect x="13.4" y="20.2" width="3.2" height="2.2" rx="1.1" fill={`url(#grad-${id})`} />

      <rect x="5" y="6.2" width="14" height="15.2" rx="7" fill={`url(#grad-${id})`} />
      <g clipPath={`url(#energize-clip-${id})`}>
        <ellipse className="mascot-arm-left" cx="4.3" cy="13.5" rx="1.7" ry="2.3" fill={`url(#pink-${id})`} />
        <ellipse className="mascot-arm-right" cx="19.7" cy="13.5" rx="1.7" ry="2.3" fill={`url(#pink-${id})`} />
        <rect x="7.4" y="20.2" width="3.2" height="2.2" rx="1.1" fill={`url(#pink-${id})`} />
        <rect x="13.4" y="20.2" width="3.2" height="2.2" rx="1.1" fill={`url(#pink-${id})`} />
        <rect x="5" y="6.2" width="14" height="15.2" rx="7" fill={`url(#pink-${id})`} />
      </g>
      <ellipse cx="9" cy="9.3" rx="2.6" ry="1.8" fill="white" opacity="0.3" />
      <circle cx="9.3" cy="13.5" r="1.7" fill="#2E1065" />
      <circle cx="14.7" cy="13.5" r="1.7" fill="#2E1065" />
      <circle cx="9.75" cy="12.95" r="0.5" fill="white" />
      <circle cx="15.15" cy="12.95" r="0.5" fill="white" />
    </svg>
  );
}