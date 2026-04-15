"""
Tunebox App Icon Generator — Harmonic Geometry
Generates 256x256 and 128x128 PNG icons.
"""
import math
from PIL import Image, ImageDraw, ImageFont

FONT_DIR = "C:/Users/levis/.claude/plugins/cache/anthropic-agent-skills/document-skills/0f7c287eaf0d/skills/canvas-design/canvas-fonts"

def make_icon(size=512):
    """Create a Tunebox icon at the given pixel size."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    cx, cy = size / 2, size / 2
    r = size / 2

    # --- 圆角矩形背景 ---
    # 深色底 + 微妙渐变
    bg = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    bg_draw = ImageDraw.Draw(bg)
    corner = int(size * 0.22)
    # 主背景：深灰渐变
    for y in range(size):
        t = y / size
        r_c = int(17 + t * 8)
        g_c = int(24 + t * 12)
        b_c = int(39 + t * 16)
        bg_draw.line([(0, y), (size, y)], fill=(r_c, g_c, b_c, 255))
    # 应用圆角蒙版
    mask = Image.new("L", (size, size), 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=corner, fill=255)
    bg.putalpha(mask)
    img = Image.alpha_composite(img, bg)
    draw = ImageDraw.Draw(img)

    # --- 发光光晕（左上角微光） ---
    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    glow_cx, glow_cy = size * 0.35, size * 0.3
    for i in range(int(size * 0.5), 0, -1):
        alpha = int(18 * (1 - i / (size * 0.5)))
        glow_draw.ellipse(
            [glow_cx - i, glow_cy - i, glow_cx + i, glow_cy + i],
            fill=(52, 211, 153, alpha)
        )
    glow_masked = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    glow_masked.paste(glow, mask=mask)
    img = Image.alpha_composite(img, glow_masked)
    draw = ImageDraw.Draw(img)

    # --- 唱片主体（同心圆） ---
    disc_cx, disc_cy = cx, cy * 0.92
    disc_r = size * 0.34

    # 外圈 — 深色碟片
    for i in range(int(disc_r), 0, -1):
        t = i / disc_r
        c = int(30 + 25 * t)
        alpha = 240 if t > 0.15 else int(240 * (t / 0.15))
        draw.ellipse(
            [disc_cx - i, disc_cy - i, disc_cx + i, disc_cy + i],
            fill=(c, c + 5, c + 12, alpha)
        )

    # 纹路 — 同心圆（唱片沟槽）
    groove_radii = [0.92, 0.82, 0.72, 0.62, 0.52, 0.42]
    for ratio in groove_radii:
        gr = disc_r * ratio
        draw.ellipse(
            [disc_cx - gr, disc_cy - gr, disc_cx + gr, disc_cy + gr],
            outline=(255, 255, 255, 18), width=1
        )

    # 内圈标签 — 绿色渐变
    label_r = disc_r * 0.32
    for i in range(int(label_r), 0, -1):
        t = i / label_r
        r_c = int(5 + t * 47)
        g_c = int(150 + t * 61)
        b_c = int(105 - t * 6)
        draw.ellipse(
            [disc_cx - i, disc_cy - i, disc_cx + i, disc_cy + i],
            fill=(r_c, g_c, b_c, 255)
        )

    # 中心孔
    hole_r = disc_r * 0.06
    draw.ellipse(
        [disc_cx - hole_r, disc_cy - hole_r, disc_cx + hole_r, disc_cy + hole_r],
        fill=(20, 26, 42, 255)
    )

    # --- 声波弧线（右侧，从唱片向外传播） ---
    wave_cx = disc_cx + disc_r * 0.15
    wave_cy = disc_cy
    for idx, offset in enumerate([disc_r * 1.15, disc_r * 1.35, disc_r * 1.55]):
        alpha = [60, 45, 28][idx]
        width = max(2, int(size * 0.005))
        arc_r = offset
        # 绘制 40 度弧
        start_angle = -30
        end_angle = 30
        draw.arc(
            [wave_cx - arc_r, wave_cy - arc_r, wave_cx + arc_r, wave_cy + arc_r],
            start=start_angle, end=end_angle,
            fill=(52, 211, 153, alpha), width=width
        )

    # --- "TUNEBOX" 文字 ---
    try:
        font_size = int(size * 0.1)
        font = ImageFont.truetype(f"{FONT_DIR}/Outfit-Bold.ttf", font_size)
    except:
        font = ImageFont.load_default()

    text = "TUNEBOX"
    bbox = draw.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    text_x = (size - tw) / 2
    text_y = size * 0.82

    # 文字阴影
    draw.text((text_x, text_y + 1), text, fill=(0, 0, 0, 80), font=font)
    # 文字主体 — 白色
    draw.text((text_x, text_y), text, fill=(255, 255, 255, 230), font=font)

    # --- 应用圆角蒙版到最终图 ---
    final = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    final_mask = Image.new("L", (size, size), 0)
    fm_draw = ImageDraw.Draw(final_mask)
    fm_draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=corner, fill=255)
    final.paste(img, mask=final_mask)

    return final


if __name__ == "__main__":
    import sys
    out_dir = sys.argv[1] if len(sys.argv) > 1 else "."

    icon_512 = make_icon(512)

    # 256px
    icon_256 = icon_512.resize((256, 256), Image.LANCZOS)
    icon_256.save(f"{out_dir}/ICON_256.PNG")

    # 128px (ICON.PNG)
    icon_128 = icon_512.resize((128, 128), Image.LANCZOS)
    icon_128.save(f"{out_dir}/ICON.PNG")

    # 也保存 512px 作为备份
    icon_512.save(f"{out_dir}/ICON_512.PNG")

    # 64px for UI
    icon_64 = icon_512.resize((64, 64), Image.LANCZOS)
    icon_64.save(f"{out_dir}/icon_64.png")

    print(f"Generated: ICON.PNG (128px), ICON_256.PNG (256px), ICON_512.PNG (512px), icon_64.png (64px)")
