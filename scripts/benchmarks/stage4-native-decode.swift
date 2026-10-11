// Independent local AVFoundation decode probe. Invoke only on generated benchmark media.
// Outputs decoded audio plus a content-free receipt; no network or publication.
import Foundation
import AVFoundation
import CoreMedia
import CoreVideo

@main struct Probe {
    static func main() async throws {
        guard CommandLine.arguments.count == 4 else { fatalError("input.mp4 receipt.json decoded.f32") }
        let asset = AVURLAsset(url: URL(fileURLWithPath: CommandLine.arguments[1]))
        let video = try await asset.loadTracks(withMediaType: .video)
        let audio = try await asset.loadTracks(withMediaType: .audio)
        guard video.count == 1 && audio.count == 1 else { fatalError("Unexpected track count") }
        let vr = try AVAssetReader(asset: asset)
        let vo = AVAssetReaderTrackOutput(track: video[0], outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
        vr.add(vo); guard vr.startReading() else { throw vr.error! }
        var frames = 0, privateFrames = 0
        var videoEnd = 0.0, videoClockError = 0.0
        var invalidSampleDurations = 0
        var videoPTS:[Double] = []
        while let sample = vo.copyNextSampleBuffer() {
            let pts = CMSampleBufferGetPresentationTimeStamp(sample).seconds
            let duration = CMSampleBufferGetDuration(sample).seconds
            videoPTS.append(pts)
            if !duration.isFinite || duration <= 0 { invalidSampleDurations += 1 }
            guard let buf = CMSampleBufferGetImageBuffer(sample) else { fatalError("No pixels") }
            CVPixelBufferLockBaseAddress(buf, .readOnly)
            let ptr = CVPixelBufferGetBaseAddress(buf)!.assumingMemoryBound(to: UInt8.self)
            let stride = CVPixelBufferGetBytesPerRow(buf)
            let center = 100 * stride + 100 * 4
            if Int(ptr[center+2]) > Int(ptr[center+1])*2 && ptr[center+2]>100 { privateFrames += 1 }
            var frameID = 0
            for bit in 0..<12 {
                let at = 16 * stride + (bit*24+16)*4
                if Int(ptr[at])+Int(ptr[at+1])+Int(ptr[at+2]) > 384 { frameID |= 1 << bit }
            }
            videoClockError = max(videoClockError, abs(pts-Double(frameID)/30.0))
            CVPixelBufferUnlockBaseAddress(buf, .readOnly)
            frames += 1
        }
        guard vr.status == .completed else { throw vr.error! }
        // These fixtures are CFR. Establish intervals from adjacent native PTS,
        // native minimum frame duration and track end; do not substitute zero.
        let step = try await video[0].load(.minFrameDuration).seconds
        let range = try await video[0].load(.timeRange)
        let trackEnd = CMTimeRangeGetEnd(range).seconds
        videoEnd = (videoPTS.last ?? 0) + step
        let validVideoIntervals = !videoPTS.isEmpty && step.isFinite && step > 0
            && videoPTS.allSatisfy { $0.isFinite }
            && zip(videoPTS,videoPTS.dropFirst()).allSatisfy { abs($1-$0-step)<0.000001 }
            && abs(videoEnd-trackEnd)<0.000001

        let ar = try AVAssetReader(asset: asset)
        let ao = AVAssetReaderTrackOutput(track: audio[0], outputSettings: [AVFormatIDKey: kAudioFormatLinearPCM,
            AVLinearPCMBitDepthKey:32, AVLinearPCMIsFloatKey:true, AVLinearPCMIsBigEndianKey:false,
            AVLinearPCMIsNonInterleaved:false, AVSampleRateKey:48000, AVNumberOfChannelsKey:2])
        ar.add(ao); guard ar.startReading() else { throw ar.error! }
        let pcmURL = URL(fileURLWithPath: CommandLine.arguments[3])
        FileManager.default.createFile(atPath: pcmURL.path, contents: nil)
        let handle = try FileHandle(forWritingTo: pcmURL)
        var samples = 0, audioEnd = 0.0, audioClockError = 0.0
        while let sample = ao.copyNextSampleBuffer() {
            let count = CMSampleBufferGetNumSamples(sample)
            let pts = CMSampleBufferGetPresentationTimeStamp(sample).seconds
            audioClockError = max(audioClockError, abs(pts-Double(samples)/48000.0))
            audioEnd = max(audioEnd,pts+Double(count)/48000.0)
            guard let block = CMSampleBufferGetDataBuffer(sample) else { fatalError("No PCM") }
            let len = CMBlockBufferGetDataLength(block)
            var data = Data(count:len)
            let status = data.withUnsafeMutableBytes { CMBlockBufferCopyDataBytes(block, atOffset:0, dataLength:len, destination:$0.baseAddress!) }
            guard status == kCMBlockBufferNoErr && len == count*8 else { fatalError("Unexpected PCM layout") }
            try handle.write(contentsOf:data); samples += count
        }
        try handle.close()
        guard ar.status == .completed else { throw ar.error! }
        let result:[String:Any] = ["decoder":"Apple AVFoundation AVAssetReader", "video_frames":frames, "valid_video_intervals":validVideoIntervals, "missing_sample_durations":invalidSampleDurations, "native_frame_step":step, "native_track_end":trackEnd,
            "private_video_frames":privateFrames, "video_end":videoEnd, "video_clock_error":videoClockError,
            "audio_samples":samples, "audio_end":audioEnd, "audio_clock_error":audioClockError,
            "video_tracks":video.count, "audio_tracks":audio.count]
        try JSONSerialization.data(withJSONObject:result,options:[.prettyPrinted,.sortedKeys]).write(to:URL(fileURLWithPath:CommandLine.arguments[2]))
    }
}
