"""Server-side chart rendering for the PDF report, plus reportlab font
registration. Charts are drawn with matplotlib (Agg) and returned as PNG bytes;
the palette mirrors the web app for visual parity."""
import io
import os

import matplotlib
matplotlib.use("Agg")  # headless — no display needed
import matplotlib.pyplot as plt
from matplotlib.ticker import FuncFormatter

# Hex approximations of the app's oklch CHART_PALETTE / theme colours.
PALETTE = ["#10b981", "#6366f1", "#f59e0b", "#ef4444", "#a855f7", "#06b6d4", "#64748b",
           "#14b8a6", "#f43f5e", "#8b5cf6", "#0ea5e9", "#84cc16"]
POSITIVE = "#10b981"   # income / gains
NEGATIVE = "#ef4444"   # expenses / losses
INFO = "#6366f1"       # net line
GRID = "#e5e7eb"
TEXT = "#334155"

plt.rcParams.update({
    "font.family": "DejaVu Sans",   # ships with matplotlib; supports accents + € + U+00A0
    "font.size": 9,
    "axes.edgecolor": GRID,
    "axes.labelcolor": TEXT,
    "text.color": TEXT,
    "xtick.color": TEXT,
    "ytick.color": TEXT,
    "figure.facecolor": "white",
    "axes.facecolor": "white",
})


# ── reportlab font registration (fixes Helvetica's missing glyphs / black squares) ──

_FONTS_REGISTERED = False
REGULAR_FONT = "DejaVuSans"
BOLD_FONT = "DejaVuSans-Bold"


def register_pdf_fonts() -> tuple[str, str]:
    """Register matplotlib's bundled DejaVuSans with reportlab (idempotent).
    Returns (regular, bold) font names to use in the PDF."""
    global _FONTS_REGISTERED
    if _FONTS_REGISTERED:
        return REGULAR_FONT, BOLD_FONT
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    ttf_dir = os.path.join(matplotlib.get_data_path(), "fonts", "ttf")
    pdfmetrics.registerFont(TTFont(REGULAR_FONT, os.path.join(ttf_dir, "DejaVuSans.ttf")))
    pdfmetrics.registerFont(TTFont(BOLD_FONT, os.path.join(ttf_dir, "DejaVuSans-Bold.ttf")))
    from reportlab.lib.fonts import addMapping
    addMapping("DejaVuSans", 0, 0, REGULAR_FONT)
    addMapping("DejaVuSans", 1, 0, BOLD_FONT)
    _FONTS_REGISTERED = True
    return REGULAR_FONT, BOLD_FONT


# ── helpers ─────────────────────────────────────────────────────────────────

def _short_month(m: str) -> str:
    return f"{m[5:7]}/{m[2:4]}" if len(m) >= 7 else m


def _fig_png(fig) -> bytes:
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=150, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    return buf.getvalue()


def _money_formatter(ccy: str):
    def fmt(x, _pos):
        v = x / 100.0
        if abs(v) >= 1000:
            return f"{v/1000:.0f}k"
        return f"{v:.0f}"
    return FuncFormatter(fmt)


# ── charts (each returns PNG bytes) ───────────────────────────────────────────

def networth_area(months: list[str], totals_cents: list[int], ccy: str) -> bytes:
    fig, ax = plt.subplots(figsize=(9, 3.2))
    x = range(len(months))
    ax.fill_between(x, totals_cents, color=POSITIVE, alpha=0.18)
    ax.plot(x, totals_cents, color=POSITIVE, linewidth=2)
    ax.set_xticks(list(x))
    ax.set_xticklabels([_short_month(m) for m in months], rotation=45, ha="right", fontsize=7)
    ax.yaxis.set_major_formatter(_money_formatter(ccy))
    ax.grid(axis="y", color=GRID, linewidth=0.5)
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    ax.margins(x=0.01)
    return _fig_png(fig)


