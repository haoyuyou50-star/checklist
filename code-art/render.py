"""Render stills or 10-second videos for the code-art series."""

from __future__ import annotations

import argparse
import subprocess
import wave
from pathlib import Path

import numpy as np
from PIL import Image

from engine import FPS, H, SECONDS, W, Ctx, Score, apply_grade, to_u8
from pieces_a import PIECES as PIECES_A
from pieces_b import PIECES as PIECES_B

ROOT = Path(__file__).resolve().parent
STILLS = ROOT / "stills"
RENDERS = ROOT / "renders"
ALL = PIECES_A + PIECES_B


def pieces_by_request(only):
    if not only:
        return ALL
    want = set()
    for item in only:
        for cls in ALL:
            if item in (str(cls.index).zfill(2), str(cls.index), cls.slug, cls.title):
                want.add(cls)
    return [cls for cls in ALL if cls in want]


def write_wav(path: Path, audio: np.ndarray, sr: int = 44100):
    pcm = np.clip(audio, -1, 1)
    pcm = (pcm * 32767.0).astype(np.int16)
    with wave.open(str(path), "w") as handle:
        handle.setnchannels(2)
        handle.setsampwidth(2)
        handle.setframerate(sr)
        handle.writeframes(pcm.tobytes())


def audio_for(piece):
    score = Score(seed=10_000 + piece.index)
    piece.compose(score)
    audio = score.master(
        reverb=piece.reverb,
        decay=piece.rev_decay,
        rev_seconds=piece.rev_seconds,
        hp=piece.hp,
    )
    peak = float(np.max(np.abs(audio)))
    rms = float(np.sqrt(np.mean(audio**2)))
    # How much of the ten seconds is actually sounding.
    hop = int(0.2 * 44100)
    windows = audio[: audio.shape[0] // hop * hop].reshape(-1, hop, 2)
    active = np.sqrt(np.mean(windows**2, axis=(1, 2))) > 0.012
    return audio, peak, rms, float(active.mean())


def save_waveform(path: Path, audio: np.ndarray):
    mid = audio.mean(axis=1)
    bins = 900
    n = mid.shape[0] // bins * bins
    chunk = mid[:n].reshape(bins, -1)
    hi = chunk.max(axis=1)
    lo = chunk.min(axis=1)
    height = 180
    canvas = np.full((height, bins, 3), 244, np.uint8)
    for i in range(bins):
        y0 = int(height / 2 - hi[i] * height * 0.46)
        y1 = int(height / 2 - lo[i] * height * 0.46)
        a, b = sorted((np.clip(y0, 0, height - 1), np.clip(y1, 0, height - 1)))
        canvas[a : b + 1, i] = (28, 28, 28)
    Image.fromarray(canvas).save(path, quality=85)


def grade_frame(piece, ctx, img):
    return apply_grade(
        img,
        ctx,
        vignette=piece.vignette,
        contrast=piece.contrast,
        sat=piece.sat,
        bloom=piece.bloom,
        bloom_thr=piece.bloom_thr,
    )


def render_still(cls, times):
    STILLS.mkdir(parents=True, exist_ok=True)
    ctx = Ctx()
    piece = cls(ctx)
    audio, peak, rms, active = audio_for(piece)
    name = f"{cls.index:02d}-{cls.slug}"
    save_waveform(STILLS / f"{name}-wave.jpg", audio)
    saved = []
    for t in times:
        buf = np.zeros((H, W, 3), np.float32)
        piece.frame(float(t), buf)
        graded = grade_frame(piece, ctx, buf)
        image = Image.fromarray(to_u8(graded, ctx), "RGB")
        path = STILLS / f"{name}-t{t:04.1f}.jpg"
        image.save(path, quality=90)
        thumb = image.resize((270, 480), Image.Resampling.LANCZOS)
        thumb.save(STILLS / f"{name}-thumb.jpg", quality=85)
        saved.append(path)
        print(
            f"  still t={t:.1f} mean={graded.mean():.3f} max={graded.max():.3f} -> {path.name}",
            flush=True,
        )
    print(f"  audio peak={peak:.2f} rms={rms:.3f} active={active:.0%}", flush=True)
    return saved, peak, rms, active


def render_video(cls):
    RENDERS.mkdir(parents=True, exist_ok=True)
    ctx = Ctx()
    piece = cls(ctx)
    audio, peak, rms, active = audio_for(piece)
    name = f"{cls.index:02d}-{cls.slug}"
    wav = RENDERS / f"{name}.wav"
    out = RENDERS / f"{name}.mp4"
    write_wav(wav, audio)
    cmd = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "-s",
        f"{W}x{H}",
        "-r",
        str(FPS),
        "-i",
        "-",
        "-i",
        str(wav),
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "17",
        "-pix_fmt",
        "yuv420p",
        "-profile:v",
        "high",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-ar",
        "44100",
        "-movflags",
        "+faststart",
        "-metadata",
        f"title={cls.title}",
        "-metadata",
        f"comment={cls.poem}",
        "-shortest",
        str(out),
    ]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    nframes = int(round(FPS * SECONDS))
    piece.reset()
    try:
        for i in range(nframes):
            t = i / FPS
            buf = np.zeros((H, W, 3), np.float32)
            piece.frame(t, buf)
            graded = grade_frame(piece, ctx, buf)
            if i < 8:
                graded *= smoother_fade(i / 8)
            proc.stdin.write(np.ascontiguousarray(to_u8(graded, ctx)).tobytes())
            if i % 30 == 0:
                print(f"  frame {i:03d}/{nframes}", flush=True)
        proc.stdin.close()
        err = proc.stderr.read().decode("utf-8", "replace")
        code = proc.wait()
    except Exception:
        proc.kill()
        raise
    if code != 0:
        raise RuntimeError(f"ffmpeg failed for {name}: {err}")
    wav.unlink(missing_ok=True)
    print(f"  video {out.name} peak={peak:.2f} rms={rms:.3f} active={active:.0%}", flush=True)
    return out


