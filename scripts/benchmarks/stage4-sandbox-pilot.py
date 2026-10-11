#!/usr/bin/env python3
"""Stage 4 synthetic Vercel Sandbox pilot (docs/plans/STAGE4_VIDEO_SPLIT_PLAN_2026-10-09.md, next step 2).

Runs INSIDE a Vercel Sandbox (x86_64 Ubuntu, stdlib Python only). Generated media only: no real
recordings, credentials or uploads. Applies the v1 cut recipe (decision 12: identity mapping, cut at
T on the MP4 timeline) and checks the hard gates 2-3 acceptance on the output.

  python3 stage4-sandbox-pilot.py install             # pinned FFmpeg, sha256-verified
  python3 stage4-sandbox-pilot.py cut DUR CUT LABEL [PRIVATE]  # fixture DUR s, cut at CUT s; PRIVATE
                                                      # (default CUT) moves the discussion start: negative control
  python3 stage4-sandbox-pilot.py interrupt           # kill the encoder mid-run; no output may be declared
  python3 stage4-sandbox-pilot.py diskfull            # fill scratch; the cut must fail with a named reason

Fixture: 1080p, constant 25 fps, stereo 48 kHz AAC. Before the private point the picture is a light
"presentation" slide and the audio is a 440 Hz tone; after it the picture is red ("DISCUSSION") and
the audio is 3 kHz, so any leak is detectable in the output's last frame and last audio window.
"""
import hashlib, json, math, os, resource, shutil, signal, struct, subprocess, sys, time
from pathlib import Path

FF_URL = ('https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-10-08-13-05/'
          'ffmpeg-n9.0.2-23-g27b46f0fbc-linux64-gpl-9.0.tar.xz')
FF_SHA256 = '14020417ff8ef01470e8cb771355e65c37aff62b80fb0be41eeb7611d1360902'
FF_DIR = Path(os.environ.get('S4_FFMPEG_DIR', '/tmp/ffmpeg'))
FFMPEG, FFPROBE = FF_DIR / 'bin/ffmpeg', FF_DIR / 'bin/ffprobe'
WORK = Path(os.environ.get('S4_WORK', '/tmp/s4'))
FPS, SR, W, H = 25, 48000, 1920, 1080
FONT_URL = ('https://github.com/dejavu-fonts/dejavu-fonts/releases/download/version_2_37/'
            'dejavu-fonts-ttf-2.37.tar.bz2')
FONT_SHA256 = 'fa9ca4d13871dd122f61258a80d01751d603b4d3ee14095d65453b4e846e17d7'  # hashed locally, 2026-10-09
FONT = FF_DIR / 'DejaVuSans.ttf'


class Reject(Exception):
    """A named fail-closed outcome: the output is not declared."""


def sh(args, label, receipt, timeout=None):
    start = time.monotonic()
    before = resource.getrusage(resource.RUSAGE_CHILDREN)
    p = subprocess.run([str(a) for a in args], capture_output=True, text=True, timeout=timeout)
    after = resource.getrusage(resource.RUSAGE_CHILDREN)
    receipt.setdefault('phases', []).append({
        'label': label, 'seconds': round(time.monotonic() - start, 2), 'exit': p.returncode,
        'cpu_seconds': round((after.ru_utime + after.ru_stime) - (before.ru_utime + before.ru_stime), 2),
        'peak_rss_mb_children': round(after.ru_maxrss / 1024)})
    if p.returncode != 0:
        tail = (p.stderr or '')[-600:]
        if 'No space left on device' in tail:
            raise Reject(f'insufficient_scratch during {label}')
        raise Reject(f'{label} failed (exit {p.returncode}): {tail}')
    return p.stdout


def scratch_bytes():
    return sum(f.stat().st_size for f in WORK.rglob('*') if f.is_file())


