#!/usr/bin/env python3
"""Stage 4 focused validation, part 1: speech-like audio and realistic silence against the separate-M4A mapper.
Local generated-media experiment, not a production verifier. Requires NumPy and FFmpeg. No external media,
network, credentials or publication. Imports stage4-mapping-check.py unchanged.
"""
import importlib.util
import json
import subprocess
import sys
from pathlib import Path
import numpy as np
sys.dont_write_bytecode = True


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(file))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


m = load('mapping', 'stage4-mapping-check.py')
ROOT = m.ROOT
SR = 48000
DURATION = 120
OFFSET = .731  # MP4 = M4A + OFFSET


def speech_like(rng, n, quiet=1.0):
    """300-3400 Hz noise with 3-5 Hz syllabic modulation and 0.2-2 s pauses, per channel."""
    out = np.zeros((n, 2), dtype='<f4')
    t = np.arange(n) / SR
    gate = np.ones(n)
    pos = 0
    while pos < n:
        talk = int(rng.uniform(1.5, 6) * SR)
        pause = int(rng.uniform(.2, 2) * SR)
        gate[pos + talk:pos + talk + pause] = 0
        pos += talk + pause
    for ch in range(2):
        z = rng.normal(size=n)
        f = np.fft.rfft(z)
        freq = np.fft.rfftfreq(n, 1 / SR)
        f[(freq < 300) | (freq > 3400)] = 0
        z = np.fft.irfft(f, n)
        rate = rng.uniform(3, 5)
        syllables = np.clip(np.sin(2 * np.pi * rate * t + rng.uniform(0, 6.28)), 0, None) ** 2
        out[:, ch] = (z / max(abs(z)) * .6 * syllables * gate * (quiet if ch else 1.0)).astype('<f4')
    return out


def encode_pair(audio, name, silence=None):
    """Write the 'MP4' audio (M4A content delayed by OFFSET) and the separate M4A, both AAC, then decode for alignment."""
    m4a_audio = audio.copy()
    if silence:
        lo, hi = silence
        m4a_audio[int(lo * SR):int(hi * SR)] = 0
    pad = np.zeros((int(OFFSET * SR), 2), dtype='<f4')
    mp4_audio = np.vstack([pad, m4a_audio])[:DURATION * SR]
    paths = {}
    for label, data in (('mp4', mp4_audio), ('m4a', m4a_audio)):
        raw = ROOT / f'{name}-{label}.f32'
        data.tofile(raw)
        enc = ROOT / f'{name}-{label}.m4a'
        m.ff(['-f', 'f32le', '-ar', str(SR), '-ac', '2', '-i', str(raw), '-c:a', 'aac', '-b:a', '128k', str(enc)], f'{name}-{label}')
        raw.unlink()
        dec = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(enc), '-af', 'lowpass=f=1000',
                                       '-f', 'f32le', '-ar', str(m.SR), '-ac', '2', '-'])
        paths[label] = np.frombuffer(dec, dtype='<f4').reshape(-1, 2).copy()
    return paths['mp4'], paths['m4a']


def run_case(name, audio, silence=None):
    target, separate = encode_pair(audio, name, silence)
    observed = m.discover(target, separate)
    result = {'case': name, 'silence_seconds': silence, 'anchor_times': m.ANCHORS}
    if observed.get('blocked'):
        result.update(outcome='blocked', reason=observed['blocked'], anchors_found=len(observed['anchors']),
                      blocked_at_seconds=m.ANCHORS[len(observed['anchors'])])
        return result
    model = m.infer(observed['anchors'])
    if model.get('kind') == 'blocked':
        result.update(outcome='blocked', reason=model['reason'])
        return result
    boundary = 90.0
    audit = m.discover(target, separate, [boundary - .75, boundary - .5, boundary - .25])
    mapped = m.map_boundary(model, boundary)
    result.update(outcome='mapped', model_kind=model['kind'], max_residual=model['max_residual'],
                  mapped_error_seconds=abs(mapped.get('mapped', float('nan')) - (boundary + OFFSET)),
                  audit=('blocked: ' + audit['blocked']) if audit.get('blocked') else 'ok',
                  correlations=[min(c['correlation'] for c in a['channels']) for a in observed['anchors']])
    return result


def main():
    rng = np.random.default_rng(590)
    audio = speech_like(rng, DURATION * SR)
    quiet = speech_like(np.random.default_rng(591), DURATION * SR, quiet=.25)
    cases = [
        run_case('speech_like', audio),
        run_case('speech_like_quiet_channel', quiet),
        run_case('speech_like_20s_silence_over_two_anchors', audio, silence=(33.0, 53.0)),
        run_case('speech_like_noise_snr_10db', audio + (np.random.default_rng(7).normal(0, .06, audio.shape)).astype('<f4')),
    ]
    out = {'scope': 'Local generated media; focused validation part 1 (mapper on speech-like audio and silence)',
           'ffmpeg': subprocess.check_output(['ffmpeg', '-version'], text=True).splitlines()[0], 'cases': cases}
    (ROOT / 'focused-results.json').write_text(json.dumps(out, indent=2))
    print(json.dumps(out, indent=2))


if __name__ == '__main__':
    main()
