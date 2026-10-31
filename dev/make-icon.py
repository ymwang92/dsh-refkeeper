"""Generate the plugin icon (256x256 PNG) declared in package.json.

Run: python3 dev/make-icon.py
The mark is a rounded square with two quote glyphs and three shrinking lines —
readable at 32px, no fonts involved so it never depends on installed typefaces.
"""
from pathlib import Path

from PIL import Image, ImageDraw

SIZE = 256
BG = (31, 111, 235, 255)       # #1F6FEB
FG = (255, 255, 255, 255)

image = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((0, 0, SIZE - 1, SIZE - 1), radius=56, fill=BG)


def comma(cx: int, cy: int, radius: int, tail: int) -> None:
    """A quote glyph: a solid dot with a wedge tapering to the lower left."""
    draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=FG)
    draw.polygon(
        [
            (cx - radius, cy + radius * 0.2),
            (cx + radius * 0.2, cy + radius * 0.2),
            (cx - radius * 0.6, cy + radius + tail),
        ],
        fill=FG,
    )


# Opening quotes, upper-left.
comma(84, 82, 22, 18)
comma(132, 82, 22, 18)

# Reference lines, shrinking — reads as a bibliography.
for index, (left, right, top) in enumerate(((60, 196, 146), (60, 168, 178), (60, 132, 210))):
    draw.rounded_rectangle((left, top, right, top + 16), radius=8, fill=FG)

out = Path(__file__).resolve().parent.parent / "docs" / "images" / "icon.png"
out.parent.mkdir(parents=True, exist_ok=True)
image.save(out, format="PNG", optimize=True)
print(f"wrote {out} ({out.stat().st_size} bytes)")