def install():
    receipt = {}
    FF_DIR.mkdir(parents=True, exist_ok=True)
    tarball = FF_DIR / 'ff.tar.xz'
    sh(['curl', '-fsSL', '-o', tarball, FF_URL], 'download_ffmpeg', receipt)
    digest = hashlib.sha256(tarball.read_bytes()).hexdigest()
    if digest != FF_SHA256:
        raise SystemExit(f'ffmpeg sha256 mismatch: {digest}')
    sh(['tar', '-xJf', tarball, '-C', FF_DIR, '--strip-components=1'], 'extract_ffmpeg', receipt)
    tarball.unlink()
    fonts = FF_DIR / 'font.tar.bz2'
    sh(['curl', '-fsSL', '-o', fonts, FONT_URL], 'download_font', receipt)
    if hashlib.sha256(fonts.read_bytes()).hexdigest() != FONT_SHA256:
        raise SystemExit('font sha256 mismatch')
    sh(['tar', '-xjf', fonts, '-C', FF_DIR, '--strip-components=2', 'dejavu-fonts-ttf-2.37/ttf/DejaVuSans.ttf'],
       'extract_font', receipt)
    fonts.unlink()
    version = sh([FFMPEG, '-hide_banner', '-version'], 'version', receipt).splitlines()[0]
    filters = sh([FFMPEG, '-hide_banner', '-filters'], 'filters', receipt)
    print(json.dumps({'sha256': digest, 'version': version, 'drawtext': ' drawtext ' in filters,
                      'font': os.path.exists(FONT), **receipt}))


def make_fixture(dur, private, path, receipt):
    """Presentation [0, private), discussion [private, dur)."""
    text = os.path.exists(FONT) and ' drawtext ' in sh([FFMPEG, '-hide_banner', '-filters'], 'filters', receipt)
    slide = f'color=c=0xf6f8fc:s={W}x{H}:r={FPS}:d={dur}'
    vf = [f"drawbox=x='mod(t*120,{W}-320)':y=600:w=320:h=240:c=0x3060c0:t=fill:enable='lt(t,{private})'",
          f"drawbox=x=0:y=0:w={W}:h={H}:c=red:t=fill:enable='gte(t,{private})'"]
    if text:
        vf += [f"drawtext=fontfile={FONT}:text='SYNTHETIC PRESENTATION — slide text 0123456789':x=80:y=80:fontsize=44:fontcolor=black:enable='lt(t,{private})'",
               f"drawtext=fontfile={FONT}:text='Small text ABCDEFGHIJKLMNOPQRSTUVWXYZ':x=80:y=180:fontsize=20:fontcolor=black:enable='lt(t,{private})'",
               f"drawtext=fontfile={FONT}:text='%{{pts\\:hms}}':x=80:y=980:fontsize=36:fontcolor=black",
               f"drawtext=fontfile={FONT}:text='DISCUSSION':x=700:y=480:fontsize=96:fontcolor=white:enable='gte(t,{private})'"]
    audio = (f"aevalsrc='if(lt(t,{private}),0.3*sin(2*PI*440*t),0.3*sin(2*PI*3000*t))"
             f"|if(lt(t,{private}),0.3*sin(2*PI*440*t),0.3*sin(2*PI*3000*t))':s={SR}:d={dur}")
    sh([FFMPEG, '-hide_banner', '-nostdin', '-y', '-loglevel', 'error',
        '-f', 'lavfi', '-i', slide, '-f', 'lavfi', '-i', audio, '-vf', ','.join(vf),
        '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-g', '250',
        '-c:a', 'aac', '-b:a', '128k', '-shortest', path], 'fixture', receipt)
    receipt['fixture'] = {'duration_s': dur, 'private_s': private, 'drawtext': text,
                          'bytes': path.stat().st_size}


def probe(path, receipt, label):
    return json.loads(sh([FFPROBE, '-v', 'error', '-show_streams', '-show_format', '-of', 'json', path],
                         label, receipt))


def packet_md5(path, receipt, label):
    out = sh([FFMPEG, '-hide_banner', '-nostdin', '-loglevel', 'error', '-i', path, '-map', '0:a:0',
              '-c', 'copy', '-f', 'framemd5', '-'], label, receipt)
    return [line.split(',')[-1].strip() for line in out.splitlines() if line and not line.startswith('#')]


def goertzel(samples, freq):
    k = 2 * math.cos(2 * math.pi * freq / SR)
    s1 = s2 = 0.0
    for x in samples:
        s1, s2 = x + k * s1 - s2, s1
    return math.sqrt(max(s1 * s1 + s2 * s2 - k * s1 * s2, 0)) / max(len(samples), 1)


