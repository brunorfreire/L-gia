#!/usr/bin/env python3
"""
Generate web-optimized video and poster assets for Espaço Lígia de Mayor.
Creates:
 - hero-studio-poster.jpg (1920x1080 poster image)
 - hero-studio-ligia.mp4 (H.264, faststart, silent, seamless loop)
 - hero-studio-ligia.webm (WebM, silent, seamless loop)
 - hero-studio-mobile.mp4 (854x480 lightweight for mobile)
"""

import os
import subprocess

def create_panoramic_svg(output_path):
    svg_content = """<svg width="2400" height="1080" viewBox="0 0 2400 1080" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <!-- Wall Gradient -->
    <linearGradient id="wallGrad" x1="0" y1="0" x2="2400" y2="1080" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#FFFFFF" />
      <stop offset="35%" stop-color="#FBFBFD" />
      <stop offset="70%" stop-color="#F3F8F9" />
      <stop offset="100%" stop-color="#EAF5F7" />
    </linearGradient>

    <!-- Warm Overhead Lighting Glows -->
    <radialGradient id="lightGlow1" cx="500" cy="120" r="450" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#FFFDF7" stop-opacity="0.9" />
      <stop offset="60%" stop-color="#FFFFFF" stop-opacity="0.2" />
      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0" />
    </radialGradient>
    <radialGradient id="lightGlow2" cx="1350" cy="120" r="480" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#FFFDF5" stop-opacity="0.9" />
      <stop offset="60%" stop-color="#FFFFFF" stop-opacity="0.2" />
      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0" />
    </radialGradient>
    <radialGradient id="lightGlow3" cx="1950" cy="120" r="450" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#FFFDF0" stop-opacity="0.9" />
      <stop offset="60%" stop-color="#FFFFFF" stop-opacity="0.2" />
      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0" />
    </radialGradient>

    <!-- Floor Gradient -->
    <linearGradient id="floorGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#D7B183" />
      <stop offset="30%" stop-color="#CCA172" />
      <stop offset="70%" stop-color="#BF9060" />
      <stop offset="100%" stop-color="#AC7D4E" />
    </linearGradient>

    <!-- Wood Equipment -->
    <linearGradient id="woodCadillac" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#D97706" />
      <stop offset="40%" stop-color="#F59E0B" />
      <stop offset="100%" stop-color="#92400E" />
    </linearGradient>
    <linearGradient id="chromeMetal" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#94A3B8" />
      <stop offset="30%" stop-color="#F8FAFC" />
      <stop offset="70%" stop-color="#CBD5E1" />
      <stop offset="100%" stop-color="#64748B" />
    </linearGradient>

    <!-- Tatame Purple -->
    <linearGradient id="tatameGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#7C3AED" />
      <stop offset="50%" stop-color="#8B5CF6" />
      <stop offset="100%" stop-color="#6D28D9" />
    </linearGradient>

    <!-- Gym Balls -->
    <radialGradient id="ballGrey" cx="35%" cy="30%" r="65%">
      <stop offset="0%" stop-color="#64748B" />
      <stop offset="65%" stop-color="#334155" />
      <stop offset="100%" stop-color="#0F172A" />
    </radialGradient>
    <radialGradient id="ballRed" cx="35%" cy="30%" r="65%">
      <stop offset="0%" stop-color="#F87171" />
      <stop offset="65%" stop-color="#DC2626" />
      <stop offset="100%" stop-color="#7F1D1D" />
    </radialGradient>

    <!-- Salt Lamp Amber -->
    <radialGradient id="saltLampGrad" cx="45%" cy="45%" r="60%">
      <stop offset="0%" stop-color="#FDE047" />
      <stop offset="50%" stop-color="#F97316" />
      <stop offset="100%" stop-color="#EA580C" />
    </radialGradient>
  </defs>

  <!-- Wall Backdrop -->
  <rect width="2400" height="1080" fill="url(#wallGrad)" />
  <circle cx="500" cy="120" r="450" fill="url(#lightGlow1)" />
  <circle cx="1350" cy="120" r="480" fill="url(#lightGlow2)" />
  <circle cx="1950" cy="120" r="450" fill="url(#lightGlow3)" />

  <!-- Natural Light Window on Far Left -->
  <g opacity="0.65" transform="translate(40, 140)">
    <rect x="0" y="0" width="180" height="520" rx="8" fill="#FFFFFF" stroke="#CFE4EA" stroke-width="2" />
    <line x1="90" y1="0" x2="90" y2="520" stroke="#CFE4EA" stroke-width="2" />
    <line x1="0" y1="260" x2="180" y2="260" stroke="#CFE4EA" stroke-width="2" />
    <path d="M-10 -10 C20 180, -10 360, 15 540" stroke="#CBD5E1" stroke-width="2" stroke-dasharray="4 4" fill="none" />
  </g>

  <!-- Wood Floor Base -->
  <rect x="0" y="760" width="2400" height="320" fill="url(#floorGrad)" />
  <!-- Planks lines -->
  <line x1="0" y1="810" x2="2400" y2="810" stroke="#B48250" stroke-width="1.5" opacity="0.7" />
  <line x1="0" y1="870" x2="2400" y2="870" stroke="#A67342" stroke-width="1.5" opacity="0.7" />
  <line x1="0" y1="940" x2="2400" y2="940" stroke="#9A6536" stroke-width="1.5" opacity="0.7" />
  <line x1="0" y1="1010" x2="2400" y2="1010" stroke="#8E572B" stroke-width="1.5" opacity="0.7" />
  <!-- Baseboard (Rodapé) -->
  <rect x="0" y="745" width="2400" height="18" fill="#FFFFFF" stroke="#E2E8F0" stroke-width="1" />

  <!-- ========================================================
       SECTION 1: LEFT SIDE (SWEDISH LADDER, COLUMPIO, PROPS)
       ======================================================== -->
  <g id="swedishLadder" transform="translate(180, 140)">
    <!-- Uprights -->
    <rect x="0" y="0" width="20" height="610" rx="3" fill="url(#woodCadillac)" stroke="#78350F" stroke-width="1.5" />
    <rect x="150" y="0" width="20" height="610" rx="3" fill="url(#woodCadillac)" stroke="#78350F" stroke-width="1.5" />
    <!-- 13 Rungs -->
    <rect x="18" y="45" width="134" height="12" rx="3" fill="#FBBF24" />
    <rect x="18" y="90" width="134" height="12" rx="3" fill="#FBBF24" />
    <rect x="18" y="135" width="134" height="12" rx="3" fill="#FBBF24" />
    <rect x="18" y="180" width="134" height="12" rx="3" fill="#FBBF24" />
    <rect x="18" y="225" width="134" height="12" rx="3" fill="#FBBF24" />
    <rect x="18" y="270" width="134" height="12" rx="3" fill="#FBBF24" />
    <rect x="18" y="315" width="134" height="12" rx="3" fill="#FBBF24" />
    <rect x="18" y="360" width="134" height="12" rx="3" fill="#FBBF24" />
    <rect x="18" y="405" width="134" height="12" rx="3" fill="#FBBF24" />
    <rect x="18" y="450" width="134" height="12" rx="3" fill="#FBBF24" />
    <rect x="18" y="495" width="134" height="12" rx="3" fill="#FBBF24" />
    <rect x="18" y="540" width="134" height="12" rx="3" fill="#FBBF24" />
    <rect x="18" y="585" width="134" height="12" rx="3" fill="#FBBF24" />

    <!-- Hanging Resistance Bands & Belts -->
    <path d="M40 225 C45 320, 20 400, 35 490" stroke="#0F172A" stroke-width="7" stroke-linecap="round" fill="none" />
    <path d="M125 180 C115 270, 135 340, 120 420" stroke="#DC2626" stroke-width="5" stroke-linecap="round" fill="none" />
  </g>

  <!-- Floor Balance Disc & Wobble Board -->
  <g transform="translate(130, 770)">
    <ellipse cx="65" cy="55" rx="55" ry="24" fill="#1E293B" stroke="#0F172A" stroke-width="2" />
    <ellipse cx="65" cy="50" rx="46" ry="18" fill="#334155" />
    <ellipse cx="195" cy="45" rx="60" ry="20" fill="#0284C7" stroke="#0369A1" stroke-width="2" />
    <ellipse cx="195" cy="42" rx="50" ry="15" fill="#38BDF8" opacity="0.6" />
  </g>

  <!-- Aerial Columpio in Purple and Orange Fabric -->
  <g transform="translate(340, 40)">
    <line x1="60" y1="0" x2="60" y2="120" stroke="#64748B" stroke-width="4" />
    <line x1="160" y1="0" x2="160" y2="120" stroke="#64748B" stroke-width="4" />
    <circle cx="60" cy="120" r="8" fill="#F59E0B" />
    <circle cx="160" cy="120" r="8" fill="#F59E0B" />
    <!-- Draped Fabric Swag -->
    <path d="M60 120 C70 420, 150 420, 160 120" stroke="#7C3AED" stroke-width="26" stroke-linecap="round" fill="none" />
    <path d="M80 140 C85 380, 135 380, 140 140" stroke="#EA580C" stroke-width="12" stroke-linecap="round" fill="none" />
    <!-- Stirrup Handles -->
    <path d="M35 150 L35 340" stroke="#1E293B" stroke-width="4" />
    <rect x="20" y="340" width="30" height="12" rx="4" fill="#FBBF24" />
    <path d="M185 150 L185 340" stroke="#1E293B" stroke-width="4" />
    <rect x="170" y="340" width="30" height="12" rx="4" fill="#FBBF24" />
  </g>

  <!-- ========================================================
       SECTION 2: CENTER (PILATES CADILLAC, MAT, BALLS, BARREL)
       ======================================================== -->
  <g id="cadillacApparatus" transform="translate(560, 200)">
    <!-- Tatame Mat on floor under Cadillac -->
    <rect x="-30" y="565" width="460" height="50" rx="8" fill="url(#tatameGrad)" stroke="#5B21B6" stroke-width="2" />
    <line x1="120" y1="565" x2="120" y2="615" stroke="#5B21B6" stroke-width="1.5" stroke-dasharray="4 4" />
    <line x1="270" y1="565" x2="270" y2="615" stroke="#5B21B6" stroke-width="1.5" stroke-dasharray="4 4" />

    <!-- Chrome Canopy Frame (Canopy Tubes) -->
    <!-- Upright poles -->
    <rect x="10" y="10" width="14" height="420" rx="4" fill="url(#chromeMetal)" stroke="#64748B" stroke-width="1.5" />
    <rect x="375" y="10" width="14" height="420" rx="4" fill="url(#chromeMetal)" stroke="#64748B" stroke-width="1.5" />
    <!-- Top horizontal beam -->
    <rect x="4" y="8" width="392" height="14" rx="4" fill="url(#chromeMetal)" stroke="#64748B" stroke-width="1.5" />
    <!-- Slider crossbars with springs -->
    <rect x="10" y="90" width="379" height="10" rx="3" fill="url(#chromeMetal)" />
    <!-- Springs -->
    <line x1="60" y1="98" x2="60" y2="220" stroke="#94A3B8" stroke-width="6" stroke-linecap="round" stroke-dasharray="4 3" />
    <line x1="340" y1="98" x2="340" y2="220" stroke="#94A3B8" stroke-width="6" stroke-linecap="round" stroke-dasharray="4 3" />

    <!-- Wooden Bed Frame -->
    <rect x="0" y="420" width="400" height="45" rx="5" fill="url(#woodCadillac)" stroke="#78350F" stroke-width="2" />
    <!-- Thick Padded Top Cushion -->
    <rect x="5" y="385" width="390" height="35" rx="4" fill="#334155" stroke="#1E293B" stroke-width="1.5" />
    <!-- Sturdy Wooden Legs -->
    <rect x="15" y="465" width="28" height="110" rx="4" fill="url(#woodCadillac)" stroke="#78350F" stroke-width="1.5" />
    <rect x="357" y="465" width="28" height="110" rx="4" fill="url(#woodCadillac)" stroke="#78350F" stroke-width="1.5" />

    <!-- Under-bed Wicker Storage Baskets -->
    <rect x="65" y="485" width="85" height="60" rx="5" fill="#D4A373" stroke="#A26435" stroke-width="2" />
    <line x1="65" y1="505" x2="150" y2="505" stroke="#A26435" stroke-width="1.5" />
    <line x1="65" y1="525" x2="150" y2="525" stroke="#A26435" stroke-width="1.5" />

    <rect x="175" y="485" width="85" height="60" rx="5" fill="#D4A373" stroke="#A26435" stroke-width="2" />
    <line x1="175" y1="505" x2="260" y2="505" stroke="#A26435" stroke-width="1.5" />
    <line x1="175" y1="525" x2="260" y2="525" stroke="#A26435" stroke-width="1.5" />

    <!-- Charcoal/Grey Swiss Gym Ball resting atop Cadillac canopy -->
    <circle cx="200" cy="18" r="95" fill="url(#ballGrey)" />
    <ellipse cx="170" cy="-15" rx="30" ry="16" fill="#94A3B8" opacity="0.45" />

    <!-- Red Swiss Gym Ball on Floor -->
    <circle cx="430" cy="550" r="70" fill="url(#ballRed)" />
    <ellipse cx="405" cy="520" rx="22" ry="12" fill="#FCA5A5" opacity="0.5" />
  </g>

  <!-- Pilates Ladder Barrel & TRX -->
  <g id="ladderBarrel" transform="translate(1030, 480)">
    <!-- Barrel Curved Wooden Dome -->
    <path d="M40 180 C40 80, 110 50, 170 50 C230 50, 290 80, 290 180 Z" fill="#334155" stroke="#1E293B" stroke-width="2.5" />
    <rect x="30" y="175" width="270" height="95" rx="6" fill="url(#woodCadillac)" stroke="#78350F" stroke-width="2" />
    <!-- Ladder rungs -->
    <rect x="0" y="70" width="22" height="200" rx="4" fill="url(#woodCadillac)" />
    <line x1="22" y1="100" x2="40" y2="100" stroke="#FBBF24" stroke-width="8" stroke-linecap="round" />
    <line x1="22" y1="140" x2="40" y2="140" stroke="#FBBF24" stroke-width="8" stroke-linecap="round" />
    <line x1="22" y1="180" x2="40" y2="180" stroke="#FBBF24" stroke-width="8" stroke-linecap="round" />
    <line x1="22" y1="220" x2="40" y2="220" stroke="#FBBF24" stroke-width="8" stroke-linecap="round" />

    <!-- Hanging TRX Straps -->
    <line x1="140" y1="-280" x2="140" y2="60" stroke="#1E293B" stroke-width="8" stroke-linecap="round" />
    <rect x="128" y="-40" width="24" height="14" rx="2" fill="#FBBF24" />
    <rect x="128" y="10" width="24" height="12" rx="2" fill="#FBBF24" />
    <ellipse cx="140" cy="70" rx="18" ry="14" fill="none" stroke="#1E293B" stroke-width="6" />

    <!-- Foam Roller (Black) & Ab Wheel on Floor -->
    <rect x="310" y="170" width="35" height="100" rx="8" fill="#0F172A" stroke="#334155" stroke-width="2" />
    <ellipse cx="375" cy="245" rx="22" ry="22" fill="#F8FAFC" stroke="#1E293B" stroke-width="4" />
    <circle cx="375" cy="245" r="7" fill="#0F172A" />
  </g>

  <!-- ========================================================
       SECTION 3: RIGHT SIDE (TREATMENT TABLES, STUDIO SIGN, CHARTS)
       ======================================================== -->
  <!-- Glass Frosted Clinic Signboard (from actual video) -->
  <g transform="translate(1360, 220)">
    <rect x="0" y="0" width="380" height="150" rx="8" fill="#FFFFFF" fill-opacity="0.85" stroke="#CBD5E1" stroke-width="2" />
    <!-- Stand-off chrome bolts -->
    <circle cx="15" cy="15" r="5" fill="#94A3B8" />
    <circle cx="365" cy="15" r="5" fill="#94A3B8" />
    <circle cx="15" cy="135" r="5" fill="#94A3B8" />
    <circle cx="365" cy="135" r="5" fill="#94A3B8" />

    <!-- Typography matching real clinic sign in video -->
    <text x="190" y="65" text-anchor="middle" font-family="'Montserrat', sans-serif" font-weight="800" font-size="26" fill="#123D63" letter-spacing="2">
      ESTÚDIO LÍGIA
    </text>
    <text x="190" y="105" text-anchor="middle" font-family="'Montserrat', sans-serif" font-weight="600" font-size="13" fill="#43AEBB" letter-spacing="2.5">
      PILATES · RPG · MASSOTERAPIA
    </text>
  </g>

  <!-- Anatomical Wall Posters (from actual video) -->
  <g transform="translate(1780, 200)">
    <!-- Poster 1: Muscular System -->
    <rect x="0" y="0" width="130" height="190" rx="3" fill="#FFFFFF" stroke="#CBD5E1" stroke-width="1.5" />
    <text x="65" y="24" text-anchor="middle" font-family="sans-serif" font-size="8" font-weight="700" fill="#64748B">MUSCLES OF THE BODY</text>
    <!-- Silhouette figure -->
    <rect x="52" y="38" width="26" height="42" rx="10" fill="#DC2626" opacity="0.65" />
    <line x1="65" y1="80" x2="55" y2="160" stroke="#DC2626" stroke-width="6" stroke-linecap="round" opacity="0.65" />
    <line x1="65" y1="80" x2="75" y2="160" stroke="#DC2626" stroke-width="6" stroke-linecap="round" opacity="0.65" />

    <!-- Poster 2: Skeletal System -->
    <rect x="160" y="0" width="130" height="190" rx="3" fill="#FFFFFF" stroke="#CBD5E1" stroke-width="1.5" />
    <text x="225" y="24" text-anchor="middle" font-family="sans-serif" font-size="8" font-weight="700" fill="#64748B">SKELETAL SYSTEM</text>
    <rect x="215" y="38" width="20" height="42" rx="4" fill="#94A3B8" opacity="0.65" />
    <line x1="225" y1="80" x2="218" y2="160" stroke="#94A3B8" stroke-width="5" stroke-linecap="round" opacity="0.65" />
    <line x1="225" y1="80" x2="232" y2="160" stroke="#94A3B8" stroke-width="5" stroke-linecap="round" opacity="0.65" />
  </g>

  <!-- Wall Shelf with Towels & Dispenser -->
  <g transform="translate(1700, 390)">
    <rect x="0" y="0" width="110" height="10" rx="2" fill="#E2E8F0" />
    <!-- Rolled towels -->
    <rect x="10" y="-30" width="40" height="30" rx="4" fill="#94A3B8" />
    <rect x="55" y="-30" width="45" height="30" rx="4" fill="#64748B" />
  </g>

  <!-- Treatment Table 1 (Maca 1 - Center) -->
  <g id="table1" transform="translate(1330, 520)">
    <!-- Black Padded Table Top with Face Hole -->
    <rect x="0" y="0" width="310" height="50" rx="8" fill="#1E293B" stroke="#0F172A" stroke-width="2" />
    <!-- Folded Warm Grey / Beige Towels on top -->
    <rect x="80" y="-22" width="75" height="22" rx="4" fill="#A8A29E" />
    <rect x="95" y="-38" width="45" height="16" rx="4" fill="#D6D3D1" />
    <!-- Natural Wood Folding Legs with Diagonal Truss -->
    <line x1="30" y1="50" x2="60" y2="240" stroke="#D97706" stroke-width="12" stroke-linecap="round" />
    <line x1="280" y1="50" x2="250" y2="240" stroke="#D97706" stroke-width="12" stroke-linecap="round" />
    <line x1="60" y1="240" x2="250" y2="240" stroke="#D97706" stroke-width="8" stroke-linecap="round" />
    <line x1="60" y1="120" x2="250" y2="120" stroke="#78350F" stroke-width="4" />
  </g>

  <!-- Black Floor Examination Lamp over Table 1 -->
  <g transform="translate(1300, 420)">
    <path d="M0 340 L0 100 C0 20, 60 10, 100 30" stroke="#0F172A" stroke-width="5" fill="none" />
    <!-- Lamp shade head pointing down -->
    <path d="M90 20 L130 50 L115 65 Z" fill="#0F172A" />
    <!-- Light cone -->
    <polygon points="110,60 170,220 70,220" fill="#FEF08A" opacity="0.15" />
  </g>

  <!-- Treatment Table 2 (Maca 2 - Far Right) -->
  <g id="table2" transform="translate(1720, 530)">
    <rect x="0" y="0" width="340" height="52" rx="8" fill="#1E293B" stroke="#0F172A" stroke-width="2" />
    <!-- Towels -->
    <rect x="70" y="-24" width="80" height="24" rx="4" fill="#A8A29E" />
    <rect x="85" y="-40" width="50" height="16" rx="4" fill="#E5E7EB" />
    <!-- Wooden legs -->
    <line x1="35" y1="52" x2="70" y2="230" stroke="#D97706" stroke-width="12" stroke-linecap="round" />
    <line x1="305" y1="52" x2="270" y2="230" stroke="#D97706" stroke-width="12" stroke-linecap="round" />
    <line x1="70" y1="230" x2="270" y2="230" stroke="#D97706" stroke-width="8" stroke-linecap="round" />
  </g>

  <!-- Plant Cart & Himalayan Salt Lamp (Far Right in Video) -->
  <g transform="translate(2160, 560)">
    <!-- 3-tier white rolling cart -->
    <rect x="0" y="0" width="130" height="190" rx="6" fill="#F8FAFC" stroke="#CBD5E1" stroke-width="2" />
    <line x1="0" y1="65" x2="130" y2="65" stroke="#CBD5E1" stroke-width="2" />
    <line x1="0" y1="130" x2="130" y2="130" stroke="#CBD5E1" stroke-width="2" />
    <!-- Wheels -->
    <circle cx="15" cy="195" r="8" fill="#64748B" />
    <circle cx="115" cy="195" r="8" fill="#64748B" />

    <!-- Top Shelf: Potted Plant with flowing green leaves -->
    <rect x="15" y="-25" width="28" height="25" rx="3" fill="#FFFFFF" stroke="#94A3B8" stroke-width="1.5" />
    <path d="M29 -25 C10 -55, -5 -40, -10 -20" stroke="#16A34A" stroke-width="4" stroke-linecap="round" fill="none" />
    <path d="M29 -25 C45 -60, 60 -45, 65 -15" stroke="#15803D" stroke-width="4" stroke-linecap="round" fill="none" />
    <path d="M29 -25 C29 -65, 35 -70, 40 -35" stroke="#22C55E" stroke-width="4" stroke-linecap="round" fill="none" />

    <!-- Glowing Amber Himalayan Salt Crystal Lamp (from video) -->
    <path d="M75 -5 C75 -35, 95 -45, 110 -35 C120 -25, 120 0, 75 0 Z" fill="url(#saltLampGrad)" />
    <!-- Soft warm glow -->
    <circle cx="95" cy="-20" r="45" fill="#F59E0B" opacity="0.25" />
  </g>

  <!-- Discrete Studio Signature Bottom Right -->
  <text x="2360" y="1055" text-anchor="end" font-family="'Montserrat', sans-serif" font-weight="700" font-size="13" fill="#43AEBB" letter-spacing="2">
    ESPAÇO LÍGIA DE MAYOR · FISIOTERAPIA &amp; PILATES
  </text>
</svg>"""
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(svg_content)
    print(f"Created panoramic SVG: {output_path}")

