"use client";

export type IconName =
  | "back-chevron"
  | "chevron-left"
  | "chevron-right"
  | "close-x"
  | "lock"
  | "play"
  | "pause"
  | "settings";

export default function Icon({ name, size = 24 }: { name: IconName; size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        flex: "0 0 auto",
        width: size,
        height: size,
        backgroundColor: "currentColor",
        mask: `url(/cd-icons/${name}.svg) center / contain no-repeat`,
        WebkitMask: `url(/cd-icons/${name}.svg) center / contain no-repeat`,
      }}
    />
  );
}
