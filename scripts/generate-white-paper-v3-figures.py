#!/usr/bin/env python3
"""Generate the WebChess white-paper V3 figure suite.

The figures are intentionally deterministic and data-honest.  They visualize
audited implementation facts, measured regression evidence, conceptual
boundaries, and proposed evaluations without inventing effectiveness results.

Run from anywhere:

    python3 scripts/generate-white-paper-v3-figures.py

The script writes high-resolution JPEGs and a JSON manifest to
``public/white-paper/figures/v3``.
"""

from __future__ import annotations

import argparse
import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable, Sequence

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "public" / "white-paper" / "figures" / "v3"
WIDTH = 2400
HEIGHT = 1350
MARGIN = 110

FONT_SANS = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")
FONT_SANS_BOLD = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")
FONT_SERIF = Path("/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf")
FONT_SERIF_BOLD = Path("/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf")
FONT_MONO = Path("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf")

INK = "#F6F0E2"
MUTED = "#AAB8C8"
DIM = "#718096"
BACKGROUND_TOP = "#09101E"
BACKGROUND_BOTTOM = "#111A2E"
PANEL = "#142038"
PANEL_2 = "#182945"
GRID = "#33435C"
GOLD = "#E6B65C"
TEAL = "#4FC3B5"
CYAN = "#68BDE7"
COBALT = "#597CE8"
CORAL = "#F27C69"
RED = "#DD5B67"
VIOLET = "#A783E8"
GREEN = "#75C57A"
WHITE_SIDE = "#E9EEF5"
BLACK_SIDE = "#D99B56"

EVIDENCE_COLORS = {
    "VERIFIED IMPLEMENTATION": TEAL,
    "CONCEPTUAL BOUNDARY": GOLD,
    "MEASURED AUDIT": CYAN,
    "PROPOSED EVALUATION": VIOLET,
}


def hex_rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return tuple(int(value[index:index + 2], 16) for index in (0, 2, 4))  # type: ignore[return-value]


def mix(left: str, right: str, amount: float) -> tuple[int, int, int]:
    a = hex_rgb(left)
    b = hex_rgb(right)
    return tuple(round(a[i] + (b[i] - a[i]) * amount) for i in range(3))


def font(size: int, *, bold: bool = False, serif: bool = False, mono: bool = False) -> ImageFont.FreeTypeFont:
    if mono:
        path = FONT_MONO
    elif serif:
        path = FONT_SERIF_BOLD if bold else FONT_SERIF
    else:
        path = FONT_SANS_BOLD if bold else FONT_SANS
    return ImageFont.truetype(str(path), size=size)


def wrap_lines(draw: ImageDraw.ImageDraw, text: str, face: ImageFont.FreeTypeFont, width: int) -> list[str]:
    result: list[str] = []
    for paragraph in text.split("\n"):
        if not paragraph:
            result.append("")
            continue
        words = paragraph.split()
        line = words[0]
        for word in words[1:]:
            proposed = f"{line} {word}"
            if draw.textlength(proposed, font=face) <= width:
                line = proposed
            else:
                result.append(line)
                line = word
        result.append(line)
    return result


def wrapped_text(
    draw: ImageDraw.ImageDraw,
    xy: tuple[int, int],
    text: str,
    face: ImageFont.FreeTypeFont,
    fill: str,
    width: int,
    *,
    spacing: float = 1.24,
    max_lines: int | None = None,
) -> int:
    x, y = xy
    lines = wrap_lines(draw, text, face, width)
    if max_lines is not None and len(lines) > max_lines:
        lines = lines[:max_lines]
        last = lines[-1]
        while draw.textlength(f"{last}…", font=face) > width and last:
            last = last[:-1]
        lines[-1] = f"{last.rstrip()}…"
    line_height = round(face.size * spacing)
    for line in lines:
        draw.text((x, y), line, font=face, fill=fill)
        y += line_height
    return y


def alpha_rect(
    image: Image.Image,
    box: tuple[int, int, int, int],
    fill: str,
    *,
    alpha: int = 238,
    radius: int = 28,
    outline: str | None = GRID,
    width: int = 2,
) -> None:
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    painter = ImageDraw.Draw(overlay)
    rgb = hex_rgb(fill)
    painter.rounded_rectangle(box, radius=radius, fill=(*rgb, alpha), outline=outline, width=width)
    image.alpha_composite(overlay)


def arrow(
    draw: ImageDraw.ImageDraw,
    start: tuple[float, float],
    end: tuple[float, float],
    *,
    fill: str = MUTED,
    width: int = 5,
    head: int = 18,
    joint: str = "curve",
) -> None:
    draw.line((start, end), fill=fill, width=width, joint=joint)
    angle = math.atan2(end[1] - start[1], end[0] - start[0])
    left = (
        end[0] - head * math.cos(angle - math.pi / 6),
        end[1] - head * math.sin(angle - math.pi / 6),
    )
    right = (
        end[0] - head * math.cos(angle + math.pi / 6),
        end[1] - head * math.sin(angle + math.pi / 6),
    )
    draw.polygon((end, left, right), fill=fill)


def dashed_line(
    draw: ImageDraw.ImageDraw,
    start: tuple[float, float],
    end: tuple[float, float],
    *,
    fill: str,
    width: int = 3,
    dash: int = 16,
    gap: int = 12,
) -> None:
    dx = end[0] - start[0]
    dy = end[1] - start[1]
    length = math.hypot(dx, dy)
    if length == 0:
        return
    ux, uy = dx / length, dy / length
    offset = 0.0
    while offset < length:
        segment_end = min(length, offset + dash)
        draw.line(
            (
                start[0] + ux * offset,
                start[1] + uy * offset,
                start[0] + ux * segment_end,
                start[1] + uy * segment_end,
            ),
            fill=fill,
            width=width,
        )
        offset += dash + gap


def web_motif(draw: ImageDraw.ImageDraw, center: tuple[int, int], radius: int, color: str = GRID) -> None:
    cx, cy = center
    for ring in (0.28, 0.5, 0.72, 1.0):
        points = []
        for spoke in range(8):
            angle = -math.pi / 2 + spoke * math.pi / 4
            points.append((cx + radius * ring * math.cos(angle), cy + radius * ring * math.sin(angle)))
        draw.line(points + [points[0]], fill=color, width=2)
    for spoke in range(8):
        angle = -math.pi / 2 + spoke * math.pi / 4
        draw.line((cx, cy, cx + radius * math.cos(angle), cy + radius * math.sin(angle)), fill=color, width=2)


def base_canvas(label: str, title: str, subtitle: str, evidence: str) -> tuple[Image.Image, ImageDraw.ImageDraw]:
    image = Image.new("RGBA", (WIDTH, HEIGHT), hex_rgb(BACKGROUND_TOP) + (255,))
    draw = ImageDraw.Draw(image)
    for y in range(HEIGHT):
        draw.line((0, y, WIDTH, y), fill=mix(BACKGROUND_TOP, BACKGROUND_BOTTOM, y / (HEIGHT - 1)))
    # A subdued web watermark keeps the whole suite visually coherent.
    web_motif(draw, (2200, 130), 250, "#1B2A43")
    draw.text((MARGIN, 58), f"FIGURE {label}", font=font(24, bold=True), fill=EVIDENCE_COLORS[evidence])
    draw.text((MARGIN, 96), title, font=font(64, bold=True, serif=True), fill=INK)
    wrapped_text(draw, (MARGIN, 184), subtitle, font(27), MUTED, 1520, spacing=1.18, max_lines=2)

    pill_color = EVIDENCE_COLORS[evidence]
    pill_width = int(draw.textlength(evidence, font=font(22, bold=True))) + 58
    pill_box = (WIDTH - MARGIN - pill_width, 62, WIDTH - MARGIN, 116)
    draw.rounded_rectangle(pill_box, radius=27, fill=mix(BACKGROUND_TOP, pill_color, 0.18), outline=pill_color, width=2)
    draw.text((pill_box[0] + 29, pill_box[1] + 14), evidence, font=font(22, bold=True), fill=pill_color)
    return image, draw


def finish(image: Image.Image, draw: ImageDraw.ImageDraw, filename: str) -> None:
    draw.line((MARGIN, 1277, WIDTH - MARGIN, 1277), fill=GRID, width=2)
    draw.text(
        (MARGIN, 1294),
        "THE FIRST ANSWER IS NOT ENOUGH  /  WEBCHESS 2.2.0 RELEASE CANDIDATE  /  REPOSITORY-AUDITED VISUAL",
        font=font(18, bold=True),
        fill=DIM,
    )
    draw.text((WIDTH - MARGIN, 1294), filename, font=font(18, mono=True), fill=DIM, anchor="ra")