def smoother_fade(t):
    t = max(0.0, min(1.0, t))
    return t * t * t * (t * (t * 6 - 15) + 10)


def contact_sheet():
    thumbs = []
    labels = []
    for cls in ALL:
        path = STILLS / f"{cls.index:02d}-{cls.slug}-thumb.jpg"
        if path.exists():
            thumbs.append(Image.open(path).convert("RGB"))
            labels.append(f"{cls.index:02d} {cls.title}")
    if not thumbs:
        return None
    cols = 5
    tw, th = thumbs[0].size
    rows = (len(thumbs) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * tw, rows * th), (244, 241, 234))
    for i, thumb in enumerate(thumbs):
        sheet.paste(thumb, ((i % cols) * tw, (i // cols) * th))
    path = STILLS / "contact.jpg"
    sheet.save(path, quality=88)
    return path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", nargs="*")
    parser.add_argument("--stills", action="store_true")
    parser.add_argument("--video", action="store_true")
    parser.add_argument("--times", default="")
    args = parser.parse_args()
    chosen = pieces_by_request(args.only)
    if not chosen:
        raise SystemExit("no pieces matched")
    failed = []
    for cls in chosen:
        print(f"[{cls.index:02d} {cls.title}]", flush=True)
        try:
            if args.video:
                render_video(cls)
            else:
                times = [float(x) for x in args.times.split(",")] if args.times else [cls.poster]
                render_still(cls, times)
        except Exception as exc:
            failed.append((cls.slug, exc))
            print(f"  FAILED {type(exc).__name__}: {exc}", flush=True)
    if failed:
        raise SystemExit(f"{len(failed)} piece(s) failed")
    if not args.video:
        path = contact_sheet()
        if path:
            print(f"contact {path}", flush=True)


if __name__ == "__main__":
    main()