def cut(dur, cut_s, label, reuse_fixture=False, private=None):
    receipt = {'label': label, 'arch': os.uname().machine, 'nproc': os.cpu_count(),
               'ffmpeg_sha256': FF_SHA256, 'cut_s': cut_s}
    if not reuse_fixture:
        shutil.rmtree(WORK, ignore_errors=True)
        WORK.mkdir(parents=True)
    src, pcm, video, audio, audio2 = (WORK / n for n in ('src.mp4', 'kept.pcm', 'v.mp4', 'a.m4a', 'a2.m4a'))
    staged, final = WORK / 'out.partial.mp4', WORK / 'out.mp4'
    peak = 0
    try:
        if not reuse_fixture:
            make_fixture(dur, cut_s if private is None else private, src, receipt)
        frames = math.floor(cut_s * FPS)          # frame k spans [k/25, (k+1)/25); keep whole frames before T
        samples = math.floor(cut_s * SR)
        receipt['kept'] = {'frames': frames, 'samples': samples}
        # Audio: decode on a zero-based clock, keep only pre-cut samples, isolate them in a PCM file.
        sh([FFMPEG, '-hide_banner', '-nostdin', '-y', '-loglevel', 'error', '-i', src, '-map', '0:a:0',
            '-af', f'aresample=first_pts=0,atrim=end_sample={samples}', '-f', 's16le', '-ac', '2',
            '-ar', SR, pcm], 'audio_decode_trim', receipt)
        if pcm.stat().st_size != samples * 4:
            raise Reject(f'pcm_length {pcm.stat().st_size} != {samples * 4}')
        enc = ['-f', 's16le', '-ar', SR, '-ac', '2', '-i', pcm, '-c:a', 'aac', '-b:a', '128k']
        sh([FFMPEG, '-hide_banner', '-nostdin', '-y', '-loglevel', 'error', *enc, audio], 'audio_encode', receipt)
        sh([FFMPEG, '-hide_banner', '-nostdin', '-y', '-loglevel', 'error', *enc, audio2], 'audio_encode_independent', receipt)
        # Video: re-encode only the first `frames` decoded frames.
        sh([FFMPEG, '-hide_banner', '-nostdin', '-y', '-loglevel', 'error', '-i', src, '-map', '0:v:0',
            '-frames:v', frames, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
            '-r', FPS, '-an', video], 'video_encode', receipt)
        peak = max(peak, scratch_bytes())
        sh([FFMPEG, '-hide_banner', '-nostdin', '-y', '-loglevel', 'error', '-i', video, '-i', audio,
            '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy', '-map_metadata', '-1', '-map_chapters', '-1',
            '-movflags', '+faststart', '-fflags', '+bitexact', '-f', 'mp4', staged], 'mux', receipt)
        peak = max(peak, scratch_bytes())
        receipt['acceptance'] = accept(staged, src, audio2, frames, samples, cut_s, receipt)
        staged.rename(final)                       # declared only after every check passes
        receipt['outcome'] = 'accepted'
        receipt['output_bytes'] = final.stat().st_size
        sh([FFMPEG, '-hide_banner', '-nostdin', '-y', '-loglevel', 'error', '-sseof', '-0.2', '-i', final,
            '-frames:v', '1', WORK / f'{label}-last-frame.png'], 'last_frame_png', receipt)
    except Reject as reason:
        receipt['outcome'] = 'rejected'
        receipt['reason'] = str(reason)
    receipt['declared_output_exists'] = final.exists()
    receipt['peak_scratch_bytes'] = peak
    try:
        (WORK / f'{label}.json').write_text(json.dumps(receipt, indent=1))
    except OSError as error:                       # a full disk must not hide the outcome
        receipt['receipt_write_error'] = str(error)
    print(json.dumps({k: receipt.get(k) for k in ('label', 'outcome', 'reason', 'declared_output_exists',
                                                  'receipt_write_error')}))
    return receipt


