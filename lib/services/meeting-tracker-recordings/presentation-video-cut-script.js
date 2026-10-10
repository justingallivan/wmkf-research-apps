/**
 * Stage 4 presentation-video cut recipe, shipped as a stdlib-only Python 3 script.
 *
 * The split worker writes CUT_SCRIPT_PY into the sandbox as cut.py and runs `python3 cut.py <command>`.
 * Ports scripts/benchmarks/stage4-sandbox-pilot.py and adds the source/output correspondence proof the
 * pilot lacked (docs/plans/STAGE4_BUILD_PLAN_2026-10-10.md "Sandbox recipe").
 *
 * Contract (inputs are environment variables; nothing sensitive is ever printed or written):
 *   install  FFMPEG_TAR, FFMPEG_SHA256, FFMPEG_DIR, INSTALL_RECEIPT
 *   cut      SOURCE_URL | SOURCE_PATH, SOURCE_SIZE, CUT_MS, WORK_DIR, [FFMPEG_BIN_DIR]
 *            -> WORK_DIR/receipt.json (always), WORK_DIR/presentation.mp4 (only after acceptance)
 *   upload   UPLOAD_URL, WORK_DIR -> WORK_DIR/upload.json   [UPLOAD_BACKOFF_S optional, default "2,4,8"]
 *   qxh      FILE -> stdout {"quickXorHash": "<base64>"}
 * Exit codes: 0 success, 3 clean rejection/failure with a JSON receipt, anything else is a crash.
 */

export const CUT_SCRIPT_VERSION = 1;