def cashflow_bars(months, income_cents, expenses_cents, net_cents, ccy: str) -> bytes:
    fig, ax = plt.subplots(figsize=(9, 3.4))
    x = list(range(len(months)))
    w = 0.4
    ax.bar([i - w / 2 for i in x], income_cents, width=w, color=POSITIVE, label="Revenus")
    ax.bar([i + w / 2 for i in x], expenses_cents, width=w, color=NEGATIVE, label="Dépenses")
    ax.plot(x, net_cents, color=INFO, linewidth=1.8, marker="o", markersize=3, label="Flux net")
    ax.axhline(0, color=GRID, linewidth=0.8)
    ax.set_xticks(x)
    ax.set_xticklabels([_short_month(m) for m in months], rotation=45, ha="right", fontsize=7)
    ax.yaxis.set_major_formatter(_money_formatter(ccy))
    ax.grid(axis="y", color=GRID, linewidth=0.5)
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    ax.legend(loc="upper left", fontsize=7, frameon=False, ncol=3)
    return _fig_png(fig)


def donut(labels: list[str], values_cents: list[int], ccy: str, colors=None) -> bytes:
    fig, ax = plt.subplots(figsize=(4.6, 3.4))
    colors = colors or [PALETTE[i % len(PALETTE)] for i in range(len(labels))]
    vals = [abs(v) for v in values_cents]
    total = sum(vals) or 1
    wedges, _ = ax.pie(vals, colors=colors, startangle=90, counterclock=False,
                       wedgeprops={"width": 0.42, "edgecolor": "white", "linewidth": 1})
    ax.set(aspect="equal")
    legend_labels = [f"{lab}  {v/total*100:.0f}%" for lab, v in zip(labels, vals)]
    ax.legend(wedges, legend_labels, loc="center left", bbox_to_anchor=(1.0, 0.5),
              fontsize=7, frameon=False)
    ax.text(0, 0, f"{total/100:,.0f}".replace(",", " ") + f"\n{ccy}",
            ha="center", va="center", fontsize=9, fontweight="bold")
    return _fig_png(fig)


def category_trends(series: list[dict], ccy: str) -> bytes:
    """series: list of {name, color?, months: [..], values_cents: [..]}."""
    fig, ax = plt.subplots(figsize=(9, 3.4))
    for i, s in enumerate(series):
        ax.plot(range(len(s["months"])), s["values_cents"], linewidth=1.6,
                color=s.get("color") or PALETTE[i % len(PALETTE)], label=s["name"], marker="o", markersize=2)
    if series:
        ax.set_xticks(range(len(series[0]["months"])))
        ax.set_xticklabels([_short_month(m) for m in series[0]["months"]], rotation=45, ha="right", fontsize=7)
    ax.yaxis.set_major_formatter(_money_formatter(ccy))
    ax.grid(axis="y", color=GRID, linewidth=0.5)
    for sp in ("top", "right"):
        ax.spines[sp].set_visible(False)
    ax.legend(loc="upper left", fontsize=7, frameon=False, ncol=3)
    return _fig_png(fig)


def dividend_stacked(months: list[str], sectors: list[dict], ccy: str) -> bytes:
    """sectors: list of {name, values_cents: [.. per month ..]}."""
    fig, ax = plt.subplots(figsize=(9, 3.2))
    x = list(range(len(months)))
    bottom = [0] * len(months)
    for i, sec in enumerate(sectors):
        vals = sec["values_cents"]
        ax.bar(x, vals, bottom=bottom, color=PALETTE[i % len(PALETTE)], label=sec["name"], width=0.7)
        bottom = [b + v for b, v in zip(bottom, vals)]
    ax.set_xticks(x)
    ax.set_xticklabels([_short_month(m) for m in months], rotation=45, ha="right", fontsize=7)
    ax.yaxis.set_major_formatter(_money_formatter(ccy))
    ax.grid(axis="y", color=GRID, linewidth=0.5)
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    if sectors:
        ax.legend(loc="upper left", fontsize=7, frameon=False, ncol=3)
    return _fig_png(fig)