def node(
    image: Image.Image,
    draw: ImageDraw.ImageDraw,
    center: tuple[int, int],
    size: tuple[int, int],
    title: str,
    body: str = "",
    *,
    accent: str = TEAL,
    title_size: int = 30,
    body_size: int = 22,
) -> tuple[int, int, int, int]:
    cx, cy = center
    w, h = size
    box = (cx - w // 2, cy - h // 2, cx + w // 2, cy + h // 2)
    alpha_rect(image, box, PANEL, alpha=244, radius=24, outline=accent, width=2)
    draw.ellipse((box[0] + 22, box[1] + 25, box[0] + 38, box[1] + 41), fill=accent)
    draw.text((box[0] + 52, box[1] + 20), title, font=font(title_size, bold=True), fill=INK)
    if body:
        wrapped_text(draw, (box[0] + 24, box[1] + 66), body, font(body_size), MUTED, w - 48, spacing=1.18, max_lines=4)
    return box


def small_badge(draw: ImageDraw.ImageDraw, xy: tuple[int, int], text: str, color: str) -> None:
    face = font(18, bold=True)
    w = int(draw.textlength(text, font=face)) + 30
    x, y = xy
    draw.rounded_rectangle((x, y, x + w, y + 38), radius=19, fill=mix(BACKGROUND_TOP, color, 0.18), outline=color, width=2)
    draw.text((x + 15, y + 8), text, font=face, fill=color)


@dataclass(frozen=True)
class Figure:
    number: int
    slug: str
    title: str
    evidence: str
    alt_text: str
    caption: str
    source_refs: tuple[str, ...]
    renderer: Callable[[Image.Image, ImageDraw.ImageDraw], None]

    @property
    def filename(self) -> str:
        return f"{self.number:02d}-{self.slug}.jpg"


# Stable asset IDs follow the generator's topical catalog. Publication labels
# follow reading order: fourteen figures in the main paper, nine in Appendix A,
# and three in Appendix E. Keeping both identities explicit avoids renaming
# durable assets while ensuring that the number printed inside each image
# matches its caption.
DISPLAY_LABEL_BY_ASSET: dict[int, str] = {
    1: "01",
    2: "02",
    3: "03",
    4: "04",
    12: "05",
    13: "06",
    14: "07",
    15: "08",
    16: "09",
    23: "10",
    17: "11",
    22: "12",
    18: "13",
    21: "14",
    5: "A.1",
    6: "A.2",
    7: "A.3",
    10: "A.4",
    8: "A.5",
    11: "A.6",
    9: "A.7",
    19: "A.8",
    20: "A.9",
    24: "E.1",
    25: "E.2",
    26: "E.3",
}


def render_first_frame(image: Image.Image, draw: ImageDraw.ImageDraw) -> None:
    q = node(image, draw, (300, 700), (360, 210), "Ambiguous question", "Many plausible frames; incomplete evidence.", accent=GOLD)
    top1 = node(image, draw, (830, 460), (350, 190), "First frame", "The earliest coherent interpretation.", accent=CORAL)
    top2 = node(image, draw, (1370, 460), (370, 190), "Fluent answer", "Compression arrives before examination.", accent=RED)
    lower1 = node(image, draw, (790, 850), (360, 190), "Structured plurality", "64 facets expose alternative constructions.", accent=TEAL)
    lower2 = node(image, draw, (1320, 850), (390, 190), "Conflict + examination", "Chess, Portia, Gate, and bounded Retry.", accent=CYAN)
    lower3 = node(image, draw, (1880, 850), (390, 190), "Qualified action", "Charlotte, Wilbur, and a remembered outcome.", accent=VIOLET)
    arrow(draw, (q[2], 650), (top1[0], 500), fill=CORAL, width=7)
    arrow(draw, (top1[2], 460), (top2[0], 460), fill=CORAL, width=7)
    arrow(draw, (q[2], 760), (lower1[0], 820), fill=TEAL, width=7)
    arrow(draw, (lower1[2], 850), (lower2[0], 850), fill=TEAL, width=7)
    arrow(draw, (lower2[2], 850), (lower3[0], 850), fill=TEAL, width=7)
    draw.text((1090, 610), "The architecture delays closure; it does not guarantee truth.", font=font(30, bold=True, serif=True), fill=GOLD)
    small_badge(draw, (1545, 395), "ONE-PASS COLLAPSE", CORAL)
    small_badge(draw, (1645, 780), "ARACHNE METHOD", TEAL)


def render_stage_crosswalk(image: Image.Image, draw: ImageDraw.ImageDraw) -> None:
    formal = ["Anansi", "Chess", "Portia", "Gate", "Retry", "Charlotte", "Wilbur", "Web"]
    visible = ["Anansi", "Chess", "Portia", "Answer", "Charlotte", "Wilbur", "Web"]
    draw.text((MARGIN, 330), "FORMAL ARCHITECTURE  /  8 AUTHORITIES", font=font(25, bold=True), fill=TEAL)
    gap = 252
    start = 210
    for index, label in enumerate(formal):
        cx = start + index * gap
        color = [GOLD, COBALT, CORAL, CYAN, VIOLET, GREEN, WHITE_SIDE, TEAL][index]
        draw.ellipse((cx - 72, 410, cx + 72, 554), fill=hex_rgb(PANEL_2), outline=color, width=4)
        draw.text((cx, 465), str(index + 1), font=font(25, bold=True), fill=color, anchor="mm")
        draw.text((cx, 585), label, font=font(24, bold=True), fill=INK, anchor="ma")
        if index < len(formal) - 1:
            arrow(draw, (cx + 78, 482), (cx + gap - 78, 482), fill=GRID, width=4, head=14)

    draw.text((MARGIN, 735), "PLAYER-FACING RAIL  /  7 VISIBLE STOPS", font=font(25, bold=True), fill=CYAN)
    visible_start = 250
    visible_gap = 305
    for index, label in enumerate(visible):
        cx = visible_start + index * visible_gap
        accent = GOLD if label == "Answer" else CYAN
        alpha_rect(image, (cx - 122, 820, cx + 122, 940), PANEL, alpha=248, radius=30, outline=accent, width=3)
        draw.text((cx, 880), label, font=font(27, bold=True), fill=INK, anchor="mm")
        if index < len(visible) - 1:
            arrow(draw, (cx + 128, 880), (cx + visible_gap - 128, 880), fill=GRID, width=4, head=13)
    alpha_rect(image, (110, 1000, 700, 1165), PANEL, alpha=245, radius=25, outline=TEAL, width=2)
    draw.text((145, 1027), "4 SHELL PHASES", font=font(21, bold=True), fill=TEAL)
    wrapped_text(draw, (145, 1070), "Name it → Divide it → Play it → Read it", font(20, bold=True), INK, 520, spacing=1.18, max_lines=2)
    draw.rounded_rectangle((760, 1000, 1640, 1165), radius=28, fill=mix(BACKGROUND_TOP, GOLD, 0.14), outline=GOLD, width=2)
    wrapped_text(draw, (800, 1022), "Gate and Retry are internal authorities. Answer is a digest-bound artifact—not a ninth authority.", font(25, bold=True), INK, 800, spacing=1.18, max_lines=3)
    alpha_rect(image, (1700, 1000, 2290, 1165), PANEL, alpha=245, radius=25, outline=CYAN, width=2)
    draw.text((1735, 1027), "10 TECHNICAL STEPS", font=font(21, bold=True), fill=CYAN)
    wrapped_text(draw, (1735, 1070), "Question → Division → Cast → Play → Replay → Prompt → Portia → Gate/Retry → Answer/Charlotte → Wilbur/Web", font(16, bold=True), INK, 520, spacing=1.12, max_lines=4)


def render_facet_matrix(image: Image.Image, draw: ImageDraw.ImageDraw) -> None:
    rows = ["Purpose", "People", "Resources", "Timing", "Risks", "Values", "Evidence", "Possibilities"]
    cols = ["Begin", "Receive", "Clarify", "Connect", "Challenge", "Adapt", "Consolidate", "Release"]
    x0, y0 = 370, 355
    cell_w, cell_h = 215, 94
    draw.text((x0 + cell_w * 4, 300), "MOVEMENTS OF CHANGE", font=font(24, bold=True), fill=GOLD, anchor="mm")
    draw.text((160, y0 + cell_h * 4), "PRACTICAL\nDIMENSIONS", font=font(23, bold=True), fill=TEAL, anchor="mm", align="center")
    for col, name in enumerate(cols):
        draw.text((x0 + col * cell_w + cell_w // 2, y0 - 22), name, font=font(20, bold=True), fill=MUTED, anchor="ms")
    for row, name in enumerate(rows):
        draw.text((x0 - 28, y0 + row * cell_h + cell_h // 2), name, font=font(22, bold=True), fill=INK, anchor="rm")
        for col in range(8):
            box = (x0 + col * cell_w, y0 + row * cell_h, x0 + (col + 1) * cell_w - 8, y0 + (row + 1) * cell_h - 8)
            tint = TEAL if (row + col) % 2 == 0 else COBALT
            draw.rounded_rectangle(box, radius=14, fill=hex_rgb(PANEL), outline=hex_rgb(tint) + (130,), width=2)
            facet_id = row * 8 + col + 1
            draw.text((box[0] + 16, box[1] + 13), f"F{facet_id:02d}", font=font(20, bold=True), fill=tint)
            draw.text((box[0] + 16, box[1] + 48), f"{name} × {cols[col]}", font=font(15), fill=MUTED)
    draw.text((370, 1142), "Exactly 64 schema-valid facets. Grid coverage is structural integrity—not proof of completeness, relevance, or independence.", font=font(24, bold=True), fill=GOLD)


def render_cast(image: Image.Image, draw: ImageDraw.ImageDraw) -> None:
    draw.rounded_rectangle((110, 340, 420, 1110), radius=34, fill=hex_rgb(PANEL), outline=GOLD, width=3)
    draw.text((265, 400), "SAVED SEED", font=font(28, bold=True), fill=GOLD, anchor="mm")
    draw.text((265, 485), "s", font=font(72, bold=True, serif=True), fill=INK, anchor="mm")
    wrapped_text(draw, (150, 560), "One persisted seed derives three domain-separated deterministic permutations.", font(24), MUTED, 230, spacing=1.2)
    stages = [
        ("πF", "FACET SHUFFLE", "64 validated facets", TEAL),
        ("πH", "LENS SHUFFLE", "64 I Ching-inspired lenses", VIOLET),
        ("πB", "BOARD SHUFFLE", "64 completed pairs → 64 cells", CYAN),
    ]
    for index, (symbol, label, body, accent) in enumerate(stages):
        y = 390 + index * 250
        arrow(draw, (420, y + 80), (610, y + 80), fill=accent, width=6)
        draw.ellipse((610, y + 15, 740, y + 145), fill=hex_rgb(PANEL_2), outline=accent, width=4)
        draw.text((675, y + 79), symbol, font=font(42, bold=True, serif=True), fill=accent, anchor="mm")
        alpha_rect(image, (790, y, 1390, y + 160), PANEL, alpha=244, radius=26, outline=accent, width=2)
        draw.text((830, y + 25), label, font=font(26, bold=True), fill=INK)
        draw.text((830, y + 75), body, font=font(23), fill=MUTED)
        if index < 2:
            draw.text((1450, y + 78), "independent domain", font=font(20, bold=True), fill=DIM)
    web_motif(draw, (1930, 720), 360, CYAN)
    draw.text((1930, 715), "B₀", font=font(70, bold=True, serif=True), fill=INK, anchor="mm")
    draw.text((1930, 1115), "Reproducible recombination", font=font(27, bold=True), fill=CYAN, anchor="mm")
    draw.text((1930, 1160), "not semantic inference • not causal mapping • not evidence", font=font(20), fill=MUTED, anchor="mm")


def radial_grid(draw: ImageDraw.ImageDraw, center: tuple[int, int], radius: int, *, color: str = GRID, width: int = 3) -> None:
    cx, cy = center
    for ring in range(1, 9):
        r = radius * ring / 8
        draw.ellipse((cx - r, cy - r, cx + r, cy + r), outline=color, width=width)
    for sector in range(8):
        angle = -math.pi / 2 + sector * math.pi / 4
        draw.line((cx, cy, cx + radius * math.cos(angle), cy + radius * math.sin(angle)), fill=color, width=width)


def render_topology(image: Image.Image, draw: ImageDraw.ImageDraw) -> None:
    center = (750, 750)
    radial_grid(draw, center, 430, color="#4A5C78", width=3)
    for ring in range(8):
        draw.text((750, 750 - (ring + 0.5) * 430 / 8), f"r{ring}", font=font(18, bold=True), fill=TEAL, anchor="mm")
    draw.arc((center[0] - 475, center[1] - 475, center[0] + 475, center[1] + 475), 280, 350, fill=GOLD, width=10)
    arrow(draw, (1110, 440), (1138, 475), fill=GOLD, width=8, head=22)
    draw.text((1075, 370), "sector seam wraps", font=font(22, bold=True), fill=GOLD, anchor="mm")
    alpha_rect(image, (1320, 370, 2260, 1115), PANEL, alpha=246, radius=32, outline=CYAN, width=3)
    draw.text((1790, 480), "P₈ □ C₈", font=font(82, bold=True, serif=True), fill=INK, anchor="mm")
    draw.text((1790, 560), "Cartesian cell topology", font=font(28, bold=True), fill=CYAN, anchor="mm")
    rows = [
        ("P₈", "Eight bounded ring positions", TEAL),
        ("C₈", "Eight cyclic sector positions", GOLD),
        ("64", "Coordinate cells (ring, sector)", CYAN),
        ("≠", "Not an orthodox flat chessboard", CORAL),
    ]
    for i, (symbol, body, accent) in enumerate(rows):
        y = 660 + i * 102
        draw.text((1440, y), symbol, font=font(38, bold=True, serif=True), fill=accent, anchor="lm")
        draw.text((1530, y), body, font=font(25), fill=INK, anchor="lm")
    draw.text((MARGIN, 1180), "Rings stop at both boundaries. Sectors wrap modulo eight. Piece move rules operate on this topology.", font=font(25, bold=True), fill=MUTED)


PIECE_GLYPHS = {"rook": "R", "knight": "N", "bishop": "B", "queen": "Q", "king": "K", "pawn": "P"}


def draw_piece(draw: ImageDraw.ImageDraw, xy: tuple[float, float], kind: str, side_color: str, *, radius: int = 23) -> None:
    x, y = xy
    draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=hex_rgb(BACKGROUND_TOP), outline=side_color, width=3)
    draw.text((x, y), PIECE_GLYPHS[kind], font=font(round(radius * 1.05), bold=True, serif=True), fill=side_color, anchor="mm")


def ring_point(center: tuple[int, int], radius: float, sector: int) -> tuple[float, float]:
    angle = -math.pi / 2 + (sector + 0.5) * math.pi / 4
    return center[0] + radius * math.cos(angle), center[1] + radius * math.sin(angle)


def render_initial_board(image: Image.Image, draw: ImageDraw.ImageDraw) -> None:
    center = (1160, 740)
    radius = 450
    radial_grid(draw, center, radius, color="#3C4B65", width=2)
    back = ["rook", "knight", "bishop", "queen", "king", "bishop", "knight", "rook"]
    ring_width = radius / 8
    for sector, kind in enumerate(back):
        # Ring zero is physically tiny on a polar rendering.  Put each back
        # piece near the outer half of that ring and reduce the glyph so all
        # eight remain legible without changing the stated coordinate.
        draw_piece(draw, ring_point(center, ring_width * 0.86, sector), kind, BLACK_SIDE, radius=14)
        draw_piece(draw, ring_point(center, ring_width * 1.56, sector), "pawn", BLACK_SIDE, radius=16)
        draw_piece(draw, ring_point(center, ring_width * 6.48, sector), "pawn", WHITE_SIDE, radius=20)
        draw_piece(draw, ring_point(center, ring_width * 7.48, sector), kind, WHITE_SIDE, radius=22)
    for sector in (0, 2, 4, 6):
        start = ring_point(center, ring_width * 2.05, sector)
        end = ring_point(center, ring_width * 3.2, sector)
        arrow(draw, start, end, fill=BLACK_SIDE, width=5, head=17)
        start2 = ring_point(center, ring_width * 5.95, sector)
        end2 = ring_point(center, ring_width * 4.8, sector)
        arrow(draw, start2, end2, fill=WHITE_SIDE, width=5, head=17)
    alpha_rect(image, (110, 390, 630, 1040), PANEL, alpha=242, radius=30, outline=BLACK_SIDE, width=3)
    draw.text((370, 465), "BLACK", font=font(38, bold=True), fill=BLACK_SIDE, anchor="mm")
    draw.text((370, 520), "inside-out intent", font=font(27, bold=True, serif=True), fill=INK, anchor="mm")
    wrapped_text(draw, (160, 590), "Back rank on ring 0. Pawns on ring 1. Advances generally outward.", font(24), MUTED, 420, spacing=1.25)
    alpha_rect(image, (1740, 390, 2260, 1040), PANEL, alpha=242, radius=30, outline=WHITE_SIDE, width=3)
    draw.text((2000, 465), "WHITE", font=font(38, bold=True), fill=WHITE_SIDE, anchor="mm")
    draw.text((2000, 520), "outside-in evidence", font=font(27, bold=True, serif=True), fill=INK, anchor="mm")
    wrapped_text(draw, (1790, 590), "Back rank on ring 7. Pawns on ring 6. Advances generally inward. White moves first.", font(24), MUTED, 420, spacing=1.25)
    draw.text((120, 1148), "Directional tension, not moral coloring: evidence can mislead; intention can be wise.", font=font(27, bold=True), fill=GOLD)


def render_piece_metaphors(image: Image.Image, draw: ImageDraw.ImageDraw) -> None:
    items = [
        ("king", "CORE PURPOSE", "protect the non-negotiable outcome", GOLD),
        ("queen", "AGENCY", "compare options, influence, and resources", VIOLET),
        ("rook", "STRUCTURE", "make rules, boundaries, and systems explicit", CYAN),
        ("bishop", "PERSPECTIVE", "test the values and assumptions shaping the view", TEAL),
        ("knight", "REFRAMING", "try an indirect route or materially different view", CORAL),
        ("pawn", "PRACTICE", "take the smallest observable next step", GREEN),
    ]
    for index, (kind, label, body, accent) in enumerate(items):
        col, row = index % 3, index // 3
        x = 110 + col * 735
        y = 340 + row * 390
        alpha_rect(image, (x, y, x + 660, y + 320), PANEL, alpha=244, radius=30, outline=accent, width=2)
        draw_piece(draw, (x + 100, y + 98), kind, accent, radius=48)
        draw.text((x + 175, y + 46), label, font=font(27, bold=True), fill=accent)
        wrapped_text(draw, (x + 175, y + 94), body, font(23), INK, 430, spacing=1.2, max_lines=3)
        movement = {
            "king": "1-step queen move; captured directly",
            "queen": "radial + sector + diagonal rays",
            "rook": "radial or same-ring sector rays",
            "bishop": "ring-sector diagonals",
            "knight": "polar-grid L displacement",
            "pawn": "forward; diagonal capture; queen promotion",
        }[kind]
        draw.line((x + 55, y + 225, x + 605, y + 225), fill=GRID, width=2)
        draw.text((x + 55, y + 252), movement, font=font(19, bold=True), fill=MUTED)
    draw.text((MARGIN, 1158), "Movement roles organize attention. They do not assign truth, rank stakeholders, or establish causal importance.", font=font(25, bold=True), fill=GOLD)


def render_value_scales(image: Image.Image, draw: ImageDraw.ImageDraw) -> None:
    draw.text((MARGIN, 325), "IMPLEMENTED CAPTURE-SALIENCE FORMULA", font=font(23, bold=True), fill=TEAL)
    formula = "A = round[ 52 + 2.5·V(captured) + V(attacker) + 2·max(0, 3.5 − |3.5 − r|) ]"
    draw.text((WIDTH // 2, 430), formula, font=font(38, bold=True, mono=True), fill=INK, anchor="mm")
    draw.text((WIDTH // 2, 495), "r = destination ring (0…7)  •  V = piece base value", font=font(23), fill=MUTED, anchor="mm")
    scales = [
        ("1", "PIECE VALUE  V", "Pawn 1 · Knight 3 · Bishop 3 · Rook 5 · Queen 9 · King 10", CYAN),
        ("2", "ENGINE EVALUATION  E", "Search score: material, activity, promotion race, King danger, edge pressure, tempo.", COBALT),
        ("3", "CAPTURE ATTENTION  A", "A hand-designed display score. Higher means ‘look here,’ not ‘believe this.’", TEAL),
        ("4", "EVIDENCE / HUMAN VALUE", "Not computed by chess. Portia, Gate, accountable people, and observed outcomes remain separate.", GOLD),
    ]
    for index, (number, label, body, accent) in enumerate(scales):
        x = 110 + index * 555
        alpha_rect(image, (x, 610, x + 500, 1080), PANEL, alpha=246, radius=30, outline=accent, width=3)
        draw.text((x + 45, 655), number, font=font(54, bold=True, serif=True), fill=accent)
        draw.text((x + 45, 735), label, font=font(22, bold=True), fill=INK)
        wrapped_text(draw, (x + 45, 800), body, font(22), MUTED, 410, spacing=1.23, max_lines=6)
    draw.text((MARGIN, 1150), "Never promote a number from one scale into a claim on another.", font=font(30, bold=True, serif=True), fill=CORAL)


def render_pvs(image: Image.Image, draw: ImageDraw.ImageDraw) -> None:
    root = (350, 705)
    draw.ellipse((280, 635, 420, 775), fill=hex_rgb(PANEL_2), outline=GOLD, width=4)
    draw.text(root, "ROOT", font=font(27, bold=True), fill=INK, anchor="mm")
    levels = [740, 1130, 1520, 1910]
    colors = [TEAL, CYAN, COBALT, VIOLET]
    labels = ["d1", "d2", "d3", "d…"]
    parent_points = [root]
    for depth, x in enumerate(levels):
        next_points: list[tuple[int, int]] = []
        for p_index, parent in enumerate(parent_points):
            branch_count = 3 if depth < 2 else 2
            for branch in range(branch_count):
                y = 430 + ((p_index * branch_count + branch + 1) * 540 // (len(parent_points) * branch_count + 1))
                point = (x, y)
                draw.line((parent, point), fill=GRID, width=3)
                next_points.append(point)
        for point in next_points:
            draw.ellipse((point[0] - 16, point[1] - 16, point[0] + 16, point[1] + 16), fill=colors[depth])
        draw.text((x, 1065), labels[depth], font=font(24, bold=True), fill=colors[depth], anchor="mm")
        parent_points = next_points
    # Highlight a principal variation through the tree.
    pv = [(350, 705), (740, 700), (1130, 650), (1520, 610), (1910, 600)]
    draw.line(pv, fill=GOLD, width=9, joint="curve")
    draw.text((1740, 540), "PV  /  PRINCIPAL VARIATION", font=font(22, bold=True), fill=GOLD)
    cards = [
        ("PVS", "Principal Variation Search: narrow-window search away from the best line."),
        ("TT", "Transposition Table: dual-word hashed reuse of reached positions."),
        ("SEE", "Static Exchange Evaluation: tactical capture ordering and pruning support."),
        ("Q", "Quiescence: extends tactically noisy leaves before evaluation."),
    ]
    for index, (acronym, body) in enumerate(cards):
        x = 110 + index * 555
        alpha_rect(image, (x, 1110, x + 500, 1238), PANEL, alpha=246, radius=22, outline=colors[index], width=2)
        draw.text((x + 24, 1135), acronym, font=font(25, bold=True), fill=colors[index])
        wrapped_text(draw, (x + 100, 1130), body, font(18), MUTED, 375, spacing=1.2, max_lines=4)
    draw.text((MARGIN, 325), "Iterative deepening • aspiration windows • alpha–beta cutoffs • 150,000-node default budget • seeded root tie-break", font=font(25, bold=True), fill=MUTED)
    small_badge(draw, (1840, 330), "SEMANTIC ACCESS: NONE", CORAL)


def render_terminal_precedence(image: Image.Image, draw: ImageDraw.ImageDraw) -> None:
    steps = [
        ("1", "KING CAPTURE?", "Decisive win; checked first—even on ply 256.", RED),
        ("2", "BOTH SIDES IMMOBILE?", "Draw: mutual no-moves.", GOLD),
        ("3", "QUIET PLIES ≥ 100?", "Draw: no-progress boundary.", CYAN),
        ("4", "COMPLETED PLIES ≥ 256?", "Draw: total move limit.", VIOLET),
        ("5", "OTHERWISE", "Continue; insert a forced pass if only next side is immobile.", TEAL),
    ]
    y = 330
    for index, (number, title, body, accent) in enumerate(steps):
        box = (350, y, 2050, y + 150)
        alpha_rect(image, box, PANEL, alpha=245, radius=28, outline=accent, width=3)
        draw.ellipse((390, y + 30, 480, y + 120), fill=hex_rgb(accent), outline=INK, width=2)
        draw.text((435, y + 75), number, font=font(34, bold=True), fill=BACKGROUND_TOP, anchor="mm")
        draw.text((540, y + 34), title, font=font(27, bold=True), fill=INK)
        draw.text((540, y + 86), body, font=font(22), fill=MUTED)
        if index < len(steps) - 1:
            arrow(draw, (1200, y + 150), (1200, y + 187), fill=GRID, width=5, head=13)
        y += 178
    draw.text((MARGIN, 1195), "Precedence is deterministic. A threshold does not retroactively erase a legal terminal capture.", font=font(26, bold=True), fill=GOLD)


def render_replay(image: Image.Image, draw: ImageDraw.ImageDraw) -> None:
    client = node(image, draw, (300, 700), (380, 290), "Browser proposal", "pieceId · destination · expectedRevision\n+ idempotency key in request", accent=CORAL)
    stages = [
        ("Load", "owner-scoped game + division + ordered events"),
        ("Rebuild", "canonical initial pieces; White to move"),
        ("Replay", "validate every move; derive captures, promotions, passes"),
        ("Resolve", "counters + ending precedence + next public view"),
        ("Commit", "events + revision atomically with CAS"),
    ]
    x = 710
    stage_boxes = []
    for index, (title, body) in enumerate(stages):
        box = node(image, draw, (x + index * 310, 700), (270, 300), title, body, accent=TEAL if index < 4 else GOLD, title_size=25, body_size=19)
        stage_boxes.append(box)
        if index > 0:
            arrow(draw, (stage_boxes[index - 1][2], 700), (box[0], 700), fill=GRID, width=4, head=12)
    arrow(draw, (client[2], 700), (stage_boxes[0][0], 700), fill=CORAL, width=6)
    draw.rounded_rectangle((640, 1040, 2200, 1165), radius=25, fill=mix(BACKGROUND_TOP, GOLD, 0.14), outline=GOLD, width=2)
    draw.text((1420, 1080), "CAS = compare-and-swap revision check  •  stale or fabricated state is rejected", font=font(25, bold=True), fill=INK, anchor="mm")
    draw.text((1420, 1125), "The client never authors captures, passes, outcomes, attention, Gate results, or lifecycle truth.", font=font(21), fill=MUTED, anchor="mm")
    draw.text((MARGIN, 335), "ONE SMALL COMMAND IN  →  ONE CANONICALLY DERIVED EVENT STREAM OUT", font=font(27, bold=True), fill=CYAN)


def render_portia(image: Image.Image, draw: ImageDraw.ImageDraw) -> None:
    attacks = [
        "Relevance to original problem", "Unsupported assumption", "Evidence grounding",
        "Redundancy", "Contradiction", "Causal overreach",
        "Stakeholder / opponent response", "Seed / path sensitivity", "Actionability",
        "Reversibility", "Harm / exclusion", "Metaphor overreach", "Narrative overfitting",
    ]
    center = (1200, 710)
    web_motif(draw, center, 245, CORAL)
    draw.ellipse((1085, 605, 1315, 835), fill=hex_rgb(PANEL_2), outline=CORAL, width=5)
    draw.text((1200, 690), "PORTIA", font=font(36, bold=True, serif=True), fill=INK, anchor="mm")
    draw.text((1200, 745), "before Answer", font=font(21, bold=True), fill=CORAL, anchor="mm")
    draw.text((1200, 786), "each survivor × 13", font=font(19), fill=MUTED, anchor="mm")
    for index, label in enumerate(attacks):
        angle = -math.pi / 2 + index * 2 * math.pi / len(attacks)
        # An elliptical orbit uses the wide page efficiently and keeps the
        # thirteen labels clear of the title, caption, and disposition legend.
        x = center[0] + 760 * math.cos(angle)
        y = center[1] + 350 * math.sin(angle)
        box_w = 320
        box_h = 76
        alpha_rect(image, (round(x - box_w / 2), round(y - box_h / 2), round(x + box_w / 2), round(y + box_h / 2)), PANEL, alpha=246, radius=18, outline=CORAL if index % 2 == 0 else VIOLET, width=2)
        wrapped_text(draw, (round(x - box_w / 2 + 18), round(y - 19)), f"{index + 1:02d}  {label}", font(16, bold=True), INK, box_w - 36, spacing=1.1, max_lines=2)
        start = (center[0] + 255 * math.cos(angle), center[1] + 255 * math.sin(angle))
        end = (x - 155 * math.cos(angle), y - 42 * math.sin(angle))
        dashed_line(draw, start, end, fill=GRID, width=2, dash=10, gap=8)
    dispositions = [("PRESERVED", GREEN), ("WOUNDED", GOLD), ("CONSUMED", RED), ("UNRESOLVED", VIOLET)]
    for index, (label, accent) in enumerate(dispositions):
        x = 560 + index * 430
        small_badge(draw, (x, 1145), label, accent)
    draw.text((MARGIN, 285), "Exact forthcoming Answer prompt • persisted per-candidate progress • four dispositions • run-wide technical budget: 3 started attempts", font=font(23, bold=True), fill=MUTED)


def render_gate(image: Image.Image, draw: ImageDraw.ImageDraw) -> None:
    requirements = [
        ("PORTIA", "prompt decision = permit", CORAL),
        ("USABLE", "preserved + wounded ≥ 3", TEAL),
        ("INDEPENDENT", "candidate clusters ≥ 3", CYAN),
        ("COVERAGE", "outcome ∧ evidence ∧ risk ∧ agency", GREEN),
        ("TENSION", "≥ 1 pair across independent usable clusters", VIOLET),
        ("SAFETY", "no unresolved severe/fatal contradiction or usable finding", RED),
        ("INTEGRITY", "wounds qualified ∧ no field-repair defect", GOLD),
    ]
    x0, y0 = 130, 330
    for index, (title, body, accent) in enumerate(requirements):
        y = y0 + index * 120
        alpha_rect(image, (x0, y, 920, y + 92), PANEL, alpha=245, radius=22, outline=accent, width=2)
        draw.text((x0 + 28, y + 25), title, font=font(21, bold=True), fill=accent)
        draw.text((x0 + 210, y + 25), body, font=font(20), fill=INK)
        arrow(draw, (920, y + 46), (1110, 700), fill=GRID, width=3, head=10)
    # A literal AND gate makes the hard-floor nature visually unmistakable.
    draw.rectangle((1110, 490, 1400, 910), fill=hex_rgb(PANEL_2), outline=CYAN, width=4)
    draw.pieslice((1210, 490, 1590, 910), 270, 90, fill=hex_rgb(PANEL_2), outline=CYAN, width=4)
    draw.text((1325, 700), "AND", font=font(50, bold=True, serif=True), fill=INK, anchor="mm")
    arrow(draw, (1590, 700), (1770, 700), fill=CYAN, width=8, head=24)
    alpha_rect(image, (1770, 475, 2260, 925), PANEL, alpha=246, radius=35, outline=TEAL, width=4)
    draw.text((2015, 585), "PASS", font=font(62, bold=True, serif=True), fill=TEAL, anchor="mm")
    draw.text((2015, 665), "authorize Answer", font=font(27, bold=True), fill=INK, anchor="mm")
    draw.line((1840, 725, 2190, 725), fill=GRID, width=2)
    draw.text((2015, 790), "Any failed floor", font=font(23, bold=True), fill=CORAL, anchor="mm")
    draw.text((2015, 835), "→ bounded Retry", font=font(25, bold=True), fill=GOLD, anchor="mm")
    draw.text((MARGIN, 1190), "webchess-gate-v4 uses a deterministic conjunction of hard floors—not the proposed weighted G score.", font=font(26, bold=True), fill=GOLD)


def render_retry(image: Image.Image, draw: ImageDraw.ImageDraw) -> None:
    gate = node(image, draw, (300, 685), (380, 230), "Gate failed", "Persist the failure and inspect its recommended transition.", accent=RED)
    decision = node(image, draw, (850, 685), (400, 260), "What failed?", "Traversal / duplicate ecology / field representation", accent=GOLD)
    replay1 = node(image, draw, (1390, 445), (360, 190), "Replay game", "Same field; spend next root-wide allowance", accent=CYAN)
    replay2 = node(image, draw, (1830, 445), (360, 190), "Replay game", "Same field; at most 2 in the genealogy", accent=CYAN)
    regen = node(image, draw, (1390, 875), (360, 210), "Regenerate field", "One root-wide return to Anansi", accent=VIOLET)
    stop = node(image, draw, (1900, 875), (420, 220), "Insufficient basis", "Budget exhausted. Charlotte is not authorized.", accent=RED)
    arrow(draw, (gate[2], 685), (decision[0], 685), fill=RED, width=6)
    arrow(draw, (decision[2], 620), (replay1[0], 490), fill=CYAN, width=6)
    arrow(draw, (replay1[2], 445), (replay2[0], 445), fill=CYAN, width=6)
    arrow(draw, (decision[2], 750), (regen[0], 850), fill=VIOLET, width=6)
    # Regeneration may occur before or after the same-field allowances. The
    # lower-to-upper arrow makes the remaining-replay path explicit.
    arrow(draw, (replay2[0] + 90, replay2[3]), (regen[2] - 40, regen[1]), fill=VIOLET, width=5)
    arrow(draw, (1390, regen[1]), (1390, replay1[3]), fill=GOLD, width=4)
    arrow(draw, (regen[2], 875), (stop[0], 875), fill=RED, width=6)
    draw.text((1390, 305), "adequate field / new trajectory", font=font(20, bold=True), fill=CYAN, anchor="mm")
    draw.text((1412, 660), "if a replay allowance remains", font=font(17, bold=True), fill=GOLD)
    draw.text((1270, 1030), "duplicate fingerprint or field-level defect", font=font(20, bold=True), fill=VIOLET)
    draw.rounded_rectangle((420, 1050, 1050, 1170), radius=24, fill=mix(BACKGROUND_TOP, GOLD, 0.14), outline=GOLD, width=2)
    draw.text((735, 1090), "Policy: webchess-retry-v2", font=font(24, bold=True), fill=INK, anchor="mm")
    draw.text((735, 1132), "root-wide caps; policy-selected order", font=font(21), fill=MUTED, anchor="mm")


def render_answer_charlotte_wilbur(image: Image.Image, draw: ImageDraw.ImageDraw) -> None:
    stages = [
        ("APPROVED PROMPT", "Exact reviewed board package\n+ digest + Gate provenance", CORAL),
        ("ANSWER", "Generated only after permit + Gate pass\n+ stored as an immutable artifact", GOLD),
        ("CHARLOTTE", "Qualifies that exact stored Answer\n+ returns exactly 3 suggestions", TEAL),
        ("DURABLE WILBUR", "Owner + idempotency key + digest\n+ metered mutation claim", VIOLET),
    ]
    boxes = []
    for index, (title, body, accent) in enumerate(stages):
        cx = 310 + index * 590
        box = node(image, draw, (cx, 690), (480, 350), title, body, accent=accent, title_size=26, body_size=22)
        boxes.append(box)
        if index > 0:
            arrow(draw, (boxes[index - 1][2], 690), (box[0], 690), fill=accent, width=6, head=18)
    draw.text((MARGIN, 340), "Prompt-bound generation → post-generation qualification → durable human-owned consequence", font=font(32, bold=True, serif=True), fill=INK)
    alpha_rect(image, (170, 920, 1160, 1095), PANEL_2, alpha=246, radius=24, outline=VIOLET, width=2)
    draw.text((215, 960), "ADMISSION", font=font(22, bold=True), fill=VIOLET)
    wrapped_text(
        draw,
        (215, 1005),
        "Database-clock rate admitted once • rows and exact UTF-8 text reserved against the lifetime envelope",
        font(20),
        INK,
        890,
        spacing=1.18,
        max_lines=3,
    )
    alpha_rect(image, (1240, 920, 2230, 1095), PANEL_2, alpha=246, radius=24, outline=TEAL, width=2)
    draw.text((1285, 960), "ATOMIC SETTLEMENT", font=font(22, bold=True), fill=TEAL)
    wrapped_text(
        draw,
        (1285, 1005),
        "Action or observation + lifecycle event + terminal ledger result • exact retry replays the same outcome",
        font(20),
        INK,
        890,
        spacing=1.18,
        max_lines=3,
    )
    draw.rounded_rectangle((420, 1130, 1980, 1225), radius=23, fill=mix(BACKGROUND_TOP, GOLD, 0.14), outline=GOLD, width=2)
    draw.text((1200, 1177), "Wilbur records human reports; it neither executes an action nor independently verifies an observation.", font=font(22, bold=True), fill=INK, anchor="mm")


def render_provenance(image: Image.Image, draw: ImageDraw.ImageDraw) -> None:
    items = [
        ("Question", GOLD), ("64 facets", TEAL), ("Seed + cast", VIOLET), ("Event log", CYAN),
        ("Terminal ecology", COBALT), ("Portia judgments", CORAL), ("Gate record", GOLD),
        ("Answer", GREEN), ("Charlotte", TEAL), ("Wilbur action", VIOLET), ("Observations", CYAN),
        ("Mutation ledger", CORAL),
    ]
    points: list[tuple[int, int]] = []
    for index in range(len(items)):
        angle = -math.pi / 2 + index * 2 * math.pi / len(items)
        radius = 360
        x = round(1200 + radius * math.cos(angle))
        y = round(720 + radius * math.sin(angle))
        points.append((x, y))

    # Paint the web and connectors before the labeled nodes so no line crosses
    # node text.  Connector endpoints stop at each circle's edge.
    web_motif(draw, (1200, 720), 300, GRID)
    for start_center, end_center in zip(points, points[1:] + points[:1]):
        dx = end_center[0] - start_center[0]
        dy = end_center[1] - start_center[1]
        distance = math.hypot(dx, dy)
        ux, uy = dx / distance, dy / distance
        start = (start_center[0] + 72 * ux, start_center[1] + 72 * uy)
        end = (end_center[0] - 72 * ux, end_center[1] - 72 * uy)
        arrow(draw, start, end, fill=GRID, width=3, head=10)

    for (label, accent), (x, y) in zip(items, points):
        draw.ellipse((x - 66, y - 66, x + 66, y + 66), fill=hex_rgb(PANEL_2), outline=accent, width=4)
        wrapped_text(draw, (x - 56, y - 25), label, font(17, bold=True), INK, 112, spacing=1.05, max_lines=3)

    draw.ellipse((1010, 530, 1390, 910), fill=hex_rgb(BACKGROUND_TOP), outline=TEAL, width=5)
    draw.text((1200, 660), "THE WEB", font=font(46, bold=True, serif=True), fill=INK, anchor="mm")
    draw.text((1200, 724), "within-case genealogy", font=font(24, bold=True), fill=TEAL, anchor="mm")
    draw.text((1200, 775), "owner scope • versions • digests", font=font(18), fill=MUTED, anchor="mm")
    draw.text((1200, 813), "lifecycle events + mutation outcomes", font=font(18), fill=MUTED, anchor="mm")
    draw.text((MARGIN, 1190), "Implemented: one case remembers its ancestry. Not implemented: consented cross-case learning that turns many cases into precedent.", font=font(24, bold=True), fill=GOLD)


def render_runtime_topologies(image: Image.Image, draw: ImageDraw.ImageDraw) -> None:
    columns = [
        ("LOCAL OPENCLAW PLUGIN", "RELEASED v2.1.0", TEAL, [
            "openclaw webchess foreground launch", "Next.js bound to 127.0.0.1", "operator-supplied dedicated loopback PostgreSQL",
            "installation-scoped principal", "openclaw infer model run --local", "provider boundary owned by OpenClaw",
        ]),
        ("HOSTED SERVICE DESIGN", "COMMITTED · NOT DEPLOYED", CYAN, [
            "Next.js on independent Vercel project", "Clerk identity", "Neon PostgreSQL",
            "server-only OpenAI Responses API", "fixed gpt-5.6-sol · store:false", "production deployment not claimed",
        ]),
        ("LOCAL SOURCE CHECKOUT", "COMMITTED 2.2 CANDIDATE", VIOLET, [
            "npm run local:dev at 127.0.0.1:3005", "Docker PostgreSQL 17 at 127.0.0.1:55433", "signed local session with no Clerk, or a complete Clerk test-key pair",
            "launcher-only canonical migration path", "bounded readiness before browser open", "not tagged and not production deployment proof",
        ]),
    ]
    for index, (title, status, accent, bullets) in enumerate(columns):
        x = 110 + index * 745
        alpha_rect(image, (x, 340, x + 670, 1135), PANEL, alpha=245, radius=32, outline=accent, width=3)
        draw.text((x + 36, 395), title, font=font(25, bold=True), fill=INK)
        small_badge(draw, (x + 36, 450), status, accent)
        y = 545
        for bullet in bullets:
            draw.ellipse((x + 40, y + 9, x + 53, y + 22), fill=accent)
            y = wrapped_text(draw, (x + 72, y), bullet, font(21), MUTED, 540, spacing=1.18, max_lines=2) + 24
    draw.text((MARGIN, 1190), "The 2.2 candidate shares rules and lifecycle code across these boundaries—not identity, persistence, credentials, billing, or deployment status.", font=font(24, bold=True), fill=GOLD)


def render_evidence_ladder(image: Image.Image, draw: ImageDraw.ImageDraw) -> None:
    levels = [
        ("RELEASED", "Tagged v2.1.0 remains the last published release", TEAL),
        ("CANDIDATE", "WebChess 2.2.0 at 7a3749c • committed • not tagged", CYAN),
        ("DEPLOYMENT", "No Preview or Production deployment proof is claimed", VIOLET),
        ("UNIT + DB", "Unit: 82 files / 1,177 • PostgreSQL: 9 files / 61", GOLD),
        ("COVERAGE", "Combined: 91 files / 1,238 • 84.66 / 80.76 / 88.51 / 85.78%", COBALT),
        ("BROWSER", "145 pass + 6 expected Clerk skips • a11y 32/32 • audits zero", CORAL),
    ]
    for index, (label, body, accent) in enumerate(levels):
        y = 335 + index * 138
        left = 220 + index * 85
        right = 2180 - index * 85
        draw.polygon(((left, y), (right, y), (right - 65, y + 105), (left + 65, y + 105)), fill=hex_rgb(PANEL), outline=accent)
        draw.text((left + 45, y + 31), label, font=font(25, bold=True), fill=accent)
        draw.text((left + 315, y + 31), body, font=font(20), fill=INK)
    draw.text((MARGIN, 1193), "Counts name separate gates; the combined coverage run overlaps the unit and PostgreSQL rows. Passing gates is not deployment or effectiveness proof.", font=font(23, bold=True), fill=GOLD)


def bar(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], value: int, max_value: int, color: str, label: str) -> None:
    x0, y0, x1, y1 = box
    draw.rounded_rectangle(box, radius=(y1 - y0) // 2, fill=hex_rgb(PANEL_2), outline=GRID, width=2)
    fill_x = x0 + round((x1 - x0) * value / max_value)
    draw.rounded_rectangle((x0, y0, fill_x, y1), radius=(y1 - y0) // 2, fill=color)
    draw.text((x0 - 24, (y0 + y1) // 2), label, font=font(22, bold=True), fill=INK, anchor="rm")
    draw.text((fill_x + 18, (y0 + y1) // 2), f"{value:,}", font=font(22, bold=True), fill=color, anchor="lm")


def render_perft(image: Image.Image, draw: ImageDraw.ImageDraw) -> None:
    draw.text((MARGIN, 325), "Canonical leaf counts reproduced by the current perft regression suite", font=font(27, bold=True), fill=CYAN)
    max_value = 400
    groups = [
        ("INITIAL POSITION", [("depth 1", 20), ("depth 2", 400)], TEAL),
        ("BISHOP ACROSS SEAM", [("depth 1", 13), ("depth 2", 65)], VIOLET),
        ("ROOK AROUND SEAM", [("depth 1", 12), ("depth 2", 60)], GOLD),
    ]
    y = 430
    for title, values, accent in groups:
        draw.text((310, y), title, font=font(22, bold=True), fill=accent)
        for label, value in values:
            y += 65
            bar(draw, (520, y, 1930, y + 40), value, max_value, accent, label)
        y += 105
    alpha_rect(image, (250, 1100, 2150, 1235), PANEL, alpha=245, radius=25, outline=CYAN, width=2)
    draw.text((1200, 1138), "Variant boundary checks", font=font(23, bold=True), fill=CYAN, anchor="mm")
    draw.text((1200, 1185), "forced pass counts as one ply  •  action 256 is legal  •  a King capture outranks the move-limit draw", font=font(21), fill=INK, anchor="mm")


def render_arena(image: Image.Image, draw: ImageDraw.ImageDraw) -> None:
    alpha_rect(image, (130, 350, 1510, 1120), PANEL, alpha=245, radius=34, outline=CYAN, width=3)
    draw.text((220, 420), "PAIRED-COLOR REGRESSION ARENA", font=font(27, bold=True), fill=CYAN)
    draw.text((220, 475), "Engine V2 depth 3  vs  legacy-greedy-v1", font=font(30, bold=True, serif=True), fill=INK)
    details = [
        ("OPENING SEEDS", "clarity · tempo · risk"),
        ("OPENING LENGTH", "6 legal plies"),
        ("LEGS", "6 total · candidate plays both colors"),
        ("RESULT", "W–D–L  6–0–0"),
        ("POINTS", "6.0 / 6.0"),
    ]
    y = 575
    for label, value in details:
        draw.text((220, y), label, font=font(20, bold=True), fill=MUTED)
        draw.text((590, y), value, font=font(24, bold=True), fill=INK)
        y += 92
    # Six outcome chips make the paired design visually explicit.
    for index in range(6):
        x = 1665 + (index % 3) * 185
        y = 490 + (index // 3) * 220
        draw.ellipse((x, y, x + 130, y + 130), fill=hex_rgb(TEAL), outline=INK, width=3)
        draw.text((x + 65, y + 64), "W", font=font(50, bold=True, serif=True), fill=BACKGROUND_TOP, anchor="mm")
        draw.text((x + 65, y + 160), f"leg {index + 1}", font=font(18, bold=True), fill=MUTED, anchor="mm")
    draw.rounded_rectangle((1610, 960, 2240, 1120), radius=26, fill=mix(BACKGROUND_TOP, GOLD, 0.22), outline=GOLD, width=2)
    wrapped_text(draw, (1650, 990), "Strength-regression evidence only. Not Elo. Not reasoning quality. Not decision benefit.", font(24, bold=True), INK, 550, spacing=1.2, max_lines=4)
    draw.text((MARGIN, 1190), "The result is deterministic for the pinned corpus and policies; it does not establish general superiority.", font=font(24, bold=True), fill=GOLD)


def render_evaluation(image: Image.Image, draw: ImageDraw.ImageDraw) -> None:
    arms = [
        ("A", "DIRECT ANSWER", "single-pass model", CORAL),
        ("B", "SELF-REFINE", "draft → critique → revision", GOLD),
        ("C", "CAPTURE TRAIL", "earlier WebChess pipeline", CYAN),
        ("D", "FULL LIFECYCLE", "Anansi → Web", TEAL),
        ("E", "ABLATIONS", "remove one authority at a time", VIOLET),
    ]
    for index, (letter, title, body, accent) in enumerate(arms):
        x = 110 + index * 440
        alpha_rect(image, (x, 350, x + 390, 610), PANEL, alpha=245, radius=28, outline=accent, width=3)
        draw.text((x + 45, 395), letter, font=font(44, bold=True, serif=True), fill=accent)
        draw.text((x + 45, 470), title, font=font(22, bold=True), fill=INK)
        draw.text((x + 45, 525), body, font=font(19), fill=MUTED)
        arrow(draw, (x + 195, 610), (x + 195, 710), fill=accent, width=4, head=13)
    draw.rounded_rectangle((200, 720, 2200, 830), radius=28, fill=hex_rgb(PANEL_2), outline=CYAN, width=3)
    draw.text((1200, 775), "Matched tasks • equalized cost/time where possible • randomized assignment • blinded review", font=font(28, bold=True), fill=INK, anchor="mm")
    metrics = ["problem coverage", "unsupported claims", "Portia precision / recall", "Gate calibration", "actionability", "downstream learning", "latency + tokens + cost", "harms + refusal quality"]
    for index, metric in enumerate(metrics):
        col, row = index % 4, index // 4
        x = 220 + col * 500
        y = 910 + row * 105
        small_badge(draw, (x, y), metric.upper(), [TEAL, CYAN, VIOLET, GOLD][col])
    draw.text((MARGIN, 1195), "No outcome bars appear here because this is a study design, not a completed effectiveness result.", font=font(25, bold=True), fill=GOLD)


def render_metaphor_breaks(image: Image.Image, draw: ImageDraw.ImageDraw) -> None:
    stages = [
        ("Anansi", "plural construction", "not ownership of Akan tradition", GOLD),
        ("Chess", "bounded conflict", "not a truth oracle", COBALT),
        ("Portia", "adversarial testing", "not biological endorsement", CORAL),
        ("Gate", "authority to refuse", "not calibrated certainty", CYAN),
        ("Retry", "controlled recursion", "not answer shopping", VIOLET),
        ("Charlotte", "responsible language", "not benevolent propaganda", GREEN),
        ("Wilbur", "protected consequence", "not autonomous execution", WHITE_SIDE),
        ("Web", "genealogy + memory", "not truth by survival", TEAL),
    ]
    center = (1200, 720)
    web_motif(draw, center, 330, GRID)
    draw.ellipse((1050, 570, 1350, 870), fill=hex_rgb(PANEL_2), outline=GOLD, width=4)
    draw.text((1200, 670), "METAPHOR", font=font(35, bold=True, serif=True), fill=INK, anchor="mm")
    draw.text((1200, 724), "makes a boundary", font=font(21, bold=True), fill=GOLD, anchor="mm")
    draw.text((1200, 772), "memorable", font=font(21), fill=MUTED, anchor="mm")
    for index, (name, function, break_point, accent) in enumerate(stages):
        angle = -math.pi / 2 + index * math.pi / 4
        x = round(center[0] + 520 * math.cos(angle))
        y = round(center[1] + 360 * math.sin(angle))
        alpha_rect(image, (x - 215, y - 90, x + 215, y + 90), PANEL, alpha=246, radius=24, outline=accent, width=3)
        draw.text((x, y - 45), name, font=font(25, bold=True, serif=True), fill=accent, anchor="mm")
        draw.text((x, y - 5), function, font=font(19, bold=True), fill=INK, anchor="mm")
        draw.text((x, y + 39), break_point, font=font(16), fill=MUTED, anchor="mm")
        end = (center[0] + 345 * math.cos(angle), center[1] + 345 * math.sin(angle))
        dashed_line(draw, end, (x, y), fill=accent, width=2, dash=11, gap=10)
    draw.text((MARGIN, 1195), "The names aid comprehension. Typed contracts, failure states, provenance, and experiments create the architecture.", font=font(25, bold=True), fill=GOLD)


def render_formula_flow(image: Image.Image, draw: ImageDraw.ImageDraw) -> None:
    formulas = [
        ("F = Division(q) = {f₁ … f₆₄}", "Anansi field", TEAL),
        ("B₀ = πB(pair(πF(F), πH(H)))", "independent cast", VIOLET),
        ("Game(B₀,r,m,s) → (Bᵀ,L,C,O)", "terminal play", CYAN),
        ("S = Survivors(Bᵀ,L,C,O)", "candidate ecology", COBALT),
        ("X = PromptPackage(q,S,L,C,O,Rₑ)", "exact reviewed prompt package", CYAN),
        ("J = Portia(S,X,digest(X))", "adversarial judgments", CORAL),
        ("D = Gate(J,counters)", "hard-floor decision", GOLD),
        ("A* = Answer(X,J,D)", "distinct generated artifact", CYAN),
        ("K = Charlotte(A*,digest(A*),J,D)", "qualification + exactly 3 suggestions", GREEN),
        ("(a,o) = WilburRecord(K,player)", "human-authored consequence record", VIOLET),
        ("W = Record(q,F,B₀,L,S,X,J,D,A*,K,a,o)", "within-case provenance", TEAL),
    ]
    # Four cards across the first two rows and three on the last row preserve a
    # readable serpentine flow while keeping Answer visibly independent from
    # both Gate and Charlotte.
    coordinates = [
        (0, 0), (1, 0), (2, 0), (3, 0),
        (3, 1), (2, 1), (1, 1), (0, 1),
        (0, 2), (1, 2), (2, 2),
    ]
    cells = [(110 + col * 570, 325 + row * 278, col, row) for col, row in coordinates]
    for current, following in zip(cells, cells[1:]):
        x, y, col, row = current
        nx, ny, next_col, next_row = following
        if row == next_row and next_col > col:
            arrow(draw, (x + 500, y + 104), (nx, ny + 104), fill=GRID, width=4, head=11)
        elif row == next_row:
            arrow(draw, (x, y + 104), (nx + 500, ny + 104), fill=GRID, width=4, head=11)
        else:
            arrow(draw, (x + 250, y + 208), (nx + 250, ny), fill=GRID, width=4, head=11)
    for index, (formula, label, accent) in enumerate(formulas):
        x, y, _col, _row = cells[index]
        alpha_rect(image, (x, y, x + 500, y + 208), PANEL, alpha=246, radius=24, outline=accent, width=2)
        wrapped_text(draw, (x + 26, y + 32), formula, font(17, bold=True, mono=True), INK, 448, spacing=1.16, max_lines=3)
        wrapped_text(draw, (x + 26, y + 145), label, font(16, bold=True), accent, 448, spacing=1.08, max_lines=2)
    draw.text((MARGIN, 1190), "Symbols describe interfaces and provenance. They do not claim that implementation alone validates the method.", font=font(25, bold=True), fill=GOLD)


def render_schema_web(image: Image.Image, draw: ImageDraw.ImageDraw) -> None:
    groups = [
        ("GOVERNANCE", ["webchess_schema_migrations", "deleted_user_tombstones", "user_controls"], GOLD),
        ("PLAY + LIMITS", ["games", "game_events", "game_start_requests", "usage_buckets", "rate_buckets", "model_concurrency_slots"], CYAN),
        ("LIFECYCLE CORE", ["lifecycle_runs", "portia_reviews", "gate_decisions", "charlotte_results"], TEAL),
        ("HUMAN + WEB", ["wilbur_actions", "wilbur_observations", "lifecycle_events", "wilbur_mutation_requests"], VIOLET),
        ("MODEL + RESEARCH", ["model_requests", "research_requests", "research_sources"], CORAL),
    ]
    boxes: list[tuple[int, int, int, int]] = []
    for index, (title, tables, accent) in enumerate(groups):
        x0 = 100 + index * 445
        box = (x0, 335, x0 + 405, 1085)
        boxes.append(box)
        alpha_rect(image, box, PANEL, alpha=246, radius=28, outline=accent, width=3)
        draw.text((x0 + 28, 385), title, font=font(22, bold=True), fill=accent)
        y = 470
        for table in tables:
            draw.ellipse((x0 + 28, y + 7, x0 + 42, y + 21), fill=accent)
            wrapped_text(draw, (x0 + 58, y), table, font(20, bold=True, mono=True), INK, 315, spacing=1.12, max_lines=2)
            y += 94
    for left, right in zip(boxes, boxes[1:]):
        dashed_line(draw, (left[2] + 6, 710), (right[0] - 6, 710), fill=GRID, width=4, dash=12, gap=9)
    draw.text((1200, 1135), "13 ordered migrations • 19 application tables + 1 migration ledger = 20 physical tables", font=font(28, bold=True, serif=True), fill=GOLD, anchor="mm")
    draw.text((1200, 1190), "Contract: 8 critical keys/indexes • 2 guarded trigger/function pairs • 18 constraints • 5 defaults", font=font(21, bold=True), fill=TEAL, anchor="mm")
    draw.text((1200, 1230), "Ownership checks supplement the catalog; provenance does not turn stored claims into truth.", font=font(18), fill=MUTED, anchor="mm")


def render_recovery_transactions(image: Image.Image, draw: ImageDraw.ImageDraw) -> None:
    steps = [
        ("Authenticated intent", "key + expected revision", CYAN),
        ("TX 1: reserve", "owner • deletion • rate • quota • lease", TEAL),
        ("Bounded provider call", "no database transaction held open", GOLD),
        ("TX 2: settle", "usage • result or safe failure • release", TEAL),
        ("Durable response", "public result or explicit pending/failure", CYAN),
    ]
    boxes = []
    for index, (title, body, accent) in enumerate(steps):
        center = (255 + index * 470, 565)
        box = node(image, draw, center, (390, 245), title, body, accent=accent, title_size=24, body_size=20)
        boxes.append(box)
    for left, right in zip(boxes, boxes[1:]):
        arrow(draw, (left[2], 565), (right[0], 565), fill=GRID, width=5, head=14)

    states = [
        ("Before provider start", "expired reservation → failed + refund", TEAL),
        ("After provider start", "ambiguous expiry → indeterminate; no silent replay", CORAL),
        ("Validated payload saved", "recover and attach under the current fence", CYAN),
        ("Browser refresh", "reconstruct from canonical events", VIOLET),
    ]
    for index, (title, body, accent) in enumerate(states):
        x0 = 140 + index * 560
        alpha_rect(image, (x0, 820, x0 + 500, 1075), PANEL_2, alpha=245, radius=24, outline=accent, width=2)
        draw.text((x0 + 28, 865), title, font=font(23, bold=True), fill=accent)
        wrapped_text(draw, (x0 + 28, 920), body, font(20), INK, 444, spacing=1.2, max_lines=4)
    draw.text((MARGIN, 1165), "Recovery protects intents, transactions, and lifecycle attachments. It is not database backup or disaster recovery.", font=font(26, bold=True), fill=GOLD)


def render_deletion_boundary(image: Image.Image, draw: ImageDraw.ImageDraw) -> None:
    self_delete = node(image, draw, (220, 470), (340, 170), "Self-delete", "authenticated request", accent=CYAN, title_size=23, body_size=18)
    active = node(image, draw, (635, 470), (340, 170), "Active work?", "provider call genuinely in progress", accent=GOLD, title_size=23, body_size=18)
    stop = node(image, draw, (1060, 365), (340, 160), "409 · no loss", "transaction preserves mature provenance", accent=CORAL, title_size=23, body_size=18)
    self_cleanup = node(image, draw, (1060, 585), (340, 170), "Self cleanup", "delete games first • refund reservations", accent=TEAL, title_size=23, body_size=18)
    pending = node(image, draw, (1490, 585), (340, 170), "Pending identity", "retain suspended raw Clerk ID", accent=VIOLET, title_size=23, body_size=18)
    webhook = node(image, draw, (1490, 365), (340, 160), "Signed user.deleted", "independent force authority", accent=CYAN, title_size=22, body_size=18)
    force_cleanup = node(image, draw, (1950, 470), (390, 180), "Forced transaction", "delete games; barrier before request ledger + raw ID", accent=GREEN, title_size=23, body_size=18)

    arrow(draw, (self_delete[2], 470), (active[0], 470), fill=GRID, width=5, head=14)
    arrow(draw, (active[2], 440), (stop[0], 385), fill=CORAL, width=5, head=14)
    draw.text((850, 372), "YES", font=font(18, bold=True), fill=CORAL)
    arrow(draw, (active[2], 500), (self_cleanup[0], 565), fill=TEAL, width=5, head=14)
    draw.text((850, 550), "NO", font=font(18, bold=True), fill=TEAL)
    arrow(draw, (self_cleanup[2], 585), (pending[0], 585), fill=TEAL, width=5, head=14)
    arrow(draw, (webhook[2], 385), (force_cleanup[0], 440), fill=GREEN, width=5, head=14)

    alpha_rect(image, (120, 765, 2280, 1095), PANEL, alpha=248, radius=32, outline=GREEN, width=4)
    draw.text((180, 815), "FOREIGN-KEY-SAFE ORDER · VERIFIED WITH MATURE PORTIA + CHARLOTTE PROVENANCE", font=font(25, bold=True), fill=GREEN)
    safe_steps = [
        ("1. shared lock + expire stale leases", 150),
        ("2. delete games first", 690),
        ("3. cascades clear lifecycle artifacts", 1230),
        ("4. delete request, usage + rate rows", 1770),
    ]
    for index, (label, x) in enumerate(safe_steps):
        draw.rounded_rectangle((x, 900, x + 470, 1005), radius=22, fill=hex_rgb(PANEL), outline=GREEN, width=2)
        wrapped_text(draw, (x + 22, 925), label, font(18, bold=True), INK, 426, spacing=1.15, max_lines=2)
        if index < len(safe_steps) - 1:
            arrow(draw, (x + 470, 952), (safe_steps[index + 1][1], 952), fill=GREEN, width=4, head=12)
    draw.text((1200, 1148), "Under the shared lock, the force path establishes its HMAC barrier before request-ledger and raw-identity deletion.", font=font(23, bold=True, serif=True), fill=GOLD, anchor="mm")
    draw.text((1200, 1200), "Self-delete, force-delete, idempotent retry, mature artifacts, and reservation refunds are integration-tested.", font=font(21, bold=True), fill=GREEN, anchor="mm")


FIGURES: tuple[Figure, ...] = (
    Figure(1, "first-frame", "The first frame should not become a monopoly", "CONCEPTUAL BOUNDARY",
           "A forked flow contrasts a one-pass path from ambiguous question to first frame and fluent answer with the Arachne Method path through structured plurality, conflict, examination, and qualified action.",
           "The Arachne Method delays premature closure by separating problem construction from selection, examination, qualification, and consequence. This is the architecture's thesis, not a measured effectiveness claim.",
           ("docs/WEBCHESS_WHITE_PAPER_V3.md §1",), render_first_frame),
    Figure(2, "authority-crosswalk", "Eight authorities, seven visible stops, one Answer artifact", "VERIFIED IMPLEMENTATION",
           "Two horizontal rails compare the eight formal Arachne authorities with the seven player-facing lifecycle stops, showing Gate and Retry as internal authorities and Answer as a generated artifact.",
           "The architecture counts Anansi, Chess, Portia, Gate, Retry, Charlotte, Wilbur, and the Web. The interface instead shows Anansi, Chess, Portia, Answer, Charlotte, Wilbur, and Web; Answer is not a ninth authority.",
           ("src/lib/lifecycle/contracts.ts", "src/components/LifecycleRail.tsx"), render_stage_crosswalk),
    Figure(3, "facet-matrix", "Anansi's 8 × 8 field: sixty-four bounded facets", "VERIFIED IMPLEMENTATION",
           "An eight-by-eight matrix crosses Purpose, People, Resources, Timing, Risks, Values, Evidence, and Possibilities with Begin, Receive, Clarify, Connect, Challenge, Adapt, Consolidate, and Release.",
           "Every facet occupies one practical-dimension by change-movement coordinate. Structural coverage constrains generation but does not prove completeness or correctness.",
           ("src/lib/problem.ts", "src/lib/division.ts"), render_facet_matrix),
    Figure(4, "three-shuffle-cast", "One seed, three independent deterministic shuffles", "VERIFIED IMPLEMENTATION",
           "A saved seed fans into separate facet, lens, and board permutations before producing the initial semantic board.",
           "The cast independently permutes facets, I Ching-inspired lenses, and completed pairs onto board locations. It is reproducible recombination, not semantic inference or evidence.",
           ("src/lib/problem.ts", "src/server/http/services.ts"), render_cast),
    Figure(5, "polar-topology", "The board as P₈ □ C₈: bounded rings, cyclic sectors", "VERIFIED IMPLEMENTATION",
           "An eight-ring radial board is paired with the notation P8 Cartesian-product C8, explaining bounded ring positions, cyclic sector positions, and sixty-four cells.",
           "WebChess coordinates form eight bounded ring positions crossed with eight wrapping sector positions. The notation describes cell topology; piece rules still define legal movement.",
           ("src/lib/game.ts", "src/lib/engine/position.ts"), render_topology),
    Figure(6, "initial-board-polarities", "Initial position and the two nonmoral polarities", "VERIFIED IMPLEMENTATION",
           "A radial chess board shows Black back pieces and pawns at the center moving outward and White pieces and pawns at the edge moving inward.",
           "Black represents inside-out intent from rings zero and one. White represents outside-in evidence from rings seven and six and moves first. The colors are directional, not moral.",
           ("src/lib/game.ts:createInitialPieces",), render_initial_board),
    Figure(7, "piece-metaphors", "Six movement roles, six metaphors of attention", "VERIFIED IMPLEMENTATION",
           "Six cards map King, Queen, Rook, Bishop, Knight, and Pawn to core purpose, agency, structure, perspective, reframing, and practice, while summarizing their implemented movement.",
           "Piece metaphors translate chess roles into modes of attention. They organize inquiry without assigning truth or stakeholder worth.",
           ("src/lib/reading.ts:PIECE_METAPHORS", "src/lib/engine/movegen.ts"), render_piece_metaphors),
    Figure(8, "attention-and-value-scales", "Attention is a display score—not an epistemology", "CONCEPTUAL BOUNDARY",
           "The implemented capture-attention equation appears above four separated scales: piece value, engine evaluation, capture attention, and evidence or human value.",
           "The capture score combines a constant, piece values, and a middle-ring meeting bonus. It must not be promoted into probability, evidence quality, moral importance, or decision benefit.",
           ("src/lib/game.ts:captureAttentionWeight", "src/lib/engine/evaluate.ts"), render_value_scales),
    Figure(9, "pvs-search-web", "Engine V2: a principal-variation search web", "VERIFIED IMPLEMENTATION",
           "A branching search tree highlights one principal variation and defines PVS, TT, SEE, and quiescence alongside the deterministic node budget.",
           "Engine V2 uses iterative principal-variation alpha-beta search, aspiration windows, a transposition table, quiescence, static exchange evaluation, and a seeded root tie-break. It has no semantic access.",
           ("src/lib/engine/index.ts", "src/lib/engine/search.ts", "src/lib/engine/evaluate.ts"), render_pvs),
    Figure(10, "terminal-precedence", "Terminal precedence: the decisive condition wins first", "VERIFIED IMPLEMENTATION",
           "A five-step vertical decision order checks King capture, mutual immobility, one hundred quiet plies, two hundred fifty-six completed plies, then continuation or forced pass.",
           "A direct King capture is evaluated before draw boundaries. This makes a capture on ply 256 a win rather than a move-limit draw.",
           ("src/lib/game.ts:getGameOutcome", "src/lib/game-replay.ts"), render_terminal_precedence),
    Figure(11, "authoritative-replay", "Authoritative replay: derive state, never trust it", "VERIFIED IMPLEMENTATION",
           "A small browser command passes through load, canonical rebuild, replay, resolution, and atomic compare-and-swap commit stages.",
           "The browser proposes only a piece, destination, and expected revision. The server reconstructs and validates the authoritative game before committing derived events.",
           ("src/lib/game-replay.ts", "src/server/games/repository.ts"), render_replay),
    Figure(12, "portia-thirteen-attacks", "Portia hunts the prompt before an Answer exists", "VERIFIED IMPLEMENTATION",
           "Thirteen named adversarial attacks orbit a Portia center, with preserved, wounded, consumed, and unresolved dispositions below.",
           "Every terminal candidate is tested exactly once against thirteen versioned attack types. Portia reviews the exact forthcoming Answer prompt before generation.",
           ("src/lib/lifecycle/contracts.ts:PORTIA_ATTACK_TYPES", "src/server/openai/portia.ts"), render_portia),
    Figure(13, "gate-conjunction", "The Gate is a conjunction, not an oracle", "VERIFIED IMPLEMENTATION",
           "Seven requirement cards converge on an AND gate that authorizes Answer only when every hard floor passes.",
           "webchess-gate-v4 requires Portia permission, minimum usable and independent candidates, required coverage, explicit tension, contradiction safety, and qualification integrity.",
           ("src/lib/lifecycle/gate.ts", "src/lib/lifecycle/versions.ts"), render_gate),
    Figure(14, "bounded-retry", "Retry is a finite tree, not an infinite reroll", "VERIFIED IMPLEMENTATION",
           "A failed Gate can spend at most two root-wide same-field replay allowances and one field-regeneration allowance, in policy-selected order, before an explicit insufficient-basis stop.",
           "Two root-wide replay children plus one regenerated-field child cap a genealogy at four games. The policy chooses their order; duplicate fingerprints favor regeneration.",
           ("src/lib/lifecycle/retry.ts",), render_retry),
    Figure(15, "answer-charlotte-wilbur", "Answer → Charlotte → durable Wilbur", "VERIFIED IMPLEMENTATION",
           "Four cards flow from approved prompt to stored Answer, Charlotte qualification with exactly three suggestions, and a durable Wilbur mutation boundary with once-only rate admission, lifetime capacity reservation, atomic settlement, and exact replay.",
           "Gate-approved Answer is stored, then Charlotte qualifies it. Every Wilbur create, update, or observation is owner-, idempotency-key-, and digest-bound; admission uses database time, and the artifact, lifecycle event, and ledger result settle atomically. Wilbur executes and independently verifies neither.",
           ("src/server/openai/answer.ts", "src/server/openai/charlotte.ts", "src/server/lifecycle/repository.ts", "src/server/usage/queries.ts", "db/migrations/0012_unique_wilbur_charlotte_actions.sql", "db/migrations/0013_wilbur_mutation_requests.sql"), render_answer_charlotte_wilbur),
    Figure(16, "provenance-web", "The Web remembers—including failure", "VERIFIED IMPLEMENTATION",
           "A circular provenance graph connects question, facets, cast, event log, terminal ecology, Portia, Gate, Answer, Charlotte, Wilbur action, observations, and the durable mutation ledger around a central Web.",
           "The implemented Web is within-case provenance with owner scope, versions, digests, append-only lifecycle events, and terminal Wilbur mutation outcomes. Consented cross-case learning is not implemented.",
           ("src/server/lifecycle/repository.ts", "src/server/games/repository.ts", "db/migrations/0013_wilbur_mutation_requests.sql"), render_provenance),
    Figure(17, "runtime-topologies", "Three audited runtime boundaries", "VERIFIED IMPLEMENTATION",
           "Three columns distinguish the tagged v2.1.0 OpenClaw release line, the committed but undeployed hosted-service architecture, and the working local source-checkout topology in the committed WebChess 2.2.0 candidate.",
           "The local checkout now supports either a signed no-Clerk session or a complete Clerk development-key pair, validates its loopback PostgreSQL boundary, applies exact-prefix canonical migrations only under launcher authority, and waits for readiness before opening the browser. The candidate is not tagged, and no hosted deployment is claimed.",
           ("docs/ARCHITECTURE.md", "scripts/local-hosted.mjs", "openclaw-plugin/src/launcher.ts"), render_runtime_topologies),
    Figure(18, "evidence-ladder", "Evidence labels prevent architectural time travel", "CONCEPTUAL BOUNDARY",
           "A six-level tapered ledger separates the tagged v2.1.0 release, committed WebChess 2.2.0 candidate at 7a3749c, absent deployment proof, unit and PostgreSQL tests, combined coverage, and browser, accessibility, and audit gates.",
           "The immutable candidate passed 82 unit files with 1,177 tests, 9 PostgreSQL files with 61 tests, a combined 91-file/1,238-test coverage run at 84.66% statements, 80.76% branches, 88.51% functions, and 85.78% lines, plus 145 Playwright tests, 6 expected Clerk skips, 32 accessibility checks, and zero dependency-audit findings. These overlapping gates are not additive and are not deployment or effectiveness proof.",
           ("docs/WEBCHESS_WHITE_PAPER_V3.md:How to read implementation claims",), render_evidence_ladder),
    Figure(19, "measured-perft", "Perft: measured rule-space fingerprints", "MEASURED AUDIT",
           "Horizontal bars show exact perft leaf counts for the initial position, a bishop crossing the sector seam, and a rook circling the seam at depths one and two.",
           "The audit reproduced canonical perft counts: initial 20 and 400; bishop seam 13 and 65; rook seam 12 and 60. These validate bounded rule behavior, not playing strength.",
           ("src/lib/engine/perft.test.ts", "src/test/engine-fixtures.ts"), render_perft),
    Figure(20, "measured-arena", "Arena: a bounded strength-regression result", "MEASURED AUDIT",
           "A paired-color arena card reports Engine V2 depth three against legacy-greedy-v1 across three seeded openings, with six win tokens and a six-zero-zero record.",
           "The current deterministic arena produced W-D-L 6-0-0 over six paired-color legs. This is regression evidence against a pinned baseline, not Elo or evidence of reasoning benefit.",
           ("src/lib/engine/strength.test.ts", "src/test/engine-arena.ts"), render_arena),
    Figure(21, "proposed-evaluation", "How the architecture should be tested", "PROPOSED EVALUATION",
           "Five experimental arms—direct answer, self-refine, capture trail, full lifecycle, and ablations—flow into matched tasks and blinded evaluation metrics.",
           "A credible evaluation compares the full lifecycle with strong baselines and ablations while measuring quality, calibration, downstream learning, cost, latency, harms, and refusal.",
           ("docs/WEBCHESS_WHITE_PAPER_V3.md §18",), render_evaluation),
    Figure(22, "metaphor-breakpoints", "Eight metaphors—and the point where each must break", "CONCEPTUAL BOUNDARY",
           "Eight cards around a web pair each Arachne authority with its functional metaphor and a warning against overextending the analogy.",
           "Metaphors make authority boundaries memorable. Typed contracts, failure states, provenance, and evaluation—not mythological resonance—make the method accountable.",
           ("docs/WEBCHESS_WHITE_PAPER_V3.md §§3, 16",), render_metaphor_breaks),
    Figure(23, "formal-model", "Formal model: a provenance-preserving flow", "CONCEPTUAL BOUNDARY",
           "Eleven equation cards trace the field, cast, game, survivors, exact prompt package, Portia, Gate, the distinct Answer artifact, Charlotte, the human-authored Wilbur record, and the within-case Web.",
           "The notation matches the paper's formal chain and keeps Prompt Package, Answer, Charlotte qualification, Wilbur's player-authored report, and the provenance Web distinct. The equations imply neither autonomous execution, independent verification, nor a proven world-state transition; Figure 8 separately shows the implemented Wilbur durability controls.",
           ("docs/WEBCHESS_WHITE_PAPER_V3.md §12.2", "src/server/openai/answer.ts", "src/server/openai/charlotte.ts", "src/server/lifecycle/repository.ts"), render_formula_flow),
    Figure(24, "schema-web", "The durable Web: twenty physical tables", "VERIFIED IMPLEMENTATION",
           "Five linked panels enumerate the migration ledger and all nineteen application tables across governance, play and limits, lifecycle, human records and mutation claims, and model research boundaries.",
           "Thirteen ordered migrations define nineteen application tables plus the migration ledger, twenty physical tables total. The release contract also verifies eight critical unique or primary-key indexes, two exact guarded trigger/function pairs, eighteen critical constraints, and five defaults.",
           ("db/migrations/0001_durable_webchess.sql", "db/migrations/0002_webchess_2_lifecycle.sql", "db/migrations/0008_visible_research_broker.sql", "db/migrations/0012_unique_wilbur_charlotte_actions.sql", "db/migrations/0013_wilbur_mutation_requests.sql", "scripts/deployment-database.mjs"), render_schema_web),
    Figure(25, "recovery-transactions", "Two short transactions around remote inference", "VERIFIED IMPLEMENTATION",
           "An authenticated intent passes through a reservation transaction, bounded provider call, settlement transaction, and durable response, with four interruption outcomes below.",
           "WebChess commits before inference and settles afterward. Ambiguous provider-started work becomes indeterminate; there is no silent replay. This is application recovery, not backup.",
           ("src/server/usage/queries.ts", "src/server/http/service-adapter.ts", "src/server/lifecycle/repository.ts"), render_recovery_transactions),
    Figure(26, "deletion-boundary", "Deletion boundary: verified, ordered, atomic", "VERIFIED IMPLEMENTATION",
           "Two independent entries are shown: self-deletion branches to a 409 no-loss stop while provider work is in progress or to content cleanup and a suspended identity marker; the signed user-deleted webhook enters the force path directly.",
           "Both paths use the foreign-key-safe game-first order under the shared lock. On the force path, game cascades occur first; under that same lock, the lifetime HMAC barrier is then established before request-ledger and raw-identity deletion, and all changes commit atomically. Mature artifacts, force, retries, and refunds are integration-tested.",
           ("src/server/usage/service.ts:deleteAccountData", "src/server/usage/queries.ts:deleteAccountGamesSql", "src/server/usage/queries.ts:deleteAccountDataSql", "tests/integration/usage.integration.ts"), render_deletion_boundary),
)


def generate(selected_numbers: set[int] | None = None) -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    expected = {figure.filename for figure in FIGURES}
    # Remove only old generator-owned JPEGs; leave hand-created assets untouched.
    if selected_numbers is None:
        for path in OUTPUT_DIR.glob("[0-9][0-9]-*.jpg"):
            if path.name not in expected:
                path.unlink()

    manifest_figures = []
    for figure in FIGURES:
        display_label = DISPLAY_LABEL_BY_ASSET[figure.number]
        if selected_numbers is None or figure.number in selected_numbers:
            image, draw = base_canvas(display_label, figure.title, figure.caption, figure.evidence)
            figure.renderer(image, draw)
            finish(image, draw, figure.filename)
            target = OUTPUT_DIR / figure.filename
            image.convert("RGB").save(target, "JPEG", quality=93, subsampling=0, optimize=True, progressive=True)
        manifest_figures.append({
            "id": f"figure-{figure.number:02d}",
            "display_label": display_label,
            "file": figure.filename,
            "title": figure.title,
            "evidence_label": figure.evidence,
            "alt_text": figure.alt_text,
            "caption": figure.caption,
            "source_refs": list(figure.source_refs),
            "width": WIDTH,
            "height": HEIGHT,
            "mime_type": "image/jpeg",
        })

    manifest = {
        "schema_version": 1,
        "paper": "The First Answer Is Not Enough: An Architecture for AI-Assisted Deliberation Before Decision",
        "software_examined": "WebChess 2.2.0 release candidate at 7a3749cf7f2c4e4c5ebfeb9b9aa870a11843f3a2 (committed; not tagged; not deployment proof)",
        "generator": "scripts/generate-white-paper-v3-figures.py",
        "deterministic": True,
        "fact_boundary": "No figure reports effectiveness data. Measured figures are limited to current perft and pinned engine-arena regression results.",
        "figures": manifest_figures,
    }
    (OUTPUT_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    rendered = len(FIGURES) if selected_numbers is None else len(selected_numbers)
    print(f"Generated {rendered} figure(s) and manifest at {OUTPUT_DIR}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--only", type=int, nargs="+", metavar="FIGURE", help="regenerate only the listed figure numbers; always refresh the manifest")
    args = parser.parse_args()
    chosen = set(args.only) if args.only else None
    known = {figure.number for figure in FIGURES}
    if chosen is not None and not chosen <= known:
        parser.error(f"unknown figure number(s): {sorted(chosen - known)}")
    generate(chosen)
