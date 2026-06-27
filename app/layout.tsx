import type { Metadata } from "next";
import { Nunito } from "next/font/google";
import "./globals.css";

const nunito = Nunito({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "600", "700", "800", "900"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Nickyho pohádky",
  description: "AI mluvené pohádky pro Nicolase",
};

function FairyBackground() {
  return (
    <svg
      className="fairy-bg"
      viewBox="0 0 1440 900"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="skyG" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0d1340" />
          <stop offset="18%" stopColor="#1a237e" />
          <stop offset="38%" stopColor="#6a1b9a" />
          <stop offset="55%" stopColor="#c62828" stopOpacity="0.9" />
          <stop offset="67%" stopColor="#e64a19" />
          <stop offset="74%" stopColor="#ff9800" />
          <stop offset="81%" stopColor="#ffd54f" />
          <stop offset="88%" stopColor="#a5d6a7" />
          <stop offset="100%" stopColor="#2e7d32" />
        </linearGradient>
        <radialGradient id="sunG" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fff9c4" stopOpacity="0.9" />
          <stop offset="45%" stopColor="#ff9800" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#ff5722" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="moonG" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fff9c4" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#ffe082" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="1440" height="900" fill="url(#skyG)" />
      <ellipse cx="720" cy="648" rx="300" ry="140" fill="url(#sunG)" />
      <ellipse cx="218" cy="106" rx="68" ry="68" fill="url(#moonG)" />
      <circle cx="218" cy="106" r="34" fill="#fff8e1" />
      <circle cx="238" cy="93" r="27" fill="#1a237e" />
      <circle cx="78" cy="58" r="1.8" fill="white" opacity="0.9" />
      <circle cx="148" cy="32" r="1.3" fill="white" opacity="0.75" />
      <circle cx="312" cy="48" r="1.6" fill="white" opacity="0.85" />
      <circle cx="418" cy="23" r="1.1" fill="white" opacity="0.7" />
      <circle cx="552" cy="58" r="1.5" fill="white" opacity="0.8" />
      <circle cx="683" cy="28" r="1.4" fill="white" opacity="0.9" />
      <circle cx="793" cy="52" r="1.0" fill="white" opacity="0.7" />
      <circle cx="924" cy="38" r="1.7" fill="white" opacity="0.85" />
      <circle cx="1048" cy="62" r="1.2" fill="white" opacity="0.75" />
      <circle cx="1153" cy="29" r="1.5" fill="white" opacity="0.8" />
      <circle cx="1282" cy="48" r="1.9" fill="white" opacity="0.9" />
      <circle cx="1384" cy="68" r="1.0" fill="white" opacity="0.7" />
      <circle cx="98" cy="118" r="1.3" fill="white" opacity="0.65" />
      <circle cx="382" cy="98" r="1.1" fill="white" opacity="0.7" />
      <circle cx="601" cy="88" r="1.4" fill="white" opacity="0.75" />
      <circle cx="853" cy="108" r="1.2" fill="white" opacity="0.65" />
      <circle cx="1102" cy="92" r="1.3" fill="white" opacity="0.7" />
      <circle cx="1323" cy="102" r="1.5" fill="white" opacity="0.75" />
      <path d="M468,68 L470,76 L478,78 L470,80 L468,88 L466,80 L458,78 L466,76Z" fill="white" opacity="0.85" />
      <path d="M940,50 L942,58 L950,60 L942,62 L940,70 L938,62 L930,60 L938,58Z" fill="white" opacity="0.8" />
      <path d="M1198,116 L1200,124 L1208,126 L1200,128 L1198,136 L1196,128 L1188,126 L1196,124Z" fill="white" opacity="0.75" />
      <g opacity="0.78">
        <ellipse cx="345" cy="192" rx="88" ry="33" fill="#ce93d8" />
        <ellipse cx="282" cy="204" rx="54" ry="28" fill="#e1bee7" />
        <ellipse cx="412" cy="207" rx="60" ry="25" fill="#e1bee7" />
        <ellipse cx="345" cy="198" rx="75" ry="20" fill="white" opacity="0.12" />
      </g>
      <g opacity="0.72">
        <ellipse cx="1085" cy="158" rx="92" ry="36" fill="#ffb74d" opacity="0.65" />
        <ellipse cx="1012" cy="170" rx="57" ry="29" fill="#ffe0b2" />
        <ellipse cx="1162" cy="172" rx="62" ry="27" fill="#ffe0b2" />
        <ellipse cx="1085" cy="163" rx="78" ry="21" fill="white" opacity="0.1" />
      </g>
      <g fill="#4a148c" opacity="0.38">
        <rect x="688" y="543" width="64" height="89" />
        <rect x="685" y="530" width="15" height="15" />
        <rect x="703" y="530" width="15" height="15" />
        <rect x="721" y="530" width="15" height="15" />
        <rect x="739" y="530" width="14" height="15" />
        <rect x="620" y="566" width="50" height="66" />
        <rect x="618" y="555" width="13" height="13" />
        <rect x="634" y="555" width="13" height="13" />
        <rect x="650" y="555" width="13" height="13" />
        <rect x="770" y="566" width="50" height="66" />
        <rect x="768" y="555" width="13" height="13" />
        <rect x="784" y="555" width="13" height="13" />
        <rect x="800" y="555" width="13" height="13" />
        <rect x="707" y="596" width="26" height="36" fill="#2b0050" />
        <rect x="718" y="508" width="3" height="24" fill="#7b1fa2" opacity="0.8" />
        <polygon points="721,508 737,515 721,522" fill="#ce93d8" opacity="0.9" />
      </g>
      <path d="M0 662 Q220 597 430 640 Q620 580 800 616 Q990 564 1180 606 Q1340 574 1440 588 L1440 900 L0 900Z" fill="#1b5e20" opacity="0.28" />
      <path d="M0 748 Q160 700 330 724 Q510 678 695 710 Q865 666 1050 700 Q1210 668 1360 684 L1440 680 L1440 900 L0 900Z" fill="#2e7d32" opacity="0.52" />
      <path d="M0 816 Q110 790 250 804 Q400 778 560 798 Q715 773 875 793 Q1020 772 1165 788 Q1295 772 1390 781 L1440 778 L1440 900 L0 900Z" fill="#388e3c" opacity="0.88" />
      <rect x="0" y="862" width="1440" height="38" fill="#2d5a27" />
      <rect x="82" y="758" width="9" height="28" fill="#4e342e" />
      <polygon points="48,758 118,758 83,678" fill="#1b5e20" />
      <polygon points="53,722 113,722 83,648" fill="#2e7d32" />
      <rect x="180" y="776" width="9" height="28" fill="#4e342e" />
      <polygon points="144,776 216,776 184,692" fill="#1a5c1a" />
      <polygon points="149,737 211,737 184,658" fill="#2e7d32" />
      <rect x="32" y="800" width="7" height="22" fill="#4e342e" />
      <polygon points="6,800 58,800 32,742" fill="#2e7d32" />
      <rect x="1353" y="762" width="9" height="28" fill="#4e342e" />
      <polygon points="1318,762 1388,762 1357,680" fill="#1b5e20" />
      <polygon points="1323,726 1383,726 1357,650" fill="#2e7d32" />
      <rect x="1415" y="778" width="7" height="22" fill="#4e342e" />
      <polygon points="1390,778 1440,778 1420,714" fill="#1a5c1a" />
      <polygon points="1393,744 1437,744 1420,682" fill="#2e7d32" />
      <circle cx="380" cy="652" r="2.5" fill="#ffe082" opacity="0.8" />
      <circle cx="520" cy="702" r="2.0" fill="#fff9c4" opacity="0.7" />
      <circle cx="1050" cy="662" r="2.5" fill="#ffe082" opacity="0.8" />
      <circle cx="900" cy="712" r="2.0" fill="#fff9c4" opacity="0.65" />
      <circle cx="152" cy="722" r="2.0" fill="#ffe082" opacity="0.6" />
      <circle cx="1260" cy="692" r="2.5" fill="#fff9c4" opacity="0.7" />
    </svg>
  );
}

function PhotoBackground() {
  return (
    <div className="photo-bg" aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/api/reference/nicolas.jpg" alt="" className="photo-bg-img photo-bg-nicolas" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/api/reference/valentyna.jpg" alt="" className="photo-bg-img photo-bg-valentyna" />
    </div>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="cs" className={nunito.className}>
      <body>
        <FairyBackground />
        <PhotoBackground />
        {children}
      </body>
    </html>
  );
}
