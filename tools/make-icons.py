import math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent.parent / "icons"
RED = (207, 58, 40, 255)
CREAM = (255, 246, 230, 255)
TEXT = "ANNAMAYA ✦ MESS JOURNAL ✦ EAT WELL ✦ "
SS = 4


def load_font(px):
    for name in ("bahnschrift.ttf", "arialbd.ttf", "DejaVuSans-Bold.ttf"):
        try:
            return ImageFont.truetype(name, px)
        except OSError:
            continue
    return ImageFont.load_default()


def seal(n, scale):
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    c = n / 2
    u = n * scale / 120

    def ring(r, w):
        d.ellipse([c - r * u - w * u / 2, c - r * u - w * u / 2, c + r * u + w * u / 2, c + r * u + w * u / 2], outline=CREAM, width=max(1, round(w * u)))

    ring(56, 3.5)
    ring(37.5, 1.5)

    font = load_font(round(11.5 * u))
    step = 360 / len(TEXT)
    for i, ch in enumerate(TEXT):
        if ch == " ":
            continue
        if ch == "✦":
            ang = math.radians(-180 + i * step + step / 2)
            x, y = c + 47.5 * u * math.cos(ang), c + 47.5 * u * math.sin(ang)
            d.regular_polygon((x, y, 2.6 * u), 4, rotation=math.degrees(-ang), fill=CREAM)
            continue
        box = round(18 * u)
        glyph = Image.new("RGBA", (box, box), (0, 0, 0, 0))
        ImageDraw.Draw(glyph).text((box / 2, box / 2), ch, font=font, fill=CREAM, anchor="mm")
        deg = -180 + i * step + step / 2
        glyph = glyph.rotate(-(deg + 90), resample=Image.BICUBIC)
        ang = math.radians(deg)
        x, y = c + 47.5 * u * math.cos(ang), c + 47.5 * u * math.sin(ang)
        img.alpha_composite(glyph, (round(x - box / 2), round(y - box / 2)))

    d = ImageDraw.Draw(img)
    r, w = 27 * u, 5.5 * u
    for k in range(4):
        start = -81 + 90 * k
        d.arc([c - r - w / 2, c - r - w / 2, c + r + w / 2, c + r + w / 2], start, start + 73.8, fill=CREAM, width=round(w))
    grain = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    ImageDraw.Draw(grain).ellipse([c - 8.5 * u, c - 16.5 * u, c + 8.5 * u, c + 16.5 * u], fill=CREAM)
    img.alpha_composite(grain.rotate(-32, resample=Image.BICUBIC))
    return img.rotate(7, resample=Image.BICUBIC)


def icon(size, scale, radius_ratio, name):
    n = size * SS
    base = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    ImageDraw.Draw(base).rounded_rectangle([0, 0, n - 1, n - 1], radius=n * radius_ratio, fill=RED)
    base.alpha_composite(seal(n, scale))
    base.resize((size, size), Image.LANCZOS).save(OUT / name)
    print("wrote", name)


icon(192, 0.84, 0.2, "icon-192.png")
icon(512, 0.84, 0.2, "icon-512.png")
icon(512, 0.64, 0.0, "maskable-512.png")
icon(180, 0.8, 0.0, "apple-touch-icon.png")

android_res = OUT.parent / "android" / "res" / "drawable-xxxhdpi"
if android_res.exists():
    n = 432 * SS
    seal(n, 0.58).resize((432, 432), Image.LANCZOS).save(android_res / "ic_fg.png")
    print("wrote android ic_fg.png")
