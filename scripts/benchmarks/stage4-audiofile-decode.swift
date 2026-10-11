// Independent audio-only diagnostic. Generated local media only.
import Foundation
import AVFoundation
@main struct AudioFileProbe {
 static func main() throws {
  guard CommandLine.arguments.count == 4 else { fatalError("input receipt pcm") }
  let file = try AVAudioFile(forReading: URL(fileURLWithPath: CommandLine.arguments[1]), commonFormat: .pcmFormatFloat32, interleaved: true)
  guard file.processingFormat.sampleRate == 48000 && file.processingFormat.channelCount == 2 else { fatalError("Unexpected format") }
  let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: 4096)!
  FileManager.default.createFile(atPath: CommandLine.arguments[3], contents: nil)
  let handle = try FileHandle(forWritingTo: URL(fileURLWithPath: CommandLine.arguments[3]))
  var count = 0
  var terminalError = ""
  var errorBufferFrames = 0
  var chunks:[Int] = []
  while true {
   buffer.frameLength = 0
   do { try file.read(into: buffer, frameCount: 4096) }
   catch { terminalError = String(describing:error); errorBufferFrames = Int(buffer.frameLength); break }
   let n = Int(buffer.frameLength)
   if n == 0 { break }
   let audio = buffer.audioBufferList.pointee.mBuffers
   guard Int(audio.mDataByteSize) == n * 8 else { fatalError("Unexpected layout") }
   try handle.write(contentsOf: Data(bytes: audio.mData!, count: n * 8))
   count += n; chunks.append(n)
  }
  try handle.close()
  let result:[String:Any] = ["decoder":"Apple AVAudioFile", "samples":count, "terminal_error":terminalError, "error_buffer_frames":errorBufferFrames, "declared_length":file.length, "final_position":file.framePosition, "last_chunks":Array(chunks.suffix(3))]
  try JSONSerialization.data(withJSONObject:result,options:[.prettyPrinted,.sortedKeys]).write(to:URL(fileURLWithPath:CommandLine.arguments[2]))
 }
}
