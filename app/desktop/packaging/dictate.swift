// Lore's dictation helper: macOS speech recognition (on-device when the Mac
// supports it) streamed to stdout as `kind<TAB>text` lines. Recording stops
// when stdin closes. Raw audio is never written anywhere.
import AVFoundation
import Foundation
import Speech

func emit(_ kind: String, _ text: String) {
    print("\(kind)\t\(text.replacingOccurrences(of: "\n", with: " "))")
    fflush(stdout)
}

func fail(_ text: String) -> Never {
    emit("error", text)
    exit(1)
}

func record(_ recognizer: SFSpeechRecognizer) {
    let engine = AVAudioEngine()
    let request = SFSpeechAudioBufferRecognitionRequest()
    request.shouldReportPartialResults = true
    request.requiresOnDeviceRecognition = recognizer.supportsOnDeviceRecognition
    let input = engine.inputNode
    input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { buffer, _ in
        request.append(buffer)
    }
    engine.prepare()
    do { try engine.start() } catch { fail("The microphone could not be started: \(error.localizedDescription)") }
    emit("ready", recognizer.supportsOnDeviceRecognition ? "on-device" : "network")
    var latest = ""
    var stopping = false
    recognizer.recognitionTask(with: request) { result, error in
        if let result {
            latest = result.bestTranscription.formattedString
            emit(result.isFinal ? "final" : "partial", latest)
            if result.isFinal { exit(0) }
        }
        if let error {
            // After endAudio, "no speech" arrives as an error; before it, an error is real.
            if stopping || !latest.isEmpty { emit("final", latest); exit(0) }
            fail(error.localizedDescription)
        }
    }
    DispatchQueue.global().async {
        while readLine() != nil {}
        stopping = true
        engine.stop()
        input.removeTap(onBus: 0)
        request.endAudio()
        DispatchQueue.main.asyncAfter(deadline: .now() + 4) {
            emit("final", latest)
            exit(0)
        }
    }
}

guard let recognizer = SFSpeechRecognizer(locale: Locale.current) ?? SFSpeechRecognizer(), recognizer.isAvailable else {
    fail("Speech recognition is not available on this Mac.")
}
SFSpeechRecognizer.requestAuthorization { status in
    guard status == .authorized else {
        fail("Lore needs Speech Recognition permission: System Settings → Privacy & Security → Speech Recognition.")
    }
    AVCaptureDevice.requestAccess(for: .audio) { granted in
        guard granted else {
            fail("Lore needs Microphone permission: System Settings → Privacy & Security → Microphone.")
        }
        DispatchQueue.main.async { record(recognizer) }
    }
}
RunLoop.main.run()