def run_command(cmd):
    print("Running:", cmd)
    res = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if res.returncode != 0:
        print("ERROR:", res.stderr)
        raise RuntimeError(f"Command failed with code {res.returncode}")
    return res.stdout

def main():
    os.makedirs("assets", exist_ok=True)
    os.makedirs("public/assets", exist_ok=True)

    svg_path = "/tmp/studio-panoramic-2400.svg"
    full_png = "/tmp/studio-panoramic-2400.png"
    poster_jpg = "public/assets/hero-studio-poster.jpg"
    hero_mp4 = "public/assets/hero-studio-ligia.mp4"
    hero_webm = "public/assets/hero-studio-ligia.webm"
    hero_mobile = "public/assets/hero-studio-mobile.mp4"

    create_panoramic_svg(svg_path)

    # 1. Render high-res PNG (2400x1080)
    run_command(f'ffmpeg -y -i "{svg_path}" -vf "scale=2400:1080" "{full_png}"')

    # 2. Extract representative frame poster (1920x1080 centered on studio equipment and signage)
    # Crop from x=200 to show stall bars, Cadillac, barrel and studio sign
    run_command(f'ffmpeg -y -i "{full_png}" -vf "crop=1920:1080:240:0" -q:v 3 "{poster_jpg}"')
    run_command(f'cp "{poster_jpg}" "assets/hero-studio-poster.jpg"')

    # 3. Generate smooth looping camera pan video across the studio
    # Duration: 8 seconds seamless sine pan loop (starts and ends at the exact same horizontal position)
    # H.264, profile high, faststart, silent without audio track (-an)
    filter_pan_desktop = "crop=1280:720:'(in_w-out_w)*(0.5+0.5*sin(2*PI*t/8))':'(in_h-out_h)/2',format=yuv420p"
    run_command(
        f'ffmpeg -y -loop 1 -i "{full_png}" -vf "{filter_pan_desktop}" -t 8 -r 30 '
        f'-c:v libx264 -profile:v high -level 4.0 -preset medium -crf 23 '
        f'-movflags +faststart -an "{hero_mp4}"'
    )
    run_command(f'cp "{hero_mp4}" "assets/hero-studio-ligia.mp4"')

    # 4. Generate WebM version
    run_command(
        f'ffmpeg -y -loop 1 -i "{full_png}" -vf "{filter_pan_desktop}" -t 8 -r 30 '
        f'-c:v libvpx -b:v 450k -crf 25 -an "{hero_webm}"'
    )
    run_command(f'cp "{hero_webm}" "assets/hero-studio-ligia.webm"')

    # 5. Generate lightweight Mobile MP4 version (854x480, 24fps, ~180k)
    filter_pan_mobile = "crop=854:480:'(in_w-out_w)*(0.5+0.5*sin(2*PI*t/8))':'(in_h-out_h)/2',format=yuv420p"
    run_command(
        f'ffmpeg -y -loop 1 -i "{full_png}" -vf "{filter_pan_mobile}" -t 8 -r 24 '
        f'-c:v libx264 -profile:v baseline -level 3.0 -preset fast -crf 26 '
        f'-movflags +faststart -an "{hero_mobile}"'
    )
    run_command(f'cp "{hero_mobile}" "assets/hero-studio-mobile.mp4"')

    print("\nSUCCESS! Generated assets:")
    for path in [poster_jpg, hero_mp4, hero_webm, hero_mobile]:
        size_kb = os.path.getsize(path) / 1024
        print(f" - {path}: {size_kb:.1f} KB")

if __name__ == "__main__":
    main()