export const CUT_SCRIPT_PY = String.raw`#!/usr/bin/env python3
"""Stage 4 presentation-video cut recipe (stdlib only). See presentation-video-cut-script.js."""
import base64, errno, hashlib, json, math, os, subprocess, sys, time
import urllib.error, urllib.request
from fractions import Fraction

SCRIPT_VERSION = ${CUT_SCRIPT_VERSION}
CHUNK = 10 * 1024 * 1024          # 32 x 320 KiB, as Graph upload sessions require


class Fail(Exception):
    """A clean rejection: carries a receipt code (never content) and the step that raised it."""
    def __init__(self, code, step=None):
        Exception.__init__(self, code)
        self.code, self.step = code, step


def env(name, default=None):
    value = os.environ.get(name, default)
    if value is None:
        raise Fail('missing_input', name.lower())
    return value


def write_json(path, obj):
    tmp = path + '.tmp'
    with open(tmp, 'w') as handle:
        json.dump(obj, handle)
    os.replace(tmp, path)


# ---------------------------------------------------------------- QuickXorHash (Microsoft spec)
# 160-bit register; byte i is XORed in at bit offset (11 * i) mod 160, wrapping around;
# finally the 64-bit little-endian file length is XORed into the last 8 bytes.
# Bytes whose index is congruent mod 160 share a bit offset, so each aligned block is folded
# row-by-row (160-byte rows) with big-int XORs instead of looping per byte.
QX_ROW, QX_ROWS = 160, 65536
QX_BLOCK = QX_ROW * QX_ROWS
QX_MASK = (1 << 160) - 1


def qx_fold(block):
    block = block + b'\0' * (QX_BLOCK - len(block))
    x, rows = int.from_bytes(block, 'little'), QX_ROWS
    while rows > 1:
        half = rows // 2
        bits = half * QX_ROW * 8
        x = (x & ((1 << bits) - 1)) ^ (x >> bits)
        rows = half
    return x


def qx_finish(acc, size):
    reg = 0
    for k in range(QX_ROW):
        b = (acc >> (8 * k)) & 0xFF
        if b:
            v = b << ((k * 11) % 160)
            reg ^= (v & QX_MASK) | (v >> 160)
    reg ^= (size & 0xFFFFFFFFFFFFFFFF) << 96
    return base64.b64encode(reg.to_bytes(20, 'little')).decode('ascii')


def hash_file(path):
    """One pass: (sha256 hex, quickXorHash base64, size)."""
    sha, acc, size = hashlib.sha256(), 0, 0
    with open(path, 'rb') as handle:
        while True:
            block = handle.read(QX_BLOCK)
            if not block:
                break
            sha.update(block)
            acc ^= qx_fold(block)
            size += len(block)
    return sha.hexdigest(), qx_finish(acc, size), size


# ---------------------------------------------------------------- install
def cmd_install():
    receipt_path = env('INSTALL_RECEIPT')
    receipt = {'ok': False, 'code': None, 'ffmpegVersionLine': None}
    try:
        tarball, want, dest = env('FFMPEG_TAR'), env('FFMPEG_SHA256').lower(), env('FFMPEG_DIR')
        if hash_file(tarball)[0] != want:
            raise Fail('ffmpeg_checksum_mismatch')
        os.makedirs(dest, exist_ok=True)
        done = subprocess.run(['tar', '-xJf', tarball, '-C', dest, '--strip-components=1'],
                              stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if done.returncode != 0:
            if b'No space left on device' in done.stderr:
                raise Fail('insufficient_scratch')
            raise Fail('ffmpeg_extract_failed')
        exe = os.path.join(dest, 'bin', 'ffmpeg')
        if not (os.path.isfile(exe) and os.path.isfile(os.path.join(dest, 'bin', 'ffprobe'))):
            raise Fail('ffmpeg_layout_invalid')
        ver = subprocess.run([exe, '-version'], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if ver.returncode != 0:
            raise Fail('ffmpeg_version_failed')
        receipt.update(ok=True, code='ok', ffmpegVersionLine=ver.stdout.decode('utf-8', 'replace').splitlines()[0][:200])
    except Fail as fail:
        receipt['code'] = fail.code
    except OSError as error:
        receipt['code'] = 'insufficient_scratch' if error.errno == errno.ENOSPC else 'install_io_error'
    write_json(receipt_path, receipt)
    return 0 if receipt['ok'] else 3


# ---------------------------------------------------------------- cut helpers
class Tools:
    def __init__(self):
        d = os.environ.get('FFMPEG_BIN_DIR')
        self.ffmpeg = os.path.join(d, 'ffmpeg') if d else 'ffmpeg'
        self.ffprobe = os.path.join(d, 'ffprobe') if d else 'ffprobe'


def run(cmd, step):
    """Run a tool; return stdout bytes. Nonzero exit becomes a coded failure (stderr is never kept)."""
    try:
        p = subprocess.run(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except OSError as error:
        raise Fail('insufficient_scratch' if error.errno == errno.ENOSPC else 'ffmpeg_failed', step)
    if p.returncode != 0:
        if b'No space left on device' in p.stderr:
            raise Fail('insufficient_scratch', step)
        raise Fail('ffmpeg_failed', step)
    return p.stdout


def timeline_fail(step):
    raise Fail('unsupported_timeline', step)


def ffmpeg_cmd(tools, *args):
    return [tools.ffmpeg, '-hide_banner', '-nostdin', '-y', '-loglevel', 'error'] + [str(a) for a in args]


def probe_frames(tools, path, sel, count, ignore_editlist, step):
    """Frame (pts, duration) integer tick pairs, optionally only the first count packets' frames."""
    cmd = [tools.ffprobe, '-v', 'error']
    if ignore_editlist:
        cmd += ['-ignore_editlist', '1']
    cmd += ['-select_streams', sel, '-show_entries', 'frame=pts,duration']
    if count:
        cmd += ['-read_intervals', '%+#' + str(count)]
    cmd += ['-of', 'json', path]
    out = []
    for f in json.loads(run(cmd, step)).get('frames', []):
        pts = f.get('pts')
        if pts is None:
            timeline_fail(step)
        dur = f.get('duration')
        out.append((int(pts), int(dur) if dur is not None else None))
    return out


def start_is_zero(value, ticks):
    """Exactly zero: ffprobe's 6-decimal text must parse to 0.0 and the integer start tick must be 0."""
    if value is None or value == 'N/A' or float(value) != 0.0:
        return False
    return ticks is None or int(ticks) == 0


def download(url, dest):
    req = urllib.request.Request(url, method='GET')
    with urllib.request.urlopen(req, timeout=120) as resp, open(dest, 'wb') as out:
        while True:
            block = resp.read(1024 * 1024)
            if not block:
                break
            out.write(block)


def frame_ms(ticks, tb):
    return int(Fraction(ticks) * tb * 1000)      # floor, for the receipt only


def md5_packets(tools, path, step):
    out = run([tools.ffmpeg, '-hide_banner', '-nostdin', '-loglevel', 'error', '-i', path, '-map', '0:a:0',
               '-c', 'copy', '-f', 'framemd5', '-'], step).decode('utf-8', 'replace')
    return [ln.split(',')[-1].strip() for ln in out.splitlines() if ln and not ln.startswith('#')]


def decoded_sample_count(tools, path, channels, step):
    """Decode the output audio (edit list honoured) and count PCM samples without storing them."""
    cmd = [tools.ffmpeg, '-hide_banner', '-nostdin', '-loglevel', 'error', '-i', path, '-map', '0:a:0',
           '-f', 's16le', '-ac', str(channels), '-']
    p = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    total = 0
    while True:
        block = p.stdout.read(1 << 20)
        if not block:
            break
        total += len(block)
    if p.wait() != 0:
        raise Fail('ffmpeg_failed', step)
    return total // (2 * channels)


def cmd_cut():
    started = time.monotonic()
    work = env('WORK_DIR')
    os.makedirs(work, exist_ok=True)
    receipt_path = os.path.join(work, 'receipt.json')
    final = os.path.join(work, 'presentation.mp4')
    partial = os.path.join(work, 'presentation.partial.mp4')
    for stale in (final, partial):
        if os.path.exists(stale):
            os.remove(stale)
    R = {'ok': False, 'code': None, 'step': None, 'scriptVersion': SCRIPT_VERSION, 'cutMs': None, 'fps': None,
         'sampleRate': None, 'channels': None, 'sourceSize': None, 'framesKept': None, 'samplesKept': None,
         'lastKeptFrameEndMs': None, 'firstOmittedFrameEndMs': None, 'audioPacketsEqual': None,
         'outputSize': None, 'outputSha256': None, 'outputQuickXorHash': None,
         'timingsMs': {'probe': None, 'audio': None, 'video': None, 'mux': None, 'accept': None}}
    mark = [time.monotonic()]

    def lap(name):
        now = time.monotonic()
        R['timingsMs'][name] = int((now - mark[0]) * 1000)
        mark[0] = now

    try:
        cut_ms = int(env('CUT_MS'))
        if cut_ms < 1:
            raise Fail('invalid_cut', 'input')
        R['cutMs'] = cut_ms
        T = Fraction(cut_ms, 1000)
        tools = Tools()

        # --- source file and its size
        step = 'source'
        if os.environ.get('SOURCE_PATH'):
            src = os.environ['SOURCE_PATH']
        else:
            src = os.path.join(work, 'source.mp4')
            try:
                download(env('SOURCE_URL'), src)
            except OSError as error:
                if error.errno == errno.ENOSPC:
                    raise Fail('insufficient_scratch', 'download')
                raise Fail('source_download_failed', 'download')
            except Exception:
                raise Fail('source_download_failed', 'download')
        R['sourceSize'] = os.path.getsize(src)
        if R['sourceSize'] != int(env('SOURCE_SIZE')):
            raise Fail('source_size_mismatch', 'source')

        # --- a. streams
        step = 'probe_source'
        info = json.loads(run([tools.ffprobe, '-v', 'error', '-show_streams', '-show_format', '-of', 'json', src], step))
        vids = [s for s in info.get('streams', []) if s.get('codec_type') == 'video']
        auds = [s for s in info.get('streams', []) if s.get('codec_type') == 'audio']
        if len(vids) != 1 or len(auds) != 1:      # data streams (Zoom bin_data) are ignored, never mapped
            raise Fail('unsupported_streams', step)
        v, a = vids[0], auds[0]

        # --- b. timeline: zero starts, constant frame rate
        if not start_is_zero(info.get('format', {}).get('start_time'), None):
            timeline_fail(step)
        if not start_is_zero(v.get('start_time'), v.get('start_pts')):
            timeline_fail(step)
        if not start_is_zero(a.get('start_time'), a.get('start_pts')):
            timeline_fail(step)
        try:
            fps = Fraction(v.get('r_frame_rate'))
            avg = Fraction(v.get('avg_frame_rate'))
            tb = Fraction(v.get('time_base'))
            rate = int(a['sample_rate'])
            channels = int(a['channels'])
        except (TypeError, ValueError, ZeroDivisionError, KeyError):
            timeline_fail(step)
        if fps <= 0 or fps != avg or tb.numerator != 1 or rate <= 0 or channels <= 0:
            timeline_fail(step)
        R['fps'] = '%d/%d' % (fps.numerator, fps.denominator)
        R['sampleRate'], R['channels'] = rate, channels
        tick = (1 / fps) / tb                      # one frame in time-base ticks
        if tick.denominator != 1:
            timeline_fail(step)
        tick = int(tick)

        frames = math.floor(T * fps)
        samples = math.floor(T * rate)
        if frames < 1 or samples < 1:
            raise Fail('invalid_cut', 'input')
        R['framesKept'], R['samplesKept'] = frames, samples

        # --- c. source frame timestamps on both decode paths
        step = 'probe_frames'
        normal = probe_frames(tools, src, 'v:0', frames + 1, False, step)
        no_edit = probe_frames(tools, src, 'v:0', frames + 1, True, step)
        if normal != no_edit or not normal or normal[0][0] != 0:
            timeline_fail(step)
        for i, (pts, dur) in enumerate(normal):
            if pts != i * tick or (dur is not None and dur != tick):
                timeline_fail(step)               # variable frame rate or a gap
        for ignore in (False, True):
            first = probe_frames(tools, src, 'a:0', 3, ignore, step)
            if not first or first[0][0] != 0:
                timeline_fail(step)
        if len(normal) < frames:
            raise Fail('source_shorter_than_cut', step)

        # --- d. boundary proof: kept frames end <= T, first omitted frame ends > T (it may straddle T)
        step = 'boundary'
        src_pts = [p for p, _ in normal]
        for i in range(frames):
            if (normal[i][0] + tick) * tb > T:
                raise Fail('video_past_cut', step)
        R['lastKeptFrameEndMs'] = frame_ms(normal[frames - 1][0] + tick, tb)
        if len(normal) > frames:
            if (normal[frames][0] + tick) * tb <= T:
                timeline_fail(step)
            R['firstOmittedFrameEndMs'] = frame_ms(normal[frames][0] + tick, tb)
        lap('probe')

        # --- e. audio: zero-based clock, trim to whole pre-cut samples, isolate as PCM, encode twice
        step = 'audio_decode_trim'
        pcm = os.path.join(work, 'kept.pcm')
        a1, a2 = os.path.join(work, 'a.m4a'), os.path.join(work, 'a2.m4a')
        run(ffmpeg_cmd(tools, '-i', src, '-map', '0:a:0', '-af', 'aresample=first_pts=0,atrim=end_sample=%d' % samples,
                       '-f', 's16le', '-ac', channels, '-ar', rate, pcm), step)
        if os.path.getsize(pcm) != samples * channels * 2:
            raise Fail('audio_trim_mismatch', step)
        enc = ['-f', 's16le', '-ar', rate, '-ac', channels, '-i', pcm, '-c:a', 'aac', '-b:a', '128k']
        run(ffmpeg_cmd(tools, *(enc + [a1])), 'audio_encode')
        run(ffmpeg_cmd(tools, *(enc + [a2])), 'audio_encode_independent')
        lap('audio')

        # --- f. video: exactly the first N frames, source clock kept
        step = 'video_encode'
        vid = os.path.join(work, 'v.mp4')
        run(ffmpeg_cmd(tools, '-i', src, '-map', '0:v:0', '-frames:v', frames, '-fps_mode', 'passthrough',
                       '-c:v', 'libx264', '-preset', 'veryfast', '-crf', 20, '-pix_fmt', 'yuv420p', '-bf', 0, '-an',
                       '-video_track_timescale', tb.denominator, vid), step)
        lap('video')

        # --- g. mux
        step = 'mux'
        run(ffmpeg_cmd(tools, '-i', vid, '-i', a1, '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy',
                       '-map_metadata', -1, '-map_chapters', -1, '-movflags', '+faststart', '-fflags', '+bitexact',
                       '-f', 'mp4', partial), step)
        lap('mux')

        # --- h. acceptance of the staged output
        step = 'accept'
        out = json.loads(run([tools.ffprobe, '-v', 'error', '-show_streams', '-show_format', '-of', 'json', partial], step))
        kinds = sorted('%s:%s' % (s.get('codec_type'), s.get('codec_name')) for s in out.get('streams', []))
        if kinds != ['audio:aac', 'video:h264']:
            raise Fail('output_streams_invalid', step)
        if set(out.get('format', {}).get('tags', {})) - {'major_brand', 'minor_version', 'compatible_brands'}:
            raise Fail('output_tags_invalid', step)
        out_v = [s for s in out['streams'] if s['codec_type'] == 'video'][0]
        out_tb = Fraction(out_v['time_base'])
        for ignore in (False, True):                # correspondence: output frame i == source frame i, both paths
            got = probe_frames(tools, partial, 'v:0', 0, ignore, step)
            if len(got) != frames:
                raise Fail('frame_count_mismatch', step)
            for i in range(frames):
                if Fraction(got[i][0]) * out_tb != Fraction(src_pts[i]) * tb:
                    raise Fail('frame_timestamp_mismatch', step)
            if (Fraction(got[-1][0]) + Fraction(tick) * tb / out_tb) * out_tb > T:
                raise Fail('video_past_cut', step)
        out_a = [s for s in out['streams'] if s['codec_type'] == 'audio'][0]
        if out_a.get('time_base') == '1/%d' % rate and int(out_a.get('duration_ts', 0)) > samples:
            raise Fail('audio_past_cut', step)
        if decoded_sample_count(tools, partial, channels, step) > samples:
            raise Fail('audio_past_cut', step)
        R['audioPacketsEqual'] = md5_packets(tools, partial, step) == md5_packets(tools, a2, step)
        if not R['audioPacketsEqual']:
            raise Fail('audio_payload_mismatch', step)
        lap('accept')

        # --- i. declare the output only now
        step = 'declare'
        os.replace(partial, final)
        R['outputSha256'], R['outputQuickXorHash'], R['outputSize'] = hash_file(final)
        R.update(ok=True, code='ok', step=None)
    except Fail as fail:
        R.update(ok=False, code=fail.code, step=fail.step)
        for p in (partial, final):
            if os.path.exists(p):
                os.remove(p)
    except OSError as error:
        code = 'insufficient_scratch' if error.errno == errno.ENOSPC else 'io_error'
        R.update(ok=False, code=code, step=None)
        for p in (partial, final):
            if os.path.exists(p):
                os.remove(p)
    R['timingsMs']['total'] = int((time.monotonic() - started) * 1000)
    write_json(receipt_path, R)
    return 0 if R['ok'] else 3


# ---------------------------------------------------------------- upload (Graph upload session)
class Retry(Exception):
    pass


def put_chunk(url, data, start, total):
    end = start + len(data) - 1
    req = urllib.request.Request(url, data=data, method='PUT', headers={
        'Content-Length': str(len(data)), 'Content-Range': 'bytes %d-%d/%d' % (start, end, total)})
    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as error:
        body = error.read()
        if error.code >= 500 or error.code in (429, 409, 416):
            raise Retry()
        return error.code, body
    except (urllib.error.URLError, OSError, ValueError):
        raise Retry()
    except Exception:                                 # http.client errors on dropped connections
        raise Retry()


def next_expected(url):
    """GET the session; first start of nextExpectedRanges, or None when unknown."""
    try:
        with urllib.request.urlopen(urllib.request.Request(url, method='GET'), timeout=60) as resp:
            ranges = json.loads(resp.read()).get('nextExpectedRanges') or []
        return int(str(ranges[0]).split('-')[0]) if ranges else None
    except Exception:
        return None


def cmd_upload():
    work = env('WORK_DIR')
    receipt = {'ok': False, 'code': 'upload_failed', 'httpStatus': None}
    path = os.path.join(work, 'presentation.mp4')
    try:
        url = env('UPLOAD_URL')
        total = os.path.getsize(path)
        backoff = [float(x) for x in os.environ.get('UPLOAD_BACKOFF_S', '2,4,8').split(',')]
        offset, item = 0, None
        with open(path, 'rb') as handle:
            while offset < total and item is None:
                handle.seek(offset)
                data = handle.read(CHUNK)
                attempt = 0
                while True:
                    try:
                        status, body = put_chunk(url, data, offset, total)
                        break
                    except Retry:
                        if attempt >= 3:
                            raise Fail('upload_failed')
                        time.sleep(backoff[min(attempt, len(backoff) - 1)])
                        attempt += 1
                        resume = next_expected(url)
                        if resume is not None and resume != offset:
                            offset = resume
                            handle.seek(offset)
                            data = handle.read(CHUNK)
                receipt['httpStatus'] = status
                last = offset + len(data) >= total
                if status == 202 and not last:
                    offset += len(data)
                elif status in (200, 201) and last:
                    item = json.loads(body).get('id')
                    if not item:
                        raise Fail('upload_failed')
                elif status in (200, 201, 202):
                    raise Fail('upload_failed')
                else:
                    raise Fail('upload_rejected')
        if item is None:
            raise Fail('upload_failed')
        receipt.update(ok=True, code='ok', itemId=item, size=total)
    except Fail as fail:
        receipt['code'] = fail.code
    except Exception:
        receipt['code'] = 'upload_failed'
    write_json(os.path.join(work, 'upload.json'), receipt)
    return 0 if receipt['ok'] else 3


def cmd_qxh():
    sys.stdout.write(json.dumps({'quickXorHash': hash_file(env('FILE'))[1]}) + '\n')
    return 0


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else ''
    table = {'install': cmd_install, 'cut': cmd_cut, 'upload': cmd_upload, 'qxh': cmd_qxh}
    if cmd not in table:
        sys.stderr.write('usage: cut.py install|cut|upload|qxh\n')
        return 2
    return table[cmd]()


if __name__ == '__main__':
    try:
        code = main()
    except BaseException as error:                    # crash: class name only, never message or traceback
        sys.stderr.write('crash: %s\n' % type(error).__name__)
        code = 1
    sys.exit(code)
`;

