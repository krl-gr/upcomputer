// Each `@public` value is used by apps/mobile, which Up.computer keeps outside
// the pnpm workspace.
export {
  /** @public */
  VoiceInputController,
  /** @public */
  VOICE_RECORDING_LIMIT_SECONDS,
  MICROPHONE_PERMISSION_ERROR,
  /** @public */
  voiceInputBlocksSubmission,
  type VoiceDraftSnapshot,
  type VoiceInputControllerDependencies,
  type VoiceInputErrorCode,
  type VoiceInputPhase,
  type VoiceInputState,
  type VoiceRecorder,
  type VoiceRecorderStatus,
} from "./controller.ts";
export {
  cancelEnvironmentSpeechModelDownload,
  downloadEnvironmentSpeechModel,
  getEnvironmentSpeechModels,
  getCloudSpeechKeys,
  getCloudSpeechModels,
  requireCloudSpeechKey,
  setCloudSpeechKey,
  transcribeCloudPcm,
  getEnvironmentSpeechStatus,
  getEnvironmentSpeechStreamUrl,
  getSpeechModelDownloadOutcome,
  /** @public */
  installEnvironmentSpeechModel,
  linkEnvironmentSpeechModels,
  postProcessEnvironmentTranscript,
  removeEnvironmentSpeechModel,
  selectEnvironmentSpeechModel,
  transcribeEnvironmentPcm,
  updateEnvironmentSpeechAcceleration,
  updateEnvironmentSpeechModelUnloadTimeout,
} from "./environment.ts";
export { openSpeechStream } from "./stream.ts";
export {
  /** @public */
  VoiceTranscriptionError,
  /** @public */
  throwIfVoiceTranscriptionAborted,
  type PreparedVoiceTranscription,
  type VoiceStreamingSession,
  type VoiceTranscriber,
  type VoiceTranscriptionErrorCode,
  type VoiceTranscriptionOptions,
} from "./transcription.ts";
