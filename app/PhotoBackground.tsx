"use client";

export default function PhotoBackground() {
  return (
    <div className="photo-bg" aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/bg-characters.png"
        alt=""
        className="photo-bg-img"
        onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
      />
    </div>
  );
}