def accept(out, src, independent, frames, samples, cut_s, receipt):
    info = probe(out, receipt, 'probe_output')
    kinds = sorted(s['codec_type'] + ':' + s['codec_name'] for s in info['streams'])
    if kinds != ['audio:aac', 'video:h264']:
        raise Reject(f'streams {kinds}')
    extra = sorted(set(info['format'].get('tags', {})) - {'major_brand', 'minor_version', 'compatible_brands'})
    if extra:
        raise Reject(f'container tags {extra}')
    v = sh([FFPROBE, '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts_time,duration_time',
            '-of', 'csv=p=0', out], 'probe_video_packets', receipt).split()
    vpts = sorted(float(row.split(',')[0]) for row in v)
    last_video_end = vpts[-1] + 1 / FPS
    a = next(s for s in info['streams'] if s['codec_type'] == 'audio')
    audio_samples = int(a.get('duration_ts', 0)) if a.get('time_base') == f'1/{SR}' else None
    out_md5 = packet_md5(out, receipt, 'audio_md5_output')
    ind_md5 = packet_md5(independent, receipt, 'audio_md5_independent')
    tail = subprocess.run([str(FFMPEG), '-hide_banner', '-nostdin', '-loglevel', 'error', '-sseof', '-0.5', '-i', str(out),
                           '-map', '0:a:0', '-ac', '1', '-f', 's16le', '-'], capture_output=True).stdout
    pcm = [x / 32768 for x in struct.unpack(f'<{len(tail) // 2}h', tail[:len(tail) // 2 * 2])]
    rgb = subprocess.run([str(FFMPEG), '-hide_banner', '-nostdin', '-loglevel', 'error', '-sseof', '-0.2', '-i', str(out),
                          '-frames:v', '1', '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
                         capture_output=True).stdout
    checks = {
        'video_frames': len(vpts), 'video_frames_expected': frames,
        'last_video_end_s': round(last_video_end, 6), 'cut_s': cut_s,
        'audio_duration_samples': audio_samples, 'samples_kept': samples,
        'audio_packets': len(out_md5), 'audio_payload_equals_independent_encode': out_md5 == ind_md5,
        'tail_440hz': round(goertzel(pcm, 440), 5), 'tail_3000hz': round(goertzel(pcm, 3000), 5),
        'last_frame_rgb_mean': list(rgb[:3]),
    }
    failures = []
    if len(vpts) != frames: failures.append('video_frame_count')
    if last_video_end > cut_s + 1e-9: failures.append('video_past_cut')
    if audio_samples is None or audio_samples > samples: failures.append('audio_past_cut')
    if out_md5 != ind_md5: failures.append('audio_payload_mismatch')
    if checks['tail_3000hz'] > checks['tail_440hz'] / 10: failures.append('discussion_tone_in_tail')
    if len(rgb) >= 3 and rgb[0] > 200 and rgb[1] < 80: failures.append('discussion_frame_in_tail')
    checks['failures'] = failures
    if failures:
        receipt['acceptance'] = checks
        raise Reject('acceptance: ' + ','.join(failures))
    return checks


def interrupt():
    """Kill the video encoder mid-run: nothing may be declared."""
    receipt = {'label': 'interrupt'}
    shutil.rmtree(WORK, ignore_errors=True); WORK.mkdir(parents=True)
    src, staged, final = WORK / 'src.mp4', WORK / 'out.partial.mp4', WORK / 'out.mp4'
    make_fixture(600, 480.0, src, receipt)
    p = subprocess.Popen([str(FFMPEG), '-hide_banner', '-nostdin', '-y', '-loglevel', 'error', '-i', str(src),
                          '-frames:v', str(480 * FPS), '-c:v', 'libx264', '-preset', 'veryfast', '-an', str(staged)])
    time.sleep(20)
    p.send_signal(signal.SIGKILL); p.wait()
    playable = subprocess.run([str(FFPROBE), '-v', 'error', str(staged)], capture_output=True).returncode == 0
    receipt.update({'killed_exit': p.returncode, 'partial_exists': staged.exists(),
                    'partial_playable': playable, 'declared_output_exists': final.exists(),
                    'outcome': 'pass' if not final.exists() else 'FAIL'})
    (WORK / 'interrupt.json').write_text(json.dumps(receipt, indent=1))
    print(json.dumps(receipt))


def diskfull():
    """Make a 10-minute fixture, leave ~40 MB free (the kept PCM alone needs ~92 MB), then cut: it must reject, not declare."""
    shutil.rmtree(WORK, ignore_errors=True); WORK.mkdir(parents=True)
    make_fixture(600, 480.0, WORK / 'src.mp4', {})
    filler = Path('/tmp/filler.bin')
    free = shutil.disk_usage('/tmp').free
    subprocess.run(['fallocate', '-l', str(free - 40_000_000), str(filler)], check=True)
    try:
        r = cut(600, 480.0, 'diskfull', reuse_fixture=True)
    finally:
        filler.unlink(missing_ok=True)
    ok = r['outcome'] == 'rejected' and not r['declared_output_exists']
    print(json.dumps({'diskfull': 'pass' if ok else 'FAIL', 'reason': r.get('reason')}))


if __name__ == '__main__':
    cmd = sys.argv[1]
    if cmd == 'install': install()
    elif cmd == 'cut': cut(float(sys.argv[2]), float(sys.argv[3]), sys.argv[4],
                           private=float(sys.argv[5]) if len(sys.argv) > 5 else None)
    elif cmd == 'interrupt': interrupt()
    elif cmd == 'diskfull': diskfull()
    else: raise SystemExit(__doc__)
