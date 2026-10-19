"""Synthesize a wind soundtrack that follows the per-frame wind level logged by capture.mjs.

usage: python3 tools/wind_audio.py <frames_dir>/wind.json out.wav
"""
import json, sys, wave
import numpy as np
from scipy.signal import butter, sosfilt

SR = 44100
data = json.load(open(sys.argv[1]))
fps, levels = data["fps"], np.array(data["levels"], dtype=np.float64)
n = int(len(levels) / fps * SR)
t_frames = np.arange(len(levels)) / fps
env = np.interp(np.arange(n) / SR, t_frames, levels)
env = sosfilt(butter(1, 1.5, "low", fs=SR, output="sos"), env)

rng = np.random.default_rng(1873)


def brown(n):
    x = np.cumsum(rng.standard_normal(n))
    x -= sosfilt(butter(1, 8, "low", fs=SR, output="sos"), x)
    return x / (np.abs(x).max() + 1e-9)


out = np.zeros((n, 2))
for ch in range(2):
    src = brown(n) * 0.6 + rng.standard_normal(n) * 0.02
    low = sosfilt(butter(2, 260, "low", fs=SR, output="sos"), src)
    mid = sosfilt(butter(2, [300, 700], "band", fs=SR, output="sos"), src)
    high = sosfilt(butter(2, [800, 1800], "band", fs=SR, output="sos"), src)
    gust = np.clip(env - 0.55, 0, None)
    sig = low * (0.25 + 0.5 * env) + mid * (0.08 + 1.1 * env) + high * (1.6 * gust ** 1.5)
    out[:, ch] = sig

fade = int(SR * 1.5)
ramp = np.linspace(0, 1, fade)
out[:fade] *= ramp[:, None]
out[-fade:] *= ramp[::-1, None]
out /= np.abs(out).max() + 1e-9
out *= 0.7
pcm = (out * 32767).astype(np.int16)
with wave.open(sys.argv[2], "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print("wrote", sys.argv[2], f"{n / SR:.1f}s")
