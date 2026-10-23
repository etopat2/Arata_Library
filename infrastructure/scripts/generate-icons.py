"""Render code-owned PWA book mark into installable PNG sizes (development asset)."""

from pathlib import Path
from PIL import Image, ImageDraw

target = Path(__file__).resolve().parents[2] / "apps" / "web-pwa" / "public"
for size in (192, 512):
    scale = size / 192
    image = Image.new("RGB", (size, size), "#071525")
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=int(36 * scale), fill="#071525")
    draw.polygon([(42 * scale, 50 * scale), (84 * scale, 50 * scale), (108 * scale, 67 * scale), (108 * scale, 146 * scale), (83 * scale, 137 * scale), (42 * scale, 137 * scale)], fill="#67e8f9")
    draw.rectangle((119 * scale, 50 * scale, 150 * scale, 137 * scale), fill="#67e8f9")
    draw.line((108 * scale, 67 * scale, 108 * scale, 146 * scale), fill="#ffffff", width=max(3, int(6 * scale)))
    image.save(target / f"icon-{size}.png", optimize=True)
